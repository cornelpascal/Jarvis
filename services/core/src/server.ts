import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { JarvisConfig, JarvisEnvironment } from "@jarvis/config";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import { Logger } from "@jarvis/logging";
import {
  EVENT_SCHEMA_VERSION,
  MAX_EVENT_BYTES,
  MAX_REPLAY_LIMIT,
  PROTOCOL_VERSION,
  eventStreamSubscribeSchema,
  type CapabilityManifest,
  type EventStreamServerMessage,
  type HealthSnapshot,
} from "@jarvis/protocol";

const MAX_BUFFERED_BYTES = 512 * 1024;
const SUBSCRIBE_TIMEOUT_MS = 5_000;

export interface CoreServerOptions {
  config: JarvisConfig;
  environment: JarvisEnvironment;
  database: JarvisDatabase;
  bus: LocalEventBus;
  sessionToken: string;
  version: string;
}

export interface CoreServer {
  readonly url: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface ClientState {
  subscribed: boolean;
  subscribeTimer: ReturnType<typeof setTimeout>;
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function protocolToken(request: IncomingMessage): string | undefined {
  const values =
    request.headers["sec-websocket-protocol"]
      ?.split(",")
      .map((value) => value.trim()) ?? [];
  const encoded = values
    .find((value) => value.startsWith("jarvis.token."))
    ?.slice("jarvis.token.".length);
  if (!encoded) return undefined;
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

function sendStreamMessage(
  client: WebSocket,
  message: EventStreamServerMessage,
): boolean {
  if (client.readyState !== WebSocket.OPEN) return false;
  if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
    client.close(1013, "Event consumer is too slow");
    return false;
  }
  client.send(JSON.stringify(message));
  return true;
}

function decodeRawData(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return raw.toString("utf8");
}

export function createCoreServer(options: CoreServerOptions): CoreServer {
  const logger = new Logger("core-server");
  const startedAt = new Date();
  const clients = new Map<WebSocket, ClientState>();
  const health = (): HealthSnapshot => ({
    status: "ok",
    service: "jarvis-core",
    version: options.version,
    protocolVersion: PROTOCOL_VERSION,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.max(0, (Date.now() - startedAt.getTime()) / 1000),
    database: "ok",
    environment: options.environment,
  });
  const capabilities: CapabilityManifest = {
    protocolVersion: PROTOCOL_VERSION,
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    capabilities: ["health", "capabilities", "events", "event-replay"],
    platform: process.platform,
    providers: {},
  };
  const httpServer = createServer((request, response) => {
    const origin = request.headers.origin;
    if (
      origin &&
      (origin === "tauri://localhost" ||
        /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin))
    ) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "origin");
    }
    if (request.method === "GET" && request.url === "/health")
      return sendJson(response, 200, health());
    if (request.method === "GET" && request.url === "/capabilities")
      return sendJson(response, 200, capabilities);
    return sendJson(response, 404, {
      code: "NOT_FOUND",
      message: "Route not found",
      retryable: false,
    });
  });
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_EVENT_BYTES,
    handleProtocols: (protocols) =>
      protocols.has("jarvis.auth.v1") ? "jarvis.auth.v1" : false,
  });
  httpServer.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    const allowedOrigin =
      origin === undefined ||
      origin === "tauri://localhost" ||
      /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin);
    if (
      request.url !== "/events" ||
      !allowedOrigin ||
      !tokenMatches(protocolToken(request), options.sessionToken)
    ) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) =>
      websocketServer.emit("connection", client, request),
    );
  });
  websocketServer.on("connection", (client) => {
    const subscribeTimer = setTimeout(
      () => client.close(1008, "Subscription handshake timed out"),
      SUBSCRIBE_TIMEOUT_MS,
    );
    clients.set(client, { subscribed: false, subscribeTimer });
    sendStreamMessage(client, {
      kind: "hello",
      protocolVersion: PROTOCOL_VERSION,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      latestSequence: options.database.latestEventSequence(),
      replayLimit: MAX_REPLAY_LIMIT,
    });
    client.on("message", (raw, binary) => {
      const state = clients.get(client);
      if (!state || state.subscribed || binary) {
        client.close(1008, "Invalid event subscription");
        return;
      }
      try {
        const subscription = eventStreamSubscribeSchema.parse(
          JSON.parse(decodeRawData(raw)) as unknown,
        );
        state.subscribed = true;
        clearTimeout(state.subscribeTimer);
        const events = options.database.readEventsAfter(
          subscription.afterSequence,
          subscription.replayLimit + 1,
        );
        const truncated = events.length > subscription.replayLimit;
        for (const event of events.slice(0, subscription.replayLimit)) {
          sendStreamMessage(client, {
            kind: "event",
            durable: true,
            replayed: true,
            event,
          });
        }
        sendStreamMessage(client, {
          kind: "replay_complete",
          latestSequence: options.database.latestEventSequence(),
          truncated,
        });
      } catch {
        sendStreamMessage(client, {
          kind: "error",
          code: "INVALID_SUBSCRIPTION",
          message: "Malformed subscription",
        });
        client.close(1008, "Malformed subscription");
      }
    });
    client.on("close", () => {
      const state = clients.get(client);
      if (state) clearTimeout(state.subscribeTimer);
      clients.delete(client);
    });
    client.on("error", (error) =>
      logger.log("warn", "websocket.error", { message: error.message }),
    );
  });
  const unsubscribe = options.bus.subscribe((event, delivery) => {
    if (delivery.durable) options.database.appendEvent(event);
    else options.database.recordEventSequence(event.sequence);
    for (const [client, state] of clients) {
      if (state.subscribed)
        sendStreamMessage(client, {
          kind: "event",
          durable: delivery.durable,
          replayed: false,
          event,
        });
    }
  });
  return {
    url: `http://${options.config.network.bind_host}:${String(options.config.network.port)}`,
    start: () =>
      new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(
          options.config.network.port,
          options.config.network.bind_host,
          () => {
            httpServer.off("error", reject);
            logger.log("info", "server.started", {
              host: options.config.network.bind_host,
              port: String(options.config.network.port),
            });
            resolve();
          },
        );
      }),
    stop: async () => {
      unsubscribe();
      for (const [client, state] of clients) {
        clearTimeout(state.subscribeTimer);
        client.close(1001, "Core stopping");
      }
      websocketServer.close();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

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
  voiceClientSignalSchema,
  type CapabilityManifest,
  type EventStreamServerMessage,
  type HealthSnapshot,
  type VoiceClientSignal,
} from "@jarvis/protocol";
import { RealtimeGatewayError, type RealtimeCallGateway } from "@jarvis/voice";

const MAX_BUFFERED_BYTES = 512 * 1024;
const SUBSCRIBE_TIMEOUT_MS = 5_000;
const MAX_COMMAND_BYTES = 64 * 1024;

export interface CoreServerOptions {
  config: JarvisConfig;
  environment: JarvisEnvironment;
  database: JarvisDatabase;
  bus: LocalEventBus;
  sessionToken: string;
  version: string;
  voiceGateway: RealtimeCallGateway;
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

function requestToken(request: IncomingMessage): string | undefined {
  const token = request.headers["x-jarvis-session-token"];
  return Array.isArray(token) ? token[0] : token;
}

function allowedOrigin(origin: string | undefined): boolean {
  return (
    origin === undefined ||
    origin === "tauri://localhost" ||
    /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin)
  );
}

async function readBody(
  request: IncomingMessage,
  maximumBytes = MAX_COMMAND_BYTES,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request as AsyncIterable<unknown>) {
    if (!(typeof chunk === "string" || chunk instanceof Uint8Array))
      throw new RealtimeGatewayError(
        "INVALID_REQUEST_BODY",
        "Request body contained an unsupported chunk",
        400,
        false,
      );
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maximumBytes)
      throw new RealtimeGatewayError(
        "REQUEST_TOO_LARGE",
        "Request body is too large",
        413,
        false,
      );
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function publishVoiceSignal(
  bus: LocalEventBus,
  signal: VoiceClientSignal,
): Promise<void> {
  const provider = "openai-realtime";
  switch (signal.type) {
    case "voice.connected":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", {
          provider,
          sessionId: signal.sessionId,
        }),
        { durable: false },
      );
      return;
    case "voice.listening":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", {
          provider,
          muted: signal.muted,
        }),
        { durable: false },
      );
      return;
    case "voice.user_speaking":
    case "voice.processing":
    case "voice.speaking":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", { provider }),
        { durable: false },
      );
      return;
    case "voice.interrupted":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", {
          provider,
          by: signal.by,
        }),
        { durable: false },
      );
      return;
    case "voice.muted.changed":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", { muted: signal.muted }),
        { durable: false },
      );
      return;
    case "voice.disconnected":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", {
          provider,
          reason: signal.reason,
          retryable: signal.retryable,
        }),
        { durable: false },
      );
      return;
    case "voice.failed":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", {
          provider,
          code: signal.code,
          message: signal.message,
          retryable: signal.retryable,
        }),
        { durable: false },
      );
      return;
    case "conversation.transcript":
      await bus.publish(
        bus.create("conversation.message.added", "dashboard.voice", {
          messageId: signal.messageId,
          role: signal.role,
          content: signal.content,
          citations: [],
        }),
      );
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
  const capabilities = async (): Promise<CapabilityManifest> => {
    const voice = await options.voiceGateway.health();
    return {
      protocolVersion: PROTOCOL_VERSION,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      capabilities: [
        "health",
        "capabilities",
        "events",
        "event-replay",
        "voice-webrtc",
        "voice-events",
      ],
      platform: process.platform,
      providers: { voice: voice.status },
    };
  };
  const handleHttp = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const origin = request.headers.origin;
    if (origin && allowedOrigin(origin)) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "origin");
    }
    if (request.method === "OPTIONS") {
      if (!allowedOrigin(origin))
        return sendJson(response, 403, {
          code: "ORIGIN_REJECTED",
          message: "Origin is not allowed",
          retryable: false,
        });
      response.writeHead(204, {
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, x-jarvis-session-token",
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/health")
      return sendJson(response, 200, health());
    if (request.method === "GET" && request.url === "/capabilities")
      return sendJson(response, 200, await capabilities());
    if (
      request.method === "POST" &&
      (request.url === "/voice/call" || request.url === "/voice/events")
    ) {
      if (
        !allowedOrigin(origin) ||
        !tokenMatches(requestToken(request), options.sessionToken)
      )
        return sendJson(response, 401, {
          code: "UNAUTHORIZED",
          message: "A valid launch-scoped token is required",
          retryable: false,
        });
      try {
        if (request.url === "/voice/call") {
          if (!request.headers["content-type"]?.startsWith("application/sdp"))
            return sendJson(response, 415, {
              code: "UNSUPPORTED_MEDIA_TYPE",
              message: "Voice offers require application/sdp",
              retryable: false,
            });
          const offerSdp = await readBody(request);
          return sendJson(
            response,
            201,
            await options.voiceGateway.createCall(
              offerSdp,
              AbortSignal.timeout(20_000),
            ),
          );
        }
        const signal = voiceClientSignalSchema.parse(
          JSON.parse(await readBody(request)) as unknown,
        );
        await publishVoiceSignal(options.bus, signal);
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      } catch (cause) {
        if (cause instanceof RealtimeGatewayError)
          return sendJson(response, cause.status, {
            code: cause.code,
            message: cause.message,
            retryable: cause.retryable,
          });
        return sendJson(response, 400, {
          code: "INVALID_VOICE_REQUEST",
          message: "Voice request was malformed",
          retryable: false,
        });
      }
    }
    return sendJson(response, 404, {
      code: "NOT_FOUND",
      message: "Route not found",
      retryable: false,
    });
  };
  const httpServer = createServer((request, response) => {
    void handleHttp(request, response).catch((cause: unknown) => {
      logger.log("error", "http.unhandled", {
        message: cause instanceof Error ? cause.message : "Unknown failure",
      });
      if (!response.headersSent)
        sendJson(response, 500, {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
          retryable: true,
        });
      else response.destroy();
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
    const originAllowed = allowedOrigin(origin);
    if (
      request.url !== "/events" ||
      !originAllowed ||
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

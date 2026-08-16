import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { JarvisConfig, JarvisEnvironment } from "@jarvis/config";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import { Logger } from "@jarvis/logging";
import {
  EVENT_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  type CapabilityManifest,
  type HealthSnapshot,
} from "@jarvis/protocol";

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

export function createCoreServer(options: CoreServerOptions): CoreServer {
  const logger = new Logger("core-server");
  const startedAt = new Date();
  const clients = new Set<WebSocket>();
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
    capabilities: ["health", "capabilities", "events"],
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
    handleProtocols: (protocols) =>
      protocols.has("jarvis.auth.v1") ? "jarvis.auth.v1" : false,
  });
  httpServer.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    const allowedOrigin =
      origin === undefined ||
      origin === "tauri://localhost" ||
      /^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin) ||
      /^http:\/\/localhost(?::\d+)?$/.test(origin);
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
    clients.add(client);
    client.on("close", () => clients.delete(client));
    client.on("error", (error) =>
      logger.log("warn", "websocket.error", { message: error.message }),
    );
  });
  const unsubscribe = options.bus.subscribe((event) => {
    options.database.appendEvent(event);
    const encoded = JSON.stringify(event);
    for (const client of clients)
      if (client.readyState === WebSocket.OPEN) client.send(encoded);
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
      for (const client of clients) client.close(1001, "Core stopping");
      websocketServer.close();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

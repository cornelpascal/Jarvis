import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { JarvisConfig } from "../packages/config/src/index.js";
import {
  openJarvisDatabase,
  type JarvisDatabase,
} from "../packages/database/src/index.js";
import { LocalEventBus } from "../packages/event-bus/src/index.js";
import {
  EVENT_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  eventStreamServerMessageSchema,
  type EventStreamServerMessage,
} from "../packages/protocol/src/index.js";
import {
  createCoreServer,
  type CoreServer,
} from "../services/core/src/server.js";

function testConfig(port: number): JarvisConfig {
  return {
    app: { name: "JARVIS" },
    projects: { roots: ["C:\\Documents"] },
    voice: { enabled: true, activation: "hotkey", hotkey: "Alt+Space" },
    references: {
      mode: "smart",
      visual_threshold: 0.65,
      images: true,
      videos: true,
      sources: true,
      autoplay_video: false,
    },
    codex: { max_concurrent_agents: 3, default_mode: "develop" },
    git: { auto_commit: false, auto_push: false },
    security: {
      require_push_confirmation: true,
      require_deploy_confirmation: true,
    },
    network: { bind_host: "127.0.0.1", port },
  };
}

function messageQueue(
  socket: WebSocket,
): () => Promise<EventStreamServerMessage> {
  const queued: EventStreamServerMessage[] = [];
  const waiting: Array<(message: EventStreamServerMessage) => void> = [];
  socket.on("message", (raw) => {
    const text = Array.isArray(raw)
      ? Buffer.concat(raw).toString("utf8")
      : raw instanceof ArrayBuffer
        ? Buffer.from(raw).toString("utf8")
        : Buffer.from(raw).toString("utf8");
    const message = eventStreamServerMessageSchema.parse(
      JSON.parse(text) as unknown,
    );
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queued.push(message);
  });
  return () => {
    const message = queued.shift();
    if (message) return Promise.resolve(message);
    return new Promise((resolve) => waiting.push(resolve));
  };
}

function connect(port: number, token: string): WebSocket {
  const encoded = Buffer.from(token).toString("base64url");
  return new WebSocket(
    `ws://127.0.0.1:${String(port)}/events`,
    ["jarvis.auth.v1", `jarvis.token.${encoded}`],
    { origin: "http://127.0.0.1:1420" },
  );
}

describe("core event stream", () => {
  let server: CoreServer | undefined;
  let database: JarvisDatabase | undefined;

  afterEach(async () => {
    await server?.stop();
    database?.close();
  });

  it("replays durable history and streams live events", async () => {
    const port = 45_000 + Math.floor(Math.random() * 500);
    database = openJarvisDatabase(":memory:");
    const bus = new LocalEventBus();
    server = createCoreServer({
      config: testConfig(port),
      environment: "test",
      database,
      bus,
      sessionToken: "integration-token",
      version: "test",
    });
    await server.start();
    await bus.publish(
      bus.create("jarvis.test", "test", {
        message: "persisted",
        ordinal: 0,
      }),
    );

    const client = connect(port, "integration-token");
    const next = messageQueue(client);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    expect((await next()).kind).toBe("hello");
    client.send(
      JSON.stringify({
        kind: "subscribe",
        protocolVersion: PROTOCOL_VERSION,
        eventSchemaVersion: EVENT_SCHEMA_VERSION,
        afterSequence: -1,
        replayLimit: 10,
      }),
    );
    const replay = await next();
    expect(replay.kind === "event" && replay.replayed).toBe(true);
    expect((await next()).kind).toBe("replay_complete");

    await bus.publish(
      bus.create("jarvis.test", "test", { message: "live", ordinal: 1 }),
    );
    const live = await next();
    expect(
      live.kind === "event" && !live.replayed && live.event.sequence === 1,
    ).toBe(true);
    client.close();
  });

  it("closes authenticated clients that send malformed subscriptions", async () => {
    const port = 45_500 + Math.floor(Math.random() * 500);
    database = openJarvisDatabase(":memory:");
    const bus = new LocalEventBus();
    server = createCoreServer({
      config: testConfig(port),
      environment: "test",
      database,
      bus,
      sessionToken: "valid-token",
      version: "test",
    });
    await server.start();
    const client = connect(port, "valid-token");
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    const closed = new Promise<number>((resolve) =>
      client.once("close", (code) => resolve(code)),
    );
    client.send("{");
    await expect(closed).resolves.toBe(1008);
  });
});

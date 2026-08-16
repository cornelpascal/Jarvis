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
  type KnownJarvisEvent,
} from "../packages/protocol/src/index.js";
import {
  createCoreServer,
  type CoreServer,
} from "../services/core/src/server.js";
import type {
  ResearchProvider,
  ResearchRequest,
} from "../packages/protocol/src/index.js";
import type { RealtimeCallGateway } from "../services/voice/src/index.js";

const voiceGateway: RealtimeCallGateway = {
  health: () =>
    Promise.resolve({
      status: "available",
      capabilities: ["webrtc"],
    }),
  createCall: (offerSdp) =>
    Promise.resolve({
      answerSdp: offerSdp.replace("offer", "answer"),
      callId: "call_test",
      provider: "openai-realtime",
    }),
};

const researchProvider: ResearchProvider = {
  health: () =>
    Promise.resolve({ status: "available", capabilities: ["web-search"] }),
  research: (request: ResearchRequest) =>
    Promise.resolve({
      requestId: request.requestId,
      answer: "Humanoid robotics is advancing.",
      sources: [
        {
          id: "source-1",
          title: "Robotics source",
          url: "https://example.com/robotics",
          retrievedAt: new Date().toISOString(),
          provenance: {
            origin: "web",
            trusted: false,
            source: "https://example.com/robotics",
          },
        },
      ],
      images: [],
      videos: [],
      visualRecommendation: {
        display: false,
        score: 0,
        reason: "Reference evaluation is deferred to Phase 7",
        preferredMode: "none",
      },
    }),
};

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
      voiceGateway,
      researchProvider,
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
      voiceGateway,
      researchProvider,
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

  it("authenticates voice call creation and validates client voice events", async () => {
    const port = 46_000 + Math.floor(Math.random() * 500);
    database = openJarvisDatabase(":memory:");
    const bus = new LocalEventBus();
    server = createCoreServer({
      config: testConfig(port),
      environment: "test",
      database,
      bus,
      sessionToken: "voice-token",
      version: "test",
      voiceGateway,
      researchProvider,
    });
    await server.start();
    const unauthorized = await fetch(
      `http://127.0.0.1:${String(port)}/voice/call`,
      {
        method: "POST",
        headers: { "content-type": "application/sdp" },
        body: "offer",
      },
    );
    expect(unauthorized.status).toBe(401);

    const call = await fetch(`http://127.0.0.1:${String(port)}/voice/call`, {
      method: "POST",
      headers: {
        "content-type": "application/sdp",
        "x-jarvis-session-token": "voice-token",
        origin: "http://127.0.0.1:1420",
      },
      body: "offer",
    });
    expect(call.status).toBe(201);
    await expect(call.json()).resolves.toMatchObject({
      answerSdp: "answer",
      provider: "openai-realtime",
    });

    const received = new Promise<KnownJarvisEvent>((resolve) => {
      const unsubscribe = bus.subscribe((event) => {
        if (event.type === "voice.listening") {
          unsubscribe();
          resolve(event);
        }
      });
    });
    const signal = await fetch(
      `http://127.0.0.1:${String(port)}/voice/events`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-jarvis-session-token": "voice-token",
          origin: "http://127.0.0.1:1420",
        },
        body: JSON.stringify({ type: "voice.listening", muted: false }),
      },
    );
    expect(signal.status).toBe(204);
    await expect(received).resolves.toMatchObject({
      type: "voice.listening",
      payload: { provider: "openai-realtime", muted: false },
    });

    const researchComplete = new Promise<KnownJarvisEvent>((resolve) => {
      const unsubscribe = bus.subscribe((event) => {
        if (event.type === "research.completed") {
          unsubscribe();
          resolve(event);
        }
      });
    });
    const route = await fetch(
      `http://127.0.0.1:${String(port)}/commands/route`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-jarvis-session-token": "voice-token",
          origin: "http://127.0.0.1:1420",
        },
        body: JSON.stringify({
          requestId: "7cb5ddae-a2f8-46af-b45a-8a2056dc3617",
          text: "What's new with humanoid robots today?",
          provenance: { origin: "user", trusted: true },
        }),
      },
    );
    expect(route.status).toBe(200);
    await expect(route.json()).resolves.toMatchObject({ route: "research" });
    await expect(researchComplete).resolves.toMatchObject({
      type: "research.completed",
      payload: { sourceCount: 1 },
    });
  });
});

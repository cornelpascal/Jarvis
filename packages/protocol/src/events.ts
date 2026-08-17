import { z } from "zod";

export const EVENT_SCHEMA_VERSION = 1;
export const MAX_EVENT_BYTES = 256 * 1024;

export const eventTypeFamilies = [
  "jarvis",
  "voice",
  "conversation",
  "agent",
  "research",
  "reference",
  "browser",
  "project",
  "codex",
  "git",
  "deployment",
  "system",
  "approval",
  "memory",
  "notification",
] as const;

export type EventTypeFamily = (typeof eventTypeFamilies)[number];

const eventEnvelopeShape = {
  id: z.uuid(),
  sequence: z.int().nonnegative(),
  timestamp: z.iso.datetime(),
  sessionId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  type: z.string().regex(/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*$/),
  source: z.string().min(1).max(100),
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
} as const;

export const jarvisEventSchema = z.strictObject({
  ...eventEnvelopeShape,
  payload: z.unknown(),
});

export type JarvisEvent<TPayload = unknown> = Omit<
  z.infer<typeof jarvisEventSchema>,
  "payload"
> & {
  payload: TPayload;
};

export const eventPayloadSchemas = {
  "jarvis.ready": z.strictObject({ healthUrl: z.url() }),
  "jarvis.state.changed": z.strictObject({
    state: z.enum([
      "IDLE",
      "LISTENING",
      "USER_SPEAKING",
      "THINKING",
      "SEARCHING",
      "RESEARCHING",
      "CODING",
      "TESTING",
      "WAITING_APPROVAL",
      "SPEAKING",
      "ERROR",
    ]),
    reason: z.string().min(1).optional(),
  }),
  "jarvis.test": z.strictObject({
    message: z.string().min(1),
    ordinal: z.int().nonnegative(),
  }),
  "system.health": z.strictObject({
    status: z.enum(["ok", "degraded", "unavailable"]),
    database: z.enum(["ok", "degraded", "unavailable"]),
    uptimeSeconds: z.number().nonnegative(),
  }),
  "system.telemetry": z.strictObject({
    cpuPercent: z.number().min(0).max(100),
    ramUsedBytes: z.number().nonnegative(),
    ramTotalBytes: z.number().positive(),
    diskUsedBytes: z.number().nonnegative().optional(),
    diskTotalBytes: z.number().positive().optional(),
    network: z.enum(["online", "offline", "unknown"]),
    microphone: z.enum(["ready", "muted", "unavailable", "not_configured"]),
    voice: z.enum([
      "idle",
      "listening",
      "speaking",
      "unavailable",
      "not_configured",
    ]),
    core: z.enum(["online", "degraded", "offline"]),
    codexAgents: z.int().nonnegative(),
  }),
  "voice.connected": z.strictObject({
    provider: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  "voice.listening": z.strictObject({
    provider: z.string().min(1),
    muted: z.boolean(),
  }),
  "voice.user_speaking": z.strictObject({ provider: z.string().min(1) }),
  "voice.processing": z.strictObject({ provider: z.string().min(1) }),
  "voice.speaking": z.strictObject({ provider: z.string().min(1) }),
  "voice.interrupted": z.strictObject({
    provider: z.string().min(1),
    by: z.enum(["user", "system", "disconnect"]),
  }),
  "voice.muted.changed": z.strictObject({ muted: z.boolean() }),
  "voice.disconnected": z.strictObject({
    provider: z.string().min(1),
    reason: z.string().min(1),
    retryable: z.boolean(),
  }),
  "voice.failed": z.strictObject({
    provider: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
  "conversation.message.added": z.strictObject({
    messageId: z.string().min(1),
    role: z.enum(["user", "assistant", "activity"]),
    content: z.string().min(1),
    citations: z
      .array(z.strictObject({ title: z.string().min(1), url: z.url() }))
      .default([]),
  }),
  "conversation.route.selected": z.strictObject({
    requestId: z.uuid(),
    route: z.enum([
      "conversation",
      "research",
      "project",
      "coding",
      "browser",
      "system",
      "git",
      "deployment",
      "reference",
      "memory",
    ]),
    confidence: z.number().min(0).max(1),
    candidates: z.array(
      z.strictObject({
        route: z.enum([
          "conversation",
          "research",
          "project",
          "coding",
          "browser",
          "system",
          "git",
          "deployment",
          "reference",
          "memory",
        ]),
        score: z.number().min(0).max(1),
      }),
    ),
    toolShortlist: z.array(z.string().min(1)).min(3).max(8),
    reasons: z.array(z.string().min(1)),
    requiresClarification: z.boolean(),
  }),
  "project.registered": z.strictObject({
    projectId: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1),
    enabled: z.boolean(),
  }),
  "project.selected": z.strictObject({ projectId: z.string().min(1) }),
  "codex.agent.progress": z.strictObject({
    agentRunId: z.string().min(1),
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    label: z.string().min(1),
    title: z.string().min(1),
    state: z.string().min(1),
  }),
  "approval.requested": z.strictObject({
    approvalId: z.string().min(1),
    action: z.string().min(1),
    reason: z.string().min(1),
    riskLevel: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
    ]),
  }),
  "reference.display.requested": z.strictObject({
    mode: z.enum([
      "SOURCES",
      "IMAGES",
      "VIDEO",
      "WEB",
      "CODE_DIFF",
      "DOCUMENT",
      "EMPTY",
    ]),
    title: z.string().min(1).optional(),
    items: z.array(
      z.strictObject({
        id: z.string().min(1),
        type: z.enum([
          "source",
          "image",
          "video",
          "web",
          "code_diff",
          "document",
        ]),
        title: z.string().min(1),
        uri: z.url().optional(),
        content: z.string().optional(),
      }),
    ),
  }),
  "reference.evaluating": z.strictObject({
    requestId: z.uuid(),
    threshold: z.number().min(0).max(1),
  }),
  "reference.evaluated": z.strictObject({
    requestId: z.uuid(),
    display: z.boolean(),
    score: z.number().min(0).max(1),
    reason: z.string().min(1),
    preferredMode: z.enum(["none", "sources", "images", "video", "mixed"]),
  }),
  "research.started": z.strictObject({
    requestId: z.uuid(),
    query: z.string().min(1),
  }),
  "research.searching": z.strictObject({
    requestId: z.uuid(),
    provider: z.string().min(1),
  }),
  "research.source_found": z.strictObject({
    requestId: z.uuid(),
    source: z.strictObject({
      id: z.string().min(1),
      title: z.string().min(1),
      url: z.url(),
      retrievedAt: z.iso.datetime(),
      provenance: z.strictObject({
        origin: z.literal("web"),
        trusted: z.literal(false),
        source: z.url(),
      }),
    }),
  }),
  "research.completed": z.strictObject({
    requestId: z.uuid(),
    answer: z.string().min(1),
    sourceCount: z.int().nonnegative(),
  }),
  "research.failed": z.strictObject({
    requestId: z.uuid(),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
} as const;

export type EventPayloadMap = {
  [K in keyof typeof eventPayloadSchemas]: z.infer<
    (typeof eventPayloadSchemas)[K]
  >;
};
export type KnownEventType = keyof EventPayloadMap;
export type KnownJarvisEvent = {
  [K in KnownEventType]: JarvisEvent<EventPayloadMap[K]> & { type: K };
}[KnownEventType];

export function parseJarvisEvent(input: unknown): KnownJarvisEvent {
  const envelope = jarvisEventSchema.parse(input);
  const family = envelope.type.split(".", 1)[0];
  if (!eventTypeFamilies.includes(family as EventTypeFamily)) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["type"],
        message: `Unknown event family: ${String(family)}`,
      },
    ]);
  }
  const schemas: Readonly<Record<string, z.ZodType>> = eventPayloadSchemas;
  const schema = schemas[envelope.type];
  if (!schema) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["type"],
        message: `Unregistered event type: ${envelope.type}`,
      },
    ]);
  }
  const payload = schema.parse(envelope.payload);
  return {
    ...envelope,
    type: envelope.type as KnownEventType,
    payload,
  } as KnownJarvisEvent;
}

export function encodedEventSize(event: JarvisEvent): number {
  return new TextEncoder().encode(JSON.stringify(event)).byteLength;
}

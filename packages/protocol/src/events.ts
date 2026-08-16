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
  "jarvis.test": z.strictObject({
    message: z.string().min(1),
    ordinal: z.int().nonnegative(),
  }),
  "system.health": z.strictObject({
    status: z.enum(["ok", "degraded", "unavailable"]),
    database: z.enum(["ok", "degraded", "unavailable"]),
    uptimeSeconds: z.number().nonnegative(),
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

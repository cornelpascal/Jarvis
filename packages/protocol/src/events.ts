import { z } from "zod";

export const EVENT_SCHEMA_VERSION = 1;

export const jarvisEventSchema = z.strictObject({
  id: z.uuid(),
  sequence: z.int().nonnegative(),
  timestamp: z.iso.datetime(),
  sessionId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  type: z.string().regex(/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*$/),
  source: z.string().min(1),
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  payload: z.unknown(),
});

export type JarvisEvent<TPayload = unknown> = Omit<
  z.infer<typeof jarvisEventSchema>,
  "payload"
> & { payload: TPayload };

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

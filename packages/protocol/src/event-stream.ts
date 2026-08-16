import { z } from "zod";
import { EVENT_SCHEMA_VERSION, jarvisEventSchema } from "./events.js";
import { PROTOCOL_VERSION } from "./transport.js";

export const DEFAULT_REPLAY_LIMIT = 200;
export const MAX_REPLAY_LIMIT = 500;

export const eventStreamSubscribeSchema = z.strictObject({
  kind: z.literal("subscribe"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  eventSchemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  afterSequence: z.int().min(-1),
  replayLimit: z
    .int()
    .positive()
    .max(MAX_REPLAY_LIMIT)
    .default(DEFAULT_REPLAY_LIMIT),
});

export const eventStreamHelloSchema = z.strictObject({
  kind: z.literal("hello"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  eventSchemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  latestSequence: z.int().min(-1),
  replayLimit: z.literal(MAX_REPLAY_LIMIT),
});

export const eventStreamEventSchema = z.strictObject({
  kind: z.literal("event"),
  durable: z.boolean(),
  replayed: z.boolean(),
  event: jarvisEventSchema,
});

export const eventStreamReplayCompleteSchema = z.strictObject({
  kind: z.literal("replay_complete"),
  latestSequence: z.int().min(-1),
  truncated: z.boolean(),
});

export const eventStreamErrorSchema = z.strictObject({
  kind: z.literal("error"),
  code: z.string().min(1),
  message: z.string().min(1),
});

export const eventStreamServerMessageSchema = z.discriminatedUnion("kind", [
  eventStreamHelloSchema,
  eventStreamEventSchema,
  eventStreamReplayCompleteSchema,
  eventStreamErrorSchema,
]);

export type EventStreamSubscribe = z.infer<typeof eventStreamSubscribeSchema>;
export type EventStreamServerMessage = z.infer<
  typeof eventStreamServerMessageSchema
>;

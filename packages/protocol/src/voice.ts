import { z } from "zod";

export const MAX_VOICE_SDP_BYTES = 64 * 1024;

export const voiceCallResponseSchema = z.strictObject({
  answerSdp: z.string().min(1).max(MAX_VOICE_SDP_BYTES),
  callId: z.string().min(1).optional(),
  provider: z.literal("openai-realtime"),
});

export type VoiceCallResponse = z.infer<typeof voiceCallResponseSchema>;

export const voiceClientSignalSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("voice.connected"),
    sessionId: z.string().min(1),
  }),
  z.strictObject({ type: z.literal("voice.listening"), muted: z.boolean() }),
  z.strictObject({ type: z.literal("voice.user_speaking") }),
  z.strictObject({ type: z.literal("voice.processing") }),
  z.strictObject({ type: z.literal("voice.speaking") }),
  z.strictObject({
    type: z.literal("voice.interrupted"),
    by: z.enum(["user", "system", "disconnect"]),
  }),
  z.strictObject({
    type: z.literal("voice.muted.changed"),
    muted: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("voice.disconnected"),
    reason: z.string().min(1).max(300),
    retryable: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("voice.failed"),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(300),
    retryable: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("conversation.transcript"),
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(20_000),
    messageId: z.string().min(1),
  }),
]);

export type VoiceClientSignal = z.infer<typeof voiceClientSignalSchema>;

export type VoiceRuntimeState =
  | "idle"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "processing"
  | "speaking"
  | "muted"
  | "unavailable"
  | "error";

import { z } from "zod";
import type { ProviderHealth } from "./providers.js";

export const wakeWordStateSchema = z.enum([
  "disabled",
  "starting",
  "listening",
  "detected",
  "unavailable",
  "error",
]);
export type WakeWordState = z.infer<typeof wakeWordStateSchema>;

export interface WakeWordDetection {
  phrase: string;
  score: number;
  detectedAt: string;
}

export interface WakeWordProvider {
  health(): Promise<ProviderHealth>;
  state(): WakeWordState;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(
    listener: (state: WakeWordState, detection?: WakeWordDetection) => void,
  ): () => void;
}

export const wakeWordControlSchema = z.strictObject({
  enabled: z.boolean(),
});

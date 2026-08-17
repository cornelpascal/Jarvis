import { z } from "zod";

export const screenshotRequestSchema = z.strictObject({
  requestId: z.uuid(),
  mode: z.enum(["active_window", "primary_display"]),
});
export type ScreenshotRequest = z.infer<typeof screenshotRequestSchema>;

export const screenshotResultSchema = z.strictObject({
  contextId: z.uuid(),
  requestId: z.uuid(),
  mode: z.enum(["active_window", "primary_display"]),
  mimeType: z.literal("image/png"),
  imageBase64: z
    .string()
    .min(1)
    .max(16 * 1024 * 1024),
  byteLength: z
    .int()
    .positive()
    .max(10 * 1024 * 1024),
  width: z.int().positive(),
  height: z.int().positive(),
  activeApplication: z.string().max(500).optional(),
  capturedAt: z.iso.datetime(),
  retention: z.literal("ephemeral"),
});
export type ScreenshotResult = z.infer<typeof screenshotResultSchema>;

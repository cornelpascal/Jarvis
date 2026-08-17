import { z } from "zod";

export const systemActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    requestId: z.uuid(),
    action: z.literal("open_application"),
    application: z.enum(["notepad", "calculator", "explorer", "terminal"]),
  }),
  z.strictObject({
    requestId: z.uuid(),
    action: z.literal("open_url"),
    url: z
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
  }),
  z.strictObject({
    requestId: z.uuid(),
    action: z.literal("open_explorer"),
    path: z.string().min(1).max(2_000),
  }),
  z.strictObject({
    requestId: z.uuid(),
    action: z.literal("reveal_file"),
    path: z.string().min(1).max(2_000),
  }),
  z.strictObject({
    requestId: z.uuid(),
    action: z.literal("open_terminal"),
    path: z.string().min(1).max(2_000),
  }),
  z.strictObject({
    requestId: z.uuid(),
    action: z.literal("get_running_apps"),
  }),
  z.strictObject({
    requestId: z.uuid(),
    action: z.literal("get_system_stats"),
  }),
]);
export type SystemAction = z.infer<typeof systemActionSchema>;

export const systemActionResultSchema = z.strictObject({
  requestId: z.uuid(),
  action: z.string().min(1),
  success: z.boolean(),
  message: z.string().min(1),
  data: z.unknown().optional(),
});
export type SystemActionResult = z.infer<typeof systemActionResultSchema>;

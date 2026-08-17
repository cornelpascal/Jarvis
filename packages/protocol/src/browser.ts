import { z } from "zod";

const browserUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Only HTTP(S) URLs are allowed");

const base = { requestId: z.uuid() } as const;
export const browserActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...base,
    action: z.literal("open_url"),
    url: browserUrlSchema,
  }),
  z.strictObject({
    ...base,
    action: z.literal("new_tab"),
    url: browserUrlSchema,
  }),
  z.strictObject({
    ...base,
    action: z.literal("open_reference"),
    url: browserUrlSchema,
  }),
  z.strictObject({
    ...base,
    action: z.literal("close_tab"),
    tabId: z.string().optional(),
  }),
  z.strictObject({
    ...base,
    action: z.literal("back"),
    tabId: z.string().optional(),
  }),
  z.strictObject({
    ...base,
    action: z.literal("forward"),
    tabId: z.string().optional(),
  }),
  z.strictObject({
    ...base,
    action: z.literal("reload"),
    tabId: z.string().optional(),
  }),
  z.strictObject({
    ...base,
    action: z.literal("scroll"),
    tabId: z.string().optional(),
    deltaY: z.number().min(-5000).max(5000),
  }),
  z.strictObject({
    ...base,
    action: z.literal("find_text"),
    tabId: z.string().optional(),
    text: z.string().min(1).max(500),
  }),
  z.strictObject({
    ...base,
    action: z.literal("click"),
    tabId: z.string().optional(),
    selector: z.string().min(1).max(1000),
  }),
  z.strictObject({
    ...base,
    action: z.literal("extract_page"),
    tabId: z.string().optional(),
  }),
]);
export type BrowserAction = z.infer<typeof browserActionSchema>;

export const browserActionResultSchema = z.strictObject({
  requestId: z.uuid(),
  action: z.string().min(1),
  success: z.boolean(),
  tabId: z.string().min(1).optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  text: z.string().max(100_000).optional(),
  found: z.boolean().optional(),
});
export type BrowserActionResult = z.infer<typeof browserActionResultSchema>;

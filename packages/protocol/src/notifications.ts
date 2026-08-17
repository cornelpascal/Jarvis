import { z } from "zod";

export const notificationSchema = z.strictObject({
  id: z.uuid(),
  eventId: z.uuid(),
  type: z.enum(["task", "deployment", "research", "system"]),
  severity: z.enum(["info", "success", "warning", "error"]),
  title: z.string().min(1).max(200),
  body: z.string().max(1_000).optional(),
  projectId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  readAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListRequestSchema = z.strictObject({
  unreadOnly: z.boolean().default(false),
  limit: z.int().min(1).max(100).default(50),
});

export const notificationReadRequestSchema = z.strictObject({
  notificationId: z.uuid(),
});

export interface NotificationProvider {
  list(input: { unreadOnly: boolean; limit: number }): Notification[];
  markRead(notificationId: string): Promise<Notification | undefined>;
  close(): void;
}

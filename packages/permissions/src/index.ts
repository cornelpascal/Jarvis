import { z } from "zod";

export const riskLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const permissionRequestSchema = z.strictObject({
  id: z.uuid(),
  action: z.string().min(1),
  riskLevel: riskLevelSchema,
  resource: z.string().min(1),
  projectId: z.string().min(1).optional(),
  reason: z.string().min(1),
  requestedAt: z.iso.datetime(),
});
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;

export interface PermissionBroker {
  authorize(
    request: PermissionRequest,
  ): Promise<{ approved: boolean; receiptId?: string; reason?: string }>;
}

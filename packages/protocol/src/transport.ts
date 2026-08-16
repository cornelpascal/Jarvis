import { z } from "zod";

export const PROTOCOL_VERSION = "1.0.0";

export const healthSnapshotSchema = z.strictObject({
  status: z.enum(["ok", "degraded", "unavailable"]),
  service: z.literal("jarvis-core"),
  version: z.string(),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  startedAt: z.iso.datetime(),
  uptimeSeconds: z.number().nonnegative(),
  database: z.enum(["ok", "degraded", "unavailable"]),
  environment: z.enum(["development", "test", "production"]),
});

export type HealthSnapshot = z.infer<typeof healthSnapshotSchema>;

export const capabilityManifestSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  eventSchemaVersion: z.int().positive(),
  capabilities: z.array(z.string()),
  platform: z.string(),
  providers: z.record(
    z.string(),
    z.enum(["available", "degraded", "unavailable"]),
  ),
});

export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;

export const jarvisErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  correlationId: z.string().optional(),
  diagnosticId: z.string().optional(),
});

export type JarvisError = z.infer<typeof jarvisErrorSchema>;

import { z } from "zod";

export const healthCheckSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("none") }),
  z.strictObject({
    type: z.literal("http"),
    url: z.url(),
    timeoutMs: z.int().min(1_000).max(60_000).default(10_000),
  }),
]);

const deploymentBase = {
  version: z.literal(1),
  id: z.string().min(1),
  projectId: z.string().min(1),
  environment: z.string().min(1).max(100),
  preflight: z
    .array(z.enum(["lint", "typecheck", "test", "build"]))
    .default([]),
  healthcheck: healthCheckSchema,
  secretRefs: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default([]),
} as const;

export const deploymentConfigSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...deploymentBase,
    type: z.literal("dry_run"),
    target: z.string().min(1).max(500),
  }),
  z.strictObject({
    ...deploymentBase,
    type: z.literal("docker_compose"),
    workingDirectory: z.string().min(1),
    composeFile: z.string().min(1),
    services: z.array(z.string().min(1)).default([]),
  }),
  z.strictObject({
    ...deploymentBase,
    type: z.literal("powershell"),
    workingDirectory: z.string().min(1),
    scriptPath: z.string().min(1),
    arguments: z.array(z.string().max(500)).default([]),
  }),
  z.strictObject({
    ...deploymentBase,
    type: z.literal("ci_cd"),
    provider: z.enum(["github_actions", "azure_devops"]),
    workflow: z.string().min(1),
  }),
]);
export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>;

export const deploymentPreviewSchema = z.strictObject({
  projectId: z.string().min(1),
  environment: z.string().min(1),
  adapterType: z.string().min(1),
  configDigest: z.string().regex(/^[0-9a-f]{64}$/),
  summary: z.string().min(1),
});
export type DeploymentPreview = z.infer<typeof deploymentPreviewSchema>;

export const deploymentResultSchema = z.strictObject({
  runId: z.uuid(),
  projectId: z.string().min(1),
  environment: z.string().min(1),
  adapterType: z.string().min(1),
  state: z.enum(["COMPLETED", "FAILED"]),
  health: z.enum(["HEALTHY", "UNHEALTHY", "SKIPPED"]),
  summary: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
});
export type DeploymentResult = z.infer<typeof deploymentResultSchema>;

export const deploymentExecuteRequestSchema = z.strictObject({
  projectId: z.string().min(1),
  environment: z.string().min(1).max(100).default("production"),
});

export interface DeploymentManagerProvider {
  save(config: DeploymentConfig): DeploymentConfig;
  get(projectId: string, environment: string): DeploymentConfig | undefined;
  preview(projectId: string, environment: string): DeploymentPreview;
  deploy(
    projectId: string,
    environment: string,
    expectedConfigDigest: string,
  ): Promise<DeploymentResult>;
}

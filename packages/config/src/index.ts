import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export const jarvisConfigSchema = z.strictObject({
  app: z.strictObject({ name: z.string().min(1) }),
  projects: z.strictObject({ roots: z.array(z.string().min(1)).min(1) }),
  voice: z.strictObject({
    enabled: z.boolean(),
    activation: z.literal("hotkey"),
    hotkey: z.string().min(1),
  }),
  wake_word: z.strictObject({
    enabled: z.boolean(),
    engine: z.literal("openwakeword"),
    phrase: z.literal("hey jarvis"),
    threshold: z.number().min(0.1).max(0.95),
    cooldown_ms: z.int().min(1_000).max(60_000),
  }),
  references: z.strictObject({
    mode: z.literal("smart"),
    visual_threshold: z.number().min(0).max(1),
    images: z.boolean(),
    videos: z.boolean(),
    sources: z.boolean(),
    autoplay_video: z.boolean(),
  }),
  codex: z.strictObject({
    max_concurrent_agents: z.int().positive().max(16),
    default_mode: z.string().min(1),
  }),
  git: z.strictObject({
    auto_commit: z.boolean(),
    auto_push: z.literal(false),
  }),
  security: z.strictObject({
    require_push_confirmation: z.literal(true),
    require_deploy_confirmation: z.literal(true),
  }),
  network: z.strictObject({
    bind_host: z.literal("127.0.0.1"),
    port: z.int().min(1024).max(65535),
  }),
});

export type JarvisConfig = z.infer<typeof jarvisConfigSchema>;

export type JarvisEnvironment = "development" | "test" | "production";

export interface RuntimePaths {
  root: string;
  database: string;
  logs: string;
  browserProfiles: string;
  worktrees: string;
}

export function resolveEnvironment(
  value = process.env.NODE_ENV,
): JarvisEnvironment {
  if (value === "test" || value === "production") return value;
  return "development";
}

export function resolveRuntimePaths(
  environment = resolveEnvironment(),
): RuntimePaths {
  const explicit = process.env.JARVIS_DATA_DIR;
  const localAppData =
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const suffix =
    environment === "production" ? "Jarvis" : `Jarvis-${environment}`;
  const root = resolve(explicit ?? join(localAppData, suffix));
  return {
    root,
    database: join(root, "jarvis.sqlite"),
    logs: join(root, "logs"),
    browserProfiles: join(root, "browser"),
    worktrees: join(root, "worktrees"),
  };
}

export function loadConfig(
  path = process.env.JARVIS_CONFIG_PATH ??
    join(projectRoot, "jarvis.config.yaml"),
): JarvisConfig {
  const parsed: unknown = parseYaml(readFileSync(resolve(path), "utf8"));
  const config = jarvisConfigSchema.parse(parsed);
  const port = process.env.JARVIS_PORT
    ? Number(process.env.JARVIS_PORT)
    : config.network.port;
  return jarvisConfigSchema.parse({
    ...config,
    network: { ...config.network, port },
  });
}

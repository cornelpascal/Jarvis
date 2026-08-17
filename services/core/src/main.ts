import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadConfig,
  resolveEnvironment,
  resolveRuntimePaths,
} from "@jarvis/config";
import { openJarvisDatabase } from "@jarvis/database";
import { LocalEventBus } from "@jarvis/event-bus";
import { Logger } from "@jarvis/logging";
import { SqlitePermissionBroker } from "@jarvis/permissions";
import { SqliteMemoryService } from "@jarvis/memory";
import { SqliteNotificationService } from "@jarvis/notifications";
import { SqliteDeploymentManager } from "@jarvis/deployment";
import {
  WindowsScreenshotProvider,
  WindowsSystemControlProvider,
} from "@jarvis/os-abstractions/windows";
import { OpenAiRealtimeGateway, OpenWakeWordProvider } from "@jarvis/voice";
import { OpenAiResearchProvider } from "@jarvis/research";
import { PlaywrightBrowserProvider } from "@jarvis/browser";
import { SqliteProjectRegistry, SqliteProjectSearch } from "@jarvis/projects";
import {
  CodexAppServerProvider,
  BoundedCodingAgentProvider,
  GitWorktreeManager,
  GitTaskManager,
  TaskVerificationService,
} from "@jarvis/codex-manager";
import { createCoreServer } from "./server.js";
import { startTelemetry } from "./telemetry.js";

async function main(): Promise<void> {
  const root = resolve(process.env.JARVIS_RESOURCE_DIR ?? process.cwd());
  let version = process.env.JARVIS_VERSION ?? "0.1.0";
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ) as { version?: string };
    if (manifest.version) version = manifest.version;
  } catch {
    // Packaged sidecars receive JARVIS_VERSION and have no repository manifest.
  }
  const logger = new Logger("core");
  const environment = resolveEnvironment();
  const config = loadConfig();
  const paths = resolveRuntimePaths(environment);
  const database = openJarvisDatabase(paths.database);
  const bus = new LocalEventBus({
    initialSequence: database.latestEventSequence() + 1,
  });
  const sessionToken =
    process.env.JARVIS_SESSION_TOKEN ?? randomBytes(32).toString("base64url");
  const voiceGateway = new OpenAiRealtimeGateway({
    ...(process.env.OPENAI_API_KEY
      ? { apiKey: process.env.OPENAI_API_KEY }
      : {}),
  });
  const wakeWordProvider = new OpenWakeWordProvider({
    scriptPath: resolve(root, "services/voice/python/openwakeword_sidecar.py"),
    phrase: config.wake_word.phrase,
    threshold: config.wake_word.threshold,
    cooldownMs: config.wake_word.cooldown_ms,
    pythonExecutable: resolve(root, ".tooling/wake-word/Scripts/python.exe"),
  });
  const researchProvider = new OpenAiResearchProvider({
    ...(process.env.OPENAI_API_KEY
      ? { apiKey: process.env.OPENAI_API_KEY }
      : {}),
  });
  const browserProvider = new PlaywrightBrowserProvider({
    profileDirectory: paths.browserProfiles,
    channel: "msedge",
  });
  const projectRegistry = new SqliteProjectRegistry({
    roots: config.projects.roots,
    database,
    bus,
  });
  const projectSearch = new SqliteProjectSearch(database, bus);
  const rawCodingAgentProvider = new CodexAppServerProvider({
    database,
    clientVersion: version,
  });
  const codingAgentProvider = new BoundedCodingAgentProvider(
    rawCodingAgentProvider,
    config.codex.max_concurrent_agents,
  );
  const worktreeManager = new GitWorktreeManager({
    database,
    worktreesRoot: paths.worktrees,
  });
  const taskVerification = new TaskVerificationService({ database, bus });
  const gitTaskManager = new GitTaskManager(database);
  const permissionBroker = new SqlitePermissionBroker({ database, bus });
  const deploymentManager = new SqliteDeploymentManager({ database, bus });
  const systemControlProvider = new WindowsSystemControlProvider();
  const screenshotProvider = new WindowsScreenshotProvider({
    root: resolve(paths.root, "screenshots"),
  });
  const memoryProvider = new SqliteMemoryService({ database, bus });
  const notificationProvider = new SqliteNotificationService({ database, bus });
  const server = createCoreServer({
    config,
    environment,
    database,
    bus,
    sessionToken,
    version,
    voiceGateway,
    researchProvider,
    browserProvider,
    projectRegistry,
    projectSearch,
    codingAgentProvider,
    worktreeManager,
    taskVerification,
    permissionBroker,
    gitTaskManager,
    deploymentManager,
    systemControlProvider,
    screenshotProvider,
    memoryProvider,
    notificationProvider,
    wakeWordProvider,
  });

  await server.start();
  const unsubscribeWakeWord = wakeWordProvider.subscribe((state, detection) => {
    void bus.publish(
      bus.create("voice.wake_word.state", "voice.wake-word", {
        state,
        ...(detection
          ? { phrase: detection.phrase, score: detection.score }
          : {}),
      }),
      { durable: false },
    );
    if (state === "detected" && detection)
      void bus.publish(
        bus.create("voice.activation.requested", "voice.wake-word", {
          source: "wake_word",
          phrase: detection.phrase,
        }),
      );
  });
  if (config.wake_word.enabled)
    await wakeWordProvider.start().catch(() => undefined);
  await projectRegistry.initialize();
  await bus.publish(
    bus.create("jarvis.ready", "core", { healthUrl: `${server.url}/health` }),
  );
  await bus.publish(
    bus.create("jarvis.state.changed", "core", { state: "IDLE" }),
  );
  const stopTelemetry = startTelemetry(
    bus,
    paths.root,
    2_000,
    Boolean(process.env.OPENAI_API_KEY?.trim()),
  );
  await bus.publish(
    bus.create("system.health", "core", {
      status: "ok",
      database: "ok",
      uptimeSeconds: 0,
    }),
  );

  let stopping = false;
  let parentWatch: NodeJS.Timeout | undefined;
  async function stop(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    logger.log("info", "shutdown.requested", { signal });
    if (parentWatch) clearInterval(parentWatch);
    stopTelemetry();
    unsubscribeWakeWord();
    await server.stop();
    database.close();
    process.exitCode = 0;
  }
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
  const parentPid = Number(process.env.JARVIS_PARENT_PID);
  if (Number.isSafeInteger(parentPid) && parentPid > 0) {
    parentWatch = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        void stop("PARENT_EXIT");
      }
    }, 1_000);
    parentWatch.unref();
  }
}

void main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`JARVIS Core failed to start: ${detail}\n`);
  process.exitCode = 1;
});

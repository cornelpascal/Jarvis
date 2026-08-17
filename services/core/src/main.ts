import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  resolveEnvironment,
  resolveRuntimePaths,
} from "@jarvis/config";
import { openJarvisDatabase } from "@jarvis/database";
import { LocalEventBus } from "@jarvis/event-bus";
import { Logger } from "@jarvis/logging";
import { SqlitePermissionBroker } from "@jarvis/permissions";
import { SqliteDeploymentManager } from "@jarvis/deployment";
import { WindowsSystemControlProvider } from "@jarvis/os-abstractions/windows";
import { OpenAiRealtimeGateway } from "@jarvis/voice";
import { OpenAiResearchProvider } from "@jarvis/research";
import { PlaywrightBrowserProvider } from "@jarvis/browser";
import { SqliteProjectRegistry, SqliteProjectSearch } from "@jarvis/projects";
import {
  CodexAppServerProvider,
  GitWorktreeManager,
  GitTaskManager,
  TaskVerificationService,
} from "@jarvis/codex-manager";
import { createCoreServer } from "./server.js";
import { startTelemetry } from "./telemetry.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as { version: string };
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
  ...(process.env.OPENAI_API_KEY ? { apiKey: process.env.OPENAI_API_KEY } : {}),
});
const researchProvider = new OpenAiResearchProvider({
  ...(process.env.OPENAI_API_KEY ? { apiKey: process.env.OPENAI_API_KEY } : {}),
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
const codingAgentProvider = new CodexAppServerProvider({
  database,
  clientVersion: manifest.version,
});
const worktreeManager = new GitWorktreeManager({
  database,
  worktreesRoot: paths.worktrees,
});
const taskVerification = new TaskVerificationService({ database, bus });
const gitTaskManager = new GitTaskManager(database);
const permissionBroker = new SqlitePermissionBroker({ database, bus });
const deploymentManager = new SqliteDeploymentManager({ database, bus });
const systemControlProvider = new WindowsSystemControlProvider();
const server = createCoreServer({
  config,
  environment,
  database,
  bus,
  sessionToken,
  version: manifest.version,
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
});

await server.start();
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
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.log("info", "shutdown.requested", { signal });
  stopTelemetry();
  await server.stop();
  database.close();
  process.exitCode = 0;
}
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

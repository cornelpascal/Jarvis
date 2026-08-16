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
import { createCoreServer } from "./server.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as { version: string };
const logger = new Logger("core");
const environment = resolveEnvironment();
const config = loadConfig();
const paths = resolveRuntimePaths(environment);
const database = openJarvisDatabase(paths.database);
const bus = new LocalEventBus();
const sessionToken =
  process.env.JARVIS_SESSION_TOKEN ?? randomBytes(32).toString("base64url");
const server = createCoreServer({
  config,
  environment,
  database,
  bus,
  sessionToken,
  version: manifest.version,
});

await server.start();
await bus.publish(
  bus.create("jarvis.ready", "core", { healthUrl: `${server.url}/health` }),
);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.log("info", "shutdown.requested", { signal });
  await server.stop();
  database.close();
  process.exitCode = 0;
}
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

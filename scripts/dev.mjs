import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const token = randomBytes(32).toString("base64url");
const executable = process.platform === "win32" ? "corepack.cmd" : "corepack";
const environment = {
  ...process.env,
  JARVIS_SESSION_TOKEN: token,
  VITE_JARVIS_SESSION_TOKEN: token,
  VITE_JARVIS_CORE_URL:
    process.env.VITE_JARVIS_CORE_URL ?? "http://127.0.0.1:43117",
};
const processes = [
  spawn(executable, ["pnpm", "--filter", "@jarvis/core", "dev"], {
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32",
  }),
  spawn(executable, ["pnpm", "--filter", "@jarvis/dashboard", "dev"], {
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32",
  }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of processes) {
  child.once("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping && (code !== 0 || signal)) stop(code ?? 1);
  });
}
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());

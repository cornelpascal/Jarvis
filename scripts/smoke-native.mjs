import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const executable = resolve(
  "apps/dashboard/src-tauri/target/debug/jarvis-dashboard.exe",
);
await access(executable);
const dataDirectory = resolve(".jarvis-test", "native-smoke");
await mkdir(dataDirectory, { recursive: true });
const core = spawn(process.execPath, ["services/core/dist/main.js"], {
  env: {
    ...process.env,
    JARVIS_SESSION_TOKEN: "development-only-token",
    JARVIS_DATA_DIR: dataDirectory,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
const dashboard = spawn(executable, [], {
  stdio: "ignore",
  windowsHide: true,
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:43117/health");
      if (response.ok) return;
    } catch {
      // Core is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error("Native smoke core failed to start");
}

try {
  await waitForHealth();
  await new Promise((resolveWait) => setTimeout(resolveWait, 3_000));
  if (dashboard.exitCode !== null) {
    throw new Error(
      `Native dashboard exited early with ${String(dashboard.exitCode)}`,
    );
  }
  console.log(JSON.stringify({ nativeDashboard: "running", core: "healthy" }));
} finally {
  dashboard.kill();
  core.kill("SIGTERM");
}

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const executable = resolve(
  "apps/dashboard/src-tauri/binaries/jarvis-core-x86_64-pc-windows-msvc.exe",
);
await access(executable);
const dataDirectory = resolve(".jarvis-test", "sidecar-smoke");
await mkdir(dataDirectory, { recursive: true });
const port = 43119;
const core = spawn(executable, [], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    JARVIS_CONFIG_PATH: resolve("jarvis.config.yaml"),
    JARVIS_DATA_DIR: dataDirectory,
    JARVIS_PORT: String(port),
    JARVIS_PARENT_PID: String(process.pid),
    JARVIS_RESOURCE_DIR: process.cwd(),
    JARVIS_SESSION_TOKEN: randomBytes(32).toString("base64url"),
    JARVIS_VERSION: "0.1.0-sidecar-smoke",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stderr = "";
core.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (core.exitCode !== null)
      throw new Error(
        `Core sidecar exited with ${String(core.exitCode)}: ${stderr}`,
      );
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/health`);
      if (response.ok) return response.json();
    } catch {
      // The sidecar is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Core sidecar failed to become healthy: ${stderr}`);
}

try {
  const health = await waitForHealth();
  console.log(JSON.stringify({ sidecar: "healthy", health }));
} finally {
  core.kill("SIGTERM");
}

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const profile = process.argv.includes("--release") ? "release" : "debug";
const executable = resolve(
  `apps/dashboard/src-tauri/target/${profile}/jarvis-dashboard.exe`,
);
await access(executable);

try {
  const existing = await fetch("http://127.0.0.1:43117/health");
  if (existing.ok)
    throw new Error("Port 43117 is already occupied by a running JARVIS Core");
} catch (error) {
  if (error instanceof Error && error.message.includes("already occupied"))
    throw error;
}

const dashboard = spawn(executable, [], {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let stderr = "";
dashboard.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

async function waitForHealth(expectedHealthy) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:43117/health");
      if (response.ok === expectedHealthy) return;
    } catch {
      if (!expectedHealthy) return;
    }
    if (expectedHealthy && dashboard.exitCode !== null)
      throw new Error(
        `Native dashboard exited with ${String(dashboard.exitCode)}: ${stderr}`,
      );
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(
    expectedHealthy
      ? `Packaged core failed to start: ${stderr}`
      : "Packaged core remained alive after its desktop owner exited",
  );
}

try {
  await waitForHealth(true);
  await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  if (dashboard.exitCode !== null)
    throw new Error(
      `Native dashboard exited early with ${String(dashboard.exitCode)}: ${stderr}`,
    );
  console.log(
    JSON.stringify({
      profile,
      nativeDashboard: "running",
      packagedCore: "healthy",
    }),
  );
} finally {
  dashboard.kill();
  await waitForHealth(false);
}

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import WebSocket from "ws";

const token = "phase0-smoke-token";
const dataDirectory = resolve(".jarvis-test", "phase0-smoke");
await mkdir(dataDirectory, { recursive: true });
const child = spawn(process.execPath, ["services/core/dist/main.js"], {
  env: {
    ...process.env,
    JARVIS_SESSION_TOKEN: token,
    JARVIS_DATA_DIR: dataDirectory,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:43117/health");
      if (response.ok) return response.json();
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error("Core did not become healthy");
}

async function checkWebSocket() {
  const encoded = Buffer.from(token, "utf8").toString("base64url");
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(
      "ws://127.0.0.1:43117/events",
      ["jarvis.auth.v1", `jarvis.token.${encoded}`],
      { origin: "http://127.0.0.1:1420" },
    );
    const timeout = setTimeout(
      () => rejectSocket(new Error("WebSocket smoke test timed out")),
      3_000,
    );
    socket.once("open", () => {
      clearTimeout(timeout);
      const protocol = socket.protocol;
      socket.close();
      resolveSocket(protocol);
    });
    socket.once("error", rejectSocket);
  });
}

try {
  const health = await waitForHealth();
  const protocol = await checkWebSocket();
  console.log(JSON.stringify({ health, websocket: protocol }, null, 2));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolveExit) => child.once("exit", resolveExit));
}

import WebSocket from "ws";

const rawToken = process.env.JARVIS_SESSION_TOKEN;
if (!rawToken) throw new Error("JARVIS_SESSION_TOKEN is required");
const token = Buffer.from(rawToken, "utf8").toString("base64url");
const socket = new WebSocket(
  "ws://127.0.0.1:43117/events",
  ["jarvis.auth.v1", `jarvis.token.${token}`],
  { origin: "http://127.0.0.1:1420" },
);
const timeout = setTimeout(() => {
  console.error("WebSocket smoke test timed out");
  process.exit(1);
}, 3_000);
socket.once("open", () => {
  clearTimeout(timeout);
  console.log(`websocket=${socket.protocol}`);
  socket.close();
});
socket.once("error", (error) => {
  clearTimeout(timeout);
  console.error(error);
  process.exit(1);
});

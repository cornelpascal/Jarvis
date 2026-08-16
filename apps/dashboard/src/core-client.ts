import {
  healthSnapshotSchema,
  jarvisEventSchema,
  type HealthSnapshot,
  type JarvisEvent,
} from "@jarvis/protocol";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export interface CoreClientHandlers {
  onConnection(state: ConnectionState): void;
  onEvent(event: JarvisEvent): void;
  onHealth(health: HealthSnapshot): void;
}

const endpoint =
  import.meta.env.VITE_JARVIS_CORE_URL ?? "http://127.0.0.1:43117";
const sessionToken =
  import.meta.env.VITE_JARVIS_SESSION_TOKEN ?? "development-only-token";

export async function connectCore(
  handlers: CoreClientHandlers,
): Promise<() => void> {
  handlers.onConnection("connecting");
  const response = await fetch(`${endpoint}/health`, { cache: "no-store" });
  if (!response.ok)
    throw new Error(`Core health check failed: ${String(response.status)}`);
  handlers.onHealth(healthSnapshotSchema.parse(await response.json()));
  const websocketUrl = endpoint.replace(/^http/, "ws") + "/events";
  const encodedToken = btoa(sessionToken)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const socket = new WebSocket(websocketUrl, [
    "jarvis.auth.v1",
    `jarvis.token.${encodedToken}`,
  ]);
  socket.addEventListener("open", () => handlers.onConnection("connected"));
  socket.addEventListener("close", () => handlers.onConnection("disconnected"));
  socket.addEventListener("message", (message) =>
    handlers.onEvent(
      jarvisEventSchema.parse(JSON.parse(String(message.data))) as JarvisEvent,
    ),
  );
  return () => socket.close(1000, "Dashboard unmounted");
}

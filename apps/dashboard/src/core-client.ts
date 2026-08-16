import {
  DEFAULT_REPLAY_LIMIT,
  EVENT_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  eventStreamServerMessageSchema,
  healthSnapshotSchema,
  parseJarvisEvent,
  type HealthSnapshot,
  type KnownJarvisEvent,
} from "@jarvis/protocol";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export interface CoreClientHandlers {
  onConnection(state: ConnectionState): void;
  onEvent(event: KnownJarvisEvent, replayed: boolean): void;
  onHealth(health: HealthSnapshot): void;
  onError?(error: Error): void;
}

const endpoint =
  import.meta.env.VITE_JARVIS_CORE_URL ?? "http://127.0.0.1:43117";
const sessionToken =
  import.meta.env.VITE_JARVIS_SESSION_TOKEN ?? "development-only-token";

export function connectCore(handlers: CoreClientHandlers): () => void {
  let stopped = false;
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let retry = 0;
  let lastSequence = -1;

  const reconnect = (): void => {
    if (stopped || reconnectTimer) return;
    handlers.onConnection("disconnected");
    const delay = Math.min(5_000, 250 * 2 ** retry++);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void open();
    }, delay);
  };

  const open = async (): Promise<void> => {
    if (stopped) return;
    handlers.onConnection("connecting");
    try {
      const response = await fetch(`${endpoint}/health`, { cache: "no-store" });
      if (!response.ok)
        throw new Error(`Core health check failed: ${String(response.status)}`);
      handlers.onHealth(healthSnapshotSchema.parse(await response.json()));
      const websocketUrl = endpoint.replace(/^http/, "ws") + "/events";
      const encodedToken = btoa(sessionToken)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
      socket = new WebSocket(websocketUrl, [
        "jarvis.auth.v1",
        `jarvis.token.${encodedToken}`,
      ]);
      socket.addEventListener("message", (message) => {
        try {
          const envelope = eventStreamServerMessageSchema.parse(
            JSON.parse(String(message.data)) as unknown,
          );
          if (envelope.kind === "hello") {
            socket?.send(
              JSON.stringify({
                kind: "subscribe",
                protocolVersion: PROTOCOL_VERSION,
                eventSchemaVersion: EVENT_SCHEMA_VERSION,
                afterSequence: lastSequence,
                replayLimit: DEFAULT_REPLAY_LIMIT,
              }),
            );
          } else if (envelope.kind === "event") {
            const event = parseJarvisEvent(envelope.event);
            if (event.sequence > lastSequence) {
              lastSequence = event.sequence;
              handlers.onEvent(event, envelope.replayed);
            }
          } else if (envelope.kind === "replay_complete") {
            retry = 0;
            handlers.onConnection("connected");
            if (envelope.truncated)
              socket?.close(1000, "Continue bounded replay");
          } else {
            throw new Error(`${envelope.code}: ${envelope.message}`);
          }
        } catch (cause) {
          handlers.onError?.(
            cause instanceof Error
              ? cause
              : new Error("Malformed core event message"),
          );
          socket?.close(1008, "Malformed core message");
        }
      });
      socket.addEventListener("close", reconnect, { once: true });
      socket.addEventListener("error", () => {
        handlers.onError?.(new Error("JARVIS Core event connection failed"));
      });
    } catch (cause) {
      handlers.onError?.(
        cause instanceof Error
          ? cause
          : new Error("Unable to connect to JARVIS Core"),
      );
      reconnect();
    }
  };

  void open();
  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close(1000, "Dashboard unmounted");
  };
}

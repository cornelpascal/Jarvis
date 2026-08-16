import { useEffect, useState } from "react";
import type { HealthSnapshot, JarvisEvent } from "@jarvis/protocol";
import { connectCore, type ConnectionState } from "./core-client";
import "./styles.css";

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [health, setHealth] = useState<HealthSnapshot>();
  const [events, setEvents] = useState<JarvisEvent[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let active = true;
    void connectCore({
      onConnection: setConnection,
      onHealth: setHealth,
      onEvent: (event) =>
        setEvents((current) => [event, ...current].slice(0, 20)),
    })
      .then((stop) => {
        if (active) cleanup = stop;
        else stop();
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setConnection("disconnected");
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to connect to JARVIS Core",
        );
      });
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  return (
    <main className="shell">
      <header className="topbar">
        <span className="eyebrow">JARVIS // OPERATING LAYER</span>
        <span className={`connection ${connection}`}>
          {connection.toUpperCase()}
        </span>
      </header>
      <section className="viewport">
        <aside className="panel">
          <h2>CORE SERVICES</h2>
          <dl>
            <div>
              <dt>CORE</dt>
              <dd>{health?.status.toUpperCase() ?? "CONNECTING"}</dd>
            </div>
            <div>
              <dt>DATABASE</dt>
              <dd>{health?.database.toUpperCase() ?? "—"}</dd>
            </div>
            <div>
              <dt>PROTOCOL</dt>
              <dd>{health?.protocolVersion ?? "—"}</dd>
            </div>
            <div>
              <dt>PLATFORM</dt>
              <dd>WINDOWS</dd>
            </div>
          </dl>
        </aside>
        <section className="core-stage" aria-label="JARVIS core status">
          <div className={`orb ${connection}`}>
            <div className="orb-ring ring-one" />
            <div className="orb-ring ring-two" />
            <div className="orb-center">J</div>
          </div>
          <p className="core-label">
            {connection === "connected" ? "CORE ONLINE" : "CORE LINK"}
          </p>
          <p className="core-detail">{error ?? "Phase 0 systems nominal"}</p>
        </section>
        <aside className="panel event-panel">
          <h2>EVENT LINK</h2>
          {events.length === 0 ? (
            <p className="empty">Awaiting core events</p>
          ) : (
            events.map((event) => (
              <article key={event.id}>
                <strong>{event.type}</strong>
                <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
              </article>
            ))
          )}
        </aside>
      </section>
      <footer>
        <span>LOCALHOST SECURE CHANNEL</span>
        <span>BUILD 0.1.0</span>
        <span>ALT + SPACE // RESERVED</span>
      </footer>
    </main>
  );
}

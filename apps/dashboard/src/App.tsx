import { useEffect, useState } from "react";
import type { HealthSnapshot, KnownJarvisEvent } from "@jarvis/protocol";
import { connectCore, type ConnectionState } from "./core-client";
import "./styles.css";

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [health, setHealth] = useState<HealthSnapshot>();
  const [events, setEvents] = useState<
    Array<{ event: KnownJarvisEvent; replayed: boolean }>
  >([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const cleanup = connectCore({
      onConnection: setConnection,
      onHealth: setHealth,
      onEvent: (event, replayed) =>
        setEvents((current) => [{ event, replayed }, ...current].slice(0, 50)),
      onError: (cause) => setError(cause.message),
    });
    return cleanup;
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
          <p className="core-detail">
            {error ?? "Replayable event channel nominal"}
          </p>
        </section>
        <aside className="panel event-panel">
          <h2>EVENT LINK</h2>
          {events.length === 0 ? (
            <p className="empty">Awaiting core events</p>
          ) : (
            events.map(({ event, replayed }) => (
              <article key={event.id} title={JSON.stringify(event.payload)}>
                <strong>
                  <span>#{event.sequence}</span> {event.type}
                </strong>
                <time>
                  {replayed ? "REPLAY · " : ""}
                  {new Date(event.timestamp).toLocaleTimeString()}
                </time>
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

import { useEffect, useReducer, useState } from "react";
import type { HealthSnapshot, KnownJarvisEvent } from "@jarvis/protocol";
import { connectCore, type ConnectionState } from "./core-client";
import { initialHudState, reduceHudEvent } from "./hud-state";
import "./styles.css";

function percent(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toFixed(0)}%`;
}

function ratio(used: number | undefined, total: number | undefined): string {
  return used === undefined || total === undefined
    ? "—"
    : percent((used / total) * 100);
}

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [health, setHealth] = useState<HealthSnapshot>();
  const [hud, dispatch] = useReducer(reduceHudEvent, initialHudState);
  const [events, setEvents] = useState<
    Array<{ event: KnownJarvisEvent; replayed: boolean }>
  >([]);
  const [error, setError] = useState<string>();
  const [showInspector, setShowInspector] = useState(false);

  useEffect(() => {
    const cleanup = connectCore({
      onConnection: setConnection,
      onHealth: setHealth,
      onEvent: (event, replayed) => {
        dispatch(event);
        setEvents((current) => [{ event, replayed }, ...current].slice(0, 100));
      },
      onError: (cause) => setError(cause.message),
    });
    return cleanup;
  }, []);

  const projects = Object.values(hud.projects);
  const agents = Object.values(hud.agents);
  const activeMode =
    connection === "connected"
      ? hud.mode
      : connection === "connecting"
        ? "THINKING"
        : "ERROR";

  return (
    <main className="shell" data-mode={activeMode.toLowerCase()}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">J</span>
          <span>
            <b>JARVIS</b>
            <small>DESKTOP INTELLIGENCE LAYER</small>
          </span>
        </div>
        <div className="top-status">
          <span>MODE // {activeMode}</span>
          <span className={`connection ${connection}`}>
            {connection.toUpperCase()}
          </span>
        </div>
      </header>

      <section className="viewport">
        <aside className="rail left-rail">
          <section className="panel projects-panel">
            <div className="panel-heading">
              <h2>PROJECTS</h2>
              <span>{String(projects.length).padStart(2, "0")}</span>
            </div>
            <div className="panel-content">
              {projects.length === 0 ? (
                <p className="empty">No projects registered</p>
              ) : (
                projects.map((project) => (
                  <article
                    className={`project ${hud.selectedProjectId === project.projectId ? "selected" : ""}`}
                    key={project.projectId}
                  >
                    <i />
                    <div>
                      <strong>{project.name}</strong>
                      <small>
                        {project.enabled ? "AVAILABLE" : "DISABLED"}
                      </small>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
          <section className="panel agents-panel">
            <div className="panel-heading">
              <h2>ACTIVE AGENTS</h2>
              <span>{String(agents.length).padStart(2, "0")}</span>
            </div>
            <div className="panel-content">
              {agents.length === 0 ? (
                <p className="empty">No coding agents active</p>
              ) : (
                agents.map((agent) => (
                  <article className="agent" key={agent.agentRunId}>
                    <div className="agent-id">{agent.label}</div>
                    <strong>{agent.title}</strong>
                    <small>{agent.state}</small>
                  </article>
                ))
              )}
            </div>
          </section>
        </aside>

        <section
          className="core-stage"
          aria-label={`JARVIS status: ${activeMode}`}
        >
          <div className="reticle reticle-outer" />
          <div className="reticle reticle-mid" />
          <div className={`orb mode-${activeMode.toLowerCase()}`}>
            <div className="orb-ring ring-one" />
            <div className="orb-ring ring-two" />
            <div className="orb-ring ring-three" />
            <div className="orb-center">
              <span>J</span>
            </div>
          </div>
          <div className="mode-readout">
            <small>CURRENT STATE</small>
            <strong>{activeMode}</strong>
          </div>
          <p className="core-detail">
            {error ?? hud.modeReason ?? "All core systems responsive"}
          </p>
          <div className="activity-strip">
            {hud.activity.slice(0, 3).map((activity) => (
              <span key={activity}>{activity}</span>
            ))}
          </div>
        </section>

        <aside className="rail right-rail">
          <section className="panel conversation-panel">
            <div className="panel-heading">
              <h2>CONVERSATION</h2>
              <span>LIVE</span>
            </div>
            <div className="conversation-list">
              {hud.messages.length === 0 ? (
                <div className="conversation-empty">
                  <span>VOICE CHANNEL STANDBY</span>
                  <p>Press Alt + Space when voice activation is available.</p>
                </div>
              ) : (
                hud.messages.map((message) => (
                  <article
                    className={`message ${message.role}`}
                    key={message.messageId}
                  >
                    <small>
                      {message.role === "assistant"
                        ? "JARVIS"
                        : message.role.toUpperCase()}
                    </small>
                    <p>{message.content}</p>
                  </article>
                ))
              )}
            </div>
            {hud.approval ? (
              <div className="approval-card">
                <small>LEVEL {hud.approval.riskLevel} APPROVAL</small>
                <strong>{hud.approval.action}</strong>
                <p>{hud.approval.reason}</p>
              </div>
            ) : null}
          </section>
          <section className="panel context-panel">
            <div className="panel-heading">
              <h2>CURRENT CONTEXT</h2>
            </div>
            <dl>
              <div>
                <dt>PROJECT</dt>
                <dd>{hud.selectedProjectId ?? "NONE"}</dd>
              </div>
              <div>
                <dt>AGENTS</dt>
                <dd>{agents.length}</dd>
              </div>
              <div>
                <dt>EVENTS</dt>
                <dd>{events.length}</dd>
              </div>
              <div>
                <dt>UPTIME</dt>
                <dd>
                  {health
                    ? `${String(Math.floor(health.uptimeSeconds))}S`
                    : "—"}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </section>

      <footer className="telemetry-bar">
        <Telemetry label="CPU" value={percent(hud.telemetry?.cpuPercent)} />
        <Telemetry
          label="RAM"
          value={ratio(
            hud.telemetry?.ramUsedBytes,
            hud.telemetry?.ramTotalBytes,
          )}
        />
        <Telemetry
          label="DISK"
          value={ratio(
            hud.telemetry?.diskUsedBytes,
            hud.telemetry?.diskTotalBytes,
          )}
        />
        <Telemetry
          label="NETWORK"
          value={hud.telemetry?.network.toUpperCase() ?? "—"}
        />
        <Telemetry
          label="MIC"
          value={hud.telemetry?.microphone.toUpperCase() ?? "—"}
        />
        <Telemetry
          label="VOICE"
          value={hud.telemetry?.voice.toUpperCase() ?? "—"}
        />
        <Telemetry
          label="CORE"
          value={hud.telemetry?.core.toUpperCase() ?? connection.toUpperCase()}
        />
        <Telemetry
          label="CODEX"
          value={String(hud.telemetry?.codexAgents ?? 0)}
        />
        <button
          className="inspector-toggle"
          onClick={() => setShowInspector((shown) => !shown)}
          type="button"
        >
          EVENTS
        </button>
      </footer>

      {showInspector ? (
        <aside
          className="event-inspector"
          aria-label="Developer event inspector"
        >
          <div className="panel-heading">
            <h2>DEVELOPER EVENT INSPECTOR</h2>
            <button onClick={() => setShowInspector(false)} type="button">
              CLOSE
            </button>
          </div>
          <div className="event-list">
            {events.map(({ event, replayed }) => (
              <article key={event.id}>
                <span>#{event.sequence}</span>
                <strong>{event.type}</strong>
                <code>{event.source}</code>
                <time>{replayed ? "REPLAY" : "LIVE"}</time>
              </article>
            ))}
          </div>
        </aside>
      ) : null}
    </main>
  );
}

function Telemetry({ label, value }: { label: string; value: string }) {
  return (
    <div className="telemetry">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

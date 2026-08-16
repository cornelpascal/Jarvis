import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type {
  HealthSnapshot,
  KnownJarvisEvent,
  VoiceRuntimeState,
} from "@jarvis/protocol";
import { connectCore, type ConnectionState } from "./core-client";
import { DisplaySettings } from "./DisplaySettings";
import {
  createDisplayProvider,
  loadDisplayPlacement,
  resolvePlacement,
  saveDisplayPlacement,
} from "./display-provider";
import { initialHudState, reduceHudEvent } from "./hud-state";
import {
  createHotkeyProvider,
  revealAndFocusDashboard,
} from "./hotkey-provider";
import { OpenAiWebRtcVoiceProvider } from "./voice-provider";
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
  const [showDisplays, setShowDisplays] = useState(false);
  const [displayCount, setDisplayCount] = useState(0);
  const voice = useMemo(() => new OpenAiWebRtcVoiceProvider(), []);
  const [voiceState, setVoiceState] = useState<VoiceRuntimeState>(
    voice.state(),
  );

  const activateVoice = useCallback(async (): Promise<void> => {
    try {
      await revealAndFocusDashboard();
      await voice.activate();
      setError(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Voice activation failed",
      );
    }
  }, [voice]);

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

  useEffect(() => {
    const unsubscribe = voice.subscribe((state, message) => {
      setVoiceState(state);
      if (state === "error" || state === "unavailable") setError(message);
    });
    return () => {
      unsubscribe();
      void voice.disconnect();
    };
  }, [voice]);

  useEffect(() => {
    let provider: Awaited<ReturnType<typeof createHotkeyProvider>> | undefined;
    let disposed = false;
    void createHotkeyProvider()
      .then(async (created) => {
        provider = created;
        if (disposed) return;
        await created.register("Alt+Space", () => void activateVoice());
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? `Alt+Space unavailable: ${cause.message}`
            : "Alt+Space unavailable",
        );
      });
    return () => {
      disposed = true;
      void provider?.unregister("Alt+Space");
    };
  }, [activateVoice]);

  useEffect(() => {
    const provider = createDisplayProvider();
    const refresh = async (): Promise<void> => {
      try {
        const monitors = await provider.listMonitors();
        setDisplayCount(monitors.length);
        const saved = loadDisplayPlacement();
        const resolved = resolvePlacement(monitors, saved);
        if (
          resolved &&
          (resolved.dashboardMonitorId !== saved.dashboardMonitorId ||
            resolved.referenceMonitorId !== saved.referenceMonitorId)
        ) {
          saveDisplayPlacement(resolved);
          await provider.placeDashboard(resolved.dashboardMonitorId);
          await provider.reconcilePlacement(resolved);
        }
      } catch {
        setDisplayCount(0);
      }
    };
    void refresh();
    const poll = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(poll);
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
                  <span>VOICE // {voiceState.toUpperCase()}</span>
                  <p>Press Alt + Space to reveal JARVIS and activate voice.</p>
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
                <dt>DISPLAYS</dt>
                <dd>{displayCount || "—"}</dd>
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
        <div className="footer-actions">
          <button
            className={voiceState === "idle" ? "" : "active"}
            onClick={() => void activateVoice()}
            type="button"
          >
            {voiceState === "idle" || voiceState === "unavailable"
              ? "VOICE"
              : voiceState.toUpperCase()}
          </button>
          {voiceState !== "idle" && voiceState !== "unavailable" ? (
            <>
              <button
                onClick={() => void voice.setMuted(voiceState !== "muted")}
                type="button"
              >
                {voiceState === "muted" ? "UNMUTE" : "MUTE"}
              </button>
              <button onClick={() => void voice.disconnect()} type="button">
                END VOICE
              </button>
            </>
          ) : null}
          <button onClick={() => setShowDisplays(true)} type="button">
            DISPLAYS
          </button>
          <button
            onClick={() => setShowInspector((shown) => !shown)}
            type="button"
          >
            EVENTS
          </button>
        </div>
      </footer>

      {showDisplays ? (
        <DisplaySettings onClose={() => setShowDisplays(false)} />
      ) : null}

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

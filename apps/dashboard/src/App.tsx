import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type {
  HealthSnapshot,
  KnownJarvisEvent,
  VoiceRuntimeState,
} from "@jarvis/protocol";
import { routeDecisionSchema } from "@jarvis/protocol";
import { connectCore, type ConnectionState } from "./core-client";
import { coreRequest } from "./core-client";
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
import { MemoryCenter } from "./MemoryCenter";
import { NotificationCenter } from "./NotificationCenter";
import { setStartupEnabled, startupEnabled } from "./startup-provider";
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
  const [showMemories, setShowMemories] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [startsAtLogin, setStartsAtLogin] = useState<boolean>();
  const [displayCount, setDisplayCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resolvingApproval, setResolvingApproval] = useState(false);
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

  const submitText = useCallback(async (): Promise<void> => {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const response = await coreRequest("/commands/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          text,
          ...(hud.selectedProjectId
            ? { activeProjectId: hud.selectedProjectId }
            : {}),
          provenance: { origin: "user", trusted: true },
        }),
      });
      if (!response.ok)
        throw new Error(`Request routing failed (${String(response.status)})`);
      routeDecisionSchema.parse(await response.json());
      setDraft("");
      setError(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Request routing failed",
      );
    } finally {
      setSubmitting(false);
    }
  }, [draft, hud.selectedProjectId, submitting]);

  const resolveApproval = useCallback(
    async (approved: boolean): Promise<void> => {
      if (!hud.approval || resolvingApproval) return;
      const approval = hud.approval;
      setResolvingApproval(true);
      try {
        const response = await coreRequest(
          `/approvals/${encodeURIComponent(approval.approvalId)}/resolve`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ approved }),
          },
        );
        if (!response.ok)
          throw new Error(
            `Approval resolution failed (${String(response.status)})`,
          );
        const resolution = (await response.json()) as {
          receiptId?: string;
        };
        if (
          approved &&
          resolution.receiptId &&
          approval.action === "git.push" &&
          approval.resource.startsWith("task:")
        ) {
          const taskId = approval.resource.slice("task:".length);
          const publish = await coreRequest(
            `/git/tasks/${encodeURIComponent(taskId)}/push`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-jarvis-permission-receipt": resolution.receiptId,
              },
              body: "{}",
            },
          );
          if (!publish.ok)
            throw new Error(`Git push failed (${String(publish.status)})`);
        }
        if (
          approved &&
          resolution.receiptId &&
          approval.action === "deployment.execute" &&
          approval.resource.startsWith("deployment:")
        ) {
          const [, projectId, environment] = approval.resource.split(":");
          if (!projectId || !environment)
            throw new Error("Deployment approval target is malformed");
          const deployment = await coreRequest("/deployment/execute", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-jarvis-permission-receipt": resolution.receiptId,
            },
            body: JSON.stringify({ projectId, environment }),
          });
          if (!deployment.ok)
            throw new Error(`Deployment failed (${String(deployment.status)})`);
        }
        if (
          approved &&
          resolution.receiptId &&
          approval.action === "project.configure" &&
          approval.resource.startsWith("deployment-proposal:")
        ) {
          const proposalId = approval.resource.slice(
            "deployment-proposal:".length,
          );
          const saved = await coreRequest(
            `/deployment/proposals/${encodeURIComponent(proposalId)}/save`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-jarvis-permission-receipt": resolution.receiptId,
              },
              body: "{}",
            },
          );
          if (!saved.ok)
            throw new Error(
              `Deployment proposal save failed (${String(saved.status)})`,
            );
        }
        setError(undefined);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Approval resolution failed",
        );
      } finally {
        setResolvingApproval(false);
      }
    },
    [hud.approval, resolvingApproval],
  );

  const toggleWakeWord = useCallback(async (): Promise<void> => {
    try {
      const response = await coreRequest("/wake-word/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: !["starting", "listening", "detected"].includes(
            hud.wakeWordState,
          ),
        }),
      });
      if (!response.ok)
        throw new Error(`Wake word unavailable (${String(response.status)})`);
      setError(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Wake word unavailable",
      );
    }
  }, [hud.wakeWordState]);

  const toggleStartup = useCallback(async (): Promise<void> => {
    if (startsAtLogin === undefined) return;
    try {
      await setStartupEnabled(!startsAtLogin);
      setStartsAtLogin(!startsAtLogin);
      setError(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Start at login unavailable",
      );
    }
  }, [startsAtLogin]);

  useEffect(() => {
    void startupEnabled()
      .then(setStartsAtLogin)
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? `Start at login unavailable: ${cause.message}`
            : "Start at login unavailable",
        );
      });
  }, []);

  useEffect(() => {
    const cleanup = connectCore({
      onConnection: setConnection,
      onHealth: setHealth,
      onEvent: (event, replayed) => {
        dispatch(event);
        setEvents((current) => [{ event, replayed }, ...current].slice(0, 100));
        if (
          !replayed &&
          event.type === "reference.display.requested" &&
          event.payload.items.length > 0
        ) {
          const provider = createDisplayProvider();
          void provider.listMonitors().then(async (monitors) => {
            const placement = resolvePlacement(
              monitors,
              loadDisplayPlacement(),
            );
            await provider.openReferenceDeck(placement?.referenceMonitorId);
          });
        }
        if (!replayed && event.type === "voice.activation.requested")
          void activateVoice();
      },
      onError: (cause) => setError(cause.message),
    });
    return cleanup;
  }, [activateVoice]);

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
                    {message.citations.length > 0 ? (
                      <div className="message-citations">
                        {message.citations.map((citation) => (
                          <a
                            href={citation.url}
                            key={citation.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {citation.title}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
            {hud.approval ? (
              <div className="approval-card">
                <small>LEVEL {hud.approval.riskLevel} APPROVAL</small>
                <strong>{hud.approval.action}</strong>
                <p>{hud.approval.reason}</p>
                <small>{hud.approval.resource}</small>
                <div className="approval-actions">
                  <button
                    disabled={resolvingApproval}
                    onClick={() => void resolveApproval(false)}
                    type="button"
                  >
                    REJECT
                  </button>
                  <button
                    disabled={resolvingApproval}
                    onClick={() => void resolveApproval(true)}
                    type="button"
                  >
                    APPROVE ONCE
                  </button>
                </div>
              </div>
            ) : null}
            <form
              className="conversation-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void submitText();
              }}
            >
              <input
                aria-label="Message JARVIS"
                disabled={connection !== "connected" || submitting}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="TYPE A REQUEST…"
                value={draft}
              />
              <button disabled={!draft.trim() || submitting} type="submit">
                {submitting ? "ROUTING" : "SEND"}
              </button>
            </form>
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
                <dt>ROUTE</dt>
                <dd>{hud.lastRoute?.route.toUpperCase() ?? "NONE"}</dd>
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
          <button onClick={() => setShowMemories(true)} type="button">
            MEMORY
          </button>
          <button onClick={() => setShowNotifications(true)} type="button">
            NOTICES
          </button>
          <button
            className={startsAtLogin ? "active" : ""}
            disabled={startsAtLogin === undefined}
            onClick={() => void toggleStartup()}
            type="button"
          >
            STARTUP {startsAtLogin ? "ON" : "OFF"}
          </button>
          <button
            className={
              ["starting", "listening", "detected"].includes(hud.wakeWordState)
                ? "active"
                : ""
            }
            onClick={() => void toggleWakeWord()}
            type="button"
          >
            WAKE {hud.wakeWordState.toUpperCase()}
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

      {showMemories ? (
        <MemoryCenter
          {...(hud.selectedProjectId
            ? { projectId: hud.selectedProjectId }
            : {})}
          onClose={() => setShowMemories(false)}
        />
      ) : null}

      {showNotifications ? (
        <NotificationCenter onClose={() => setShowNotifications(false)} />
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

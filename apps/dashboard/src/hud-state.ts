import type { EventPayloadMap, KnownJarvisEvent } from "@jarvis/protocol";

export type JarvisMode = EventPayloadMap["jarvis.state.changed"]["state"];
export type Telemetry = EventPayloadMap["system.telemetry"];
export type ProjectSummary = EventPayloadMap["project.registered"];
export type AgentSummary = EventPayloadMap["codex.agent.progress"];
export type ConversationMessage = EventPayloadMap["conversation.message.added"];
export type ApprovalSummary = EventPayloadMap["approval.requested"];
export type RouteSummary = EventPayloadMap["conversation.route.selected"];

export interface HudState {
  mode: JarvisMode;
  modeReason?: string;
  projects: Record<string, ProjectSummary>;
  selectedProjectId?: string;
  agents: Record<string, AgentSummary>;
  messages: ConversationMessage[];
  approval?: ApprovalSummary | undefined;
  telemetry?: Telemetry;
  activity: string[];
  lastRoute?: RouteSummary;
}

export const initialHudState: HudState = {
  mode: "IDLE",
  projects: {},
  agents: {},
  messages: [],
  activity: [],
};

function appendActivity(state: HudState, message: string): string[] {
  return [message, ...state.activity].slice(0, 8);
}

export function reduceHudEvent(
  state: HudState,
  event: KnownJarvisEvent,
): HudState {
  switch (event.type) {
    case "jarvis.ready":
      return {
        ...state,
        activity: appendActivity(state, "Core link established"),
      };
    case "jarvis.state.changed":
      return {
        ...state,
        mode: event.payload.state,
        ...(event.payload.reason ? { modeReason: event.payload.reason } : {}),
      };
    case "system.health":
      return {
        ...state,
        activity: appendActivity(
          state,
          event.payload.status === "ok"
            ? "System checks passed"
            : `System ${event.payload.status}`,
        ),
      };
    case "system.telemetry":
      return { ...state, telemetry: event.payload };
    case "voice.connected":
      return {
        ...state,
        mode: "LISTENING",
        modeReason: "Realtime voice connected",
        activity: appendActivity(state, "Voice channel connected"),
      };
    case "voice.listening":
      return {
        ...state,
        mode: "LISTENING",
        modeReason: event.payload.muted
          ? "Microphone muted"
          : "Listening for your voice",
      };
    case "voice.user_speaking":
      return { ...state, mode: "USER_SPEAKING", modeReason: "Voice detected" };
    case "voice.processing":
      return { ...state, mode: "THINKING", modeReason: "Processing speech" };
    case "voice.speaking":
      return { ...state, mode: "SPEAKING", modeReason: "JARVIS is speaking" };
    case "voice.interrupted":
      return {
        ...state,
        mode: "LISTENING",
        modeReason: "Response interrupted",
        activity: appendActivity(state, "Voice response interrupted"),
      };
    case "voice.muted.changed":
      return {
        ...state,
        modeReason: event.payload.muted
          ? "Microphone muted"
          : "Microphone active",
      };
    case "voice.disconnected":
      return {
        ...state,
        mode: "IDLE",
        modeReason: event.payload.reason,
        activity: appendActivity(state, "Voice channel disconnected"),
      };
    case "voice.failed":
      return {
        ...state,
        mode: "ERROR",
        modeReason: event.payload.message,
        activity: appendActivity(state, `Voice error: ${event.payload.code}`),
      };
    case "research.started":
      return {
        ...state,
        mode: "SEARCHING",
        modeReason: `Researching: ${event.payload.query}`,
        activity: appendActivity(state, "Research started"),
      };
    case "research.searching":
      return {
        ...state,
        mode: "RESEARCHING",
        modeReason: `Searching with ${event.payload.provider}`,
      };
    case "research.source_found":
      return {
        ...state,
        activity: appendActivity(
          state,
          `Source: ${event.payload.source.title}`,
        ),
      };
    case "research.completed":
      return {
        ...state,
        mode: "IDLE",
        modeReason: `Research complete · ${String(event.payload.sourceCount)} sources`,
        activity: appendActivity(state, "Research complete"),
      };
    case "research.failed":
      return {
        ...state,
        mode: "ERROR",
        modeReason: event.payload.message,
        activity: appendActivity(
          state,
          `Research failed: ${event.payload.code}`,
        ),
      };
    case "reference.evaluating":
      return {
        ...state,
        activity: appendActivity(state, "Evaluating visual references"),
      };
    case "reference.evaluated":
      return {
        ...state,
        activity: appendActivity(
          state,
          event.payload.display
            ? `Visual references recommended (${String(Math.round(event.payload.score * 100))}%)`
            : "Visual references not needed",
        ),
      };
    case "browser.action.started":
      return {
        ...state,
        activity: appendActivity(state, `Browser: ${event.payload.action}`),
      };
    case "browser.action.completed":
      return {
        ...state,
        activity: appendActivity(
          state,
          `Browser completed: ${event.payload.action}`,
        ),
      };
    case "browser.action.failed":
      return {
        ...state,
        mode: "ERROR",
        modeReason: event.payload.message,
        activity: appendActivity(
          state,
          `Browser failed: ${event.payload.code}`,
        ),
      };
    case "conversation.message.added":
      return {
        ...state,
        messages: [...state.messages, event.payload].slice(-100),
      };
    case "conversation.route.selected":
      return {
        ...state,
        lastRoute: event.payload,
        activity: appendActivity(
          state,
          `Routed to ${event.payload.route} (${String(Math.round(event.payload.confidence * 100))}%)`,
        ),
      };
    case "project.registered":
      return {
        ...state,
        projects: {
          ...state.projects,
          [event.payload.projectId]: event.payload,
        },
      };
    case "project.scan.started":
      return {
        ...state,
        activity: appendActivity(state, "Scanning project roots"),
      };
    case "project.discovered":
      return {
        ...state,
        activity: appendActivity(state, `Discovered ${event.payload.name}`),
      };
    case "project.scan.completed":
      return {
        ...state,
        activity: appendActivity(
          state,
          `Project scan complete · ${String(event.payload.discovered)} found`,
        ),
      };
    case "project.scan.failed":
      return {
        ...state,
        mode: "ERROR",
        modeReason: event.payload.message,
        activity: appendActivity(state, "Project scan failed"),
      };
    case "project.updated": {
      const project = state.projects[event.payload.projectId];
      if (!project) return state;
      return {
        ...state,
        projects: {
          ...state.projects,
          [event.payload.projectId]: {
            ...project,
            enabled: event.payload.enabled,
          },
        },
      };
    }
    case "project.removed": {
      const projects = Object.fromEntries(
        Object.entries(state.projects).filter(
          ([projectId]) => projectId !== event.payload.projectId,
        ),
      );
      if (state.selectedProjectId === event.payload.projectId) {
        const { selectedProjectId, ...remaining } = state;
        void selectedProjectId;
        return { ...remaining, projects };
      }
      return { ...state, projects };
    }
    case "project.selected":
      return { ...state, selectedProjectId: event.payload.projectId };
    case "project.indexing":
      return {
        ...state,
        mode: "THINKING",
        modeReason: "Indexing project files",
        activity: appendActivity(state, "Project indexing started"),
      };
    case "project.indexed":
      return {
        ...state,
        mode: "IDLE",
        modeReason: `Indexed ${String(event.payload.files)} files`,
        activity: appendActivity(state, "Project index ready"),
      };
    case "project.search.started":
      return {
        ...state,
        mode: "THINKING",
        modeReason: "Searching project evidence",
      };
    case "project.search.completed":
      return {
        ...state,
        mode: "IDLE",
        modeReason: `Found ${String(event.payload.matchCount)} project matches`,
        activity: appendActivity(state, "Project search complete"),
      };
    case "project.search.failed":
      return {
        ...state,
        mode: "ERROR",
        modeReason: event.payload.message,
        activity: appendActivity(state, "Project search failed"),
      };
    case "codex.agent.progress":
      return {
        ...state,
        agents: { ...state.agents, [event.payload.agentRunId]: event.payload },
        activity: appendActivity(
          state,
          `${event.payload.label}: ${event.payload.state}`,
        ),
      };
    case "codex.task.created":
      return {
        ...state,
        activity: appendActivity(state, `Task queued: ${event.payload.title}`),
      };
    case "codex.agent.started":
      return {
        ...state,
        mode: "CODING",
        modeReason: "Codex agent started",
        activity: appendActivity(state, "Codex thread connected"),
      };
    case "codex.waiting_approval":
      return {
        ...state,
        mode: "WAITING_APPROVAL",
        modeReason: event.payload.method,
      };
    case "codex.diff.ready":
      return {
        ...state,
        activity: appendActivity(state, "Codex diff ready"),
      };
    case "codex.command.started":
      return {
        ...state,
        mode: "TESTING",
        modeReason: `Running ${event.payload.name}`,
        activity: appendActivity(
          state,
          `Verification: ${event.payload.command}`,
        ),
      };
    case "codex.command.completed":
      return {
        ...state,
        activity: appendActivity(
          state,
          `${event.payload.name}: ${event.payload.status}`,
        ),
      };
    case "codex.tests.started":
      return {
        ...state,
        mode: "TESTING",
        modeReason: `Running ${String(event.payload.checkCount)} project checks`,
      };
    case "codex.tests.passed":
      return {
        ...state,
        mode: "IDLE",
        modeReason: "Project checks passed",
        activity: appendActivity(state, "Verification passed"),
      };
    case "codex.tests.failed":
      return {
        ...state,
        mode: "ERROR",
        modeReason: `Checks failed: ${event.payload.failedChecks.join(", ")}`,
        activity: appendActivity(state, "Verification failed"),
      };
    case "codex.completed":
      return {
        ...state,
        mode: "IDLE",
        modeReason: "Codex task ready for review",
        activity: appendActivity(state, "Codex task completed"),
      };
    case "codex.failed":
      return {
        ...state,
        mode: "ERROR",
        modeReason: event.payload.message,
        activity: appendActivity(state, `Codex failed: ${event.payload.code}`),
      };
    case "git.worktree.created":
      return {
        ...state,
        activity: appendActivity(
          state,
          `Worktree ready: ${event.payload.branch}`,
        ),
      };
    case "git.worktree.removed":
      return {
        ...state,
        activity: appendActivity(state, "Task worktree removed"),
      };
    case "git.commit_requested":
      return {
        ...state,
        modeReason: `Preparing commit on ${event.payload.branch}`,
        activity: appendActivity(state, "Git commit requested"),
      };
    case "git.committed":
      return {
        ...state,
        activity: appendActivity(
          state,
          `Committed ${event.payload.revision.slice(0, 8)}`,
        ),
      };
    case "git.push_requested":
      return {
        ...state,
        mode: "WAITING_APPROVAL",
        modeReason: `Push ${event.payload.branch}`,
        activity: appendActivity(state, "Git push requested"),
      };
    case "git.pushed":
      return {
        ...state,
        mode: "IDLE",
        modeReason: `Pushed ${event.payload.branch}`,
        activity: appendActivity(state, "Git branch pushed"),
      };
    case "git.failed":
      return {
        ...state,
        mode: "ERROR",
        modeReason: event.payload.message,
        activity: appendActivity(state, `Git failed: ${event.payload.code}`),
      };
    case "approval.requested":
      return {
        ...state,
        approval: event.payload,
        mode: "WAITING_APPROVAL",
        activity: appendActivity(
          state,
          `Approval required: ${event.payload.action}`,
        ),
      };
    case "approval.approved":
      if (event.payload.automatic) return state;
      return {
        ...state,
        ...(state.approval?.approvalId === event.payload.approvalId
          ? { approval: undefined }
          : {}),
        mode:
          state.approval?.approvalId === event.payload.approvalId
            ? "IDLE"
            : state.mode,
        activity: appendActivity(state, `${event.payload.action}: approved`),
      };
    case "approval.rejected":
      return {
        ...state,
        ...(state.approval?.approvalId === event.payload.approvalId
          ? { approval: undefined }
          : {}),
        mode:
          state.approval?.approvalId === event.payload.approvalId
            ? "IDLE"
            : state.mode,
        activity: appendActivity(state, `${event.payload.action}: rejected`),
      };
    case "jarvis.test":
    case "reference.display.requested":
      return state;
  }
}

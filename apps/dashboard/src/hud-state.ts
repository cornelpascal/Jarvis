import type { EventPayloadMap, KnownJarvisEvent } from "@jarvis/protocol";

export type JarvisMode = EventPayloadMap["jarvis.state.changed"]["state"];
export type Telemetry = EventPayloadMap["system.telemetry"];
export type ProjectSummary = EventPayloadMap["project.registered"];
export type AgentSummary = EventPayloadMap["codex.agent.progress"];
export type ConversationMessage = EventPayloadMap["conversation.message.added"];
export type ApprovalSummary = EventPayloadMap["approval.requested"];

export interface HudState {
  mode: JarvisMode;
  modeReason?: string;
  projects: Record<string, ProjectSummary>;
  selectedProjectId?: string;
  agents: Record<string, AgentSummary>;
  messages: ConversationMessage[];
  approval?: ApprovalSummary;
  telemetry?: Telemetry;
  activity: string[];
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
    case "conversation.message.added":
      return {
        ...state,
        messages: [...state.messages, event.payload].slice(-100),
      };
    case "project.registered":
      return {
        ...state,
        projects: {
          ...state.projects,
          [event.payload.projectId]: event.payload,
        },
      };
    case "project.selected":
      return { ...state, selectedProjectId: event.payload.projectId };
    case "codex.agent.progress":
      return {
        ...state,
        agents: { ...state.agents, [event.payload.agentRunId]: event.payload },
        activity: appendActivity(
          state,
          `${event.payload.label}: ${event.payload.state}`,
        ),
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
    case "jarvis.test":
    case "reference.display.requested":
      return state;
  }
}

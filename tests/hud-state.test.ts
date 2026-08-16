import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  initialHudState,
  reduceHudEvent,
} from "../apps/dashboard/src/hud-state.js";
import {
  EVENT_SCHEMA_VERSION,
  parseJarvisEvent,
  type KnownEventType,
} from "../packages/protocol/src/index.js";

function event(type: KnownEventType, payload: unknown, sequence: number) {
  return parseJarvisEvent({
    id: randomUUID(),
    sequence,
    timestamp: new Date().toISOString(),
    type,
    source: "test",
    schemaVersion: EVENT_SCHEMA_VERSION,
    payload,
  });
}

describe("HUD state projection", () => {
  it("derives mode and telemetry from typed events", () => {
    const thinking = reduceHudEvent(
      initialHudState,
      event(
        "jarvis.state.changed",
        { state: "THINKING", reason: "Routing request" },
        0,
      ),
    );
    const telemetry = reduceHudEvent(
      thinking,
      event(
        "system.telemetry",
        {
          cpuPercent: 21,
          ramUsedBytes: 50,
          ramTotalBytes: 100,
          network: "online",
          microphone: "not_configured",
          voice: "not_configured",
          core: "online",
          codexAgents: 0,
        },
        1,
      ),
    );
    expect(telemetry.mode).toBe("THINKING");
    expect(telemetry.modeReason).toBe("Routing request");
    expect(telemetry.telemetry?.cpuPercent).toBe(21);
  });

  it("projects projects, agents, conversation, and approvals", () => {
    const events = [
      event(
        "project.registered",
        {
          projectId: "jarvis",
          name: "JARVIS",
          path: "C:\\Documents\\jarvis",
          enabled: true,
        },
        0,
      ),
      event("project.selected", { projectId: "jarvis" }, 1),
      event(
        "codex.agent.progress",
        {
          agentRunId: "a1",
          taskId: "t1",
          projectId: "jarvis",
          label: "CODEX-01",
          title: "Build HUD",
          state: "TESTING",
        },
        2,
      ),
      event(
        "conversation.message.added",
        {
          messageId: "m1",
          role: "assistant",
          content: "HUD online",
          citations: [],
        },
        3,
      ),
      event(
        "approval.requested",
        {
          approvalId: "p1",
          action: "git.push",
          reason: "Publish branch",
          riskLevel: 3,
        },
        4,
      ),
    ];
    const state = events.reduce(reduceHudEvent, initialHudState);
    expect(state.projects.jarvis?.name).toBe("JARVIS");
    expect(state.selectedProjectId).toBe("jarvis");
    expect(state.agents.a1?.state).toBe("TESTING");
    expect(state.messages).toHaveLength(1);
    expect(state.approval?.riskLevel).toBe(3);
    expect(state.mode).toBe("WAITING_APPROVAL");
  });

  it("projects voice lifecycle events into truthful HUD modes", () => {
    const state = [
      event(
        "voice.connected",
        { provider: "openai-realtime", sessionId: "session-1" },
        0,
      ),
      event("voice.user_speaking", { provider: "openai-realtime" }, 1),
      event("voice.processing", { provider: "openai-realtime" }, 2),
      event("voice.speaking", { provider: "openai-realtime" }, 3),
      event(
        "voice.interrupted",
        { provider: "openai-realtime", by: "user" },
        4,
      ),
    ].reduce(reduceHudEvent, initialHudState);
    expect(state.mode).toBe("LISTENING");
    expect(state.modeReason).toBe("Response interrupted");
  });
});

import { describe, expect, it, vi } from "vitest";
import { openJarvisDatabase } from "../packages/database/src/index.js";
import { LocalEventBus } from "../packages/event-bus/src/index.js";
import { EVENT_SCHEMA_VERSION } from "../packages/protocol/src/index.js";
import { SqliteNotificationService } from "../services/notifications/src/index.js";
import {
  BoundedCodingAgentProvider,
  MockCodingAgentProvider,
} from "../services/codex-manager/src/index.js";

describe("notifications and background work", () => {
  it("persists terminal work once and restores unread state", async () => {
    const database = openJarvisDatabase(":memory:");
    const bus = new LocalEventBus();
    const service = new SqliteNotificationService({ database, bus });
    const event = bus.create("codex.completed", "test", {
      taskId: "task-1",
      projectId: "project-1",
      state: "READY_FOR_REVIEW",
    });
    await bus.publish(event);
    expect(service.list({ unreadOnly: true, limit: 20 })).toHaveLength(1);
    service.close();

    const replayBus = new LocalEventBus();
    const restored = new SqliteNotificationService({
      database,
      bus: replayBus,
    });
    await replayBus.publish({ ...event, schemaVersion: EVENT_SCHEMA_VERSION });
    const notifications = restored.list({ unreadOnly: true, limit: 20 });
    expect(notifications).toHaveLength(1);
    const notification = notifications[0];
    if (!notification) throw new Error("Expected a persisted notification");
    await restored.markRead(notification.id);
    expect(restored.list({ unreadOnly: true, limit: 20 })).toEqual([]);
    expect(
      restored.list({ unreadOnly: false, limit: 20 })[0]?.readAt,
    ).toBeTruthy();
    restored.close();
    database.close();
  });

  it("limits concurrent coding agents and starts queued work after release", async () => {
    const inner = new MockCodingAgentProvider();
    const provider = new BoundedCodingAgentProvider(inner, 1);
    const first = await provider.createTask({
      projectId: "project",
      title: "First",
      instruction: "First task",
      workingDirectory: "C:\\fixture-a",
    });
    const second = await provider.createTask({
      projectId: "project",
      title: "Second",
      instruction: "Second task",
      workingDirectory: "C:\\fixture-b",
    });
    expect((await provider.startTask(first.id)).state).toBe("EDITING");
    expect((await provider.startTask(second.id)).state).toBe("QUEUED");
    await provider.cancelTask(first.id);
    await vi.waitFor(async () => {
      expect((await provider.getStatus(second.id)).state).toBe("EDITING");
    });
    await provider.close();
  });
});

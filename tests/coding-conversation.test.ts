import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openJarvisDatabase } from "../packages/database/src/index.js";
import { LocalEventBus } from "../packages/event-bus/src/index.js";
import { SqlitePermissionBroker } from "../packages/permissions/src/index.js";
import type {
  CodingTaskState,
  KnownJarvisEvent,
  RouteRequest,
} from "../packages/protocol/src/index.js";
import { MockCodingAgentProvider } from "../services/codex-manager/src/index.js";
import {
  CodingConversationController,
  CodingResponseBuffer,
  resolveCodingConversationAction,
} from "../services/core/src/coding-conversation.js";

function route(
  text: string,
  context: Partial<Pick<RouteRequest, "activeProjectId" | "activeTaskId">> = {},
): RouteRequest {
  return {
    requestId: randomUUID(),
    text,
    ...context,
    provenance: { origin: "user", trusted: true },
  };
}

function insertProjectAndTask(
  database: ReturnType<typeof openJarvisDatabase>,
  input: {
    taskId: string;
    projectId?: string;
    title: string;
    state?: CodingTaskState;
    createdAt?: string;
  },
): void {
  const projectId = input.projectId ?? "project-1";
  const now = input.createdAt ?? new Date().toISOString();
  database.connection
    .prepare(
      `INSERT OR IGNORE INTO projects(id,name,path,enabled,created_at,updated_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .run(projectId, projectId, `C:\\${projectId}`, 1, now, now);
  database.connection
    .prepare(
      `INSERT INTO tasks(
        id,project_id,title,state,instruction,working_directory,provider,created_at,updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.taskId,
      projectId,
      input.title,
      input.state ?? "READY_FOR_REVIEW",
      input.title,
      `C:\\worktrees\\${input.taskId}`,
      "mock",
      now,
      now,
    );
}

describe("conversational diff review", () => {
  it("resolves an explicit task and opens its diff while steering Codex", async () => {
    const database = openJarvisDatabase(":memory:");
    insertProjectAndTask(database, {
      taskId: "task-review",
      title: "Authentication middleware",
    });
    const provider = new MockCodingAgentProvider();
    await provider.createTask({
      taskId: "task-review",
      projectId: "project-1",
      title: "Authentication middleware",
      instruction: "Update authentication",
      workingDirectory: "C:\\worktrees\\task-review",
    });
    const bus = new LocalEventBus();
    const events: KnownJarvisEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const controller = new CodingConversationController({
      database,
      bus,
      provider,
      permissions: new SqlitePermissionBroker({ database, bus }),
    });

    const result = await controller.handle(
      route("Explain this diff and why the middleware changed.", {
        activeTaskId: "task-review",
      }),
    );

    expect(result).toMatchObject({
      action: "message",
      taskId: "task-review",
      showDiff: true,
    });
    expect(await provider.getStatus("task-review")).toMatchObject({
      state: "EDITING",
    });
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "codex.diff.ready",
        "reference.display.requested",
        "conversation.message.added",
      ]),
    );
    const deck = events.find(
      (event) => event.type === "reference.display.requested",
    );
    expect(deck?.payload).toMatchObject({ mode: "CODE_DIFF" });
    database.close();
  });

  it("uses stable Codex ordinals and asks when an unnamed target is ambiguous", async () => {
    const database = openJarvisDatabase(":memory:");
    insertProjectAndTask(database, {
      taskId: "task-1",
      title: "First task",
      createdAt: "2026-08-17T00:00:00.000Z",
    });
    insertProjectAndTask(database, {
      taskId: "task-2",
      title: "Second task",
      createdAt: "2026-08-17T00:00:01.000Z",
    });

    expect(
      resolveCodingConversationAction(
        database,
        route("Tell Codex 2 to reuse the existing helper."),
      ),
    ).toMatchObject({ action: "message", taskId: "task-2" });

    const bus = new LocalEventBus();
    const messages: string[] = [];
    bus.subscribe((event) => {
      if (event.type === "conversation.message.added")
        messages.push(event.payload.content);
    });
    const controller = new CodingConversationController({
      database,
      bus,
      provider: new MockCodingAgentProvider(),
      permissions: new SqlitePermissionBroker({ database, bus }),
    });
    expect(await controller.handle(route("Show the diff."))).toBeUndefined();
    expect(messages.at(-1)).toContain("More than one coding task");
    database.close();
  });

  it("ignores ordinary coding requests and aggregates response deltas", () => {
    const database = openJarvisDatabase(":memory:");
    expect(
      resolveCodingConversationAction(
        database,
        route("Implement the mobile login fix."),
      ),
    ).toBeUndefined();
    const responses = new CodingResponseBuffer();
    responses.append("task-1", "The middleware ");
    responses.append("task-1", "changed to reuse the shared helper.");
    expect(responses.take("task-1")).toBe(
      "The middleware changed to reuse the shared helper.",
    );
    expect(responses.take("task-1")).toBeUndefined();
    database.close();
  });
});

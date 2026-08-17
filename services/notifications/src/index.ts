import { randomUUID } from "node:crypto";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import {
  notificationSchema,
  type KnownJarvisEvent,
  type Notification,
  type NotificationProvider,
} from "@jarvis/protocol";

interface NotificationDraft {
  type: Notification["type"];
  severity: Notification["severity"];
  title: string;
  body?: string;
  projectId?: string;
  taskId?: string;
}

interface NotificationRow {
  id: string;
  event_id: string;
  type: Notification["type"];
  severity: Notification["severity"];
  title: string;
  body: string | null;
  project_id: string | null;
  task_id: string | null;
  read_at: string | null;
  created_at: string;
}

function draftFor(event: KnownJarvisEvent): NotificationDraft | undefined {
  switch (event.type) {
    case "codex.completed":
      return {
        type: "task",
        severity: "success",
        title: "CODEX TASK READY",
        body: "The coding task is ready for review.",
        projectId: event.payload.projectId,
        taskId: event.payload.taskId,
      };
    case "codex.failed":
      return {
        type: "task",
        severity: "error",
        title: "CODEX TASK FAILED",
        body: `The coding task stopped (${event.payload.code}).`,
        projectId: event.payload.projectId,
        taskId: event.payload.taskId,
      };
    case "deployment.completed":
      return {
        type: "deployment",
        severity: event.payload.health === "UNHEALTHY" ? "warning" : "success",
        title: "DEPLOYMENT COMPLETE",
        body: `${event.payload.environment} health: ${event.payload.health}`,
        projectId: event.payload.projectId,
      };
    case "deployment.failed":
      return {
        type: "deployment",
        severity: "error",
        title: "DEPLOYMENT FAILED",
        body: `${event.payload.environment} deployment stopped (${event.payload.code}).`,
        projectId: event.payload.projectId,
      };
    case "research.failed":
      return {
        type: "research",
        severity: "warning",
        title: "RESEARCH UNAVAILABLE",
        body: `Research stopped (${event.payload.code}).`,
      };
    default:
      return undefined;
  }
}

function fromRow(row: NotificationRow): Notification {
  return notificationSchema.parse({
    id: row.id,
    eventId: row.event_id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    ...(row.body ? { body: row.body } : {}),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.task_id ? { taskId: row.task_id } : {}),
    ...(row.read_at ? { readAt: row.read_at } : {}),
    createdAt: row.created_at,
  });
}

export class SqliteNotificationService implements NotificationProvider {
  readonly #database: JarvisDatabase;
  readonly #bus: LocalEventBus;
  readonly #unsubscribe: () => void;

  constructor(options: { database: JarvisDatabase; bus: LocalEventBus }) {
    this.#database = options.database;
    this.#bus = options.bus;
    this.#unsubscribe = this.#bus.subscribe((event) => this.#onEvent(event));
  }

  list(input: { unreadOnly: boolean; limit: number }): Notification[] {
    const rows = this.#database.connection
      .prepare(
        `SELECT id,event_id,type,severity,title,body,project_id,task_id,read_at,created_at
         FROM notifications ${input.unreadOnly ? "WHERE read_at IS NULL" : ""}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(input.limit) as unknown as NotificationRow[];
    return rows.map(fromRow);
  }

  async markRead(notificationId: string): Promise<Notification | undefined> {
    const readAt = new Date().toISOString();
    const changed = this.#database.connection
      .prepare(
        "UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL",
      )
      .run(readAt, notificationId).changes;
    const row = this.#row(notificationId);
    if (!row) return undefined;
    if (changed)
      await this.#bus.publish(
        this.#bus.create("notification.read", "notifications", {
          notificationId,
          readAt,
        }),
      );
    return fromRow(row);
  }

  close(): void {
    this.#unsubscribe();
  }

  #onEvent(event: KnownJarvisEvent): void {
    const draft = draftFor(event);
    if (!draft) return;
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const changed = this.#database.connection
      .prepare(
        `INSERT OR IGNORE INTO notifications(
          id,event_id,type,severity,title,body,project_id,task_id,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        event.id,
        draft.type,
        draft.severity,
        draft.title,
        draft.body ?? null,
        draft.projectId ?? null,
        draft.taskId ?? null,
        createdAt,
      ).changes;
    if (!changed) return;
    const created = this.#bus.create("notification.created", "notifications", {
      notificationId: id,
      type: draft.type,
      severity: draft.severity,
      title: draft.title,
      ...(draft.body ? { body: draft.body } : {}),
      ...(draft.projectId ? { projectId: draft.projectId } : {}),
      ...(draft.taskId ? { taskId: draft.taskId } : {}),
      createdAt,
    });
    queueMicrotask(() => void this.#bus.publish(created));
  }

  #row(id: string): NotificationRow | undefined {
    return this.#database.connection
      .prepare(
        `SELECT id,event_id,type,severity,title,body,project_id,task_id,read_at,created_at
         FROM notifications WHERE id = ?`,
      )
      .get(id) as unknown as NotificationRow | undefined;
  }
}

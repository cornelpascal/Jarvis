import { randomUUID } from "node:crypto";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import type { PermissionBroker } from "@jarvis/permissions";
import type {
  CodingAgentProvider,
  CodingTaskState,
  RouteRequest,
} from "@jarvis/protocol";

const TERMINAL_STATES: CodingTaskState[] = ["FAILED", "CANCELLED"];

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  state: CodingTaskState;
}

export type CodingConversationAction =
  "show_diff" | "message" | "pause" | "resume" | "cancel";

export interface ResolvedCodingConversationAction {
  action: CodingConversationAction;
  taskId: string;
  projectId: string;
  title: string;
  instruction?: string;
  showDiff: boolean;
}

export class CodingConversationError extends Error {
  override readonly name = "CodingConversationError";

  constructor(
    readonly code: "NO_TASK" | "AMBIGUOUS_TASK" | "TASK_NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

function requestedAction(
  text: string,
):
  | Pick<
      ResolvedCodingConversationAction,
      "action" | "instruction" | "showDiff"
    >
  | undefined {
  const asksAboutDiff = /\bdiff\b/i.test(text);
  const asksForExplanation =
    /\b(?:explain|why|walk me through|summari[sz]e|review)\b/i.test(text);
  if (/\b(?:pause|hold)\b/i.test(text))
    return { action: "pause", showDiff: false };
  if (/\b(?:resume|continue)\b/i.test(text))
    return { action: "resume", showDiff: false };
  if (/\b(?:cancel|stop)\b/i.test(text))
    return { action: "cancel", showDiff: false };
  if (asksAboutDiff && !asksForExplanation)
    return { action: "show_diff", showDiff: true };
  if (
    (asksAboutDiff && asksForExplanation) ||
    /\bwhy did (?:you|codex|the agent)\b/i.test(text) ||
    /\brevert\b/i.test(text) ||
    /\b(?:tell|ask|message|instruct)\s+(?:codex|the agent)\b/i.test(text)
  )
    return { action: "message", instruction: text, showDiff: asksAboutDiff };
  return undefined;
}

function taskRows(database: JarvisDatabase, projectId?: string): TaskRow[] {
  return database.connection
    .prepare(
      `SELECT id,project_id,title,state FROM tasks
       WHERE state NOT IN (${TERMINAL_STATES.map(() => "?").join(",")})
       ${projectId ? "AND project_id = ?" : ""}
       ORDER BY created_at ASC,id ASC`,
    )
    .all(
      ...TERMINAL_STATES,
      ...(projectId ? [projectId] : []),
    ) as unknown as TaskRow[];
}

export function resolveCodingConversationAction(
  database: JarvisDatabase,
  request: RouteRequest,
): ResolvedCodingConversationAction | undefined {
  const requested = requestedAction(request.text);
  if (!requested) return undefined;
  const rows = taskRows(database, request.activeProjectId);
  let selected: TaskRow | undefined;
  if (request.activeTaskId) {
    selected = rows.find((row) => row.id === request.activeTaskId);
    if (!selected)
      throw new CodingConversationError(
        "TASK_NOT_FOUND",
        "The active coding task is not available for review or steering.",
      );
  }
  const ordinal = /\bcodex[\s-]*(\d+)\b/i.exec(request.text)?.[1];
  if (!selected && ordinal) {
    selected = rows[Number(ordinal) - 1];
    if (!selected)
      throw new CodingConversationError(
        "TASK_NOT_FOUND",
        `Codex ${ordinal} is not available for review or steering.`,
      );
  }
  if (!selected) {
    const normalized = request.text.toLocaleLowerCase();
    const named = rows.filter((row) =>
      normalized.includes(row.title.toLocaleLowerCase()),
    );
    if (named.length === 1) selected = named[0];
  }
  if (!selected && rows.length === 1) selected = rows[0];
  if (!selected)
    throw new CodingConversationError(
      rows.length === 0 ? "NO_TASK" : "AMBIGUOUS_TASK",
      rows.length === 0
        ? "There is no coding task available for review or steering."
        : "More than one coding task is available. Name the task or Codex agent.",
    );
  return {
    ...requested,
    taskId: selected.id,
    projectId: selected.project_id,
    title: selected.title,
  };
}

export class CodingConversationController {
  readonly #database: JarvisDatabase;
  readonly #bus: LocalEventBus;
  readonly #provider: CodingAgentProvider;
  readonly #permissions: PermissionBroker;

  constructor(options: {
    database: JarvisDatabase;
    bus: LocalEventBus;
    provider: CodingAgentProvider;
    permissions: PermissionBroker;
  }) {
    this.#database = options.database;
    this.#bus = options.bus;
    this.#provider = options.provider;
    this.#permissions = options.permissions;
  }

  async handle(
    request: RouteRequest,
  ): Promise<ResolvedCodingConversationAction | undefined> {
    let resolved: ResolvedCodingConversationAction | undefined;
    try {
      resolved = resolveCodingConversationAction(this.#database, request);
    } catch (cause) {
      if (!(cause instanceof CodingConversationError)) throw cause;
      await this.#say(cause.message);
      return undefined;
    }
    if (!resolved) return undefined;
    const permission = await this.#permissions.authorize({
      action: "codex.task.control",
      resource: `task:${resolved.taskId}`,
      projectId: resolved.projectId,
      reason: `Conversational coding task action: ${resolved.action}`,
      arguments: {
        taskId: resolved.taskId,
        action: resolved.action,
        ...(resolved.instruction ? { instruction: resolved.instruction } : {}),
      },
      provenance: { origin: "user", trusted: true },
    });
    if (permission.state !== "APPROVED") {
      await this.#say(
        permission.state === "DENIED"
          ? permission.reason
          : "That coding action requires approval.",
      );
      return resolved;
    }
    if (resolved.showDiff) await this.#displayDiff(resolved);
    switch (resolved.action) {
      case "show_diff":
        await this.#say(`Opened the latest diff for ${resolved.title}.`);
        break;
      case "message":
        await this.#provider.sendInstruction(
          resolved.taskId,
          resolved.instruction ?? request.text,
        );
        await this.#say(`Sent your review instruction to ${resolved.title}.`);
        break;
      case "pause":
        await this.#provider.pauseTask(resolved.taskId);
        await this.#say(`Paused ${resolved.title}.`);
        break;
      case "resume":
        await this.#provider.resumeTask(resolved.taskId);
        await this.#say(`Resumed ${resolved.title}.`);
        break;
      case "cancel":
        await this.#provider.cancelTask(resolved.taskId);
        await this.#say(`Cancelled ${resolved.title}.`);
        break;
    }
    return resolved;
  }

  async #displayDiff(action: ResolvedCodingConversationAction): Promise<void> {
    const diff = await this.#provider.requestDiff(action.taskId);
    await this.#bus.publish(
      this.#bus.create("codex.diff.ready", "core.coding-conversation", {
        taskId: action.taskId,
        projectId: action.projectId,
        diff,
      }),
    );
    await this.#bus.publish(
      this.#bus.create(
        "reference.display.requested",
        "core.coding-conversation",
        {
          mode: "CODE_DIFF",
          title: `${action.title} — diff review`,
          items: [
            {
              id: `diff-${action.taskId}`,
              type: "code_diff",
              title: `${action.title} diff`,
              content: diff || "No tracked changes were detected.",
            },
          ],
        },
      ),
    );
  }

  async #say(content: string): Promise<void> {
    await this.#bus.publish(
      this.#bus.create(
        "conversation.message.added",
        "core.coding-conversation",
        {
          messageId: randomUUID(),
          role: "assistant",
          content,
          citations: [],
        },
      ),
    );
  }
}

export class CodingResponseBuffer {
  readonly #content = new Map<string, string>();

  append(taskId: string, delta: string): void {
    this.#content.set(
      taskId,
      `${this.#content.get(taskId) ?? ""}${delta}`.slice(-20_000),
    );
  }

  take(taskId: string): string | undefined {
    const content = this.#content.get(taskId)?.trim();
    this.#content.delete(taskId);
    return content || undefined;
  }

  clear(taskId: string): void {
    this.#content.delete(taskId);
  }
}

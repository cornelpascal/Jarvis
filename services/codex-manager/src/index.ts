import { randomUUID } from "node:crypto";
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import type { JarvisDatabase } from "@jarvis/database";
import {
  codingAgentEventSchema,
  codingTaskSchema,
  type CodingAgentEvent,
  type CodingAgentEventListener,
  type CodingAgentProvider,
  type CodingTask,
  type CodingTaskCreate,
  type CodingTaskState,
  type ProviderHealth,
} from "@jarvis/protocol";

const execFileAsync = promisify(execFile);

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function nestedString(value: unknown, ...path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) current = object(current)?.[key];
  return typeof current === "string" ? current : undefined;
}

class JsonLineRpcTransport {
  readonly #pending = new Map<number, PendingRequest>();
  readonly #executable: string;
  readonly #argumentsPrefix: string[];
  #process: ChildProcessWithoutNullStreams | undefined;
  #nextId = 1;
  #buffer = "";
  onNotification?: (message: JsonRpcNotification) => void;
  onServerRequest?: (method: string, params: unknown) => void;

  constructor(executable: string, argumentsPrefix: string[] = []) {
    this.#executable = executable;
    this.#argumentsPrefix = argumentsPrefix;
  }

  start(): void {
    if (this.#process) return;
    const child = spawn(
      this.#executable,
      [...this.#argumentsPrefix, "app-server", "--stdio"],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.#process = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#consume(chunk));
    child.stderr.resume();
    child.on("error", (error) => this.#failAll(error));
    child.on("exit", (code) => {
      this.#process = undefined;
      this.#failAll(new Error(`Codex App Server exited (${String(code)})`));
    });
  }

  async request(
    method: string,
    params: unknown,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    this.start();
    const id = this.#nextId++;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
    });
    this.#write({ id, method, params });
    return result;
  }

  notify(method: string, params: unknown): void {
    this.#write({ method, params });
  }

  async close(): Promise<void> {
    const child = this.#process;
    this.#process = undefined;
    if (!child) return;
    child.kill();
    await new Promise<void>((resolveClose) => {
      if (child.exitCode !== null) resolveClose();
      else child.once("exit", () => resolveClose());
      setTimeout(resolveClose, 2_000);
    });
  }

  #write(value: unknown): void {
    if (!this.#process?.stdin.writable)
      throw new Error("Codex App Server is unavailable");
    this.#process.stdin.write(`${JSON.stringify(value)}\n`);
  }

  #consume(chunk: string): void {
    this.#buffer += chunk;
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (
        typeof message.id === "number" &&
        ("result" in message || "error" in message)
      ) {
        const response = message as unknown as JsonRpcResponse;
        const pending = this.#pending.get(response.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.#pending.delete(response.id);
        if (response.error)
          pending.reject(
            new Error(
              `Codex ${String(response.error.code)}: ${response.error.message}`,
            ),
          );
        else pending.resolve(response.result);
      } else if (
        typeof message.id === "number" &&
        typeof message.method === "string"
      ) {
        this.onServerRequest?.(message.method, message.params);
        this.#write({
          id: message.id,
          error: {
            code: -32001,
            message: "Approval requires JARVIS permission broker",
          },
        });
      } else if (typeof message.method === "string") {
        this.onNotification?.({
          method: message.method,
          params: message.params,
        });
      }
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export interface CodexAppServerProviderOptions {
  database: JarvisDatabase;
  executable?: string;
  executableArgsPrefix?: string[];
  clientVersion?: string;
}

export class CodexProviderError extends Error {
  override readonly name = "CodexProviderError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class CodexAppServerProvider implements CodingAgentProvider {
  readonly #database: JarvisDatabase;
  readonly #executable: string;
  readonly #executableArgsPrefix: string[];
  readonly #clientVersion: string;
  readonly #listeners = new Set<CodingAgentEventListener>();
  readonly #diffs = new Map<string, string>();
  #transport: JsonLineRpcTransport | undefined;
  #initialized = false;

  constructor(options: CodexAppServerProviderOptions) {
    this.#database = options.database;
    this.#executable = options.executable ?? "codex";
    this.#executableArgsPrefix = options.executableArgsPrefix ?? [];
    this.#clientVersion = options.clientVersion ?? "0.1.0";
  }

  async health(): Promise<ProviderHealth> {
    try {
      const { stdout } = await execFileAsync(this.#executable, ["--version"], {
        windowsHide: true,
        timeout: 5_000,
      });
      return {
        status: "available",
        message: stdout.trim(),
        capabilities: [
          "app-server",
          "threads",
          "turns",
          "streaming",
          "interrupt",
        ],
      };
    } catch {
      return {
        status: "unavailable",
        message: "Codex executable was not found",
        capabilities: [],
      };
    }
  }

  async connect(): Promise<ProviderHealth> {
    await this.#ensureInitialized();
    return {
      status: "available",
      message: "Codex App Server initialized",
      capabilities: [
        "app-server",
        "threads",
        "turns",
        "streaming",
        "interrupt",
      ],
    };
  }

  async createTask(input: CodingTaskCreate): Promise<CodingTask> {
    const now = new Date().toISOString();
    const { taskId, ...taskInput } = input;
    const task = codingTaskSchema.parse({
      id: taskId ?? randomUUID(),
      ...taskInput,
      state: "QUEUED",
      provider: "codex-app-server",
      createdAt: now,
      updatedAt: now,
    });
    this.#database.connection
      .prepare(
        `INSERT INTO tasks(
      id, project_id, title, state, instruction, working_directory, provider, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.projectId,
        task.title,
        task.state,
        task.instruction,
        task.workingDirectory,
        task.provider,
        now,
        now,
      );
    await this.#emit(task, "state", "Task queued", task.state);
    return task;
  }

  async startTask(taskId: string): Promise<CodingTask> {
    const task = await this.getStatus(taskId);
    if (task.state !== "QUEUED" && task.state !== "BLOCKED")
      throw new CodexProviderError(
        "INVALID_TASK_STATE",
        `Cannot start task from ${task.state}`,
      );
    await this.#ensureInitialized();
    const threadResponse = await this.#transport?.request("thread/start", {
      cwd: task.workingDirectory,
      runtimeWorkspaceRoots: [task.workingDirectory],
      approvalPolicy: "never",
      sandbox: "workspace-write",
      ephemeral: false,
      serviceName: "jarvis",
      developerInstructions:
        "Work only inside the provided project workspace. Do not push, deploy, or access secrets.",
    });
    const threadId = nestedString(threadResponse, "thread", "id");
    if (!threadId)
      throw new CodexProviderError(
        "INVALID_APP_SERVER_RESPONSE",
        "thread/start returned no thread id",
      );
    this.#update(taskId, "PREPARING", { threadId });
    await this.#emit(
      await this.getStatus(taskId),
      "state",
      "Codex thread started",
      "PREPARING",
    );
    return this.#startTurn(taskId, task.instruction);
  }

  async resumeTask(taskId: string): Promise<CodingTask> {
    const task = await this.getStatus(taskId);
    if (!task.threadId) return this.startTask(taskId);
    return this.#startTurn(
      taskId,
      "Continue the task from the current workspace state.",
    );
  }

  async pauseTask(taskId: string): Promise<CodingTask> {
    const task = await this.getStatus(taskId);
    if (task.threadId && task.turnId)
      await this.#transport?.request("turn/interrupt", {
        threadId: task.threadId,
        turnId: task.turnId,
      });
    this.#update(taskId, "BLOCKED");
    const updated = await this.getStatus(taskId);
    await this.#emit(updated, "state", "Agent paused", "BLOCKED");
    return updated;
  }

  async cancelTask(taskId: string): Promise<CodingTask> {
    const task = await this.getStatus(taskId);
    if (task.threadId && task.turnId && this.#transport)
      await this.#transport.request("turn/interrupt", {
        threadId: task.threadId,
        turnId: task.turnId,
      });
    this.#update(taskId, "CANCELLED");
    const updated = await this.getStatus(taskId);
    await this.#emit(updated, "state", "Agent cancelled", "CANCELLED");
    return updated;
  }

  async sendInstruction(
    taskId: string,
    instruction: string,
  ): Promise<CodingTask> {
    if (!instruction.trim())
      throw new CodexProviderError(
        "INVALID_INSTRUCTION",
        "Instruction cannot be empty",
      );
    return this.#startTurn(taskId, instruction);
  }

  getStatus(taskId: string): Promise<CodingTask> {
    const row = this.#database.connection
      .prepare(
        `SELECT id, project_id, title, state, instruction,
      working_directory, provider, thread_id, turn_id, error, created_at, updated_at FROM tasks WHERE id = ?`,
      )
      .get(taskId) as
      | {
          id: string;
          project_id: string;
          title: string;
          state: CodingTaskState;
          instruction: string | null;
          working_directory: string | null;
          provider: string | null;
          thread_id: string | null;
          turn_id: string | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row || !row.instruction || !row.working_directory)
      return Promise.reject(
        new CodexProviderError("TASK_NOT_FOUND", "Coding task was not found"),
      );
    return Promise.resolve(
      codingTaskSchema.parse({
        id: row.id,
        projectId: row.project_id,
        title: row.title,
        state: row.state,
        instruction: row.instruction,
        workingDirectory: row.working_directory,
        provider: row.provider ?? "codex-app-server",
        ...(row.thread_id ? { threadId: row.thread_id } : {}),
        ...(row.turn_id ? { turnId: row.turn_id } : {}),
        ...(row.error ? { error: row.error } : {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  }

  subscribeEvents(listener: CodingAgentEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  requestDiff(taskId: string): Promise<string> {
    return Promise.resolve(this.#diffs.get(taskId) ?? "");
  }

  async close(): Promise<void> {
    await this.#transport?.close();
    this.#transport = undefined;
    this.#initialized = false;
  }

  async #ensureInitialized(): Promise<void> {
    if (this.#initialized) return;
    const transport = new JsonLineRpcTransport(
      this.#executable,
      this.#executableArgsPrefix,
    );
    transport.onNotification = (notification) =>
      void this.#notification(notification);
    transport.onServerRequest = (method) => void this.#approvalRequest(method);
    this.#transport = transport;
    await transport.request("initialize", {
      clientInfo: {
        name: "jarvis",
        title: "JARVIS",
        version: this.#clientVersion,
      },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    transport.notify("initialized", {});
    this.#initialized = true;
  }

  async #startTurn(taskId: string, instruction: string): Promise<CodingTask> {
    const task = await this.getStatus(taskId);
    if (!task.threadId)
      throw new CodexProviderError(
        "THREAD_NOT_STARTED",
        "Coding task has no Codex thread",
      );
    await this.#ensureInitialized();
    const response = await this.#transport?.request("turn/start", {
      threadId: task.threadId,
      input: [{ type: "text", text: instruction, text_elements: [] }],
    });
    const turnId = nestedString(response, "turn", "id");
    if (!turnId)
      throw new CodexProviderError(
        "INVALID_APP_SERVER_RESPONSE",
        "turn/start returned no turn id",
      );
    this.#update(taskId, "PLANNING", { turnId });
    const updated = await this.getStatus(taskId);
    await this.#emit(updated, "state", "Codex turn started", "PLANNING");
    return updated;
  }

  async #notification(notification: JsonRpcNotification): Promise<void> {
    const threadId = nestedString(notification.params, "threadId");
    if (!threadId) return;
    const row = this.#database.connection
      .prepare(
        "SELECT id FROM tasks WHERE thread_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(threadId) as { id: string } | undefined;
    if (!row) return;
    const task = await this.getStatus(row.id);
    if (notification.method === "turn/diff/updated") {
      const diff = nestedString(notification.params, "diff") ?? "";
      this.#diffs.set(task.id, diff);
      await this.#emit(task, "diff", "Diff updated", undefined, diff);
      return;
    }
    if (
      notification.method === "item/started" ||
      notification.method === "item/completed"
    ) {
      const itemType =
        nestedString(notification.params, "item", "type") ?? "item";
      const state: CodingTaskState =
        itemType === "commandExecution"
          ? "TESTING"
          : itemType === "fileChange"
            ? "EDITING"
            : "INSPECTING";
      this.#update(task.id, state);
      await this.#emit(
        await this.getStatus(task.id),
        "item",
        `Codex ${itemType}`,
        state,
      );
      return;
    }
    if (notification.method === "item/agentMessage/delta") {
      const delta = nestedString(notification.params, "delta");
      if (delta)
        await this.#emit(task, "message", "Codex response", undefined, delta);
      return;
    }
    if (notification.method === "turn/completed") {
      const status = nestedString(notification.params, "turn", "status");
      const state: CodingTaskState =
        status === "completed"
          ? "READY_FOR_REVIEW"
          : status === "interrupted"
            ? "BLOCKED"
            : "FAILED";
      this.#update(
        task.id,
        state,
        status === "failed" ? { error: "Codex turn failed" } : {},
      );
      await this.#emit(
        await this.getStatus(task.id),
        state === "FAILED" ? "error" : "state",
        `Codex turn ${status ?? "completed"}`,
        state,
      );
    }
  }

  async #approvalRequest(method: string): Promise<void> {
    const rows = this.#database.connection
      .prepare(
        "SELECT id FROM tasks WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY updated_at DESC LIMIT 1",
      )
      .get() as { id: string } | undefined;
    if (!rows) return;
    const task = await this.getStatus(rows.id);
    this.#update(task.id, "WAITING_APPROVAL");
    await this.#emit(
      await this.getStatus(task.id),
      "approval",
      `Approval requested: ${method}`,
      "WAITING_APPROVAL",
    );
  }

  #update(
    taskId: string,
    state: CodingTaskState,
    values: { threadId?: string; turnId?: string; error?: string } = {},
  ): void {
    this.#database.connection
      .prepare(
        `UPDATE tasks SET state = ?, thread_id = COALESCE(?, thread_id),
      turn_id = COALESCE(?, turn_id), error = COALESCE(?, error), updated_at = ? WHERE id = ?`,
      )
      .run(
        state,
        values.threadId ?? null,
        values.turnId ?? null,
        values.error ?? null,
        new Date().toISOString(),
        taskId,
      );
  }

  async #emit(
    task: CodingTask,
    type: CodingAgentEvent["type"],
    label: string,
    state?: CodingTaskState,
    detail?: string,
  ): Promise<void> {
    const event = codingAgentEventSchema.parse({
      taskId: task.id,
      projectId: task.projectId,
      type,
      label,
      ...(state ? { state } : {}),
      ...(detail ? { detail: detail.slice(0, 20_000) } : {}),
      timestamp: new Date().toISOString(),
    });
    await Promise.all(
      [...this.#listeners].map((listener) => Promise.resolve(listener(event))),
    );
  }
}

export class MockCodingAgentProvider implements CodingAgentProvider {
  readonly #tasks = new Map<string, CodingTask>();
  readonly #listeners = new Set<CodingAgentEventListener>();
  health(): Promise<ProviderHealth> {
    return Promise.resolve({ status: "available", capabilities: ["mock"] });
  }
  async createTask(input: CodingTaskCreate): Promise<CodingTask> {
    const now = new Date().toISOString();
    const { taskId, ...taskInput } = input;
    const task = codingTaskSchema.parse({
      id: taskId ?? randomUUID(),
      ...taskInput,
      state: "QUEUED",
      provider: "mock",
      createdAt: now,
      updatedAt: now,
    });
    this.#tasks.set(task.id, task);
    await this.#emit(task, "Task queued");
    return task;
  }
  startTask(taskId: string): Promise<CodingTask> {
    return this.#state(taskId, "EDITING", "Mock agent started");
  }
  resumeTask(taskId: string): Promise<CodingTask> {
    return this.#state(taskId, "EDITING", "Mock agent resumed");
  }
  pauseTask(taskId: string): Promise<CodingTask> {
    return this.#state(taskId, "BLOCKED", "Mock agent paused");
  }
  cancelTask(taskId: string): Promise<CodingTask> {
    return this.#state(taskId, "CANCELLED", "Mock agent cancelled");
  }
  sendInstruction(taskId: string): Promise<CodingTask> {
    return this.#state(taskId, "EDITING", "Mock instruction received");
  }
  getStatus(taskId: string): Promise<CodingTask> {
    const task = this.#tasks.get(taskId);
    return task
      ? Promise.resolve(task)
      : Promise.reject(
          new CodexProviderError("TASK_NOT_FOUND", "Coding task was not found"),
        );
  }
  subscribeEvents(listener: CodingAgentEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  requestDiff(): Promise<string> {
    return Promise.resolve("diff --git a/mock b/mock\n");
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  async #state(
    taskId: string,
    state: CodingTaskState,
    label: string,
  ): Promise<CodingTask> {
    const task = await this.getStatus(taskId);
    const updated = codingTaskSchema.parse({
      ...task,
      state,
      updatedAt: new Date().toISOString(),
    });
    this.#tasks.set(taskId, updated);
    await this.#emit(updated, label);
    return updated;
  }
  async #emit(task: CodingTask, label: string): Promise<void> {
    const event = codingAgentEventSchema.parse({
      taskId: task.id,
      projectId: task.projectId,
      type: "state",
      state: task.state,
      label,
      timestamp: new Date().toISOString(),
    });
    await Promise.all(
      [...this.#listeners].map((listener) => Promise.resolve(listener(event))),
    );
  }
}

export { GitWorktreeManager, WorktreeError } from "./worktrees.js";

import { execFile } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { JarvisDatabase } from "@jarvis/database";
import {
  worktreeRecordSchema,
  type WorktreeManager,
  type WorktreeRecord,
} from "@jarvis/protocol";

const execFileAsync = promisify(execFile);

export interface GitWorktreeManagerOptions {
  database: JarvisDatabase;
  worktreesRoot: string;
  gitExecutable?: string;
}

export class WorktreeError extends Error {
  override readonly name = "WorktreeError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function safeSegment(value: string): string {
  const segment = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 48);
  return segment || "task";
}

function containedBy(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export class GitWorktreeManager implements WorktreeManager {
  readonly #database: JarvisDatabase;
  readonly #worktreesRoot: string;
  readonly #git: string;
  readonly #creating = new Set<string>();

  constructor(options: GitWorktreeManagerOptions) {
    this.#database = options.database;
    this.#worktreesRoot = resolve(options.worktreesRoot);
    this.#git = options.gitExecutable ?? "git";
  }

  async create(input: {
    taskId: string;
    projectId: string;
    projectPath: string;
    title: string;
  }): Promise<WorktreeRecord> {
    if (this.#creating.has(input.taskId))
      throw new WorktreeError(
        "WORKTREE_BUSY",
        "This task worktree is already being prepared",
      );
    this.#creating.add(input.taskId);
    try {
      const sourcePath = await realpath(resolve(input.projectPath));
      const repositoryRoot = await this.#gitOutput(sourcePath, [
        "rev-parse",
        "--show-toplevel",
      ]).catch(() => {
        throw new WorktreeError(
          "NOT_GIT_REPOSITORY",
          "Coding tasks require a Git repository for isolation",
        );
      });
      const canonicalRoot = await realpath(resolve(repositoryRoot.trim()));
      if (canonicalRoot.toLowerCase() !== sourcePath.toLowerCase())
        throw new WorktreeError(
          "NESTED_REPOSITORY_PATH",
          "Registered project must be the Git repository root",
        );

      const trackedSecrets = await this.#gitOutput(sourcePath, [
        "ls-files",
        "--",
        ":(glob).env*",
        ":(glob)**/.env*",
        ":(glob)**/*.pem",
        ":(glob)**/*.key",
      ]);
      if (trackedSecrets.trim())
        throw new WorktreeError(
          "TRACKED_SECRET_FILE",
          "Repository tracks environment or private-key files; worktree creation was refused",
        );

      const baselineRevision = (
        await this.#gitOutput(sourcePath, ["rev-parse", "HEAD"])
      ).trim();
      const sourceDirty = Boolean(
        (await this.#gitOutput(sourcePath, ["status", "--porcelain"])).trim(),
      );
      const root = resolve(this.#worktreesRoot);
      await mkdir(root, { recursive: true });
      const canonicalStorageRoot = await realpath(root);
      const projectDirectory = resolve(
        canonicalStorageRoot,
        safeSegment(input.projectId),
      );
      const target = resolve(projectDirectory, safeSegment(input.taskId));
      if (!containedBy(canonicalStorageRoot, target))
        throw new WorktreeError(
          "WORKTREE_PATH_ESCAPE",
          "Computed worktree path escaped JARVIS storage",
        );
      if (await exists(target))
        throw new WorktreeError(
          "WORKTREE_TARGET_EXISTS",
          "Task worktree target already exists",
        );
      await mkdir(projectDirectory, { recursive: true });

      const branch = `jarvis/${safeSegment(input.taskId).slice(0, 18)}-${safeSegment(input.title).slice(0, 32)}`;
      try {
        await this.#gitOutput(sourcePath, [
          "worktree",
          "add",
          "-b",
          branch,
          target,
          baselineRevision,
        ]);
      } catch (cause) {
        throw new WorktreeError(
          "WORKTREE_CREATE_FAILED",
          cause instanceof Error
            ? cause.message
            : "Git worktree creation failed",
        );
      }
      const canonicalTarget = await realpath(target);
      if (!containedBy(canonicalStorageRoot, canonicalTarget))
        throw new WorktreeError(
          "WORKTREE_PATH_ESCAPE",
          "Created worktree resolved outside JARVIS storage",
        );
      const createdAt = new Date().toISOString();
      const record = worktreeRecordSchema.parse({
        taskId: input.taskId,
        projectId: input.projectId,
        sourcePath,
        path: canonicalTarget,
        branch,
        baselineRevision,
        sourceDirty,
        createdAt,
      });
      this.#database.connection
        .prepare(
          `INSERT INTO worktrees(
            task_id, project_id, source_path, path, branch, baseline_revision,
            source_dirty, state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        )
        .run(
          record.taskId,
          record.projectId,
          record.sourcePath,
          record.path,
          record.branch,
          record.baselineRevision,
          record.sourceDirty ? 1 : 0,
          record.createdAt,
          record.createdAt,
        );
      return record;
    } finally {
      this.#creating.delete(input.taskId);
    }
  }

  get(taskId: string): WorktreeRecord {
    const row = this.#database.connection
      .prepare(
        `SELECT task_id, project_id, source_path, path, branch, baseline_revision,
          source_dirty, created_at FROM worktrees WHERE task_id = ? AND state = 'ACTIVE'`,
      )
      .get(taskId) as
      | {
          task_id: string;
          project_id: string;
          source_path: string;
          path: string;
          branch: string;
          baseline_revision: string;
          source_dirty: number;
          created_at: string;
        }
      | undefined;
    if (!row)
      throw new WorktreeError(
        "WORKTREE_NOT_FOUND",
        "Active task worktree was not found",
      );
    return worktreeRecordSchema.parse({
      taskId: row.task_id,
      projectId: row.project_id,
      sourcePath: row.source_path,
      path: row.path,
      branch: row.branch,
      baselineRevision: row.baseline_revision,
      sourceDirty: row.source_dirty === 1,
      createdAt: row.created_at,
    });
  }

  async cleanup(taskId: string): Promise<void> {
    const record = this.get(taskId);
    const canonicalStorageRoot = await realpath(this.#worktreesRoot);
    const canonicalTarget = await realpath(record.path).catch(
      () => record.path,
    );
    if (!containedBy(canonicalStorageRoot, canonicalTarget))
      throw new WorktreeError(
        "WORKTREE_PATH_ESCAPE",
        "Refusing to clean a path outside JARVIS worktree storage",
      );
    if (await exists(record.path)) {
      const dirty = (
        await this.#gitOutput(record.path, ["status", "--porcelain"])
      ).trim();
      if (dirty)
        throw new WorktreeError(
          "WORKTREE_DIRTY",
          "Worktree has unreviewed changes and was preserved",
        );
      await this.#gitOutput(record.sourcePath, [
        "worktree",
        "remove",
        record.path,
      ]);
    }
    this.#database.connection
      .prepare(
        "UPDATE worktrees SET state = 'REMOVED', updated_at = ? WHERE task_id = ?",
      )
      .run(new Date().toISOString(), taskId);
  }

  async #gitOutput(cwd: string, args: string[]): Promise<string> {
    const result = await execFileAsync(this.#git, args, {
      cwd,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    return result.stdout;
  }
}

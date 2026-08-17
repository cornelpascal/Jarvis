import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { JarvisDatabase } from "@jarvis/database";
import {
  gitPublishResultSchema,
  gitTaskTargetSchema,
  type GitPublishResult,
  type GitTaskProvider,
  type GitTaskTarget,
} from "@jarvis/protocol";

const execFileAsync = promisify(execFile);
const TASK_STATES = ["READY_FOR_REVIEW", "COMPLETED"];
const SECRET_PATH = /(^|\/)(?:\.env(?!\.example$)|.*\.(?:pem|p12|pfx|key))$/i;

interface TaskRow {
  task_id: string;
  project_id: string;
  title: string;
  path: string;
  branch: string;
}

export class GitTaskError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GitTaskError";
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
    encoding: "utf8",
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return result.stdout.trim();
}

function changedPaths(status: string): string[] {
  const entries = status.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    paths.push(entry.slice(3).replaceAll("\\", "/"));
    if (entry[0] === "R" || entry[1] === "R") {
      const renamed = entries[index + 1];
      if (renamed) paths.push(renamed.replaceAll("\\", "/"));
      index += 1;
    }
  }
  return paths;
}

export class GitTaskManager implements GitTaskProvider {
  readonly #database: JarvisDatabase;

  constructor(database: JarvisDatabase) {
    this.#database = database;
  }

  async resolve(input: {
    text: string;
    activeTaskId?: string;
    activeProjectId?: string;
  }): Promise<GitTaskTarget> {
    if (!/\bpush\b/i.test(input.text))
      throw new GitTaskError(
        "EXPLICIT_PUSH_REQUIRED",
        "Only an explicit push command can start Git publication",
      );
    const rows = this.#rows(input.activeProjectId);
    let selected: TaskRow | undefined;
    if (input.activeTaskId)
      selected = rows.find((row) => row.task_id === input.activeTaskId);
    const ordinal = /\bcodex[\s-]*(\d+)\b/i.exec(input.text)?.[1];
    if (!selected && ordinal) selected = rows[Number(ordinal) - 1];
    if (!selected) {
      const normalized = input.text.toLocaleLowerCase();
      const named = rows.filter((row) =>
        normalized.includes(row.title.toLocaleLowerCase()),
      );
      if (named.length === 1) selected = named[0];
    }
    if (!selected && rows.length === 1) selected = rows[0];
    if (!selected)
      throw new GitTaskError(
        rows.length === 0 ? "NO_PUSHABLE_TASK" : "AMBIGUOUS_TASK",
        rows.length === 0
          ? "No task is ready to push"
          : "More than one task is ready; name the task or Codex agent",
      );
    return this.preview(selected.task_id);
  }

  async preview(taskId: string): Promise<GitTaskTarget> {
    const row = this.#row(taskId);
    const branch = await git(row.path, ["branch", "--show-current"]);
    if (branch !== row.branch || !branch.startsWith("jarvis/"))
      throw new GitTaskError(
        "BRANCH_MISMATCH",
        "Task worktree is not on its owned JARVIS branch",
      );
    const headRevision = await git(row.path, ["rev-parse", "HEAD"]);
    const status = await git(row.path, ["status", "--porcelain=v1", "-z"]);
    const paths = changedPaths(status);
    const secret = paths.find((path) => SECRET_PATH.test(path));
    if (secret)
      throw new GitTaskError(
        "SECRET_PATH_CHANGED",
        "Task changes include a secret-bearing path and cannot be published",
      );
    return gitTaskTargetSchema.parse({
      taskId: row.task_id,
      projectId: row.project_id,
      title: row.title,
      worktreePath: row.path,
      branch,
      headRevision,
      changesDigest: createHash("sha256").update(status).digest("hex"),
      hasChanges: paths.length > 0,
    });
  }

  async publish(
    taskId: string,
    expected: GitTaskTarget,
  ): Promise<GitPublishResult> {
    const current = await this.preview(taskId);
    if (
      current.branch !== expected.branch ||
      current.headRevision !== expected.headRevision ||
      current.changesDigest !== expected.changesDigest
    )
      throw new GitTaskError(
        "TASK_CHANGED_AFTER_APPROVAL",
        "Task branch or changes changed after approval; review and approve again",
      );
    let committed = false;
    if (current.hasChanges) {
      await git(current.worktreePath, ["add", "--all"]);
      await git(current.worktreePath, ["diff", "--cached", "--check"]);
      await git(current.worktreePath, [
        "commit",
        "-m",
        `JARVIS task ${taskId.slice(0, 12)}`,
      ]);
      committed = true;
    }
    const remote = await git(current.worktreePath, [
      "remote",
      "get-url",
      "origin",
    ]);
    try {
      const parsed = new URL(remote);
      if (parsed.username || parsed.password)
        throw new GitTaskError(
          "CREDENTIAL_IN_REMOTE",
          "Credential-bearing Git remotes are not allowed",
        );
    } catch (cause) {
      if (cause instanceof GitTaskError) throw cause;
      // SCP-style and local-path remotes are valid and contain no URL credentials.
    }
    await git(current.worktreePath, [
      "push",
      "--set-upstream",
      "origin",
      current.branch,
    ]);
    const revision = await git(current.worktreePath, ["rev-parse", "HEAD"]);
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(
        "UPDATE tasks SET state = 'COMPLETED', branch = ?, worktree_path = ?, updated_at = ? WHERE id = ?",
      )
      .run(current.branch, current.worktreePath, now, taskId);
    return gitPublishResultSchema.parse({
      taskId,
      projectId: current.projectId,
      branch: current.branch,
      revision,
      remote: "origin",
      committed,
    });
  }

  #rows(projectId?: string): TaskRow[] {
    return this.#database.connection
      .prepare(
        `SELECT t.id AS task_id,t.project_id,t.title,w.path,w.branch
         FROM tasks t JOIN worktrees w ON w.task_id = t.id
         WHERE w.state = 'ACTIVE' AND t.state IN (${TASK_STATES.map(() => "?").join(",")})
         ${projectId ? "AND t.project_id = ?" : ""}
         ORDER BY t.created_at ASC, t.id ASC`,
      )
      .all(
        ...TASK_STATES,
        ...(projectId ? [projectId] : []),
      ) as unknown as TaskRow[];
  }

  #row(taskId: string): TaskRow {
    const row = this.#rows().find((candidate) => candidate.task_id === taskId);
    if (!row)
      throw new GitTaskError("TASK_NOT_READY", "Task is not ready to push");
    return row;
  }
}

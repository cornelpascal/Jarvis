import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  openJarvisDatabase,
  type JarvisDatabase,
} from "../packages/database/src/index.js";
import {
  GitWorktreeManager,
  WorktreeError,
} from "../services/codex-manager/src/index.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Jarvis Test",
      GIT_AUTHOR_EMAIL: "jarvis-test@localhost",
      GIT_COMMITTER_NAME: "Jarvis Test",
      GIT_COMMITTER_EMAIL: "jarvis-test@localhost",
    },
  });
  return result.stdout;
}

function insertProject(
  database: JarvisDatabase,
  id: string,
  path: string,
): void {
  const now = new Date().toISOString();
  database.connection
    .prepare(
      "INSERT INTO projects(id, name, path, enabled, created_at, updated_at) VALUES (?, 'Fixture', ?, 1, ?, ?)",
    )
    .run(id, path, now, now);
}

describe("Git worktree manager", () => {
  let temporary: string | undefined;
  let database: JarvisDatabase | undefined;

  afterEach(async () => {
    database?.close();
    if (temporary)
      await rm(temporary, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    temporary = undefined;
  });

  it("creates unique isolated branches while preserving a dirty source checkout", async () => {
    temporary = await mkdtemp(join(tmpdir(), "jarvis-worktrees-"));
    const repository = join(temporary, "repo");
    const storage = join(temporary, "managed");
    await mkdir(repository);
    await git(repository, ["init", "-b", "main"]);
    await writeFile(join(repository, "app.ts"), "export const value = 1;\n");
    await git(repository, ["add", "app.ts"]);
    await git(repository, ["commit", "-m", "initial"]);
    await writeFile(
      join(repository, "local-notes.txt"),
      "source-only dirty state\n",
    );

    database = openJarvisDatabase(":memory:");
    insertProject(database, "project-one", repository);
    const manager = new GitWorktreeManager({
      database,
      worktreesRoot: storage,
    });
    const [first, second] = await Promise.all([
      manager.create({
        taskId: "task-001",
        projectId: "project-one",
        projectPath: repository,
        title: "Fix Login",
      }),
      manager.create({
        taskId: "task-002",
        projectId: "project-one",
        projectPath: repository,
        title: "Add Search",
      }),
    ]);
    expect(first.path).not.toBe(second.path);
    expect(first.branch).not.toBe(second.branch);
    expect(first.sourceDirty).toBe(true);
    await expect(
      readFile(join(first.path, "app.ts"), "utf8"),
    ).resolves.toContain("value = 1");
    await expect(
      readFile(join(first.path, "local-notes.txt"), "utf8"),
    ).rejects.toThrow();
    expect(await git(first.path, ["branch", "--show-current"])).toContain(
      first.branch,
    );
    await manager.cleanup(first.taskId);
    await manager.cleanup(second.taskId);
  }, 20_000);

  it("preserves dirty worktrees and removes only a clean owned worktree", async () => {
    temporary = await mkdtemp(join(tmpdir(), "jarvis-worktree-cleanup-"));
    const repository = join(temporary, "repo");
    await mkdir(repository);
    await git(repository, ["init", "-b", "main"]);
    await writeFile(join(repository, "app.ts"), "one\n");
    await git(repository, ["add", "app.ts"]);
    await git(repository, ["commit", "-m", "initial"]);
    database = openJarvisDatabase(":memory:");
    insertProject(database, "project-cleanup", repository);
    const manager = new GitWorktreeManager({
      database,
      worktreesRoot: join(temporary, "managed"),
    });
    const record = await manager.create({
      taskId: "task-cleanup",
      projectId: "project-cleanup",
      projectPath: repository,
      title: "Cleanup",
    });
    await writeFile(join(record.path, "app.ts"), "changed\n");
    await expect(manager.cleanup(record.taskId)).rejects.toMatchObject<
      Partial<WorktreeError>
    >({ code: "WORKTREE_DIRTY" });
    await git(record.path, ["restore", "app.ts"]);
    await manager.cleanup(record.taskId);
    expect(() => manager.get(record.taskId)).toThrowError(WorktreeError);
  });

  it("rejects non-Git folders and repositories with tracked environment files", async () => {
    temporary = await mkdtemp(join(tmpdir(), "jarvis-worktree-policy-"));
    const plain = join(temporary, "plain");
    await mkdir(plain);
    database = openJarvisDatabase(":memory:");
    insertProject(database, "plain", plain);
    const manager = new GitWorktreeManager({
      database,
      worktreesRoot: join(temporary, "managed"),
    });
    await expect(
      manager.create({
        taskId: "plain-task",
        projectId: "plain",
        projectPath: plain,
        title: "No Git",
      }),
    ).rejects.toMatchObject<Partial<WorktreeError>>({
      code: "NOT_GIT_REPOSITORY",
    });

    const repository = join(temporary, "secret-repo");
    await mkdir(repository);
    await git(repository, ["init", "-b", "main"]);
    await writeFile(join(repository, ".env"), "SECRET=tracked\n");
    await git(repository, ["add", ".env"]);
    await git(repository, ["commit", "-m", "tracked secret fixture"]);
    insertProject(database, "secret", repository);
    await expect(
      manager.create({
        taskId: "secret-task",
        projectId: "secret",
        projectPath: repository,
        title: "Unsafe",
      }),
    ).rejects.toMatchObject<Partial<WorktreeError>>({
      code: "TRACKED_SECRET_FILE",
    });
  });
});

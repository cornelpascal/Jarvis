import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openJarvisDatabase } from "../packages/database/src/index.js";
import {
  GitTaskError,
  GitTaskManager,
} from "../services/codex-manager/src/index.js";

const temporaryDirectories: string[] = [];

function run(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function fixture(taskCount = 1) {
  const root = await mkdtemp(join(tmpdir(), "jarvis-git-push-"));
  temporaryDirectories.push(root);
  const remote = join(root, "remote.git");
  const source = join(root, "source");
  await mkdir(source);
  run(root, ["init", "--bare", remote]);
  run(source, ["init", "-b", "main"]);
  run(source, ["config", "user.email", "test@jarvis.local"]);
  run(source, ["config", "user.name", "JARVIS Test"]);
  await writeFile(join(source, "app.ts"), "export const value = 1;\n");
  run(source, ["add", "app.ts"]);
  run(source, ["commit", "-m", "initial"]);
  run(source, ["remote", "add", "origin", remote]);
  run(source, ["push", "-u", "origin", "main"]);
  const baseline = run(source, ["rev-parse", "HEAD"]);
  const database = openJarvisDatabase(":memory:");
  const now = new Date().toISOString();
  database.connection
    .prepare(
      "INSERT INTO projects(id,name,path,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run("project-1", "Fixture", source, 1, now, now);
  const worktrees: string[] = [];
  for (let index = 1; index <= taskCount; index += 1) {
    const taskId = `task-${String(index)}`;
    const branch = `jarvis/${taskId}`;
    const path = join(root, `worktree-${String(index)}`);
    run(source, ["worktree", "add", "-b", branch, path, baseline]);
    run(path, ["config", "user.email", "test@jarvis.local"]);
    run(path, ["config", "user.name", "JARVIS Test"]);
    database.connection
      .prepare(
        `INSERT INTO tasks(id,project_id,title,state,worktree_path,branch,created_at,updated_at,
         instruction,working_directory,provider) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        taskId,
        "project-1",
        `Task ${String(index)}`,
        "READY_FOR_REVIEW",
        path,
        branch,
        now,
        new Date(Date.now() + index).toISOString(),
        "Change fixture",
        path,
        "mock",
      );
    database.connection
      .prepare(
        `INSERT INTO worktrees(task_id,project_id,source_path,path,branch,baseline_revision,
         source_dirty,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        taskId,
        "project-1",
        source,
        path,
        branch,
        baseline,
        0,
        "ACTIVE",
        now,
        now,
      );
    worktrees.push(path);
  }
  return { root, remote, source, database, worktrees };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true, maxRetries: 3 }),
      ),
  );
});

describe("Git task manager", () => {
  it("commits and pushes only the owned task branch to origin", async () => {
    const { remote, database, worktrees } = await fixture();
    const worktree = worktrees[0] as string;
    await writeFile(join(worktree, "app.ts"), "export const value = 2;\n");
    const manager = new GitTaskManager(database);
    const target = await manager.resolve({
      text: "Push it",
      activeTaskId: "task-1",
    });

    const result = await manager.publish("task-1", target);

    expect(result).toMatchObject({
      branch: "jarvis/task-1",
      remote: "origin",
      committed: true,
    });
    expect(run(remote, ["rev-parse", "refs/heads/jarvis/task-1"])).toBe(
      result.revision,
    );
    expect(run(worktree, ["log", "-1", "--pretty=%s"])).toBe(
      "JARVIS task task-1",
    );
    database.close();
  }, 20_000);

  it("requires explicit wording and rejects ambiguous task references", async () => {
    const { database } = await fixture(2);
    const manager = new GitTaskManager(database);

    await expect(manager.resolve({ text: "Looks good" })).rejects.toMatchObject(
      { code: "EXPLICIT_PUSH_REQUIRED" },
    );
    await expect(manager.resolve({ text: "Push it" })).rejects.toMatchObject({
      code: "AMBIGUOUS_TASK",
    });
    await expect(
      manager.resolve({ text: "Push Codex 2" }),
    ).resolves.toMatchObject({ taskId: "task-2" });
    database.close();
  }, 20_000);

  it("refuses secret-bearing changes before approval or staging", async () => {
    const { database, worktrees } = await fixture();
    await writeFile(join(worktrees[0] as string, ".env"), "TOKEN=secret\n");
    const manager = new GitTaskManager(database);

    await expect(manager.preview("task-1")).rejects.toBeInstanceOf(
      GitTaskError,
    );
    expect(
      run(worktrees[0] as string, ["diff", "--cached", "--name-only"]),
    ).toBe("");
    database.close();
  }, 20_000);
});

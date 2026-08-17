import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openJarvisDatabase } from "../packages/database/src/index.js";
import { LocalEventBus } from "../packages/event-bus/src/index.js";
import { TaskVerificationService } from "../services/codex-manager/src/index.js";

const temporaryDirectories: string[] = [];

async function fixture(failingCheck?: string) {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-verification-"));
  temporaryDirectories.push(directory);
  execFileSync("git", ["init", "-b", "main"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "test@jarvis.local"], {
    cwd: directory,
  });
  execFileSync("git", ["config", "user.name", "JARVIS Test"], {
    cwd: directory,
  });
  await writeFile(join(directory, "app.ts"), "export const answer = 41;\n");
  execFileSync("git", ["add", "app.ts"], { cwd: directory });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: directory });
  const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
  await writeFile(join(directory, "app.ts"), "export const answer = 42;\n");
  const runner = join(directory, "runner.mjs");
  await writeFile(
    runner,
    `const check = process.argv.at(-1); console.log("checked:" + check); process.exit(check === ${JSON.stringify(failingCheck ?? "")} ? 1 : 0);\n`,
  );
  const database = openJarvisDatabase(":memory:");
  const now = new Date().toISOString();
  database.connection
    .prepare(
      "INSERT INTO projects(id,name,path,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run("project-1", "Fixture", directory, 1, now, now);
  database.connection
    .prepare(
      "INSERT INTO project_metadata(project_id,key,value_json,updated_at) VALUES (?,?,?,?)",
    )
    .run(
      "project-1",
      "analysis",
      JSON.stringify({
        commands: {
          lint: { command: "pnpm lint", source: "package.json" },
          typecheck: null,
          test: { command: "npm run test", source: "package.json" },
          build: { command: "yarn build", source: "package.json" },
        },
      }),
      now,
    );
  database.connection
    .prepare(
      `INSERT INTO tasks(id,project_id,title,state,worktree_path,created_at,updated_at,
       instruction,working_directory,provider) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "task-1",
      "project-1",
      "Verify fixture",
      "READY_FOR_REVIEW",
      directory,
      now,
      now,
      "Change the answer",
      directory,
      "mock",
    );
  database.connection
    .prepare(
      `INSERT INTO worktrees(task_id,project_id,source_path,path,branch,baseline_revision,
       source_dirty,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "task-1",
      "project-1",
      directory,
      directory,
      "jarvis/task-1",
      baseline,
      0,
      "ACTIVE",
      now,
      now,
    );
  return { directory, runner, database };
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

describe("task verification", () => {
  it("runs evidence-backed checks and returns a baseline diff", async () => {
    const { database, runner } = await fixture();
    const bus = new LocalEventBus();
    const eventTypes: string[] = [];
    bus.subscribe((event) => eventTypes.push(event.type));
    const service = new TaskVerificationService({
      database,
      bus,
      runner: { executable: process.execPath, prefixArgs: [runner] },
    });

    const report = await service.verify("task-1");

    expect(report.passed).toBe(true);
    expect(report.checks.map((check) => check.status)).toEqual([
      "PASSED",
      "SKIPPED",
      "PASSED",
      "PASSED",
    ]);
    expect(report.diff).toContain("answer = 42");
    expect(eventTypes).toContain("codex.tests.passed");
    expect(eventTypes).toContain("codex.diff.ready");
    database.close();
  }, 15_000);

  it("reports failed checks without hiding the diff", async () => {
    const { database, runner } = await fixture("build");
    const bus = new LocalEventBus();
    const eventTypes: string[] = [];
    bus.subscribe((event) => eventTypes.push(event.type));
    const service = new TaskVerificationService({
      database,
      bus,
      runner: { executable: process.execPath, prefixArgs: [runner] },
    });

    const report = await service.verify("task-1");

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.name === "build")?.status).toBe(
      "FAILED",
    );
    expect(report.diff).toContain("answer = 42");
    expect(eventTypes).toContain("codex.tests.failed");
    database.close();
  }, 15_000);
});

import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import {
  verificationReportSchema,
  type TaskVerificationProvider,
  type VerificationCheck,
  type VerificationReport,
} from "@jarvis/protocol";

const execFileAsync = promisify(execFile);
const CHECK_NAMES = ["lint", "typecheck", "test", "build"] as const;

interface CommandEvidence {
  command: string;
  source: string;
}

interface ProjectAnalysis {
  commands?: Record<string, CommandEvidence | null>;
}

export interface TaskVerificationOptions {
  database: JarvisDatabase;
  bus: LocalEventBus;
  timeoutMs?: number;
  runner?: { executable: string; prefixArgs?: string[] };
}

function parsePackageCommand(command: string): {
  manager: "npm" | "pnpm" | "yarn";
  args: string[];
} {
  const parts = command.trim().split(/\s+/);
  const manager = parts.shift();
  if (manager !== "npm" && manager !== "pnpm" && manager !== "yarn")
    throw new Error("Only npm, pnpm, or yarn project checks are supported");
  if (
    parts.length < 1 ||
    parts.length > 2 ||
    parts.some((part) => !/^[a-z0-9:_-]+$/i.test(part)) ||
    (manager === "npm" && (parts.length !== 2 || parts[0] !== "run"))
  )
    throw new Error(
      "Project check command is outside the typed package-script form",
    );
  return { manager, args: parts };
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const path of paths)
    try {
      await access(path);
      return path;
    } catch {
      // Continue through fixed installation candidates.
    }
  return undefined;
}

async function packageManagerInvocation(
  command: string,
  override?: { executable: string; prefixArgs?: string[] },
): Promise<{ executable: string; args: string[] }> {
  const parsed = parsePackageCommand(command);
  if (override)
    return {
      executable: override.executable,
      args: [...(override.prefixArgs ?? []), parsed.manager, ...parsed.args],
    };
  if (process.platform !== "win32")
    return { executable: parsed.manager, args: parsed.args };
  const appData = process.env.APPDATA;
  const nodeDirectory = dirname(process.execPath);
  const candidates: Record<typeof parsed.manager, string[]> = {
    pnpm: [
      ...(appData
        ? [join(appData, "npm", "node_modules", "pnpm", "bin", "pnpm.cjs")]
        : []),
    ],
    npm: [join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js")],
    yarn: [
      ...(appData
        ? [join(appData, "npm", "node_modules", "yarn", "bin", "yarn.js")]
        : []),
    ],
  };
  const entrypoint = await firstExisting(candidates[parsed.manager]);
  if (!entrypoint)
    throw new Error(`${parsed.manager} JavaScript entrypoint was not found`);
  return { executable: process.execPath, args: [entrypoint, ...parsed.args] };
}

async function runBounded(
  invocation: { executable: string; args: string[] },
  cwd: string,
  timeoutMs: number,
): Promise<{
  status: "PASSED" | "FAILED" | "TIMED_OUT";
  exitCode?: number;
  durationMs: number;
  output: string;
}> {
  const started = Date.now();
  return new Promise((resolveRun) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
        ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {}),
        ...(process.env.TMP ? { TMP: process.env.TMP } : {}),
        CI: "1",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer): void => {
      if (output.length < 1024 * 1024)
        output += chunk.toString("utf8").slice(0, 1024 * 1024 - output.length);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({
        status: "FAILED",
        durationMs: Date.now() - started,
        output: `${output}\n${error.message}`.trim(),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({
        status: timedOut ? "TIMED_OUT" : code === 0 ? "PASSED" : "FAILED",
        ...(typeof code === "number" ? { exitCode: code } : {}),
        durationMs: Date.now() - started,
        output: output.trim(),
      });
    });
  });
}

export class TaskVerificationService implements TaskVerificationProvider {
  readonly #database: JarvisDatabase;
  readonly #bus: LocalEventBus;
  readonly #timeoutMs: number;
  readonly #runner: { executable: string; prefixArgs?: string[] } | undefined;

  constructor(options: TaskVerificationOptions) {
    this.#database = options.database;
    this.#bus = options.bus;
    this.#timeoutMs = options.timeoutMs ?? 10 * 60_000;
    this.#runner = options.runner;
  }

  async verify(taskId: string): Promise<VerificationReport> {
    const task = this.#database.connection
      .prepare(
        `SELECT t.project_id, t.working_directory, w.baseline_revision
         FROM tasks t JOIN worktrees w ON w.task_id = t.id
         WHERE t.id = ? AND w.state = 'ACTIVE'`,
      )
      .get(taskId) as
      | {
          project_id: string;
          working_directory: string;
          baseline_revision: string;
        }
      | undefined;
    if (!task) throw new Error("Active isolated task was not found");
    const metadata = this.#database.connection
      .prepare(
        "SELECT value_json FROM project_metadata WHERE project_id = ? AND key = 'analysis'",
      )
      .get(task.project_id) as { value_json: string } | undefined;
    const analysis: ProjectAnalysis = metadata
      ? (JSON.parse(metadata.value_json) as ProjectAnalysis)
      : {};
    const available = CHECK_NAMES.filter(
      (name) => analysis.commands?.[name]?.command,
    );
    await this.#bus.publish(
      this.#bus.create("codex.tests.started", "codex.verification", {
        taskId,
        projectId: task.project_id,
        checkCount: available.length,
      }),
    );
    const checks: VerificationCheck[] = [];
    for (const name of CHECK_NAMES) {
      const evidence = analysis.commands?.[name];
      if (!evidence) {
        checks.push({
          name,
          command: "not configured",
          status: "SKIPPED",
          durationMs: 0,
          output: "No evidence-backed project command",
        });
        continue;
      }
      await this.#bus.publish(
        this.#bus.create("codex.command.started", "codex.verification", {
          taskId,
          projectId: task.project_id,
          name,
          command: evidence.command,
        }),
      );
      let result: Awaited<ReturnType<typeof runBounded>>;
      try {
        result = await runBounded(
          await packageManagerInvocation(evidence.command, this.#runner),
          task.working_directory,
          this.#timeoutMs,
        );
      } catch (cause) {
        result = {
          status: "FAILED",
          durationMs: 0,
          output:
            cause instanceof Error ? cause.message : "Check runner failed",
        };
      }
      const check: VerificationCheck = {
        name,
        command: evidence.command,
        ...result,
      };
      checks.push(check);
      await this.#bus.publish(
        this.#bus.create("codex.command.completed", "codex.verification", {
          taskId,
          projectId: task.project_id,
          name,
          status: result.status,
          ...(result.exitCode !== undefined
            ? { exitCode: result.exitCode }
            : {}),
          durationMs: result.durationMs,
        }),
      );
    }
    const diffResult = await execFileAsync(
      "git",
      ["diff", "--no-ext-diff", "--unified=3", task.baseline_revision, "--"],
      {
        cwd: task.working_directory,
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: "utf8",
      },
    );
    const diff = diffResult.stdout;
    const failed = checks.filter(
      (check) => check.status === "FAILED" || check.status === "TIMED_OUT",
    );
    const report = verificationReportSchema.parse({
      taskId,
      projectId: task.project_id,
      passed: failed.length === 0,
      checks,
      diff,
      completedAt: new Date().toISOString(),
    });
    if (report.passed)
      await this.#bus.publish(
        this.#bus.create("codex.tests.passed", "codex.verification", {
          taskId,
          projectId: task.project_id,
          checkCount: available.length,
        }),
      );
    else
      await this.#bus.publish(
        this.#bus.create("codex.tests.failed", "codex.verification", {
          taskId,
          projectId: task.project_id,
          failedChecks: failed.map((check) => check.name),
        }),
      );
    await this.#bus.publish(
      this.#bus.create("codex.diff.ready", "codex.verification", {
        taskId,
        projectId: task.project_id,
        diff,
      }),
    );
    return report;
  }
}

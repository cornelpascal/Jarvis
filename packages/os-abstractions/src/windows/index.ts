import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  systemActionResultSchema,
  type ProviderHealth,
  type SystemAction,
  type SystemActionResult,
  type SystemControlProvider,
  type TelemetryProvider,
} from "@jarvis/protocol";

const execFileAsync = promisify(execFile);

export class WindowsTelemetryProvider implements TelemetryProvider {
  health(): Promise<ProviderHealth> {
    return Promise.resolve({
      status: process.platform === "win32" ? "available" : "unavailable",
      capabilities: ["cpu", "memory", "disk", "network"],
    });
  }
}

type Executor = (
  executable: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const APPLICATIONS = {
  notepad: "notepad.exe",
  calculator: "calc.exe",
  explorer: "explorer.exe",
  terminal: "wt.exe",
} as const;

async function defaultExecutor(
  executable: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(executable, args, {
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 512 * 1024,
    encoding: "utf8",
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    },
  });
}

async function existingPath(path: string, expected: "file" | "directory") {
  const canonical = resolve(path);
  const info = await lstat(canonical);
  if (
    info.isSymbolicLink() ||
    (expected === "file" ? !info.isFile() : !info.isDirectory())
  )
    throw new Error(`Expected an existing ${expected}`);
  return canonical;
}

function cpuPercent(): number {
  const totals = cpus().reduce(
    (sum, cpu) => ({
      idle: sum.idle + cpu.times.idle,
      total:
        sum.total +
        Object.values(cpu.times).reduce((value, time) => value + time, 0),
    }),
    { idle: 0, total: 0 },
  );
  return totals.total === 0 ? 0 : (1 - totals.idle / totals.total) * 100;
}

export class WindowsSystemControlProvider implements SystemControlProvider {
  readonly #platform: NodeJS.Platform;
  readonly #execute: Executor;

  constructor(
    options: { platform?: NodeJS.Platform; executor?: Executor } = {},
  ) {
    this.#platform = options.platform ?? process.platform;
    this.#execute = options.executor ?? defaultExecutor;
  }

  health(): Promise<ProviderHealth> {
    return Promise.resolve({
      status: this.#platform === "win32" ? "available" : "unavailable",
      capabilities: [
        "open_application",
        "open_url",
        "open_explorer",
        "reveal_file",
        "open_terminal",
        "get_running_apps",
        "get_system_stats",
      ],
    });
  }

  async execute(action: SystemAction): Promise<SystemActionResult> {
    if (this.#platform !== "win32")
      throw new Error(
        "Windows system controls are unavailable on this platform",
      );
    switch (action.action) {
      case "open_application":
        await this.#execute(APPLICATIONS[action.application], []);
        break;
      case "open_url":
        await this.#execute("explorer.exe", [action.url]);
        break;
      case "open_explorer":
        await this.#execute("explorer.exe", [
          await existingPath(action.path, "directory"),
        ]);
        break;
      case "reveal_file":
        await this.#execute("explorer.exe", [
          `/select,${await existingPath(action.path, "file")}`,
        ]);
        break;
      case "open_terminal":
        await this.#execute("wt.exe", [
          "-d",
          await existingPath(action.path, "directory"),
        ]);
        break;
      case "get_running_apps": {
        const result = await this.#execute("powershell.exe", [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress",
        ]);
        let data: unknown = [];
        if (result.stdout.trim()) data = JSON.parse(result.stdout) as unknown;
        return systemActionResultSchema.parse({
          requestId: action.requestId,
          action: action.action,
          success: true,
          message: "Running applications retrieved",
          data,
        });
      }
      case "get_system_stats": {
        const ramTotalBytes = totalmem();
        return systemActionResultSchema.parse({
          requestId: action.requestId,
          action: action.action,
          success: true,
          message: "System statistics retrieved",
          data: {
            cpuPercent: cpuPercent(),
            ramUsedBytes: ramTotalBytes - freemem(),
            ramTotalBytes,
          },
        });
      }
    }
    return systemActionResultSchema.parse({
      requestId: action.requestId,
      action: action.action,
      success: true,
      message: `${action.action} completed`,
    });
  }
}

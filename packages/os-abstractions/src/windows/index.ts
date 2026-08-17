import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, unlink } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  systemActionResultSchema,
  type ProviderHealth,
  type SystemAction,
  type SystemActionResult,
  type SystemControlProvider,
  type ScreenshotProvider,
  type ScreenshotRequest,
  type ScreenshotResult,
  screenshotResultSchema,
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

const CAPTURE_SCRIPT = String.raw`
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class JarvisWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
$title = ""
if ($env:JARVIS_CAPTURE_MODE -eq "active_window") {
  $handle = [JarvisWindowCapture]::GetForegroundWindow()
  $rect = New-Object JarvisWindowCapture+RECT
  if (-not [JarvisWindowCapture]::GetWindowRect($handle, [ref]$rect)) { throw "Unable to read active window bounds" }
  $bounds = New-Object System.Drawing.Rectangle($rect.Left, $rect.Top, $rect.Right - $rect.Left, $rect.Bottom - $rect.Top)
  $text = New-Object System.Text.StringBuilder 512
  [void][JarvisWindowCapture]::GetWindowText($handle, $text, $text.Capacity)
  $title = $text.ToString()
} else {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
}
if ($bounds.Width -le 0 -or $bounds.Height -le 0) { throw "Capture bounds are empty" }
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save($env:JARVIS_CAPTURE_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
@{ width = $bounds.Width; height = $bounds.Height; title = $title } | ConvertTo-Json -Compress
`;

type CaptureExecutor = (
  mode: ScreenshotRequest["mode"],
  outputPath: string,
) => Promise<{ width: number; height: number; title?: string }>;

async function defaultCaptureExecutor(
  mode: ScreenshotRequest["mode"],
  outputPath: string,
): Promise<{ width: number; height: number; title?: string }> {
  const result = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", CAPTURE_SCRIPT],
    {
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 64 * 1024,
      encoding: "utf8",
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
        JARVIS_CAPTURE_MODE: mode,
        JARVIS_CAPTURE_PATH: outputPath,
      },
    },
  );
  const metadata = JSON.parse(result.stdout.trim()) as {
    width: number;
    height: number;
    title?: string;
  };
  return metadata;
}

export class WindowsScreenshotProvider implements ScreenshotProvider {
  readonly #platform: NodeJS.Platform;
  readonly #root: string;
  readonly #capture: CaptureExecutor;

  constructor(options: {
    root: string;
    platform?: NodeJS.Platform;
    captureExecutor?: CaptureExecutor;
  }) {
    this.#root = resolve(options.root);
    this.#platform = options.platform ?? process.platform;
    this.#capture = options.captureExecutor ?? defaultCaptureExecutor;
  }

  health(): Promise<ProviderHealth> {
    return Promise.resolve({
      status: this.#platform === "win32" ? "available" : "unavailable",
      capabilities: ["active_window", "primary_display", "ephemeral_png"],
    });
  }

  async capture(request: ScreenshotRequest): Promise<ScreenshotResult> {
    if (this.#platform !== "win32")
      throw new Error("Windows screen capture is unavailable on this platform");
    await mkdir(this.#root, { recursive: true });
    const contextId = randomUUID();
    const outputPath = resolve(this.#root, `${contextId}.png`);
    const relativeOutput = relative(this.#root, outputPath);
    if (
      !relativeOutput ||
      relativeOutput.startsWith("..") ||
      isAbsolute(relativeOutput)
    )
      throw new Error("Screenshot output escaped its ephemeral root");
    try {
      const metadata = await this.#capture(request.mode, outputPath);
      const image = await readFile(outputPath);
      if (image.length === 0 || image.length > 10 * 1024 * 1024)
        throw new Error("Screenshot is empty or exceeds the 10 MiB limit");
      return screenshotResultSchema.parse({
        contextId,
        requestId: request.requestId,
        mode: request.mode,
        mimeType: "image/png",
        imageBase64: image.toString("base64"),
        byteLength: image.length,
        width: metadata.width,
        height: metadata.height,
        ...(metadata.title ? { activeApplication: metadata.title } : {}),
        capturedAt: new Date().toISOString(),
        retention: "ephemeral",
      });
    } finally {
      await unlink(outputPath).catch(() => undefined);
    }
  }
}

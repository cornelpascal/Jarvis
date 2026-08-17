import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { systemActionSchema } from "../packages/protocol/src/index.js";
import { WindowsSystemControlProvider } from "../packages/os-abstractions/src/windows/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Windows system controls", () => {
  it("maps application and URL actions to fixed executable argument arrays", async () => {
    const calls: Array<{ executable: string; args: string[] }> = [];
    const provider = new WindowsSystemControlProvider({
      platform: "win32",
      executor: (executable, args) => {
        calls.push({ executable, args });
        return Promise.resolve({ stdout: "", stderr: "" });
      },
    });
    await provider.execute(
      systemActionSchema.parse({
        requestId: "8019aa8a-b8a3-497a-ad9f-e7e72fc06011",
        action: "open_application",
        application: "notepad",
      }),
    );
    await provider.execute(
      systemActionSchema.parse({
        requestId: "8c645b14-f80e-4507-8a60-fcac818b0e08",
        action: "open_url",
        url: "https://example.com/?q=safe%20value",
      }),
    );
    expect(calls).toEqual([
      { executable: "notepad.exe", args: [] },
      {
        executable: "explorer.exe",
        args: ["https://example.com/?q=safe%20value"],
      },
    ]);
  });

  it("validates filesystem targets before Explorer or Terminal invocation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jarvis-system-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "fixture.txt");
    await writeFile(file, "fixture");
    const calls: Array<{ executable: string; args: string[] }> = [];
    const provider = new WindowsSystemControlProvider({
      platform: "win32",
      executor: (executable, args) => {
        calls.push({ executable, args });
        return Promise.resolve({ stdout: "", stderr: "" });
      },
    });
    await provider.execute({
      requestId: "c816054f-7d64-48c5-802d-a8c3b63eab07",
      action: "open_terminal",
      path: directory,
    });
    await provider.execute({
      requestId: "fa11b27e-4025-4baa-af63-cc59e649ba82",
      action: "reveal_file",
      path: file,
    });
    expect(calls[0]).toMatchObject({
      executable: "wt.exe",
      args: ["-d", directory],
    });
    expect(calls[1]?.executable).toBe("explorer.exe");
    await expect(
      provider.execute({
        requestId: "a80c9121-35ac-494a-9127-e382708cabf7",
        action: "reveal_file",
        path: join(directory, "missing.txt"),
      }),
    ).rejects.toThrow();
  });

  it("uses a fixed PowerShell query for bounded running-app metadata", async () => {
    const provider = new WindowsSystemControlProvider({
      platform: "win32",
      executor: (executable, args) => {
        expect(executable).toBe("powershell.exe");
        expect(args).toContain("-NonInteractive");
        return Promise.resolve({
          stdout:
            '[{"Id":1,"ProcessName":"fixture","MainWindowTitle":"Fixture"}]',
          stderr: "",
        });
      },
    });
    const result = await provider.execute({
      requestId: "f7370715-5607-4e39-bb0b-d4c5af30d11e",
      action: "get_running_apps",
    });
    expect(result.data).toEqual([
      { Id: 1, ProcessName: "fixture", MainWindowTitle: "Fixture" },
    ]);
  });

  it("fails explicitly outside Windows", async () => {
    const provider = new WindowsSystemControlProvider({ platform: "linux" });
    await expect(provider.health()).resolves.toMatchObject({
      status: "unavailable",
    });
    await expect(
      provider.execute({
        requestId: "d5846725-9373-4208-bcb2-18b46231634c",
        action: "get_system_stats",
      }),
    ).rejects.toThrow("unavailable");
  });
});

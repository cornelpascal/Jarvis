import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WindowsScreenshotProvider } from "../packages/os-abstractions/src/windows/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("screenshot context", () => {
  it("returns a bounded typed attachment and deletes the temporary PNG", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-screenshot-"));
    temporaryDirectories.push(root);
    const provider = new WindowsScreenshotProvider({
      root,
      platform: "win32",
      captureExecutor: async (mode, outputPath) => {
        expect(mode).toBe("active_window");
        await writeFile(outputPath, Buffer.from("89504e470d0a1a0a", "hex"));
        return { width: 1280, height: 720, title: "Fixture App" };
      },
    });

    const result = await provider.capture({
      requestId: "09b9876c-9ebd-4302-8ddc-10dde0b29b01",
      mode: "active_window",
    });

    expect(result).toMatchObject({
      mimeType: "image/png",
      byteLength: 8,
      width: 1280,
      height: 720,
      activeApplication: "Fixture App",
      retention: "ephemeral",
    });
    expect(Buffer.from(result.imageBase64, "base64").length).toBe(8);
    expect(await readdir(root)).toEqual([]);
  });

  it("deletes oversized capture files and reports unsupported platforms", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-screenshot-limit-"));
    temporaryDirectories.push(root);
    const provider = new WindowsScreenshotProvider({
      root,
      platform: "win32",
      captureExecutor: async (_mode, outputPath) => {
        await writeFile(outputPath, Buffer.alloc(10 * 1024 * 1024 + 1));
        return { width: 1, height: 1 };
      },
    });
    await expect(
      provider.capture({
        requestId: "8cd1b3b3-28a6-4a20-8141-b8601765a9e4",
        mode: "primary_display",
      }),
    ).rejects.toThrow("10 MiB");
    expect(await readdir(root)).toEqual([]);

    const unavailable = new WindowsScreenshotProvider({
      root,
      platform: "linux",
    });
    await expect(unavailable.health()).resolves.toMatchObject({
      status: "unavailable",
    });
  });
});

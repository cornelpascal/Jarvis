import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenWakeWordProvider,
  WakeWordLineDetector,
} from "../services/voice/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("local wake word", () => {
  it("accepts only the configured phrase and threshold with cooldown", () => {
    vi.useFakeTimers();
    const detector = new WakeWordLineDetector({
      phrase: "hey jarvis",
      threshold: 0.5,
      cooldownMs: 3_000,
    });
    const detections: number[] = [];
    detector.subscribe((state, detection) => {
      if (state === "detected" && detection) detections.push(detection.score);
    });
    detector.ingest('{"type":"ready"}', 10_000);
    detector.ingest(
      '{"type":"detected","phrase":"hey jarvis","score":0.49}',
      11_000,
    );
    detector.ingest(
      '{"type":"detected","phrase":"computer","score":0.99}',
      11_100,
    );
    detector.ingest(
      '{"type":"detected","phrase":"hey jarvis","score":0.8}',
      12_000,
    );
    detector.ingest(
      '{"type":"detected","phrase":"hey jarvis","score":0.9}',
      12_500,
    );
    detector.ingest(
      '{"type":"detected","phrase":"hey jarvis","score":0.7}',
      15_100,
    );
    expect(detections).toEqual([0.8, 0.7]);
  });

  it("fails closed when the optional local runtime is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-wake-word-"));
    temporaryDirectories.push(root);
    const scriptPath = join(root, "sidecar.py");
    await writeFile(scriptPath, "print('fixture')\n", "utf8");
    const provider = new OpenWakeWordProvider({
      scriptPath,
      phrase: "hey jarvis",
      threshold: 0.5,
      cooldownMs: 3_000,
      pythonExecutable: "jarvis-python-does-not-exist.exe",
    });
    await expect(provider.health()).resolves.toMatchObject({
      status: "unavailable",
    });
    await expect(provider.start()).rejects.toThrow("unavailable");
    expect(provider.state()).toBe("unavailable");
  });
});

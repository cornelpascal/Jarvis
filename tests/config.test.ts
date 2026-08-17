import { describe, expect, it } from "vitest";
import {
  jarvisConfigSchema,
  resolveEnvironment,
  resolveRuntimePaths,
} from "../packages/config/src/index.js";

describe("configuration", () => {
  it("enforces localhost and explicit consequential-action confirmations", () => {
    expect(() =>
      jarvisConfigSchema.parse({
        app: { name: "JARVIS" },
        projects: { roots: ["C:\\Documents"] },
        voice: { enabled: true, activation: "hotkey", hotkey: "Alt+Space" },
        wake_word: {
          enabled: false,
          engine: "openwakeword",
          phrase: "hey jarvis",
          threshold: 0.5,
          cooldown_ms: 3000,
        },
        references: {
          mode: "smart",
          visual_threshold: 0.65,
          images: true,
          videos: true,
          sources: true,
          autoplay_video: false,
        },
        codex: { max_concurrent_agents: 3, default_mode: "develop" },
        git: { auto_commit: false, auto_push: true },
        security: {
          require_push_confirmation: true,
          require_deploy_confirmation: true,
        },
        network: { bind_host: "0.0.0.0", port: 43117 },
      }),
    ).toThrow();
  });

  it("uses isolated runtime paths for tests", () => {
    expect(resolveEnvironment("test")).toBe("test");
    expect(resolveRuntimePaths("test").root).toContain("Jarvis-test");
  });
});

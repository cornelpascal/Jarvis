import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Windows packaging", () => {
  it("packages the core sidecar and keeps start-at-login opt-in", () => {
    const config = JSON.parse(
      readFileSync("apps/dashboard/src-tauri/tauri.conf.json", "utf8"),
    ) as {
      bundle: { externalBin: string[]; targets: string[] };
    };
    expect(config.bundle.externalBin).toEqual(["binaries/jarvis-core"]);
    expect(config.bundle.targets).toEqual(["nsis"]);

    const rust = readFileSync("apps/dashboard/src-tauri/src/lib.rs", "utf8");
    expect(rust).toContain("Uuid::new_v4()");
    expect(rust).not.toContain("development-only-token");
    expect(rust).not.toContain(".enable()");
  });

  it("does not expose the fixed development token to the Tauri runtime", () => {
    const client = readFileSync("apps/dashboard/src/core-client.ts", "utf8");
    expect(client).toContain('invoke<RuntimeConnection>("runtime_connection")');
    expect(client).toContain('"__TAURI_INTERNALS__" in window');
  });
});

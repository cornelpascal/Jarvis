import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PlaywrightBrowserProvider,
  validateBrowserUrl,
} from "../services/browser/src/index.js";

describe("isolated browser provider", () => {
  let provider: PlaywrightBrowserProvider | undefined;
  let profile: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    await provider?.close();
    if (server)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (profile) await rm(profile, { recursive: true, force: true });
  });

  it("blocks credential and private-network URLs by default", () => {
    expect(() => validateBrowserUrl("file:///etc/passwd")).toThrow("HTTP(S)");
    expect(() => validateBrowserUrl("https://user:pass@example.com")).toThrow(
      "credentials",
    );
    expect(() => validateBrowserUrl("http://127.0.0.1:8000")).toThrow(
      "Private-network",
    );
  });

  it("navigates, finds, clicks, and extracts in a dedicated Edge profile", async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        '<html><head><title>Fixture</title></head><body><button id="change" onclick="document.querySelector(\'#value\').textContent=\'changed\'">Change</button><p id="value">original text</p></body></html>',
      );
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Fixture server failed");
    profile = await mkdtemp(join(tmpdir(), "jarvis-browser-test-"));
    provider = new PlaywrightBrowserProvider({
      profileDirectory: profile,
      headless: true,
      executablePath:
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      allowPrivateNetwork: true,
    });
    const context = {
      signal: new AbortController().signal,
      deadline: new Date(Date.now() + 30_000),
      correlationId: "browser-test",
    };
    const opened = await provider.execute(
      {
        requestId: "7cb5ddae-a2f8-46af-b45a-8a2056dc3617",
        action: "open_url",
        url: `http://127.0.0.1:${String(address.port)}`,
      },
      context,
    );
    expect(opened.title).toBe("Fixture");
    const found = await provider.execute(
      {
        requestId: "b58502dd-6d44-4a06-aeeb-5bb146310f1c",
        action: "find_text",
        tabId: opened.tabId,
        text: "original text",
      },
      context,
    );
    expect(found.found).toBe(true);
    await provider.execute(
      {
        requestId: "55450dd2-47f5-4258-b968-8a1b932e1f54",
        action: "click",
        tabId: opened.tabId,
        selector: "#change",
      },
      context,
    );
    const extracted = await provider.execute(
      {
        requestId: "b4d2bd04-0a92-4491-b22c-14f9f1522665",
        action: "extract_page",
        tabId: opened.tabId,
      },
      context,
    );
    expect(extracted.text).toContain("changed");
  }, 60_000);
});

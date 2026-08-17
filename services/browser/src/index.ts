import { isIP } from "node:net";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type {
  Browser,
  BrowserContext,
  BrowserType,
  Page,
} from "playwright-core";
import {
  browserActionResultSchema,
  type BrowserAction,
  type BrowserActionResult,
  type BrowserProvider,
  type OperationContext,
  type ProviderHealth,
} from "@jarvis/protocol";

export class BrowserAgentError extends Error {
  override readonly name = "BrowserAgentError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface PlaywrightBrowserProviderOptions {
  profileDirectory: string;
  headless?: boolean;
  channel?: "msedge" | "chrome" | "chromium";
  executablePath?: string;
  allowPrivateNetwork?: boolean;
}

interface PlaywrightRuntime {
  chromium: BrowserType<Browser>;
}

let playwrightRuntime: PlaywrightRuntime | undefined;

function loadPlaywright(): PlaywrightRuntime {
  if (playwrightRuntime) return playwrightRuntime;
  const moduleRoot =
    process.env.JARVIS_BROWSER_MODULE_ROOT ??
    resolve(process.cwd(), "services/browser/package.json");
  const runtimeRequire = createRequire(moduleRoot);
  playwrightRuntime = runtimeRequire("playwright-core") as PlaywrightRuntime;
  return playwrightRuntime;
}

function privateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (isIP(host) === 4) {
    const parts = host.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  return (
    host === "::1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  );
}

export function validateBrowserUrl(
  value: string,
  allowPrivateNetwork = false,
): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new BrowserAgentError(
      "UNSAFE_URL",
      "Only HTTP(S) browser URLs are allowed",
    );
  if (url.username || url.password)
    throw new BrowserAgentError(
      "UNSAFE_URL",
      "URLs containing credentials are not allowed",
    );
  if (!allowPrivateNetwork && privateHost(url.hostname))
    throw new BrowserAgentError(
      "PRIVATE_NETWORK_BLOCKED",
      "Private-network browser targets are blocked by default",
    );
  return url.href;
}

export class PlaywrightBrowserProvider implements BrowserProvider {
  readonly #options: PlaywrightBrowserProviderOptions;
  readonly #tabIds = new Map<Page, string>();
  #context: BrowserContext | undefined;

  constructor(options: PlaywrightBrowserProviderOptions) {
    this.#options = options;
  }

  health(): Promise<ProviderHealth> {
    return Promise.resolve({
      status: "available",
      capabilities: [
        "isolated-profile",
        "navigation",
        "interaction",
        "extraction",
      ],
    });
  }

  async execute(
    action: BrowserAction,
    context: OperationContext,
  ): Promise<BrowserActionResult> {
    if (context.signal.aborted)
      throw new BrowserAgentError("CANCELLED", "Browser action was cancelled");
    const browser = await this.#getContext();
    let page = this.#resolvePage("tabId" in action ? action.tabId : undefined);
    if (
      action.action === "open_url" ||
      action.action === "new_tab" ||
      action.action === "open_reference"
    ) {
      const url = validateBrowserUrl(
        action.url,
        this.#options.allowPrivateNetwork,
      );
      if (!page || action.action === "new_tab") page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    } else {
      if (!page)
        throw new BrowserAgentError(
          "TAB_NOT_FOUND",
          "No browser tab is available",
        );
      switch (action.action) {
        case "close_tab":
          await page.close();
          return browserActionResultSchema.parse({
            requestId: action.requestId,
            action: action.action,
            success: true,
          });
        case "back":
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 10_000 });
          break;
        case "forward":
          await page.goForward({
            waitUntil: "domcontentloaded",
            timeout: 10_000,
          });
          break;
        case "reload":
          await page.reload({ waitUntil: "domcontentloaded", timeout: 10_000 });
          break;
        case "scroll":
          await page.mouse.wheel(0, action.deltaY);
          break;
        case "find_text": {
          const found =
            (await page.getByText(action.text, { exact: false }).count()) > 0;
          return this.#result(action, page, { found });
        }
        case "click":
          await page.locator(action.selector).first().click({ timeout: 5_000 });
          break;
        case "extract_page": {
          const text = (
            await page.locator("body").innerText({ timeout: 5_000 })
          ).slice(0, 100_000);
          return this.#result(action, page, { text });
        }
      }
    }
    return this.#result(action, page);
  }

  async close(): Promise<void> {
    await this.#context?.close();
    this.#context = undefined;
    this.#tabIds.clear();
  }

  async #getContext(): Promise<BrowserContext> {
    if (this.#context) return this.#context;
    this.#context = await loadPlaywright().chromium.launchPersistentContext(
      this.#options.profileDirectory,
      {
        headless: this.#options.headless ?? false,
        ...(this.#options.executablePath
          ? { executablePath: this.#options.executablePath }
          : { channel: this.#options.channel ?? "msedge" }),
      },
    );
    return this.#context;
  }

  #resolvePage(tabId?: string): Page | undefined {
    if (tabId) return [...this.#tabIds].find(([, id]) => id === tabId)?.[0];
    return this.#context
      ?.pages()
      .filter((page) => !page.isClosed())
      .at(-1);
  }

  async #result(
    action: BrowserAction,
    page: Page,
    extra: { text?: string; found?: boolean } = {},
  ): Promise<BrowserActionResult> {
    let tabId = this.#tabIds.get(page);
    if (!tabId) {
      tabId = crypto.randomUUID();
      this.#tabIds.set(page, tabId);
    }
    return browserActionResultSchema.parse({
      requestId: action.requestId,
      action: action.action,
      success: true,
      tabId,
      url: page.url(),
      title: await page.title(),
      ...extra,
    });
  }
}

import type { HotkeyProvider, ProviderHealth } from "@jarvis/protocol";

export interface HotkeyBackend {
  isRegistered(accelerator: string): Promise<boolean>;
  register(accelerator: string, handler: () => void): Promise<void>;
  unregister(accelerator: string): Promise<void>;
}

export class ManagedHotkeyProvider implements HotkeyProvider {
  readonly #backend: HotkeyBackend;
  readonly #owned = new Set<string>();

  constructor(backend: HotkeyBackend) {
    this.#backend = backend;
  }

  health(): Promise<ProviderHealth> {
    return Promise.resolve({
      status: "available",
      capabilities: ["register", "unregister"],
    });
  }

  async register(accelerator: string, handler: () => void): Promise<void> {
    if (this.#owned.has(accelerator)) return;
    if (await this.#backend.isRegistered(accelerator))
      throw new Error(`Hotkey is already registered: ${accelerator}`);
    await this.#backend.register(accelerator, handler);
    this.#owned.add(accelerator);
  }

  async unregister(accelerator: string): Promise<void> {
    if (!this.#owned.delete(accelerator)) return;
    await this.#backend.unregister(accelerator);
  }
}

function browserBackend(): HotkeyBackend {
  const handlers = new Map<string, (event: KeyboardEvent) => void>();
  return {
    isRegistered: (accelerator) => Promise.resolve(handlers.has(accelerator)),
    register: (accelerator, handler) => {
      const listener = (event: KeyboardEvent): void => {
        if (
          accelerator.toLowerCase() === "alt+space" &&
          event.altKey &&
          event.code === "Space" &&
          !event.repeat
        ) {
          event.preventDefault();
          handler();
        }
      };
      handlers.set(accelerator, listener);
      window.addEventListener("keydown", listener, true);
      return Promise.resolve();
    },
    unregister: (accelerator) => {
      const listener = handlers.get(accelerator);
      if (listener) window.removeEventListener("keydown", listener, true);
      handlers.delete(accelerator);
      return Promise.resolve();
    },
  };
}

async function tauriBackend(): Promise<HotkeyBackend> {
  const plugin = await import("@tauri-apps/plugin-global-shortcut");
  return {
    isRegistered: plugin.isRegistered,
    register: async (accelerator, handler) => {
      await plugin.register(accelerator, (event) => {
        if (event.state === "Pressed") handler();
      });
    },
    unregister: plugin.unregister,
  };
}

export async function createHotkeyProvider(): Promise<HotkeyProvider> {
  return new ManagedHotkeyProvider(
    "__TAURI_INTERNALS__" in window ? await tauriBackend() : browserBackend(),
  );
}

export async function revealAndFocusDashboard(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    window.focus();
    return;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  if (await current.isMinimized()) await current.unminimize();
  await current.show();
  await current.setFocus();
}

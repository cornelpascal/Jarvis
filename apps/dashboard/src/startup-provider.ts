import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

export async function startupEnabled(): Promise<boolean | undefined> {
  if (!("__TAURI_INTERNALS__" in window)) return undefined;
  return isEnabled();
}

export async function setStartupEnabled(enabled: boolean): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window))
    throw new Error("Start at login is available in the Windows app");
  if (enabled) await enable();
  else await disable();
}

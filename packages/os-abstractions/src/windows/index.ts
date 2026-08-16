import type { ProviderHealth, TelemetryProvider } from "@jarvis/protocol";

export class WindowsTelemetryProvider implements TelemetryProvider {
  health(): Promise<ProviderHealth> {
    return Promise.resolve({
      status: process.platform === "win32" ? "available" : "unavailable",
      capabilities: ["cpu", "memory", "disk", "network"],
    });
  }
}

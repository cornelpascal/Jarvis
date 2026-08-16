import type {
  DisplayPlacement,
  DisplayProvider,
  MonitorInfo,
} from "@jarvis/os-abstractions";
import type { WebviewWindow as TauriWebviewWindow } from "@tauri-apps/api/webviewWindow";

export const DISPLAY_SETTINGS_KEY = "jarvis.display-placement.v1";

function monitorId(
  name: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  return `${name ?? "display"}:${String(x)}:${String(y)}:${String(width)}x${String(height)}`;
}

export function resolvePlacement(
  monitors: MonitorInfo[],
  requested: DisplayPlacement = {},
): Required<DisplayPlacement> | undefined {
  if (monitors.length === 0) return undefined;
  const primary = monitors.find((monitor) => monitor.primary) ?? monitors[0];
  if (!primary) return undefined;
  const dashboard =
    monitors.find((monitor) => monitor.id === requested.dashboardMonitorId) ??
    primary;
  const reference =
    monitors.find((monitor) => monitor.id === requested.referenceMonitorId) ??
    monitors.find((monitor) => monitor.id !== dashboard.id) ??
    dashboard;
  return {
    dashboardMonitorId: dashboard.id,
    referenceMonitorId: reference.id,
  };
}

export function loadDisplayPlacement(): DisplayPlacement {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(DISPLAY_SETTINGS_KEY) ?? "{}",
    );
    if (!value || typeof value !== "object") return {};
    const candidate = value as Record<string, unknown>;
    return {
      ...(typeof candidate.dashboardMonitorId === "string"
        ? { dashboardMonitorId: candidate.dashboardMonitorId }
        : {}),
      ...(typeof candidate.referenceMonitorId === "string"
        ? { referenceMonitorId: candidate.referenceMonitorId }
        : {}),
    };
  } catch {
    return {};
  }
}

export function saveDisplayPlacement(placement: DisplayPlacement): void {
  localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(placement));
}

class BrowserDisplayProvider implements DisplayProvider {
  listMonitors(): Promise<MonitorInfo[]> {
    return Promise.resolve([
      {
        id: "browser-primary",
        name: "Primary display",
        primary: true,
        x: 0,
        y: 0,
        width: window.screen.availWidth,
        height: window.screen.availHeight,
        scaleFactor: window.devicePixelRatio,
      },
    ]);
  }

  placeDashboard(): Promise<void> {
    return Promise.resolve();
  }

  openReferenceDeck(): Promise<void> {
    window.open(
      `${window.location.origin}/?window=reference-deck`,
      "jarvis-reference-deck",
      "popup,width=1000,height=720",
    );
    return Promise.resolve();
  }

  closeReferenceDeck(): Promise<void> {
    return Promise.resolve();
  }

  reconcilePlacement(): Promise<void> {
    return Promise.resolve();
  }
}

class TauriDisplayProvider implements DisplayProvider {
  async listMonitors(): Promise<MonitorInfo[]> {
    const { availableMonitors, primaryMonitor } =
      await import("@tauri-apps/api/window");
    const [monitors, primary] = await Promise.all([
      availableMonitors(),
      primaryMonitor(),
    ]);
    const primaryId = primary
      ? monitorId(
          primary.name,
          primary.position.x,
          primary.position.y,
          primary.size.width,
          primary.size.height,
        )
      : undefined;
    return monitors.map((monitor, index) => ({
      id: monitorId(
        monitor.name,
        monitor.position.x,
        monitor.position.y,
        monitor.size.width,
        monitor.size.height,
      ),
      name: monitor.name ?? `Display ${String(index + 1)}`,
      primary:
        primaryId ===
        monitorId(
          monitor.name,
          monitor.position.x,
          monitor.position.y,
          monitor.size.width,
          monitor.size.height,
        ),
      x: monitor.workArea.position.x,
      y: monitor.workArea.position.y,
      width: monitor.workArea.size.width,
      height: monitor.workArea.size.height,
      scaleFactor: monitor.scaleFactor,
    }));
  }

  async placeDashboard(monitorIdValue: string): Promise<void> {
    const monitor = (await this.listMonitors()).find(
      ({ id }) => id === monitorIdValue,
    );
    if (!monitor) return;
    const [{ getCurrentWindow }, { LogicalPosition, LogicalSize }] =
      await Promise.all([
        import("@tauri-apps/api/window"),
        import("@tauri-apps/api/dpi"),
      ]);
    const current = getCurrentWindow();
    await current.setPosition(
      new LogicalPosition(
        monitor.x / monitor.scaleFactor,
        monitor.y / monitor.scaleFactor,
      ),
    );
    await current.setSize(
      new LogicalSize(
        monitor.width / monitor.scaleFactor,
        monitor.height / monitor.scaleFactor,
      ),
    );
  }

  async openReferenceDeck(monitorIdValue?: string): Promise<void> {
    const monitors = await this.listMonitors();
    const target =
      monitors.find(({ id }) => id === monitorIdValue) ?? monitors[0];
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel("reference-deck");
    if (existing) {
      await this.positionReferenceDeck(existing, target);
      await existing.show();
      await existing.setFocus();
      return;
    }
    const scale = target?.scaleFactor ?? 1;
    const singleMonitor = monitors.length <= 1;
    const width = singleMonitor
      ? Math.min(1050, (target?.width ?? 1200) * 0.75)
      : (target?.width ?? 1200);
    const height = singleMonitor
      ? Math.min(760, (target?.height ?? 800) * 0.8)
      : (target?.height ?? 800);
    new WebviewWindow("reference-deck", {
      url: "/?window=reference-deck",
      title: "JARVIS // Reference Deck",
      x: ((target?.x ?? 0) + (singleMonitor ? 48 : 0)) / scale,
      y: ((target?.y ?? 0) + (singleMonitor ? 48 : 0)) / scale,
      width: width / scale,
      height: height / scale,
      minWidth: 720,
      minHeight: 480,
      decorations: false,
      resizable: true,
      focus: true,
    });
  }

  async closeReferenceDeck(): Promise<void> {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await (await WebviewWindow.getByLabel("reference-deck"))?.close();
  }

  async reconcilePlacement(placement: DisplayPlacement): Promise<void> {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel("reference-deck");
    if (!existing) return;
    const monitors = await this.listMonitors();
    const target =
      monitors.find(({ id }) => id === placement.referenceMonitorId) ??
      monitors[0];
    await this.positionReferenceDeck(existing, target);
  }

  private async positionReferenceDeck(
    deck: TauriWebviewWindow,
    target: MonitorInfo | undefined,
  ): Promise<void> {
    if (!target) return;
    const { LogicalPosition, LogicalSize } =
      await import("@tauri-apps/api/dpi");
    await deck.setPosition(
      new LogicalPosition(
        target.x / target.scaleFactor,
        target.y / target.scaleFactor,
      ),
    );
    await deck.setSize(
      new LogicalSize(
        target.width / target.scaleFactor,
        target.height / target.scaleFactor,
      ),
    );
  }
}

export function createDisplayProvider(): DisplayProvider {
  return "__TAURI_INTERNALS__" in window
    ? new TauriDisplayProvider()
    : new BrowserDisplayProvider();
}

export type {
  HotkeyProvider,
  ScreenshotProvider,
  ShellProvider,
  StartupProvider,
  SystemControlProvider,
  TelemetryProvider,
  WindowManager,
} from "@jarvis/protocol";

export interface MonitorInfo {
  id: string;
  name: string;
  primary: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface DisplayPlacement {
  dashboardMonitorId?: string;
  referenceMonitorId?: string;
}

export interface DisplayProvider {
  listMonitors(): Promise<MonitorInfo[]>;
  placeDashboard(monitorId: string): Promise<void>;
  openReferenceDeck(monitorId?: string): Promise<void>;
  closeReferenceDeck(): Promise<void>;
  reconcilePlacement(placement: DisplayPlacement): Promise<void>;
}

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

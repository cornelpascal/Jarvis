export interface OperationContext {
  signal: AbortSignal;
  deadline: Date;
  sessionId?: string;
  correlationId: string;
  taskId?: string;
  projectId?: string;
  permissionReceiptId?: string;
}

export interface ProviderHealth {
  status: "available" | "degraded" | "unavailable";
  message?: string;
  capabilities: string[];
}

export interface LlmProvider {
  health(): Promise<ProviderHealth>;
}

export interface VoiceProvider {
  health(): Promise<ProviderHealth>;
  disconnect(): Promise<void>;
}

export interface ResearchProvider {
  health(): Promise<ProviderHealth>;
}

export interface ImageSearchProvider {
  health(): Promise<ProviderHealth>;
}

export interface VideoSearchProvider {
  health(): Promise<ProviderHealth>;
}

export interface BrowserProvider {
  health(): Promise<ProviderHealth>;
  close(): Promise<void>;
}

export interface CodingAgentProvider {
  health(): Promise<ProviderHealth>;
}

export interface ProjectSearchProvider {
  health(): Promise<ProviderHealth>;
}

export interface DeploymentProvider {
  readonly type: string;
  health(): Promise<ProviderHealth>;
}

export interface SecretProvider {
  has(name: string): Promise<boolean>;
  resolve(name: string, context: OperationContext): Promise<string>;
}

export interface SystemControlProvider {
  health(): Promise<ProviderHealth>;
}

export interface ScreenshotProvider {
  health(): Promise<ProviderHealth>;
}

export interface HotkeyProvider {
  health(): Promise<ProviderHealth>;
}

export interface WindowManager {
  health(): Promise<ProviderHealth>;
}

export interface StartupProvider {
  health(): Promise<ProviderHealth>;
}

export interface ShellProvider {
  health(): Promise<ProviderHealth>;
}

export interface TelemetryProvider {
  health(): Promise<ProviderHealth>;
}

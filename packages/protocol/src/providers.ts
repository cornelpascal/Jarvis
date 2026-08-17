import type { VoiceRuntimeState } from "./voice.js";
import type { ResearchRequest, ResearchResult } from "./research.js";
import type { BrowserAction, BrowserActionResult } from "./browser.js";

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
  state(): VoiceRuntimeState;
  activate(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  listDevices(): Promise<VoiceAudioDevice[]>;
  setInputDevice(deviceId?: string): Promise<void>;
  setOutputDevice(deviceId?: string): Promise<void>;
  subscribe(listener: VoiceStateListener): () => void;
  disconnect(): Promise<void>;
}

export interface VoiceAudioDevice {
  id: string;
  label: string;
  kind: "input" | "output";
}

export type VoiceStateListener = (
  state: VoiceRuntimeState,
  message?: string,
) => void;

export interface ResearchProvider {
  health(): Promise<ProviderHealth>;
  research(
    request: ResearchRequest,
    context: OperationContext,
  ): Promise<ResearchResult>;
}

export interface ImageSearchProvider {
  health(): Promise<ProviderHealth>;
}

export interface VideoSearchProvider {
  health(): Promise<ProviderHealth>;
}

export interface BrowserProvider {
  health(): Promise<ProviderHealth>;
  execute(
    action: BrowserAction,
    context: OperationContext,
  ): Promise<BrowserActionResult>;
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
  register(accelerator: string, handler: () => void): Promise<void>;
  unregister(accelerator: string): Promise<void>;
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

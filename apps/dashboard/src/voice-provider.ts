import {
  jarvisErrorSchema,
  voiceCallResponseSchema,
  type ProviderHealth,
  type VoiceAudioDevice,
  type VoiceClientSignal,
  type VoiceProvider,
  type VoiceRuntimeState,
  type VoiceStateListener,
} from "@jarvis/protocol";
import { coreRequest } from "./core-client";

const CONNECT_TIMEOUT_MS = 15_000;

interface RealtimeServerEvent {
  type: string;
  event_id?: string;
  transcript?: string;
  error?: { code?: string; message?: string };
}

export function parseRealtimeServerEvent(
  input: unknown,
): RealtimeServerEvent | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  if (typeof value.type !== "string") return undefined;
  return {
    type: value.type,
    ...(typeof value.event_id === "string" ? { event_id: value.event_id } : {}),
    ...(typeof value.transcript === "string"
      ? { transcript: value.transcript }
      : {}),
    ...(value.error && typeof value.error === "object"
      ? {
          error: {
            ...(typeof (value.error as Record<string, unknown>).code ===
            "string"
              ? { code: (value.error as Record<string, string>).code }
              : {}),
            ...(typeof (value.error as Record<string, unknown>).message ===
            "string"
              ? { message: (value.error as Record<string, string>).message }
              : {}),
          },
        }
      : {}),
  };
}

export function voiceStateForRealtimeEvent(
  type: string,
): VoiceRuntimeState | undefined {
  switch (type) {
    case "input_audio_buffer.speech_started":
      return "user_speaking";
    case "input_audio_buffer.speech_stopped":
    case "input_audio_buffer.committed":
      return "processing";
    case "output_audio_buffer.started":
    case "response.output_audio.delta":
      return "speaking";
    case "output_audio_buffer.stopped":
    case "response.done":
      return "listening";
    default:
      return undefined;
  }
}

function stateSignal(
  state: VoiceRuntimeState,
  muted = false,
): VoiceClientSignal | undefined {
  switch (state) {
    case "listening":
      return { type: "voice.listening", muted };
    case "user_speaking":
      return { type: "voice.user_speaking" };
    case "processing":
      return { type: "voice.processing" };
    case "speaking":
      return { type: "voice.speaking" };
    default:
      return undefined;
  }
}

export class OpenAiWebRtcVoiceProvider implements VoiceProvider {
  readonly #listeners = new Set<VoiceStateListener>();
  #runtimeState: VoiceRuntimeState = "idle";
  #peer: RTCPeerConnection | undefined;
  #channel: RTCDataChannel | undefined;
  #stream: MediaStream | undefined;
  #audio: HTMLAudioElement | undefined;
  #inputDeviceId: string | undefined;
  #outputDeviceId: string | undefined;
  #muted = false;
  #intentionalDisconnect = false;
  #reconnectAttempt = 0;

  state(): VoiceRuntimeState {
    return this.#runtimeState;
  }

  async health(): Promise<ProviderHealth> {
    try {
      const response = await coreRequest("/capabilities");
      if (!response.ok) throw new Error("Core capabilities unavailable");
      const value = (await response.json()) as {
        providers?: Record<string, string>;
      };
      const status = value.providers?.voice;
      return status === "available"
        ? {
            status: "available",
            capabilities: ["webrtc", "microphone", "speech-output", "barge-in"],
          }
        : {
            status: "unavailable",
            message: "Realtime voice is not configured in JARVIS Core",
            capabilities: [],
          };
    } catch {
      return {
        status: "degraded",
        message: "JARVIS Core voice capability could not be checked",
        capabilities: ["webrtc"],
      };
    }
  }

  subscribe(listener: VoiceStateListener): () => void {
    this.#listeners.add(listener);
    listener(this.#runtimeState);
    return () => this.#listeners.delete(listener);
  }

  async activate(): Promise<void> {
    if (this.#runtimeState === "speaking") {
      this.#channel?.send(JSON.stringify({ type: "response.cancel" }));
      await this.#emit({ type: "voice.interrupted", by: "user" });
      this.#setState("listening", "Response interrupted");
      return;
    }
    if (
      this.#peer &&
      this.#runtimeState !== "error" &&
      this.#runtimeState !== "unavailable"
    ) {
      if (this.#muted) await this.setMuted(false);
      return;
    }
    await this.#connect();
  }

  async setMuted(muted: boolean): Promise<void> {
    this.#muted = muted;
    for (const track of this.#stream?.getAudioTracks() ?? [])
      track.enabled = !muted;
    await this.#emit({ type: "voice.muted.changed", muted });
    this.#setState(muted ? "muted" : "listening");
    if (!muted) await this.#emit({ type: "voice.listening", muted: false });
  }

  async listDevices(): Promise<VoiceAudioDevice[]> {
    return (await navigator.mediaDevices.enumerateDevices())
      .filter(({ kind }) => kind === "audioinput" || kind === "audiooutput")
      .map((device, index) => ({
        id: device.deviceId,
        label:
          device.label ||
          `${device.kind === "audioinput" ? "Microphone" : "Speaker"} ${String(index + 1)}`,
        kind: device.kind === "audioinput" ? "input" : "output",
      }));
  }

  async setInputDevice(deviceId?: string): Promise<void> {
    this.#inputDeviceId = deviceId;
    if (this.#peer) {
      await this.disconnect();
      await this.activate();
    }
  }

  async setOutputDevice(deviceId?: string): Promise<void> {
    this.#outputDeviceId = deviceId;
    if (deviceId && this.#audio && "setSinkId" in this.#audio)
      await this.#audio.setSinkId(deviceId);
  }

  async disconnect(): Promise<void> {
    const wasActive = Boolean(this.#peer || this.#stream);
    this.#intentionalDisconnect = true;
    this.#disposeConnection();
    this.#reconnectAttempt = 0;
    this.#setState("idle", "Voice session ended");
    if (wasActive)
      await this.#emit({
        type: "voice.disconnected",
        reason: "Voice session ended",
        retryable: false,
      });
  }

  async #connect(): Promise<void> {
    this.#intentionalDisconnect = false;
    this.#setState("connecting", "Opening microphone and Realtime session");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: this.#inputDeviceId
          ? { deviceId: { exact: this.#inputDeviceId }, echoCancellation: true }
          : { echoCancellation: true, noiseSuppression: true },
      });
      this.#stream = stream;
      const peer = new RTCPeerConnection();
      this.#peer = peer;
      for (const track of stream.getTracks()) peer.addTrack(track, stream);
      const audio = new Audio();
      audio.autoplay = true;
      this.#audio = audio;
      if (this.#outputDeviceId && "setSinkId" in audio)
        await audio.setSinkId(this.#outputDeviceId);
      peer.addEventListener("track", (event) => {
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => {
          this.#setState("error", "Audio output was blocked by the runtime");
        });
      });
      peer.addEventListener("connectionstatechange", () => {
        if (
          peer.connectionState === "failed" ||
          peer.connectionState === "disconnected"
        )
          void this.#handleUnexpectedDisconnect(peer.connectionState);
      });
      const channel = peer.createDataChannel("oai-events");
      this.#channel = channel;
      channel.addEventListener("message", (message) =>
        this.#handleServerMessage(message.data),
      );
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!offer.sdp) throw new Error("WebRTC did not create an SDP offer");
      const response = await coreRequest("/voice/call", {
        method: "POST",
        headers: { "content-type": "application/sdp" },
        body: offer.sdp,
      });
      if (!response.ok) {
        let message = `Voice call failed (${String(response.status)})`;
        try {
          message = jarvisErrorSchema.parse(await response.json()).message;
        } catch {
          // The bounded status message above is safe for the HUD.
        }
        throw new Error(message);
      }
      const call = voiceCallResponseSchema.parse(await response.json());
      await peer.setRemoteDescription({ type: "answer", sdp: call.answerSdp });
      await this.#waitUntilConnected(peer);
      this.#reconnectAttempt = 0;
      const sessionId = call.callId ?? crypto.randomUUID();
      await this.#emit({ type: "voice.connected", sessionId });
      this.#setState("listening", "Voice channel active");
      await this.#emit({ type: "voice.listening", muted: false });
    } catch (cause) {
      this.#disposeConnection();
      const message =
        cause instanceof Error ? cause.message : "Voice activation failed";
      this.#setState("unavailable", message);
      await this.#emit({
        type: "voice.failed",
        code: "VOICE_ACTIVATION_FAILED",
        message,
        retryable: true,
      });
      throw cause;
    }
  }

  #handleServerMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      return;
    }
    const event = parseRealtimeServerEvent(parsed);
    if (!event) return;
    if (event.type === "error") {
      const message =
        event.error?.message ?? "Realtime provider reported an error";
      this.#setState("error", message);
      void this.#emit({
        type: "voice.failed",
        code: event.error?.code ?? "REALTIME_ERROR",
        message,
        retryable: true,
      });
      return;
    }
    if (
      event.type === "input_audio_buffer.speech_started" &&
      this.#runtimeState === "speaking"
    )
      void this.#emit({ type: "voice.interrupted", by: "user" });
    const next = voiceStateForRealtimeEvent(event.type);
    if (next && !this.#muted) {
      this.#setState(next);
      const signal = stateSignal(next);
      if (signal) void this.#emit(signal);
    }
    const role =
      event.type === "conversation.item.input_audio_transcription.completed"
        ? "user"
        : event.type === "response.output_audio_transcript.done"
          ? "assistant"
          : undefined;
    if (role && event.transcript?.trim())
      void this.#emit({
        type: "conversation.transcript",
        role,
        content: event.transcript.trim(),
        messageId: event.event_id ?? crypto.randomUUID(),
      });
  }

  async #handleUnexpectedDisconnect(reason: string): Promise<void> {
    if (this.#intentionalDisconnect || this.#peer === undefined) return;
    this.#disposeConnection();
    await this.#emit({
      type: "voice.disconnected",
      reason,
      retryable: this.#reconnectAttempt < 2,
    });
    if (this.#reconnectAttempt >= 2) {
      this.#setState("error", "Voice connection could not be restored");
      return;
    }
    const attempt = ++this.#reconnectAttempt;
    this.#setState("connecting", `Reconnecting voice (${String(attempt)}/2)`);
    setTimeout(
      () => void this.#connect().catch(() => undefined),
      500 * 2 ** (attempt - 1),
    );
  }

  #waitUntilConnected(peer: RTCPeerConnection): Promise<void> {
    if (peer.connectionState === "connected") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error("Voice connection timed out")),
        CONNECT_TIMEOUT_MS,
      );
      const changed = (): void => {
        if (peer.connectionState === "connected") finish();
        else if (
          peer.connectionState === "failed" ||
          peer.connectionState === "closed"
        )
          finish(new Error(`Voice connection ${peer.connectionState}`));
      };
      const finish = (error?: Error): void => {
        clearTimeout(timeout);
        peer.removeEventListener("connectionstatechange", changed);
        if (error) reject(error);
        else resolve();
      };
      peer.addEventListener("connectionstatechange", changed);
    });
  }

  async #emit(signal: VoiceClientSignal): Promise<void> {
    try {
      await coreRequest("/voice/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signal),
      });
    } catch {
      // The provider state remains visible locally while the core reconnects.
    }
  }

  #setState(state: VoiceRuntimeState, message?: string): void {
    if (state === this.#runtimeState && !message) return;
    this.#runtimeState = state;
    for (const listener of this.#listeners) listener(state, message);
  }

  #disposeConnection(): void {
    this.#channel?.close();
    this.#peer?.close();
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    if (this.#audio) this.#audio.srcObject = null;
    this.#channel = undefined;
    this.#peer = undefined;
    this.#stream = undefined;
    this.#audio = undefined;
  }
}

import {
  MAX_VOICE_SDP_BYTES,
  type ProviderHealth,
  type VoiceCallResponse,
} from "@jarvis/protocol";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const DEFAULT_MODEL = "gpt-realtime";
const DEFAULT_VOICE = "marin";

export interface RealtimeCallGateway {
  health(): Promise<ProviderHealth>;
  createCall(
    offerSdp: string,
    signal?: AbortSignal,
  ): Promise<VoiceCallResponse>;
}

export interface OpenAiRealtimeGatewayOptions {
  apiKey?: string;
  model?: string;
  voice?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class RealtimeGatewayError extends Error {
  override readonly name = "RealtimeGatewayError";

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class OpenAiRealtimeGateway implements RealtimeCallGateway {
  readonly #apiKey: string | undefined;
  readonly #model: string;
  readonly #voice: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: OpenAiRealtimeGatewayOptions = {}) {
    this.#apiKey = options.apiKey?.trim() || undefined;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#voice = options.voice ?? DEFAULT_VOICE;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  health(): Promise<ProviderHealth> {
    return Promise.resolve(
      this.#apiKey
        ? {
            status: "available",
            capabilities: [
              "webrtc",
              "speech-input",
              "speech-output",
              "barge-in",
            ],
          }
        : {
            status: "unavailable",
            message: "OPENAI_API_KEY is not configured in JARVIS Core",
            capabilities: [],
          },
    );
  }

  async createCall(
    offerSdp: string,
    signal?: AbortSignal,
  ): Promise<VoiceCallResponse> {
    if (!this.#apiKey)
      throw new RealtimeGatewayError(
        "VOICE_NOT_CONFIGURED",
        "Realtime voice is not configured",
        503,
        false,
      );
    const encodedBytes = new TextEncoder().encode(offerSdp).byteLength;
    if (encodedBytes === 0 || encodedBytes > MAX_VOICE_SDP_BYTES)
      throw new RealtimeGatewayError(
        "INVALID_SDP",
        "The WebRTC offer is empty or too large",
        400,
        false,
      );

    const form = new FormData();
    form.append(
      "sdp",
      new Blob([offerSdp], { type: "application/sdp" }),
      "offer.sdp",
    );
    form.append(
      "session",
      new Blob(
        [
          JSON.stringify({
            type: "realtime",
            model: this.#model,
            instructions:
              "You are JARVIS, a concise desktop voice assistant. Speak naturally and never claim a tool action occurred unless JARVIS Core confirms it.",
            audio: {
              input: {
                noise_reduction: { type: "near_field" },
                transcription: { model: "gpt-4o-mini-transcribe" },
                turn_detection: {
                  type: "server_vad",
                  create_response: true,
                  interrupt_response: true,
                },
              },
              output: { voice: this.#voice },
            },
          }),
        ],
        { type: "application/json" },
      ),
      "session.json",
    );
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeout])
      : timeout;
    let response: Response;
    try {
      response = await this.#fetch(REALTIME_CALLS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        body: form,
        signal: combinedSignal,
      });
    } catch (cause) {
      throw new RealtimeGatewayError(
        "VOICE_UPSTREAM_UNAVAILABLE",
        cause instanceof Error && cause.name === "TimeoutError"
          ? "Realtime call creation timed out"
          : "Realtime call creation failed",
        502,
        true,
      );
    }
    if (!response.ok) {
      throw new RealtimeGatewayError(
        "VOICE_UPSTREAM_REJECTED",
        `Realtime provider rejected call creation (${String(response.status)})`,
        response.status === 429 ? 429 : 502,
        response.status === 429 || response.status >= 500,
      );
    }
    const answerSdp = await response.text();
    if (
      answerSdp.length === 0 ||
      new TextEncoder().encode(answerSdp).byteLength > MAX_VOICE_SDP_BYTES
    )
      throw new RealtimeGatewayError(
        "INVALID_UPSTREAM_SDP",
        "Realtime provider returned an invalid SDP answer",
        502,
        true,
      );
    const location = response.headers.get("location");
    const callId = location?.split("/").filter(Boolean).at(-1);
    return {
      answerSdp,
      ...(callId ? { callId } : {}),
      provider: "openai-realtime",
    };
  }
}

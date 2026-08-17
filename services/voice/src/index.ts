import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  MAX_VOICE_SDP_BYTES,
  type ProviderHealth,
  type VoiceCallResponse,
  type WakeWordDetection,
  type WakeWordProvider,
  type WakeWordState,
} from "@jarvis/protocol";

const execFileAsync = promisify(execFile);

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

type WakeWordListener = (
  state: WakeWordState,
  detection?: WakeWordDetection,
) => void;

export class WakeWordLineDetector {
  readonly #phrase: string;
  readonly #threshold: number;
  readonly #cooldownMs: number;
  readonly #listeners = new Set<WakeWordListener>();
  #state: WakeWordState = "disabled";
  #lastDetection = 0;

  constructor(options: {
    phrase: string;
    threshold: number;
    cooldownMs: number;
  }) {
    this.#phrase = options.phrase;
    this.#threshold = options.threshold;
    this.#cooldownMs = options.cooldownMs;
  }

  state(): WakeWordState {
    return this.#state;
  }

  setState(state: WakeWordState): void {
    this.#state = state;
    this.#notify(state);
  }

  ingest(line: string, now = Date.now()): void {
    if (line.length === 0 || line.length > 4_096) return;
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    const record = message as Record<string, unknown>;
    if (record.type === "ready") return this.setState("listening");
    if (record.type === "error") return this.setState("error");
    if (
      record.type !== "detected" ||
      record.phrase !== this.#phrase ||
      typeof record.score !== "number" ||
      !Number.isFinite(record.score) ||
      record.score < this.#threshold ||
      record.score > 1 ||
      now - this.#lastDetection < this.#cooldownMs
    )
      return;
    this.#lastDetection = now;
    const detection = {
      phrase: this.#phrase,
      score: record.score,
      detectedAt: new Date(now).toISOString(),
    };
    this.#state = "detected";
    this.#notify("detected", detection);
    setTimeout(() => {
      if (this.#state === "detected") this.setState("listening");
    }, this.#cooldownMs);
  }

  subscribe(listener: WakeWordListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(state: WakeWordState, detection?: WakeWordDetection): void {
    for (const listener of this.#listeners) listener(state, detection);
  }
}

export class OpenWakeWordProvider implements WakeWordProvider {
  readonly #python: string;
  readonly #scriptPath: string;
  readonly #phrase: string;
  readonly #threshold: number;
  readonly #detector: WakeWordLineDetector;
  #process: ChildProcessWithoutNullStreams | undefined;
  #buffer = "";
  #stopping = false;

  constructor(options: {
    scriptPath: string;
    phrase: string;
    threshold: number;
    cooldownMs: number;
    pythonExecutable?: string;
  }) {
    this.#python = options.pythonExecutable ?? "python.exe";
    this.#scriptPath = resolve(options.scriptPath);
    this.#phrase = options.phrase;
    this.#threshold = options.threshold;
    this.#detector = new WakeWordLineDetector(options);
  }

  async health(): Promise<ProviderHealth> {
    try {
      const info = await lstat(this.#scriptPath);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error("Wake-word sidecar path is not a regular file");
      await execFileAsync(
        this.#python,
        [
          "-c",
          "from openwakeword.model import Model; import sounddevice, numpy; Model(wakeword_models=['hey_jarvis'], inference_framework='onnx')",
        ],
        {
          windowsHide: true,
          timeout: 10_000,
          maxBuffer: 16 * 1024,
          env: {
            ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
            ...(process.env.SystemRoot
              ? { SystemRoot: process.env.SystemRoot }
              : {}),
            PYTHONUTF8: "1",
          },
        },
      );
      return {
        status: "available",
        capabilities: ["local-microphone", "hey-jarvis", "onnx"],
      };
    } catch {
      return {
        status: "unavailable",
        message:
          "Local openWakeWord dependencies or the Hey Jarvis model are unavailable",
        capabilities: [],
      };
    }
  }

  state(): WakeWordState {
    return this.#detector.state();
  }

  async start(): Promise<void> {
    if (this.#process) return;
    const health = await this.health();
    if (health.status !== "available") {
      this.#detector.setState("unavailable");
      throw new Error(health.message ?? "Wake-word provider unavailable");
    }
    this.#stopping = false;
    this.#buffer = "";
    this.#detector.setState("starting");
    const child = spawn(
      this.#python,
      [
        this.#scriptPath,
        "--threshold",
        String(this.#threshold),
        "--phrase",
        this.#phrase,
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
          ...(process.env.SystemRoot
            ? { SystemRoot: process.env.SystemRoot }
            : {}),
          PYTHONUTF8: "1",
        },
      },
    );
    this.#process = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#ingest(chunk));
    child.stderr.on("data", () => undefined);
    child.on("error", () => this.#detector.setState("error"));
    child.on("exit", () => {
      this.#process = undefined;
      this.#detector.setState(this.#stopping ? "disabled" : "error");
    });
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    const child = this.#process;
    if (!child) return this.#detector.setState("disabled");
    child.kill();
    await Promise.race([
      new Promise<void>((resolveExit) =>
        child.once("exit", () => resolveExit()),
      ),
      new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ]);
    if (this.#process) child.kill("SIGKILL");
    this.#process = undefined;
    this.#detector.setState("disabled");
  }

  subscribe(listener: WakeWordListener): () => void {
    return this.#detector.subscribe(listener);
  }

  #ingest(chunk: string): void {
    this.#buffer += chunk;
    if (this.#buffer.length > 16 * 1024)
      this.#buffer = this.#buffer.slice(-4_096);
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#detector.ingest(line);
      newline = this.#buffer.indexOf("\n");
    }
  }
}

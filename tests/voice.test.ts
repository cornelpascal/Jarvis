import { describe, expect, it, vi } from "vitest";
import {
  ManagedHotkeyProvider,
  type HotkeyBackend,
} from "../apps/dashboard/src/hotkey-provider.js";
import {
  parseRealtimeServerEvent,
  voiceStateForRealtimeEvent,
} from "../apps/dashboard/src/voice-provider.js";
import {
  OpenAiRealtimeGateway,
  type RealtimeGatewayError,
} from "../services/voice/src/index.js";

describe("voice contracts", () => {
  it("maps current Realtime events onto explicit HUD states", () => {
    expect(
      voiceStateForRealtimeEvent("input_audio_buffer.speech_started"),
    ).toBe("user_speaking");
    expect(
      voiceStateForRealtimeEvent("input_audio_buffer.speech_stopped"),
    ).toBe("processing");
    expect(voiceStateForRealtimeEvent("output_audio_buffer.started")).toBe(
      "speaking",
    );
    expect(voiceStateForRealtimeEvent("response.done")).toBe("listening");
    expect(voiceStateForRealtimeEvent("unknown.event")).toBeUndefined();
  });

  it("rejects malformed Realtime data channel messages", () => {
    expect(parseRealtimeServerEvent(null)).toBeUndefined();
    expect(parseRealtimeServerEvent({ type: 7 })).toBeUndefined();
    expect(
      parseRealtimeServerEvent({
        type: "response.output_audio_transcript.done",
        transcript: "Done",
      }),
    ).toMatchObject({ transcript: "Done" });
  });

  it("keeps the standard API key server-side while creating a call", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("v=0\r\na=answer", {
        status: 201,
        headers: { location: "/v1/realtime/calls/call_123" },
      }),
    );
    const gateway = new OpenAiRealtimeGateway({
      apiKey: "unit-test-api-key",
      fetch: fetchMock,
    });
    await expect(gateway.createCall("v=0\r\na=offer")).resolves.toEqual({
      answerSdp: "v=0\r\na=answer",
      callId: "call_123",
      provider: "openai-realtime",
    });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.headers).toEqual({
      Authorization: "Bearer unit-test-api-key",
    });
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("fails closed when realtime voice has no server credential", async () => {
    const gateway = new OpenAiRealtimeGateway();
    expect((await gateway.health()).status).toBe("unavailable");
    await expect(gateway.createCall("offer")).rejects.toMatchObject<
      Partial<RealtimeGatewayError>
    >({ code: "VOICE_NOT_CONFIGURED", retryable: false });
  });
});

describe("managed hotkey provider", () => {
  it("registers one handler and releases only shortcuts it owns", async () => {
    const registered = new Set<string>();
    let handler: (() => void) | undefined;
    const backend: HotkeyBackend = {
      isRegistered: (key) => Promise.resolve(registered.has(key)),
      register: (key, next) => {
        registered.add(key);
        handler = next;
        return Promise.resolve();
      },
      unregister: (key) => {
        registered.delete(key);
        return Promise.resolve();
      },
    };
    const provider = new ManagedHotkeyProvider(backend);
    const activated = vi.fn();
    await provider.register("Alt+Space", activated);
    await provider.register("Alt+Space", activated);
    handler?.();
    expect(activated).toHaveBeenCalledOnce();
    await provider.unregister("Alt+Space");
    expect(registered.size).toBe(0);
  });

  it("reports a registration conflict instead of replacing it", async () => {
    const backend: HotkeyBackend = {
      isRegistered: () => Promise.resolve(true),
      register: () => Promise.resolve(),
      unregister: () => Promise.resolve(),
    };
    await expect(
      new ManagedHotkeyProvider(backend).register("Alt+Space", () => undefined),
    ).rejects.toThrow("already registered");
  });
});

import { describe, expect, it } from "vitest";
import { LocalEventBus } from "../packages/event-bus/src/index.js";
import type { EventPayloadMap } from "../packages/protocol/src/index.js";
import { startTelemetry } from "../services/core/src/telemetry.js";

describe("system telemetry", () => {
  it("emits measured CPU, memory, disk, and connection state", async () => {
    const bus = new LocalEventBus();
    const received = new Promise<EventPayloadMap["system.telemetry"]>(
      (resolve) => {
        bus.subscribe((event) => {
          if (event.type === "system.telemetry") resolve(event.payload);
        });
      },
    );
    const stop = startTelemetry(bus, process.cwd(), 60_000);
    const payload = await received;
    stop();
    expect(payload).toMatchObject({
      core: "online",
      codexAgents: 0,
    });
    expect(["online", "offline", "unknown"]).toContain(payload.network);
    expect(payload).toHaveProperty("cpuPercent");
    expect(payload).toHaveProperty("ramTotalBytes");
  });
});

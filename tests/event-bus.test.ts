import { describe, expect, it, vi } from "vitest";
import { LocalEventBus } from "../packages/event-bus/src/index.js";

describe("local event bus", () => {
  it("creates valid ordered events and delivers them", async () => {
    const bus = new LocalEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);
    const first = bus.create("jarvis.ready", "test", { ok: true });
    const second = bus.create("system.health", "test", { ok: true });
    await bus.publish(first);
    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(listener).toHaveBeenCalledWith(first);
  });
});

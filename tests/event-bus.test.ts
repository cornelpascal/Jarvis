import { describe, expect, it, vi } from "vitest";
import {
  DuplicateEventError,
  LocalEventBus,
} from "../packages/event-bus/src/index.js";

describe("local event bus", () => {
  it("creates valid ordered events and delivers them", async () => {
    const bus = new LocalEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);
    const first = bus.create("jarvis.ready", "test", {
      healthUrl: "http://127.0.0.1:43117/health",
    });
    const second = bus.create("system.health", "test", {
      status: "ok",
      database: "ok",
      uptimeSeconds: 1,
    });
    await bus.publish(first);
    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(listener).toHaveBeenCalledWith(first, { durable: true });
  });

  it("rejects duplicate delivery", async () => {
    const bus = new LocalEventBus();
    const event = bus.create("jarvis.test", "test", {
      message: "once",
      ordinal: 1,
    });
    await bus.publish(event);
    await expect(bus.publish(event)).rejects.toBeInstanceOf(
      DuplicateEventError,
    );
  });
});

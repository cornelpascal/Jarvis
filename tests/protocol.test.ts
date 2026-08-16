import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EVENT_SCHEMA_VERSION,
  parseJarvisEvent,
} from "../packages/protocol/src/index.js";

describe("event protocol", () => {
  it("rejects malformed events", () => {
    expect(() =>
      parseJarvisEvent({ id: "not-a-uuid", type: "bad", payload: null }),
    ).toThrow();
  });

  it("accepts a typed event envelope", () => {
    expect(
      parseJarvisEvent({
        id: randomUUID(),
        sequence: 0,
        timestamp: new Date().toISOString(),
        type: "jarvis.ready",
        source: "test",
        schemaVersion: EVENT_SCHEMA_VERSION,
        payload: { healthUrl: "http://127.0.0.1:43117/health" },
      }).type,
    ).toBe("jarvis.ready");
  });

  it("rejects unregistered types and invalid registered payloads", () => {
    const base = {
      id: randomUUID(),
      sequence: 0,
      timestamp: new Date().toISOString(),
      source: "test",
      schemaVersion: EVENT_SCHEMA_VERSION,
    };
    expect(() =>
      parseJarvisEvent({ ...base, type: "jarvis.unknown", payload: {} }),
    ).toThrow();
    expect(() =>
      parseJarvisEvent({
        ...base,
        type: "system.health",
        payload: { status: "ok" },
      }),
    ).toThrow();
  });
});

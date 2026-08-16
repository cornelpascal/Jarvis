import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EVENT_SCHEMA_VERSION,
  jarvisEventSchema,
} from "../packages/protocol/src/index.js";

describe("event protocol", () => {
  it("rejects malformed events", () => {
    expect(() =>
      jarvisEventSchema.parse({ id: "not-a-uuid", type: "bad", payload: null }),
    ).toThrow();
  });

  it("accepts a typed event envelope", () => {
    expect(
      jarvisEventSchema.parse({
        id: randomUUID(),
        sequence: 0,
        timestamp: new Date().toISOString(),
        type: "jarvis.ready",
        source: "test",
        schemaVersion: EVENT_SCHEMA_VERSION,
        payload: {},
      }).type,
    ).toBe("jarvis.ready");
  });
});

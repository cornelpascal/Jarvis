import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openJarvisDatabase } from "../packages/database/src/index.js";
import { EVENT_SCHEMA_VERSION } from "../packages/protocol/src/index.js";

describe("database", () => {
  it("runs migrations idempotently and persists an event", () => {
    const database = openJarvisDatabase(":memory:");
    const event = {
      id: randomUUID(),
      sequence: 0,
      timestamp: new Date().toISOString(),
      type: "jarvis.ready",
      source: "test",
      schemaVersion: EVENT_SCHEMA_VERSION,
      payload: { healthUrl: "http://127.0.0.1:43117/health" },
    } as const;
    database.appendEvent(event);
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
        .get(),
    ).toEqual({ count: 4 });
    expect(
      database.connection
        .prepare("SELECT type FROM event_log WHERE id = ?")
        .get(event.id),
    ).toEqual({ type: "jarvis.ready" });
    expect(database.latestEventSequence()).toBe(0);
    expect(database.readEventsAfter(-1, 10)).toEqual([event]);
    database.recordEventSequence(7);
    expect(database.latestEventSequence()).toBe(7);
    database.close();
  });
});

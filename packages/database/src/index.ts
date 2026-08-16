import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  parseJarvisEvent,
  type JarvisEvent,
  type KnownJarvisEvent,
} from "@jarvis/protocol";
import { migrations } from "./migrations.js";

const runtimeRequire = createRequire(import.meta.url);
const { DatabaseSync } = runtimeRequire("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

export interface JarvisDatabase {
  readonly connection: DatabaseSyncType;
  appendEvent(event: JarvisEvent): void;
  recordEventSequence(sequence: number): void;
  latestEventSequence(): number;
  readEventsAfter(sequence: number, limit: number): KnownJarvisEvent[];
  close(): void;
}

export function openJarvisDatabase(path: string): JarvisDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  connection.exec(
    "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;",
  );
  connection.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);
  const applied = connection
    .prepare("SELECT version FROM schema_migrations")
    .all() as Array<{ version: number }>;
  const appliedVersions = new Set(applied.map(({ version }) => version));
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    connection.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.statements) connection.exec(statement);
      connection
        .prepare(
          "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
  }
  const recordEventSequence = (sequence: number): void => {
    connection
      .prepare(
        `INSERT INTO settings(key, value_json, updated_at) VALUES ('event_sequence', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(sequence), new Date().toISOString());
  };
  return {
    connection,
    appendEvent(event) {
      connection
        .prepare(
          `INSERT INTO event_log(
        id, sequence, timestamp, session_id, correlation_id, causation_id, task_id,
        project_id, type, source, schema_version, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.sequence,
          event.timestamp,
          event.sessionId ?? null,
          event.correlationId ?? null,
          event.causationId ?? null,
          event.taskId ?? null,
          event.projectId ?? null,
          event.type,
          event.source,
          event.schemaVersion,
          JSON.stringify(event.payload),
        );
      recordEventSequence(event.sequence);
    },
    recordEventSequence,
    latestEventSequence() {
      const row = connection
        .prepare(
          `SELECT MAX(sequence) AS sequence FROM (
        SELECT COALESCE(MAX(sequence), -1) AS sequence FROM event_log
        UNION ALL
        SELECT COALESCE(CAST(json_extract(value_json, '$') AS INTEGER), -1) AS sequence
          FROM settings WHERE key = 'event_sequence'
      )`,
        )
        .get() as { sequence: number };
      return row.sequence;
    },
    readEventsAfter(sequence, limit) {
      const rows = connection
        .prepare(
          `SELECT
        id, sequence, timestamp, session_id, correlation_id, causation_id, task_id,
        project_id, type, source, schema_version, payload_json
        FROM event_log WHERE sequence > ? ORDER BY sequence ASC LIMIT ?`,
        )
        .all(sequence, limit) as Array<{
        id: string;
        sequence: number;
        timestamp: string;
        session_id: string | null;
        correlation_id: string | null;
        causation_id: string | null;
        task_id: string | null;
        project_id: string | null;
        type: string;
        source: string;
        schema_version: number;
        payload_json: string;
      }>;
      return rows.map((row) =>
        parseJarvisEvent({
          id: row.id,
          sequence: row.sequence,
          timestamp: row.timestamp,
          ...(row.session_id ? { sessionId: row.session_id } : {}),
          ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
          ...(row.causation_id ? { causationId: row.causation_id } : {}),
          ...(row.task_id ? { taskId: row.task_id } : {}),
          ...(row.project_id ? { projectId: row.project_id } : {}),
          type: row.type,
          source: row.source,
          schemaVersion: row.schema_version,
          payload: JSON.parse(row.payload_json) as unknown,
        }),
      );
    },
    close() {
      connection.close();
    },
  };
}

export { migrations } from "./migrations.js";

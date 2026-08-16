import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { JarvisEvent } from "@jarvis/protocol";
import { migrations } from "./migrations.js";

const runtimeRequire = createRequire(import.meta.url);
const { DatabaseSync } = runtimeRequire("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

export interface JarvisDatabase {
  readonly connection: DatabaseSyncType;
  appendEvent(event: JarvisEvent): void;
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
    },
    close() {
      connection.close();
    },
  };
}

export { migrations } from "./migrations.js";

export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS project_roots (
        id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS project_files (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL, hash TEXT, indexed_at TEXT NOT NULL, UNIQUE(project_id, path)
      )`,
      `CREATE TABLE IF NOT EXISTS project_symbols (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_id TEXT REFERENCES project_files(id) ON DELETE CASCADE, name TEXT NOT NULL,
        kind TEXT NOT NULL, line INTEGER, metadata_json TEXT NOT NULL DEFAULT '{}'
      )`,
      `CREATE TABLE IF NOT EXISTS project_metadata (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, key)
      )`,
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
        content TEXT NOT NULL, provenance_json TEXT, created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT NOT NULL,
        state TEXT NOT NULL, worktree_path TEXT, branch TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS task_events (
        event_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        provider TEXT NOT NULL, provider_run_id TEXT, state TEXT NOT NULL,
        started_at TEXT, completed_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}'
      )`,
      `CREATE TABLE IF NOT EXISTS references_store (
        id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id), type TEXT NOT NULL,
        title TEXT, uri TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, action TEXT NOT NULL, risk_level INTEGER NOT NULL,
        resource TEXT NOT NULL, project_id TEXT REFERENCES projects(id), state TEXT NOT NULL,
        reason TEXT NOT NULL, requested_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS deployment_configs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        environment TEXT NOT NULL, adapter_type TEXT NOT NULL, config_json TEXT NOT NULL,
        validated_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(project_id, environment)
      )`,
      `CREATE TABLE IF NOT EXISTS deployment_runs (
        id TEXT PRIMARY KEY, config_id TEXT NOT NULL REFERENCES deployment_configs(id),
        state TEXT NOT NULL, revision TEXT, started_at TEXT NOT NULL, completed_at TEXT,
        result_json TEXT NOT NULL DEFAULT '{}'
      )`,
      `CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('EPHEMERAL','SESSION','PROJECT','GLOBAL')),
        scope_id TEXT, content TEXT NOT NULL, provenance_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
        read_at TEXT, created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS event_log (
        id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, timestamp TEXT NOT NULL,
        session_id TEXT, correlation_id TEXT, causation_id TEXT, task_id TEXT, project_id TEXT,
        type TEXT NOT NULL, source TEXT NOT NULL, schema_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_event_log_timestamp ON event_log(timestamp)",
      "CREATE INDEX IF NOT EXISTS idx_event_log_correlation ON event_log(correlation_id)",
      "CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id)",
      "CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id)",
    ],
  },
  {
    version: 2,
    name: "project_search_index",
    statements: [
      `CREATE TABLE IF NOT EXISTS project_documents (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL, file_name TEXT NOT NULL, content TEXT NOT NULL, hash TEXT NOT NULL,
        language TEXT NOT NULL, size_bytes INTEGER NOT NULL, indexed_at TEXT NOT NULL,
        UNIQUE(project_id, path)
      )`,
      `CREATE TABLE IF NOT EXISTS project_document_symbols (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL
      )`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS project_documents_fts USING fts5(
        document_id UNINDEXED, project_id UNINDEXED, path, content, tokenize = 'unicode61'
      )`,
      "CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id)",
      "CREATE INDEX IF NOT EXISTS idx_project_document_symbols_project_name ON project_document_symbols(project_id, name)",
    ],
  },
  {
    version: 3,
    name: "coding_task_provider_state",
    statements: [
      "ALTER TABLE tasks ADD COLUMN instruction TEXT",
      "ALTER TABLE tasks ADD COLUMN working_directory TEXT",
      "ALTER TABLE tasks ADD COLUMN provider TEXT",
      "ALTER TABLE tasks ADD COLUMN thread_id TEXT",
      "ALTER TABLE tasks ADD COLUMN turn_id TEXT",
      "ALTER TABLE tasks ADD COLUMN error TEXT",
    ],
  },
  {
    version: 4,
    name: "worktree_ownership",
    statements: [
      `CREATE TABLE IF NOT EXISTS worktrees (
        task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_path TEXT NOT NULL, path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL UNIQUE,
        baseline_revision TEXT NOT NULL, source_dirty INTEGER NOT NULL,
        state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_worktrees_project ON worktrees(project_id)",
    ],
  },
];

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import {
  projectRecordSchema,
  projectRegistrySnapshotSchema,
  type ProjectCommandEvidence,
  type ProjectRecord,
  type ProjectRegistryProvider,
  type ProjectRegistrySnapshot,
  type ProjectRoot,
} from "@jarvis/protocol";

const EXACT_SIGNALS = new Set([
  ".git",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "requirements.txt",
  "pyproject.toml",
  "cargo.toml",
  "go.mod",
  "docker-compose.yml",
  "compose.yml",
  "dockerfile",
  "agents.md",
]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);
const COMMAND_NAMES = ["dev", "lint", "typecheck", "test", "build"] as const;

export interface ProjectRegistryOptions {
  roots: string[];
  database: JarvisDatabase;
  bus: LocalEventBus;
  maxDepth?: number;
  maxDirectories?: number;
}

interface Analysis {
  signals: string[];
  stack: string[];
  git: ProjectRecord["git"];
  commands: ProjectRecord["commands"];
}

interface ScanStats {
  discovered: number;
  registered: number;
  inaccessible: number;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 16)}`;
}

async function canonicalDirectory(path: string): Promise<string> {
  const resolved = resolve(path);
  const stats = await lstat(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new ProjectRegistryError(
      "INVALID_PROJECT_PATH",
      "Project path must be a real directory",
    );
  return realpath(resolved);
}

async function readDefaultBranch(path: string): Promise<string | undefined> {
  try {
    const head = (await readFile(resolve(path, ".git", "HEAD"), "utf8")).trim();
    return head.startsWith("ref: refs/heads/")
      ? head.slice("ref: refs/heads/".length)
      : undefined;
  } catch {
    return undefined;
  }
}

async function analyzeDirectory(
  path: string,
  manual = false,
): Promise<Analysis | undefined> {
  const entries = await readdir(path, { withFileTypes: true });
  const names = new Map(
    entries.map((entry) => [entry.name.toLowerCase(), entry.name]),
  );
  const signals = [...names]
    .filter(
      ([lower]) =>
        EXACT_SIGNALS.has(lower) ||
        lower.startsWith("readme") ||
        lower.endsWith(".sln") ||
        lower.endsWith(".csproj"),
    )
    .map(([, actual]) => actual)
    .sort((a, b) => a.localeCompare(b));
  if (signals.length === 0 && !manual) return undefined;
  if (manual && signals.length === 0) signals.push("manual-registration");

  const stack = new Set<string>();
  if (names.has("package.json")) stack.add("node");
  if (names.has("pyproject.toml") || names.has("requirements.txt"))
    stack.add("python");
  if (names.has("cargo.toml")) stack.add("rust");
  if (names.has("go.mod")) stack.add("go");
  if (
    [...names.keys()].some(
      (name) => name.endsWith(".sln") || name.endsWith(".csproj"),
    )
  )
    stack.add("dotnet");
  if (
    names.has("dockerfile") ||
    names.has("compose.yml") ||
    names.has("docker-compose.yml")
  )
    stack.add("docker");

  const commands: Record<string, ProjectCommandEvidence | null> = {
    install: null,
    dev: null,
    lint: null,
    typecheck: null,
    test: null,
    build: null,
  };
  if (names.has("package.json")) {
    try {
      const packageManifest = names.get("package.json");
      if (!packageManifest)
        throw new Error("Package manifest disappeared during analysis");
      const manifest = JSON.parse(
        await readFile(resolve(path, packageManifest), "utf8"),
      ) as {
        scripts?: Record<string, unknown>;
      };
      const manager = names.has("pnpm-lock.yaml")
        ? "pnpm"
        : names.has("yarn.lock")
          ? "yarn"
          : "npm";
      commands.install = {
        command: manager === "npm" ? "npm install" : `${manager} install`,
        source: names.has("pnpm-lock.yaml")
          ? "pnpm-lock.yaml"
          : names.has("yarn.lock")
            ? "yarn.lock"
            : "package.json",
      };
      for (const name of COMMAND_NAMES)
        if (typeof manifest.scripts?.[name] === "string")
          commands[name] = {
            command:
              manager === "npm" ? `npm run ${name}` : `${manager} ${name}`,
            source: `package.json#scripts.${name}`,
          };
    } catch {
      // A malformed manifest remains a discovery signal but provides no commands.
    }
  }
  const gitEnabled = names.has(".git");
  const defaultBranch = gitEnabled ? await readDefaultBranch(path) : undefined;
  return {
    signals,
    stack: [...stack].sort(),
    git: { enabled: gitEnabled, ...(defaultBranch ? { defaultBranch } : {}) },
    commands,
  };
}

export class ProjectRegistryError extends Error {
  override readonly name = "ProjectRegistryError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class SqliteProjectRegistry implements ProjectRegistryProvider {
  readonly #options: Required<
    Pick<ProjectRegistryOptions, "maxDepth" | "maxDirectories">
  > &
    ProjectRegistryOptions;

  constructor(options: ProjectRegistryOptions) {
    this.#options = { maxDepth: 4, maxDirectories: 10_000, ...options };
  }

  async initialize(): Promise<ProjectRegistrySnapshot> {
    this.#syncRoots();
    const snapshot = await this.scan();
    for (const project of snapshot.projects)
      await this.#publishRegistered(project);
    if (snapshot.selectedProjectId)
      await this.#options.bus.publish(
        this.#options.bus.create("project.selected", "projects.registry", {
          projectId: snapshot.selectedProjectId,
        }),
      );
    return snapshot;
  }

  snapshot(): ProjectRegistrySnapshot {
    const roots = this.#options.database.connection
      .prepare("SELECT id, path, enabled FROM project_roots ORDER BY path")
      .all() as Array<{ id: string; path: string; enabled: number }>;
    const projects = this.#options.database.connection
      .prepare(
        `SELECT p.id, p.name, p.path, p.enabled, p.created_at, p.updated_at, m.value_json
        FROM projects p LEFT JOIN project_metadata m ON m.project_id = p.id AND m.key = 'analysis'
        ORDER BY p.name COLLATE NOCASE, p.path`,
      )
      .all() as Array<{
      id: string;
      name: string;
      path: string;
      enabled: number;
      created_at: string;
      updated_at: string;
      value_json: string | null;
    }>;
    const selected = this.#options.database.connection
      .prepare(
        "SELECT value_json FROM settings WHERE key = 'selected_project_id'",
      )
      .get() as { value_json: string } | undefined;
    return projectRegistrySnapshotSchema.parse({
      roots: roots.map((root): ProjectRoot => ({
        ...root,
        enabled: root.enabled === 1,
      })),
      projects: projects.map((row) => {
        const analysis = row.value_json
          ? (JSON.parse(row.value_json) as Analysis)
          : {
              signals: [],
              stack: [],
              git: { enabled: false },
              commands: {},
            };
        return projectRecordSchema.parse({
          id: row.id,
          name: row.name,
          path: row.path,
          enabled: row.enabled === 1,
          ...analysis,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }),
      ...(selected
        ? { selectedProjectId: JSON.parse(selected.value_json) as string }
        : {}),
    });
  }

  async scan(): Promise<ProjectRegistrySnapshot> {
    const roots = this.snapshot().roots.filter((root) => root.enabled);
    await this.#options.bus.publish(
      this.#options.bus.create("project.scan.started", "projects.registry", {
        roots: roots.map((root) => root.path),
      }),
    );
    const stats: ScanStats = { discovered: 0, registered: 0, inaccessible: 0 };
    try {
      for (const root of roots) await this.#scanRoot(root.path, stats);
      await this.#options.bus.publish(
        this.#options.bus.create(
          "project.scan.completed",
          "projects.registry",
          stats,
        ),
      );
      return this.snapshot();
    } catch (cause) {
      await this.#options.bus.publish(
        this.#options.bus.create("project.scan.failed", "projects.registry", {
          code: "PROJECT_SCAN_FAILED",
          message:
            cause instanceof Error ? cause.message : "Project scan failed",
        }),
      );
      throw cause;
    }
  }

  async register(path: string, enabled = true): Promise<ProjectRecord> {
    const canonical = await canonicalDirectory(path);
    const analysis = await analyzeDirectory(canonical, true);
    if (!analysis)
      throw new ProjectRegistryError(
        "ANALYSIS_FAILED",
        "Project analysis failed",
      );
    const id = stableId("project", canonical);
    const existing = this.#options.database.connection
      .prepare("SELECT created_at FROM projects WHERE id = ?")
      .get(id) as { created_at: string } | undefined;
    const now = new Date().toISOString();
    this.#options.database.connection.exec("BEGIN IMMEDIATE");
    try {
      this.#options.database.connection
        .prepare(
          `INSERT INTO projects(id, name, path, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path,
          enabled = excluded.enabled, updated_at = excluded.updated_at`,
        )
        .run(
          id,
          basename(canonical),
          canonical,
          enabled ? 1 : 0,
          existing?.created_at ?? now,
          now,
        );
      this.#options.database.connection
        .prepare(
          `INSERT INTO project_metadata(project_id, key, value_json, updated_at) VALUES (?, 'analysis', ?, ?)
          ON CONFLICT(project_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run(id, JSON.stringify(analysis), now);
      this.#options.database.connection.exec("COMMIT");
    } catch (cause) {
      this.#options.database.connection.exec("ROLLBACK");
      throw cause;
    }
    const project = this.snapshot().projects.find((item) => item.id === id);
    if (!project)
      throw new ProjectRegistryError(
        "PERSISTENCE_FAILED",
        "Registered project could not be loaded",
      );
    await this.#publishRegistered(project);
    return project;
  }

  setEnabled(projectId: string, enabled: boolean): ProjectRecord {
    const result = this.#options.database.connection
      .prepare("UPDATE projects SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, new Date().toISOString(), projectId);
    if (result.changes !== 1)
      throw new ProjectRegistryError(
        "PROJECT_NOT_FOUND",
        "Project was not found",
      );
    const project = this.snapshot().projects.find(
      (item) => item.id === projectId,
    );
    if (!project)
      throw new ProjectRegistryError(
        "PERSISTENCE_FAILED",
        "Updated project could not be loaded",
      );
    void this.#options.bus.publish(
      this.#options.bus.create("project.updated", "projects.registry", {
        projectId,
        enabled,
      }),
    );
    return project;
  }

  remove(projectId: string): void {
    const result = this.#options.database.connection
      .prepare("DELETE FROM projects WHERE id = ?")
      .run(projectId);
    if (result.changes !== 1)
      throw new ProjectRegistryError(
        "PROJECT_NOT_FOUND",
        "Project was not found",
      );
    this.#options.database.connection
      .prepare(
        "DELETE FROM settings WHERE key = 'selected_project_id' AND value_json = ?",
      )
      .run(JSON.stringify(projectId));
    void this.#options.bus.publish(
      this.#options.bus.create("project.removed", "projects.registry", {
        projectId,
      }),
    );
  }

  select(projectId: string): ProjectRecord {
    const project = this.snapshot().projects.find(
      (item) => item.id === projectId && item.enabled,
    );
    if (!project)
      throw new ProjectRegistryError(
        "PROJECT_NOT_AVAILABLE",
        "Project is missing or disabled",
      );
    this.#options.database.connection
      .prepare(
        `INSERT INTO settings(key, value_json, updated_at) VALUES ('selected_project_id', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(projectId), new Date().toISOString());
    void this.#options.bus.publish(
      this.#options.bus.create("project.selected", "projects.registry", {
        projectId,
      }),
    );
    return project;
  }

  async #scanRoot(rootPath: string, stats: ScanStats): Promise<void> {
    let root: string;
    try {
      root = await canonicalDirectory(rootPath);
    } catch {
      stats.inaccessible += 1;
      return;
    }
    const queue: Array<{ path: string; depth: number }> = [
      { path: root, depth: 0 },
    ];
    const visited = new Set<string>();
    while (queue.length > 0 && visited.size < this.#options.maxDirectories) {
      const current = queue.shift();
      if (!current) break;
      let canonical: string;
      try {
        canonical = await realpath(current.path);
      } catch {
        stats.inaccessible += 1;
        continue;
      }
      const key = canonical.toLowerCase();
      if (visited.has(key)) continue;
      visited.add(key);
      try {
        const analysis = await analyzeDirectory(canonical);
        if (analysis) {
          const projectId = stableId("project", canonical);
          stats.discovered += 1;
          await this.#options.bus.publish(
            this.#options.bus.create("project.discovered", "projects.scanner", {
              projectId,
              name: basename(canonical),
              path: canonical,
              signals: analysis.signals,
            }),
          );
          const existingProject = this.snapshot().projects.find(
            (project) => project.id === projectId,
          );
          await this.register(canonical, existingProject?.enabled ?? true);
          if (!existingProject) stats.registered += 1;
        }
        if (current.depth >= this.#options.maxDepth) continue;
        const entries = await readdir(canonical, { withFileTypes: true });
        for (const entry of entries)
          if (
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            !SKIP_DIRECTORIES.has(entry.name.toLowerCase())
          )
            queue.push({
              path: resolve(canonical, entry.name),
              depth: current.depth + 1,
            });
      } catch {
        stats.inaccessible += 1;
      }
    }
  }

  #syncRoots(): void {
    const now = new Date().toISOString();
    for (const path of this.#options.roots) {
      const normalized = resolve(path);
      this.#options.database.connection
        .prepare(
          `INSERT INTO project_roots(id, path, enabled, created_at, updated_at) VALUES (?, ?, 1, ?, ?)
          ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at`,
        )
        .run(stableId("root", normalized), normalized, now, now);
    }
  }

  async #publishRegistered(project: ProjectRecord): Promise<void> {
    await this.#options.bus.publish(
      this.#options.bus.create("project.registered", "projects.registry", {
        projectId: project.id,
        name: project.name,
        path: project.path,
        enabled: project.enabled,
      }),
    );
  }
}

export type { ProjectRecord, ProjectRegistrySnapshot } from "@jarvis/protocol";

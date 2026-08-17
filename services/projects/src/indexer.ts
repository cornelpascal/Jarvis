import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import {
  projectSearchResultSchema,
  type ProjectSearchMatch,
  type ProjectSearchProvider,
  type ProjectSearchRequest,
  type ProjectSearchResult,
} from "@jarvis/protocol";
import { ProjectRegistryError } from "./index.js";

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
const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ps1",
  ".py",
  ".rs",
  ".scss",
  ".sql",
  ".svelte",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);
const TEXT_NAMES = new Set([
  "dockerfile",
  "makefile",
  "readme",
  "license",
  "agents.md",
]);
const SECRET_NAMES =
  /^(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)|credentials?|secrets?)(?:\..*)?$/i;
const SECRET_EXTENSIONS = new Set([".key", ".p12", ".pem", ".pfx"]);
const MAX_FILE_BYTES = 1024 * 1024;

function normalizedPath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function indexableFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (SECRET_NAMES.test(lower) || SECRET_EXTENSIONS.has(extname(lower)))
    return false;
  return (
    TEXT_EXTENSIONS.has(extname(lower)) ||
    TEXT_NAMES.has(lower) ||
    lower.startsWith("readme.")
  );
}

function languageFor(path: string): string {
  return extname(path).slice(1).toLowerCase() || basename(path).toLowerCase();
}

function symbolRows(
  content: string,
): Array<{ name: string; kind: string; line: number }> {
  const rows: Array<{ name: string; kind: string; line: number }> = [];
  const patterns: Array<[string, RegExp]> = [
    ["class", /\bclass\s+([A-Za-z_$][\w$]*)/g],
    ["interface", /\binterface\s+([A-Za-z_$][\w$]*)/g],
    ["type", /\btype\s+([A-Za-z_$][\w$]*)\s*=/g],
    ["function", /\b(?:function|def|fn)\s+([A-Za-z_$][\w$]*)/g],
    ["structure", /\b(?:struct|enum|trait|record)\s+([A-Za-z_$][\w$]*)/g],
    ["binding", /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g],
  ];
  for (const [kind, pattern] of patterns)
    for (const match of content.matchAll(pattern)) {
      const name = match[1];
      if (!name) continue;
      rows.push({
        name,
        kind,
        line: content.slice(0, match.index).split("\n").length,
      });
      if (rows.length >= 5_000) return rows;
    }
  return rows;
}

function queryTerms(query: string): string[] {
  const stop = new Set([
    "a",
    "an",
    "and",
    "are",
    "does",
    "how",
    "in",
    "is",
    "of",
    "the",
    "this",
    "where",
    "work",
    "works",
  ]);
  return [...new Set(query.toLowerCase().match(/[a-z_][a-z0-9_-]{2,}/g) ?? [])]
    .filter((term) => !stop.has(term))
    .sort((left, right) => right.length - left.length)
    .slice(0, 8);
}

async function ripgrep(
  root: string,
  query: string,
  limit: number,
): Promise<ProjectSearchMatch[]> {
  const term = queryTerms(query).at(0);
  if (!term) return [];
  return new Promise((resolveMatches) => {
    const child = spawn(
      "rg",
      [
        "--json",
        "--fixed-strings",
        "--ignore-case",
        "--max-count",
        "3",
        "--glob",
        "!**/.env*",
        "--glob",
        "!**/node_modules/**",
        "--glob",
        "!**/.git/**",
        "--glob",
        "!**/dist/**",
        "--glob",
        "!**/build/**",
        term,
        ".",
      ],
      { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    let output = "";
    const timer = setTimeout(() => child.kill(), 5_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (output.length < 2_000_000) output += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolveMatches([]);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const matches: ProjectSearchMatch[] = [];
      for (const line of output.split("\n")) {
        if (!line) continue;
        try {
          const record = JSON.parse(line) as {
            type?: string;
            data?: {
              path?: { text?: string };
              line_number?: number;
              lines?: { text?: string };
            };
          };
          const filePath = record.data?.path?.text;
          const snippet = record.data?.lines?.text?.trim();
          if (record.type === "match" && filePath && snippet)
            matches.push({
              filePath: filePath.replaceAll("\\", "/"),
              line: record.data?.line_number,
              snippet: snippet.slice(0, 500),
              layer: "ripgrep",
              score: 0.8,
            });
          if (matches.length >= limit) break;
        } catch {
          /* Ignore non-JSON/truncated records. */
        }
      }
      resolveMatches(matches);
    });
  });
}

export class SqliteProjectSearch implements ProjectSearchProvider {
  constructor(
    private readonly database: JarvisDatabase,
    private readonly bus: LocalEventBus,
  ) {}

  async index(
    projectId: string,
  ): Promise<{ files: number; symbols: number; indexedAt: string }> {
    const project = this.#project(projectId);
    await this.bus.publish(
      this.bus.create("project.indexing", "projects.index", { projectId }),
    );
    const files = await this.#collectFiles(project.path);
    const indexedAt = new Date().toISOString();
    const seen = new Set<string>();
    let symbols = 0;
    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      for (const file of files) {
        const path = normalizedPath(project.path, file);
        const info = await stat(file);
        if (info.size > MAX_FILE_BYTES || !indexableFile(basename(file)))
          continue;
        const content = await readFile(file, "utf8");
        if (content.includes("\u0000")) continue;
        const hash = createHash("sha256").update(content).digest("hex");
        const id = createHash("sha256")
          .update(`${projectId}:${path.toLowerCase()}`)
          .digest("hex");
        seen.add(path.toLowerCase());
        this.database.connection
          .prepare(
            `INSERT INTO project_documents(
          id, project_id, path, file_name, content, hash, language, size_bytes, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, path) DO UPDATE SET content=excluded.content, hash=excluded.hash,
          language=excluded.language, size_bytes=excluded.size_bytes, indexed_at=excluded.indexed_at`,
          )
          .run(
            id,
            projectId,
            path,
            basename(path),
            content,
            hash,
            languageFor(path),
            info.size,
            indexedAt,
          );
        this.database.connection
          .prepare("DELETE FROM project_documents_fts WHERE document_id = ?")
          .run(id);
        this.database.connection
          .prepare(
            "INSERT INTO project_documents_fts(document_id, project_id, path, content) VALUES (?, ?, ?, ?)",
          )
          .run(id, projectId, path, content);
        this.database.connection
          .prepare("DELETE FROM project_document_symbols WHERE document_id = ?")
          .run(id);
        for (const symbol of symbolRows(content)) {
          const symbolId = createHash("sha256")
            .update(
              `${id}:${symbol.kind}:${symbol.name}:${String(symbol.line)}`,
            )
            .digest("hex");
          this.database.connection
            .prepare(
              `INSERT INTO project_document_symbols(id, document_id, project_id, name, kind, line)
            VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              symbolId,
              id,
              projectId,
              symbol.name,
              symbol.kind,
              symbol.line,
            );
          symbols += 1;
        }
      }
      const existing = this.database.connection
        .prepare("SELECT id, path FROM project_documents WHERE project_id = ?")
        .all(projectId) as Array<{ id: string; path: string }>;
      for (const row of existing)
        if (!seen.has(row.path.toLowerCase())) {
          this.database.connection
            .prepare("DELETE FROM project_documents_fts WHERE document_id = ?")
            .run(row.id);
          this.database.connection
            .prepare("DELETE FROM project_documents WHERE id = ?")
            .run(row.id);
        }
      this.database.connection.exec("COMMIT");
    } catch (cause) {
      this.database.connection.exec("ROLLBACK");
      throw cause;
    }
    const result = { files: seen.size, symbols, indexedAt };
    await this.bus.publish(
      this.bus.create("project.indexed", "projects.index", {
        projectId,
        ...result,
      }),
    );
    return result;
  }

  async search(request: ProjectSearchRequest): Promise<ProjectSearchResult> {
    await this.bus.publish(
      this.bus.create("project.search.started", "projects.search", {
        requestId: request.requestId,
        projectId: request.projectId,
        query: request.query,
      }),
    );
    try {
      const project = this.#project(request.projectId);
      const count = this.database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM project_documents WHERE project_id = ?",
        )
        .get(request.projectId) as { count: number };
      if (count.count === 0) await this.index(request.projectId);
      const matches: ProjectSearchMatch[] = [];
      const add = (match: ProjectSearchMatch): void => {
        if (
          !matches.some(
            (item) =>
              item.filePath === match.filePath &&
              item.line === match.line &&
              item.layer === match.layer,
          )
        )
          matches.push(match);
      };
      const normalizedQuery = request.query.replaceAll("\\", "/").toLowerCase();
      const pathRows = this.database.connection
        .prepare(
          `SELECT path, content FROM project_documents
        WHERE project_id = ? AND lower(path) LIKE ? ORDER BY length(path) LIMIT ?`,
        )
        .all(
          request.projectId,
          `%${normalizedQuery}%`,
          request.limit,
        ) as Array<{ path: string; content: string }>;
      for (const row of pathRows)
        add({
          filePath: row.path,
          snippet: row.content.split("\n").at(0)?.slice(0, 500) || row.path,
          layer: "exact_path",
          score: 1,
        });

      const terms = queryTerms(request.query);
      const filenameTerm = terms.at(0) ?? normalizedQuery;
      const fileRows = this.database.connection
        .prepare(
          `SELECT path, content FROM project_documents
        WHERE project_id = ? AND lower(file_name) LIKE ? ORDER BY length(file_name) LIMIT ?`,
        )
        .all(request.projectId, `%${filenameTerm}%`, request.limit) as Array<{
        path: string;
        content: string;
      }>;
      for (const row of fileRows)
        add({
          filePath: row.path,
          snippet: row.content.split("\n").at(0)?.slice(0, 500) || row.path,
          layer: "filename",
          score: 0.9,
        });

      if (terms.length > 0) {
        const symbolRowsFound = this.database.connection
          .prepare(
            `SELECT d.path, s.name, s.kind, s.line
          FROM project_document_symbols s JOIN project_documents d ON d.id = s.document_id
          WHERE s.project_id = ? AND (${terms.map(() => "lower(s.name) LIKE ?").join(" OR ")})
          ORDER BY length(s.name) LIMIT ?`,
          )
          .all(
            request.projectId,
            ...terms.map((term) => `%${term}%`),
            request.limit,
          ) as Array<{
          path: string;
          name: string;
          kind: string;
          line: number;
        }>;
        for (const row of symbolRowsFound)
          add({
            filePath: row.path,
            line: row.line,
            snippet: `${row.kind} ${row.name}`,
            symbol: row.name,
            layer: "symbol",
            score: 0.88,
          });
      }

      for (const match of await ripgrep(
        project.path,
        request.query,
        request.limit,
      ))
        add(match);

      if (terms.length > 0) {
        const ftsQuery = terms
          .map((term) => `"${term.replaceAll('"', '""')}"*`)
          .join(" OR ");
        const ftsRows = this.database.connection
          .prepare(
            `SELECT path, snippet(project_documents_fts, 3, '[', ']', ' … ', 20) AS snippet
          FROM project_documents_fts WHERE project_id = ? AND project_documents_fts MATCH ?
          ORDER BY bm25(project_documents_fts) LIMIT ?`,
          )
          .all(request.projectId, ftsQuery, request.limit) as Array<{
          path: string;
          snippet: string;
        }>;
        for (const row of ftsRows)
          add({
            filePath: row.path,
            snippet: row.snippet.slice(0, 500),
            layer: "fts",
            score: 0.7,
          });
      }
      const indexed = this.database.connection
        .prepare(
          "SELECT MAX(indexed_at) AS indexed_at FROM project_documents WHERE project_id = ?",
        )
        .get(request.projectId) as { indexed_at: string | null };
      const result = projectSearchResultSchema.parse({
        requestId: request.requestId,
        projectId: request.projectId,
        query: request.query,
        matches: matches.slice(0, request.limit),
        ...(indexed.indexed_at ? { indexedAt: indexed.indexed_at } : {}),
      });
      await this.bus.publish(
        this.bus.create("project.search.completed", "projects.search", {
          requestId: request.requestId,
          projectId: request.projectId,
          matchCount: result.matches.length,
        }),
      );
      return result;
    } catch (cause) {
      await this.bus.publish(
        this.bus.create("project.search.failed", "projects.search", {
          requestId: request.requestId,
          projectId: request.projectId,
          code: "PROJECT_SEARCH_FAILED",
          message:
            cause instanceof Error ? cause.message : "Project search failed",
        }),
      );
      throw cause;
    }
  }

  #project(projectId: string): { path: string } {
    const row = this.database.connection
      .prepare("SELECT path FROM projects WHERE id = ? AND enabled = 1")
      .get(projectId) as { path: string } | undefined;
    if (!row)
      throw new ProjectRegistryError(
        "PROJECT_NOT_AVAILABLE",
        "Project is missing or disabled",
      );
    return row;
  }

  async #collectFiles(rootPath: string): Promise<string[]> {
    const root = await realpath(rootPath);
    const files: string[] = [];
    const queue = [root];
    while (queue.length > 0 && files.length < 50_000) {
      const current = queue.shift();
      if (!current) break;
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const path = resolve(current, entry.name);
        if (
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          !SKIP_DIRECTORIES.has(entry.name.toLowerCase())
        )
          queue.push(path);
        else if (entry.isFile() && indexableFile(entry.name)) files.push(path);
      }
    }
    return files;
  }
}

import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openJarvisDatabase,
  type JarvisDatabase,
} from "../packages/database/src/index.js";
import { LocalEventBus } from "../packages/event-bus/src/index.js";
import {
  SqliteProjectRegistry,
  SqliteProjectSearch,
} from "../services/projects/src/index.js";

describe("project search", () => {
  let temporary: string | undefined;
  let database: JarvisDatabase | undefined;

  afterEach(async () => {
    database?.close();
    if (temporary) await rm(temporary, { recursive: true, force: true });
    temporary = undefined;
  });

  it("indexes safe text and returns layered file, symbol, ripgrep, and FTS evidence", async () => {
    temporary = await mkdtemp(join(tmpdir(), "jarvis-search-"));
    const projectPath = join(temporary, "SchoolConnect");
    await mkdir(join(projectPath, "src"), { recursive: true });
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({ name: "school-connect" }),
    );
    await writeFile(
      join(projectPath, "src", "authentication.ts"),
      "export function authenticateUser(token: string) {\n  return validateToken(token);\n}\n\nfunction validateToken(token: string) { return token.length > 10; }\n",
    );
    await writeFile(
      join(projectPath, ".env"),
      "DATABASE_PASSWORD=never-index-this\n",
    );

    database = openJarvisDatabase(":memory:");
    const bus = new LocalEventBus();
    const registry = new SqliteProjectRegistry({
      roots: [temporary],
      database,
      bus,
    });
    const project = (await registry.initialize()).projects.at(0);
    expect(project).toBeDefined();
    if (!project) throw new Error("Search fixture was not registered");
    const search = new SqliteProjectSearch(database, bus);
    const indexed = await search.index(project.id);
    expect(indexed.files).toBe(2);
    expect(indexed.symbols).toBeGreaterThanOrEqual(2);

    const result = await search.search({
      requestId: randomUUID(),
      projectId: project.id,
      query: "Where is authentication implemented?",
      limit: 20,
    });
    expect(
      result.matches.some(
        (match) => match.filePath === "src/authentication.ts",
      ),
    ).toBe(true);
    expect(result.matches.some((match) => match.layer === "filename")).toBe(
      true,
    );
    expect(
      result.matches.some(
        (match) => match.layer === "ripgrep" || match.layer === "fts",
      ),
    ).toBe(true);

    const symbol = await search.search({
      requestId: randomUUID(),
      projectId: project.id,
      query: "authenticateUser",
      limit: 10,
    });
    expect(symbol.matches).toContainEqual(
      expect.objectContaining({
        layer: "symbol",
        symbol: "authenticateUser",
        line: 1,
      }),
    );
    const secretCount = database.connection
      .prepare(
        "SELECT COUNT(*) AS count FROM project_documents WHERE path LIKE '.env%'",
      )
      .get() as { count: number };
    expect(secretCount.count).toBe(0);
  });

  it("removes deleted files during an incremental reindex", async () => {
    temporary = await mkdtemp(join(tmpdir(), "jarvis-search-delete-"));
    const projectPath = join(temporary, "App");
    await mkdir(projectPath);
    const source = join(projectPath, "obsolete.ts");
    await writeFile(join(projectPath, "package.json"), "{}");
    await writeFile(source, "export const obsoleteFeature = true;\n");
    database = openJarvisDatabase(":memory:");
    const bus = new LocalEventBus();
    const registry = new SqliteProjectRegistry({
      roots: [temporary],
      database,
      bus,
    });
    const project = (await registry.initialize()).projects.at(0);
    if (!project) throw new Error("Delete fixture was not registered");
    const search = new SqliteProjectSearch(database, bus);
    await search.index(project.id);
    await unlink(source);
    await search.index(project.id);
    const result = await search.search({
      requestId: randomUUID(),
      projectId: project.id,
      query: "obsoleteFeature",
      limit: 10,
    });
    expect(result.matches).toEqual([]);
  });
});

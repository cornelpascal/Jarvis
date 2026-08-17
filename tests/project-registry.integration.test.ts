import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openJarvisDatabase,
  type JarvisDatabase,
} from "../packages/database/src/index.js";
import { LocalEventBus } from "../packages/event-bus/src/index.js";
import { SqliteProjectRegistry } from "../services/projects/src/index.js";

describe("project registry", () => {
  const temporary: string[] = [];
  let database: JarvisDatabase | undefined;

  afterEach(async () => {
    database?.close();
    database = undefined;
    await Promise.all(
      temporary
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("discovers nested project signals and records only evidence-based commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-projects-"));
    temporary.push(root);
    const web = join(root, "SchoolConnect");
    const rust = join(web, "native");
    await mkdir(rust, { recursive: true });
    await writeFile(join(web, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(web, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", test: "vitest" } }),
    );
    await writeFile(
      join(rust, "Cargo.toml"),
      "[package]\nname='native'\nversion='0.1.0'\n",
    );

    database = openJarvisDatabase(":memory:");
    const bus = new LocalEventBus();
    const events: string[] = [];
    bus.subscribe((event) => events.push(event.type));
    const registry = new SqliteProjectRegistry({
      roots: [root],
      database,
      bus,
    });
    const snapshot = await registry.initialize();

    expect(snapshot.projects.map((project) => project.name)).toEqual([
      "native",
      "SchoolConnect",
    ]);
    const project = snapshot.projects.find(
      (item) => item.name === "SchoolConnect",
    );
    expect(project).toBeDefined();
    if (!project) throw new Error("SchoolConnect fixture was not discovered");
    expect(project.stack).toContain("node");
    expect(project.commands.dev).toMatchObject({
      command: "pnpm dev",
      source: "package.json#scripts.dev",
    });
    expect(project.commands.build).toBeNull();
    expect(events).toContain("project.discovered");
    expect(events).toContain("project.scan.completed");
  });

  it("persists enablement and selection across registry instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-project-state-"));
    temporary.push(root);
    const path = join(root, "App");
    await mkdir(path);
    await writeFile(join(path, "README.md"), "# App\n");
    const dbPath = join(root, "registry.sqlite");
    database = openJarvisDatabase(dbPath);
    const bus = new LocalEventBus();
    const registry = new SqliteProjectRegistry({
      roots: [root],
      database,
      bus,
    });
    const initialized = await registry.initialize();
    const project = initialized.projects.at(0);
    expect(project).toBeDefined();
    if (!project) throw new Error("Project fixture was not discovered");
    registry.select(project.id);
    registry.setEnabled(project.id, false);
    expect(registry.snapshot()).toMatchObject({
      selectedProjectId: project.id,
      projects: [{ id: project.id, enabled: false }],
    });

    database.close();
    database = openJarvisDatabase(dbPath);
    const restored = new SqliteProjectRegistry({
      roots: [],
      database,
      bus,
    }).snapshot();
    expect(restored.roots).toHaveLength(1);
    expect(restored.projects[0]?.enabled).toBe(false);
    expect(restored.selectedProjectId).toBe(project.id);
  });

  it("supports manual projects and ignores inaccessible configured roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-project-manual-"));
    temporary.push(root);
    const plain = join(root, "PlainFolder");
    await mkdir(plain);
    database = openJarvisDatabase(":memory:");
    const registry = new SqliteProjectRegistry({
      roots: [join(root, "missing")],
      database,
      bus: new LocalEventBus(),
    });
    const initial = await registry.initialize();
    expect(initial.projects).toEqual([]);
    const registered = await registry.register(plain);
    expect(registered.signals).toEqual(["manual-registration"]);
    registry.remove(registered.id);
    expect(registry.snapshot().projects).toEqual([]);
  });
});

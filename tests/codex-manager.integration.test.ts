import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openJarvisDatabase,
  type JarvisDatabase,
} from "../packages/database/src/index.js";
import {
  CodexAppServerProvider,
  MockCodingAgentProvider,
} from "../services/codex-manager/src/index.js";

const projectId = "project-test";

function insertProject(database: JarvisDatabase, path: string): void {
  const now = new Date().toISOString();
  database.connection
    .prepare(
      "INSERT INTO projects(id, name, path, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    )
    .run(projectId, "Fixture", path, now, now);
}

describe("Codex manager", () => {
  let database: JarvisDatabase | undefined;
  let temporary: string | undefined;
  let provider: CodexAppServerProvider | undefined;

  afterEach(async () => {
    await provider?.close();
    provider = undefined;
    database?.close();
    database = undefined;
    if (temporary) await rm(temporary, { recursive: true, force: true });
    temporary = undefined;
  });

  it("maps structured App Server responses and notifications into task state", async () => {
    temporary = await mkdtemp(join(tmpdir(), "jarvis-codex-"));
    const fakeServer = join(temporary, "fake-app-server.mjs");
    await writeFile(
      fakeServer,
      `import readline from "node:readline";
const lines = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize" && message.id) send({ id: message.id, result: { userAgent: "fake", codexHome: "C:/fake", platformFamily: "windows", platformOs: "windows" } });
  if (message.method === "thread/start") send({ id: message.id, result: { thread: { id: "thread-1" }, model: "fake" } });
  if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: { id: "turn-1", status: "inProgress" } } });
    setTimeout(() => {
      send({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1", status: "inProgress" } } });
      send({ method: "item/started", params: { threadId: "thread-1", turnId: "turn-1", item: { type: "fileChange", id: "item-1" } } });
      send({ method: "turn/diff/updated", params: { threadId: "thread-1", turnId: "turn-1", diff: "diff --git a/a.ts b/a.ts" } });
      send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
    }, 10);
  }
  if (message.method === "turn/interrupt") send({ id: message.id, result: {} });
});
`,
    );
    database = openJarvisDatabase(":memory:");
    insertProject(database, temporary);
    provider = new CodexAppServerProvider({
      database,
      executable: process.execPath,
      executableArgsPrefix: [fakeServer],
    });
    const events: string[] = [];
    provider.subscribeEvents((event) =>
      events.push(`${event.type}:${event.label}`),
    );
    const task = await provider.createTask({
      projectId,
      title: "Implement fixture",
      instruction: "Edit the fixture safely",
      workingDirectory: temporary,
    });
    const started = await provider.startTask(task.id);
    expect(started).toMatchObject({
      state: "PLANNING",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    await expect
      .poll(async () => (await provider?.getStatus(task.id))?.state)
      .toBe("READY_FOR_REVIEW");
    await expect(provider.requestDiff(task.id)).resolves.toContain(
      "diff --git",
    );
    expect(events).toContain("item:Codex fileChange");
  });

  it("supports steering lifecycle through the mock provider", async () => {
    const mock = new MockCodingAgentProvider();
    const task = await mock.createTask({
      projectId,
      title: "Mock task",
      instruction: "Do work",
      workingDirectory: "C:\\fixture",
    });
    await expect(mock.startTask(task.id)).resolves.toMatchObject({
      state: "EDITING",
    });
    await expect(mock.pauseTask(task.id)).resolves.toMatchObject({
      state: "BLOCKED",
    });
    await expect(mock.resumeTask(task.id)).resolves.toMatchObject({
      state: "EDITING",
    });
    await expect(
      mock.sendInstruction(task.id, "Use the helper"),
    ).resolves.toMatchObject({ state: "EDITING" });
    await expect(mock.cancelTask(task.id)).resolves.toMatchObject({
      state: "CANCELLED",
    });
  });

  it("initializes the installed Codex App Server protocol", async () => {
    database = openJarvisDatabase(":memory:");
    provider = new CodexAppServerProvider({ database });
    const health = await provider.health();
    expect(health.status).toBe("available");
    const connected = await provider.connect();
    expect(connected.status).toBe("available");
    expect(connected.capabilities).toEqual(
      expect.arrayContaining<string>(["threads", "turns", "streaming"]),
    );
  }, 20_000);
});

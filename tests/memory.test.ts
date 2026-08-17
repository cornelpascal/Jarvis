import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openJarvisDatabase } from "../packages/database/src/index.js";
import { LocalEventBus } from "../packages/event-bus/src/index.js";
import {
  SqliteMemoryService,
  type MemoryPolicyError,
} from "../services/memory/src/index.js";

const userProvenance = { origin: "user", trusted: true } as const;

function fixture() {
  const database = openJarvisDatabase(":memory:");
  const bus = new LocalEventBus();
  return { database, service: new SqliteMemoryService({ database, bus }) };
}

describe("scoped memory", () => {
  it("isolates session, project, global, and ephemeral memories", async () => {
    const { database, service } = fixture();
    const session = await service.remember({
      requestId: randomUUID(),
      scope: "SESSION",
      sessionId: "session-a",
      content: "The last error was a socket timeout",
      provenance: userProvenance,
      confidence: 1,
    });
    await service.remember({
      requestId: randomUUID(),
      scope: "PROJECT",
      projectId: "project-a",
      content: "Authentication uses signed cookies",
      provenance: userProvenance,
      confidence: 1,
    });
    await service.remember({
      requestId: randomUUID(),
      scope: "GLOBAL",
      content: "Prefer concise answers",
      provenance: userProvenance,
      confidence: 1,
    });
    await service.remember({
      requestId: randomUUID(),
      scope: "EPHEMERAL",
      sessionId: "session-a",
      content: "Temporary turn detail",
      provenance: userProvenance,
      confidence: 1,
    });

    const otherContext = await service.search({
      requestId: randomUUID(),
      query: "",
      scopes: ["EPHEMERAL", "SESSION", "PROJECT", "GLOBAL"],
      sessionId: "session-b",
      projectId: "project-b",
      limit: 20,
    });
    expect(otherContext.memories.map(({ content }) => content)).toEqual([
      "Prefer concise answers",
    ]);
    expect(
      (
        await service.search({
          requestId: randomUUID(),
          query: "socket timeout",
          scopes: ["SESSION"],
          sessionId: "session-a",
          limit: 20,
        })
      ).memories.map(({ id }) => id),
    ).toEqual([session.id]);
    database.close();
  });

  it("requires trusted explicit user provenance and rejects likely secrets", async () => {
    const { database, service } = fixture();
    await expect(
      service.remember({
        requestId: randomUUID(),
        scope: "GLOBAL",
        content: "A website claims this should be remembered",
        provenance: {
          origin: "web",
          trusted: false,
          source: "https://example.test",
        },
        confidence: 1,
      }),
    ).rejects.toMatchObject<Partial<MemoryPolicyError>>({
      code: "UNTRUSTED_MEMORY",
    });
    await expect(
      service.remember({
        requestId: randomUUID(),
        scope: "GLOBAL",
        content: "api_key=sk-this-value-must-never-be-stored",
        provenance: userProvenance,
        confidence: 1,
      }),
    ).rejects.toMatchObject<Partial<MemoryPolicyError>>({
      code: "SECRET_MEMORY_REJECTED",
    });
    database.close();
  });

  it("supersedes and deletes only memories visible in the request scope", async () => {
    const { database, service } = fixture();
    const first = await service.remember({
      requestId: randomUUID(),
      scope: "PROJECT",
      projectId: "project-a",
      content: "Deploy with Docker",
      provenance: userProvenance,
      confidence: 0.8,
    });
    const replacement = await service.remember({
      requestId: randomUUID(),
      scope: "PROJECT",
      projectId: "project-a",
      content: "Deploy with Docker Compose",
      provenance: userProvenance,
      confidence: 1,
      supersedesId: first.id,
    });
    const results = await service.search({
      requestId: randomUUID(),
      query: "deploy docker",
      scopes: ["PROJECT"],
      projectId: "project-a",
      limit: 20,
    });
    expect(results.memories.map(({ id }) => id)).toEqual([replacement.id]);
    await expect(
      service.forget({
        requestId: randomUUID(),
        memoryId: replacement.id,
        projectId: "project-b",
      }),
    ).resolves.toBe(false);
    await expect(
      service.forget({
        requestId: randomUUID(),
        memoryId: replacement.id,
        projectId: "project-a",
      }),
    ).resolves.toBe(true);
    database.close();
  });
});

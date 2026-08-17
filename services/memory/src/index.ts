import { randomUUID } from "node:crypto";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import {
  memoryRecordSchema,
  memorySearchResultSchema,
  rememberRequestSchema,
  memorySearchRequestSchema,
  forgetMemoryRequestSchema,
  type ForgetMemoryRequest,
  type MemoryProvider,
  type MemoryRecord,
  type MemorySearchRequest,
  type RememberRequest,
} from "@jarvis/protocol";

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\b(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+/i,
];

interface MemoryRow {
  id: string;
  scope: MemoryRecord["scope"];
  scope_id: string | null;
  content: string;
  provenance_json: string;
  confidence: number;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
}

function scopeId(request: {
  scope: MemoryRecord["scope"];
  sessionId?: string | undefined;
  projectId?: string | undefined;
}): string | undefined {
  if (request.scope === "EPHEMERAL" || request.scope === "SESSION")
    return request.sessionId;
  if (request.scope === "PROJECT") return request.projectId;
  return undefined;
}

function rowToMemory(row: MemoryRow): MemoryRecord {
  return memoryRecordSchema.parse({
    id: row.id,
    scope: row.scope,
    ...(row.scope_id ? { scopeId: row.scope_id } : {}),
    content: row.content,
    provenance: JSON.parse(row.provenance_json) as unknown,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.supersedes_id ? { supersedesId: row.supersedes_id } : {}),
  });
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .filter((token) => token.length > 1),
  );
}

function relevance(content: string, query: string): number {
  if (!query) return 1;
  const queryTokens = tokens(query);
  if (queryTokens.size === 0) return 0;
  const contentTokens = tokens(content);
  let matches = 0;
  for (const token of queryTokens) if (contentTokens.has(token)) matches += 1;
  return matches / queryTokens.size;
}

function isAccessible(
  memory: MemoryRecord,
  context: {
    sessionId?: string | undefined;
    projectId?: string | undefined;
  },
): boolean {
  if (memory.scope === "GLOBAL") return true;
  if (memory.scope === "PROJECT") return memory.scopeId === context.projectId;
  return memory.scopeId === context.sessionId;
}

export class MemoryPolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MemoryPolicyError";
  }
}

export class SqliteMemoryService implements MemoryProvider {
  readonly #database: JarvisDatabase;
  readonly #bus: LocalEventBus;
  readonly #ephemeral = new Map<string, MemoryRecord>();

  constructor(options: { database: JarvisDatabase; bus: LocalEventBus }) {
    this.#database = options.database;
    this.#bus = options.bus;
  }

  async remember(input: RememberRequest): Promise<MemoryRecord> {
    const request = rememberRequestSchema.parse(input);
    if (request.provenance.origin !== "user" || !request.provenance.trusted)
      throw new MemoryPolicyError(
        "UNTRUSTED_MEMORY",
        "Only an explicit trusted user statement can create memory",
      );
    if (SECRET_PATTERNS.some((pattern) => pattern.test(request.content)))
      throw new MemoryPolicyError(
        "SECRET_MEMORY_REJECTED",
        "Potential secret material cannot be stored as memory",
      );
    const id = randomUUID();
    const now = new Date().toISOString();
    const resolvedScopeId = scopeId(request);
    const memory = memoryRecordSchema.parse({
      id,
      scope: request.scope,
      ...(resolvedScopeId ? { scopeId: resolvedScopeId } : {}),
      content: request.content,
      provenance: request.provenance,
      confidence: request.confidence,
      createdAt: now,
      updatedAt: now,
      ...(request.supersedesId ? { supersedesId: request.supersedesId } : {}),
    });
    if (request.supersedesId) {
      const previous = this.#find(request.supersedesId);
      if (!previous || !isAccessible(previous, request))
        throw new MemoryPolicyError(
          "MEMORY_NOT_FOUND",
          "The memory to supersede is outside this scope",
        );
      if (
        previous.scope !== memory.scope ||
        previous.scopeId !== memory.scopeId
      )
        throw new MemoryPolicyError(
          "MEMORY_SCOPE_MISMATCH",
          "A memory can be superseded only within the same scope",
        );
    }
    if (memory.scope === "EPHEMERAL") this.#ephemeral.set(memory.id, memory);
    else {
      this.#database.connection
        .prepare(
          `INSERT INTO memories(id,scope,scope_id,content,provenance_json,confidence,supersedes_id,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          memory.id,
          memory.scope,
          memory.scopeId ?? null,
          memory.content,
          JSON.stringify(memory.provenance),
          memory.confidence,
          memory.supersedesId ?? null,
          now,
          now,
        );
    }
    if (request.supersedesId) {
      if (this.#ephemeral.has(request.supersedesId))
        this.#ephemeral.delete(request.supersedesId);
      else
        this.#database.connection
          .prepare(
            "UPDATE memories SET superseded_by = ?, updated_at = ? WHERE id = ?",
          )
          .run(memory.id, now, request.supersedesId);
    }
    await this.#bus.publish(
      this.#bus.create("memory.saved", "memory", {
        requestId: request.requestId,
        memoryId: memory.id,
        scope: memory.scope,
        ...(memory.scopeId ? { scopeId: memory.scopeId } : {}),
      }),
    );
    return memory;
  }

  async search(input: MemorySearchRequest) {
    const request = memorySearchRequestSchema.parse(input);
    const allowed = new Set(request.scopes);
    const persistent = this.#database.connection
      .prepare(
        `SELECT id,scope,scope_id,content,provenance_json,confidence,supersedes_id,created_at,updated_at
         FROM memories WHERE deleted_at IS NULL AND superseded_by IS NULL ORDER BY updated_at DESC LIMIT 500`,
      )
      .all() as unknown as MemoryRow[];
    const candidates = [
      ...this.#ephemeral.values(),
      ...persistent.map(rowToMemory),
    ].filter(
      (memory) => allowed.has(memory.scope) && isAccessible(memory, request),
    );
    const memories = candidates
      .map((memory) => ({
        memory,
        score: relevance(memory.content, request.query),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.memory.updatedAt.localeCompare(left.memory.updatedAt),
      )
      .slice(0, request.limit)
      .map(({ memory }) => memory);
    await this.#bus.publish(
      this.#bus.create("memory.recalled", "memory", {
        requestId: request.requestId,
        count: memories.length,
        scopes: request.scopes,
      }),
    );
    return memorySearchResultSchema.parse({
      requestId: request.requestId,
      memories,
    });
  }

  async forget(input: ForgetMemoryRequest): Promise<boolean> {
    const request = forgetMemoryRequestSchema.parse(input);
    const memory = this.#find(request.memoryId);
    if (!memory || !isAccessible(memory, request)) return false;
    if (memory.scope === "EPHEMERAL") this.#ephemeral.delete(memory.id);
    else
      this.#database.connection
        .prepare(
          "UPDATE memories SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        )
        .run(new Date().toISOString(), new Date().toISOString(), memory.id);
    await this.#bus.publish(
      this.#bus.create("memory.forgotten", "memory", {
        requestId: request.requestId,
        memoryId: memory.id,
        scope: memory.scope,
      }),
    );
    return true;
  }

  #find(id: string): MemoryRecord | undefined {
    const ephemeral = this.#ephemeral.get(id);
    if (ephemeral) return ephemeral;
    const row = this.#database.connection
      .prepare(
        `SELECT id,scope,scope_id,content,provenance_json,confidence,supersedes_id,created_at,updated_at
         FROM memories WHERE id = ? AND deleted_at IS NULL AND superseded_by IS NULL`,
      )
      .get(id) as unknown as MemoryRow | undefined;
    return row ? rowToMemory(row) : undefined;
  }
}

import { z } from "zod";

export const EVENT_SCHEMA_VERSION = 1;
export const MAX_EVENT_BYTES = 256 * 1024;

export const eventTypeFamilies = [
  "jarvis",
  "voice",
  "conversation",
  "agent",
  "research",
  "reference",
  "browser",
  "project",
  "codex",
  "git",
  "deployment",
  "system",
  "approval",
  "memory",
  "notification",
] as const;

export type EventTypeFamily = (typeof eventTypeFamilies)[number];

const eventEnvelopeShape = {
  id: z.uuid(),
  sequence: z.int().nonnegative(),
  timestamp: z.iso.datetime(),
  sessionId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  type: z.string().regex(/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*$/),
  source: z.string().min(1).max(100),
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
} as const;

export const jarvisEventSchema = z.strictObject({
  ...eventEnvelopeShape,
  payload: z.unknown(),
});

export type JarvisEvent<TPayload = unknown> = Omit<
  z.infer<typeof jarvisEventSchema>,
  "payload"
> & {
  payload: TPayload;
};

export const eventPayloadSchemas = {
  "jarvis.ready": z.strictObject({ healthUrl: z.url() }),
  "jarvis.state.changed": z.strictObject({
    state: z.enum([
      "IDLE",
      "LISTENING",
      "USER_SPEAKING",
      "THINKING",
      "SEARCHING",
      "RESEARCHING",
      "CODING",
      "TESTING",
      "WAITING_APPROVAL",
      "SPEAKING",
      "ERROR",
    ]),
    reason: z.string().min(1).optional(),
  }),
  "jarvis.test": z.strictObject({
    message: z.string().min(1),
    ordinal: z.int().nonnegative(),
  }),
  "system.health": z.strictObject({
    status: z.enum(["ok", "degraded", "unavailable"]),
    database: z.enum(["ok", "degraded", "unavailable"]),
    uptimeSeconds: z.number().nonnegative(),
  }),
  "system.telemetry": z.strictObject({
    cpuPercent: z.number().min(0).max(100),
    ramUsedBytes: z.number().nonnegative(),
    ramTotalBytes: z.number().positive(),
    diskUsedBytes: z.number().nonnegative().optional(),
    diskTotalBytes: z.number().positive().optional(),
    network: z.enum(["online", "offline", "unknown"]),
    microphone: z.enum(["ready", "muted", "unavailable", "not_configured"]),
    voice: z.enum([
      "idle",
      "listening",
      "speaking",
      "unavailable",
      "not_configured",
    ]),
    core: z.enum(["online", "degraded", "offline"]),
    codexAgents: z.int().nonnegative(),
  }),
  "voice.connected": z.strictObject({
    provider: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  "voice.listening": z.strictObject({
    provider: z.string().min(1),
    muted: z.boolean(),
  }),
  "voice.user_speaking": z.strictObject({ provider: z.string().min(1) }),
  "voice.processing": z.strictObject({ provider: z.string().min(1) }),
  "voice.speaking": z.strictObject({ provider: z.string().min(1) }),
  "voice.interrupted": z.strictObject({
    provider: z.string().min(1),
    by: z.enum(["user", "system", "disconnect"]),
  }),
  "voice.muted.changed": z.strictObject({ muted: z.boolean() }),
  "voice.disconnected": z.strictObject({
    provider: z.string().min(1),
    reason: z.string().min(1),
    retryable: z.boolean(),
  }),
  "voice.failed": z.strictObject({
    provider: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
  "conversation.message.added": z.strictObject({
    messageId: z.string().min(1),
    role: z.enum(["user", "assistant", "activity"]),
    content: z.string().min(1),
    citations: z
      .array(z.strictObject({ title: z.string().min(1), url: z.url() }))
      .default([]),
  }),
  "conversation.route.selected": z.strictObject({
    requestId: z.uuid(),
    route: z.enum([
      "conversation",
      "research",
      "project",
      "coding",
      "browser",
      "system",
      "git",
      "deployment",
      "reference",
      "memory",
    ]),
    confidence: z.number().min(0).max(1),
    candidates: z.array(
      z.strictObject({
        route: z.enum([
          "conversation",
          "research",
          "project",
          "coding",
          "browser",
          "system",
          "git",
          "deployment",
          "reference",
          "memory",
        ]),
        score: z.number().min(0).max(1),
      }),
    ),
    toolShortlist: z.array(z.string().min(1)).min(3).max(8),
    reasons: z.array(z.string().min(1)),
    requiresClarification: z.boolean(),
  }),
  "project.registered": z.strictObject({
    projectId: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1),
    enabled: z.boolean(),
  }),
  "project.scan.started": z.strictObject({
    roots: z.array(z.string().min(1)),
  }),
  "project.discovered": z.strictObject({
    projectId: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1),
    signals: z.array(z.string().min(1)),
  }),
  "project.scan.completed": z.strictObject({
    discovered: z.int().nonnegative(),
    registered: z.int().nonnegative(),
    inaccessible: z.int().nonnegative(),
  }),
  "project.scan.failed": z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  "project.updated": z.strictObject({
    projectId: z.string().min(1),
    enabled: z.boolean(),
  }),
  "project.removed": z.strictObject({ projectId: z.string().min(1) }),
  "project.selected": z.strictObject({ projectId: z.string().min(1) }),
  "project.indexing": z.strictObject({ projectId: z.string().min(1) }),
  "project.indexed": z.strictObject({
    projectId: z.string().min(1),
    files: z.int().nonnegative(),
    symbols: z.int().nonnegative(),
    indexedAt: z.iso.datetime(),
  }),
  "project.search.started": z.strictObject({
    requestId: z.uuid(),
    projectId: z.string().min(1),
    query: z.string().min(1),
  }),
  "project.search.completed": z.strictObject({
    requestId: z.uuid(),
    projectId: z.string().min(1),
    matchCount: z.int().nonnegative(),
  }),
  "project.search.failed": z.strictObject({
    requestId: z.uuid(),
    projectId: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  "codex.agent.progress": z.strictObject({
    agentRunId: z.string().min(1),
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    label: z.string().min(1),
    title: z.string().min(1),
    state: z.string().min(1),
  }),
  "codex.task.created": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    title: z.string().min(1),
    state: z.literal("QUEUED"),
  }),
  "codex.agent.started": z.strictObject({
    agentRunId: z.string().min(1),
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    threadId: z.string().min(1),
  }),
  "codex.waiting_approval": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    method: z.string().min(1),
  }),
  "codex.diff.ready": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    diff: z.string(),
  }),
  "codex.command.started": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    name: z.enum(["lint", "typecheck", "test", "build"]),
    command: z.string().min(1),
  }),
  "codex.command.completed": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    name: z.enum(["lint", "typecheck", "test", "build"]),
    status: z.enum(["PASSED", "FAILED", "TIMED_OUT"]),
    exitCode: z.int().optional(),
    durationMs: z.int().nonnegative(),
  }),
  "codex.tests.started": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    checkCount: z.int().nonnegative(),
  }),
  "codex.tests.passed": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    checkCount: z.int().nonnegative(),
  }),
  "codex.tests.failed": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    failedChecks: z.array(z.string().min(1)),
  }),
  "codex.completed": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    state: z.enum(["READY_FOR_REVIEW", "COMPLETED"]),
  }),
  "codex.failed": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  "git.worktree.created": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    path: z.string().min(1),
    branch: z.string().min(1),
    baselineRevision: z.string().min(1),
    sourceDirty: z.boolean(),
  }),
  "git.worktree.removed": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
  }),
  "git.commit_requested": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    branch: z.string().min(1),
  }),
  "git.committed": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    branch: z.string().min(1),
    revision: z.string().min(1),
  }),
  "git.push_requested": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    branch: z.string().min(1),
    headRevision: z.string().min(1),
    changesDigest: z.string().min(1),
  }),
  "git.pushed": z.strictObject({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    branch: z.string().min(1),
    revision: z.string().min(1),
    remote: z.literal("origin"),
  }),
  "git.failed": z.strictObject({
    taskId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  "deployment.started": z.strictObject({
    runId: z.uuid(),
    projectId: z.string().min(1),
    environment: z.string().min(1),
    adapterType: z.string().min(1),
  }),
  "deployment.completed": z.strictObject({
    runId: z.uuid(),
    projectId: z.string().min(1),
    environment: z.string().min(1),
    health: z.enum(["HEALTHY", "UNHEALTHY", "SKIPPED"]),
    summary: z.string().min(1),
  }),
  "deployment.failed": z.strictObject({
    runId: z.uuid().optional(),
    projectId: z.string().min(1),
    environment: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  "deployment.config_missing": z.strictObject({
    projectId: z.string().min(1),
    environment: z.string().min(1),
  }),
  "deployment.config_proposed": z.strictObject({
    proposalId: z.uuid(),
    projectId: z.string().min(1),
    environment: z.string().min(1),
    recommendedType: z.string().min(1),
    confidence: z.number().min(0).max(1),
    unresolved: z.array(z.string().min(1)),
  }),
  "deployment.config_saved": z.strictObject({
    proposalId: z.uuid(),
    projectId: z.string().min(1),
    environment: z.string().min(1),
    adapterType: z.string().min(1),
  }),
  "system.action.started": z.strictObject({
    requestId: z.uuid(),
    action: z.string().min(1),
  }),
  "system.action.completed": z.strictObject({
    requestId: z.uuid(),
    action: z.string().min(1),
    message: z.string().min(1),
  }),
  "system.action.failed": z.strictObject({
    requestId: z.uuid(),
    action: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  "system.capture.started": z.strictObject({
    requestId: z.uuid(),
    mode: z.enum(["active_window", "primary_display"]),
  }),
  "system.capture.completed": z.strictObject({
    requestId: z.uuid(),
    contextId: z.uuid(),
    mode: z.enum(["active_window", "primary_display"]),
    byteLength: z.int().positive(),
    width: z.int().positive(),
    height: z.int().positive(),
    activeApplication: z.string().optional(),
  }),
  "system.capture.failed": z.strictObject({
    requestId: z.uuid(),
    mode: z.enum(["active_window", "primary_display"]),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  "conversation.context.captured": z.strictObject({
    contextId: z.uuid(),
    kind: z.literal("image"),
    mimeType: z.literal("image/png"),
    mode: z.enum(["active_window", "primary_display"]),
    activeApplication: z.string().optional(),
    capturedAt: z.iso.datetime(),
    retention: z.literal("ephemeral"),
  }),
  "memory.saved": z.strictObject({
    requestId: z.uuid(),
    memoryId: z.uuid(),
    scope: z.enum(["EPHEMERAL", "SESSION", "PROJECT", "GLOBAL"]),
    scopeId: z.string().min(1).optional(),
  }),
  "memory.recalled": z.strictObject({
    requestId: z.uuid(),
    count: z.int().nonnegative(),
    scopes: z.array(z.enum(["EPHEMERAL", "SESSION", "PROJECT", "GLOBAL"])),
  }),
  "memory.forgotten": z.strictObject({
    requestId: z.uuid(),
    memoryId: z.uuid(),
    scope: z.enum(["EPHEMERAL", "SESSION", "PROJECT", "GLOBAL"]),
  }),
  "notification.created": z.strictObject({
    notificationId: z.uuid(),
    type: z.enum(["task", "deployment", "research", "system"]),
    severity: z.enum(["info", "success", "warning", "error"]),
    title: z.string().min(1).max(200),
    body: z.string().max(1_000).optional(),
    projectId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    createdAt: z.iso.datetime(),
  }),
  "notification.read": z.strictObject({
    notificationId: z.uuid(),
    readAt: z.iso.datetime(),
  }),
  "approval.requested": z.strictObject({
    approvalId: z.string().min(1),
    action: z.string().min(1),
    reason: z.string().min(1),
    riskLevel: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
    ]),
    resource: z.string().min(1),
    projectId: z.string().min(1).optional(),
  }),
  "approval.approved": z.strictObject({
    approvalId: z.string().min(1),
    action: z.string().min(1),
    automatic: z.boolean(),
    receiptId: z.string().min(1).optional(),
    expiresAt: z.iso.datetime().optional(),
  }),
  "approval.rejected": z.strictObject({
    approvalId: z.string().min(1),
    action: z.string().min(1),
    reason: z.string().min(1).optional(),
  }),
  "reference.display.requested": z.strictObject({
    mode: z.enum([
      "SOURCES",
      "IMAGES",
      "VIDEO",
      "WEB",
      "CODE_DIFF",
      "DOCUMENT",
      "EMPTY",
    ]),
    title: z.string().min(1).optional(),
    items: z.array(
      z.strictObject({
        id: z.string().min(1),
        type: z.enum([
          "source",
          "image",
          "video",
          "web",
          "code_diff",
          "document",
        ]),
        title: z.string().min(1),
        uri: z.url().optional(),
        content: z.string().optional(),
      }),
    ),
  }),
  "reference.evaluating": z.strictObject({
    requestId: z.uuid(),
    threshold: z.number().min(0).max(1),
  }),
  "reference.evaluated": z.strictObject({
    requestId: z.uuid(),
    display: z.boolean(),
    score: z.number().min(0).max(1),
    reason: z.string().min(1),
    preferredMode: z.enum(["none", "sources", "images", "video", "mixed"]),
  }),
  "research.started": z.strictObject({
    requestId: z.uuid(),
    query: z.string().min(1),
  }),
  "research.searching": z.strictObject({
    requestId: z.uuid(),
    provider: z.string().min(1),
  }),
  "research.source_found": z.strictObject({
    requestId: z.uuid(),
    source: z.strictObject({
      id: z.string().min(1),
      title: z.string().min(1),
      url: z.url(),
      retrievedAt: z.iso.datetime(),
      provenance: z.strictObject({
        origin: z.literal("web"),
        trusted: z.literal(false),
        source: z.url(),
      }),
    }),
  }),
  "research.completed": z.strictObject({
    requestId: z.uuid(),
    answer: z.string().min(1),
    sourceCount: z.int().nonnegative(),
  }),
  "research.failed": z.strictObject({
    requestId: z.uuid(),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
  "browser.action.started": z.strictObject({
    requestId: z.uuid(),
    action: z.string().min(1),
  }),
  "browser.action.completed": z.strictObject({
    requestId: z.uuid(),
    action: z.string().min(1),
    tabId: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
  }),
  "browser.action.failed": z.strictObject({
    requestId: z.uuid(),
    action: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
} as const;

export type EventPayloadMap = {
  [K in keyof typeof eventPayloadSchemas]: z.infer<
    (typeof eventPayloadSchemas)[K]
  >;
};
export type KnownEventType = keyof EventPayloadMap;
export type KnownJarvisEvent = {
  [K in KnownEventType]: JarvisEvent<EventPayloadMap[K]> & { type: K };
}[KnownEventType];

export function parseJarvisEvent(input: unknown): KnownJarvisEvent {
  const envelope = jarvisEventSchema.parse(input);
  const family = envelope.type.split(".", 1)[0];
  if (!eventTypeFamilies.includes(family as EventTypeFamily)) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["type"],
        message: `Unknown event family: ${String(family)}`,
      },
    ]);
  }
  const schemas: Readonly<Record<string, z.ZodType>> = eventPayloadSchemas;
  const schema = schemas[envelope.type];
  if (!schema) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["type"],
        message: `Unregistered event type: ${envelope.type}`,
      },
    ]);
  }
  const payload = schema.parse(envelope.payload);
  return {
    ...envelope,
    type: envelope.type as KnownEventType,
    payload,
  } as KnownJarvisEvent;
}

export function encodedEventSize(event: JarvisEvent): number {
  return new TextEncoder().encode(JSON.stringify(event)).byteLength;
}

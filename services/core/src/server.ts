import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { JarvisConfig, JarvisEnvironment } from "@jarvis/config";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import { Logger } from "@jarvis/logging";
import {
  approvalResolutionSchema,
  type PermissionAction,
  type PermissionBroker,
  type PermissionRequest,
} from "@jarvis/permissions";
import {
  EVENT_SCHEMA_VERSION,
  MAX_EVENT_BYTES,
  MAX_REPLAY_LIMIT,
  PROTOCOL_VERSION,
  eventStreamSubscribeSchema,
  browserActionSchema,
  codingInstructionRequestSchema,
  codingTaskRequestSchema,
  projectEnabledRequestSchema,
  projectIndexRequestSchema,
  projectRegisterRequestSchema,
  projectSearchRequestSchema,
  projectSelectRequestSchema,
  routeRequestSchema,
  voiceClientSignalSchema,
  type CapabilityManifest,
  type BrowserProvider,
  type CodingAgentProvider,
  type CodingAgentEvent,
  type BrowserAction,
  type BrowserActionResult,
  type ProjectRegistryProvider,
  type ProjectSearchProvider,
  type EventStreamServerMessage,
  type HealthSnapshot,
  type ResearchProvider,
  type ResearchRequest,
  type RouteDecision,
  type RouteRequest,
  type TaskVerificationProvider,
  type GitTaskProvider,
  type GitTaskTarget,
  type DeploymentManagerProvider,
  deploymentConfigSchema,
  deploymentExecuteRequestSchema,
  type DeploymentPreview,
  type DeploymentProposal,
  type SystemControlProvider,
  systemActionSchema,
  screenshotRequestSchema,
  type ScreenshotProvider,
  rememberRequestSchema,
  memorySearchRequestSchema,
  forgetMemoryRequestSchema,
  type MemoryProvider,
  notificationListRequestSchema,
  notificationReadRequestSchema,
  type NotificationProvider,
  wakeWordControlSchema,
  type WakeWordProvider,
  type WorktreeManager,
  type VoiceClientSignal,
} from "@jarvis/protocol";
import { RealtimeGatewayError, type RealtimeCallGateway } from "@jarvis/voice";
import {
  ResearchProviderError,
  SmartReferenceEvaluator,
} from "@jarvis/research";
import { IntentRouter } from "./orchestrator.js";
import { BrowserAgentError } from "@jarvis/browser";
import { ProjectRegistryError } from "@jarvis/projects";
import { MemoryPolicyError } from "@jarvis/memory";

const MAX_BUFFERED_BYTES = 512 * 1024;
const SUBSCRIBE_TIMEOUT_MS = 5_000;
const MAX_COMMAND_BYTES = 64 * 1024;

export interface CoreServerOptions {
  config: JarvisConfig;
  environment: JarvisEnvironment;
  database: JarvisDatabase;
  bus: LocalEventBus;
  sessionToken: string;
  version: string;
  voiceGateway: RealtimeCallGateway;
  researchProvider: ResearchProvider;
  browserProvider: BrowserProvider;
  projectRegistry: ProjectRegistryProvider;
  projectSearch: ProjectSearchProvider;
  codingAgentProvider: CodingAgentProvider;
  worktreeManager: WorktreeManager;
  taskVerification: TaskVerificationProvider;
  permissionBroker: PermissionBroker;
  gitTaskManager: GitTaskProvider;
  deploymentManager: DeploymentManagerProvider;
  systemControlProvider: SystemControlProvider;
  screenshotProvider: ScreenshotProvider;
  memoryProvider: MemoryProvider;
  notificationProvider: NotificationProvider;
  wakeWordProvider: WakeWordProvider;
}

export interface CoreServer {
  readonly url: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface ClientState {
  subscribed: boolean;
  subscribeTimer: ReturnType<typeof setTimeout>;
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function permissionReceipt(request: IncomingMessage): string | undefined {
  const value = request.headers["x-jarvis-permission-receipt"];
  return Array.isArray(value) ? value[0] : value;
}

async function requirePermission(
  response: ServerResponse,
  broker: PermissionBroker,
  input: PermissionRequest,
  receiptId?: string,
): Promise<boolean> {
  const decision = await broker.authorize(input, receiptId);
  if (decision.state === "APPROVED") return true;
  sendJson(response, decision.state === "PENDING" ? 202 : 403, {
    code:
      decision.state === "PENDING" ? "APPROVAL_REQUIRED" : "PERMISSION_DENIED",
    approvalId: decision.approvalId,
    riskLevel: decision.riskLevel,
    ...(decision.state === "DENIED" ? { message: decision.reason } : {}),
    retryable: decision.state === "PENDING",
  });
  return false;
}

function permissionRequest(input: {
  action: PermissionAction;
  resource: string;
  reason: string;
  projectId?: string;
  arguments?: Record<string, unknown>;
  origin?: "user" | "project" | "web" | "system" | "agent";
  trusted?: boolean;
}): PermissionRequest {
  return {
    action: input.action,
    resource: input.resource,
    reason: input.reason,
    arguments: input.arguments ?? {},
    provenance: {
      origin: input.origin ?? "user",
      trusted: input.trusted ?? true,
    },
    ...(input.projectId ? { projectId: input.projectId } : {}),
  };
}

function protocolToken(request: IncomingMessage): string | undefined {
  const values =
    request.headers["sec-websocket-protocol"]
      ?.split(",")
      .map((value) => value.trim()) ?? [];
  const encoded = values
    .find((value) => value.startsWith("jarvis.token."))
    ?.slice("jarvis.token.".length);
  if (!encoded) return undefined;
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

function requestToken(request: IncomingMessage): string | undefined {
  const token = request.headers["x-jarvis-session-token"];
  return Array.isArray(token) ? token[0] : token;
}

function allowedOrigin(origin: string | undefined): boolean {
  return (
    origin === undefined ||
    origin === "tauri://localhost" ||
    /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin)
  );
}

async function readBody(
  request: IncomingMessage,
  maximumBytes = MAX_COMMAND_BYTES,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request as AsyncIterable<unknown>) {
    if (!(typeof chunk === "string" || chunk instanceof Uint8Array))
      throw new RealtimeGatewayError(
        "INVALID_REQUEST_BODY",
        "Request body contained an unsupported chunk",
        400,
        false,
      );
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maximumBytes)
      throw new RealtimeGatewayError(
        "REQUEST_TOO_LARGE",
        "Request body is too large",
        413,
        false,
      );
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function publishVoiceSignal(
  bus: LocalEventBus,
  signal: VoiceClientSignal,
  router: IntentRouter,
  researchProvider: ResearchProvider,
  permissions: PermissionBroker,
): Promise<void> {
  const provider = "openai-realtime";
  switch (signal.type) {
    case "voice.connected":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", {
          provider,
          sessionId: signal.sessionId,
        }),
        { durable: false },
      );
      return;
    case "voice.listening":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", {
          provider,
          muted: signal.muted,
        }),
        { durable: false },
      );
      return;
    case "voice.user_speaking":
    case "voice.processing":
    case "voice.speaking":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", { provider }),
        { durable: false },
      );
      return;
    case "voice.interrupted":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", {
          provider,
          by: signal.by,
        }),
        { durable: false },
      );
      return;
    case "voice.muted.changed":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", { muted: signal.muted }),
        { durable: false },
      );
      return;
    case "voice.disconnected":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", {
          provider,
          reason: signal.reason,
          retryable: signal.retryable,
        }),
        { durable: false },
      );
      return;
    case "voice.failed":
      await bus.publish(
        bus.create(signal.type, "dashboard.voice", {
          provider,
          code: signal.code,
          message: signal.message,
          retryable: signal.retryable,
        }),
        { durable: false },
      );
      return;
    case "conversation.transcript":
      await bus.publish(
        bus.create("conversation.message.added", "dashboard.voice", {
          messageId: signal.messageId,
          role: signal.role,
          content: signal.content,
          citations: [],
        }),
      );
      if (signal.role === "user") {
        const request = {
          requestId: randomUUID(),
          text: signal.content,
          provenance: { origin: "user", trusted: true },
        } as const;
        const decision = await publishRouteDecision(bus, router, request);
        if (decision.route === "research")
          void executeResearch(
            bus,
            researchProvider,
            {
              requestId: request.requestId,
              query: request.text,
            },
            0.65,
            permissions,
          );
      }
  }
}

async function publishRouteDecision(
  bus: LocalEventBus,
  router: IntentRouter,
  request: RouteRequest,
): Promise<RouteDecision> {
  const decision = router.route(request);
  await bus.publish(
    bus.create("conversation.route.selected", "core.orchestrator", decision),
  );
  return decision;
}

async function executeResearch(
  bus: LocalEventBus,
  provider: ResearchProvider,
  request: ResearchRequest,
  visualThreshold: number,
  permissions: PermissionBroker,
): Promise<void> {
  await bus.publish(bus.create("research.started", "core.research", request));
  await bus.publish(
    bus.create("jarvis.state.changed", "core.research", {
      state: "SEARCHING",
      reason: "Researching current public information",
    }),
  );
  await bus.publish(
    bus.create("research.searching", "core.research", {
      requestId: request.requestId,
      provider: "openai-web-search",
    }),
    { durable: false },
  );
  try {
    const permission = await permissions.authorize(
      permissionRequest({
        action: "research.search",
        resource: "public-web",
        reason: "Research current public information",
        arguments: { query: request.query },
      }),
    );
    if (permission.state !== "APPROVED")
      throw new Error("Research permission was denied");
    const result = await provider.research(request, {
      signal: new AbortController().signal,
      deadline: new Date(Date.now() + 30_000),
      correlationId: request.requestId,
    });
    for (const source of result.sources)
      await bus.publish(
        bus.create("research.source_found", "core.research", {
          requestId: request.requestId,
          source,
        }),
      );
    await bus.publish(
      bus.create("conversation.message.added", "core.research", {
        messageId: randomUUID(),
        role: "assistant",
        content: result.answer,
        citations: result.sources.map(({ title, url }) => ({ title, url })),
      }),
    );
    await bus.publish(
      bus.create("research.completed", "core.research", {
        requestId: request.requestId,
        answer: result.answer,
        sourceCount: result.sources.length,
      }),
    );
    void evaluateAndDisplayReferences(
      bus,
      new SmartReferenceEvaluator(),
      request,
      result.answer,
      result.sources,
      visualThreshold,
      permissions,
    );
    await bus.publish(
      bus.create("jarvis.state.changed", "core.research", { state: "IDLE" }),
    );
  } catch (cause) {
    const error =
      cause instanceof ResearchProviderError
        ? cause
        : new ResearchProviderError(
            "RESEARCH_FAILED",
            "Web research failed",
            true,
          );
    await bus.publish(
      bus.create("research.failed", "core.research", {
        requestId: request.requestId,
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      }),
    );
    await bus.publish(
      bus.create("jarvis.state.changed", "core.research", {
        state: "ERROR",
        reason: error.message,
      }),
    );
  }
}

async function executeBrowserAction(
  bus: LocalEventBus,
  provider: BrowserProvider,
  action: BrowserAction,
): Promise<BrowserActionResult> {
  await bus.publish(
    bus.create("browser.action.started", "core.browser", {
      requestId: action.requestId,
      action: action.action,
    }),
  );
  try {
    const result = await provider.execute(action, {
      signal: new AbortController().signal,
      deadline: new Date(Date.now() + 20_000),
      correlationId: action.requestId,
    });
    await bus.publish(
      bus.create("browser.action.completed", "core.browser", {
        requestId: result.requestId,
        action: result.action,
        ...(result.tabId ? { tabId: result.tabId } : {}),
        ...(result.url ? { url: result.url } : {}),
        ...(result.title ? { title: result.title } : {}),
      }),
    );
    if (action.action === "open_reference" && result.url)
      await bus.publish(
        bus.create("reference.display.requested", "core.browser", {
          mode: "WEB",
          title: result.title ?? "BROWSER REFERENCE",
          items: [
            {
              id: result.tabId ?? result.requestId,
              type: "web",
              title: result.title ?? result.url,
              uri: result.url,
            },
          ],
        }),
      );
    return result;
  } catch (cause) {
    const error =
      cause instanceof BrowserAgentError
        ? cause
        : new BrowserAgentError(
            "BROWSER_ACTION_FAILED",
            "Browser action failed",
          );
    await bus.publish(
      bus.create("browser.action.failed", "core.browser", {
        requestId: action.requestId,
        action: action.action,
        code: error.code,
        message: error.message,
      }),
    );
    throw error;
  }
}

async function evaluateAndDisplayReferences(
  bus: LocalEventBus,
  evaluator: SmartReferenceEvaluator,
  request: ResearchRequest,
  answer: string,
  sources: Awaited<ReturnType<ResearchProvider["research"]>>["sources"],
  threshold: number,
  permissions: PermissionBroker,
): Promise<void> {
  await bus.publish(
    bus.create("reference.evaluating", "core.references", {
      requestId: request.requestId,
      threshold,
    }),
    { durable: false },
  );
  const recommendation = evaluator.evaluate({
    requestId: request.requestId,
    query: request.query,
    answer,
    sourceCount: sources.length,
    threshold,
  });
  await bus.publish(
    bus.create("reference.evaluated", "core.references", {
      requestId: request.requestId,
      ...recommendation,
    }),
  );
  if (!recommendation.display) return;
  const permission = await permissions.authorize(
    permissionRequest({
      action: "reference.display",
      resource: `research:${request.requestId}`,
      reason: "Display Smart References selected from untrusted web results",
      arguments: { sourceCount: sources.length },
      origin: "web",
      trusted: false,
    }),
  );
  if (permission.state !== "APPROVED") return;
  await bus.publish(
    bus.create("reference.display.requested", "core.references", {
      mode: "SOURCES",
      title: `SMART REFERENCES // ${request.query}`,
      items: sources.map((source) => ({
        id: source.id,
        type: "source" as const,
        title: source.title,
        uri: source.url,
      })),
    }),
  );
}

async function executeProjectSearch(
  bus: LocalEventBus,
  provider: ProjectSearchProvider,
  request: RouteRequest,
  permissions: PermissionBroker,
): Promise<void> {
  if (!request.activeProjectId) return;
  try {
    const permission = await permissions.authorize(
      permissionRequest({
        action: "project.read",
        resource: `project:${request.activeProjectId}`,
        projectId: request.activeProjectId,
        reason: "Search the selected local project",
        arguments: { query: request.text },
      }),
    );
    if (permission.state !== "APPROVED") return;
    const result = await provider.search({
      requestId: request.requestId,
      projectId: request.activeProjectId,
      query: request.text,
      limit: 12,
    });
    const evidence = result.matches.slice(0, 5);
    const content =
      evidence.length === 0
        ? "I couldn't find relevant project evidence for that question."
        : `Relevant project evidence:\n${evidence
            .map(
              (match) =>
                `- ${match.filePath}${match.line ? `:${String(match.line)}` : ""} — ${match.snippet.replaceAll("\n", " ")}`,
            )
            .join("\n")}`;
    await bus.publish(
      bus.create("conversation.message.added", "core.project-search", {
        messageId: randomUUID(),
        role: "assistant",
        content,
        citations: [],
      }),
    );
  } catch {
    // The provider already emits a structured project.search.failed event.
  }
}

async function publishCodingAgentEvent(
  bus: LocalEventBus,
  provider: CodingAgentProvider,
  verification: TaskVerificationProvider,
  permissions: PermissionBroker,
  event: CodingAgentEvent,
): Promise<void> {
  const task = await provider.getStatus(event.taskId);
  if (event.state === "QUEUED")
    await bus.publish(
      bus.create("codex.task.created", "codex.manager", {
        taskId: task.id,
        projectId: task.projectId,
        title: task.title,
        state: "QUEUED",
      }),
    );
  if (event.label === "Codex thread started" && task.threadId)
    await bus.publish(
      bus.create("codex.agent.started", "codex.manager", {
        agentRunId: task.id,
        taskId: task.id,
        projectId: task.projectId,
        threadId: task.threadId,
      }),
    );
  await bus.publish(
    bus.create("codex.agent.progress", "codex.manager", {
      agentRunId: task.id,
      taskId: task.id,
      projectId: task.projectId,
      label: "CODEX",
      title: task.title,
      state: event.state ?? task.state,
    }),
  );
  if (event.type === "approval")
    await bus.publish(
      bus.create("codex.waiting_approval", "codex.manager", {
        taskId: task.id,
        projectId: task.projectId,
        method: event.label,
      }),
    );
  if (event.type === "diff")
    await bus.publish(
      bus.create("codex.diff.ready", "codex.manager", {
        taskId: task.id,
        projectId: task.projectId,
        diff: event.detail ?? "",
      }),
    );
  if (task.state === "READY_FOR_REVIEW" || task.state === "COMPLETED") {
    await bus.publish(
      bus.create("codex.completed", "codex.manager", {
        taskId: task.id,
        projectId: task.projectId,
        state: task.state,
      }),
    );
    if (task.state === "READY_FOR_REVIEW")
      void verifyTaskAndDisplay(
        bus,
        verification,
        permissions,
        task.id,
        task.projectId,
        task.title,
      ).catch(async (cause: unknown) => {
        await bus.publish(
          bus.create("codex.failed", "core.verification", {
            taskId: task.id,
            projectId: task.projectId,
            code: "VERIFICATION_FAILED",
            message:
              cause instanceof Error ? cause.message : "Verification failed",
          }),
        );
      });
  }
  if (event.type === "error")
    await bus.publish(
      bus.create("codex.failed", "codex.manager", {
        taskId: task.id,
        projectId: task.projectId,
        code: "CODEX_TURN_FAILED",
        message: event.detail ?? event.label,
      }),
    );
}

async function verifyTaskAndDisplay(
  bus: LocalEventBus,
  verification: TaskVerificationProvider,
  permissions: PermissionBroker,
  taskId: string,
  projectId: string,
  title: string,
  permissionAlreadyGranted = false,
) {
  if (!permissionAlreadyGranted) {
    const decision = await permissions.authorize(
      permissionRequest({
        action: "codex.task.verify",
        resource: `task:${taskId}`,
        projectId,
        reason: "Run evidence-backed checks in the isolated task worktree",
        arguments: { taskId },
        origin: "agent",
      }),
    );
    if (decision.state !== "APPROVED")
      throw new Error(
        decision.state === "DENIED"
          ? decision.reason
          : "Verification requires approval",
      );
  }
  const report = await verification.verify(taskId);
  await bus.publish(
    bus.create("reference.display.requested", "core.verification", {
      mode: "CODE_DIFF",
      title: `${title} — verification diff`,
      items: [
        {
          id: `diff-${taskId}`,
          type: "code_diff",
          title: `${title} diff`,
          content: report.diff || "No tracked changes were detected.",
        },
      ],
    }),
  );
  return report;
}

function gitPushPermission(target: GitTaskTarget): PermissionRequest {
  return permissionRequest({
    action: "git.push",
    resource: `task:${target.taskId}`,
    projectId: target.projectId,
    reason: `Push ${target.branch} to origin after review`,
    arguments: {
      taskId: target.taskId,
      branch: target.branch,
      headRevision: target.headRevision,
      changesDigest: target.changesDigest,
    },
  });
}

function deploymentPermission(preview: DeploymentPreview): PermissionRequest {
  return permissionRequest({
    action: "deployment.execute",
    resource: `deployment:${preview.projectId}:${preview.environment}`,
    projectId: preview.projectId,
    reason: `Deploy validated ${preview.adapterType} configuration to ${preview.environment}`,
    arguments: {
      environment: preview.environment,
      adapterType: preview.adapterType,
      configDigest: preview.configDigest,
    },
  });
}

function deploymentProposalPermission(
  proposal: DeploymentProposal,
): PermissionRequest {
  return permissionRequest({
    action: "project.configure",
    resource: `deployment-proposal:${proposal.id}`,
    projectId: proposal.projectId,
    reason: `Save the proposed ${proposal.recommendedType} deployment configuration`,
    arguments: {
      proposalId: proposal.id,
      proposalDigest: proposal.digest,
    },
  });
}

async function prepareDeploymentRoute(
  bus: LocalEventBus,
  manager: DeploymentManagerProvider,
  permissions: PermissionBroker,
  request: RouteRequest,
): Promise<void> {
  if (!request.activeProjectId) {
    await bus.publish(
      bus.create("conversation.message.added", "core.deployment", {
        messageId: randomUUID(),
        role: "assistant",
        content: "Select a project before requesting deployment.",
        citations: [],
      }),
    );
    return;
  }
  try {
    if (!manager.get(request.activeProjectId, "production")) {
      const proposalPermission = await permissions.authorize(
        permissionRequest({
          action: "deployment.propose",
          resource: `project:${request.activeProjectId}`,
          projectId: request.activeProjectId,
          reason: "Inspect deployment artifacts without executing them",
        }),
      );
      if (proposalPermission.state !== "APPROVED") return;
      await bus.publish(
        bus.create("deployment.config_missing", "core.deployment", {
          projectId: request.activeProjectId,
          environment: "production",
        }),
      );
      const proposal = await manager.propose(
        request.activeProjectId,
        "production",
      );
      await bus.publish(
        bus.create("deployment.config_proposed", "core.deployment", {
          proposalId: proposal.id,
          projectId: proposal.projectId,
          environment: proposal.environment,
          recommendedType: proposal.recommendedType,
          confidence: proposal.confidence,
          unresolved: proposal.unresolved,
        }),
      );
      await bus.publish(
        bus.create("reference.display.requested", "core.deployment", {
          mode: "DOCUMENT",
          title: "DEPLOYMENT CONFIGURATION PROPOSAL",
          items: [
            {
              id: proposal.id,
              type: "document",
              title: `${proposal.recommendedType} proposal`,
              content: JSON.stringify(proposal, null, 2),
            },
          ],
        }),
      );
      if (proposal.proposedConfig && proposal.unresolved.length === 0)
        await permissions.authorize(deploymentProposalPermission(proposal));
      await bus.publish(
        bus.create("conversation.message.added", "core.deployment", {
          messageId: randomUUID(),
          role: "assistant",
          content:
            proposal.unresolved.length > 0
              ? `I created a deployment proposal but need: ${proposal.unresolved.join(", ")}. Nothing was deployed.`
              : `I created a ${proposal.recommendedType} deployment proposal. Approve saving it for future use; nothing has been deployed.`,
          citations: [],
        }),
      );
      return;
    }
    const preview = manager.preview(request.activeProjectId, "production");
    const decision = await permissions.authorize(deploymentPermission(preview));
    await bus.publish(
      bus.create("conversation.message.added", "core.deployment", {
        messageId: randomUUID(),
        role: "assistant",
        content:
          decision.state === "PENDING"
            ? `${preview.summary} is ready and requires approval.`
            : decision.state === "DENIED"
              ? decision.reason
              : `${preview.summary} was approved by policy.`,
        citations: [],
      }),
    );
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Deployment preparation failed";
    await bus.publish(
      bus.create("deployment.failed", "core.deployment", {
        projectId: request.activeProjectId,
        environment: "production",
        code: "DEPLOYMENT_PREPARATION_FAILED",
        message,
      }),
    );
  }
}

async function publishGitTarget(
  bus: LocalEventBus,
  provider: GitTaskProvider,
  target: GitTaskTarget,
) {
  if (target.hasChanges)
    await bus.publish(
      bus.create("git.commit_requested", "core.git", {
        taskId: target.taskId,
        projectId: target.projectId,
        branch: target.branch,
      }),
    );
  const result = await provider.publish(target.taskId, target);
  if (result.committed)
    await bus.publish(
      bus.create("git.committed", "core.git", {
        taskId: result.taskId,
        projectId: result.projectId,
        branch: result.branch,
        revision: result.revision,
      }),
    );
  await bus.publish(
    bus.create("git.pushed", "core.git", {
      taskId: result.taskId,
      projectId: result.projectId,
      branch: result.branch,
      revision: result.revision,
      remote: result.remote,
    }),
  );
  return result;
}

async function prepareGitRoute(
  bus: LocalEventBus,
  provider: GitTaskProvider,
  permissions: PermissionBroker,
  request: RouteRequest,
): Promise<void> {
  try {
    const target = await provider.resolve({
      text: request.text,
      ...(request.activeTaskId ? { activeTaskId: request.activeTaskId } : {}),
      ...(request.activeProjectId
        ? { activeProjectId: request.activeProjectId }
        : {}),
    });
    await bus.publish(
      bus.create("git.push_requested", "core.git", {
        taskId: target.taskId,
        projectId: target.projectId,
        branch: target.branch,
        headRevision: target.headRevision,
        changesDigest: target.changesDigest,
      }),
    );
    const permission = await permissions.authorize(gitPushPermission(target));
    const content =
      permission.state === "PENDING"
        ? `Push ${target.branch} is ready and requires approval.`
        : permission.state === "DENIED"
          ? permission.reason
          : `Push ${target.branch} was approved by policy.`;
    await bus.publish(
      bus.create("conversation.message.added", "core.git", {
        messageId: randomUUID(),
        role: "assistant",
        content,
        citations: [],
      }),
    );
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Unable to resolve Git task";
    await bus.publish(
      bus.create("git.failed", "core.git", {
        code: "GIT_TARGET_UNRESOLVED",
        message,
      }),
    );
    await bus.publish(
      bus.create("conversation.message.added", "core.git", {
        messageId: randomUUID(),
        role: "assistant",
        content: message,
        citations: [],
      }),
    );
  }
}

function sendStreamMessage(
  client: WebSocket,
  message: EventStreamServerMessage,
): boolean {
  if (client.readyState !== WebSocket.OPEN) return false;
  if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
    client.close(1013, "Event consumer is too slow");
    return false;
  }
  client.send(JSON.stringify(message));
  return true;
}

function decodeRawData(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return raw.toString("utf8");
}

export function createCoreServer(options: CoreServerOptions): CoreServer {
  const logger = new Logger("core-server");
  const router = new IntentRouter();
  const startedAt = new Date();
  const clients = new Map<WebSocket, ClientState>();
  const health = (): HealthSnapshot => ({
    status: "ok",
    service: "jarvis-core",
    version: options.version,
    protocolVersion: PROTOCOL_VERSION,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.max(0, (Date.now() - startedAt.getTime()) / 1000),
    database: "ok",
    environment: options.environment,
  });
  const capabilities = async (): Promise<CapabilityManifest> => {
    const [voice, research, browser, codex] = await Promise.all([
      options.voiceGateway.health(),
      options.researchProvider.health(),
      options.browserProvider.health(),
      options.codingAgentProvider.health(),
    ]);
    return {
      protocolVersion: PROTOCOL_VERSION,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      capabilities: [
        "health",
        "capabilities",
        "events",
        "event-replay",
        "voice-webrtc",
        "voice-events",
        "request-routing",
        "web-research",
        "browser-agent",
      ],
      platform: process.platform,
      providers: {
        voice: voice.status,
        research: research.status,
        browser: browser.status,
        codex: codex.status,
      },
    };
  };
  const handleHttp = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const origin = request.headers.origin;
    if (origin && allowedOrigin(origin)) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "origin");
    }
    if (request.method === "OPTIONS") {
      if (!allowedOrigin(origin))
        return sendJson(response, 403, {
          code: "ORIGIN_REJECTED",
          message: "Origin is not allowed",
          retryable: false,
        });
      response.writeHead(204, {
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers":
          "content-type, x-jarvis-session-token, x-jarvis-permission-receipt",
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/health")
      return sendJson(response, 200, health());
    if (request.method === "GET" && request.url === "/capabilities")
      return sendJson(response, 200, await capabilities());
    if (request.method === "GET" && request.url === "/projects") {
      if (
        !allowedOrigin(origin) ||
        !tokenMatches(requestToken(request), options.sessionToken)
      )
        return sendJson(response, 401, {
          code: "UNAUTHORIZED",
          message: "A valid launch-scoped token is required",
          retryable: false,
        });
      return sendJson(response, 200, options.projectRegistry.snapshot());
    }
    if (
      request.method === "GET" &&
      /^\/codex\/tasks\/[^/]+$/.test(request.url ?? "")
    ) {
      if (
        !allowedOrigin(origin) ||
        !tokenMatches(requestToken(request), options.sessionToken)
      )
        return sendJson(response, 401, {
          code: "UNAUTHORIZED",
          message: "A valid launch-scoped token is required",
          retryable: false,
        });
      const taskId = request.url?.split("/").at(3);
      if (!taskId) throw new Error("Task identifier is missing");
      try {
        return sendJson(
          response,
          200,
          await options.codingAgentProvider.getStatus(
            decodeURIComponent(taskId),
          ),
        );
      } catch (cause) {
        return sendJson(response, 404, {
          code: "TASK_NOT_FOUND",
          message: cause instanceof Error ? cause.message : "Task not found",
          retryable: false,
        });
      }
    }
    if (request.method === "DELETE" && request.url?.startsWith("/projects/")) {
      if (
        !allowedOrigin(origin) ||
        !tokenMatches(requestToken(request), options.sessionToken)
      )
        return sendJson(response, 401, {
          code: "UNAUTHORIZED",
          message: "A valid launch-scoped token is required",
          retryable: false,
        });
      const segments = request.url.split("/").filter(Boolean);
      if (segments.length !== 2)
        return sendJson(response, 404, {
          code: "NOT_FOUND",
          message: "Route not found",
          retryable: false,
        });
      const projectId = segments.at(1);
      if (!projectId) throw new Error("Project identifier is missing");
      try {
        const decodedProjectId = decodeURIComponent(projectId);
        if (
          !(await requirePermission(
            response,
            options.permissionBroker,
            permissionRequest({
              action: "project.configure",
              resource: `project:${decodedProjectId}`,
              projectId: decodedProjectId,
              reason: "Remove a project from the JARVIS registry",
            }),
            permissionReceipt(request),
          ))
        )
          return;
        options.projectRegistry.remove(decodedProjectId);
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      } catch (cause) {
        if (cause instanceof ProjectRegistryError)
          return sendJson(response, 404, {
            code: cause.code,
            message: cause.message,
            retryable: false,
          });
        throw cause;
      }
    }
    if (
      request.method === "POST" &&
      (request.url === "/voice/call" ||
        request.url === "/voice/events" ||
        request.url === "/commands/route" ||
        request.url === "/browser/action" ||
        request.url === "/projects/scan" ||
        request.url === "/projects/register" ||
        request.url === "/projects/index" ||
        request.url === "/projects/search" ||
        request.url === "/codex/tasks" ||
        /^\/git\/tasks\/[^/]+\/push$/.test(request.url ?? "") ||
        request.url === "/deployment/configs" ||
        request.url === "/deployment/execute" ||
        request.url === "/system/action" ||
        request.url === "/context/capture" ||
        request.url === "/memory/remember" ||
        request.url === "/memory/search" ||
        request.url === "/memory/forget" ||
        request.url === "/notifications/list" ||
        request.url === "/notifications/read" ||
        request.url === "/wake-word/control" ||
        /^\/deployment\/proposals\/[^/]+\/save$/.test(request.url ?? "") ||
        /^\/approvals\/[^/]+\/resolve$/.test(request.url ?? "") ||
        /^\/codex\/tasks\/[^/]+\/(?:start|resume|pause|cancel|message|diff|verify)$/.test(
          request.url ?? "",
        ) ||
        request.url === "/projects/select" ||
        /^\/projects\/[^/]+\/enabled$/.test(request.url ?? ""))
    ) {
      if (
        !allowedOrigin(origin) ||
        !tokenMatches(requestToken(request), options.sessionToken)
      )
        return sendJson(response, 401, {
          code: "UNAUTHORIZED",
          message: "A valid launch-scoped token is required",
          retryable: false,
        });
      try {
        if (request.url === "/voice/call") {
          if (!request.headers["content-type"]?.startsWith("application/sdp"))
            return sendJson(response, 415, {
              code: "UNSUPPORTED_MEDIA_TYPE",
              message: "Voice offers require application/sdp",
              retryable: false,
            });
          const offerSdp = await readBody(request);
          return sendJson(
            response,
            201,
            await options.voiceGateway.createCall(
              offerSdp,
              AbortSignal.timeout(20_000),
            ),
          );
        }
        if (!request.headers["content-type"]?.startsWith("application/json"))
          return sendJson(response, 415, {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Commands require application/json",
            retryable: false,
          });
        if (request.url === "/commands/route") {
          const routeRequest = routeRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          await options.bus.publish(
            options.bus.create("conversation.message.added", "dashboard.text", {
              messageId: routeRequest.requestId,
              role: "user",
              content: routeRequest.text,
              citations: [],
            }),
          );
          const decision = await publishRouteDecision(
            options.bus,
            router,
            routeRequest,
          );
          if (decision.route === "research")
            void executeResearch(
              options.bus,
              options.researchProvider,
              {
                requestId: routeRequest.requestId,
                query: routeRequest.text,
              },
              options.config.references.visual_threshold,
              options.permissionBroker,
            );
          if (decision.route === "project" && routeRequest.activeProjectId)
            void executeProjectSearch(
              options.bus,
              options.projectSearch,
              routeRequest,
              options.permissionBroker,
            );
          if (decision.route === "git")
            void prepareGitRoute(
              options.bus,
              options.gitTaskManager,
              options.permissionBroker,
              routeRequest,
            );
          if (decision.route === "deployment")
            void prepareDeploymentRoute(
              options.bus,
              options.deploymentManager,
              options.permissionBroker,
              routeRequest,
            );
          return sendJson(response, 200, decision);
        }
        if (/^\/approvals\/[^/]+\/resolve$/.test(request.url ?? "")) {
          const approvalId = request.url?.split("/").at(2);
          if (!approvalId) throw new Error("Approval identifier is missing");
          const resolution = approvalResolutionSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          return sendJson(
            response,
            200,
            await options.permissionBroker.resolve(
              decodeURIComponent(approvalId),
              resolution.approved,
            ),
          );
        }
        if (request.url === "/browser/action") {
          const action = browserActionSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          const interaction = action.action === "click";
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: interaction ? "browser.interact" : "browser.read",
                resource:
                  "url" in action
                    ? `url:${action.url}`
                    : `browser-tab:${"tabId" in action ? (action.tabId ?? "active") : "active"}`,
                reason: interaction
                  ? "Interact with an element in the isolated browser"
                  : "Read or navigate public web content",
                arguments: action,
              }),
              permissionReceipt(request),
            ))
          )
            return;
          return sendJson(
            response,
            200,
            await executeBrowserAction(
              options.bus,
              options.browserProvider,
              action,
            ),
          );
        }
        if (request.url === "/projects/scan") {
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "project.read",
                resource: "configured-project-roots",
                reason: "Scan configured roots for local projects",
              }),
              permissionReceipt(request),
            ))
          )
            return;
          return sendJson(response, 200, await options.projectRegistry.scan());
        }
        if (request.url === "/projects/register") {
          const input = projectRegisterRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "project.configure",
                resource: `path:${input.path}`,
                reason: "Register a local project path",
                arguments: { enabled: input.enabled },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          return sendJson(
            response,
            201,
            await options.projectRegistry.register(input.path, input.enabled),
          );
        }
        if (request.url === "/projects/index") {
          const input = projectIndexRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "project.read",
                resource: `project:${input.projectId}`,
                projectId: input.projectId,
                reason: "Index non-secret project files for local retrieval",
              }),
              permissionReceipt(request),
            ))
          )
            return;
          return sendJson(
            response,
            200,
            await options.projectSearch.index(input.projectId),
          );
        }
        if (request.url === "/projects/search") {
          const input = projectSearchRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "project.read",
                resource: `project:${input.projectId}`,
                projectId: input.projectId,
                reason: "Search the local project index",
                arguments: { query: input.query },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          return sendJson(
            response,
            200,
            await options.projectSearch.search(input),
          );
        }
        if (request.url === "/projects/select") {
          const input = projectSelectRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "project.configure",
                resource: `project:${input.projectId}`,
                projectId: input.projectId,
                reason: "Select the active local project",
              }),
              permissionReceipt(request),
            ))
          )
            return;
          return sendJson(
            response,
            200,
            options.projectRegistry.select(input.projectId),
          );
        }
        if (request.url === "/codex/tasks") {
          const input = codingTaskRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          const project = options.projectRegistry
            .snapshot()
            .projects.find(
              (candidate) =>
                candidate.id === input.projectId && candidate.enabled,
            );
          if (!project)
            return sendJson(response, 404, {
              code: "PROJECT_NOT_AVAILABLE",
              message: "Project is missing or disabled",
              retryable: false,
            });
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "codex.task.create",
                resource: `project:${project.id}`,
                projectId: project.id,
                reason: "Create an isolated coding task and worktree",
                arguments: { title: input.title },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          const taskId = randomUUID();
          const worktree = await options.worktreeManager.create({
            taskId,
            projectId: project.id,
            projectPath: project.path,
            title: input.title,
          });
          try {
            const task = await options.codingAgentProvider.createTask({
              ...input,
              taskId,
              workingDirectory: worktree.path,
            });
            await options.bus.publish(
              options.bus.create("git.worktree.created", "core.worktrees", {
                taskId,
                projectId: project.id,
                path: worktree.path,
                branch: worktree.branch,
                baselineRevision: worktree.baselineRevision,
                sourceDirty: worktree.sourceDirty,
              }),
            );
            return sendJson(response, 201, task);
          } catch (cause) {
            await options.worktreeManager
              .cleanup(taskId)
              .catch(() => undefined);
            throw cause;
          }
        }
        if (/^\/git\/tasks\/[^/]+\/push$/.test(request.url ?? "")) {
          await readBody(request);
          const taskId = request.url?.split("/").at(3);
          if (!taskId) throw new Error("Git task identifier is missing");
          const target = await options.gitTaskManager.preview(
            decodeURIComponent(taskId),
          );
          await options.bus.publish(
            options.bus.create("git.push_requested", "core.git", {
              taskId: target.taskId,
              projectId: target.projectId,
              branch: target.branch,
              headRevision: target.headRevision,
              changesDigest: target.changesDigest,
            }),
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              gitPushPermission(target),
              permissionReceipt(request),
            ))
          )
            return;
          try {
            return sendJson(
              response,
              200,
              await publishGitTarget(
                options.bus,
                options.gitTaskManager,
                target,
              ),
            );
          } catch (cause) {
            const message =
              cause instanceof Error ? cause.message : "Git push failed";
            await options.bus.publish(
              options.bus.create("git.failed", "core.git", {
                taskId: target.taskId,
                projectId: target.projectId,
                code: "GIT_PUSH_FAILED",
                message,
              }),
            );
            return sendJson(response, 409, {
              code: "GIT_PUSH_FAILED",
              message,
              retryable: true,
            });
          }
        }
        if (request.url === "/deployment/configs") {
          const config = deploymentConfigSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "project.configure",
                resource: `deployment-config:${config.projectId}:${config.environment}`,
                projectId: config.projectId,
                reason: "Save a validated project deployment configuration",
                arguments: {
                  configId: config.id,
                  adapterType: config.type,
                },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          return sendJson(
            response,
            201,
            options.deploymentManager.save(config),
          );
        }
        if (/^\/deployment\/proposals\/[^/]+\/save$/.test(request.url ?? "")) {
          await readBody(request);
          const proposalId = request.url?.split("/").at(3);
          if (!proposalId)
            throw new Error("Deployment proposal identifier is missing");
          const proposal = options.deploymentManager.getProposal(
            decodeURIComponent(proposalId),
          );
          if (!proposal)
            return sendJson(response, 404, {
              code: "PROPOSAL_NOT_FOUND",
              message: "Deployment proposal not found",
              retryable: false,
            });
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              deploymentProposalPermission(proposal),
              permissionReceipt(request),
            ))
          )
            return;
          const config = options.deploymentManager.saveProposal(
            proposal.id,
            proposal.digest,
          );
          await options.bus.publish(
            options.bus.create("deployment.config_saved", "core.deployment", {
              proposalId: proposal.id,
              projectId: proposal.projectId,
              environment: proposal.environment,
              adapterType: config.type,
            }),
          );
          return sendJson(response, 201, config);
        }
        if (request.url === "/deployment/execute") {
          const input = deploymentExecuteRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          const preview = options.deploymentManager.preview(
            input.projectId,
            input.environment,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              deploymentPermission(preview),
              permissionReceipt(request),
            ))
          )
            return;
          try {
            return sendJson(
              response,
              200,
              await options.deploymentManager.deploy(
                input.projectId,
                input.environment,
                preview.configDigest,
              ),
            );
          } catch (cause) {
            return sendJson(response, 409, {
              code: "DEPLOYMENT_FAILED",
              message:
                cause instanceof Error ? cause.message : "Deployment failed",
              retryable: false,
            });
          }
        }
        if (request.url === "/system/action") {
          const action = systemActionSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          const readOnly = ["get_running_apps", "get_system_stats"].includes(
            action.action,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: readOnly ? "system.read" : "system.control",
                resource: `system:${action.action}`,
                reason: readOnly
                  ? "Read local Windows system state"
                  : `Perform the allow-listed Windows action ${action.action}`,
                arguments: action,
              }),
              permissionReceipt(request),
            ))
          )
            return;
          await options.bus.publish(
            options.bus.create("system.action.started", "core.system", {
              requestId: action.requestId,
              action: action.action,
            }),
          );
          try {
            const result = await options.systemControlProvider.execute(action);
            await options.bus.publish(
              options.bus.create("system.action.completed", "core.system", {
                requestId: action.requestId,
                action: action.action,
                message: result.message,
              }),
            );
            return sendJson(response, 200, result);
          } catch (cause) {
            const message =
              cause instanceof Error ? cause.message : "System action failed";
            await options.bus.publish(
              options.bus.create("system.action.failed", "core.system", {
                requestId: action.requestId,
                action: action.action,
                code: "SYSTEM_ACTION_FAILED",
                message,
              }),
            );
            return sendJson(response, 409, {
              code: "SYSTEM_ACTION_FAILED",
              message,
              retryable: false,
            });
          }
        }
        if (request.url === "/context/capture") {
          const input = screenshotRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "system.capture",
                resource: `display:${input.mode}`,
                reason: "Capture the explicitly requested screen context",
                arguments: { mode: input.mode },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          await options.bus.publish(
            options.bus.create("system.capture.started", "core.screenshot", {
              requestId: input.requestId,
              mode: input.mode,
            }),
          );
          try {
            const result = await options.screenshotProvider.capture(input);
            await options.bus.publish(
              options.bus.create(
                "system.capture.completed",
                "core.screenshot",
                {
                  requestId: result.requestId,
                  contextId: result.contextId,
                  mode: result.mode,
                  byteLength: result.byteLength,
                  width: result.width,
                  height: result.height,
                  ...(result.activeApplication
                    ? { activeApplication: result.activeApplication }
                    : {}),
                },
              ),
            );
            await options.bus.publish(
              options.bus.create(
                "conversation.context.captured",
                "core.screenshot",
                {
                  contextId: result.contextId,
                  kind: "image",
                  mimeType: result.mimeType,
                  mode: result.mode,
                  ...(result.activeApplication
                    ? { activeApplication: result.activeApplication }
                    : {}),
                  capturedAt: result.capturedAt,
                  retention: result.retention,
                },
              ),
            );
            return sendJson(response, 200, result);
          } catch (cause) {
            const message =
              cause instanceof Error ? cause.message : "Screen capture failed";
            await options.bus.publish(
              options.bus.create("system.capture.failed", "core.screenshot", {
                requestId: input.requestId,
                mode: input.mode,
                code: "SCREEN_CAPTURE_FAILED",
                message,
              }),
            );
            return sendJson(response, 409, {
              code: "SCREEN_CAPTURE_FAILED",
              message,
              retryable: true,
            });
          }
        }
        if (request.url === "/memory/remember") {
          const input = rememberRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "memory.write",
                resource: `memory:${input.scope}`,
                ...(input.projectId ? { projectId: input.projectId } : {}),
                reason: "Store an explicit user-requested memory",
                arguments: { scope: input.scope },
                origin: input.provenance.origin,
                trusted: input.provenance.trusted,
              }),
              permissionReceipt(request),
            ))
          )
            return;
          return sendJson(
            response,
            201,
            await options.memoryProvider.remember(input),
          );
        }
        if (request.url === "/memory/search") {
          const input = memorySearchRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "memory.read",
                resource: `memory:${input.scopes.join(",")}`,
                ...(input.projectId ? { projectId: input.projectId } : {}),
                reason: "Retrieve relevant memory within explicit scopes",
                arguments: {
                  scopes: input.scopes,
                  hasQuery: Boolean(input.query),
                },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          return sendJson(
            response,
            200,
            await options.memoryProvider.search(input),
          );
        }
        if (request.url === "/memory/forget") {
          const input = forgetMemoryRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "memory.write",
                resource: `memory:${input.memoryId}`,
                ...(input.projectId ? { projectId: input.projectId } : {}),
                reason: "Delete an explicitly selected memory",
                arguments: { memoryId: input.memoryId },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          const forgotten = await options.memoryProvider.forget(input);
          return forgotten
            ? sendJson(response, 200, { forgotten: true })
            : sendJson(response, 404, {
                code: "MEMORY_NOT_FOUND",
                message: "Memory not found in the requested scope",
                retryable: false,
              });
        }
        if (request.url === "/notifications/list") {
          const input = notificationListRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "notification.read",
                resource: "notifications",
                reason: "Read the local notification center",
                arguments: { unreadOnly: input.unreadOnly, limit: input.limit },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          return sendJson(response, 200, {
            notifications: options.notificationProvider.list(input),
          });
        }
        if (request.url === "/notifications/read") {
          const input = notificationReadRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "notification.update",
                resource: `notification:${input.notificationId}`,
                reason: "Acknowledge a local notification",
                arguments: { notificationId: input.notificationId },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          const notification = await options.notificationProvider.markRead(
            input.notificationId,
          );
          return notification
            ? sendJson(response, 200, notification)
            : sendJson(response, 404, {
                code: "NOTIFICATION_NOT_FOUND",
                message: "Notification not found",
                retryable: false,
              });
        }
        if (request.url === "/wake-word/control") {
          const input = wakeWordControlSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "voice.wake_word",
                resource: "microphone:wake-word",
                reason: input.enabled
                  ? "Enable local wake-word microphone processing"
                  : "Disable local wake-word microphone processing",
                arguments: { enabled: input.enabled },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          if (input.enabled) await options.wakeWordProvider.start();
          else await options.wakeWordProvider.stop();
          return sendJson(response, 200, {
            state: options.wakeWordProvider.state(),
          });
        }
        if (
          /^\/codex\/tasks\/[^/]+\/(?:start|resume|pause|cancel|message|diff|verify)$/.test(
            request.url ?? "",
          )
        ) {
          const parts = request.url?.split("/");
          const taskId = parts?.at(3);
          const action = parts?.at(4);
          if (!taskId || !action)
            throw new Error("Task action target is missing");
          const decodedTaskId = decodeURIComponent(taskId);
          const task =
            await options.codingAgentProvider.getStatus(decodedTaskId);
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action:
                  action === "verify"
                    ? "codex.task.verify"
                    : "codex.task.control",
                resource: `task:${decodedTaskId}`,
                projectId: task.projectId,
                reason: `Run coding task action: ${action}`,
                arguments: { taskId: decodedTaskId, action },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          if (action === "start")
            return sendJson(
              response,
              200,
              await options.codingAgentProvider.startTask(decodedTaskId),
            );
          if (action === "resume")
            return sendJson(
              response,
              200,
              await options.codingAgentProvider.resumeTask(decodedTaskId),
            );
          if (action === "pause")
            return sendJson(
              response,
              200,
              await options.codingAgentProvider.pauseTask(decodedTaskId),
            );
          if (action === "cancel")
            return sendJson(
              response,
              200,
              await options.codingAgentProvider.cancelTask(decodedTaskId),
            );
          if (action === "diff")
            return sendJson(response, 200, {
              taskId: decodedTaskId,
              diff: await options.codingAgentProvider.requestDiff(
                decodedTaskId,
              ),
            });
          if (action === "verify") {
            return sendJson(
              response,
              200,
              await verifyTaskAndDisplay(
                options.bus,
                options.taskVerification,
                options.permissionBroker,
                decodedTaskId,
                task.projectId,
                task.title,
                true,
              ),
            );
          }
          const input = codingInstructionRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          return sendJson(
            response,
            200,
            await options.codingAgentProvider.sendInstruction(
              decodedTaskId,
              input.instruction,
            ),
          );
        }
        if (/^\/projects\/[^/]+\/enabled$/.test(request.url ?? "")) {
          const projectIdSegment = request.url?.split("/").at(2);
          if (!projectIdSegment)
            throw new Error("Project identifier is missing");
          const projectId = decodeURIComponent(projectIdSegment);
          const input = projectEnabledRequestSchema.parse(
            JSON.parse(await readBody(request)) as unknown,
          );
          if (
            !(await requirePermission(
              response,
              options.permissionBroker,
              permissionRequest({
                action: "project.configure",
                resource: `project:${projectId}`,
                projectId,
                reason: input.enabled
                  ? "Enable a project in JARVIS"
                  : "Disable a project in JARVIS",
                arguments: { enabled: input.enabled },
              }),
              permissionReceipt(request),
            ))
          )
            return;
          return sendJson(
            response,
            200,
            options.projectRegistry.setEnabled(projectId, input.enabled),
          );
        }
        const signal = voiceClientSignalSchema.parse(
          JSON.parse(await readBody(request)) as unknown,
        );
        await publishVoiceSignal(
          options.bus,
          signal,
          router,
          options.researchProvider,
          options.permissionBroker,
        );
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      } catch (cause) {
        if (cause instanceof RealtimeGatewayError)
          return sendJson(response, cause.status, {
            code: cause.code,
            message: cause.message,
            retryable: cause.retryable,
          });
        if (cause instanceof BrowserAgentError)
          return sendJson(response, 400, {
            code: cause.code,
            message: cause.message,
            retryable: false,
          });
        if (cause instanceof ProjectRegistryError)
          return sendJson(response, 400, {
            code: cause.code,
            message: cause.message,
            retryable: false,
          });
        if (cause instanceof MemoryPolicyError)
          return sendJson(response, 400, {
            code: cause.code,
            message: cause.message,
            retryable: false,
          });
        return sendJson(response, 400, {
          code:
            request.url === "/commands/route"
              ? "INVALID_ROUTE_REQUEST"
              : request.url === "/browser/action"
                ? "INVALID_BROWSER_REQUEST"
                : request.url?.startsWith("/memory/")
                  ? "INVALID_MEMORY_REQUEST"
                  : request.url?.startsWith("/notifications/")
                    ? "INVALID_NOTIFICATION_REQUEST"
                    : "INVALID_VOICE_REQUEST",
          message:
            request.url === "/commands/route"
              ? "Route request was malformed"
              : request.url === "/browser/action"
                ? "Browser request was malformed"
                : request.url?.startsWith("/memory/")
                  ? "Memory request was malformed"
                  : request.url?.startsWith("/notifications/")
                    ? "Notification request was malformed"
                    : "Voice request was malformed",
          retryable: false,
        });
      }
    }
    return sendJson(response, 404, {
      code: "NOT_FOUND",
      message: "Route not found",
      retryable: false,
    });
  };
  const httpServer = createServer((request, response) => {
    void handleHttp(request, response).catch((cause: unknown) => {
      logger.log("error", "http.unhandled", {
        message: cause instanceof Error ? cause.message : "Unknown failure",
      });
      if (!response.headersSent)
        sendJson(response, 500, {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
          retryable: true,
        });
      else response.destroy();
    });
  });
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_EVENT_BYTES,
    handleProtocols: (protocols) =>
      protocols.has("jarvis.auth.v1") ? "jarvis.auth.v1" : false,
  });
  httpServer.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    const originAllowed = allowedOrigin(origin);
    if (
      request.url !== "/events" ||
      !originAllowed ||
      !tokenMatches(protocolToken(request), options.sessionToken)
    ) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) =>
      websocketServer.emit("connection", client, request),
    );
  });
  websocketServer.on("connection", (client) => {
    const subscribeTimer = setTimeout(
      () => client.close(1008, "Subscription handshake timed out"),
      SUBSCRIBE_TIMEOUT_MS,
    );
    clients.set(client, { subscribed: false, subscribeTimer });
    sendStreamMessage(client, {
      kind: "hello",
      protocolVersion: PROTOCOL_VERSION,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      latestSequence: options.database.latestEventSequence(),
      replayLimit: MAX_REPLAY_LIMIT,
    });
    client.on("message", (raw, binary) => {
      const state = clients.get(client);
      if (!state || state.subscribed || binary) {
        client.close(1008, "Invalid event subscription");
        return;
      }
      try {
        const subscription = eventStreamSubscribeSchema.parse(
          JSON.parse(decodeRawData(raw)) as unknown,
        );
        state.subscribed = true;
        clearTimeout(state.subscribeTimer);
        const events = options.database.readEventsAfter(
          subscription.afterSequence,
          subscription.replayLimit + 1,
        );
        const truncated = events.length > subscription.replayLimit;
        for (const event of events.slice(0, subscription.replayLimit)) {
          sendStreamMessage(client, {
            kind: "event",
            durable: true,
            replayed: true,
            event,
          });
        }
        sendStreamMessage(client, {
          kind: "replay_complete",
          latestSequence: options.database.latestEventSequence(),
          truncated,
        });
      } catch {
        sendStreamMessage(client, {
          kind: "error",
          code: "INVALID_SUBSCRIPTION",
          message: "Malformed subscription",
        });
        client.close(1008, "Malformed subscription");
      }
    });
    client.on("close", () => {
      const state = clients.get(client);
      if (state) clearTimeout(state.subscribeTimer);
      clients.delete(client);
    });
    client.on("error", (error) =>
      logger.log("warn", "websocket.error", { message: error.message }),
    );
  });
  const unsubscribe = options.bus.subscribe((event, delivery) => {
    if (delivery.durable) options.database.appendEvent(event);
    else options.database.recordEventSequence(event.sequence);
    for (const [client, state] of clients) {
      if (state.subscribed)
        sendStreamMessage(client, {
          kind: "event",
          durable: delivery.durable,
          replayed: false,
          event,
        });
    }
  });
  const unsubscribeCoding = options.codingAgentProvider.subscribeEvents(
    (event) =>
      publishCodingAgentEvent(
        options.bus,
        options.codingAgentProvider,
        options.taskVerification,
        options.permissionBroker,
        event,
      ),
  );
  return {
    url: `http://${options.config.network.bind_host}:${String(options.config.network.port)}`,
    start: () =>
      new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(
          options.config.network.port,
          options.config.network.bind_host,
          () => {
            httpServer.off("error", reject);
            logger.log("info", "server.started", {
              host: options.config.network.bind_host,
              port: String(options.config.network.port),
            });
            resolve();
          },
        );
      }),
    stop: async () => {
      unsubscribe();
      unsubscribeCoding();
      options.notificationProvider.close();
      await options.wakeWordProvider.stop();
      await options.browserProvider.close();
      await options.codingAgentProvider.close();
      for (const [client, state] of clients) {
        clearTimeout(state.subscribeTimer);
        client.close(1001, "Core stopping");
      }
      websocketServer.close();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

import { createHash, randomUUID } from "node:crypto";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import { z } from "zod";

export const riskLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const permissionActionSchema = z.enum([
  "research.search",
  "reference.display",
  "browser.read",
  "browser.interact",
  "project.read",
  "project.configure",
  "codex.task.create",
  "codex.task.control",
  "codex.task.verify",
  "git.commit",
  "git.push",
  "deployment.propose",
  "deployment.execute",
  "system.read",
  "system.control",
  "system.admin",
  "memory.read",
  "memory.write",
]);
export type PermissionAction = z.infer<typeof permissionActionSchema>;

export const dataProvenanceSchema = z.strictObject({
  origin: z.enum(["user", "project", "web", "system", "agent"]),
  trusted: z.boolean(),
  source: z.string().min(1).optional(),
});
export type DataProvenance = z.infer<typeof dataProvenanceSchema>;

export const permissionRequestSchema = z.strictObject({
  action: permissionActionSchema,
  resource: z.string().min(1).max(2_000),
  projectId: z.string().min(1).optional(),
  reason: z.string().min(1).max(2_000),
  arguments: z.record(z.string(), z.unknown()).default({}),
  provenance: dataProvenanceSchema,
});
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;

export const approvalResolutionSchema = z.strictObject({
  approved: z.boolean(),
});

export type PermissionDecision =
  | { state: "APPROVED"; approvalId: string; riskLevel: RiskLevel }
  | { state: "PENDING"; approvalId: string; riskLevel: RiskLevel }
  | {
      state: "DENIED";
      approvalId: string;
      riskLevel: RiskLevel;
      reason: string;
    };

export interface PermissionBroker {
  authorize(
    request: PermissionRequest,
    receiptId?: string,
  ): Promise<PermissionDecision>;
  resolve(
    approvalId: string,
    approved: boolean,
  ): Promise<{ state: "APPROVED" | "REJECTED"; receiptId?: string }>;
}

const ACTION_RISK: Record<PermissionAction, RiskLevel> = {
  "research.search": 0,
  "reference.display": 0,
  "browser.read": 0,
  "browser.interact": 2,
  "project.read": 0,
  "project.configure": 2,
  "codex.task.create": 1,
  "codex.task.control": 1,
  "codex.task.verify": 1,
  "git.commit": 2,
  "git.push": 3,
  "deployment.propose": 0,
  "deployment.execute": 3,
  "system.read": 0,
  "system.control": 2,
  "system.admin": 3,
  "memory.read": 0,
  "memory.write": 1,
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function permissionDigest(request: PermissionRequest): string {
  const parsed = permissionRequestSchema.parse(request);
  return createHash("sha256").update(canonicalJson(parsed)).digest("hex");
}

function redactedAuditRequest(request: PermissionRequest): string {
  return JSON.stringify({
    action: request.action,
    resource: request.resource,
    ...(request.projectId ? { projectId: request.projectId } : {}),
    reason: request.reason,
    argumentKeys: Object.keys(request.arguments).sort(),
    provenance: request.provenance,
  });
}

function deniedByProvenance(
  request: PermissionRequest,
  riskLevel: RiskLevel,
): string | undefined {
  if (request.provenance.origin === "web" && riskLevel > 0)
    return "Untrusted web content cannot authorize state-changing actions";
  if (
    !request.provenance.trusted &&
    !["research.search", "reference.display", "browser.read"].includes(
      request.action,
    )
  )
    return "Untrusted input is restricted to read-only research/reference actions";
  if (
    riskLevel === 1 &&
    request.projectId === undefined &&
    request.action.startsWith("codex.")
  )
    return "Isolated development actions require a project scope";
  return undefined;
}

export class SqlitePermissionBroker implements PermissionBroker {
  readonly #database: JarvisDatabase;
  readonly #bus: LocalEventBus;
  readonly #receiptLifetimeMs: number;

  constructor(options: {
    database: JarvisDatabase;
    bus: LocalEventBus;
    receiptLifetimeMs?: number;
  }) {
    this.#database = options.database;
    this.#bus = options.bus;
    this.#receiptLifetimeMs = options.receiptLifetimeMs ?? 5 * 60_000;
  }

  async authorize(
    input: PermissionRequest,
    receiptId?: string,
  ): Promise<PermissionDecision> {
    const request = permissionRequestSchema.parse(input);
    const riskLevel = ACTION_RISK[request.action];
    const digest = permissionDigest(request);
    if (receiptId) {
      const now = new Date().toISOString();
      const consumed = this.#database.connection
        .prepare(
          `UPDATE permission_receipts SET used_at = ?
           WHERE id = ? AND action_digest = ? AND used_at IS NULL AND expires_at > ?`,
        )
        .run(now, receiptId, digest, now);
      if (consumed.changes !== 1)
        return this.#recordDenied(
          request,
          riskLevel,
          digest,
          "Permission receipt is missing, expired, used, or bound to another action",
        );
      const receipt = this.#database.connection
        .prepare("SELECT approval_id FROM permission_receipts WHERE id = ?")
        .get(receiptId) as { approval_id: string };
      return {
        state: "APPROVED",
        approvalId: receipt.approval_id,
        riskLevel,
      };
    }
    const provenanceDenial = deniedByProvenance(request, riskLevel);
    if (provenanceDenial)
      return this.#recordDenied(request, riskLevel, digest, provenanceDenial);
    if (riskLevel <= 1) {
      const approvalId = this.#insertApproval(
        request,
        riskLevel,
        digest,
        "APPROVED",
      );
      await this.#bus.publish(
        this.#bus.create("approval.approved", "permissions", {
          approvalId,
          action: request.action,
          automatic: true,
        }),
      );
      return { state: "APPROVED", approvalId, riskLevel };
    }
    const pending = this.#database.connection
      .prepare(
        `SELECT id FROM approvals WHERE action_digest = ? AND state = 'PENDING'
         ORDER BY requested_at DESC LIMIT 1`,
      )
      .get(digest) as { id: string } | undefined;
    const approvalId =
      pending?.id ??
      this.#insertApproval(request, riskLevel, digest, "PENDING");
    if (!pending)
      await this.#bus.publish(
        this.#bus.create("approval.requested", "permissions", {
          approvalId,
          action: request.action,
          reason: request.reason,
          riskLevel,
          resource: request.resource,
          ...(request.projectId ? { projectId: request.projectId } : {}),
        }),
      );
    return { state: "PENDING", approvalId, riskLevel };
  }

  async resolve(approvalId: string, approved: boolean) {
    const row = this.#database.connection
      .prepare(
        "SELECT action, action_digest, state FROM approvals WHERE id = ?",
      )
      .get(approvalId) as
      | { action: PermissionAction; action_digest: string; state: string }
      | undefined;
    if (!row) throw new Error("Approval was not found");
    if (row.state !== "PENDING")
      throw new Error("Approval is already resolved");
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(
        "UPDATE approvals SET state = ?, resolved_at = ?, resolved_by = 'user' WHERE id = ? AND state = 'PENDING'",
      )
      .run(approved ? "APPROVED" : "REJECTED", now, approvalId);
    if (!approved) {
      await this.#bus.publish(
        this.#bus.create("approval.rejected", "permissions", {
          approvalId,
          action: row.action,
        }),
      );
      return { state: "REJECTED" as const };
    }
    const receiptId = randomUUID();
    const expiresAt = new Date(
      Date.now() + this.#receiptLifetimeMs,
    ).toISOString();
    this.#database.connection
      .prepare(
        `INSERT INTO permission_receipts(id,approval_id,action_digest,expires_at,created_at)
         VALUES (?,?,?,?,?)`,
      )
      .run(receiptId, approvalId, row.action_digest, expiresAt, now);
    await this.#bus.publish(
      this.#bus.create("approval.approved", "permissions", {
        approvalId,
        action: row.action,
        automatic: false,
        receiptId,
        expiresAt,
      }),
    );
    return { state: "APPROVED" as const, receiptId };
  }

  #insertApproval(
    request: PermissionRequest,
    riskLevel: RiskLevel,
    digest: string,
    state: "APPROVED" | "PENDING" | "DENIED",
  ): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(
        `INSERT INTO approvals(
          id,action,risk_level,resource,project_id,state,reason,requested_at,
          resolved_at,resolved_by,action_digest,request_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        request.action,
        riskLevel,
        request.resource,
        request.projectId ?? null,
        state,
        request.reason,
        now,
        state === "PENDING" ? null : now,
        state === "PENDING" ? null : "policy",
        digest,
        redactedAuditRequest(request),
      );
    return id;
  }

  async #recordDenied(
    request: PermissionRequest,
    riskLevel: RiskLevel,
    digest: string,
    reason: string,
  ): Promise<PermissionDecision> {
    const approvalId = this.#insertApproval(
      request,
      riskLevel,
      digest,
      "DENIED",
    );
    await this.#bus.publish(
      this.#bus.create("approval.rejected", "permissions", {
        approvalId,
        action: request.action,
        reason,
      }),
    );
    return { state: "DENIED", approvalId, riskLevel, reason };
  }
}

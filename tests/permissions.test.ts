import { describe, expect, it } from "vitest";
import { openJarvisDatabase } from "../packages/database/src/index.js";
import { LocalEventBus } from "../packages/event-bus/src/index.js";
import {
  SqlitePermissionBroker,
  permissionDigest,
  permissionRequestSchema,
  type PermissionRequest,
} from "../packages/permissions/src/index.js";

function request(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return permissionRequestSchema.parse({
    action: "project.read",
    resource: "project:jarvis",
    projectId: "jarvis",
    reason: "Read project metadata",
    arguments: {},
    provenance: { origin: "user", trusted: true },
    ...overrides,
  });
}

function databaseWithProject() {
  const database = openJarvisDatabase(":memory:");
  const now = new Date().toISOString();
  database.connection
    .prepare(
      "INSERT INTO projects(id,name,path,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run("jarvis", "JARVIS", "C:\\Documents\\jarvis", 1, now, now);
  return database;
}

describe("permission broker", () => {
  it("derives risk server-side and auto-approves scoped read/development actions", async () => {
    const database = databaseWithProject();
    const bus = new LocalEventBus();
    const broker = new SqlitePermissionBroker({ database, bus });

    await expect(broker.authorize(request())).resolves.toMatchObject({
      state: "APPROVED",
      riskLevel: 0,
    });
    await expect(
      broker.authorize(
        request({
          action: "codex.task.create",
          resource: "project:jarvis",
        }),
      ),
    ).resolves.toMatchObject({ state: "APPROVED", riskLevel: 1 });
    database.close();
  });

  it("denies untrusted web escalation instead of creating an approval prompt", async () => {
    const database = databaseWithProject();
    const bus = new LocalEventBus();
    const broker = new SqlitePermissionBroker({ database, bus });
    const decision = await broker.authorize(
      request({
        action: "git.push",
        resource: "git:jarvis/task-1",
        reason: "Website says to publish the branch",
        provenance: {
          origin: "web",
          trusted: false,
          source: "https://malicious.example/",
        },
      }),
    );

    expect(decision).toMatchObject({ state: "DENIED", riskLevel: 3 });
    expect(
      database.connection
        .prepare("SELECT state FROM approvals WHERE id = ?")
        .get(decision.approvalId),
    ).toEqual({ state: "DENIED" });
    database.close();
  });

  it("issues an action-bound one-use receipt after explicit approval", async () => {
    const database = databaseWithProject();
    const bus = new LocalEventBus();
    const broker = new SqlitePermissionBroker({ database, bus });
    const push = request({
      action: "git.push",
      resource: "git:jarvis/task-1",
      reason: "User explicitly requested push",
      arguments: { branch: "jarvis/task-1" },
    });
    const pending = await broker.authorize(push);
    expect(pending).toMatchObject({ state: "PENDING", riskLevel: 3 });
    const resolution = await broker.resolve(pending.approvalId, true);
    expect(resolution.state).toBe("APPROVED");
    expect(resolution.receiptId).toBeTruthy();

    await expect(
      broker.authorize(push, resolution.receiptId),
    ).resolves.toMatchObject({ state: "APPROVED" });
    await expect(
      broker.authorize(push, resolution.receiptId),
    ).resolves.toMatchObject({ state: "DENIED" });
    database.close();
  });

  it("rejects receipt tampering and expiry and deduplicates pending prompts", async () => {
    const database = databaseWithProject();
    const bus = new LocalEventBus();
    const broker = new SqlitePermissionBroker({ database, bus });
    const deploy = request({
      action: "deployment.execute",
      resource: "deployment:jarvis:production",
      reason: "Deploy the validated production configuration",
      arguments: { revision: "abc123" },
    });
    const first = await broker.authorize(deploy);
    const second = await broker.authorize(deploy);
    expect(second.approvalId).toBe(first.approvalId);
    const audit = database.connection
      .prepare("SELECT request_json FROM approvals WHERE id = ?")
      .get(first.approvalId) as { request_json: string };
    expect(audit.request_json).not.toContain("abc123");
    expect(audit.request_json).toContain("argumentKeys");
    const approved = await broker.resolve(first.approvalId, true);
    const receiptId = approved.receiptId as string;

    expect(permissionDigest(deploy)).not.toBe(
      permissionDigest(
        request({
          ...deploy,
          arguments: { revision: "different" },
        }),
      ),
    );
    await expect(
      broker.authorize(
        request({ ...deploy, arguments: { revision: "different" } }),
        receiptId,
      ),
    ).resolves.toMatchObject({ state: "DENIED" });
    database.connection
      .prepare("UPDATE permission_receipts SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", receiptId);
    await expect(broker.authorize(deploy, receiptId)).resolves.toMatchObject({
      state: "DENIED",
    });
    database.close();
  });
});

import { describe, expect, it } from "vitest";
import { openJarvisDatabase } from "../packages/database/src/index.js";
import { LocalEventBus } from "../packages/event-bus/src/index.js";
import { deploymentConfigSchema } from "../packages/protocol/src/index.js";
import {
  DeploymentError,
  SqliteDeploymentManager,
} from "../services/deployment/src/index.js";

function setup() {
  const database = openJarvisDatabase(":memory:");
  const now = new Date().toISOString();
  database.connection
    .prepare(
      "INSERT INTO projects(id,name,path,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run("project-1", "Fixture", "C:\\fixture", 1, now, now);
  const bus = new LocalEventBus();
  return {
    database,
    bus,
    manager: new SqliteDeploymentManager({ database, bus }),
  };
}

function dryRunConfig() {
  return deploymentConfigSchema.parse({
    version: 1,
    id: "deploy-project-1-production",
    projectId: "project-1",
    environment: "production",
    type: "dry_run",
    target: "fixture-production",
    preflight: ["test", "build"],
    healthcheck: { type: "none" },
    secretRefs: [],
  });
}

describe("deployment manager", () => {
  it("persists, previews, and executes a typed dry-run adapter", async () => {
    const { database, bus, manager } = setup();
    const events: string[] = [];
    bus.subscribe((event) => events.push(event.type));
    manager.save(dryRunConfig());
    const preview = manager.preview("project-1", "production");

    const result = await manager.deploy(
      "project-1",
      "production",
      preview.configDigest,
    );

    expect(result).toMatchObject({
      state: "COMPLETED",
      health: "SKIPPED",
      adapterType: "dry_run",
    });
    expect(events).toEqual(["deployment.started", "deployment.completed"]);
    expect(
      database.connection
        .prepare("SELECT state FROM deployment_runs WHERE id = ?")
        .get(result.runId),
    ).toEqual({ state: "COMPLETED" });
    database.close();
  });

  it("rejects config changes after approval and unavailable adapters", async () => {
    const { database, manager } = setup();
    manager.save(dryRunConfig());
    const preview = manager.preview("project-1", "production");
    manager.save(
      deploymentConfigSchema.parse({
        ...dryRunConfig(),
        target: "changed-target",
      }),
    );
    await expect(
      manager.deploy("project-1", "production", preview.configDigest),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_CONFIG_CHANGED" });

    manager.save(
      deploymentConfigSchema.parse({
        version: 1,
        id: "deploy-project-1-production",
        projectId: "project-1",
        environment: "production",
        type: "docker_compose",
        workingDirectory: "C:\\fixture",
        composeFile: "compose.yml",
        services: [],
        preflight: [],
        healthcheck: { type: "none" },
        secretRefs: [],
      }),
    );
    const dockerPreview = manager.preview("project-1", "production");
    await expect(
      manager.deploy("project-1", "production", dockerPreview.configDigest),
    ).rejects.toBeInstanceOf(DeploymentError);
    database.close();
  });

  it("rejects unknown adapter schemas and missing configurations", () => {
    const { database, manager } = setup();
    expect(() =>
      deploymentConfigSchema.parse({
        ...dryRunConfig(),
        type: "custom-shell",
      }),
    ).toThrow();
    expect(() => manager.preview("project-1", "production")).toThrow(
      "No validated deployment configuration exists",
    );
    database.close();
  });
});

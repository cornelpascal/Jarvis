import { createHash, randomUUID } from "node:crypto";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import {
  deploymentConfigSchema,
  deploymentPreviewSchema,
  deploymentResultSchema,
  type DeploymentConfig,
  type DeploymentManagerProvider,
  type DeploymentResult,
} from "@jarvis/protocol";

export class DeploymentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeploymentError";
  }
}

function configDigest(config: DeploymentConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

interface DeploymentAdapter {
  readonly type: DeploymentConfig["type"];
  deploy(config: DeploymentConfig, runId: string): Promise<DeploymentResult>;
}

class DryRunDeploymentAdapter implements DeploymentAdapter {
  readonly type = "dry_run" as const;

  deploy(config: DeploymentConfig, runId: string): Promise<DeploymentResult> {
    if (config.type !== "dry_run")
      throw new DeploymentError(
        "ADAPTER_CONFIG_MISMATCH",
        "Invalid dry-run config",
      );
    const now = new Date().toISOString();
    return Promise.resolve(
      deploymentResultSchema.parse({
        runId,
        projectId: config.projectId,
        environment: config.environment,
        adapterType: config.type,
        state: "COMPLETED",
        health: "SKIPPED",
        summary: `Validated dry-run target: ${config.target}`,
        startedAt: now,
        completedAt: now,
      }),
    );
  }
}

export class SqliteDeploymentManager implements DeploymentManagerProvider {
  readonly #database: JarvisDatabase;
  readonly #bus: LocalEventBus;
  readonly #adapters = new Map<DeploymentConfig["type"], DeploymentAdapter>();

  constructor(options: { database: JarvisDatabase; bus: LocalEventBus }) {
    this.#database = options.database;
    this.#bus = options.bus;
    const dryRun = new DryRunDeploymentAdapter();
    this.#adapters.set(dryRun.type, dryRun);
  }

  save(input: DeploymentConfig): DeploymentConfig {
    const config = deploymentConfigSchema.parse(input);
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(
        `INSERT INTO deployment_configs(
          id,project_id,environment,adapter_type,config_json,validated_at,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,environment) DO UPDATE SET
          adapter_type=excluded.adapter_type,config_json=excluded.config_json,
          validated_at=excluded.validated_at,updated_at=excluded.updated_at`,
      )
      .run(
        config.id,
        config.projectId,
        config.environment,
        config.type,
        JSON.stringify(config),
        now,
        now,
        now,
      );
    return config;
  }

  get(projectId: string, environment: string): DeploymentConfig | undefined {
    const row = this.#database.connection
      .prepare(
        "SELECT config_json FROM deployment_configs WHERE project_id = ? AND environment = ?",
      )
      .get(projectId, environment) as { config_json: string } | undefined;
    return row
      ? deploymentConfigSchema.parse(JSON.parse(row.config_json) as unknown)
      : undefined;
  }

  preview(projectId: string, environment: string) {
    const config = this.get(projectId, environment);
    if (!config)
      throw new DeploymentError(
        "DEPLOYMENT_CONFIG_MISSING",
        "No validated deployment configuration exists",
      );
    return deploymentPreviewSchema.parse({
      projectId,
      environment,
      adapterType: config.type,
      configDigest: configDigest(config),
      summary: `${config.type} deployment to ${environment}`,
    });
  }

  async deploy(
    projectId: string,
    environment: string,
    expectedConfigDigest: string,
  ): Promise<DeploymentResult> {
    const config = this.get(projectId, environment);
    if (!config)
      throw new DeploymentError(
        "DEPLOYMENT_CONFIG_MISSING",
        "No validated deployment configuration exists",
      );
    if (configDigest(config) !== expectedConfigDigest)
      throw new DeploymentError(
        "DEPLOYMENT_CONFIG_CHANGED",
        "Deployment configuration changed after approval",
      );
    const adapter = this.#adapters.get(config.type);
    if (!adapter)
      throw new DeploymentError(
        "ADAPTER_UNAVAILABLE",
        `${config.type} deployment is configured but its adapter is unavailable`,
      );
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    this.#database.connection
      .prepare(
        `INSERT INTO deployment_runs(id,config_id,state,started_at,result_json)
         VALUES (?,?,?,?,'{}')`,
      )
      .run(runId, config.id, "RUNNING", startedAt);
    await this.#bus.publish(
      this.#bus.create("deployment.started", "deployment", {
        runId,
        projectId,
        environment,
        adapterType: config.type,
      }),
    );
    try {
      const result = await adapter.deploy(config, runId);
      this.#database.connection
        .prepare(
          "UPDATE deployment_runs SET state = ?, completed_at = ?, result_json = ? WHERE id = ?",
        )
        .run(result.state, result.completedAt, JSON.stringify(result), runId);
      await this.#bus.publish(
        this.#bus.create("deployment.completed", "deployment", {
          runId,
          projectId,
          environment,
          health: result.health,
          summary: result.summary,
        }),
      );
      return result;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Deployment adapter failed";
      const completedAt = new Date().toISOString();
      this.#database.connection
        .prepare(
          "UPDATE deployment_runs SET state = 'FAILED', completed_at = ?, result_json = ? WHERE id = ?",
        )
        .run(completedAt, JSON.stringify({ message }), runId);
      await this.#bus.publish(
        this.#bus.create("deployment.failed", "deployment", {
          runId,
          projectId,
          environment,
          code: "DEPLOYMENT_ADAPTER_FAILED",
          message,
        }),
      );
      throw cause;
    }
  }
}

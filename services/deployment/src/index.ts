import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { JarvisDatabase } from "@jarvis/database";
import type { LocalEventBus } from "@jarvis/event-bus";
import {
  deploymentConfigSchema,
  deploymentPreviewSchema,
  deploymentProposalSchema,
  deploymentResultSchema,
  type DeploymentConfig,
  type DeploymentManagerProvider,
  type DeploymentProposal,
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

async function safeFile(
  root: string,
  relativePath: string,
): Promise<string | undefined> {
  const path = resolve(root, relativePath);
  const rel = relative(resolve(root), path);
  if (rel.startsWith("..") || rel.includes(":")) return undefined;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024)
      return undefined;
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function existsFile(
  root: string,
  relativePath: string,
): Promise<boolean> {
  return (await safeFile(root, relativePath)) !== undefined;
}

async function environmentNames(root: string): Promise<string[]> {
  const content = await safeFile(root, ".env.example");
  if (!content) return [];
  return [
    ...new Set(
      content
        .split(/\r?\n/)
        .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
        .filter((name): name is string => Boolean(name)),
    ),
  ].slice(0, 100);
}

function proposalDigest(value: Omit<DeploymentProposal, "digest">): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

  async propose(
    projectId: string,
    environment: string,
  ): Promise<DeploymentProposal> {
    const project = this.#database.connection
      .prepare("SELECT path FROM projects WHERE id = ? AND enabled = 1")
      .get(projectId) as { path: string } | undefined;
    if (!project)
      throw new DeploymentError(
        "PROJECT_NOT_AVAILABLE",
        "Project is missing or disabled",
      );
    const root = resolve(project.path);
    const secretRefs = await environmentNames(root);
    const evidence: Array<{ path: string; signal: string }> = [];
    let recommendedType: DeploymentProposal["recommendedType"] = "unknown";
    let confidence = 0.2;
    let reason = "No supported deployment artifact was found";
    let proposedConfig: DeploymentConfig | undefined;
    const unresolved: string[] = [];
    const id = randomUUID();
    const configId = `deployment-${projectId}-${environment}`;
    const composeFile = (await existsFile(root, "compose.yml"))
      ? "compose.yml"
      : (await existsFile(root, "docker-compose.yml"))
        ? "docker-compose.yml"
        : undefined;
    if (composeFile) {
      recommendedType = "docker_compose";
      confidence = 0.95;
      reason =
        "A root Docker Compose definition is the strongest deployment evidence";
      evidence.push({ path: composeFile, signal: "Docker Compose definition" });
      proposedConfig = deploymentConfigSchema.parse({
        version: 1,
        id: configId,
        projectId,
        environment,
        type: "docker_compose",
        workingDirectory: root,
        composeFile,
        services: [],
        preflight: ["test", "build"],
        healthcheck: { type: "none" },
        secretRefs,
      });
    } else if (await existsFile(root, "Dockerfile")) {
      recommendedType = "docker";
      confidence = 0.9;
      reason = "A root Dockerfile provides a reproducible image build boundary";
      evidence.push({
        path: "Dockerfile",
        signal: "Container image definition",
      });
      proposedConfig = deploymentConfigSchema.parse({
        version: 1,
        id: configId,
        projectId,
        environment,
        type: "docker",
        workingDirectory: root,
        dockerfile: "Dockerfile",
        image: `jarvis/${projectId.toLocaleLowerCase().replace(/[^a-z0-9._/-]/g, "-")}`,
        preflight: ["test", "build"],
        healthcheck: { type: "none" },
        secretRefs,
      });
    } else {
      let workflows: string[] = [];
      try {
        workflows = (await readdir(join(root, ".github", "workflows")))
          .filter((name) => /\.ya?ml$/i.test(name))
          .slice(0, 50);
      } catch {
        // An absent workflow directory is normal evidence, not an error.
      }
      const workflow = workflows[0];
      if (workflow) {
        recommendedType = "ci_cd";
        confidence = 0.82;
        reason =
          "A GitHub Actions workflow is the strongest available delivery evidence";
        const workflowPath = `.github/workflows/${workflow}`;
        evidence.push({ path: workflowPath, signal: "CI/CD workflow" });
        proposedConfig = deploymentConfigSchema.parse({
          version: 1,
          id: configId,
          projectId,
          environment,
          type: "ci_cd",
          provider: "github_actions",
          workflow,
          preflight: [],
          healthcheck: { type: "none" },
          secretRefs,
        });
      } else if (await existsFile(root, "deploy.ps1")) {
        recommendedType = "powershell";
        confidence = 0.78;
        reason =
          "A repository-owned deployment script exists at the project root";
        evidence.push({
          path: "deploy.ps1",
          signal: "PowerShell deployment script",
        });
        proposedConfig = deploymentConfigSchema.parse({
          version: 1,
          id: configId,
          projectId,
          environment,
          type: "powershell",
          workingDirectory: root,
          scriptPath: "deploy.ps1",
          arguments: [],
          preflight: ["test", "build"],
          healthcheck: { type: "none" },
          secretRefs,
        });
      } else if (await existsFile(root, "web.config")) {
        recommendedType = "iis";
        confidence = 0.7;
        reason =
          "IIS configuration exists, but no typed IIS target is configured";
        evidence.push({
          path: "web.config",
          signal: "IIS application configuration",
        });
        unresolved.push(
          "IIS site/application-pool target",
          "typed IIS adapter",
        );
      } else if (await existsFile(root, "package.json")) {
        recommendedType = "node_service";
        confidence = 0.55;
        reason = "A Node project exists without supported deployment artifacts";
        evidence.push({
          path: "package.json",
          signal: "Node project manifest",
        });
        unresolved.push(
          "service host",
          "typed Node service adapter",
          "health check",
        );
      } else unresolved.push("deployment method", "target environment");
    }
    const createdAt = new Date().toISOString();
    const withoutDigest = {
      id,
      projectId,
      environment,
      recommendedType,
      confidence,
      reason,
      evidence,
      unresolved,
      ...(proposedConfig ? { proposedConfig } : {}),
      createdAt,
    };
    const proposal = deploymentProposalSchema.parse({
      ...withoutDigest,
      digest: proposalDigest(withoutDigest),
    });
    this.#database.connection
      .prepare(
        `INSERT INTO deployment_proposals(id,project_id,environment,state,proposal_json,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        proposal.id,
        projectId,
        environment,
        "PROPOSED",
        JSON.stringify(proposal),
        createdAt,
        createdAt,
      );
    return proposal;
  }

  getProposal(proposalId: string): DeploymentProposal | undefined {
    const row = this.#database.connection
      .prepare("SELECT proposal_json FROM deployment_proposals WHERE id = ?")
      .get(proposalId) as { proposal_json: string } | undefined;
    return row
      ? deploymentProposalSchema.parse(JSON.parse(row.proposal_json) as unknown)
      : undefined;
  }

  saveProposal(proposalId: string, expectedDigest: string): DeploymentConfig {
    const proposal = this.getProposal(proposalId);
    if (!proposal)
      throw new DeploymentError(
        "PROPOSAL_NOT_FOUND",
        "Deployment proposal not found",
      );
    if (proposal.digest !== expectedDigest)
      throw new DeploymentError(
        "PROPOSAL_CHANGED",
        "Deployment proposal changed after approval",
      );
    if (!proposal.proposedConfig || proposal.unresolved.length > 0)
      throw new DeploymentError(
        "PROPOSAL_UNRESOLVED",
        "Deployment proposal still has unresolved fields",
      );
    const config = this.save(proposal.proposedConfig);
    this.#database.connection
      .prepare(
        "UPDATE deployment_proposals SET state = 'SAVED', updated_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), proposalId);
    return config;
  }
}

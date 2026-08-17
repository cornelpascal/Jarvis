# Deployment

## Typed model

Deployment configuration is validated by the shared `deploymentConfigSchema` and stored per project/environment in SQLite. Every config has version, stable ID, adapter type, named preflight checks, a typed health check, and secret references by environment-variable name. Secret values are never part of the config.

Supported schema types are `dry_run`, `docker_compose`, `powershell`, and `ci_cd`. Phase 16 intentionally registers only the non-mutating `dry_run` adapter. A valid config whose adapter is not installed fails with `ADAPTER_UNAVAILABLE`; it never falls through to a shell string.

## Execution

Core derives a preview containing project, environment, adapter, and SHA-256 config digest. `deployment.execute` is Level 3 and its one-use receipt binds that preview. The manager recomputes the digest immediately before adapter dispatch, records a deployment run, and emits `deployment.started`, then `deployment.completed` or `deployment.failed`.

The dry-run adapter validates dispatch and reports health as `SKIPPED`. HTTP health checks and rollback are part of the typed contract but become executable only with a concrete adapter implementation and bounded provider.

## API

- `POST /deployment/configs` validates and saves a configuration after project-configuration approval.
- `POST /deployment/execute` previews and requests approval, or consumes an exact receipt and executes.
- A natural-language deployment route prepares the configured `production` environment. Missing-config proposal behavior is Phase 17.

Unknown adapters, changed configs, missing configs, receipt mismatch, and adapter failures fail closed. No deployment path accepts an arbitrary command string.

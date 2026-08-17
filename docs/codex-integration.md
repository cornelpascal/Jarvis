# Codex Integration

## Provider boundary

`CodingAgentProvider` is the only Core-facing coding-agent contract. It supports create/start/resume/pause/cancel/steer/status/event/diff operations and can be replaced without changing the HUD, task API, or later worktree manager.

Phase 11 provides `CodexAppServerProvider` for the installed Codex CLI App Server and `MockCodingAgentProvider` for deterministic integration/UI tests.

## Installed protocol

The adapter was validated against `codex-cli 0.147.0`. During implementation, bindings and JSON Schema were generated with the installed `codex app-server generate-ts/generate-json-schema --experimental` commands, inspected, and removed. The checked-in adapter uses small structural response guards rather than vendoring the large experimental schema bundle.

The provider launches `codex app-server --stdio` directly, correlates numeric JSON-line requests, bounds request time, performs `initialize`/`initialized`, creates threads with `thread/start`, starts or steers turns with `turn/start`, and interrupts with `turn/interrupt`.

JARVIS maps `turn/started`, `turn/completed`, item lifecycle, agent-message deltas, and `turn/diff/updated` into provider-neutral task events and durable `codex.*` Core events. Conversation and event connections remain independent while turns run.

## Safety and approvals

Threads use the supplied project/worktree as both `cwd` and runtime workspace root, `workspace-write` sandboxing, and approval policy `never` until the central permission broker is complete. Unexpected server approval requests become `WAITING_APPROVAL` and are denied at the transport boundary.

The provider instruction forbids push, deployment, and secret access. Phase 12 enforces isolated worktrees for production task starts.

## Core API

Authenticated routes expose task creation, status, start/resume/pause/cancel, steering messages, and diff retrieval under `/codex/tasks`. Creation resolves the enabled project path in Core; callers cannot choose an arbitrary working directory.

## Compatibility

App Server is experimental. The adapter reports CLI availability/version and treats missing IDs, process exits, timeouts, malformed lines, and JSON-RPC errors explicitly. Recorded fake-server tests protect mapping, and a local smoke test initializes the installed App Server.

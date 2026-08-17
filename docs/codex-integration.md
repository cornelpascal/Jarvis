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

## Worktree isolation

Core task creation generates the task identity first and requires `GitWorktreeManager` to prepare `%LOCALAPPDATA%\Jarvis\worktrees\<project>\<task>` before the provider sees the task. The worktree uses a unique `jarvis/<task>-<slug>` branch at the recorded source `HEAD`; uncommitted source changes stay in the source checkout.

The manager verifies the registered path is the repository root, refuses non-Git projects and tracked `.env`/private-key files, canonicalizes every managed target beneath the configured storage root, and persists ownership/baseline/branch metadata. Cleanup refuses dirty worktrees and delegates removal to `git worktree remove`; it never recursively deletes an unverified path.

## Core API

Authenticated routes expose task creation, status, start/resume/pause/cancel, steering messages, verification, and diff retrieval under `/codex/tasks`. Creation resolves the enabled project path in Core; callers cannot choose an arbitrary working directory.

## Verification and review

`TaskVerificationProvider` is separate from the coding-agent transport. It reads only project-analysis commands backed by repository evidence and accepts fixed npm, pnpm, or yarn package-script forms—never free-form shell strings. Checks run sequentially inside the task worktree with a bounded environment, output cap, timeout, and typed command/test events.

The report records pass/fail/skip/timeout status for lint, typecheck, test, and build. A Git diff is generated against the worktree's recorded baseline revision and published both as `codex.diff.ready` and as a Reference Deck `CODE_DIFF` request. Failure remains visible and does not suppress the review artifact.

Conversational review commands resolve an active task, a stable `Codex N` ordinal, or an unambiguous task title before acting. Requests to show a diff reopen the current artifact on the Reference Deck; explain/why/revert and explicit tell/ask commands steer the resolved Codex thread through `sendInstruction`. Pause, resume, and cancel use the same scoped resolver. Every action remains permission-mediated, ambiguous targets produce a conversation clarification, and streamed Codex response deltas are combined into one assistant message when the turn reaches review.

## Explicit Git publication

`GitTaskManager` resolves only tasks in active owned worktrees that are ready for review or completed. Push requires the literal action word `push`; phrases such as “looks good,” “done,” or “finish it” never enter the workflow. Active task/project context, full task titles, and stable `Codex N` ordinals can resolve a target; multiple unresolved candidates return an ambiguity error.

The preview verifies the checked-out `jarvis/*` branch, captures HEAD and a digest of current changes, and refuses `.env`/private-key paths. The Level 3 approval binds those values. On the exact approved retry, JARVIS rechecks the preview, optionally creates a neutral task commit, and pushes only that branch to fixed remote `origin` using `--set-upstream` without force or tags.

## Compatibility

App Server is experimental. The adapter reports CLI availability/version and treats missing IDs, process exits, timeouts, malformed lines, and JSON-RPC errors explicitly. Recorded fake-server tests protect mapping, and a local smoke test initializes the installed App Server.

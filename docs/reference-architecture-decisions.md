# JARVIS Reference Architecture Decisions

Status: accepted for Phase 0 planning
Date: 2026-08-17
Related: [Open-source audit](open-source-audit.md), [Architecture](architecture.md), [Security](security.md)

## Decision vocabulary

- **BUILD** — create and own a JARVIS implementation.
- **ADAPT** — independently implement a pattern observed upstream.
- **REUSE** — use an unmodified library or a clearly bounded permissively licensed component, preserving required notices.
- **DEFER** — retain an interface/decision record but do not implement the subsystem yet.

No audited upstream source has been copied into JARVIS. Codexia is treated as reference-only until its root MIT license, AGPL Cargo metadata, and rendered repository metadata agree.

## Desktop shell — ADAPT

- Primary references: Codexia and OpenJarvis.
- Influence: Tauri 2 + React/TypeScript works across Windows/macOS and supports a thin native host, updater/packaging, native windows, and a web frontend.
- Reuse strategy: use Tauri and official plugins as dependencies; independently build the shell.
- JARVIS additions: Node-owned core, two-window HUD/Reference Deck model, launch-scoped local authentication, capability handshake, and OS adapter interfaces.
- Rejected: placing orchestration or permission decisions in React/Tauri commands.

## HUD — BUILD

- Experience references: ethanplusai/jarvis, Leon, and rezaulhreza/jarvis.
- Influence: audio-reactive orb, explicit listening/processing/talking states, compact tool activity, and background notifications.
- JARVIS additions: central state projector consumes typed events; projects, agents, transcript, approvals, and telemetry are real data; stale/disconnected state is visible.
- Rejected: generic chat/SaaS layout, decorative statuses, raw logs in the conversation, and model-prose-driven UI state.

## Voice — ADAPT

- Primary references: isair/jarvis for local voice lifecycle and interruption, Open Interpreter 01 for audio turn framing and early TTS, ethanplusai/jarvis for conversational latency, OpenJarvis for provider families.
- Reuse strategy: use official audio/realtime SDKs where appropriate; independently implement `VoiceProvider` and Windows device adapters.
- JARVIS additions: `Alt+Space` activation, no always-listening cloud microphone, reconnect, mute/output selection, voice events, and asynchronous job handoff.
- Rejected: macOS AppleScript/Web Speech dependencies and permission bypasses.

## Realtime conversation — ADAPT

- Primary references: Open Interpreter 01 and ethanplusai/jarvis.
- Influence: explicit start/end frames and beginning speech after a useful partial answer rather than waiting for all tools/media.
- JARVIS additions: interruption-safe turn IDs, cancellation tokens, separate conversational and durable-job lanes, and provider-neutral audio/text items.
- Rejected: letting a voice connection own research, indexing, coding, or deployment lifecycle.

## Tool routing — ADAPT

- Primary reference: isair/jarvis.
- Secondary reference: Leon's skills/actions/tools separation.
- Influence: full catalogue stays outside the main prompt; router returns a 3–8 item shortlist; a safe discovery tool can widen the shortlist mid-turn.
- JARVIS additions: category and capability metadata, deterministic prefilters, LLM routing with confidence, evaluation suite, and explicit separation from authorization.
- Rejected: injecting every MCP schema, fragile keyword-only routing, and treating a selected tool as approved.

## Research — ADAPT

- Primary references: OpenJarvis deep research and isair web-search fallback/attribution.
- Influence: research is a durable event stream with structured sources and bounded retrieval.
- JARVIS additions: `ResearchResult`, provenance for every source/media item, independent visual recommendation, cancellation, caching policy, and speech-ready partial answer.
- Rejected: returning an HTML report as the domain model or granting the research worker shell access.

## Smart References — BUILD

- Primary reference: product policy; no audited project implements the required decision boundary.
- JARVIS design: evaluate whether visuals materially improve the answer, produce a score/reason/preferred mode, and apply a configurable `0.65` threshold.
- JARVIS additions: image/video/source quality checks, deduplication, safe URLs, provenance, asynchronous retrieval, and user display preferences.
- Rejected: equating web search with visual display.

## Reference Deck — BUILD

- Experience references: Codexia previews/diffs, OpenJarvis research timeline, Agent Zero canvas, Screenpipe timeline.
- JARVIS design: separate window with `SOURCES`, `IMAGES`, `VIDEO`, `WEB`, `CODE_DIFF`, `DOCUMENT`, and `EMPTY` modes.
- JARVIS additions: configured display selection, reconnection when displays change, single-monitor fallback, display request IDs, and sandboxed web content.
- Rejected: controlling the user's normal browser profile or rendering arbitrary web HTML with privileged Tauri access.

## Browser Agent — REUSE + BUILD boundary

- Reused component: Playwright-controlled Chromium.
- Pattern references: Agent Zero browser isolation/inspection and isair's persistent stateful server lifecycle.
- JARVIS-owned layer: `BrowserProvider`, isolated persistent profile, per-session contexts, typed actions, timeouts, crash recovery, download policy, and provenance.
- Rejected: default access to personal Chrome, arbitrary JavaScript as a general tool, and browser content directly invoking host tools.

## Project Registry — BUILD

- References: Agent Zero project scoping and Codexia project picker/file tree.
- JARVIS design: configurable roots (default `C:\\Documents`), deterministic project signals, normalized metadata, manual enable/disable, and external JARVIS-owned configuration.
- JARVIS additions: canonical path identity, access status, Git metadata, command evidence, deployment status, and per-project permission policy.
- Rejected: assuming commands from framework names or rewriting repository configuration during discovery.

## Project Search — REUSE + BUILD boundary

- Reused primitives: exact filesystem lookup, ripgrep, SQLite FTS5, and later a parser/symbol library chosen under a compatible license.
- References: Screenpipe FTS/retrieval reliability, isair memory fallback, and rezaulhreza two-stage RAG.
- JARVIS design: deterministic retrieval precedes semantic retrieval; every result includes project-relative path, match type, score/evidence, and freshness.
- Rejected: vector-only search and sending whole repositories to a model.

## Memory — ADAPT

- Primary references: isair recall gates/graph memory, OpenJarvis memory service/backends, and Agent Zero project isolation.
- JARVIS design: `EPHEMERAL`, `SESSION`, `PROJECT`, and `GLOBAL` scopes with explicit write policy, provenance, timestamps, and deletion.
- JARVIS additions: memory proposal/confirmation for sensitive or global facts, retrieval gate, conflict/supersession handling, and project-bound access.
- Rejected: persisting every utterance as memory and silently promoting web/agent statements to facts.

## Codex control plane — ADAPT

- Primary reference: Codexia.
- Reuse strategy: architectural reference until Codexia licensing is unambiguous; implement against the installed Codex App Server protocol and official/generated schemas.
- JARVIS design: `CodingAgentProvider` owns create/start/resume/pause/cancel/instruct/status/subscribe/diff operations.
- JARVIS additions: voice commands, task state mapping, worktree ownership, Reference Deck diff review, verification pipeline, explicit push, deployment handoff, and central permissions.
- Rejected: parsing human-formatted terminal output when structured events are available and exposing raw Codex state as the JARVIS domain model.

## Codex event streaming — ADAPT

- Primary reference: Codexia's response/request/notification classification and event sink.
- Secondary reference: OpenJarvis WebSocket reconnect behavior.
- JARVIS design: adapter maps Codex notifications into validated `codex.*` events; request IDs remain correlated for approvals/user input.
- JARVIS additions: sequence numbers, replay cursor, persistence policy, backpressure, malformed-message quarantine, provider/version metadata, and reconnect/resume behavior.
- Rejected: silently dropping consequential errors or treating arbitrary stdout lines as trusted events.

## Git worktrees — ADAPT

- Primary reference: Codexia.
- Influence: stable task/project keys, canonical per-path locks, dirty-worktree preservation, validation against Git metadata, and stale cleanup.
- JARVIS additions: `%LOCALAPPDATA%\Jarvis\worktrees\<project>\<task>`, `jarvis/<task>-<slug>` branches, one writer/task, baseline revision, audit events, and safe cleanup.
- Rejected: copying `.env*` automatically, force-removing an unverified path, or allowing parallel agents to edit the source checkout.

## Task lifecycle — BUILD

- References: Codexia automations and Agent Zero agent contexts.
- JARVIS design: explicit state machine from `QUEUED` through review/commit/push/deploy plus terminal `FAILED`, `CANCELLED`, and `BLOCKED`.
- JARVIS additions: allowed-transition table, optimistic concurrency/version, cancellation, parent/child relationships, review feedback, verification evidence, and durable events.
- Rejected: deriving task state from transcript text or process existence alone.

## Permissions — ADAPT

- Primary reference: OpenJarvis capabilities/taint-aware executor.
- Secondary references: Leon typed tools/settings and Agent Zero host boundary.
- JARVIS design: the permission broker is the sole authority for Levels 0–3; unknown tools/actions default deny.
- JARVIS additions: canonical resource, project/worktree scope, provenance, risk reason, action digest, one-use approval receipt, expiry, policy version, and audit trail.
- Rejected: rezaulhreza's no-UI fail-open behavior, Codex/provider self-approval, permanent broad shell grants, and implicit push/deploy authorization.

## Sandboxing — ADAPT

- Primary reference: Agent Zero's agent-environment/host-connector separation.
- Secondary reference: OpenJarvis capability and taint enforcement.
- JARVIS V1: process isolation, child-process ownership, Windows job/process controls where feasible, worktree filesystem scope, isolated browser profile, environment allow-list, and brokered host adapters.
- Future: optional container/VM provider for high-risk workloads.
- Rejected: mandatory Docker for the normal Windows V1 experience and claiming worktrees alone are a security sandbox.

## Windows system control — BUILD

- References: OpenJarvis current-user scheduled task and Screenpipe native Windows capture reliability.
- JARVIS design: small typed operations behind `SystemControlProvider`, `ScreenshotProvider`, `HotkeyProvider`, `WindowManager`, `StartupProvider`, `ShellProvider`, and `TelemetryProvider`.
- JARVIS additions: capability discovery, non-admin default, argument arrays, canonical paths, per-operation timeout, and permissions for elevated/risky actions.
- Rejected: a generic unrestricted PowerShell tool and weakening execution policy/security settings.

## Deployment — BUILD

- Operational references: OpenJarvis platform service definitions; no audited project meets the requested project deployment workflow.
- JARVIS design: discriminated deployment adapter configurations; validate → permission → preflight → deploy → health check → report/rollback.
- JARVIS additions: missing-config analyzer produces a proposal with evidence and unresolved fields; first execution requires explicit approval; secrets are referenced by name only.
- Rejected: model-generated shell strings, fabricated credentials, or immediate production execution after inference.

## Notifications — ADAPT

- Experience references: ethanplusai background completion UX and Agent Zero/OpenJarvis event surfaces.
- JARVIS design: durable notification records derived from job events, visual notification center, optional short speech, dedupe/grouping, quiet-time/rate policy, and acknowledgement.
- Rejected: speaking every progress event or using notifications as the only record of failure.

## Multi-agent coordination — ADAPT

- Primary references: Agent Zero superior/subagent contexts and Codexia multi-provider session handling.
- Secondary reference: rezaulhreza parallel subtask model.
- JARVIS design: bounded concurrency, explicit parent/child task IDs, independent context and worktree, structured progress/result, cancellation propagation, and resource ownership.
- JARVIS additions: conversational steering, agent labels, task-target resolution, verification/diff integration, and permission scope per child.
- Rejected: shared mutable checkout, unbounded recursive delegation, and merging agent prose without provenance.

## Continuous context capture — DEFER

- Primary reference: Screenpipe.
- Future influence: accessibility-first/event-driven capture, OCR fallback, privacy gates before capture, per-device health, single-writer storage, and searchable local context.
- Required before implementation: explicit opt-in, visible recording state, app/window exclusions, retention/deletion, encryption, disk budget, sensitive-data redaction, and separate threat review.
- V1 behavior: explicit active-window/display capture only.

## Wake word — DEFER

- References: Leon local wake assets and isair voice lifecycle.
- Future design: local detection, visible/mutable state, no continuous cloud stream, coexistence with `Alt+Space`, and device/privacy controls.
- Entry condition: Phase 4 voice, interruption, device recovery, and packaging must be stable.

## Local model routing — DEFER

- References: OpenJarvis and isair.
- Current decision: define `LlmProvider` and capability metadata in early contracts, but do not make local inference a V1 dependency.
- Future design: route by capability, privacy, latency, cost, and user policy; expose where data will be processed before consequential use.

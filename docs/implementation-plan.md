# JARVIS Implementation Plan

Last updated: 2026-08-17
Current phase: **Phase 3 — DONE**
Next phase: **Phase 4 — NOT_STARTED**

## Status definitions

- `NOT_STARTED` — no implementation work for the phase has begun.
- `IN_PROGRESS` — the phase is the only active implementation phase.
- `BLOCKED` — an external decision/dependency prevents its acceptance criteria.
- `DONE` — implementation, tests, build/smoke validation, documentation, limitations, and phase commit are complete.

## Phase gate

For every implementation phase:

1. Re-read the audit, reference decisions, architecture, security baseline, and this plan.
2. Inspect repository/Git state and preserve unrelated user changes.
3. Mark only the current phase `IN_PROGRESS`.
4. Implement the smallest complete vertical slice; do not pull later behavior forward.
5. Add/update runtime contracts and migrations before dependents.
6. Run format, lint, typecheck, unit tests, integration tests, build, and a proportional smoke test.
7. Update documentation and known limitations.
8. Review the diff for secrets, unsafe permissions, and accidental scope.
9. Commit the phase locally with a descriptive commit.
10. Mark it `DONE`, report evidence, and wait for review before starting the next phase.

External API tests use deterministic mocks by default. Consequential Git/deployment/system tests use temporary repositories, dry-run adapters, or disposable fixtures and never target production.

## Phase overview

| Phase                                | Status      | Outcome                                                                           |
| ------------------------------------ | ----------- | --------------------------------------------------------------------------------- |
| -1 — Open-source architecture audit  | DONE        | License/source audit and revised architecture/security/plan                       |
| 0 — Repository bootstrap             | DONE        | Runnable monorepo, desktop shell, core health connection, config/database/logging |
| 1 — Event bus                        | DONE        | Validated typed events, replayable history, dashboard subscription                |
| 2 — Functional HUD                   | DONE        | Real-state JARVIS HUD, projects/agents/conversation/telemetry layout              |
| 3 — Multi-monitor Reference Deck     | DONE        | Display discovery, persisted placement, second window/fallback                    |
| 4 — Alt+Space + voice                | NOT_STARTED | Windows activation and provider-based spoken conversation                         |
| 5 — Orchestrator/tool router         | NOT_STARTED | Bounded, evaluated routing to conversation/research/project/coding/browser/system |
| 6 — Web research                     | NOT_STARTED | Fresh structured research with sources and streamed events                        |
| 7 — Smart References                 | NOT_STARTED | Independent visual-value evaluator and asynchronous rendering                     |
| 8 — Browser Agent                    | NOT_STARTED | Isolated Playwright Chromium and typed browser actions                            |
| 9 — Project Registry                 | NOT_STARTED | Configurable project discovery and metadata                                       |
| 10 — Project index/retrieval         | NOT_STARTED | Deterministic layered local project search                                        |
| 11 — Codex integration               | NOT_STARTED | Structured `CodingAgentProvider` with background task stream                      |
| 12 — Worktree manager                | NOT_STARTED | One isolated worktree/branch per significant coding task                          |
| 13 — Verification + diff UI          | NOT_STARTED | Configured checks and Reference Deck diff review                                  |
| 14 — Permission broker               | NOT_STARTED | Complete mediation, risk policy, approvals, denial/injection tests                |
| 15 — Git commit/push                 | NOT_STARTED | Explicit, resolved, audited commit/push flow; no auto-push                        |
| 16 — Deployment system               | NOT_STARTED | Typed adapters, validated configured deploy, health events                        |
| 17 — Deployment config auto-creation | NOT_STARTED | Missing-config analysis/proposal/approval/save workflow                           |
| 18 — Windows system tools            | NOT_STARTED | Allow-listed least-privilege control and telemetry adapters                       |
| 19 — Screenshot context              | NOT_STARTED | Explicit active-window/display capture as conversation context                    |
| 20 — Memory                          | NOT_STARTED | Scoped explicit memories and relevant retrieval                                   |
| 21 — Notifications/background work   | NOT_STARTED | Concurrent jobs, non-blocking conversation, rate-aware notifications              |
| 22 — Wake word                       | NOT_STARTED | Local wake-word activation after voice stability                                  |
| 23 — Windows packaging               | NOT_STARTED | Installer, startup, crash recovery, migration, release documentation              |

## Detailed phase plan

### Phase -1 — Open-source architecture audit

- **Status:** `DONE`
- **Scope:** Inspect all nine required repositories at pinned commits; read root licenses and relevant source/docs; compare features, Windows compatibility, permission/security posture, and reuse suitability; revise JARVIS architecture/security/plan.
- **Dependencies:** User master prompt; network/Git access.
- **Acceptance:** `docs/open-source-audit.md`, `docs/reference-architecture-decisions.md`, `docs/architecture.md`, `docs/security.md`, and this plan exist; all required comparison fields and BUILD/ADAPT/REUSE/DEFER decisions are present; no incompatible source copied; Phase 0 remains unstarted.
- **Tests/evidence:** Link/path coverage check, license file/manifests reviewed, snapshot hashes recorded, Markdown structure/link scan, Git diff/status review.
- **Known risks:** Upstream licenses/branches can change; Codexia licensing is internally inconsistent at the audited tip; this is an engineering audit, not legal advice.

### Phase 0 — Repository bootstrap

- **Status:** `DONE`
- **Scope:** pnpm monorepo; strict TypeScript; shared protocol/provider contracts; typed config; SQLite repositories/migrations; structured redacted logging; local Node core; Tauri 2/React/Vite shell; authenticated versioned health connection; environment-separated data; PowerShell install/dev/test/health scripts; CI-ready checks.
- **Dependencies:** Phase -1 approval; supported Node/pnpm/Rust/Tauri Windows toolchain.
- **Acceptance:** `pnpm install` and `pnpm dev` start core and dashboard; HUD shell reports real connected health/capabilities; core binds loopback; restart preserves settings/database; no AI behavior; architecture/local port/data/log/startup/recovery documented.
- **Tests:** Config schema/default/override tests; migration/repository tests; log redaction tests; authenticated health/handshake integration; dashboard reconnect; Tauri and workspace builds; PowerShell health smoke test.
- **Evidence:** Workspace format/lint/typecheck passed; 7 unit tests passed; core and dashboard production builds passed; live smoke returned core/database `ok`, dashboard HTTP 200, and authenticated `jarvis.auth.v1` WebSocket negotiation.
- **Known limitations:** The native executable was not compiled during Phase 0; this was resolved in Phase 3 by installing the user-scoped Rust toolchain and completing a native build/smoke. Persistent rotating log files remain later observability work. `corepack pnpm` or `pnpm.cmd` is required in PowerShell installations that block `.ps1` shims.

### Phase 1 — Event bus

- **Status:** `DONE`
- **Scope:** Runtime-validated event registry/envelopes, sequence/correlation/causation IDs, transient vs durable delivery, SQLite event history, replay cursor, dashboard inspector, malformed-event rejection.
- **Dependencies:** Phase 0 protocol, database, local transport.
- **Acceptance:** Core emits representative test events; dashboard receives and replays them; important history persists; shared types/runtime schemas agree; malformed events cannot mutate state.
- **Tests:** Schema property/fixture tests; reducer idempotency; persistence/replay ordering; reconnect/backpressure; malformed/oversized/duplicate event tests.
- **Evidence:** 11 unit/integration tests pass, including durable replay, live delivery, duplicate rejection, payload validation, and malformed authenticated subscriptions. Production builds pass and the smoke test replays `jarvis.ready` and `system.health` over the authenticated stream.
- **Known limitations:** Event history retention/compaction policy and a full developer log viewer remain later observability work. The current registry intentionally contains only Phase 1 event types and expands with each subsystem.

### Phase 2 — Functional JARVIS HUD

- **Status:** `DONE`
- **Scope:** Dark futuristic layout, state orb, project/agent panels, conversation/activity summaries, approvals surface placeholder, telemetry strip, connection/error states, accessibility/reduced motion.
- **Dependencies:** Phase 1 state projection/events.
- **Acceptance:** Required layout is recognizably JARVIS rather than SaaS; every displayed status derives from real events/health; keyboard/responsive states work; raw developer logs remain separate.
- **Tests:** Component/reducer tests, visual snapshots at required states, accessibility checks, reconnect/stale state, frontend production build and manual HUD smoke test.
- **Evidence:** Event-projection and live telemetry tests bring the suite to 14 passing tests. Format/lint/typecheck/build and authenticated smoke pass. A 1440×900 Edge render was inspected with the real HUD layout, central reticle/orb, project/agent/conversation/context panels, and telemetry rail.
- **Known limitations:** Project, agent, conversation, approval, microphone, and voice panels remain truthful empty/not-configured states until their owning phases emit data. Native Windows scaling and Tauri-window accessibility smoke remain part of packaging validation.

### Phase 3 — Multi-monitor Reference Deck

- **Status:** `DONE`
- **Scope:** Native display discovery, HUD/reference monitor settings, second window lifecycle, modes contract, placement persistence, hot-plug handling, single-monitor overlay/window fallback.
- **Dependencies:** Phase 2 shell/state; native host interfaces.
- **Acceptance:** Displays detected; monitor choices persist; Reference Deck opens/moves correctly; disconnect/reconnect recovers; single-monitor systems do not fail.
- **Tests:** Display adapter unit mock, settings migration, window command integration, mode rendering, hot-plug/single-monitor fixtures, multi-monitor manual smoke test when hardware is available.
- **Evidence:** 17 tests pass, including primary/secondary selection and disconnected-display recovery. Workspace and dashboard builds pass. Tauri compiled a real Windows executable and the native smoke kept the dashboard running against a healthy core.
- **Known limitations:** The current machine exposes only one physical display to automated validation, so two-monitor placement is contract/fixture-tested; final hardware validation remains required. Display preferences use WebView local storage until the settings repository is surfaced through core. Monitor identity is a composite of name/geometry and is intentionally reconciled after topology changes.

### Phase 4 — Alt+Space + voice

- **Status:** `NOT_STARTED`
- **Scope:** `HotkeyProvider`, `VoiceProvider`, Windows audio capture/playback, press-to-activate flow, transcript/audio streaming, interruption when supported, reconnect, mute/devices, voice-state events.
- **Dependencies:** Phases 1–3; configured voice/model provider and secret abstraction.
- **Acceptance:** Alt+Space reveals/focuses HUD and starts interaction; microphone and spoken reply work; listening/thinking/speaking/interrupted states are accurate; failures/reconnect are visible; no always-listening cloud stream.
- **Tests:** Provider contract mocks, hotkey conflict/re-registration, audio state machine, interruption/cancellation, reconnect/timeouts, device loss, mocked conversation integration, Windows hardware smoke test.
- **Known risks:** Provider/API evolution, latency, echo/barge-in, permissions, hotkey conflicts, audio device diversity and secret handling.

### Phase 5 — Orchestrator / tool router

- **Status:** `NOT_STARTED`
- **Scope:** Typed tool catalogue, route classifier, deterministic constraints, 3–8 shortlist, safe `tool.search` expansion, confidence/ambiguity handling, conversation/research/project/coding/browser/system routes.
- **Dependencies:** Event bus, provider contracts, conversation input; tool stubs/mocks.
- **Acceptance:** Representative requests route correctly without keyword-only logic; unknown/ambiguous routes fail safely; catalogue size does not flood prompts; selection does not authorize execution.
- **Tests:** Golden route dataset, adversarial/ambiguous cases, tool shortlist bounds, expansion escape hatch, latency/fallback, injection-shaped input, no-tool conversation cases.
- **Known risks:** Misrouting, classifier nondeterminism, missed tools, context-dependent pronouns, category growth.

### Phase 6 — Web research

- **Status:** `NOT_STARTED`
- **Scope:** `ResearchProvider`, current public search/fetch, structured sources, citations, partial progress, provenance/taint, cancellation/timeouts/cache, result persistence.
- **Dependencies:** Phase 5 routing, events, network configuration, secret provider if an API requires it.
- **Acceptance:** Fresh research returns an answer and source metadata; events stream to HUD; sources are attributable; failures degrade cleanly; research worker has no shell/system/Codex authority.
- **Tests:** Provider mocks/fixtures, citation/source normalization, timeout/retry rules, untrusted content propagation, cancellation, no-secret logs, end-to-end researched answer without visuals.
- **Known risks:** Search API availability/cost, source quality, robots/rate limits, malicious content, stale cache.

### Phase 7 — Smart References

- **Status:** `NOT_STARTED`
- **Scope:** Visual evaluator, `0.65` configurable threshold, image/video/source discovery interfaces, quality/dedup/safety, asynchronous Reference Deck rendering, explanation/score telemetry.
- **Dependencies:** Phases 3 and 6; image/video provider interfaces.
- **Acceptance:** Node.js LTS research shows sources without needless imagery; humanoid robot research recommends images/likely video; recursion avoids interruption; speech is not blocked by media retrieval.
- **Tests:** Deterministic evaluator cases/boundaries, setting overrides, media dedup/safe URL, async race/cancellation, research → reference → display E2E with mocks.
- **Known risks:** Subjective scoring, irrelevant/unsafe media, copyright/attribution, slow retrieval, late display after context changes.

### Phase 8 — Browser Agent

- **Status:** `NOT_STARTED`
- **Scope:** Playwright Chromium install/profile lifecycle; typed open/tab/nav/reload/scroll/find/click/extract/open-reference actions; Reference Deck web surface; crash recovery; download/URL policy.
- **Dependencies:** Phases 3, 5, and 14's interface contract (temporary deny-by-default guard until full broker); browser package install.
- **Acceptance:** Required browser commands work in isolated profile; no personal Chrome dependency; page content remains untrusted; website cannot invoke host/coding tools.
- **Tests:** Local fixture site integration, navigation/tab/find/click/extract, SSRF/scheme blocks, profile isolation, crash/restart, timeout, malicious prompt page, deck display.
- **Known risks:** Chromium download size/updates, selector brittleness, login/cookie expectations, drive-by downloads, SSRF.

### Phase 9 — Project Registry

- **Status:** `NOT_STARTED`
- **Scope:** Configurable roots with `C:\\Documents` default, deterministic project signal scan, canonical metadata, enable/disable/manual register/remove, Git/stack/command evidence, HUD selection.
- **Dependencies:** Phase 0 storage/config and Phase 2 UI.
- **Acceptance:** Projects are discovered and persisted; roots/settings survive restart; inaccessible/duplicate/nested projects are handled; no commands are assumed without evidence.
- **Tests:** Fixture trees for all required signals, Windows canonical/case paths, junction/permission errors, nested repos, ignore/size limits, registry integration and HUD selection.
- **Known risks:** Very large roots, junction loops, inaccessible paths, false project positives, `C:\Documents` absent on a machine.

### Phase 10 — Project index / retrieval

- **Status:** `NOT_STARTED`
- **Scope:** Exact/file/glob/ripgrep/symbol/FTS layers, incremental index, evidence/freshness, change watching, ignored/secret exclusion; semantic provider interface only unless justified.
- **Dependencies:** Phase 9 project metadata, SQLite/event bus, ripgrep availability/bundling decision.
- **Acceptance:** Authentication-location questions return relevant files/symbols with evidence; deterministic layers work without embeddings; changes update index; secrets/dependencies are excluded.
- **Tests:** Multilanguage fixtures, exact/lexical/symbol/FTS ranking, incremental change/delete, cancellation, ignored paths, secret patterns, large repo performance budget.
- **Known risks:** Parser coverage, stale indexes, Windows watcher behavior, generated-code noise, sensitive content indexing.

### Phase 11 — Codex integration

- **Status:** `NOT_STARTED`
- **Scope:** `CodingAgentProvider`, Codex discovery/version/capability handshake, App Server process supervision, JSON-RPC correlation, generated adapter-local types, threads/turns/events/approvals, mock provider.
- **Dependencies:** Phases 1, 5, 9–10; installed compatible Codex; task schema.
- **Acceptance:** Create/start/steer/pause/resume/cancel/query a mock and real supported Codex task; structured progress appears; conversation remains responsive; unavailable/incompatible Codex is explicit.
- **Tests:** Recorded JSON-RPC transcript contract tests, request correlation, malformed messages, process crash/reconnect, approvals, event mapping, mock integration, real smoke if installed.
- **Known risks:** Experimental protocol changes, provider process leaks, event volume, approval semantic mismatch, installed version variance.

### Phase 12 — Worktree manager

- **Status:** `NOT_STARTED`
- **Scope:** Branch/worktree creation, `%LOCALAPPDATA%` layout, canonical ownership locks, baseline revision, dirty-state preservation, safe cleanup, non-Git fallback policy.
- **Dependencies:** Phases 9 and 11; Git executable.
- **Acceptance:** Every significant Git coding task uses its own branch/worktree; parallel tasks cannot share a writable checkout; no `.env` copying; stale/dirty state is reported and preserved.
- **Tests:** Temporary repo integration, concurrent creation, duplicate project names, junction/path escape, dirty reuse, stale Git metadata, safe cleanup/denial, non-Git behavior.
- **Known risks:** Antivirus/file locks, long paths, submodules/LFS, nested worktrees, disk growth, unsafe cleanup.

### Phase 13 — Verification + diff UI

- **Status:** `NOT_STARTED`
- **Scope:** Evidence-based project command config, isolated install/lint/typecheck/test/build runner, timeouts/cancellation, results, Git diff artifact, Reference Deck diff and conversational steering.
- **Dependencies:** Phases 3, 10–12.
- **Acceptance:** Available configured checks run and report accurate states; failed tests do not appear complete; diff summary/deck view works; user can explain/steer/revert scoped changes.
- **Tests:** Fixture projects/package managers, absent commands, timeouts/cancellation, output bounds/redaction, diff parsing/binary/rename, steering loop, project → task → checks → diff E2E.
- **Known risks:** Destructive scripts, dependency side effects, long output, flaky tests, huge/binary diffs, command inference errors.

### Phase 14 — Permission broker

- **Status:** `NOT_STARTED`
- **Scope:** Complete mediation API, risk/resource/action schemas, policy evaluation, approval UI/events, action digest and one-use receipts, audit, default deny, provenance/taint and egress checks.
- **Dependencies:** Core actions/providers/events/database; integrate all existing executable paths before acceptance.
- **Acceptance:** Every consequential action passes the broker; Level 3 requires exact approval; denials/timeouts are honored; unknown actions deny; web injection cannot escalate; no bypass path remains.
- **Tests:** Policy matrix, receipt replay/tamper/expiry, target/argument change, denial/error, concurrent approvals, prompt/tool injection, provenance, secret egress, path scope, local API forgery.
- **Known risks:** Missed execution path, confusing approval UX, overly broad cached policy, time-of-check/time-of-use changes.

### Phase 15 — Git commit / push

- **Status:** `NOT_STARTED`
- **Scope:** Task target resolution, commit policy/preview, explicit push command, remote/refspec validation, Level 3 approval/audit, result events; no automatic push.
- **Dependencies:** Phases 12–14.
- **Acceptance:** “Push it” resolves the unique current task and pushes after approval; named task works; ambiguous target asks; “looks good/done/finish it” never pushes; rejection leaves remote unchanged.
- **Tests:** Temporary bare remote integration, ambiguity fixtures, receipt target binding, remote changed after preview, push rejection/auth failure, no-auto-push regression, audit/log redaction.
- **Known risks:** Credentials, protected branches, force/refspec mistakes, race with remote changes, user ambiguity.

### Phase 16 — Deployment system

- **Status:** `NOT_STARTED`
- **Scope:** Typed discriminated deployment schema and repository, adapter registry, validation/preflight/deploy/health/rollback events, initial safe adapters/dry run, secrets by reference, Level 3 authorization.
- **Dependencies:** Phases 9–10, 13–14; configured test project.
- **Acceptance:** A configured fixture project validates and deploys through a typed adapter/dry-run target; health result appears; denial prevents mutation; unknown/custom adapter defaults deny.
- **Tests:** Schema/version migration, adapter contract, dry-run, preflight failure, health timeout, rollback fixture, secret reference/redaction, approval binding, deployment event state.
- **Known risks:** Adapter-specific semantics, partial failure, rollback limits, credential scope, production/test target confusion.

### Phase 17 — Deployment config auto-creation

- **Status:** `NOT_STARTED`
- **Scope:** Read-only analyzer for Docker/Compose/IIS/scripts/package/CI/docs/env examples, evidence-ranked proposal, unresolved fields, validation, review, separate save/execute approvals.
- **Dependencies:** Phase 16 schema/adapters; Phase 10 retrieval.
- **Acceptance:** “Deploy it” without config performs zero deployment; produces a reasoned typed proposal, asks for unresolved data, validates, and saves only after approval; first deployment remains separately authorized.
- **Tests:** Docker/Compose/Node/Python/IIS/CI fixture repos, conflicting evidence, missing credentials/target, malicious README instructions, zero-execution assertion, proposal → approval → save E2E.
- **Known risks:** False inference, hidden organizational process, malicious project docs, incomplete rollback/health information.

### Phase 18 — Windows system tools

- **Status:** `NOT_STARTED`
- **Scope:** Windows adapters for allow-listed application/URL/volume/running apps/terminal/explorer/reveal/stats/monitors/window operations; native capability discovery; least privilege; permissions.
- **Dependencies:** Phase 14; OS abstraction package and Tauri/native host.
- **Acceptance:** Safe actions/telemetry work on supported Windows without admin; risky/elevated actions request approval; unsupported capabilities fail clearly; no generic shell exposed.
- **Tests:** Adapter unit mocks, argument/path validation, timeout/process cleanup, permission denial, telemetry parsing, monitor/window smoke, non-admin verification.
- **Known risks:** Localization/WMI/CIM variance, UWP apps, admin-only operations, antivirus, OS version differences.

### Phase 19 — Screenshot context

- **Status:** `NOT_STARTED`
- **Scope:** Explicit capture of active window/display, active-app metadata, typed image attachment, temporary/persistent retention policy, redaction hooks, future selected-region interface.
- **Dependencies:** Phases 4, 14, 18; multimodal conversation provider capability.
- **Acceptance:** Explicit “look at this” capture reaches the conversation with metadata; capture state is visible; failure is clear; no continuous capture; multiple monitors handled.
- **Tests:** Provider mock, active-window/display selection, scaling/multi-monitor coordinates, denial/permission errors, image limits, retention/deletion, secret-log regression, manual smoke.
- **Known risks:** Sensitive pixels, protected-content black frames, DPI/HDR, large images, provider egress privacy.

### Phase 20 — Memory

- **Status:** `NOT_STARTED`
- **Scope:** Ephemeral/session/project/global repositories and policy, explicit remember/forget, provenance/timestamps/supersession, recall gate, relevant retrieval, inspection/deletion UI.
- **Dependencies:** Phases 5, 9–10, 14; database migrations.
- **Acceptance:** Scopes remain isolated; explicit facts persist appropriately; project memories retrieve only when relevant; ordinary conversation is not indiscriminately stored; web/agent content is not silently promoted.
- **Tests:** Scope/isolation, recall relevance, explicit consent, conflict/supersession, deletion, provenance/taint, secret rejection, migration and restart.
- **Known risks:** Privacy creep, incorrect facts, cross-project leakage, prompt growth, difficult deletion from derived indexes.

### Phase 21 — Notifications / background work

- **Status:** `NOT_STARTED`
- **Scope:** Durable notification center, job concurrency limits, grouped/rate-aware visual and optional spoken notices, acknowledgement, conversation continuity, recovery after restart.
- **Dependencies:** Event bus, HUD, voice, task/job subsystems.
- **Acceptance:** Multiple long tasks run within limits while conversation continues; completion/failure notifications appear once and can be acknowledged; speech does not interrupt constantly; restart restores pending state.
- **Tests:** Concurrent mock jobs, cancellation, dedup/group/rate limit, quiet voice policy, restart/replay, failure visibility, load/backpressure.
- **Known risks:** Notification fatigue, race/duplicates, resource exhaustion, spoken privacy leaks.

### Phase 22 — Wake word

- **Status:** `NOT_STARTED`
- **Scope:** Local wake-word provider, device lifecycle, sensitivity/false-positive tuning, visible state, enable/disable settings, fallback to Alt+Space.
- **Dependencies:** Stable Phase 4 voice and Phase 23 packaging prerequisites; privacy review.
- **Acceptance:** Local wake word activates reliably in supported conditions; audio is not continuously sent to cloud; disable/fallback work; CPU/battery budget measured.
- **Tests:** Provider/state machine, audio fixtures/noise, false-positive/negative sampling, device changes, enable/disable, privacy/network assertion, hardware smoke.
- **Known risks:** Accuracy, CPU/battery, microphone contention, privacy perception, model/platform licensing.

### Phase 23 — Windows packaging

- **Status:** `NOT_STARTED`
- **Scope:** Signed/package-ready installer pipeline, WebView/native/sidecar inclusion, clean install/update/uninstall, optional start-at-login, crash recovery, config/database migrations, log/data docs.
- **Dependencies:** Stable preceding milestone features, release signing/secrets process, Windows CI.
- **Acceptance:** Installer works on clean supported Windows; first run is clear; startup optional; update/migration preserves data; crashes recover without loops; uninstall scope documented; V1 demo scenarios pass on packaged build.
- **Tests:** Clean VM install/smoke/uninstall, upgrade from previous fixture, migration/rollback backup, startup toggle, offline/degraded dependencies, crash restart, Windows x64 target and any declared architectures.
- **Known risks:** Code-signing reputation/cost, antivirus false positives, WebView/runtime prerequisites, sidecar updates, migration irreversibility.

## First useful V1 milestone

The first useful V1 is reached after Phase 15 and includes dashboard, Alt+Space voice, research, Smart References, Reference Deck, project registry/search, Codex integration, worktrees, verification/diff review, centralized permissions, and explicit Git push. It is accepted only after the five product demonstration scenarios have deterministic fixture coverage and a Windows manual demonstration.

Deployment architecture exists in contracts earlier, but actual configured deployment and missing-config proposal behavior are accepted in Phases 16–17.

## Cross-phase risk register

| Risk                             | Owner phase(s)    | Control                                                                               |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| Upstream protocol/license change | -1, 11, all reuse | Pin evidence, adapter boundary, contract tests, re-audit before copying/upgrading     |
| Secrets in files/logs/events     | 0, 9–20           | SecretProvider, exclusions, redaction tests, no `.env` worktree copy                  |
| Web/project prompt injection     | 5–8, 10–17        | Provenance/taint, structured extraction, permission broker, adversarial fixtures      |
| Parallel state corruption        | 1, 11–13, 21      | Durable state machines, idempotency, locks, single SQLite writer, bounded concurrency |
| Unsafe Windows paths/processes   | 0, 9, 12–19       | Canonicalization, reparse-point checks, argument arrays, job/process cleanup          |
| Misleading HUD state             | 1–3, all jobs     | Runtime-validated events and reducers only; explicit stale/error states               |
| Consequential ambiguity          | 14–17             | Exact target resolution, previews, action-bound receipts, default deny                |
| Phase scope creep                | all               | One active phase, acceptance commit, wait for review                                  |

## Known Phase -1 limitations

- No legal opinion is provided; license conclusions are conservative engineering guidance.
- Audit snapshots can become stale immediately as upstream branches move.
- No upstream project was built or executed; compatibility findings come from current source, manifests, workflow/docs, and platform code paths.
- Hardware-specific Windows voice/display/capture behavior remains to be validated in its implementation phase.
- Exact dependency versions, production port, database library, and secret-store implementation are Phase 0 decisions constrained by the architecture/security baseline.

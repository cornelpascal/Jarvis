# JARVIS Implementation Plan

Last updated: 2026-08-17
Current phase: **Phase 19 — DONE**
Next phase: **Phase 20 — NOT_STARTED**

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
| 4 — Alt+Space + voice                | DONE        | Windows activation and provider-based spoken conversation                         |
| 5 — Orchestrator/tool router         | DONE        | Bounded, evaluated routing to conversation/research/project/coding/browser/system |
| 6 — Web research                     | DONE        | Fresh structured research with sources and streamed events                        |
| 7 — Smart References                 | DONE        | Independent visual-value evaluator and asynchronous rendering                     |
| 8 — Browser Agent                    | DONE        | Isolated Playwright Chromium and typed browser actions                            |
| 9 — Project Registry                 | DONE        | Configurable project discovery and metadata                                       |
| 10 — Project index/retrieval         | DONE        | Deterministic layered local project search                                        |
| 11 — Codex integration               | DONE        | Structured `CodingAgentProvider` with background task stream                      |
| 12 — Worktree manager                | DONE        | One isolated worktree/branch per significant coding task                          |
| 13 — Verification + diff UI          | DONE        | Configured checks and Reference Deck diff review                                  |
| 14 — Permission broker               | DONE        | Complete mediation, risk policy, approvals, denial/injection tests                |
| 15 — Git commit/push                 | DONE        | Explicit, resolved, audited commit/push flow; no auto-push                        |
| 16 — Deployment system               | DONE        | Typed adapters, validated configured deploy, health events                        |
| 17 — Deployment config auto-creation | DONE        | Missing-config analysis/proposal/approval/save workflow                           |
| 18 — Windows system tools            | DONE        | Allow-listed least-privilege control and telemetry adapters                       |
| 19 — Screenshot context              | DONE        | Explicit active-window/display capture as conversation context                    |
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

- **Status:** `DONE`
- **Scope:** `HotkeyProvider`, `VoiceProvider`, Windows audio capture/playback, press-to-activate flow, transcript/audio streaming, interruption when supported, reconnect, mute/devices, voice-state events.
- **Dependencies:** Phases 1–3; configured voice/model provider and secret abstraction.
- **Acceptance:** Alt+Space reveals/focuses HUD and starts interaction; microphone and spoken reply work; listening/thinking/speaking/interrupted states are accurate; failures/reconnect are visible; no always-listening cloud stream.
- **Tests:** Provider contract mocks, hotkey conflict/re-registration, audio state machine, interruption/cancellation, reconnect/timeouts, device loss, mocked conversation integration, Windows hardware smoke test.
- **Evidence:** 25 unit/integration tests pass, including current Realtime event mapping, server-only API-key handling, unauthenticated call denial, strict voice signal publication, hotkey ownership/conflicts, and HUD lifecycle projection. Format/lint/typecheck/workspace builds pass. Tauri compiles with the Windows global-shortcut plugin and the native smoke reports a running dashboard plus healthy core.
- **Known limitations:** This machine has no `OPENAI_API_KEY`, so live microphone-to-provider speech could not be exercised against an external account; it fails visibly as unavailable and is covered through deterministic gateway/provider contracts. The provider supports input/output selection but the full settings selector is deferred. Two bounded reconnect attempts are implemented; device-removal UX remains hardware-validation work.

### Phase 5 — Orchestrator / tool router

- **Status:** `DONE`
- **Scope:** Typed tool catalogue, route classifier, deterministic constraints, 3–8 shortlist, safe `tool.search` expansion, confidence/ambiguity handling, conversation/research/project/coding/browser/system routes.
- **Dependencies:** Event bus, provider contracts, conversation input; tool stubs/mocks.
- **Acceptance:** Representative requests route correctly without keyword-only logic; unknown/ambiguous routes fail safely; catalogue size does not flood prompts; selection does not authorize execution.
- **Tests:** Golden route dataset, adversarial/ambiguous cases, tool shortlist bounds, expansion escape hatch, latency/fallback, injection-shaped input, no-tool conversation cases.
- **Evidence:** 37 unit/integration tests pass, including the six required route families plus Git/deployment/memory, active project/task evidence, injection-shaped input, 3–8 shortlist bounds, safe discovery, no authorization fields, authenticated HTTP routing, voice transcript routing, and HUD projection. Format/lint/typecheck/build and native smoke remain green.
- **Known limitations:** The deterministic scorer is intentionally the offline baseline; later LLM classification can supplement it behind the same schema, but must retain deterministic constraints and evaluation fixtures. Pronoun resolution currently uses explicit active project/task IDs only. Phase 5 selects tools but does not execute them.

### Phase 6 — Web research

- **Status:** `DONE`
- **Scope:** `ResearchProvider`, current public search/fetch, structured sources, citations, partial progress, provenance/taint, cancellation/timeouts/cache, result persistence.
- **Dependencies:** Phase 5 routing, events, network configuration, secret provider if an API requires it.
- **Acceptance:** Fresh research returns an answer and source metadata; events stream to HUD; sources are attributable; failures degrade cleanly; research worker has no shell/system/Codex authority.
- **Tests:** Provider mocks/fixtures, citation/source normalization, timeout/retry rules, untrusted content propagation, cancellation, no-secret logs, end-to-end researched answer without visuals.
- **Evidence:** 40 unit/integration tests pass. Fixtures cover Responses web-search output, URL-citation deduplication/title enrichment, untrusted provenance, unsourced-output rejection, server-only key use, automatic research dispatch from routing, streamed lifecycle events, citations in conversation state, and failure-safe behavior. Format/lint/typecheck/build and native smoke pass.
- **Known limitations:** This machine has no `OPENAI_API_KEY`, so current public search cannot be live-smoked; runtime health reports research unavailable while deterministic provider/integration fixtures remain functional. Phase 6 uses a completed response internally while streaming typed lifecycle/source events to the HUD; token-delta speech overlap is future optimization. Visual media discovery remains Phase 7.

### Phase 7 — Smart References

- **Status:** `DONE`
- **Scope:** Visual evaluator, `0.65` configurable threshold, image/video/source discovery interfaces, quality/dedup/safety, asynchronous Reference Deck rendering, explanation/score telemetry.
- **Dependencies:** Phases 3 and 6; image/video provider interfaces.
- **Acceptance:** Node.js LTS research shows sources without needless imagery; humanoid robot research recommends images/likely video; recursion avoids interruption; speech is not blocked by media retrieval.
- **Tests:** Deterministic evaluator cases/boundaries, setting overrides, media dedup/safe URL, async race/cancellation, research → reference → display E2E with mocks.
- **Evidence:** 44 unit/integration tests pass. Required Node.js LTS, humanoid robotics, recursion, and threshold fixtures verify independent display decisions and media-mode recommendations. The research integration proves answer completion precedes asynchronous evaluation/display, and the dashboard opens the configured deck only for live display events. Format/lint/typecheck/build and native smoke pass.
- **Known limitations:** The current live adapter safely falls back to cited source cards because no independent image/video discovery provider is configured; evaluator output still requests `images`/`mixed` when appropriate. Image/video discovery, quality filtering, and cancellation on conversation-context replacement remain provider work. The heuristic baseline is explainable but will require broader evaluation data.

### Phase 8 — Browser Agent

- **Status:** `DONE`
- **Scope:** Playwright Chromium install/profile lifecycle; typed open/tab/nav/reload/scroll/find/click/extract/open-reference actions; Reference Deck web surface; crash recovery; download/URL policy.
- **Dependencies:** Phases 3, 5, and 14's interface contract (temporary deny-by-default guard until full broker); browser package install.
- **Acceptance:** Required browser commands work in isolated profile; no personal Chrome dependency; page content remains untrusted; website cannot invoke host/coding tools.
- **Tests:** Local fixture site integration, navigation/tab/find/click/extract, SSRF/scheme blocks, profile isolation, crash/restart, timeout, malicious prompt page, deck display.
- **Evidence:** 46 unit/integration tests pass. A real headless Microsoft Edge instance uses a disposable dedicated profile and successfully opens a fixture page, finds text, clicks a selector, observes DOM change, and extracts bounded content. URL policy tests reject unsafe schemes, credentials, and private targets. Core exposes only the authenticated action schema and emits browser/reference events. Format/lint/typecheck/build and native smoke pass.
- **Known limitations:** Browser commands currently use the typed API directly; natural-language argument extraction is a later orchestrator executor concern. Downloads, uploads, popup policy, authentication workflows, crash restart, and selector repair are not enabled. The production adapter uses installed Microsoft Edge and reports launch failures cleanly.

### Phase 9 — Project Registry

- **Status:** `DONE`
- **Scope:** Configurable roots with `C:\\Documents` default, deterministic project signal scan, canonical metadata, enable/disable/manual register/remove, Git/stack/command evidence, HUD selection.
- **Dependencies:** Phase 0 storage/config and Phase 2 UI.
- **Acceptance:** Projects are discovered and persisted; roots/settings survive restart; inaccessible/duplicate/nested projects are handled; no commands are assumed without evidence.
- **Tests:** Fixture trees for all required signals, Windows canonical/case paths, junction/permission errors, nested repos, ignore/size limits, registry integration and HUD selection.
- **Evidence:** 49 unit/integration tests pass. Fixture scans discover nested Node/Rust projects, preserve only manifest-backed commands, tolerate inaccessible roots, and cover manual registration, removal, enablement, selection, and restart persistence. Core exposes authenticated registry endpoints and the HUD consumes typed project discovery/state events. Format, lint, typecheck, build, and native smoke pass.
- **Known limitations:** Root editing has no dedicated settings UI yet. Scans are bounded startup/manual operations without filesystem watching. Reparse points are intentionally skipped. Deep framework/deployment analysis belongs to later phases.

### Phase 10 — Project index / retrieval

- **Status:** `DONE`
- **Scope:** Exact/file/glob/ripgrep/symbol/FTS layers, incremental index, evidence/freshness, change watching, ignored/secret exclusion; semantic provider interface only unless justified.
- **Dependencies:** Phase 9 project metadata, SQLite/event bus, ripgrep availability/bundling decision.
- **Acceptance:** Authentication-location questions return relevant files/symbols with evidence; deterministic layers work without embeddings; changes update index; secrets/dependencies are excluded.
- **Tests:** Multilanguage fixtures, exact/lexical/symbol/FTS ranking, incremental change/delete, cancellation, ignored paths, secret patterns, large repo performance budget.
- **Evidence:** 51 unit/integration tests pass. Multilayer fixtures cover filename, symbol, ripgrep, and FTS evidence; first-search indexing, secret-file exclusion, bounded text handling, and deleted-file cleanup. Authenticated index/search endpoints and routed selected-project searches emit real HUD/conversation state. Format, lint, typecheck, build, and native smoke pass.
- **Known limitations:** Symbol extraction is regex-based for common declarations rather than a full language-server parser. Index refresh is on demand/first search; filesystem watching and cancellation hooks are not yet exposed. Semantic retrieval is intentionally deferred.

### Phase 11 — Codex integration

- **Status:** `DONE`
- **Scope:** `CodingAgentProvider`, Codex discovery/version/capability handshake, App Server process supervision, JSON-RPC correlation, generated adapter-local types, threads/turns/events/approvals, mock provider.
- **Dependencies:** Phases 1, 5, 9–10; installed compatible Codex; task schema.
- **Acceptance:** Create/start/steer/pause/resume/cancel/query a mock and real supported Codex task; structured progress appears; conversation remains responsive; unavailable/incompatible Codex is explicit.
- **Tests:** Recorded JSON-RPC transcript contract tests, request correlation, malformed messages, process crash/reconnect, approvals, event mapping, mock integration, real smoke if installed.
- **Evidence:** 54 unit/integration tests pass. A deterministic fake App Server verifies initialize/thread/turn request correlation and structured item/diff/completion mapping; the mock covers steering lifecycle; the installed Codex 0.147 App Server completes a real initialize handshake. Core exposes authenticated task APIs and bridges provider events into typed HUD state. Format, lint, typecheck, build, and native smoke pass.
- **Known limitations:** App Server remains experimental and the adapter uses a validated structural subset rather than vendoring its full generated schema. Pause maps to turn interruption and resume starts a continuation turn. Central approval fulfillment waits for Phase 14; unexpected requests are visible and denied. Worktree enforcement begins in Phase 12.

### Phase 12 — Worktree manager

- **Status:** `DONE`
- **Scope:** Branch/worktree creation, `%LOCALAPPDATA%` layout, canonical ownership locks, baseline revision, dirty-state preservation, safe cleanup, non-Git fallback policy.
- **Dependencies:** Phases 9 and 11; Git executable.
- **Acceptance:** Every significant Git coding task uses its own branch/worktree; parallel tasks cannot share a writable checkout; no `.env` copying; stale/dirty state is reported and preserved.
- **Tests:** Temporary repo integration, concurrent creation, duplicate project names, junction/path escape, dirty reuse, stale Git metadata, safe cleanup/denial, non-Git behavior.
- **Evidence:** 57 unit/integration tests pass. Disposable Git repositories prove unique parallel branches/paths, dirty-source preservation, untracked-file isolation, current-branch correctness, tracked-secret/non-Git refusal, dirty-worktree preservation, and clean Git-mediated cleanup. Core task creation requires the worktree manager and passes its managed path to Codex. Format, lint, typecheck, build, and native smoke pass.
- **Known limitations:** Submodules, Git LFS hydration, sparse checkouts, antivirus locks, and long-path policy need packaging-environment validation. Branch deletion is intentionally separate from worktree removal. Non-Git coding tasks are blocked instead of using a less-isolated fallback.

### Phase 13 — Verification + diff UI

- **Status:** `DONE`
- **Scope:** Evidence-based project command config, isolated install/lint/typecheck/test/build runner, timeouts/cancellation, results, Git diff artifact, Reference Deck diff and conversational steering.
- **Dependencies:** Phases 3, 10–12.
- **Acceptance:** Available configured checks run and report accurate states; failed tests do not appear complete; diff summary/deck view works; user can explain/steer/revert scoped changes.
- **Tests:** Fixture projects/package managers, absent commands, timeouts/cancellation, output bounds/redaction, diff parsing/binary/rename, steering loop, project → task → checks → diff E2E.
- **Evidence:** 59 unit/integration tests pass. Disposable Git fixtures prove evidence-backed npm/pnpm/yarn script execution, skipped absent commands, failure propagation, bounded output, baseline diff generation, typed lifecycle events, and Reference Deck `CODE_DIFF` requests. Core exposes an authenticated explicit verification route and automatically schedules verification when a Codex task reaches review. Format, lint, typecheck, build, and native smoke pass.
- **Known limitations:** V1 executes only typed package-script forms discovered during project analysis; arbitrary shell command strings are intentionally rejected. Process cancellation is timeout-based pending task-wide cancellation propagation. Diff rendering is text-first; advanced side-by-side/binary/rename rendering is deferred.
- **Known risks:** Destructive scripts, dependency side effects, long output, flaky tests, huge/binary diffs, command inference errors.

### Phase 14 — Permission broker

- **Status:** `DONE`
- **Scope:** Complete mediation API, risk/resource/action schemas, policy evaluation, approval UI/events, action digest and one-use receipts, audit, default deny, provenance/taint and egress checks.
- **Dependencies:** Core actions/providers/events/database; integrate all existing executable paths before acceptance.
- **Acceptance:** Every consequential action passes the broker; Level 3 requires exact approval; denials/timeouts are honored; unknown actions deny; web injection cannot escalate; no bypass path remains.
- **Tests:** Policy matrix, receipt replay/tamper/expiry, target/argument change, denial/error, concurrent approvals, prompt/tool injection, provenance, secret egress, path scope, local API forgery.
- **Evidence:** 63 unit/integration tests pass. The broker derives risk from a closed action catalog, records every decision with argument values redacted, deduplicates identical pending requests, denies untrusted web escalation without prompting, and issues expiring one-use receipts bound to a canonical digest of action/resource/project/arguments/provenance. Tests cover approval/rejection, receipt replay/tampering/expiry, prompt injection provenance, audit redaction, authenticated HTTP approval resolution, and exact browser-action retry. Core mediation covers research, references, browser actions, project registry/search, Codex task creation/control, worktree creation, and verification.
- **Known limitations:** Approval receipts require the initiating client/workflow to retry the exact action; Core deliberately does not retain and replay arbitrary side-effecting HTTP bodies. Codex App Server remains on `approvalPolicy: never`, so unexpected transport-level approval requests are denied and surfaced rather than dynamically elevated. Broader secret-egress classification will expand with deployment/system/credential providers.
- **Known risks:** Missed execution path, confusing approval UX, overly broad cached policy, time-of-check/time-of-use changes.

### Phase 15 — Git commit / push

- **Status:** `DONE`
- **Scope:** Task target resolution, commit policy/preview, explicit push command, remote/refspec validation, Level 3 approval/audit, result events; no automatic push.
- **Dependencies:** Phases 12–14.
- **Acceptance:** “Push it” resolves the unique current task and pushes after approval; named task works; ambiguous target asks; “looks good/done/finish it” never pushes; rejection leaves remote unchanged.
- **Tests:** Temporary bare remote integration, ambiguity fixtures, receipt target binding, remote changed after preview, push rejection/auth failure, no-auto-push regression, audit/log redaction.
- **Evidence:** 66 unit/integration tests pass. Disposable repositories prove isolated-branch commit and push to a bare `origin`, explicit-wording enforcement, active/named/Codex-ordinal resolution, ambiguity rejection, and refusal of secret-bearing changes before staging. The Level 3 permission digest binds task, branch, pre-push revision, and worktree change digest; the dashboard retries only the typed Git endpoint with the one-use receipt. Push uses a fixed `origin`, exact owned `jarvis/*` branch, argument arrays, no force/tags, and non-interactive credentials.
- **Known limitations:** The initial implementation publishes only to the fixed `origin` remote and creates a neutral JARVIS task commit when approved changes remain. Protected-branch/credential failures are reported without retry loops. Commit signing and configurable commit-message templates are deferred.
- **Known risks:** Credentials, protected branches, force/refspec mistakes, race with remote changes, user ambiguity.

### Phase 16 — Deployment system

- **Status:** `DONE`
- **Scope:** Typed discriminated deployment schema and repository, adapter registry, validation/preflight/deploy/health/rollback events, initial safe adapters/dry run, secrets by reference, Level 3 authorization.
- **Dependencies:** Phases 9–10, 13–14; configured test project.
- **Acceptance:** A configured fixture project validates and deploys through a typed adapter/dry-run target; health result appears; denial prevents mutation; unknown/custom adapter defaults deny.
- **Tests:** Schema/version migration, adapter contract, dry-run, preflight failure, health timeout, rollback fixture, secret reference/redaction, approval binding, deployment event state.
- **Evidence:** 69 unit/integration tests pass. The shared discriminated schema accepts only versioned dry-run, Docker Compose, PowerShell, or CI/CD records with named preflights, typed health checks, and secret references. SQLite persistence, config-digest preview, changed-config rejection, unknown-schema rejection, unavailable-adapter denial, durable run state, and dry-run start/completion events are covered. Core execution is Level 3 and the dashboard consumes its exact one-use receipt.
- **Known limitations:** Only the non-mutating dry-run adapter is registered in this phase; Docker Compose, PowerShell, and CI/CD configs validate but fail closed until their adapter is installed. Dry-run health is `SKIPPED`; executable HTTP health checks, rollback, and adapter-specific preflight execution remain adapter work.
- **Known risks:** Adapter-specific semantics, partial failure, rollback limits, credential scope, production/test target confusion.

### Phase 17 — Deployment config auto-creation

- **Status:** `DONE`
- **Scope:** Read-only analyzer for Docker/Compose/IIS/scripts/package/CI/docs/env examples, evidence-ranked proposal, unresolved fields, validation, review, separate save/execute approvals.
- **Dependencies:** Phase 16 schema/adapters; Phase 10 retrieval.
- **Acceptance:** “Deploy it” without config performs zero deployment; produces a reasoned typed proposal, asks for unresolved data, validates, and saves only after approval; first deployment remains separately authorized.
- **Tests:** Docker/Compose/Node/Python/IIS/CI fixture repos, conflicting evidence, missing credentials/target, malicious README instructions, zero-execution assertion, proposal → approval → save E2E.
- **Evidence:** 71 unit/integration tests pass. The analyzer reads only a bounded allow-list of root deployment artifacts and workflow filenames, rejects symlinks/oversized files, ranks Compose above Docker/CI/PowerShell/IIS/Node evidence, extracts only variable names from `.env.example`, and never interprets README instructions. Compose fixtures prove proposal persistence, zero deployment runs, config save by proposal digest, and reusable typed output. Unsupported Node/IIS evidence remains unresolved and cannot be saved.
- **Known limitations:** The analyzer currently recognizes root Compose/Dockerfile/deploy.ps1/web.config/package manifests and GitHub workflow filenames; deeper organizational deployment conventions require manual configuration. A health check defaults to `none` in structurally complete proposals and should be reviewed before first real adapter execution.
- **Known risks:** False inference, hidden organizational process, malicious project docs, incomplete rollback/health information.

### Phase 18 — Windows system tools

- **Status:** `DONE`
- **Scope:** Windows adapters for allow-listed application/URL/volume/running apps/terminal/explorer/reveal/stats/monitors/window operations; native capability discovery; least privilege; permissions.
- **Dependencies:** Phase 14; OS abstraction package and Tauri/native host.
- **Acceptance:** Safe actions/telemetry work on supported Windows without admin; risky/elevated actions request approval; unsupported capabilities fail clearly; no generic shell exposed.
- **Tests:** Adapter unit mocks, argument/path validation, timeout/process cleanup, permission denial, telemetry parsing, monitor/window smoke, non-admin verification.
- **Evidence:** 75 unit/integration tests pass. `WindowsSystemControlProvider` exposes only typed application/URL/Explorer/reveal/Terminal/running-app/stat actions, maps them to fixed executables and argument arrays, validates file/directory targets, uses bounded non-interactive process execution, and reports unsupported platforms. Core routes read actions at Level 0 and host mutations at Level 2 with typed lifecycle events. Existing telemetry and Tauri monitor/window placement remain the native sources for continuous state.
- **Known limitations:** Volume, arbitrary close-process, cross-process window move/resize, and administrator operations are intentionally absent until a dedicated native implementation can enforce ownership and reliable Windows APIs. Running-app discovery uses a fixed PowerShell query; application launch is limited to four allow-listed executables.
- **Known risks:** Localization/WMI/CIM variance, UWP apps, admin-only operations, antivirus, OS version differences.

### Phase 19 — Screenshot context

- **Status:** `DONE`
- **Scope:** Explicit capture of active window/display, active-app metadata, typed image attachment, temporary/persistent retention policy, redaction hooks, future selected-region interface.
- **Dependencies:** Phases 4, 14, 18; multimodal conversation provider capability.
- **Acceptance:** Explicit “look at this” capture reaches the conversation with metadata; capture state is visible; failure is clear; no continuous capture; multiple monitors handled.
- **Tests:** Provider mock, active-window/display selection, scaling/multi-monitor coordinates, denial/permission errors, image limits, retention/deletion, secret-log regression, manual smoke.
- **Evidence:** 77 unit/integration tests pass. `WindowsScreenshotProvider` captures the active foreground-window bounds or primary display through a fixed non-interactive PowerShell/native API bridge, enforces a 10 MiB PNG limit, returns a typed ephemeral attachment, and deletes the temporary file in `finally`. The authenticated Core route requires the centralized `system.capture` permission, publishes visible capture lifecycle and conversation-context metadata events, and never puts pixel data in events, logs, or SQLite.
- **Known limitations:** V1 supports the active window and primary display; selected regions and choosing a non-primary display remain provider extensions. Protected/HDR content can capture as a black or color-shifted frame. Passing the returned image to a model requires a multimodal conversation provider implementation; Core currently registers the attachment as conversation context and returns its bytes only to the authenticated initiating client.
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

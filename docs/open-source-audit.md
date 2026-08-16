# JARVIS Open-Source Architecture Audit

Status: Phase -1 complete
Audit date: 2026-08-17
Scope: architecture and licensing review only; no upstream source was copied into JARVIS.

## OPEN SOURCE AUDIT

### Method

The audit used shallow snapshots of each default branch, not README-only review. For each project the root tree, manifest files, license text, architecture documentation, and source paths related to voice, tools, memory, browser control, projects, agent execution, permissions, and event streaming were inspected. Commit hashes below make the findings reproducible.

| Project | Repository | Audited commit |
| --- | --- | --- |
| Codexia | https://github.com/milisp/codexia | `1209c1e81cb91cdf0ce008cb1bd0b22cfb7647d0` |
| ethanplusai/jarvis | https://github.com/ethanplusai/jarvis | `df3044fcf238c8e270c2ecd32302cea159435c48` |
| isair/jarvis | https://github.com/isair/jarvis | `d22ed8b975792842dc09e49861f31a39cbb302a6` |
| Leon AI | https://github.com/leon-ai/leon | `3e0020d26f4f09f4023b0683a8dbbcf0dcd1e326` |
| rezaulhreza/jarvis | https://github.com/rezaulhreza/jarvis | `c8d9b6d0909cf86e664a25749d7d7ceab5807898` |
| OpenJarvis | https://github.com/open-jarvis/OpenJarvis | `1ca3ec6ceab69125b273b2be191f3536431f26da` |
| Agent Zero | https://github.com/agent0ai/agent-zero | `baadd0dd0b09fa769a1027c183b964be85d5c8cc` |
| Open Interpreter 01 | https://github.com/openinterpreter/01 | `befddaf205d0eb03020af4df13bf7d8f1b3f6003` |
| Screenpipe | https://github.com/screenpipe/screenpipe | `6c88c5c1338c7b3d279c118c5158836813e6d0d3` |

Reuse labels used below:

- **Directly reusable**: license permits reuse if its terms are followed; technical fit is assessed separately.
- **Reusable with obligations**: copying is possible only while satisfying attribution, notice, source-offer, copyleft, or non-commercial constraints.
- **Architectural reference only**: learn from behavior and independently implement it.
- **Not useful for V1**: the implementation conflicts with the product, security model, platform, or phase scope.

### Comparison table

| Project | Repository | License | Primary stack | Windows support | Voice | Web research | Visual references | Browser control | Memory | Project awareness | Codex integration | Worktrees | Multi-agent support | Permission model | Deployment support | Useful patterns | Reuse recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Codexia | `milisp/codexia` | **Inconsistent at snapshot.** Root `LICENSE` and README at the audited commit say MIT; `src-tauri/Cargo.toml` still says AGPL-3.0; GitHub's rendered/cached metadata still described AGPL/commercial licensing. | Rust, Tauri 2, React/TypeScript, Vite, Zustand, Axum, SQLite | Strong: installer and portable Windows build; Windows process handling exists | Codex realtime protocol bindings exist; not a complete JARVIS voice layer | Codex web-search events/config, not a standalone research service | File/data preview, not a smart second-monitor deck | Limited/agent-mediated | Thread/session persistence and Codex memory bindings | Project picker, file tree, editor, git state | **Strongest reference:** structured `codex app-server` JSON-RPC, generated bindings, threads/turns, approvals | Strong; per-path locks, stable task keys, stale-state handling | Codex/Claude/ACP agents and collaboration event types | Structured Codex approval requests; separate Claude hooks and stored allow rules | Task scheduler/headless server, not project production deployment | Thin JSON-RPC envelope, generated protocol types, event sink, thread lifecycle, approval correlation, worktree locking, desktop/headless split | **Architectural reference only until license inconsistency is resolved.** If clarified as MIT, selected code could be reused with notice, but JARVIS should still independently implement the Node adapter. |
| ethanplusai/jarvis | `ethanplusai/jarvis` | Custom personal/non-commercial license; commercial use requires separate permission | Python/FastAPI, TypeScript/Vite/Three.js, WebSocket, Playwright, SQLite, AppleScript | No practical Windows support; explicitly macOS-first | Strong experiential reference: browser STT, streamed TTS, interruptible audio, reactive orb | Background research/report workflow | Research report and screen/orb experience; no reference deck | Playwright module | SQLite/FTS5 memories, tasks, notes | Desktop project scan and Claude Code sessions | No Codex; Claude Code subprocesses | None | Background worker patterns, not robust multi-agent isolation | Weak: action tags and a default skip-permissions path conflict with JARVIS | No typed deployment subsystem | Low-latency acknowledge-then-work UX, audio-reactive state, background completion notices | **Architectural/UX reference only.** License blocks unrestricted reuse, macOS assumptions are unsuitable, and the monolithic action-tag design should not be adopted. |
| isair/jarvis | `isair/jarvis` | Custom non-commercial, reciprocal license; commercial license required | Python, local LLM/Ollama or OpenAI-compatible APIs, desktop bundle, Playwright/MCP, Whisper/Piper, SQLite/graph memory | Supported binaries and scripts, but primary development is macOS and Windows may lag | Strong local wake/conversation/dictation pipeline with interruption | Built-in web-search fallback and fetch tools | Screenshot/OCR context; no reference deck | Stateful Chrome control through persistent MCP sessions | Conversation store, recall gate, graph memory, digesting/redaction | Local file tools; not a full registry/index | None | None | MCP tools can be narrowed, but consequential-action policy is not JARVIS-grade | None | Select 3–8 tools by keyword/embedding/LLM, always-available escape hatch, per-server MCP workers, recall gating, untrusted-result digest | **Architectural reference only.** The dynamic tool catalogue pattern is high value; license is incompatible with unrestricted reuse. |
| Leon AI | `leon-ai/leon` | MIT | Node.js/TypeScript, React/Vite, Fastify/Socket.IO, SQLite, Node and Python tool bridges, local/cloud model providers | Cross-platform intent; source includes Windows branches, though setup is broader than JARVIS needs | Mature stateful voice UI, local/cloud TTS and wake assets | Typed search-web toolkit | Tool UI and voice visualizer, not a second-monitor reference system | Context/history support rather than a dedicated browser agent | Memory manager and bridge SDK memory APIs | Context files, skills, and local runtime; not JARVIS registry/index | None | Agent loop, but not coding-agent worktrees | Tools have typed settings and process boundaries; not the full risk broker required here | No project-specific typed deployment | Skills → actions → tools separation, bounded tool observations, progress events, settings validation, provider abstraction | **Directly reusable under MIT with notice**, but prefer adapting interfaces and tests because Leon's runtime and product model differ. |
| rezaulhreza/jarvis | `rezaulhreza/jarvis` | **No license file.** `pyproject.toml` declares MIT, but no repository license grant was found | Python, React/TypeScript web UI, Ollama/cloud providers, WebSocket, SQLite/ChromaDB | Partial; README/install path is macOS/Linux-oriented and voice code has no Windows TTS implementation | Push-to-talk/Whisper plus several web providers | Web search and researcher persona | Generated media and animated orb; no smart external reference deck | Web fetch/search, not a dedicated isolated browser | SQLite working memory, facts, semantic history, ChromaDB RAG | Project root and JARVIS/CLAUDE instructions; basic code tools | Authentication helper only, not Codex task control | None | Lightweight subagents and parallel tool calls | Three risk bands, but moderate actions fail open without UI and path confinement is incomplete | None | 3–8 tool selection, parallel execution events, tool timeline, RAG reranking, compact HUD ideas | **Architectural reference only.** Metadata alone is not a safe copyright license grant; permission and path handling also conflict with requirements. |
| OpenJarvis | `open-jarvis/OpenJarvis` | Apache-2.0 | Python/FastAPI, Rust/PyO3 workspace, React/TypeScript/Tauri, local and cloud providers | Strong native Windows installer/service; limited-privilege scheduled task and loopback default | STT/TTS provider families; not yet a complete realtime desktop conversation loop | Deep-research agents and retrievers | Research timeline/citations; no JARVIS reference deck | Optional Playwright browser assistant | Persistent memory service and multiple retrieval backends | Code assistant and storage/retrieval primitives | Claude Code adapter, not Codex App Server | None found for Codex tasks | Multiple agent types/orchestrators | Strong Rust security primitives: capabilities, taint labels, injection/SSRF helpers, audit events | Docker/systemd/launchd/Windows service deployment of OpenJarvis itself | Provider registry, typed tool trait, capability checks, taint propagation, authenticated WebSocket reconnect, loopback/LAN guard | **Directly reusable with Apache-2.0 NOTICE/attribution obligations.** Prefer adapting concepts across the Python/Rust-to-TypeScript boundary; consider reuse of isolated schemas/tests only. |
| Agent Zero | `agent0ai/agent-zero` | MIT | Python, Web UI, Dockerized Linux desktop, Playwright/Chromium, plugin/MCP ecosystem | Strong through Docker Desktop/launcher; host bridge supports Windows | Optional Whisper/Kokoro plugins, not core realtime voice | Research agent and search helpers | Browser canvas, screenshots, document cowork | Strong isolated browser with DOM annotation and optional host browser | Project-scoped memory/knowledge | Strong project isolation, repository and file tree support | No native Codex App Server adapter | No Git worktree model | Strong superior/subagent contexts and profiles | Container is primary boundary; profile/tool policies and explicit host connector | Container/service setup; not JARVIS project deployment | Agent environment vs host bridge, project-scoped secrets/memory, intervention, scoped profiles, recoverable state | **Directly reusable under MIT with notice**, but use as a security reference. Requiring Docker for JARVIS V1 would harm the Windows desktop experience. |
| Open Interpreter 01 | `openinterpreter/01` | AGPL-3.0 | Python, Open Interpreter, FastAPI/server, LiveKit, realtime STT/TTS, mobile/ESP32 clients | Documentation includes Windows LiveKit; old/experimental source | Strong voice-to-action transport; sentence-fragment TTS streaming | Inherited Open Interpreter web/code tools | Client/device display only | Inherited computer/browser control | Minimal in this repository | Minimal | None | None | Inherited Open Interpreter agent model | Explicitly weak: source disables acknowledgement/auth and README warns of missing safeguards | Device/server launch only | Start/end audio framing, STT feed, begin TTS on early delimiter, device/client split | **Architectural reference only.** AGPL obligations and deliberately experimental permission behavior conflict with JARVIS. |
| Screenpipe | `screenpipe/screenpipe` | Screenpipe Commercial License; source-available, personal/non-commercial; commercial license required | Rust workspace, Tauri, TypeScript/Next.js, SQLite/FTS5, native Windows/macOS capture and audio | Strong Windows 10/11; Windows Graphics Capture and native OCR | Audio capture/transcription, not conversational assistant voice | Search over recorded context, not public-web research | Timeline/screenshots; not answer-driven references | Owned browser exists, but outside V1 audit focus | Searchable local activity memory | Activity/project context rather than source registry | ACP/coding-assistant surfaces exist, not the JARVIS Codex control plane | No relevant task-worktree pattern | Scheduled pipes/agents | Deterministic per-pipe data gates and pre-capture privacy controls | Enterprise/app deployment only | Accessibility-first event capture, OCR fallback, one-writer SQLite discipline, cancellable queries, privacy-before-capture, dev/prod data isolation | **Architectural reference only.** Custom commercial license prevents unrestricted reuse; continuous capture is explicitly deferred from V1. |

### Source-level findings by project

#### Codexia

Relevant inspected paths:

- `crates/codex/src/app_server.rs`: launches `codex app-server`, keeps request IDs in a pending map, classifies responses/server requests/notifications, and emits structured events.
- `crates/codex/src/protocol.rs`: intentionally understands only the JSON-RPC envelope while generated TypeScript bindings remain authoritative for payload shapes.
- `src/bindings/v2/`: generated thread, turn, item, realtime, collaboration, approval, and MCP event types.
- `src-tauri/src/commands/codex/approval.rs`: correlates explicit responses with server-originated approval request IDs.
- `crates/git/src/worktree.rs` and `crates/automation/src/worktree.rs`: worktree path locking, stable task/project keys, reuse of dirty worktrees, and stale metadata cleanup.
- `web/` and `src/services/tauri/`: headless Axum/WebSocket transport and a separate frontend invoke layer.

Patterns to adopt independently: keep the transport envelope small; generate protocol types; correlate approvals rather than parsing text; use a transport-neutral `CodingAgentProvider`; serialize worktree mutations per canonical path; preserve dirty task output for review.

Patterns to reject: copying `.env*` files into worktrees without a per-project secret policy; exposing generic filesystem/terminal endpoints to the dashboard; coupling the core business model to Rust/Tauri commands; relying on current licensing until the contradictory metadata is resolved.

#### ethanplusai/jarvis

Relevant inspected paths: `server.py`, `conversation.py`, `actions.py`, `browser.py`, `screen.py`, `memory.py`, `frontend/src/voice.ts`, and the orb/state frontend.

Useful experiential patterns are immediate spoken acknowledgement, asynchronous background work, audio-driven visuals, and concise completion notification. The implementation is a FastAPI monolith, routes behavior with action tags embedded in model prose, scans macOS desktop state, and has a skip-permissions mode enabled by default in source. Those patterns conflict with typed events, Windows adapters, and complete permission mediation.

#### isair/jarvis

Relevant inspected paths:

- `src/jarvis/tools/selection.py`: ALL, keyword, embedding, and LLM strategies; minimum/maximum selection bounds.
- `src/jarvis/tools/builtin/tool_search.py`: an always-available mid-loop escape hatch when the initial shortlist is insufficient.
- `src/jarvis/tools/external/mcp_runtime.py`: long-lived per-server sessions, serialized calls within a stateful server, parallelism across servers, timeouts, and optional idle reaping.
- `src/jarvis/memory/recall_gate.py`, `conversation.py`, and graph modules: separate decisions about whether to recall and what to inject.
- `src/jarvis/tools/builtin/web_search.py` and screenshot tooling: structured web/context tools with untrusted-result treatment.

The catalogue/shortlist/escape-hatch pattern materially changes JARVIS tool routing. Selection is not authorization: the permission broker must still mediate every execution.

#### Leon AI

Relevant inspected paths: `server/src/core/llm-manager/llm-duties/skill-router-llm-duty.ts`, `react-llm-duty/tool-execution.ts`, `bridges/nodejs/src/sdk/base-tool.ts`, `tool-manager.ts`, memory manager paths, and `app/src/js/voice-energy.js`.

Leon demonstrates typed tool metadata, per-tool settings, a bridge/runtime boundary, timeouts, progress callbacks, and UI activity events. Its skill router selects a single skill while the newer agent loop can execute typed tools. JARVIS should retain the hierarchy and typed execution model but allow a bounded tool set and parallel independent calls.

#### rezaulhreza/jarvis

Relevant inspected paths: `jarvis/core/agent.py`, `intent.py`, `router.py`, `tool_executor.py`, `permissions.py`, `sub_agent.py`, `knowledge/rag.py`, `voice/voice_mode.py`, and `web/src/components/chat/ToolStatus.tsx`.

The project usefully demonstrates LLM routing with heuristic fallback, 3–8 selected tools, parallel execution callbacks, a compact tool activity UI, and two-stage RAG. Its permission manager is not suitable: unknown tools default to moderate and moderate actions are allowed when no UI exists. File helpers also accept absolute paths without a JARVIS-owned scope policy.

#### OpenJarvis

Relevant inspected paths:

- `rust/crates/openjarvis-tools/src/traits.rs` and `executor.rs`: typed tool specs, a central executor, capability checks, taint checks, timeouts, and event emission.
- `rust/crates/openjarvis-security/src/capabilities.rs`, `taint.rs`, `injection.rs`, and `ssrf.rs`: capability/resource policies and information-flow labels.
- `frontend/src/lib/useAgentEvents.ts`: authenticated WebSocket subscription with exponential reconnect and filtering.
- `docs/architecture/agents.md`, `memory.md`, `security.md`: provider, agent, memory, and threat-boundary documentation.
- `deploy/windows/`: current-user scheduled task, limited run level, loopback default, and refusal to bind all interfaces without an API key.

OpenJarvis provides the best permissively licensed security primitives in the audit. JARVIS will adapt the capability/taint concepts into TypeScript and add explicit risk levels, approval receipts, project/worktree scope, and provenance.

#### Agent Zero

Relevant inspected paths: `agent.py`, `api/projects.py`, `api/subagents.py`, `helpers/projects.py`, the browser plugin/runtime, `docker/run/docker-compose.yml`, and project/browser/memory guides.

Its strongest contribution is boundary design: the agent normally receives a Linux environment, while a separate connector grants deliberate host access. Projects scope workspaces, secrets, instructions, memory, repositories, and profiles. JARVIS will adapt this separation using child processes, Windows job/process controls, scoped worktrees, isolated browser profiles, and explicit host providers. Docker remains optional/future rather than mandatory.

#### Open Interpreter 01

Relevant inspected paths: `software/source/server/server.py`, LiveKit workers/profiles, client implementations, and server/client documentation. The voice server feeds audio into STT, marks turn start/end explicitly, and begins streaming TTS after early sentence delimiters. The same file disables acknowledgement and authentication environment guards, and the project warns users not to run it on sensitive systems. Only latency/transport ideas are retained.

#### Screenpipe

Relevant inspected paths:

- `crates/screenpipe-screen/src/lib.rs`: accessibility-first capture, Windows Graphics Capture, native OCR fallback, bounded platform calls, and privacy gates before pixels are read.
- `crates/screenpipe-audio/src/lib.rs`: per-device health, non-blocking callbacks, meeting-only lifecycle, and interruption recovery.
- `crates/screenpipe-db/src/lib.rs`: SQLite single-writer coordination, terminal corruption states, verified recovery, FTS5 normalization, and cancellable reads.
- `crates/screenpipe-events/`: typed device, permission, recovery, workflow, and connection event families.
- `apps/screenpipe-app-tauri/README.md`: strict development/production data, port, secret, and agent-home isolation.

These are future context-capture and reliability references. Continuous screen/audio capture remains outside V1.

## LICENSE FINDINGS

| Category | Projects | JARVIS policy |
| --- | --- | --- |
| Permissive and clear | Leon (MIT), OpenJarvis (Apache-2.0), Agent Zero (MIT) | Code reuse is legally possible with license/notice compliance and provenance records. Prefer small, isolated reuse only when it improves maintainability. |
| Conflicting metadata | Codexia | Root license/README changed to MIT at the audited tip, but Cargo metadata and rendered GitHub metadata still report AGPL/commercial terms. Treat as reference-only until the maintainer resolves the inconsistency or supplies a clear release/tag. |
| Non-commercial/source-available | ethanplusai/jarvis, isair/jarvis, Screenpipe | Do not copy code or assets. Independently implement high-level patterns. |
| Copyleft | Open Interpreter 01 (AGPL-3.0) | Do not copy into JARVIS without an explicit product-level decision to accept AGPL obligations. Architecture reference only. |
| Missing effective grant | rezaulhreza/jarvis | A `pyproject.toml` declaration is not treated as a substitute for a license text. Architecture reference only pending clarification. |

License diligence rules for later phases:

1. Every copied upstream file or substantial snippet must have a provenance record containing project, URL, commit, license, local destination, modifications, and required notices.
2. Dependency licenses must be captured in the lockfile/SBOM process; this audit does not approve future dependency versions automatically.
3. Assets, icons, screenshots, voices, names, and media require separate rights review even when source code is permissive.
4. JARVIS uses independent implementations by default. Similar behavior is not evidence that source was copied.
5. Re-check upstream licenses immediately before any actual reuse because this audit is a point-in-time record.

## REUSABLE PATTERNS

1. **Structured coding-agent control plane** — Codexia's small JSON-RPC envelope, generated app-server bindings, request correlation, and notification stream.
2. **Bounded dynamic tool discovery** — isair's catalogue → 3–8 tool shortlist → always-available search/expansion tool, combined with Leon's typed tool metadata.
3. **Complete execution mediation** — OpenJarvis capability and taint checks placed in the executor, extended with JARVIS risk levels and approval receipts.
4. **Host boundary** — Agent Zero's isolated environment plus explicit host connector, adapted to Windows child processes, worktrees, browser profile, and OS providers.
5. **Task/worktree isolation** — Codexia's canonical per-path locking and stable task keys, with JARVIS-specific branch policy and no implicit secret copying.
6. **Responsive voice UX** — ethanplusai and 01 begin acknowledgement/TTS early while long-running operations continue asynchronously.
7. **State-driven visuals** — Leon and the JARVIS projects map listening/processing/talking/tool activity to visual state; JARVIS will drive this exclusively from typed events.
8. **Memory gating** — isair decides whether recall is useful before injecting context; OpenJarvis separates memory storage/retrieval backends.
9. **Local database resilience** — Screenpipe's one-writer discipline, bounded/cancellable reads, and verified recovery inform the SQLite repository layer.
10. **Windows least-privilege service behavior** — OpenJarvis defaults to loopback and current-user/limited startup; JARVIS follows the same posture.

## ARCHITECTURE CHANGES

The audit changes the pre-implementation design in these ways:

1. **Tauri is a native host, not the core.** React renders state; Tauri/Rust owns window, display, hotkey, secure storage integration, and other native primitives. The Node/TypeScript core owns orchestration, events, permissions, tasks, projects, memory, research, Codex, and deployment.
2. **One versioned protocol spans IPC and WebSocket.** Commands, replies, events, errors, and approvals have runtime schemas. UI code never parses assistant prose for state.
3. **Coding agents use a transport-neutral adapter.** `CodingAgentProvider` wraps Codex App Server first. Generated protocol types are isolated under the adapter so Codex changes cannot leak through the domain model.
4. **Tool selection and authorization are separate.** The router exposes only a bounded relevant set plus a discovery escape hatch; the permission broker independently authorizes each execution.
5. **Action requests are canonical and approval-bound.** Risk, provider, operation, normalized resource, project/task/worktree, reason, provenance, argument digest, and expiry are part of the approval record.
6. **Worktrees are secret-clean by default.** Project files come from Git. Secrets are injected through a `SecretProvider` only when an approved task needs a named secret; `.env` files are never copied automatically.
7. **Untrusted data carries provenance/taint.** Web/browser output remains `external/untrusted` through research and reference rendering. It cannot become a system instruction or direct shell/Codex/system action.
8. **SQLite has a single mutation owner.** Repository interfaces serialize writes, make long searches cancellable, keep transactions free of network/model work, and support explicit migrations/recovery.
9. **Long-running operations are durable jobs.** Research, indexing, Codex, verification, Git, and deployment have lifecycle state, cancellation, correlation IDs, and resumable event history. Voice is never their scheduler.
10. **Development and production state are isolated.** Database, logs, browser profile, worktrees, ports, and secret namespaces differ between development/test/production.
11. **Localhost still requires a session boundary.** The service binds to `127.0.0.1`; the dashboard authenticates with a launch-scoped token and strict origin/protocol checks. LAN exposure is a future explicit configuration with authentication.
12. **Continuous screen/audio capture is deferred.** V1 implements explicit screenshot capture only. Screenpipe-inspired continuous context requires a separate consent, retention, redaction, and storage design.

## COMPONENT BUILD/ADAPT/REUSE MATRIX

`BUILD` means a JARVIS-owned implementation. `ADAPT` means independently implement an upstream pattern. `REUSE` means use an unmodified library or clearly compatible permissive component with its license obligations. `DEFER` means keep an interface/decision record but do not implement yet.

| JARVIS subsystem | Decision | Primary influence | Reasoning |
| --- | --- | --- | --- |
| Desktop shell | ADAPT | Codexia, OpenJarvis | Tauri 2/React is proven on Windows, but JARVIS needs a Node-owned core and narrower native boundary. |
| HUD | BUILD | ethanplusai, Leon, rezaulhreza | Product-specific real-state visualization; no upstream HUD matches the required layout/state model or licensing mix. |
| Voice | ADAPT | isair, 01, ethanplusai, OpenJarvis | Preserve early audio streaming, interruption, and provider boundaries; build Windows activation/device handling independently. |
| Realtime conversation | ADAPT | 01, ethanplusai | Use explicit turn/audio framing and non-blocking jobs, with JARVIS permissions and provider abstraction. |
| Tool routing | ADAPT | isair, Leon | Bounded shortlist plus discovery escape hatch and typed catalogue; never conflate routing with permission. |
| Research | ADAPT | OpenJarvis, isair | Structured, cited, multi-step research is useful, but JARVIS needs its own result/reference contract. |
| Smart References | BUILD | Product requirement | None implements the independent visual-utility decision and threshold required here. |
| Reference Deck | BUILD | Product requirement; Screenpipe timeline only as UX reference | Multi-monitor asynchronous modes and diff/document presentation are JARVIS-specific. |
| Browser Agent | REUSE | Playwright; isolation patterns from Agent Zero/isair | Reuse Playwright as the browser engine; build the typed provider, isolated profile, provenance, and permission gates. |
| Project Registry | BUILD | Agent Zero projects, Codexia picker | Required Windows root discovery, normalized metadata, and external JARVIS config are product-specific. |
| Project Search | REUSE | ripgrep and SQLite FTS5; Screenpipe/isair retrieval patterns | Reuse deterministic search primitives; build layering, symbols, ranking, and project policy. |
| Memory | ADAPT | isair, OpenJarvis, Agent Zero | Scope, explicit persistence, recall gates, provenance, and project isolation need one coherent JARVIS policy. |
| Codex integration | ADAPT | Codexia | Independently implement the App Server adapter in TypeScript behind `CodingAgentProvider`; do not parse terminal prose. |
| Codex event streaming | ADAPT | Codexia, OpenJarvis | Correlated structured notifications and reconnect patterns are proven; JARVIS adds validation/persistence/backpressure. |
| Git worktrees | ADAPT | Codexia | Adopt stable keys, canonical locks, dirty-state preservation; add branch naming, `%LOCALAPPDATA%` layout, and secret-clean prep. |
| Task lifecycle | BUILD | Codexia scheduler, Agent Zero contexts | JARVIS states, verification gates, conversational steering, and deploy/push transitions are unique. |
| Permissions | ADAPT | OpenJarvis, Leon, Agent Zero | Capability/resource checks and isolated executors are strong patterns; JARVIS needs four risk levels and explicit consequential approval. |
| Sandboxing | ADAPT | Agent Zero, OpenJarvis | V1 uses process/worktree/browser boundaries and Windows job controls; optional stronger containers can follow. |
| Windows system control | BUILD | OpenJarvis Windows service, Screenpipe native capture | Implement least-privilege provider adapters for the exact allow-listed actions. |
| Deployment | BUILD | OpenJarvis service adapters only as operational reference | Project-specific proposal, validation, first-use approval, health check, and rollback semantics are unique. |
| Notifications | ADAPT | ethanplusai background UX, Agent Zero/OpenJarvis events | Build on typed durable job events with rate-limited visual/spoken delivery. |
| Multi-agent coordination | ADAPT | Agent Zero, Codexia, rezaulhreza | Use isolated task contexts and explicit parent/child events; cap concurrency and prevent shared checkout writes. |
| Continuous screen/audio context | DEFER | Screenpipe | Not a V1 requirement; needs separate privacy, retention, redaction, storage, and consent work. |
| Wake word | DEFER | Leon, isair | Phase 22 only; prefer local detection after push-to-activate voice is stable. |
| Local model execution | DEFER | OpenJarvis, isair, rezaulhreza | Keep `LlmProvider` abstraction but do not block V1 on local inference. |

## RISKS

| Risk | Impact | Mitigation before/within Phase 0 |
| --- | --- | --- |
| Codex App Server protocol changes | Adapter breakage or lost approval/event state | Pin/test detected Codex version; isolate generated bindings; capability handshake; mock transcript tests. |
| Codexia license inconsistency | Accidental incompatible reuse | No copying; re-check a stable tag/release and all manifests before reconsidering reuse. |
| Prompt injection through web/project content | Consequential host action | Provenance/taint, structured data boundaries, tool allow-list, permission broker, injection tests. |
| Loopback service impersonation or cross-origin access | Local data/control compromise | Launch token, strict origin, localhost bind, port ownership checks, protocol negotiation, no secrets in URLs. |
| Windows native integration fragmentation | Hotkey/audio/display behavior varies | Provider contracts, capability detection, fallback paths, Windows CI and hardware smoke tests. |
| Parallel agent checkout collisions | Lost or mixed edits | One task per worktree, canonical locks, task ownership table, no shared write checkout. |
| Secret leakage into worktrees, logs, diffs, or research | Credential compromise | SecretProvider, redaction at log boundary, no `.env` copying, path classifiers, output scanning. |
| SQLite contention/corruption during event-heavy work | Lost history or blocked UI | Single writer, WAL with measured limits, short transactions, migrations/backups, cancellable reads. |
| Voice responsiveness coupled to jobs | Frozen conversation experience | Durable asynchronous jobs and events; immediate acknowledgement; cancellation independent of audio session. |
| Tool shortlist misses a capability | False refusal | Always expose safe `tool.search`; bounded expansion; selection evaluations and telemetry without sensitive payloads. |
| Deployment inference is overconfident | Production incident | Proposal-only when absent, unresolved fields, dry-run validation, action-bound approval, adapter allow-list. |
| HUD becomes decorative or misleading | Loss of trust | State projection only from validated events; no invented status; stale/disconnected states explicit. |
| Scope expansion before foundations stabilize | Security and test debt | Phase gates remain strict; each phase is committed and reviewed before the next begins. |

## UPDATED IMPLEMENTATION PLAN

Phase 0 should implement only the foundation needed by later audited patterns:

1. Establish the monorepo, strict TypeScript settings, workspace scripts, formatting, tests, and documentation checks.
2. Define runtime-validated protocol envelopes and provider interfaces before service implementations.
3. Create typed configuration with development/test/production state separation and `127.0.0.1` default binding.
4. Create a SQLite migration/repository layer with one mutation owner and redaction-safe structured logging.
5. Create the Node JARVIS Core health service and version/capability handshake.
6. Create the Tauri 2 + React shell as a native host and state renderer, with no orchestration logic.
7. Connect the dashboard to core using authenticated, versioned local HTTP/WebSocket transport.
8. Add Windows and macOS interface folders; implement no product system-control tools yet.
9. Add health, reconnect, shutdown, and smoke tests plus PowerShell developer scripts.
10. Document the exact local process, port, data, log, and recovery model.

Phase 0 must not implement research, voice, Codex, worktrees, permission approvals, browser automation, or deployment behavior ahead of their phases. The architecture may expose interfaces/stubs for them.

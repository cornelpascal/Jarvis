# Event protocol

Status: Phase 19
Last updated: 2026-08-17

JARVIS state crosses process boundaries only through registered, runtime-validated events. The dashboard never parses assistant prose to infer system state.

## Envelope and registry

Every event contains a UUID, global sequence, ISO timestamp, registered namespaced type, source, schema version, payload, and optional session/correlation/causation/task/project identifiers. `packages/protocol/src/events.ts` is the authoritative registry. A new event type is unusable until its payload schema is registered there.

Current types through Phase 8:

| Type                                        | Purpose                                      | Durability           |
| ------------------------------------------- | -------------------------------------------- | -------------------- |
| `jarvis.ready`                              | Core startup and health location             | Durable              |
| `jarvis.state.changed`                      | Authoritative central HUD state              | Durable              |
| `jarvis.test`                               | Deterministic protocol/integration fixtures  | Durable by default   |
| `system.health`                             | Structured core/database health snapshot     | Durable              |
| `system.telemetry`                          | CPU/RAM/disk/network/provider readings       | Transient            |
| `system.action.started/completed/failed`    | Allow-listed Windows action lifecycle        | Durable              |
| `system.capture.started/completed/failed`   | Explicit screenshot lifecycle and metadata   | Durable              |
| `conversation.message.added`                | User-facing conversation projection          | Durable when emitted |
| `conversation.context.captured`             | Ephemeral context registration, never pixels | Durable              |
| `memory.saved/recalled/forgotten`           | Scoped memory lifecycle without content      | Durable              |
| `conversation.route.selected`               | Ranked route/tool shortlist, not permission  | Durable              |
| `project.scan.started`                      | Configured-root scan began                   | Durable              |
| `project.discovered`                        | Candidate and signal evidence found          | Durable              |
| `project.scan.completed`                    | Bounded discovery counts                     | Durable              |
| `project.scan.failed`                       | Registry-level failure                       | Durable              |
| `project.registered`, `project.updated`     | Project-panel projection contracts           | Durable              |
| `project.removed`, `project.selected`       | Registry removal/current selection           | Durable              |
| `project.indexing`, `project.indexed`       | Local index lifecycle and counts             | Durable              |
| `project.search.started`                    | Deterministic retrieval began                | Durable              |
| `project.search.completed`                  | Retrieval result count                       | Durable              |
| `project.search.failed`                     | Structured retrieval failure                 | Durable              |
| `codex.agent.progress`                      | Active-agent projection contract             | Durable when emitted |
| `codex.task.created`, `codex.agent.started` | Coding task/thread lifecycle                 | Durable              |
| `codex.waiting_approval`                    | App Server request needs mediation           | Durable              |
| `codex.diff.ready`                          | Latest structured turn diff                  | Durable              |
| `codex.command.started/completed`           | Evidence-backed project check lifecycle      | Durable              |
| `codex.tests.started/passed/failed`         | Aggregate verification state                 | Durable              |
| `codex.completed`, `codex.failed`           | Visible terminal/review outcome              | Durable              |
| `git.worktree.created`                      | Isolated branch/path/baseline ownership      | Durable              |
| `git.worktree.removed`                      | Safe managed-worktree cleanup                | Durable              |
| `git.commit_requested`, `git.committed`     | Isolated task commit lifecycle               | Durable              |
| `git.push_requested`, `git.pushed/failed`   | Explicit elevated publication lifecycle      | Durable              |
| `deployment.started/completed/failed`       | Typed adapter execution and health outcome   | Durable              |
| `deployment.config_missing/proposed/saved`  | Read-only proposal and reusable config flow  | Durable              |
| `approval.requested`                        | Approval-surface projection contract         | Durable when emitted |
| `approval.approved`, `approval.rejected`    | Auditable policy/user resolution             | Durable              |
| `reference.display.requested`               | Typed Reference Deck mode and items          | Durable when emitted |
| `voice.connected`, `voice.listening`        | Realtime voice connection/readiness          | Transient            |
| `voice.user_speaking`, `voice.processing`   | Input turn lifecycle                         | Transient            |
| `voice.speaking`, `voice.interrupted`       | Output audio/barge-in lifecycle              | Transient            |
| `voice.muted.changed`                       | Explicit microphone mute state               | Transient            |
| `voice.disconnected`, `voice.failed`        | Visible voice termination/failure            | Transient            |
| `research.started`, `research.completed`    | Durable research lifecycle/result summary    | Durable              |
| `research.searching`                        | Active provider progress                     | Transient            |
| `research.source_found`                     | Attributable, web-tainted source             | Durable              |
| `research.failed`                           | Safe provider failure state                  | Durable              |
| `reference.evaluating`                      | Transient visual-policy evaluation start     | Transient            |
| `reference.evaluated`                       | Explainable score/mode/display decision      | Durable              |
| `browser.action.started`                    | Typed browser operation start                | Durable              |
| `browser.action.completed`                  | Safe tab/page result metadata                | Durable              |
| `browser.action.failed`                     | Bounded browser failure                      | Durable              |

Voice lifecycle events are accepted only through the authenticated `/voice/events` command boundary and are revalidated before publication. Input and assistant transcript completions become durable `conversation.message.added` events; high-frequency audio deltas never enter the event bus or SQLite.

Screenshot pixels likewise never enter the event bus or SQLite. `conversation.context.captured` records only bounded attachment metadata; the authenticated capture response carries the ephemeral PNG to its initiating client.

Payloads are strict: unknown fields, unregistered types, invalid identifiers, oversized events, and invalid domain values are rejected before listeners or persistence.

## Delivery

`LocalEventBus` assigns a monotonically increasing sequence and rejects duplicate event IDs within a bounded in-memory window. Durable events are inserted into SQLite before broadcast. Transient events advance a persisted sequence high-water mark but are not replayed.

The event database is append-only through the event API. Replay queries use `sequence > cursor`, ascending order, and a server-enforced maximum of 500 events per batch.

## WebSocket handshake

1. Client authenticates with `jarvis.auth.v1` and the launch-token subprotocol.
2. Server sends `hello` with protocol/schema versions, latest sequence, and replay limit.
3. Client sends exactly one validated `subscribe` with its last sequence.
4. Server sends zero or more replayed `event` messages followed by `replay_complete`.
5. Live `event` messages continue on the same channel.

Malformed/binary/repeated subscriptions close with policy code `1008`. A client that does not subscribe within five seconds is closed. Encoded messages are limited to 256 KiB; consumers exceeding 512 KiB of buffered output are disconnected with `1013` and can reconnect from their last sequence.

The dashboard reconnects with exponential backoff, resumes after its last accepted sequence, ignores duplicate/older events, and continues bounded replay batches until caught up.

## Versioning

- Transport protocol: `1.0.0`
- Event schema: `1`

Version mismatch is a hard subscription failure. Payload-breaking changes require a new event schema version; additive new event types remain registry changes under the current version when existing types are unchanged.

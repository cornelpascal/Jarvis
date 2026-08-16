# Event protocol

Status: Phase 1  
Last updated: 2026-08-17

JARVIS state crosses process boundaries only through registered, runtime-validated events. The dashboard never parses assistant prose to infer system state.

## Envelope and registry

Every event contains a UUID, global sequence, ISO timestamp, registered namespaced type, source, schema version, payload, and optional session/correlation/causation/task/project identifiers. `packages/protocol/src/events.ts` is the authoritative registry. A new event type is unusable until its payload schema is registered there.

Current Phase 1 types:

| Type            | Purpose                                     | Durability         |
| --------------- | ------------------------------------------- | ------------------ |
| `jarvis.ready`  | Core startup and health location            | Durable            |
| `jarvis.test`   | Deterministic protocol/integration fixtures | Durable by default |
| `system.health` | Structured core/database health snapshot    | Durable            |

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

# Scoped memory

Status: Phase 20
Last updated: 2026-08-17

JARVIS stores memory only through the explicit authenticated memory commands. Conversation messages are not automatically promoted into memory.

## Scopes

| Scope       | Lifetime                | Required context | Retrieval boundary                        |
| ----------- | ----------------------- | ---------------- | ----------------------------------------- |
| `EPHEMERAL` | Current Core process    | `sessionId`      | Exact session only; never written to disk |
| `SESSION`   | Persistent until delete | `sessionId`      | Exact session only                        |
| `PROJECT`   | Persistent until delete | `projectId`      | Exact selected project only               |
| `GLOBAL`    | Persistent until delete | none             | User-wide, considered in any context      |

`POST /memory/remember`, `/memory/search`, and `/memory/forget` use strict shared schemas. Search performs bounded deterministic lexical scoring and never widens missing session/project context. The dashboard Memory Center shows inspectable global and selected-project records; session and ephemeral records remain in their conversation boundary.

## Policy

- Creation requires provenance `{ origin: "user", trusted: true }`; web, project, system, and agent data cannot silently become memory.
- Likely credentials, access tokens, passwords, and private keys are rejected before persistence.
- A replacement may supersede only an accessible memory in exactly the same scope.
- Delete is a soft delete for durable scopes and an immediate removal for ephemeral scope.
- Events contain identifiers, scopes, and counts, never memory content.
- Retrieval is capped at 50 results per request and scans at most 500 active durable candidates.

Memory content remains personal data in local SQLite. It is not sent to a model merely because it was retrieved; a conversation provider must explicitly select relevant records within the active scope.

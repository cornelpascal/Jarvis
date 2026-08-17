# Notifications and background work

Status: Phase 21
Last updated: 2026-08-17

Research, coding, verification, Git preparation, and deployment are executed outside the conversational request path where their workflows allow it. `BoundedCodingAgentProvider` enforces the configured `codex.max_concurrent_agents` limit and leaves excess starts queued; a terminal, paused, or cancelled run releases capacity and starts the oldest queued request.

## Durable notification policy

The notification service converts only meaningful terminal events into local notices:

- Codex ready/failure;
- deployment completion/failure;
- research failure.

Each source event can create at most one SQLite record because `event_id` is unique. Notification copy is deliberately generic and does not include raw agent output, command output, web text, or deployment errors. Unread state survives restart and can be acknowledged from the HUD Notification Center.

Notifications are visual by default. The service does not automatically invoke the voice provider, preventing repeated interruptions and accidental spoken disclosure. A later user setting can enable rate-limited spoken summaries through a separate policy boundary.

The authenticated endpoints are `POST /notifications/list` and `POST /notifications/read`; both use the central permission broker. `notification.created` and `notification.read` events update HUD activity without driving side effects.

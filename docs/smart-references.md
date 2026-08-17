# Smart References

Status: Phase 7
Last updated: 2026-08-17

Smart References is a decision after research, not a synonym for research. `SmartReferenceEvaluator` receives the user query, completed answer, source count, and configured threshold (`0.65` by default). It returns a bounded score, explanation, display decision, and preferred mode: `none`, `sources`, `images`, `video`, or `mixed`.

The deterministic baseline raises visual value for physical subjects such as robots, products, hardware, vehicles, places, architecture, art, and maps. Motion/demonstration language increases the value of video. An explicit request to show/watch adds strong evidence. Abstract definitions, basic math, routine coding concepts, version/LTS questions, and recursion lower the score. Settings can raise or lower the threshold without changing evaluator code.

Research publishes its cited answer first. Reference evaluation then runs on a separate promise and emits `reference.evaluating` and `reference.evaluated`. If accepted, Core publishes `reference.display.requested`; the dashboard opens the deck on its configured monitor without blocking the conversation lane. Replayed display events do not reopen windows.

Phase 7's live fallback displays attributable source cards because no independent image/video search credential is configured on this machine. The evaluator still records `images` or `mixed` as the preferred mode. Phase 8 browser pages and future image/video providers plug into this contract; source URLs remain untrusted and never grant tool authority.

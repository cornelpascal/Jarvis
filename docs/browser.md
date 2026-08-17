# Browser Agent

Status: Phase 8
Last updated: 2026-08-17

The Browser Agent is an isolated Playwright-controlled Microsoft Edge/Chromium context. Its persistent profile lives under JARVIS runtime data (`%LOCALAPPDATA%\Jarvis-<environment>\browser`) and never opens the user's normal Chrome/Edge profile.

The authenticated `/browser/action` endpoint accepts only the shared discriminated action schema: `open_url`, `new_tab`, `close_tab`, `back`, `forward`, `reload`, `scroll`, `find_text`, `click`, `extract_page`, and `open_reference`. Results contain bounded page metadata/text. `open_reference` also emits a WEB-mode Reference Deck event.

Only HTTP(S) navigation is allowed. Credential-bearing URLs, loopback, link-local, RFC1918, and local-name targets are denied by default to reduce SSRF exposure; private targets are enabled only in disposable integration fixtures. Page content has no Core command channel, filesystem, shell, Codex, Git, system, or approval capability. Selectors and extracted text remain untrusted data.

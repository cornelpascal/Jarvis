# JARVIS

Windows-first local desktop AI operating layer built with Tauri 2, React, TypeScript, and a local Node.js core.

## Prerequisites

- Windows 10/11
- Node.js 22.12 or newer
- Corepack/pnpm
- Rust stable and WebView2 for the native Tauri window
- Optional external providers are configured through environment variables or the Windows secret provider; never commit `.env`.

## Development

```powershell
corepack enable pnpm
pnpm install
pnpm dev
```

`pnpm dev` generates an in-memory launch token and starts:

- JARVIS Core on `127.0.0.1:43117`
- Dashboard on `127.0.0.1:1420`

For the Tauri window after Rust is installed:

```powershell
pnpm --filter @jarvis/dashboard tauri dev
```

## Checks

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
./scripts/health-check.ps1
```

See [architecture](docs/architecture.md), [security](docs/security.md), and the [implementation plan](docs/implementation-plan.md).

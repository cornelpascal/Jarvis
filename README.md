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

`Alt+Space` reveals the native HUD and starts press-to-activate voice. Realtime voice is optional in development and reads `OPENAI_API_KEY` only in JARVIS Core; without it the HUD reports voice unavailable while all non-voice services continue to run.

Optional local Hey Jarvis wake-word support is installed into a repository-local environment with:

```powershell
.\scripts\install-wake-word.ps1
```

It remains disabled by default; see [local wake word](docs/wake-word.md).

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

## Windows package

Build the tested per-user NSIS installer with:

```powershell
.\scripts\package.ps1
```

The packaged dashboard owns a localhost-only core sidecar and generates a new private connection token on every launch. See [packaging and recovery](docs/packaging.md) for installer output, backups, startup behavior, signing, and clean-VM release gates.

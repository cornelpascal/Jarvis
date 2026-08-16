# Windows development and runtime

Status: Phase 0 foundation  
Last updated: 2026-08-17

## Prerequisites

- Windows 10 or 11 with WebView2
- Node.js 22.12 or newer (Node.js 24 is used by the current development machine)
- pnpm 10.15.1 through Corepack or the user-local npm prefix
- Rust stable and the Microsoft C++ build tools when compiling the native Tauri host

PowerShell execution policy may block generated `pnpm.ps1` shims. `corepack pnpm <command>` and `pnpm.cmd <command>` avoid that ambiguity without weakening execution policy.

## Start

```powershell
corepack pnpm install
corepack pnpm dev
```

The launcher creates a random launch token and starts:

- core health/capabilities/events at `127.0.0.1:43117`;
- Vite dashboard at `127.0.0.1:1420`.

The native shell can be started after Rust/MSVC installation:

```powershell
corepack pnpm --filter @jarvis/dashboard tauri dev
```

## Data and recovery

| Environment | Default directory                   |
| ----------- | ----------------------------------- |
| Development | `%LOCALAPPDATA%\Jarvis-development` |
| Test        | `%LOCALAPPDATA%\Jarvis-test`        |
| Production  | `%LOCALAPPDATA%\Jarvis`             |

The SQLite file is `jarvis.sqlite`. WAL sidecar files can exist while the core is running. Stop JARVIS before making a consistent manual backup. Migrations are transactional and recorded in `schema_migrations`; a migration failure rolls back and prevents startup rather than partially advancing the schema.

Set `JARVIS_DATA_DIR` only when an explicitly isolated data location is needed. External secrets must use environment variables or the future Windows credential provider, never the database.

## Health and checks

```powershell
.\scripts\health-check.ps1
.\scripts\test.ps1
```

`health-check.ps1` fails unless both the core and database report `ok`. Development output is structured JSON. Persistent rotating log files and the developer log viewer arrive with the observability/UI phases.

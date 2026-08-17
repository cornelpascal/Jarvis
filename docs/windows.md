# Windows development and runtime

Status: Implemented through Phase 18
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

Compile and smoke the native host without creating an installer:

```powershell
$env:Path="$env:USERPROFILE\.cargo\bin;$env:Path"
corepack pnpm --filter @jarvis/dashboard tauri build --debug --no-bundle
corepack pnpm smoke:native
```

Display routing is available from **DISPLAYS** in the bottom HUD rail. The selected HUD and Reference Deck monitors persist across restarts. Disconnecting the selected reference monitor moves an existing deck to the remaining valid display; a single-monitor system uses a separate offset window.

## Alt+Space and voice

The native dashboard registers `Alt+Space` when the main WebView mounts. Pressing it restores/focuses the HUD and activates the realtime voice provider. If Windows or another application owns the chord, the HUD reports the conflict and leaves that registration untouched.

Voice requires a server-side key in the environment that starts JARVIS Core:

```powershell
$env:OPENAI_API_KEY="<use your secret provider or current shell>"
corepack pnpm dev
```

Never use a `VITE_` prefix for this key; Vite-prefixed values are renderer-visible. The microphone permission prompt comes from WebView2 on first use. The bottom rail exposes voice activation, mute/unmute, and session termination. Input/output devices are supported by the provider contract and Chromium device APIs; the settings selector is scheduled for the full settings phase.

V1 voice is press-to-activate. Ending the session stops microphone tracks and closes WebRTC. Realtime call creation times out, connection loss retries twice, and missing credentials produce an explicit unavailable state.

## System tools

Core exposes a typed Windows adapter for opening allow-listed Notepad, Calculator, Explorer, and Windows Terminal; opening validated HTTP(S) URLs; opening/revealing validated local paths; and reading running-window/process summaries or system statistics. It never accepts an executable name or shell command from the caller. Process execution uses fixed executable/argument arrays, bounded output/time, hidden windows, and non-interactive mode.

Read operations use permission Level 0. Launch/open/reveal operations use Level 2 and require an exact one-use approval receipt. Administrator actions, generic process termination, volume mutation, and arbitrary window control are not implemented. Display placement remains in the Tauri native host.

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

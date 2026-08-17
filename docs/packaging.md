# Windows packaging and recovery

Status: Phase 23 implemented
Last updated: 2026-08-17

## Release artifact

Run from a Windows x64 development shell with Rust/MSVC available:

```powershell
.\scripts\package.ps1
```

The release gate installs the frozen dependency graph, runs formatting, lint, TypeScript checks and tests, builds a Node single-executable JARVIS Core sidecar, and produces a per-user NSIS installer under:

```text
apps\dashboard\src-tauri\target\release\bundle\nsis\
```

The installer contains the React/Tauri dashboard, core executable, validated default configuration, and isolated Playwright runtime. End users do not need Node.js, pnpm, or Rust. WebView2 is handled by Tauri's Windows installer behavior.

This local development build is unsigned. Production distribution requires an organization-owned Windows code-signing certificate and protected CI secret; no signing credential belongs in the repository.

## Runtime ownership and recovery

The desktop host generates a fresh 256-bit-equivalent session token for every launch, starts one hidden localhost-only core, and gives the token to its WebViews through a private Tauri command. It does not put the token into bundled JavaScript or SQLite. A second dashboard launch focuses the first instance.

The dashboard owns the core child process and terminates it on normal exit. It deliberately does not restart a crashing core in an unbounded loop: the HUD reports disconnection and the user can relaunch the application. Logs and data remain available for diagnosis. This fail-visible policy prevents persistent crash loops.

Start at login is disabled by default. The **STARTUP OFF/ON** control uses the Tauri autostart plugin and changes only the current user's login entry.

## Data, upgrades, and backup

Production state is stored under `%LOCALAPPDATA%\Jarvis`. SQLite migrations are ordered, transactional, and recorded in `schema_migrations`; a failed migration rolls back and aborts core startup. Installer upgrades preserve this directory. Uninstall removes application binaries and login registration but intentionally does not promise deletion of user data.

Before an upgrade that needs a manual recovery point, exit JARVIS and run:

```powershell
.\scripts\backup-data.ps1
```

The script refuses to run while the core listens on port 43117 and copies the full data directory to a timestamped folder under `%LOCALAPPDATA%\Jarvis Backups`. Restore only while JARVIS is stopped. Schema downgrade is not automated.

## Packaged optional features

Research and realtime voice remain degraded-but-functional without `OPENAI_API_KEY`: the core starts and reports provider unavailability. Codex requires a compatible local Codex installation. The local wake-word Python/ONNX environment remains an explicit optional installation and is not included in the base installer; Alt+Space always remains available.

## Release checklist

1. Run `scripts\package.ps1` and `pnpm smoke:sidecar`.
2. Install, launch, toggle startup, upgrade, and uninstall in a clean supported Windows VM.
3. Exercise the V1 research, project, coding/worktree/diff, explicit push-denial/approval, and missing-deployment-config scenarios with test accounts.
4. Verify application reputation and antivirus results after signing.
5. Archive the exact installer, lockfiles, test report, and signing metadata.

Clean-VM, code-signing reputation, microphone hardware, and real production credentials cannot be safely automated from the development checkout and remain release-operator validation gates.

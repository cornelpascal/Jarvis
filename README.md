# Jarvis

Native Windows frontend for Codex with typed and voice input.

> **Security notice:** Jarvis starts Codex with `approvalPolicy: never` and
> `sandbox: danger-full-access`. Codex receives every permission held by the
> Jarvis process. Review the [security policy](SECURITY.md) before using it.

The current native application is a self-contained, unpackaged .NET 10 and
WinUI 3 desktop app under [`native/`](native/). The earlier Tauri implementation
remains in the repository during migration and parity testing.

JARVIS owns the local desktop shell, optional workspace selection, task controls, output, and verification. Codex App Server is the only reasoning and execution backend. General capabilities such as media search, sourced web research, browser checking, and deployment workflows are repository-scoped Codex skills under `.agents/skills` rather than separate JARVIS services.

## Requirements

- Windows 10/11
- Node.js 22.12 or newer
- Corepack/pnpm
- Codex CLI installed and authenticated
- Rust stable and WebView2 for the native Tauri window
- `OPENAI_API_KEY` only when Realtime voice transcription is wanted
- Python with the local openWakeWord runtime when “Hey Jarvis” activation is wanted

For the native WinUI application, only Windows 10/11 and the external Codex CLI
are runtime prerequisites. The published application carries .NET and Windows
App SDK dependencies with it.

## Native WinUI build

```powershell
& 'C:\Program Files\dotnet\dotnet.exe' test .\native\Jarvis.slnx
.\native\publish.ps1
```

The unsigned local build is written to `native/artifacts/win-x64`. Public
release binaries are built on GitHub and submitted to SignPath for Authenticode
signing. See the [code signing policy](docs/code-signing-policy.md).

## Development

```powershell
corepack enable pnpm
pnpm install
.\scripts\install-wake-word.ps1
pnpm dev
```

This starts the localhost-only Core at `127.0.0.1:43117` and the dashboard at `127.0.0.1:1420`. Send a prompt immediately to use the private **JARVIS Anywhere** workspace, or use **ADD** to register any folder when Codex should work there. Git and non-Git folders both run directly in the exact selected folder. Select an existing task to steer it with follow-up prompts.

Say **Hey Jarvis**, press `Alt+Space`, or use the voice button to start transcription. The wake-word detector runs locally. Every spoken command must contain the whole word **Jarvis** or it is ignored and never sent to Codex. The leading “Hey Jarvis” or “Jarvis” address is removed from accepted commands. Realtime produces transcripts only; Codex remains the sole assistant backend. See [the wake-word guide](docs/wake-word.md) for setup and calibration.

For the native window:

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
```

## Security boundary

Core binds only to loopback and requires a launch-scoped token for commands and events. Codex tasks run in YOLO mode with `sandbox: danger-full-access` and `approvalPolicy: never`, inheriting every filesystem, process, and network permission held by the JARVIS Core process. JARVIS does not automatically elevate to Windows Administrator. Keep Core local and do not expose its token or event socket. Voice credentials stay in Core.

## Privacy and license

Jarvis does not provide hosted telemetry. Optional voice transcription sends
microphone audio to OpenAI only while voice input is enabled. Review the full
[privacy policy](docs/privacy.md).

Jarvis is licensed under the [MIT License](LICENSE).

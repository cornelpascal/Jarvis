# JARVIS Native

Windows-only C# and WinUI 3 replacement for the existing React/Tauri client. It
is intentionally developed side-by-side until feature and data parity is
verified.

## Build

```powershell
$env:DOTNET_CLI_HOME = Join-Path $env:TEMP 'jarvis-dotnet-cli'
dotnet restore .\native\Jarvis.slnx
dotnet build .\native\Jarvis.slnx --no-restore
dotnet test .\native\tests\Jarvis.Tests\Jarvis.Tests.csproj --no-build
```

The app is unpackaged and self-contained. Codex CLI must be installed and
authenticated. `OPENAI_API_KEY` remains optional and is used only for voice.

## Publish

```powershell
.\native\publish.ps1
```

The output under `native\artifacts\win-x64` includes the Windows App SDK,
Win2D, ONNX Runtime, SQLite, and wake-word model assets. It does not require
Node.js, Rust, Python, or WebView2. Codex CLI remains external.

The bundled openWakeWord classifier is CC BY-NC-SA 4.0; review
`Assets\WakeWord\MODEL_LICENSE.md` before commercial distribution.

# Local wake word

Status: Phase 22
Last updated: 2026-08-17

Wake-word support is optional, disabled by default, and entirely local. The adapter uses the Apache-2.0 openWakeWord engine with its `hey_jarvis` ONNX model. The engine consumes 16 kHz, 16-bit mono microphone frames locally and emits only bounded `ready`, `detected`, or `error` JSON messages to JARVIS Core. Audio samples never cross the sidecar boundary and are never sent to OpenAI or another network service.

## Installation

From PowerShell:

```powershell
.\scripts\install-wake-word.ps1
```

The script creates `.tooling\wake-word`, installs pinned direct dependencies, downloads the official Hey Jarvis model, and verifies ONNX model loading. It does not modify system Python. The generated environment is ignored by Git; packaged builds need to include an equivalent reviewed runtime.

## Operation

Configuration defaults:

```yaml
wake_word:
  enabled: false
  engine: openwakeword
  phrase: "hey jarvis"
  threshold: 0.5
  cooldown_ms: 3000
```

The HUD **WAKE** control calls the authenticated, permission-mediated `/wake-word/control` endpoint. Starting the provider opens the default microphone in the local sidecar. A threshold-qualified detection emits `voice.activation.requested`, which reveals the dashboard and starts the normal realtime conversation. Stopping it terminates the sidecar. `Alt+Space` remains available regardless of provider health.

The parser rejects malformed/oversized messages, unexpected phrases, invalid scores, sub-threshold detections, and repeated detections inside the cooldown. The process uses a fixed repository-owned script and project-local Python executable; it receives no API keys or JARVIS command capability.

## Limitations

Only English “Hey Jarvis” is configured. Accuracy varies with microphones, speakers, accents, background audio, and acoustic echo; sensitivity should be tuned on the target machine. Device selection follows the local audio runtime's default input in this phase. No microphone hardware smoke was run automatically because enabling continuous listening requires explicit user action.

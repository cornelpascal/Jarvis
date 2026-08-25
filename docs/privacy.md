# Privacy policy

Jarvis is a local desktop application. The project does not operate a Jarvis
telemetry, analytics, advertising, or user-account service.

## Data sent at the user's request

- Typed prompts, workspace context selected by the user, and Codex task events
  are processed by the separately installed Codex CLI under the user's Codex
  configuration and applicable OpenAI terms.
- When voice input is enabled, microphone audio is streamed directly to the
  OpenAI Realtime API for transcription. Audio capture stops when the user
  disables voice input or exits Jarvis. Jarvis does not intentionally persist
  raw microphone audio.
- Terminal commands and Codex actions may contact services chosen by the user
  or required by the selected project and its dependencies.

## Local data

Jarvis stores configuration, task state, and event history under
`%LOCALAPPDATA%\Jarvis`. The OpenAI API key is read from the process environment
or a local ignored `.env` file and is not written to the Jarvis database or
application logs.

Users control deletion of local Jarvis data and any data held by external
services. Refer to those services' privacy policies for their retention and
deletion practices.

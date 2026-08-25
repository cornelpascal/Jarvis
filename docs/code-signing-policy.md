# Code signing policy

Free code signing is provided by SignPath.io; the certificate is provided by
SignPath Foundation.

## Source and builds

- Source repository: <https://github.com/cornelpascal/Jarvis>
- Windows release artifacts are built only by the repository's GitHub-hosted
  Actions workflow from a tagged commit.
- The unsigned GitHub artifact is submitted directly to SignPath. Locally built
  binaries are never submitted for release signing.
- SignPath signs only Jarvis-owned PE files. Bundled third-party binaries retain
  their upstream signatures and are not re-signed as Jarvis.
- Every release-signing request requires manual approval in SignPath.

## Roles

- Committer and reviewer: [cornelpascal](https://github.com/cornelpascal)
- Signing approver: [cornelpascal](https://github.com/cornelpascal)

All project members with repository or signing access must use multi-factor
authentication.

## Privacy

See the [Jarvis privacy policy](privacy.md). Jarvis does not transfer data to a
project-operated service. Network transfers to OpenAI or other user-selected
services occur only for features the user invokes.

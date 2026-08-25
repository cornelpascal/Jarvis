# Security policy

## Supported versions

Jarvis is pre-release software. Security fixes are made on the latest `main`
branch and included in the next release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
security advisory flow for `cornelpascal/Jarvis`. Include affected versions,
reproduction steps, impact, and any proposed mitigation. Please allow a
reasonable period for investigation before public disclosure.

## Execution boundary

Jarvis deliberately starts Codex with `approvalPolicy: never` and
`sandbox: danger-full-access`. Codex children inherit the Windows security token
of Jarvis, but Jarvis does not request UAC elevation. A compromised prompt,
plugin, dependency, or workspace may therefore read, change, execute, or delete
anything available to the current Windows account.

Run Jarvis as a standard user, keep backups, review configured plugins and
skills, and never expose its local control channels to other machines.

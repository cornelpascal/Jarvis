$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
corepack enable pnpm
corepack pnpm install --frozen-lockfile

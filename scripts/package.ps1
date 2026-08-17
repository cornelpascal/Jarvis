$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

function Assert-NativeSuccess([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE." }
}

corepack pnpm install --frozen-lockfile
Assert-NativeSuccess "Dependency installation"
corepack pnpm format:check
Assert-NativeSuccess "Formatting check"
corepack pnpm lint
Assert-NativeSuccess "Lint"
corepack pnpm typecheck
Assert-NativeSuccess "Type checking"
corepack pnpm test
Assert-NativeSuccess "Tests"
corepack pnpm build:sidecar
Assert-NativeSuccess "Core sidecar build"
corepack pnpm --filter @jarvis/dashboard tauri build
Assert-NativeSuccess "Tauri release build"
corepack pnpm smoke:native -- --release
Assert-NativeSuccess "Packaged release smoke"

$installer = Get-ChildItem -Path "apps\dashboard\src-tauri\target\release\bundle\nsis" -Filter "*-setup.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $installer) { throw "NSIS installer was not produced." }
Write-Output $installer.FullName

param(
  [string]$SourceDirectory = (Join-Path $env:LOCALAPPDATA "Jarvis"),
  [string]$DestinationRoot = (Join-Path $env:LOCALAPPDATA "Jarvis Backups")
)

$ErrorActionPreference = "Stop"

$listener = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 43117 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  throw "JARVIS is running. Exit the dashboard before creating a migration-safe backup."
}

if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) {
  throw "JARVIS data directory does not exist: $SourceDirectory"
}

$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
$destinationRootResolved = (Resolve-Path -LiteralPath $DestinationRoot).Path
if ($destinationRootResolved.StartsWith($source, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Backup destination must be outside the JARVIS data directory."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$destination = Join-Path $destinationRootResolved "Jarvis-$stamp"
Copy-Item -LiteralPath $source -Destination $destination -Recurse
Write-Output $destination

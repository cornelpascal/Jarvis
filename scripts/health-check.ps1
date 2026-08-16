$ErrorActionPreference = "Stop"
$port = if ($env:JARVIS_PORT) { $env:JARVIS_PORT } else { "43117" }
$health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5
if ($health.status -ne "ok" -or $health.database -ne "ok") {
  throw "JARVIS Core is not healthy: $($health | ConvertTo-Json -Compress)"
}
$health | ConvertTo-Json -Depth 4

param(
    [ValidateSet("x64")]
    [string] $Architecture = "x64",
    [string] $Output = (Join-Path $PSScriptRoot "artifacts\win-$Architecture")
)

$ErrorActionPreference = "Stop"
$dotnet = (Get-Command dotnet -ErrorAction SilentlyContinue).Source
if (-not $dotnet) { $dotnet = "C:\Program Files\dotnet\dotnet.exe" }
$env:DOTNET_CLI_HOME = Join-Path $env:TEMP "jarvis-dotnet-cli"

& $dotnet publish (Join-Path $PSScriptRoot "src\Jarvis.App\Jarvis.App.csproj") `
    --configuration Release `
    --runtime "win-$Architecture" `
    --self-contained true `
    --output $Output

if ($LASTEXITCODE -ne 0) { throw "Jarvis native publish failed with exit code $LASTEXITCODE" }
Write-Host "Published self-contained Jarvis to $Output"

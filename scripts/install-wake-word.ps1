$ErrorActionPreference = "Stop"
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$environmentRoot = Join-Path $repositoryRoot ".tooling\wake-word"
$python = Join-Path $environmentRoot "Scripts\python.exe"
$requirements = Join-Path $repositoryRoot "services\voice\python\requirements-wake-word.txt"

if (-not (Test-Path -LiteralPath $python)) {
  python -m venv $environmentRoot
}

& $python -m pip install --disable-pip-version-check --requirement $requirements
& $python -c "from openwakeword.utils import download_models; download_models(['hey_jarvis'])"
& $python -c "from openwakeword.model import Model; import sounddevice, numpy; Model(wakeword_models=['hey_jarvis'], inference_framework='onnx'); print('Local wake-word runtime ready')"

# Start the Sermon Cut backend (FastAPI) on Windows (PowerShell).
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ScriptDir "..\backend" | Resolve-Path
$VenvDir = Join-Path $BackendDir ".venv"

Set-Location $BackendDir

if (-not (Test-Path $VenvDir)) {
    Write-Host "Creating virtual environment..."
    python -m venv $VenvDir
}

& (Join-Path $VenvDir "Scripts\Activate.ps1")

Write-Host "Installing backend dependencies..."
pip install --upgrade pip | Out-Null
pip install -e ".[dev]"

Write-Host "Starting FastAPI on http://127.0.0.1:8000 ..."
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

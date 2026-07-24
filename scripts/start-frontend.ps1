# Start the Sermon Cut frontend (Vite dev server) on Windows (PowerShell).
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $ScriptDir "..\frontend" | Resolve-Path

Set-Location $FrontendDir

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing frontend dependencies..."
    npm install
}

Write-Host "Starting Vite on http://localhost:5173 ..."
npm run dev

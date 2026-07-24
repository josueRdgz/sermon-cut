# Start Sermon Cut frontend on Windows.
$ErrorActionPreference = "Stop"

$FrontendDir = Resolve-Path (Join-Path $PSScriptRoot "..\frontend")
Set-Location $FrontendDir

if (-not (Test-Path "node_modules")) {
    Write-Host "Instalando dependencias del frontend…"
    npm install
}

Write-Host "Iniciando Vite en http://localhost:5173 …"
npm run dev

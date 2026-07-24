# Sermon Cut / Sermon Clips — reproducible setup for Windows (no Docker).
# Run in PowerShell:  Set-ExecutionPolicy -Scope Process Bypass; .\scripts\setup-windows.ps1

$ErrorActionPreference = "Stop"

function Write-Fail([string]$Message) {
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Write-Ok([string]$Message) {
    Write-Host "OK: $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "AVISO: $Message" -ForegroundColor Yellow
}

function Require-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Fail "No se encontró '$Name' en el PATH. $Hint"
    }
}

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$VenvDir = Join-Path $BackendDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvActivate = Join-Path $VenvDir "Scripts\Activate.ps1"

Write-Host "==> Sermon Cut — setup Windows"
Write-Host "    Repo: $RootDir"

Require-Command "python" "Instala Python 3.12+ desde https://www.python.org/downloads/ (marca 'Add to PATH')."
Require-Command "node" "Instala Node.js 18+ desde https://nodejs.org/"
Require-Command "npm" "npm se instala con Node.js."
Require-Command "ffmpeg" "winget install Gyan.FFmpeg   o   choco install ffmpeg"
Require-Command "ffprobe" "Forma parte de FFmpeg (mismo instalador)."

$pyCheck = & python -c "import sys; print('%d.%d' % sys.version_info[:2]); raise SystemExit(0 if sys.version_info >= (3, 12) else 1)"
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Se requiere Python >= 3.12 (encontrado $pyCheck)."
}
Write-Ok "Python $(python --version)"
Write-Ok "Node $(node -v) / npm $(npm -v)"
Write-Ok "FFmpeg $((ffmpeg -version 2>&1 | Select-Object -First 1))"
Write-Ok "FFprobe $((ffprobe -version 2>&1 | Select-Object -First 1))"

$EnvFile = Join-Path $RootDir ".env"
$EnvExample = Join-Path $RootDir ".env.example"
if (-not (Test-Path $EnvFile)) {
    Copy-Item $EnvExample $EnvFile
    Write-Ok "Creado .env desde .env.example"
} else {
    Write-Ok ".env ya existe (no se sobrescribe)"
}

@(
    "storage\projects",
    "storage\temp",
    "storage\exports",
    "storage\whisper-models"
) | ForEach-Object {
    New-Item -ItemType Directory -Force -Path (Join-Path $RootDir $_) | Out-Null
}
Write-Ok "Carpetas de almacenamiento listas"

Write-Host "==> Backend (venv + pip)"
Set-Location $BackendDir
if (-not (Test-Path $VenvPython)) {
    python -m venv $VenvDir
}
& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -e ".[dev]"
Write-Ok "Dependencias backend instaladas"

Write-Host "==> Migraciones"
& $VenvPython -m app.cli migrate
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Migración falló. Reintenta: cd backend; .\.venv\Scripts\python.exe -m app.cli migrate"
} else {
    Write-Ok "Migraciones aplicadas"
}

Write-Host "==> Frontend (npm)"
Set-Location $FrontendDir
npm install
Write-Ok "Dependencias frontend instaladas"

Write-Host "==> Diagnóstico"
Set-Location $BackendDir
& $VenvPython -m app.cli doctor
if ($LASTEXITCODE -ne 0) {
    Write-Warn "El diagnóstico reportó problemas (revisa arriba)."
}

Write-Host ""
Write-Host "Setup Windows completado." -ForegroundColor Green
Write-Host "  Terminal 1: .\scripts\start-backend.ps1"
Write-Host "  Terminal 2: .\scripts\start-frontend.ps1"
Write-Host "  Abre: http://localhost:5173"

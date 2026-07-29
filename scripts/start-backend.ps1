# Start Sermon Cut backend on Windows.
$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendDir = Join-Path $RootDir "backend"
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    Write-Host "No hay entorno virtual. Ejecuta primero: .\scripts\setup-windows.ps1" -ForegroundColor Red
    exit 1
}

Set-Location $BackendDir

$EnvFile = Join-Path $RootDir ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
        $pair = $_.Split('=', 2)
        if ($pair.Length -eq 2) {
            $name = $pair[0].Trim()
            $value = $pair[1].Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

Write-Host "Aplicando migraciones…"
& $VenvPython -m app.cli migrate
if ($LASTEXITCODE -ne 0) {
    Write-Host "AVISO: migración falló; el servidor arrancará igual." -ForegroundColor Yellow
}

$UvicornArgs = @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000")
$ReloadEnabled = [string]::Equals(
    $env:SERMON_CUT_RELOAD,
    "true",
    [System.StringComparison]::OrdinalIgnoreCase
)
if ($ReloadEnabled) {
    # Keep .venv outside the watcher. Installing faster-whisper while uvicorn
    # watches all of backend/ otherwise restarts active in-process jobs.
    $UvicornArgs += @("--reload", "--reload-dir", "app")
    Write-Host "Iniciando FastAPI con autoreload limitado a backend/app/ …"
} else {
    Write-Host "Iniciando FastAPI en http://127.0.0.1:8000 (sin autoreload) …"
}
& $VenvPython @UvicornArgs

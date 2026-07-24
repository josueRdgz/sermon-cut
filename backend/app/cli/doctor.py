"""Environment diagnostics for local Sermon Cut installs."""

from __future__ import annotations

import json
import platform
import shutil
import sqlite3
import subprocess
import sys
from dataclasses import asdict, dataclass
from importlib import metadata
from pathlib import Path

from app.core.config import get_settings
from app.core.paths import (
    BACKEND_DIR,
    DATABASE_FILE,
    EXPORTS_DIR,
    PROJECTS_DIR,
    ROOT_DIR,
    STORAGE_DIR,
    TEMP_DIR,
    WHISPER_CACHE_DIR,
    configure_paths,
    ensure_storage_dirs,
)


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str
    hint: str | None = None


def _version_of(cmd: str) -> str | None:
    exe = shutil.which(cmd)
    if exe is None:
        return None
    try:
        result = subprocess.run(
            [exe, "-version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        line = (result.stdout or result.stderr or "").splitlines()
        return line[0].strip() if line else exe
    except (OSError, subprocess.TimeoutExpired):
        return exe


def _disk_free_gb(path: Path) -> float | None:
    try:
        usage = shutil.disk_usage(path if path.exists() else path.parent)
        return round(usage.free / (1024**3), 2)
    except OSError:
        return None


def _writable(path: Path) -> tuple[bool, str]:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".sermon-cut-write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True, f"Escritura OK en {path}"
    except OSError as exc:
        return False, f"Sin permiso de escritura en {path}: {exc}"


def _pkg_version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def collect_checks() -> list[CheckResult]:
    settings = get_settings()
    if settings.storage_dir:
        configure_paths(settings.storage_dir)
    ensure_storage_dirs()

    checks: list[CheckResult] = []

    # ---- Versions ----
    py = sys.version.split()[0]
    checks.append(
        CheckResult(
            name="python",
            ok=sys.version_info >= (3, 12),
            detail=f"Python {py} ({platform.platform()})",
            hint=None
            if sys.version_info >= (3, 12)
            else "Se requiere Python 3.12+. Instálalo desde python.org o el gestor de tu OS.",
        )
    )

    node = shutil.which("node")
    node_ver = None
    if node:
        try:
            node_ver = subprocess.check_output(
                [node, "-v"], text=True, timeout=10
            ).strip()
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            node_ver = "desconocida"
    checks.append(
        CheckResult(
            name="node",
            ok=node is not None,
            detail=f"Node {node_ver}" if node else "Node.js no encontrado en PATH",
            hint=(
                None
                if node
                else (
                    "Instala Node.js 18+ (https://nodejs.org) "
                    "o: brew install node / apt install nodejs npm"
                )
            ),
        )
    )

    npm = shutil.which("npm")
    npm_ver = None
    if npm:
        try:
            npm_ver = subprocess.check_output([npm, "-v"], text=True, timeout=10).strip()
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            npm_ver = "desconocida"
    checks.append(
        CheckResult(
            name="npm",
            ok=npm is not None,
            detail=f"npm {npm_ver}" if npm else "npm no encontrado en PATH",
            hint=None if npm else "npm suele instalarse junto con Node.js.",
        )
    )

    ffmpeg_line = _version_of("ffmpeg")
    checks.append(
        CheckResult(
            name="ffmpeg",
            ok=ffmpeg_line is not None,
            detail=ffmpeg_line or "FFmpeg no encontrado en PATH",
            hint=None
            if ffmpeg_line
            else {
                "Darwin": "brew install ffmpeg",
                "Windows": "winget install Gyan.FFmpeg  o  choco install ffmpeg",
                "Linux": "sudo apt install ffmpeg  /  sudo dnf install ffmpeg",
            }.get(platform.system(), "Instala FFmpeg y asegúrate de que esté en el PATH."),
        )
    )

    ffprobe_line = _version_of("ffprobe")
    checks.append(
        CheckResult(
            name="ffprobe",
            ok=ffprobe_line is not None,
            detail=ffprobe_line or "FFprobe no encontrado en PATH",
            hint=None
            if ffprobe_line
            else "FFprobe se instala con FFmpeg. Vuelve a instalar el paquete completo.",
        )
    )

    # ---- Storage permissions ----
    for label, path in (
        ("storage", STORAGE_DIR),
        ("projects", PROJECTS_DIR),
        ("temp", TEMP_DIR),
        ("exports", EXPORTS_DIR),
        ("whisper-cache", WHISPER_CACHE_DIR),
    ):
        ok, detail = _writable(path)
        checks.append(
            CheckResult(
                name=f"permissions:{label}",
                ok=ok,
                detail=detail,
                hint=None if ok else f"Revisa permisos de usuario sobre {path}",
            )
        )

    # ---- SQLite ----
    try:
        DATABASE_FILE.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DATABASE_FILE))
        conn.execute("CREATE TABLE IF NOT EXISTS _doctor_ping (id INTEGER PRIMARY KEY)")
        conn.execute("INSERT INTO _doctor_ping DEFAULT VALUES")
        conn.execute("DROP TABLE _doctor_ping")
        conn.commit()
        conn.close()
        checks.append(
            CheckResult(
                name="sqlite",
                ok=True,
                detail=f"SQLite OK → {DATABASE_FILE}",
            )
        )
    except sqlite3.Error as exc:
        checks.append(
            CheckResult(
                name="sqlite",
                ok=False,
                detail=f"No se pudo usar SQLite en {DATABASE_FILE}: {exc}",
                hint="Comprueba SERMON_CUT_STORAGE_DIR / SERMON_CUT_DATABASE_URL y permisos.",
            )
        )

    # ---- Free disk ----
    free = _disk_free_gb(STORAGE_DIR)
    if free is None:
        checks.append(
            CheckResult(
                name="disk_space",
                ok=False,
                detail="No se pudo medir el espacio libre",
            )
        )
    else:
        checks.append(
            CheckResult(
                name="disk_space",
                ok=free >= 2.0,
                detail=f"{free} GiB libres en el volumen de {STORAGE_DIR}",
                hint=None
                if free >= 2.0
                else "Se recomiendan al menos ~2 GiB libres para video, renders y modelos Whisper.",
            )
        )

    # ---- Gemini ----
    key = settings.gemini_api_key
    provider = settings.ai_provider
    if provider == "mock":
        checks.append(
            CheckResult(
                name="gemini",
                ok=True,
                detail="Proveedor AI = mock (sin clave; análisis offline).",
            )
        )
    elif key:
        checks.append(
            CheckResult(
                name="gemini",
                ok=True,
                detail=(
                    f"Clave Gemini presente (oculta). Modelo={settings.gemini_model}, "
                    f"provider={provider}."
                ),
                hint=None
                if _pkg_version("google-genai")
                else 'Instala el extra: pip install -e ".[gemini]"',
            )
        )
    else:
        checks.append(
            CheckResult(
                name="gemini",
                ok=True,
                detail=(
                    "Sin SERMON_CUT_GEMINI_API_KEY — el análisis usará el mock. "
                    "Opcional; la app funciona sin Gemini."
                ),
            )
        )

    # ---- Whisper ----
    whisper_ver = _pkg_version("faster-whisper")
    # Optional extras — missing package is informational, not a hard failure.
    if whisper_ver:
        checks.append(
            CheckResult(
                name="whisper_package",
                ok=True,
                detail=(
                    f"faster-whisper {whisper_ver} "
                    f"(modelo configurado: {settings.whisper_model})"
                ),
                hint=(
                    f"Los pesos se descargan bajo demanda (caché: {WHISPER_CACHE_DIR} "
                    "o el caché de Hugging Face). No se suben a Git."
                ),
            )
        )
    else:
        checks.append(
            CheckResult(
                name="whisper_package",
                ok=True,
                detail="faster-whisper no instalado (opcional)",
                hint='Para transcripción local: pip install -e ".[whisper]"',
            )
        )

    # ---- Backend package ----
    checks.append(
        CheckResult(
            name="backend_path",
            ok=BACKEND_DIR.is_dir(),
            detail=f"Backend en {BACKEND_DIR}; repo {ROOT_DIR}",
        )
    )

    env_path = ROOT_DIR / ".env"
    checks.append(
        CheckResult(
            name="dotenv",
            ok=True,
            detail=(
                f".env presente en {env_path}"
                if env_path.is_file()
                else "Sin .env — se usan valores por defecto / .env.example"
            ),
            hint=None if env_path.is_file() else "Copia .env.example a .env y ajústalo.",
        )
    )

    return checks


def run_doctor(*, as_json: bool = False) -> int:
    checks = collect_checks()
    failed = [c for c in checks if not c.ok]

    if as_json:
        print(json.dumps([asdict(c) for c in checks], ensure_ascii=False, indent=2))
    else:
        print("Sermon Cut — diagnóstico local")
        print("=" * 40)
        for check in checks:
            mark = "OK" if check.ok else "FAIL"
            print(f"[{mark}] {check.name}: {check.detail}")
            if check.hint:
                print(f"       → {check.hint}")
        print("=" * 40)
        if failed:
            print(f"{len(failed)} comprobación(es) fallaron.")
            print("Corrige los FAIL y vuelve a ejecutar: python -m app.cli doctor")
        else:
            print("Todo listo para uso local.")

    # Gemini/whisper optional failures shouldn't fail the doctor exit for whisper
    # when marked ok=False for missing optional package — user asked to check
    # availability; exit non-zero only for hard requirements.
    hard = {"python", "ffmpeg", "ffprobe", "sqlite", "permissions:storage", "disk_space"}
    hard_fails = [c for c in failed if c.name in hard or c.name.startswith("permissions:")]
    return 1 if hard_fails else 0

"""Safe Alembic upgrades for local startup."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def _backend_dir() -> Path:
    """Directory that contains ``alembic.ini`` (repo backend/ or PyInstaller _MEIPASS)."""
    meipass = getattr(sys, "_MEIPASS", None)
    if getattr(sys, "frozen", False) and meipass:
        return Path(meipass)
    return Path(__file__).resolve().parents[2]


def run_migrations(*, raise_on_error: bool = False) -> bool:
    """Apply pending migrations (``alembic upgrade head``).

    Returns ``True`` on success. On failure logs a clear message and returns
    ``False`` unless ``raise_on_error`` is set — so a broken migration never
    silently bricks the API process during normal ``uvicorn`` startup.
    """
    try:
        from app.core.config import get_settings
        from app.core.paths import configure_paths, ensure_storage_dirs

        settings = get_settings()
        if settings.storage_dir:
            configure_paths(settings.storage_dir)
        ensure_storage_dirs()
    except Exception as exc:  # noqa: BLE001
        logger.warning("No se pudo preparar el almacenamiento antes de migrar: %s", exc)

    try:
        from alembic import command
        from alembic.config import Config
        from alembic.script import ScriptDirectory
    except ImportError as exc:
        message = (
            "Alembic no está instalado. Ejecuta: "
            'pip install -e ".[dev]" dentro de backend/'
        )
        logger.error(message)
        if raise_on_error:
            raise RuntimeError(message) from exc
        return False

    backend_dir = _backend_dir()
    ini_path = backend_dir / "alembic.ini"
    if not ini_path.is_file():
        message = f"No se encontró alembic.ini en {ini_path}"
        logger.error(message)
        if raise_on_error:
            raise RuntimeError(message)
        return False

    try:
        config = Config(str(ini_path))
        # Ensure imports resolve the same way as ``cd backend && alembic …``.
        config.set_main_option("script_location", str(backend_dir / "alembic"))
        heads = ScriptDirectory.from_config(config).get_heads()
        if len(heads) != 1:
            raise RuntimeError(
                "Hay varias cabezas Alembic "
                f"({', '.join(heads)}). Lineariza las revisiones antes de migrar."
            )
        command.upgrade(config, "head")
        logger.info("Migraciones de base de datos aplicadas (alembic upgrade head).")
        return True
    except Exception as exc:  # noqa: BLE001 — startup must stay resilient
        message = (
            f"Falló la migración automática de la base de datos: {exc}. "
            "La API arrancará igualmente, pero puede haber tablas desactualizadas. "
            "Corrige el error y ejecuta: cd backend && alembic upgrade head"
        )
        logger.error(message)
        if raise_on_error:
            raise RuntimeError(message) from exc
        return False

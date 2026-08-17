"""Alembic history must stay linear so desktop auto-migrate can run."""

from __future__ import annotations

import sqlite3

from alembic.config import Config
from alembic.script import ScriptDirectory
from app.core.config import clear_settings_cache
from app.core.migrate import run_migrations
from app.core.paths import BACKEND_DIR, configure_paths


def test_alembic_history_has_a_single_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    heads = ScriptDirectory.from_config(config).get_heads()
    assert len(heads) == 1, f"branched alembic history: {heads}"


def test_run_migrations_adds_source_kind(tmp_path, monkeypatch) -> None:
    db_file = tmp_path / "sermon_cut.db"
    monkeypatch.setenv("SERMON_CUT_STORAGE_DIR", str(tmp_path))
    monkeypatch.setenv("SERMON_CUT_DATABASE_URL", f"sqlite:///{db_file.as_posix()}")
    monkeypatch.setenv("SERMON_CUT_AUTO_MIGRATE", "true")
    clear_settings_cache()
    configure_paths(tmp_path)

    assert run_migrations(raise_on_error=True) is True

    conn = sqlite3.connect(db_file)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(projects)")}
    version = conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    conn.close()
    assert "source_kind" in columns
    assert version == "b8c9d0e1f2a3"
    clear_settings_cache()

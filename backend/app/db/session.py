"""Database engine and session factory."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_settings = get_settings()

# check_same_thread is required for SQLite when used across threads (FastAPI).
_connect_args = (
    {"check_same_thread": False} if _settings.database_url.startswith("sqlite") else {}
)

engine = create_engine(_settings.database_url, connect_args=_connect_args, future=True)


@event.listens_for(Engine, "connect")
def _sqlite_on_connect(dbapi_connection: object, connection_record: object) -> None:
    """Enable FK cascades and safer concurrency for SQLite connections."""
    dialect = getattr(connection_record, "dialect", None)
    if dialect is None or getattr(dialect, "name", None) != "sqlite":
        return
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
    finally:
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def foreign_keys_enabled(session: Session) -> bool:
    """Return True when SQLite enforces foreign keys (for tests/diagnostics)."""
    if not str(session.get_bind().url).startswith("sqlite"):
        return True
    row = session.execute(text("PRAGMA foreign_keys")).scalar()
    return bool(row)

"""Declarative base for SQLAlchemy 2 models."""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class shared by every ORM model."""


# Import models here so Alembic's autogenerate can discover their metadata.
# (No models exist yet; this block is the single registration point.)

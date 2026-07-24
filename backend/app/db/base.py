"""Declarative base for SQLAlchemy 2 models."""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class shared by every ORM model."""

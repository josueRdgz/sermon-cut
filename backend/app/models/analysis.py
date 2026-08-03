"""ORM models for optional AI analysis jobs and Reel candidates."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class AnalysisJobStatus(enum.StrEnum):
    queued = "queued"
    running = "running"
    cancelling = "cancelling"
    cancelled = "cancelled"
    completed = "completed"
    failed = "failed"


ACTIVE_ANALYSIS_STATUSES: frozenset[AnalysisJobStatus] = frozenset(
    {
        AnalysisJobStatus.queued,
        AnalysisJobStatus.running,
        AnalysisJobStatus.cancelling,
    }
)


class AnalysisCandidateStatus(enum.StrEnum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"


class AnalysisJob(Base):
    """Persisted state of an AI clip-analysis task."""

    __tablename__ = "analysis_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    status: Mapped[AnalysisJobStatus] = mapped_column(
        Enum(AnalysisJobStatus, name="analysis_job_status", native_enum=False, length=32),
        nullable=False,
        default=AnalysisJobStatus.queued,
        index=True,
    )
    stage: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="mock")

    max_reels: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    min_duration_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=20.0)
    max_duration_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=60.0)
    additional_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    doctrinal_orientation: Mapped[str | None] = mapped_column(String(500), nullable=True)

    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chunks_completed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    rejected_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notice: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    candidates: Mapped[list[AnalysisCandidate]] = relationship(
        "AnalysisCandidate",
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="AnalysisCandidate.rank",
    )


class AnalysisCandidate(Base):
    """A suggested Reel awaiting explicit user approval.

    Never rendered automatically: the user must accept or reject each one.
    """

    __tablename__ = "analysis_candidates"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    rank: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[AnalysisCandidateStatus] = mapped_column(
        Enum(
            AnalysisCandidateStatus,
            name="analysis_candidate_status",
            native_enum=False,
            length=16,
        ),
        nullable=False,
        default=AnalysisCandidateStatus.pending,
        index=True,
    )

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    hook: Mapped[str | None] = mapped_column(String(500), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    editorial_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    joined_script: Mapped[str | None] = mapped_column(Text, nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    hashtags_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggested_titles_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_text: Mapped[str | None] = mapped_column(String(120), nullable=True)
    keywords_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    segments_json: Mapped[str] = mapped_column(Text, nullable=False)
    warnings_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    removed_context_warning: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Set when the user accepts the candidate and a Reel is created.
    accepted_reel_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("reels.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )

    job: Mapped[AnalysisJob] = relationship("AnalysisJob", back_populates="candidates")

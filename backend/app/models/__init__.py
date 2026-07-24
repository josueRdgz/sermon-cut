"""ORM models.

Import every model here so Alembic autogenerate and ``Base.metadata`` stay in sync.
"""

from app.models.project import Project, ProjectStatus
from app.models.transcript import (
    Transcript,
    TranscriptSegment,
    TranscriptSource,
    TranscriptStatus,
    TranscriptWord,
)
from app.models.transcription_job import TranscriptionJob, TranscriptionJobStatus

__all__ = [
    "Project",
    "ProjectStatus",
    "Transcript",
    "TranscriptSegment",
    "TranscriptSource",
    "TranscriptStatus",
    "TranscriptWord",
    "TranscriptionJob",
    "TranscriptionJobStatus",
]

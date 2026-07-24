"""ORM models.

Import every model here so Alembic autogenerate and ``Base.metadata`` stay in sync.
"""

from app.models.project import Project, ProjectStatus
from app.models.reel import (
    AspectRatio,
    Reel,
    ReelSegment,
    ReelStatus,
    SubtitleStyle,
    TransitionType,
)
from app.models.transcript import (
    Transcript,
    TranscriptSegment,
    TranscriptSource,
    TranscriptStatus,
    TranscriptWord,
)
from app.models.transcription_job import TranscriptionJob, TranscriptionJobStatus

__all__ = [
    "AspectRatio",
    "Project",
    "ProjectStatus",
    "Reel",
    "ReelSegment",
    "ReelStatus",
    "SubtitleStyle",
    "Transcript",
    "TranscriptSegment",
    "TranscriptSource",
    "TranscriptStatus",
    "TranscriptWord",
    "TranscriptionJob",
    "TranscriptionJobStatus",
    "TransitionType",
]

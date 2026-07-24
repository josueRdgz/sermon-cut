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
from app.models.render_job import RenderJob, RenderJobStatus
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
    "RenderJob",
    "RenderJobStatus",
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

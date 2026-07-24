"""ORM models.

Import every model here so Alembic autogenerate and ``Base.metadata`` stay in sync.
"""

from app.models.end_card import (
    EndCardAudioMode,
    EndCardLayout,
    EndCardSettings,
)
from app.models.project import Project, ProjectStatus
from app.models.reel import (
    AspectRatio,
    Reel,
    ReelSegment,
    ReelStatus,
    SubtitleGranularity,
    SubtitlePosition,
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
    "EndCardAudioMode",
    "EndCardLayout",
    "EndCardSettings",
    "Project",
    "ProjectStatus",
    "Reel",
    "ReelSegment",
    "ReelStatus",
    "RenderJob",
    "RenderJobStatus",
    "SubtitleGranularity",
    "SubtitlePosition",
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

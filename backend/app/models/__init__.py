"""ORM models.

Import every model here so Alembic autogenerate and ``Base.metadata`` stay in sync.
"""

from app.models.analysis import (
    AnalysisCandidate,
    AnalysisCandidateStatus,
    AnalysisJob,
    AnalysisJobStatus,
)
from app.models.background_music import (
    BackgroundMusicPreset,
    BackgroundMusicScope,
    BackgroundMusicSettings,
)
from app.models.end_card import (
    EndCardAudioMode,
    EndCardLayout,
    EndCardSettings,
)
from app.models.export_profile import (
    ExportPlatform,
    ExportProfile,
    ExportQuality,
    FpsMode,
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
from app.models.youtube_import_job import (
    ACTIVE_YOUTUBE_IMPORT_STATUSES,
    YouTubeImportJob,
    YouTubeImportJobStatus,
)

__all__ = [
    "ACTIVE_YOUTUBE_IMPORT_STATUSES",
    "AnalysisCandidate",
    "AnalysisCandidateStatus",
    "AnalysisJob",
    "AnalysisJobStatus",
    "AspectRatio",
    "BackgroundMusicPreset",
    "BackgroundMusicScope",
    "BackgroundMusicSettings",
    "EndCardAudioMode",
    "EndCardLayout",
    "EndCardSettings",
    "ExportPlatform",
    "ExportProfile",
    "ExportQuality",
    "FpsMode",
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
    "YouTubeImportJob",
    "YouTubeImportJobStatus",
]

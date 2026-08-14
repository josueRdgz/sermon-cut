"""ORM models.

Import every model here so Alembic autogenerate and ``Base.metadata`` stay in sync.
"""

from app.models.analysis import (
    AnalysisCandidate,
    AnalysisCandidateStatus,
    AnalysisJob,
    AnalysisJobStatus,
)
from app.models.audio_repair import (
    ACTIVE_AUDIO_REPAIR_STATUSES,
    AudioRepairJob,
    AudioRepairJobStatus,
)
from app.models.background_music import (
    BackgroundMusicPreset,
    BackgroundMusicScope,
    BackgroundMusicSettings,
)
from app.models.end_card import (
    EndCardAudioMode,
    EndCardLayout,
    EndCardMessagePosition,
    EndCardSettings,
)
from app.models.export_profile import (
    ExportPlatform,
    ExportProfile,
    ExportQuality,
    FpsMode,
)
from app.models.highlight import (
    ACTIVE_HIGHLIGHT_STATUSES,
    ContentMetadata,
    HighlightAnalysisJob,
    HighlightAnalysisStatus,
    HighlightPlan,
    SubtitleDelivery,
)
from app.models.project import Project, ProjectContentMode, ProjectSourceKind, ProjectStatus
from app.models.reel import (
    AspectRatio,
    ContentKind,
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
    "ACTIVE_AUDIO_REPAIR_STATUSES",
    "ACTIVE_YOUTUBE_IMPORT_STATUSES",
    "AnalysisCandidate",
    "AnalysisCandidateStatus",
    "AnalysisJob",
    "AnalysisJobStatus",
    "AudioRepairJob",
    "AudioRepairJobStatus",
    "AspectRatio",
    "ACTIVE_HIGHLIGHT_STATUSES",
    "BackgroundMusicPreset",
    "BackgroundMusicScope",
    "BackgroundMusicSettings",
    "EndCardAudioMode",
    "EndCardLayout",
    "EndCardMessagePosition",
    "EndCardSettings",
    "ContentKind",
    "ContentMetadata",
    "ExportPlatform",
    "ExportProfile",
    "ExportQuality",
    "FpsMode",
    "Project",
    "ProjectContentMode",
    "ProjectSourceKind",
    "ProjectStatus",
    "Reel",
    "ReelSegment",
    "ReelStatus",
    "RenderJob",
    "RenderJobStatus",
    "HighlightAnalysisJob",
    "HighlightAnalysisStatus",
    "HighlightPlan",
    "SubtitleGranularity",
    "SubtitlePosition",
    "SubtitleStyle",
    "SubtitleDelivery",
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

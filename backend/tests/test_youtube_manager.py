"""YouTubeImportManager lifecycle tests with mocked yt-dlp (no real download)."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.core.paths import project_source_dir
from app.models.project import Project, ProjectStatus
from app.models.youtube_import_job import YouTubeImportJobStatus
from app.services.ffprobe import VideoMetadata
from app.services.youtube.manager import (
    InlineExecutor,
    YouTubeImportManager,
    _estimate_download_bytes,
)
from app.services.youtube.ytdlp import DownloadProgress, DownloadResult
from sqlalchemy.orm import sessionmaker

_MP4_MAGIC = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 48

_PAYLOAD = {
    "id": "dQw4w9WgXcQ",
    "title": "Sermón de prueba",
    "channel": "Iglesia Demo",
    "duration": 1800,
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    "upload_date": "20240115",
    "formats": [
        {"vcodec": "avc1.640028", "acodec": "none", "height": 1080, "filesize": 1000},
        {"vcodec": "none", "acodec": "mp4a.40.2", "filesize": 200},
    ],
}


@pytest.fixture()
def project(db_session_factory: sessionmaker) -> Project:
    session = db_session_factory()
    proj = Project(
        title="Demo",
        church_name="Iglesia Demo",
        youtube_channel="@demo",
        status=ProjectStatus.created,
    )
    session.add(proj)
    session.commit()
    session.refresh(proj)
    session.close()
    return proj


def _ok_metadata(*_args: object, **_kwargs: object) -> tuple[int, dict, str]:
    return 0, _PAYLOAD, ""


def _patch_finalize(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.projects.probe_video",
        lambda _path: VideoMetadata(
            duration_seconds=1800.0,
            width=1920,
            height=1080,
            fps=30.0,
            video_codec="h264",
            audio_codec="aac",
        ),
    )


def test_successful_import_registers_video(
    db_session_factory: sessionmaker,
    project: Project,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_finalize(monkeypatch)

    def fake_download(exe, url, *, format_selector, output_template, on_progress, cancel_event, log_path):  # noqa: ANN001, ANN201, E501
        on_progress(
            DownloadProgress("downloading_video", "downloading", 500, 1000, 250000, 5, 0.5)
        )
        on_progress(
            DownloadProgress("downloading_audio", "downloading", 200, 200, 100000, 0, 1.0)
        )
        out = Path(output_template.replace("%(ext)s", "mp4"))
        out.write_bytes(_MP4_MAGIC)
        return DownloadResult(
            returncode=0, cancelled=False, stderr_tail="", output_path=out, merged=True
        )

    manager = YouTubeImportManager(
        session_factory=db_session_factory,
        executor=InlineExecutor(),
        ytdlp_locator=lambda _s: "yt-dlp",
        downloader=fake_download,
        metadata_runner=_ok_metadata,
    )

    db = db_session_factory()
    job = manager.start(db, project.id, url="https://youtu.be/dQw4w9WgXcQ", quality="1080p")
    db.refresh(job)

    assert job.status == YouTubeImportJobStatus.completed
    assert job.output_filename == "youtube-dQw4w9WgXcQ.mp4"
    assert job.progress == 1.0

    refreshed = db.get(Project, project.id)
    assert refreshed.status == ProjectStatus.ready
    assert refreshed.video_filename == "youtube-dQw4w9WgXcQ.mp4"
    assert refreshed.width == 1920
    db.close()


def test_cancelled_import_cleans_partials(
    db_session_factory: sessionmaker,
    project: Project,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_finalize(monkeypatch)

    def fake_download(exe, url, *, format_selector, output_template, on_progress, cancel_event, log_path):  # noqa: ANN001, ANN201, E501
        # Simulate a partial download left on disk, then a cancellation.
        source = Path(output_template).parent
        (source / "youtube-dQw4w9WgXcQ.f137.mp4.part").write_bytes(b"partial")
        return DownloadResult(
            returncode=0, cancelled=True, stderr_tail="", output_path=None, merged=False
        )

    manager = YouTubeImportManager(
        session_factory=db_session_factory,
        executor=InlineExecutor(),
        ytdlp_locator=lambda _s: "yt-dlp",
        downloader=fake_download,
        metadata_runner=_ok_metadata,
    )

    db = db_session_factory()
    job = manager.start(db, project.id, url="https://youtu.be/dQw4w9WgXcQ", quality="720p")
    db.refresh(job)

    assert job.status == YouTubeImportJobStatus.cancelled
    # No .part files should remain.
    source_dir = project_source_dir(project.id)
    assert list(source_dir.glob("*.part")) == []

    refreshed = db.get(Project, project.id)
    # Project had no prior video → returns to "created", never "ready".
    assert refreshed.status == ProjectStatus.created
    assert refreshed.video_filename is None
    db.close()


def test_metadata_error_marks_failed(
    db_session_factory: sessionmaker,
    project: Project,
) -> None:
    def private_metadata(*_a: object, **_k: object) -> tuple[int, None, str]:
        return 1, None, "ERROR: Private video. Sign in if you've been granted access"

    manager = YouTubeImportManager(
        session_factory=db_session_factory,
        executor=InlineExecutor(),
        ytdlp_locator=lambda _s: "yt-dlp",
        downloader=lambda *a, **k: DownloadResult(0, False, "", None, False),
        metadata_runner=private_metadata,
    )

    db = db_session_factory()
    job = manager.start(db, project.id, url="https://youtu.be/dQw4w9WgXcQ", quality="1080p")
    db.refresh(job)

    assert job.status == YouTubeImportJobStatus.failed
    assert job.error_code == "youtube_private"
    assert db.get(Project, project.id).status == ProjectStatus.created
    db.close()


def test_ffprobe_failure_marks_failed(
    db_session_factory: sessionmaker,
    project: Project,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.exceptions import AppError

    def bad_probe(_path: Path) -> VideoMetadata:
        raise AppError("FFprobe could not read the file.", code="ffprobe_failed", status_code=422)

    monkeypatch.setattr("app.services.projects.probe_video", bad_probe)

    def fake_download(exe, url, *, format_selector, output_template, on_progress, cancel_event, log_path):  # noqa: ANN001, ANN201, E501
        out = Path(output_template.replace("%(ext)s", "mp4"))
        out.write_bytes(_MP4_MAGIC)
        return DownloadResult(0, False, "", out, True)

    manager = YouTubeImportManager(
        session_factory=db_session_factory,
        executor=InlineExecutor(),
        ytdlp_locator=lambda _s: "yt-dlp",
        downloader=fake_download,
        metadata_runner=_ok_metadata,
    )

    db = db_session_factory()
    job = manager.start(db, project.id, url="https://youtu.be/dQw4w9WgXcQ", quality="1080p")
    db.refresh(job)

    assert job.status == YouTubeImportJobStatus.failed
    assert db.get(Project, project.id).status == ProjectStatus.created
    db.close()


def test_download_returncode_error_marks_failed(
    db_session_factory: sessionmaker,
    project: Project,
) -> None:
    def fake_download(*_a: object, **_k: object) -> DownloadResult:
        return DownloadResult(
            returncode=1,
            cancelled=False,
            stderr_tail="ERROR: Requested format is not available",
            output_path=None,
            merged=False,
        )

    manager = YouTubeImportManager(
        session_factory=db_session_factory,
        executor=InlineExecutor(),
        ytdlp_locator=lambda _s: "yt-dlp",
        downloader=fake_download,
        metadata_runner=_ok_metadata,
    )

    db = db_session_factory()
    job = manager.start(db, project.id, url="https://youtu.be/dQw4w9WgXcQ", quality="best")
    db.refresh(job)

    assert job.status == YouTubeImportJobStatus.failed
    assert job.error_code == "youtube_format_unavailable"
    db.close()


def test_disk_space_guard() -> None:
    from app.core.config import Settings
    from app.core.exceptions import ValidationAppError

    manager = YouTubeImportManager(
        session_factory=lambda: None,  # type: ignore[arg-type]
        executor=InlineExecutor(),
    )
    settings = Settings(youtube_max_estimated_bytes=10, youtube_min_free_bytes=0)
    with pytest.raises(ValidationAppError) as exc:
        manager._assert_space(Path.cwd(), estimate=1_000_000, settings=settings)
    assert exc.value.code == "youtube_too_large"


def test_estimate_download_bytes_uses_formats() -> None:
    estimate = _estimate_download_bytes(_PAYLOAD, height=1080)
    assert estimate == 1200  # 1000 video + 200 audio


def test_estimate_download_bytes_duration_fallback() -> None:
    payload = {"duration": 100}
    estimate = _estimate_download_bytes(payload, height=720)
    assert estimate is not None and estimate > 0


def test_cancel_sets_event_and_marks_cancelling(
    db_session_factory: sessionmaker,
    project: Project,
) -> None:
    """cancel() on an active job flips it to cancelling and trips its event.

    Uses a manually-inserted active job so no worker thread is needed (SQLite
    StaticPool shares one connection, which is unsafe across threads in tests).
    """
    from app.models.youtube_import_job import YouTubeImportJob

    manager = YouTubeImportManager(
        session_factory=db_session_factory,
        ytdlp_locator=lambda _s: "yt-dlp",
    )

    db = db_session_factory()
    job = YouTubeImportJob(
        project_id=project.id,
        status=YouTubeImportJobStatus.downloading_video,
        stage="downloading_video",
        source_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        video_id="dQw4w9WgXcQ",
        requested_quality="1080p",
        progress=0.3,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    event = manager._event_for(job.id)
    assert not event.is_set()

    cancelled = manager.cancel(db, job.id)
    assert cancelled.status == YouTubeImportJobStatus.cancelling
    assert event.is_set()
    db.close()

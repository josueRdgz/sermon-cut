"""API + manager tests for reel rendering, using a fake FFmpeg runner.

The real FFmpeg binary is exercised only by the optional integration test at the
bottom, which is skipped when FFmpeg is unavailable.
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Generator
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.project import Project, ProjectStatus
from app.models.reel import AspectRatio, Reel, ReelSegment, TransitionType
from app.services.ffprobe import VideoMetadata
from app.services.render.manager import (
    InlineExecutor,
    RenderManager,
    get_render_manager,
    unique_output_path,
)
from app.services.render.runner import FFmpegError, RunResult
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


class FakeRunner:
    """Stands in for ``run_ffmpeg``: writes a stub output and reports progress."""

    def __init__(self, *, cancelled: bool = False, fail: bool = False) -> None:
        self.cancelled = cancelled
        self.fail = fail
        self.calls: list[list[str]] = []

    def __call__(
        self,
        args: list[str],
        *,
        on_progress=None,
        cancel_event=None,
        log_path: Path | None = None,
    ) -> RunResult:
        self.calls.append(args)
        if self.fail:
            raise FFmpegError(1, "Invalid argument")

        if on_progress is not None:
            from app.services.render.progress import ProgressUpdate

            on_progress(ProgressUpdate(out_time_seconds=0.1, frame=3, speed=2.0, finished=False))

        if not self.cancelled:
            # FFmpeg's output path is always the final argument.
            Path(args[-1]).write_bytes(b"\x00" * 2048)
        return RunResult(returncode=0, cancelled=self.cancelled, stderr_tail="")


def _fake_prober(has_audio: bool = True, fps: float | None = 30.0):
    def _probe(path: Path) -> VideoMetadata:
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        # FakeRunner writes tiny stubs for the *output*; treat them as verified exports.
        if size <= 8192 and path.suffix.lower() == ".mp4" and "original" not in path.name:
            return VideoMetadata(
                duration_seconds=5.2,
                width=1080,
                height=1920,
                fps=30.0,
                video_codec="h264",
                audio_codec="aac" if has_audio else None,
            )
        return VideoMetadata(
            duration_seconds=900.0,
            width=1920,
            height=1080,
            fps=fps,
            video_codec="h264",
            audio_codec="aac" if has_audio else None,
        )

    return _probe


@pytest.fixture()
def render_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Generator[tuple[TestClient, sessionmaker, FakeRunner], None, None]:
    projects = tmp_path / "projects"
    projects.mkdir()
    monkeypatch.setattr("app.core.paths.PROJECTS_DIR", projects)

    url = f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
    monkeypatch.setenv("SERMON_CUT_DATABASE_URL", url)
    monkeypatch.setenv("SERMON_CUT_AUTO_MIGRATE", "false")
    get_settings.cache_clear()

    engine = create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    def _override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    runner = FakeRunner()
    manager = RenderManager(
        session_factory=TestingSessionLocal,
        executor=InlineExecutor(),
        ffmpeg_locator=lambda: "ffmpeg",
        filter_checker=lambda _binary, _filter: True,
        runner=runner,
        prober=_fake_prober(),
    )

    app = create_app()
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_render_manager] = lambda: manager

    with TestClient(app) as client:
        yield client, TestingSessionLocal, runner

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    get_settings.cache_clear()


def _seed_project_and_reel(
    session_factory: sessionmaker,
    *,
    segments: list[tuple[float, float, TransitionType, int]] | None = None,
) -> tuple[str, str]:
    from app.services import storage

    if segments is None:
        segments = [
            (620.0, 642.0, TransitionType.hard_cut, 0),
            (665.0, 689.0, TransitionType.hard_cut, 0),
        ]

    with session_factory() as db:
        project = Project(
            title="Sermón",
            church_name="Iglesia",
            youtube_channel="canal",
            video_filename="original.mp4",
            duration_seconds=900.0,
            fps=30.0,
            status=ProjectStatus.editing,
        )
        db.add(project)
        db.commit()
        project_id = project.id

        reel = Reel(
            project_id=project_id,
            title="Gancho y clímax",
            aspect_ratio=AspectRatio.nine_sixteen,
        )
        for order, (start, end, transition, ms) in enumerate(segments):
            reel.segments.append(
                ReelSegment(
                    order=order,
                    source_start_seconds=start,
                    source_end_seconds=end,
                    transition_type=transition,
                    transition_duration_ms=ms,
                )
            )
        db.add(reel)
        db.commit()
        reel_id = reel.id

    # The manager checks that the source file exists on disk.
    video_path = storage.resolve_inside_project(project_id, "original.mp4")
    video_path.write_bytes(b"\x00" * 128)
    return str(project_id), str(reel_id)


# --------------------------------------------------------------------------- #
# Output naming
# --------------------------------------------------------------------------- #
def test_unique_output_path_never_overwrites(tmp_path: Path) -> None:
    first = unique_output_path(tmp_path, "reel")
    first.write_bytes(b"a")
    second = unique_output_path(tmp_path, "reel")
    second.write_bytes(b"b")
    third = unique_output_path(tmp_path, "reel")

    assert first.name == "reel.mp4"
    assert second.name == "reel-2.mp4"
    assert third.name == "reel-3.mp4"
    assert first.read_bytes() == b"a"


# --------------------------------------------------------------------------- #
# Happy path
# --------------------------------------------------------------------------- #
def test_render_completes_and_saves_output(render_env) -> None:
    client, session_factory, runner = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)

    resp = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/render",
        json={"layout": "center_crop"},
    )
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "completed"
    assert body["progress"] == pytest.approx(1.0)
    assert body["width"] == 1080
    assert body["height"] == 1920
    assert body["output_filename"] == "sermon_clip-01_youtube-short.mp4"
    assert body["output_size_bytes"] == 2048
    assert body["profile_slug"] == "youtube-short"
    assert body["quality"] == "standard"
    assert body["verified"] is True
    assert body["sha256"]
    assert body["report_filename"] == "sermon_clip-01_youtube-short.report.json"
    assert body["publish_status"] == "local_only"
    # The sanitized command is stored for debugging.
    assert body["ffmpeg_command"].startswith("ffmpeg ")
    assert "libx264" in body["ffmpeg_command"]

    # Output lives under storage/projects/{id}/renders/
    from app.core.paths import project_renders_dir

    output = project_renders_dir(UUID(project_id)) / body["output_filename"]
    assert output.is_file()
    report = project_renders_dir(UUID(project_id)) / body["report_filename"]
    assert report.is_file()
    # Temporary artefacts were cleaned up.
    assert not list((project_renders_dir(UUID(project_id)) / ".tmp").glob("*.mp4"))

    assert len(runner.calls) == 1
    assert "-progress" in runner.calls[0]


def test_render_always_appends_the_mandatory_end_card(render_env) -> None:
    client, session_factory, _ = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)

    body = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/render",
        json={"layout": "center_crop"},
    ).json()
    assert body["status"] == "completed"

    command = body["ffmpeg_command"]
    assert "endcard-" in command
    assert "-loop" in command
    # 22 s + 24 s of content, plus the 5 s default end card.
    assert body["total_seconds"] == pytest.approx(51.0)

    # The generated PNG is a temp artefact and must not linger.
    from app.core.paths import project_renders_dir

    assert not list((project_renders_dir(UUID(project_id)) / ".tmp").glob("*.png"))


def test_saved_audio_offset_reaches_ffmpeg_export(render_env) -> None:
    client, session_factory, runner = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)

    rendered = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/render",
        json={"layout": "center_crop", "audio_offset_ms": 300},
    )
    assert rendered.status_code == 202
    saved = client.get(f"/api/projects/{project_id}/reels/{reel_id}")
    assert saved.json()["audio_offset_ms"] == 300
    args = runner.calls[-1]
    seek_values = [args[index + 1] for index, value in enumerate(args) if value == "-ss"]
    assert seek_values[:4] == ["620", "665", "619.7", "664.7"]
    graph = args[args.index("-filter_complex") + 1]
    assert "[2:a]" in graph
    assert "[3:a]" in graph


def test_end_card_duration_override_reaches_the_render(render_env) -> None:
    client, session_factory, _ = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)

    saved = client.put(
        f"/api/projects/{project_id}/end-card/settings",
        json={"layout": "minimal", "duration_seconds": 3.0},
    )
    assert saved.status_code == 200, saved.text

    body = client.post(f"/api/projects/{project_id}/reels/{reel_id}/render", json={}).json()
    assert body["total_seconds"] == pytest.approx(49.0)


def test_render_output_is_downloadable_and_playable(render_env) -> None:
    client, session_factory, _ = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)

    started = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/render", json={}
    ).json()
    job_id = started["id"]

    inline = client.get(f"/api/render-jobs/{job_id}/output")
    assert inline.status_code == 200
    assert inline.headers["content-type"] == "video/mp4"
    assert "inline" in inline.headers["content-disposition"]

    download = client.get(f"/api/render-jobs/{job_id}/output?download=true")
    assert download.status_code == 200
    assert "attachment" in download.headers["content-disposition"]


def test_second_render_does_not_overwrite_the_first(render_env) -> None:
    client, session_factory, _ = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)

    first = client.post(f"/api/projects/{project_id}/reels/{reel_id}/render", json={}).json()
    second = client.post(f"/api/projects/{project_id}/reels/{reel_id}/render", json={}).json()

    assert first["output_filename"] == "sermon_clip-01_youtube-short.mp4"
    assert second["output_filename"] == "sermon_clip-01_youtube-short-2.mp4"

    listed = client.get(f"/api/projects/{project_id}/reels/{reel_id}/renders").json()
    assert listed["total"] == 2


def test_blurred_background_layout_recorded(render_env) -> None:
    client, session_factory, runner = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)

    resp = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/render",
        json={"layout": "blurred_background", "aspect_ratio": "9:16"},
    )
    assert resp.status_code == 202
    assert resp.json()["layout"] == "blurred_background"
    graph_arg = runner.calls[0][runner.calls[0].index("-filter_complex") + 1]
    assert "gblur" in graph_arg
    assert "overlay=(W-w)/2:(H-h)/2" in graph_arg


def test_source_without_audio_gets_silent_track(tmp_path: Path, render_env) -> None:
    client, session_factory, runner = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)

    # Swap the prober for one reporting no audio stream.
    manager = client.app.dependency_overrides[get_render_manager]()
    manager._prober = _fake_prober(has_audio=False)  # noqa: SLF001 — test seam

    resp = client.post(f"/api/projects/{project_id}/reels/{reel_id}/render", json={})
    assert resp.status_code == 202
    assert "anullsrc=channel_layout=stereo:sample_rate=48000" in runner.calls[0]


# --------------------------------------------------------------------------- #
# Guards and failures
# --------------------------------------------------------------------------- #
def test_render_without_segments_rejected(render_env) -> None:
    client, session_factory, _ = render_env
    with session_factory() as db:
        project = Project(
            title="Vacío",
            church_name="Iglesia",
            youtube_channel="canal",
            video_filename="original.mp4",
            duration_seconds=100.0,
        )
        db.add(project)
        db.commit()
        reel = Reel(project_id=project.id, title="Sin fragmentos")
        db.add(reel)
        db.commit()
        project_id, reel_id = project.id, reel.id

    resp = client.post(f"/api/projects/{project_id}/reels/{reel_id}/render", json={})
    assert resp.status_code == 400
    assert resp.json()["code"] == "reel_empty"


def test_render_without_video_rejected(render_env) -> None:
    client, session_factory, _ = render_env
    with session_factory() as db:
        project = Project(title="Sin video", church_name="I", youtube_channel="c")
        db.add(project)
        db.commit()
        reel = Reel(project_id=project.id, title="X")
        reel.segments.append(
            ReelSegment(order=0, source_start_seconds=1.0, source_end_seconds=2.0)
        )
        db.add(reel)
        db.commit()
        project_id, reel_id = project.id, reel.id

    resp = client.post(f"/api/projects/{project_id}/reels/{reel_id}/render", json={})
    assert resp.status_code == 400
    assert resp.json()["code"] == "video_missing"


def test_unknown_reel_returns_404(render_env) -> None:
    client, session_factory, _ = render_env
    project_id, _ = _seed_project_and_reel(session_factory)
    resp = client.post(f"/api/projects/{project_id}/reels/{uuid4()}/render", json={})
    assert resp.status_code == 404


def test_ffmpeg_failure_marks_job_failed(render_env) -> None:
    client, session_factory, _ = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)

    manager = client.app.dependency_overrides[get_render_manager]()
    manager._runner = FakeRunner(fail=True)  # noqa: SLF001 — test seam

    resp = client.post(f"/api/projects/{project_id}/reels/{reel_id}/render", json={})
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "failed"
    assert "Invalid argument" in body["error_message"]
    assert body["output_filename"] is None


def test_cancelled_render_produces_no_output(render_env) -> None:
    client, session_factory, _ = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)

    manager = client.app.dependency_overrides[get_render_manager]()
    manager._runner = FakeRunner(cancelled=True)  # noqa: SLF001 — test seam

    resp = client.post(f"/api/projects/{project_id}/reels/{reel_id}/render", json={})
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "cancelled"
    assert body["output_filename"] is None

    output = client.get(f"/api/render-jobs/{body['id']}/output")
    assert output.status_code == 404


def test_delete_render_removes_mp4_report_and_history(render_env) -> None:
    client, session_factory, _ = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)
    rendered = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/render",
        json={},
    ).json()

    from app.core.paths import project_renders_dir

    directory = project_renders_dir(UUID(project_id))
    output = directory / rendered["output_filename"]
    report = directory / rendered["report_filename"]
    assert output.is_file()
    assert report.is_file()

    deleted = client.delete(f"/api/render-jobs/{rendered['id']}")
    assert deleted.status_code == 204
    assert not output.exists()
    assert not report.exists()
    assert client.get(f"/api/render-jobs/{rendered['id']}").status_code == 404
    history = client.get(f"/api/projects/{project_id}/reels/{reel_id}/renders")
    assert history.json()["total"] == 0


def test_cancel_endpoint_on_finished_job_is_noop(render_env) -> None:
    client, session_factory, _ = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)
    job = client.post(f"/api/projects/{project_id}/reels/{reel_id}/render", json={}).json()

    resp = client.post(f"/api/render-jobs/{job['id']}/cancel")
    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"


def test_latest_render_polling_endpoint(render_env) -> None:
    client, session_factory, _ = render_env
    project_id, reel_id = _seed_project_and_reel(session_factory)

    missing = client.get(f"/api/projects/{project_id}/reels/{reel_id}/render")
    assert missing.status_code == 404

    client.post(f"/api/projects/{project_id}/reels/{reel_id}/render", json={})
    latest = client.get(f"/api/projects/{project_id}/reels/{reel_id}/render")
    assert latest.status_code == 200
    assert latest.json()["status"] == "completed"


# --------------------------------------------------------------------------- #
# Optional integration test against the real FFmpeg binary
# --------------------------------------------------------------------------- #
_HAS_FFMPEG = shutil.which("ffmpeg") is not None


@pytest.mark.skipif(not _HAS_FFMPEG, reason="FFmpeg is not installed")
def test_integration_real_ffmpeg_render(tmp_path: Path) -> None:
    """Render consecutive crossfades without mixing FFmpeg timebases."""
    from app.services.render.args import RenderSegmentSpec, build_render_command
    from app.services.render.runner import run_ffmpeg

    ffmpeg = shutil.which("ffmpeg")
    assert ffmpeg is not None
    source = tmp_path / "source.mp4"

    # 6 s of colour bars + a tone, 1280x720 @ 25 fps (horizontal source).
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25:duration=6",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
            "-shortest", str(source),
        ],
        check=True,
        capture_output=True,
    )
    assert source.is_file()

    output = tmp_path / "out.mp4"
    plan = build_render_command(
        ffmpeg=ffmpeg,
        source=source,
        segments=[
            RenderSegmentSpec(0.5, 2.0, "short_crossfade", 200),
            RenderSegmentSpec(2.5, 4.0, "short_crossfade", 200),
            RenderSegmentSpec(4.5, 5.5),
        ],
        aspect_ratio="9:16",
        layout="blurred_background",
        output_path=output,
        has_audio=True,
        fps=25.0,
        normalize_loudness=False,
        preset="ultrafast",
        audio_offset_ms=250,
    )

    seen: list[float] = []
    run_ffmpeg(
        plan.args,
        on_progress=lambda u: seen.append(u.out_time_seconds or 0.0),
        log_path=tmp_path / "ffmpeg.log",
    )

    assert output.is_file()
    assert output.stat().st_size > 0
    assert seen, "expected at least one -progress update"

    # Verify the result really is 1080x1920 H.264 + AAC of the expected length.
    from app.services.ffprobe import probe_video

    meta = probe_video(output)
    assert (meta.width, meta.height) == (1080, 1920)
    assert meta.video_codec == "h264"
    assert meta.audio_codec == "aac"
    assert meta.duration_seconds == pytest.approx(3.6, abs=0.4)

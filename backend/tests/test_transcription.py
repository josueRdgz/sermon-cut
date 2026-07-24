"""Unit tests for local transcription: device, audio, and the job manager.

A simulated engine is used throughout so no faster-whisper model is ever
downloaded, and audio extraction is faked so FFmpeg is not required.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from pathlib import Path
from uuid import UUID

import pytest
from app.core.exceptions import ConflictError, ValidationAppError
from app.db.base import Base
from app.models.project import Project, ProjectStatus
from app.models.transcript import Transcript, TranscriptSegment
from app.models.transcription_job import TranscriptionJob, TranscriptionJobStatus
from app.services.whisper import device as device_mod
from app.services.whisper.audio import build_ffmpeg_command
from app.services.whisper.device import DeviceSelection
from app.services.whisper.engine import EngineInfo, EngineSegment, EngineWord
from app.services.whisper.manager import InlineExecutor, JobManager
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


# --------------------------------------------------------------------------- #
# Device detection
# --------------------------------------------------------------------------- #
def test_select_device_cpu_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(device_mod, "_cuda_available", lambda: False)
    monkeypatch.setattr(device_mod, "is_apple_silicon", lambda: False)
    selection = device_mod.select_device("auto", "auto")
    assert selection.device == "cpu"
    assert selection.compute_type == "int8"
    assert selection.notice is None


def test_select_device_cuda_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(device_mod, "_cuda_available", lambda: True)
    monkeypatch.setattr(device_mod, "is_apple_silicon", lambda: False)
    selection = device_mod.select_device("auto", "auto")
    assert selection.device == "cuda"
    assert selection.compute_type == "float16"


def test_select_device_apple_silicon_notice(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(device_mod, "_cuda_available", lambda: False)
    monkeypatch.setattr(device_mod, "is_apple_silicon", lambda: True)
    selection = device_mod.select_device("auto", "auto")
    assert selection.device == "cpu"
    assert selection.is_apple_silicon is True
    assert selection.notice is not None
    assert "CPU" in selection.notice


def test_select_device_cuda_requested_but_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(device_mod, "_cuda_available", lambda: False)
    monkeypatch.setattr(device_mod, "is_apple_silicon", lambda: False)
    selection = device_mod.select_device("cuda", "auto")
    assert selection.device == "cpu"
    assert selection.notice is not None


# --------------------------------------------------------------------------- #
# Audio extraction command
# --------------------------------------------------------------------------- #
def test_build_ffmpeg_command_targets_wav_mono_16k() -> None:
    cmd = build_ffmpeg_command(Path("/in.mp4"), Path("/out.wav"), "ffmpeg")
    assert "-ar" in cmd and "16000" in cmd
    assert "-ac" in cmd and "1" in cmd
    assert cmd[-1] == "/out.wav"
    assert "pcm_s16le" in cmd


# --------------------------------------------------------------------------- #
# Simulated engine + fakes
# --------------------------------------------------------------------------- #
class FakeEngine:
    """Engine that yields preconfigured segments without any model download."""

    def __init__(self, segments: list[EngineSegment], info: EngineInfo) -> None:
        self._segments = segments
        self._info = info
        self.calls: list[dict[str, object]] = []

    def transcribe(
        self,
        audio_path: Path,
        *,
        model_name: str,
        language: str | None,
        device: str,
        compute_type: str,
        word_timestamps: bool = True,
    ) -> tuple[EngineInfo, Iterator[EngineSegment]]:
        self.calls.append(
            {
                "model_name": model_name,
                "language": language,
                "device": device,
                "compute_type": compute_type,
            }
        )

        def _gen() -> Iterator[EngineSegment]:
            yield from self._segments

        return self._info, _gen()


class BlockingEngine:
    """Engine that pauses mid-stream so cancellation can be observed."""

    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()
        self._info = EngineInfo(language="es", duration=30.0)

    def transcribe(self, audio_path: Path, **_: object) -> tuple[EngineInfo, Iterator[EngineSegment]]:
        def _gen() -> Iterator[EngineSegment]:
            yield EngineSegment(0.0, 1.0, "uno", [])
            self.started.set()
            self.release.wait(timeout=5)
            yield EngineSegment(1.0, 2.0, "dos", [])
            yield EngineSegment(2.0, 3.0, "tres", [])

        return self._info, _gen()


def _fake_extractor(video_path: Path, audio_path: Path) -> Path:
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    audio_path.write_bytes(b"RIFFfake")
    return audio_path


def _cpu_selector(_pref: str, _compute: str) -> DeviceSelection:
    return DeviceSelection(
        device="cpu", compute_type="int8", is_apple_silicon=False, notice=None
    )


@pytest.fixture()
def db_setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> sessionmaker:
    """Isolated SQLite DB plus patched storage/temp dirs."""
    projects = tmp_path / "projects"
    temp = tmp_path / "temp"
    projects.mkdir()
    temp.mkdir()
    monkeypatch.setattr("app.core.paths.PROJECTS_DIR", projects)
    monkeypatch.setattr("app.core.paths.TEMP_DIR", temp)

    url = f"sqlite:///{(tmp_path / 'jobs.db').as_posix()}"
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _make_project(session_factory: sessionmaker, *, with_video: bool = True) -> UUID:
    with session_factory() as db:
        project = Project(
            title="Sermón",
            church_name="Iglesia",
            youtube_channel="canal",
            video_filename="video.mp4" if with_video else None,
            duration_seconds=30.0,
            status=ProjectStatus.ready,
        )
        db.add(project)
        db.commit()
        return project.id


def _build_manager(session_factory: sessionmaker, engine: object, **kwargs: object) -> JobManager:
    return JobManager(
        session_factory=session_factory,
        engine=engine,
        executor=kwargs.pop("executor", InlineExecutor()),
        audio_extractor=_fake_extractor,
        device_selector=_cpu_selector,
        **kwargs,
    )


# --------------------------------------------------------------------------- #
# Job manager: happy path
# --------------------------------------------------------------------------- #
def test_transcription_completes_and_persists(db_setup: sessionmaker) -> None:
    session_factory = db_setup
    project_id = _make_project(session_factory)

    engine = FakeEngine(
        segments=[
            EngineSegment(
                0.0, 5.0, "Hola mundo", [EngineWord(0.0, 1.0, "Hola", 0.9)]
            ),
            EngineSegment(5.0, 10.0, "Segundo segmento", []),
        ],
        info=EngineInfo(language="es", duration=30.0),
    )
    manager = _build_manager(session_factory, engine)

    with session_factory() as db:
        job = manager.start(db, project_id, model_name="small", language_option="es")
        job_id = job.id

    with session_factory() as db:
        finished = db.get(TranscriptionJob, job_id)
        assert finished is not None
        assert finished.status == TranscriptionJobStatus.completed
        assert finished.progress == pytest.approx(1.0)
        assert finished.device == "cpu"
        assert finished.detected_language == "es"

    # The transcript was saved with segments and word timings.
    with session_factory() as db:
        transcript = db.query(Transcript).filter_by(project_id=project_id).one()
        segments = db.query(TranscriptSegment).filter_by(transcript_id=transcript.id).all()
        assert len(segments) == 2
        assert transcript.has_word_timestamps is True
        project = db.get(Project, project_id)
        assert project.status == ProjectStatus.ready

    # Language "es" was forwarded to the engine (not "auto").
    assert engine.calls[0]["language"] == "es"


def test_language_auto_is_passed_as_none(db_setup: sessionmaker) -> None:
    session_factory = db_setup
    project_id = _make_project(session_factory)
    engine = FakeEngine(
        segments=[EngineSegment(0.0, 1.0, "hi", [])],
        info=EngineInfo(language="en", duration=5.0),
    )
    manager = _build_manager(session_factory, engine)
    with session_factory() as db:
        manager.start(db, project_id, model_name="base", language_option="auto")
    assert engine.calls[0]["language"] is None


def test_temp_audio_cleaned_up(db_setup: sessionmaker, tmp_path: Path) -> None:
    session_factory = db_setup
    project_id = _make_project(session_factory)
    engine = FakeEngine(
        segments=[EngineSegment(0.0, 1.0, "x", [])],
        info=EngineInfo(language="es", duration=5.0),
    )
    manager = _build_manager(session_factory, engine)
    with session_factory() as db:
        job = manager.start(db, project_id, model_name="small", language_option="es")
        job_id = job.id
    from app.core.paths import job_temp_dir

    assert not job_temp_dir(job_id).exists()


def test_temp_audio_kept_when_debug(db_setup: sessionmaker) -> None:
    session_factory = db_setup
    project_id = _make_project(session_factory)
    engine = FakeEngine(
        segments=[EngineSegment(0.0, 1.0, "x", [])],
        info=EngineInfo(language="es", duration=5.0),
    )
    manager = _build_manager(session_factory, engine, keep_temp_audio=True)
    with session_factory() as db:
        job = manager.start(db, project_id, model_name="small", language_option="es")
        job_id = job.id
    from app.core.paths import job_temp_dir

    assert (job_temp_dir(job_id) / "audio.wav").exists()


# --------------------------------------------------------------------------- #
# Job manager: guards and failures
# --------------------------------------------------------------------------- #
def test_no_video_raises(db_setup: sessionmaker) -> None:
    session_factory = db_setup
    project_id = _make_project(session_factory, with_video=False)
    engine = FakeEngine(segments=[], info=EngineInfo(None, None))
    manager = _build_manager(session_factory, engine)
    with session_factory() as db:  # noqa: SIM117
        with pytest.raises(ValidationAppError):
            manager.start(db, project_id, model_name="small", language_option="es")


def test_concurrent_job_conflict(db_setup: sessionmaker) -> None:
    session_factory = db_setup
    project_id = _make_project(session_factory)
    # Insert an already-running job to simulate an in-progress transcription.
    with session_factory() as db:
        db.add(
            TranscriptionJob(
                project_id=project_id,
                status=TranscriptionJobStatus.running,
                model_name="small",
                language_option="es",
                progress=0.3,
                processed_seconds=3.0,
            )
        )
        db.commit()

    engine = FakeEngine(segments=[], info=EngineInfo(None, None))
    manager = _build_manager(session_factory, engine)
    with session_factory() as db:  # noqa: SIM117
        with pytest.raises(ConflictError):
            manager.start(db, project_id, model_name="small", language_option="es")


def test_engine_failure_marks_job_failed(db_setup: sessionmaker) -> None:
    session_factory = db_setup
    project_id = _make_project(session_factory)

    class BoomEngine:
        def transcribe(self, *_a: object, **_k: object) -> tuple[EngineInfo, Iterator[EngineSegment]]:
            raise RuntimeError("model blew up")

    manager = _build_manager(session_factory, BoomEngine())
    with session_factory() as db:
        job = manager.start(db, project_id, model_name="small", language_option="es")
        job_id = job.id

    with session_factory() as db:
        failed = db.get(TranscriptionJob, job_id)
        assert failed.status == TranscriptionJobStatus.failed
        assert "model blew up" in (failed.error_message or "")
        project = db.get(Project, project_id)
        assert project.status == ProjectStatus.failed


# --------------------------------------------------------------------------- #
# Job manager: cancellation (threaded)
# --------------------------------------------------------------------------- #
def test_cancellation(db_setup: sessionmaker) -> None:
    from concurrent.futures import ThreadPoolExecutor

    session_factory = db_setup
    project_id = _make_project(session_factory)
    engine = BlockingEngine()
    executor = ThreadPoolExecutor(max_workers=1)
    manager = _build_manager(session_factory, engine, executor=executor)

    with session_factory() as db:
        job = manager.start(db, project_id, model_name="small", language_option="es")
        job_id = job.id

    assert engine.started.wait(timeout=5)
    with session_factory() as db:
        manager.cancel(db, job_id)
    engine.release.set()

    deadline = time.monotonic() + 5
    status = None
    while time.monotonic() < deadline:
        with session_factory() as db:
            status = db.get(TranscriptionJob, job_id).status
        if status == TranscriptionJobStatus.cancelled:
            break
        time.sleep(0.05)

    assert status == TranscriptionJobStatus.cancelled
    with session_factory() as db:
        assert db.query(Transcript).filter_by(project_id=project_id).first() is None
    executor.shutdown(wait=True)

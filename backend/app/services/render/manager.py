"""In-process render job manager.

Mirrors the transcription manager: a bounded ``ThreadPoolExecutor`` runs the
FFmpeg subprocess while job state is persisted in SQLite for polling. No Celery,
no Redis. Cancellation terminates the FFmpeg process cooperatively.
"""

from __future__ import annotations

import logging
import shutil
import threading
import time
import unicodedata
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ConflictError, NotFoundError, ValidationAppError
from app.core.paths import project_render_temp_dir, project_renders_dir
from app.models.project import Project, ProjectStatus
from app.models.reel import Reel
from app.models.render_job import ACTIVE_RENDER_STATUSES, RenderJob, RenderJobStatus
from app.services import storage
from app.services.endcard import resolve as resolve_end_card
from app.services.endcard.pipeline import build_end_card_spec
from app.services.ffprobe import probe_video
from app.services.render.args import (
    RenderSegmentSpec,
    build_render_command,
    format_command_for_log,
)
from app.services.render.progress import ProgressUpdate
from app.services.render.runner import FFmpegError, run_ffmpeg
from app.services.subtitles import build_subtitle_artifacts
from app.services.transcripts import service as transcripts_service

logger = logging.getLogger(__name__)

SessionFactory = Callable[[], Session]

_PROGRESS_COMMIT_INTERVAL = 0.5
_MAX_FILENAME_ATTEMPTS = 1000


class InlineExecutor:
    """Executor that runs work synchronously (used by tests)."""

    def submit(self, fn: Callable[..., object], *args: object, **kwargs: object) -> Future:
        future: Future = Future()
        try:
            future.set_result(fn(*args, **kwargs))
        except BaseException as exc:  # noqa: BLE001 — mirror executor semantics
            future.set_exception(exc)
        return future

    def shutdown(self, wait: bool = True) -> None:  # noqa: ARG002 — interface parity
        return None


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _slugify(value: str, *, fallback: str = "reel") -> str:
    """ASCII-fold a reel title into a filesystem-friendly stem."""
    folded = unicodedata.normalize("NFKD", value.strip())
    ascii_only = folded.encode("ascii", "ignore").decode("ascii")
    keep = [char if char.isalnum() or char in {"-", "_"} else "-" for char in ascii_only]
    slug = "".join(keep).strip("-_").lower()
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug[:60] or fallback


def unique_output_path(directory: Path, stem: str, suffix: str = ".mp4") -> Path:
    """Return a path inside ``directory`` that does not exist yet.

    Existing renders are never overwritten; a numeric suffix is appended.
    """
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / f"{stem}{suffix}"
    if not candidate.exists():
        return candidate
    for index in range(2, _MAX_FILENAME_ATTEMPTS):
        candidate = directory / f"{stem}-{index}{suffix}"
        if not candidate.exists():
            return candidate
    raise AppError(
        "Could not allocate a unique output filename.",
        code="output_name_exhausted",
        status_code=500,
    )


class RenderManager:
    """Owns the executor, cancellation flags, and the render lifecycle."""

    def __init__(
        self,
        *,
        session_factory: SessionFactory,
        executor: object | None = None,
        ffmpeg_locator: Callable[[], str | None] = lambda: shutil.which("ffmpeg"),
        runner: Callable[..., object] = run_ffmpeg,
        prober: Callable[[Path], object] = probe_video,
        keep_temp: bool = False,
    ) -> None:
        self._session_factory = session_factory
        self._executor = executor or ThreadPoolExecutor(max_workers=1)
        self._ffmpeg_locator = ffmpeg_locator
        self._runner = runner
        self._prober = prober
        self._keep_temp = keep_temp
        self._cancel_events: dict[UUID, threading.Event] = {}
        self._futures: dict[UUID, Future] = {}
        self._lock = threading.Lock()

    # ---- public API -------------------------------------------------------

    def start(
        self,
        db: Session,
        project_id: UUID,
        reel_id: UUID,
        *,
        aspect_ratio: str | None,
        layout: str,
        normalize_loudness: bool = True,
        crf: int = 20,
        burn_subtitles: bool = True,
    ) -> RenderJob:
        project = db.get(Project, project_id)
        if project is None:
            raise NotFoundError("Project not found.", code="project_not_found")
        if not project.video_filename:
            raise ValidationAppError(
                "The project has no video to render.",
                code="video_missing",
            )

        reel = db.get(Reel, reel_id)
        if reel is None or reel.project_id != project_id:
            raise NotFoundError("Reel not found.", code="reel_not_found")
        if not reel.segments:
            raise ValidationAppError(
                "The reel has no segments to render.",
                code="reel_empty",
            )

        from app.services.coherence.service import assert_render_allowed

        assert_render_allowed(db, project_id, reel_id)

        active = db.scalars(
            select(RenderJob).where(
                RenderJob.reel_id == reel_id,
                RenderJob.status.in_(tuple(ACTIVE_RENDER_STATUSES)),
            )
        ).first()
        if active is not None:
            raise ConflictError(
                "A render is already in progress for this reel.",
                code="render_in_progress",
            )

        job = RenderJob(
            project_id=project_id,
            reel_id=reel_id,
            status=RenderJobStatus.queued,
            stage="queued",
            aspect_ratio=aspect_ratio or reel.aspect_ratio.value,
            layout=layout,
            progress=0.0,
            processed_seconds=0.0,
        )
        db.add(job)
        project.status = ProjectStatus.rendering
        db.commit()
        db.refresh(job)

        with self._lock:
            self._cancel_events[job.id] = threading.Event()

        future = self._executor.submit(
            self._run_job, job.id, normalize_loudness, crf, burn_subtitles
        )
        with self._lock:
            self._futures[job.id] = future

        db.refresh(job)
        return job

    def get(self, db: Session, job_id: UUID) -> RenderJob:
        job = db.get(RenderJob, job_id)
        if job is None:
            raise NotFoundError("Render job not found.", code="render_job_not_found")
        return job

    def list_for_reel(self, db: Session, reel_id: UUID) -> list[RenderJob]:
        return list(
            db.scalars(
                select(RenderJob)
                .where(RenderJob.reel_id == reel_id)
                .order_by(RenderJob.created_at.desc())
            ).all()
        )

    def get_latest_for_reel(self, db: Session, reel_id: UUID) -> RenderJob | None:
        return db.scalars(
            select(RenderJob)
            .where(RenderJob.reel_id == reel_id)
            .order_by(RenderJob.created_at.desc())
        ).first()

    def cancel(self, db: Session, job_id: UUID) -> RenderJob:
        job = self.get(db, job_id)
        if job.status not in ACTIVE_RENDER_STATUSES:
            return job

        with self._lock:
            event = self._cancel_events.get(job_id)
        if event is not None:
            event.set()

        if job.status in {RenderJobStatus.queued, RenderJobStatus.running}:
            job.status = RenderJobStatus.cancelling
            job.stage = "cancelling"
            db.commit()
            db.refresh(job)
        return job

    def output_path(self, job: RenderJob) -> Path:
        """Resolve the on-disk render output, rejecting path traversal."""
        if not job.output_filename:
            raise NotFoundError("Render has no output yet.", code="render_output_missing")
        directory = project_renders_dir(job.project_id).resolve()
        candidate = (directory / Path(job.output_filename).name).resolve()
        if not candidate.is_relative_to(directory):
            raise ValidationAppError("Invalid output path.", code="invalid_path")
        if not candidate.is_file():
            raise NotFoundError("Render file is missing on disk.", code="render_output_missing")
        return candidate

    # ---- internals --------------------------------------------------------

    def _event_for(self, job_id: UUID) -> threading.Event:
        with self._lock:
            event = self._cancel_events.get(job_id)
            if event is None:
                event = threading.Event()
                self._cancel_events[job_id] = event
            return event

    def _discard(self, job_id: UUID) -> None:
        with self._lock:
            self._cancel_events.pop(job_id, None)
            self._futures.pop(job_id, None)

    def _run_job(
        self,
        job_id: UUID,
        normalize_loudness: bool,
        crf: int,
        burn_subtitles: bool = True,
    ) -> None:
        session = self._session_factory()
        event = self._event_for(job_id)
        temp_path: Path | None = None
        log_path: Path | None = None
        ass_path: Path | None = None
        fonts_dir: Path | None = None
        end_card_image: Path | None = None

        try:
            job = session.get(RenderJob, job_id)
            if job is None:
                return
            if event.is_set():
                self._mark_cancelled(session, job)
                return

            job.status = RenderJobStatus.running
            job.started_at = _utc_now()
            job.stage = "preparing"
            job.progress = 0.01
            session.commit()

            project = session.get(Project, job.project_id)
            reel = session.get(Reel, job.reel_id)
            if project is None or not project.video_filename:
                raise ValidationAppError(
                    "The project video is no longer available.", code="video_missing"
                )
            if reel is None or not reel.segments:
                raise ValidationAppError("The reel has no segments.", code="reel_empty")

            source = storage.resolve_inside_project(job.project_id, project.video_filename)
            if not source.is_file():
                raise ValidationAppError(
                    "The project video file is missing on disk.", code="video_missing"
                )

            ffmpeg = self._ffmpeg_locator()
            if ffmpeg is None:
                raise AppError(
                    "FFmpeg is not available on this system.",
                    code="ffmpeg_missing",
                    status_code=503,
                )

            metadata = self._prober(source)
            has_audio = bool(getattr(metadata, "audio_codec", None))
            probed_fps = getattr(metadata, "fps", None)

            segments = [
                RenderSegmentSpec(
                    start=item.source_start_seconds,
                    end=item.source_end_seconds,
                    transition_type=item.transition_type.value,
                    transition_duration_ms=item.transition_duration_ms,
                )
                for item in sorted(reel.segments, key=lambda s: s.order)
            ]

            # Optional vertical reframing from subject tracking / manual boxes.
            try:
                from app.services.tracking.crop_ffmpeg import build_piecewise_expr
                from app.services.tracking.geometry import decimate_keyframes
                from app.services.tracking.service import build_crop_plans_for_reel
                from app.services.tracking.types import FramingMode

                layout_for_plans = job.layout
                plans = build_crop_plans_for_reel(
                    session, job.project_id, job.reel_id, layout_override=layout_for_plans
                )
                enriched: list[RenderSegmentSpec] = []
                for spec, plan in zip(segments, plans, strict=False):
                    override = plan.mode.value
                    crop_x = plan.static_x
                    crop_y = plan.static_y
                    x_expr = y_expr = None
                    if plan.mode == FramingMode.auto_track and plan.keyframes:
                        keys = decimate_keyframes(list(plan.keyframes))
                        x_expr = build_piecewise_expr(keys, axis="x")
                        y_expr = build_piecewise_expr(keys, axis="y")
                        crop_x = crop_y = None
                    if plan.unstable or plan.mode == FramingMode.blurred_background:
                        override = FramingMode.blurred_background.value
                        x_expr = y_expr = None
                        crop_x = crop_y = None
                    enriched.append(
                        RenderSegmentSpec(
                            start=spec.start,
                            end=spec.end,
                            transition_type=spec.transition_type,
                            transition_duration_ms=spec.transition_duration_ms,
                            layout_override=override,
                            crop_x=crop_x,
                            crop_y=crop_y,
                            crop_x_expr=x_expr,
                            crop_y_expr=y_expr,
                        )
                    )
                segments = enriched
            except Exception as exc:  # noqa: BLE001 — tracking must never block render
                logger = __import__("logging").getLogger(__name__)
                logger.warning("Framing plans unavailable, using layout=%s: %s", job.layout, exc)

            renders_dir = project_renders_dir(job.project_id)
            temp_dir = project_render_temp_dir(job.project_id)
            temp_dir.mkdir(parents=True, exist_ok=True)
            temp_path = temp_dir / f"render-{job_id}.mp4"
            log_path = temp_dir / f"render-{job_id}.log"
            ass_path = temp_dir / f"render-{job_id}.ass"
            fonts_dir = temp_dir / f"fonts-{job_id}"
            end_card_image = temp_dir / f"endcard-{job_id}.png"

            ass_file: Path | None = None
            try:
                transcript = transcripts_service.get_transcript_for_project(
                    session, job.project_id
                )
            except NotFoundError:
                transcript = None

            from app.services.render.args import canvas_for

            preview_w, preview_h = canvas_for(job.aspect_ratio)
            artifacts = None
            if burn_subtitles:
                artifacts = build_subtitle_artifacts(
                    reel=reel,
                    transcript=transcript,
                    output_width=preview_w,
                    output_height=preview_h,
                    ass_path=ass_path,
                    fonts_dir=fonts_dir,
                )
            if artifacts is not None:
                ass_file, _font, _cues = artifacts

            # The end card is mandatory: every render closes with it.
            job.stage = "end_card"
            session.commit()
            end_card_config = resolve_end_card(session, job.project_id)
            end_card_spec = build_end_card_spec(
                project=project,
                config=end_card_config,
                width=preview_w,
                height=preview_h,
                image_path=end_card_image,
                main_content_end_seconds=segments[-1].end,
                source_duration_seconds=getattr(metadata, "duration_seconds", None),
            )

            try:
                plan = build_render_command(
                    ffmpeg=ffmpeg,
                    source=source,
                    segments=segments,
                    aspect_ratio=job.aspect_ratio,
                    layout=job.layout,
                    output_path=temp_path,
                    has_audio=has_audio,
                    fps=probed_fps,
                    normalize_loudness=normalize_loudness,
                    crf=crf,
                    ass_path=ass_file,
                    fonts_dir=fonts_dir if ass_file is not None else None,
                    end_card=end_card_spec,
                )
            except ValueError as exc:
                raise ValidationAppError(str(exc), code="invalid_render_options") from exc

            sanitized = format_command_for_log(plan.args)
            logger.info("Render %s FFmpeg command: %s", job_id, sanitized)

            job.ffmpeg_command = sanitized[:8000]
            job.width = plan.width
            job.height = plan.height
            job.fps = plan.fps
            job.total_seconds = plan.expected_duration_seconds
            job.stage = "encoding"
            job.progress = 0.03
            session.commit()

            total = plan.expected_duration_seconds or 0.0
            last_commit = time.monotonic()

            def on_progress(update: ProgressUpdate) -> None:
                nonlocal last_commit
                if update.out_time_seconds is not None:
                    job.processed_seconds = update.out_time_seconds
                    if total > 0:
                        ratio = max(0.0, min(update.out_time_seconds / total, 1.0))
                        job.progress = round(0.03 + 0.94 * ratio, 4)
                if update.speed is not None:
                    job.speed = update.speed
                now = time.monotonic()
                if now - last_commit >= _PROGRESS_COMMIT_INTERVAL:
                    session.commit()
                    last_commit = now

            result = self._runner(
                plan.args,
                on_progress=on_progress,
                cancel_event=event,
                log_path=log_path,
            )

            if getattr(result, "cancelled", False) or event.is_set():
                self._mark_cancelled(session, job)
                return

            if not temp_path.is_file():
                raise AppError(
                    "FFmpeg finished but produced no output file.",
                    code="render_failed",
                    status_code=500,
                )

            job.stage = "finalizing"
            job.progress = 0.98
            session.commit()

            stem = _slugify(reel.title)
            final_path = unique_output_path(renders_dir, stem)
            temp_path.replace(final_path)
            temp_path = None

            job.output_filename = final_path.name
            job.output_size_bytes = final_path.stat().st_size
            job.status = RenderJobStatus.completed
            job.stage = "completed"
            job.progress = 1.0
            job.processed_seconds = total
            job.finished_at = _utc_now()

            if project.status == ProjectStatus.rendering:
                project.status = ProjectStatus.completed
            session.commit()
        except FFmpegError as exc:
            session.rollback()
            self._mark_failed(session, job_id, f"FFmpeg failed: {exc.stderr_tail or exc}")
        except Exception as exc:  # noqa: BLE001 — persist failure for the UI
            session.rollback()
            self._mark_failed(session, job_id, str(exc))
        finally:
            self._cleanup(temp_path, log_path, ass_path, fonts_dir, end_card_image)
            self._discard(job_id)
            session.close()

    def _cleanup(
        self,
        temp_path: Path | None,
        log_path: Path | None,
        ass_path: Path | None = None,
        fonts_dir: Path | None = None,
        end_card_image: Path | None = None,
    ) -> None:
        if self._keep_temp:
            return
        for path in (temp_path, log_path, ass_path, end_card_image):
            if path is not None and path.exists():
                try:
                    path.unlink()
                except OSError:
                    logger.warning("Could not remove temp file %s", path)
        if fonts_dir is not None and fonts_dir.exists():
            shutil.rmtree(fonts_dir, ignore_errors=True)

    def _mark_cancelled(self, session: Session, job: RenderJob) -> None:
        job.status = RenderJobStatus.cancelled
        job.stage = "cancelled"
        job.finished_at = _utc_now()
        project = session.get(Project, job.project_id)
        if project is not None and project.status == ProjectStatus.rendering:
            project.status = ProjectStatus.editing
        session.commit()

    def _mark_failed(self, session: Session, job_id: UUID, message: str) -> None:
        job = session.get(RenderJob, job_id)
        if job is None:
            return
        job.status = RenderJobStatus.failed
        job.stage = "failed"
        job.error_message = message[:4000]
        job.finished_at = _utc_now()
        project = session.get(Project, job.project_id)
        if project is not None and project.status == ProjectStatus.rendering:
            project.status = ProjectStatus.failed
            project.error_message = message[:2000]
        session.commit()


_manager: RenderManager | None = None


def get_render_manager() -> RenderManager:
    """Return the process-wide render manager (FastAPI dependency)."""
    global _manager
    if _manager is None:
        from app.db.session import SessionLocal

        _manager = RenderManager(session_factory=SessionLocal)
    return _manager

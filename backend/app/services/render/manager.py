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
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ConflictError, NotFoundError, ValidationAppError
from app.core.paths import project_render_temp_dir, project_renders_dir
from app.models.export_profile import ExportQuality
from app.models.project import Project, ProjectStatus
from app.models.reel import Reel
from app.models.render_job import ACTIVE_RENDER_STATUSES, RenderJob, RenderJobStatus
from app.services import storage
from app.services.endcard import resolve as resolve_end_card
from app.services.endcard.pipeline import build_end_card_spec
from app.services.export_profiles.naming import build_export_stem
from app.services.export_profiles.report import (
    build_render_report,
    sha256_file,
    write_render_report,
)
from app.services.export_profiles.service import (
    assert_duration_allowed,
    clip_index_for_reel,
    default_profile,
    fragmentation_note,
    get_profile,
    resolve_encode,
)
from app.services.export_profiles.verify import VerifyExpectation, verify_render_output
from app.services.ffprobe import probe_video
from app.services.render.args import (
    RenderSegmentSpec,
    build_render_command,
    format_command_for_log,
)
from app.services.render.progress import ProgressUpdate
from app.services.render.runner import FFmpegError, run_ffmpeg
from app.services.subtitles import build_subtitle_artifacts, options_for_reel
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
    from app.services.export_profiles.naming import slugify

    return slugify(value, fallback=fallback, max_len=60)


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
        crf: int | None = None,
        burn_subtitles: bool = True,
        profile_id: UUID | None = None,
        quality: str | ExportQuality = ExportQuality.standard,
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

        profile = (
            get_profile(db, profile_id) if profile_id is not None else default_profile(db)
        )
        quality_enum = (
            quality if isinstance(quality, ExportQuality) else ExportQuality(quality)
        )
        encode = resolve_encode(profile, quality_enum, crf_override=crf)

        content_duration = sum(
            max(0.0, seg.source_end_seconds - seg.source_start_seconds)
            for seg in reel.segments
        )
        # Approximate end-card pad for the profile duration gate.
        assert_duration_allowed(profile, content_duration + 5.0)

        job = RenderJob(
            project_id=project_id,
            reel_id=reel_id,
            status=RenderJobStatus.queued,
            stage="queued",
            aspect_ratio=aspect_ratio or profile.aspect_ratio or reel.aspect_ratio.value,
            layout=layout,
            progress=0.0,
            processed_seconds=0.0,
            profile_id=profile.id,
            profile_slug=profile.slug,
            profile_name=profile.name,
            quality=quality_enum.value,
            crf=encode.crf,
            encode_preset=encode.encode_preset,
            audio_bitrate_k=encode.audio_bitrate_k,
            expected_audio=True,
            publish_status="local_only",
            verified=False,
        )
        db.add(job)
        project.status = ProjectStatus.rendering
        db.commit()
        db.refresh(job)

        with self._lock:
            self._cancel_events[job.id] = threading.Event()

        future = self._executor.submit(
            self._run_job, job.id, normalize_loudness, burn_subtitles
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

            # Resolve export profile encode settings (defaults if job has none — legacy).
            profile = None
            if job.profile_id is not None:
                try:
                    profile = get_profile(session, job.profile_id)
                except NotFoundError:
                    profile = None
            if profile is None:
                profile = default_profile(session)
                job.profile_id = profile.id
                job.profile_slug = profile.slug
                job.profile_name = profile.name

            quality_enum = ExportQuality(job.quality or ExportQuality.standard.value)
            encode = resolve_encode(
                profile,
                quality_enum,
                crf_override=job.crf,
            )
            job.crf = encode.crf
            job.encode_preset = encode.encode_preset
            job.audio_bitrate_k = encode.audio_bitrate_k
            job.quality = quality_enum.value
            job.publish_status = "local_only"
            job.expected_audio = True

            preview_w, preview_h = profile.width, profile.height
            job.aspect_ratio = profile.aspect_ratio

            subtitle_options = options_for_reel(reel).with_overrides(
                margin_bottom=encode.subtitle_margin_bottom
            )

            artifacts = None
            if burn_subtitles:
                artifacts = build_subtitle_artifacts(
                    reel=reel,
                    transcript=transcript,
                    output_width=preview_w,
                    output_height=preview_h,
                    ass_path=ass_path,
                    fonts_dir=fonts_dir,
                    options=subtitle_options,
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

            # Optional user-provided background music (off unless preset ≠ none).
            from dataclasses import replace

            from app.core.config import get_settings as get_app_settings
            from app.models.background_music import BackgroundMusicScope
            from app.services.background_music.service import get_settings_row, resolve_spec
            from app.services.render.args import LoudnessSpec

            music_spec = resolve_spec(session, job.project_id)
            bg_row = get_settings_row(session, job.project_id)
            app_settings = get_app_settings()
            loudness = LoudnessSpec(
                target_lufs=(
                    bg_row.target_lufs if bg_row is not None else app_settings.target_lufs
                ),
                true_peak_db=(
                    bg_row.true_peak_db if bg_row is not None else app_settings.true_peak_db
                ),
                lra=app_settings.loudness_lra,
            )

            if (
                music_spec is not None
                and music_spec.scope == BackgroundMusicScope.end_card_only
                and end_card_spec.music_path is None
            ):
                # Prefer the dedicated end-card music upload when present;
                # otherwise drive the closing bed from the project BGM file.
                end_card_spec = replace(
                    end_card_spec,
                    audio_mode="local_music",
                    music_path=music_spec.path,
                    music_volume=music_spec.volume,
                    music_start_seconds=music_spec.start_seconds,
                    music_end_seconds=music_spec.end_seconds,
                    music_fade_in_seconds=music_spec.fade_in_seconds,
                    music_fade_out_seconds=music_spec.fade_out_seconds,
                )

            full_reel_music = (
                music_spec
                if music_spec is not None and music_spec.scope == BackgroundMusicScope.full_reel
                else None
            )

            # FPS: profile may force 30; otherwise keep the source rate.
            encode_fps = encode.fps_override if encode.fps_override is not None else probed_fps

            try:
                plan = build_render_command(
                    ffmpeg=ffmpeg,
                    source=source,
                    segments=segments,
                    aspect_ratio=job.aspect_ratio,
                    layout=job.layout,
                    output_path=temp_path,
                    has_audio=has_audio,
                    fps=encode_fps,
                    normalize_loudness=normalize_loudness,
                    crf=encode.crf,
                    preset=encode.encode_preset,
                    audio_bitrate_k=encode.audio_bitrate_k,
                    canvas_width=preview_w,
                    canvas_height=preview_h,
                    ass_path=ass_file,
                    fonts_dir=fonts_dir if ass_file is not None else None,
                    end_card=end_card_spec,
                    background_music=full_reel_music,
                    loudness=loudness,
                )
            except ValueError as exc:
                raise ValidationAppError(str(exc), code="invalid_render_options") from exc

            assert_duration_allowed(profile, plan.expected_duration_seconds)
            frag_note = fragmentation_note(profile, plan.expected_duration_seconds)

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
                        job.progress = round(0.03 + 0.90 * ratio, 4)
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

            if event.is_set():
                self._mark_cancelled(session, job)
                return

            job.stage = "verifying"
            job.progress = 0.94
            session.commit()

            clip_index = clip_index_for_reel(session, job.project_id, job.reel_id)
            stem = build_export_stem(
                project_title=project.title or reel.title,
                clip_index=clip_index,
                profile_slug=profile.slug,
            )
            final_path = unique_output_path(renders_dir, stem)
            temp_path.replace(final_path)
            temp_path = None

            if event.is_set():
                # Cancel won the race after rename — remove output and mark cancelled.
                try:
                    final_path.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not remove cancelled render %s", final_path)
                self._mark_cancelled(session, job)
                return

            verify = verify_render_output(
                final_path,
                VerifyExpectation(
                    width=plan.width,
                    height=plan.height,
                    expect_audio=True,
                    expected_duration_seconds=plan.expected_duration_seconds,
                ),
                prober=self._prober,
            )
            if not verify.ok:
                job.output_filename = final_path.name
                job.output_size_bytes = final_path.stat().st_size if final_path.is_file() else None
                job.verified = False
                job.status = RenderJobStatus.failed
                job.stage = "failed"
                job.error_message = "; ".join(verify.errors)[:4000]
                job.finished_at = _utc_now()
                if project is not None:
                    _sync_project_status_after_render(
                        session,
                        project,
                        preferred=ProjectStatus.failed,
                        error_message=job.error_message[:2000],
                    )
                session.commit()
                return

            if event.is_set():
                try:
                    final_path.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not remove cancelled render %s", final_path)
                self._mark_cancelled(session, job)
                return

            job.stage = "finalizing"
            job.progress = 0.97
            session.commit()

            digest = sha256_file(final_path)
            size_bytes = final_path.stat().st_size
            report_name = f"{final_path.stem}.report.json"
            report_path = renders_dir / report_name
            meta = verify.metadata
            report = build_render_report(
                job_id=job.id,
                project_id=job.project_id,
                reel_id=job.reel_id,
                profile_slug=job.profile_slug,
                profile_name=job.profile_name,
                quality=job.quality,
                status=RenderJobStatus.completed.value,
                output_filename=final_path.name,
                output_path=final_path,
                sha256=digest,
                duration_seconds=meta.duration_seconds if meta else plan.expected_duration_seconds,
                width=meta.width if meta else plan.width,
                height=meta.height if meta else plan.height,
                fps=meta.fps if meta else plan.fps,
                size_bytes=size_bytes,
                crf=job.crf,
                encode_preset=job.encode_preset,
                audio_bitrate_k=job.audio_bitrate_k,
                verified=True,
                ffmpeg_command=job.ffmpeg_command,
                created_at=job.created_at,
                finished_at=_utc_now(),
                extra={
                    "fragmentation_note": frag_note,
                    "safe_area": {
                        "margin_x": profile.safe_margin_x,
                        "top": profile.safe_top,
                        "bottom": profile.safe_bottom,
                    },
                },
            )
            write_render_report(report_path, report)

            if event.is_set():
                try:
                    final_path.unlink(missing_ok=True)
                    report_path.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not remove cancelled render artifacts")
                self._mark_cancelled(session, job)
                return

            job.output_filename = final_path.name
            job.output_size_bytes = size_bytes
            job.sha256 = digest
            job.report_filename = report_name
            job.verified = True
            if meta is not None:
                # Keep the planned timeline in ``total_seconds``; probed values
                # already validated resolution / audio / non-zero duration.
                if meta.width is not None:
                    job.width = meta.width
                if meta.height is not None:
                    job.height = meta.height
                if meta.fps is not None:
                    job.fps = meta.fps
            job.status = RenderJobStatus.completed
            job.stage = "completed"
            job.progress = 1.0
            job.processed_seconds = total
            job.finished_at = _utc_now()

            if project is not None:
                _sync_project_status_after_render(
                    session, project, preferred=ProjectStatus.completed
                )
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
        if project is not None:
            _sync_project_status_after_render(
                session, project, preferred=ProjectStatus.editing
            )
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
        if project is not None:
            _sync_project_status_after_render(
                session, project, preferred=ProjectStatus.failed, error_message=message[:2000]
            )
        session.commit()

    def shutdown(self, wait: bool = False) -> None:
        """Cancel in-flight renders and stop the executor."""
        with self._lock:
            for event in self._cancel_events.values():
                event.set()
        shutdown = getattr(self._executor, "shutdown", None)
        if callable(shutdown):
            shutdown(wait=wait)


def _project_has_active_renders(session: Session, project_id: UUID) -> bool:
    return (
        session.scalars(
            select(RenderJob.id).where(
                RenderJob.project_id == project_id,
                RenderJob.status.in_(tuple(ACTIVE_RENDER_STATUSES)),
            )
        ).first()
        is not None
    )


def _sync_project_status_after_render(
    session: Session,
    project: Project,
    *,
    preferred: ProjectStatus,
    error_message: str | None = None,
) -> None:
    """Update project status only when no other render jobs remain active."""
    if _project_has_active_renders(session, project.id):
        project.status = ProjectStatus.rendering
        return
    project.status = preferred
    if error_message is not None and preferred == ProjectStatus.failed:
        project.error_message = error_message


_manager: RenderManager | None = None


def get_render_manager() -> RenderManager:
    """Return the process-wide render manager (FastAPI dependency)."""
    global _manager
    if _manager is None:
        from app.db.session import SessionLocal

        _manager = RenderManager(session_factory=SessionLocal)
    return _manager

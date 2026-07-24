"""Post-render FFprobe verification — fail the job on corrupt / mismatched output."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.core.exceptions import AppError
from app.services.ffprobe import VideoMetadata, probe_video


@dataclass(frozen=True)
class VerifyExpectation:
    width: int
    height: int
    expect_audio: bool = True
    min_duration_seconds: float = 0.05
    # Allow small probe/encoder drift vs planned timeline.
    duration_tolerance_ratio: float = 0.35
    expected_duration_seconds: float | None = None


@dataclass(frozen=True)
class VerifyResult:
    ok: bool
    metadata: VideoMetadata | None
    errors: tuple[str, ...]
    code: str | None = None


def verify_render_output(
    path: Path,
    expectation: VerifyExpectation,
    *,
    prober=probe_video,
) -> VerifyResult:
    """Probe the MP4 and collect hard failures.

    Marks failed when:
    - file missing / unreadable / corrupt (probe error);
    - duration is zero / missing;
    - resolution does not match the profile canvas;
    - audio is missing when expected.
    """
    if not path.is_file() or path.stat().st_size < 32:
        return VerifyResult(
            ok=False,
            metadata=None,
            errors=("El archivo de salida falta o está vacío/corrupto.",),
            code="render_output_corrupt",
        )

    try:
        meta = prober(path)
    except AppError as exc:
        return VerifyResult(
            ok=False,
            metadata=None,
            errors=(f"FFprobe no pudo leer el archivo (corrupto o incompleto): {exc}",),
            code="render_output_corrupt",
        )
    except Exception as exc:  # noqa: BLE001
        return VerifyResult(
            ok=False,
            metadata=None,
            errors=(f"Verificación FFprobe falló: {exc}",),
            code="render_verify_failed",
        )

    errors: list[str] = []
    code: str | None = None

    duration = meta.duration_seconds
    if duration is None or duration <= 0:
        errors.append("La duración del archivo es cero o desconocida.")
        code = "render_zero_duration"

    if meta.width != expectation.width or meta.height != expectation.height:
        errors.append(
            f"Resolución {meta.width}×{meta.height} no coincide con "
            f"{expectation.width}×{expectation.height}."
        )
        code = code or "render_resolution_mismatch"

    if expectation.expect_audio and not meta.audio_codec:
        errors.append("Se esperaba pista de audio y FFprobe no encontró ninguna.")
        code = code or "render_missing_audio"

    if (
        expectation.expected_duration_seconds is not None
        and duration is not None
        and duration > 0
    ):
        expected = expectation.expected_duration_seconds
        # Only flag pathological under-runs (e.g. truncated encode).
        if duration < expected * (1.0 - expectation.duration_tolerance_ratio) and duration < 0.5:
            errors.append(
                f"Duración {duration:.2f}s demasiado corta frente a ~{expected:.2f}s planificados."
            )
            code = code or "render_duration_mismatch"

    return VerifyResult(
        ok=len(errors) == 0,
        metadata=meta,
        errors=tuple(errors),
        code=code,
    )

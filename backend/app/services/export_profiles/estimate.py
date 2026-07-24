"""Approximate output size estimates for export profiles."""

from __future__ import annotations

from dataclasses import dataclass

from app.models.export_profile import ExportProfile, ExportQuality


@dataclass(frozen=True)
class SizeEstimate:
    duration_seconds: float
    width: int
    height: int
    fps: float
    crf: int
    audio_bitrate_k: int
    estimated_bytes: int
    estimated_mb: float
    note: str


# Bits-per-pixel heuristics for H.264 at 1080p-class content (spoken video).
_BPP_BY_QUALITY: dict[ExportQuality, float] = {
    ExportQuality.draft: 0.035,
    ExportQuality.standard: 0.055,
    ExportQuality.high: 0.085,
}


def estimate_size(
    *,
    profile: ExportProfile,
    quality: ExportQuality,
    duration_seconds: float,
    fps: float,
    crf: int | None = None,
    audio_bitrate_k: int | None = None,
) -> SizeEstimate:
    """Rough byte estimate — not a guarantee, shown before export."""
    duration = max(0.5, duration_seconds)
    frame_rate = max(12.0, min(fps, 60.0))
    resolved_crf = crf if crf is not None else crf_for(profile, quality)
    audio_k = (
        audio_bitrate_k if audio_bitrate_k is not None else audio_bitrate_for(profile, quality)
    )

    bpp = _BPP_BY_QUALITY.get(quality, 0.055)
    # Higher CRF → fewer bits; scale relative to CRF 23.
    bpp *= 23.0 / max(14.0, float(resolved_crf))
    if profile.prefer_small_file:
        bpp *= 0.75

    video_bps = profile.width * profile.height * frame_rate * bpp
    audio_bps = audio_k * 1000.0
    total_bytes = int((video_bps + audio_bps) * duration / 8.0)
    mb = round(total_bytes / (1024 * 1024), 2)
    return SizeEstimate(
        duration_seconds=duration,
        width=profile.width,
        height=profile.height,
        fps=frame_rate,
        crf=resolved_crf,
        audio_bitrate_k=audio_k,
        estimated_bytes=total_bytes,
        estimated_mb=mb,
        note="Estimación aproximada; el tamaño real depende del contenido y del encoder.",
    )


def crf_for(profile: ExportProfile, quality: ExportQuality) -> int:
    mapping = {
        ExportQuality.draft: profile.crf_draft,
        ExportQuality.standard: profile.crf_standard,
        ExportQuality.high: profile.crf_high,
    }
    return int(mapping[quality])


def encode_preset_for(profile: ExportProfile, quality: ExportQuality) -> str:
    mapping = {
        ExportQuality.draft: profile.preset_draft,
        ExportQuality.standard: profile.preset_standard,
        ExportQuality.high: profile.preset_high,
    }
    return str(mapping[quality])


def audio_bitrate_for(profile: ExportProfile, quality: ExportQuality) -> int:
    mapping = {
        ExportQuality.draft: profile.audio_bitrate_draft_k,
        ExportQuality.standard: profile.audio_bitrate_standard_k,
        ExportQuality.high: profile.audio_bitrate_high_k,
    }
    return int(mapping[quality])

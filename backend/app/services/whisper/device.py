"""Compute-device selection for faster-whisper.

faster-whisper is built on CTranslate2, which supports CUDA and CPU only.
Apple's Metal/MPS GPU is **not** supported, so on Apple Silicon we always run on
CPU and say so clearly instead of pretending to use the GPU.
"""

from __future__ import annotations

import platform
from dataclasses import dataclass

APPLE_SILICON_NOTICE = (
    "En Apple Silicon, faster-whisper (CTranslate2) se ejecuta en CPU: Metal/GPU "
    "no está soportado. La transcripción puede ser lenta; usa un modelo más "
    "pequeño (por ejemplo «small») para mayor rapidez."
)


@dataclass(frozen=True)
class DeviceSelection:
    """Resolved device and compute type for a transcription run."""

    device: str  # "cuda" | "cpu"
    compute_type: str  # e.g. "float16", "int8"
    is_apple_silicon: bool
    notice: str | None


def is_apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() == "arm64"


def _cuda_available() -> bool:
    """Best-effort CUDA detection without hard dependencies.

    Tries CTranslate2 first (the actual backend), then torch. Any import or
    runtime failure is treated as "no CUDA".
    """
    try:
        import ctranslate2  # type: ignore

        if ctranslate2.get_cuda_device_count() > 0:  # type: ignore[attr-defined]
            return True
    except Exception:
        pass
    try:
        import torch  # type: ignore

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def select_device(preference: str = "auto", compute_type: str = "auto") -> DeviceSelection:
    """Resolve the device/compute type from a preference.

    ``preference`` is one of "auto", "cuda", "cpu". We never claim CUDA unless it
    is actually available; on Apple Silicon we attach a clear CPU notice.
    """
    pref = (preference or "auto").lower()
    apple = is_apple_silicon()

    if pref == "cuda":
        device = "cuda" if _cuda_available() else "cpu"
    elif pref == "cpu":
        device = "cpu"
    else:  # auto
        device = "cuda" if _cuda_available() else "cpu"

    if compute_type and compute_type.lower() != "auto":
        resolved_compute = compute_type
    else:
        resolved_compute = "float16" if device == "cuda" else "int8"

    notice: str | None = None
    if device == "cpu" and apple:
        notice = APPLE_SILICON_NOTICE
    elif pref == "cuda" and device == "cpu":
        notice = "Se solicitó CUDA pero no está disponible; se usará CPU."

    return DeviceSelection(
        device=device,
        compute_type=resolved_compute,
        is_apple_silicon=apple,
        notice=notice,
    )

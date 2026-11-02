import pytest
from app.services.audio.voice_center import build_voice_center_filter, voice_center_gains


def test_passthrough_at_zero() -> None:
    assert voice_center_gains(0) == (1.0, 0.0)
    assert build_voice_center_filter(0) is None
    assert build_voice_center_filter(0.004) is None


def test_mixes_right_into_left() -> None:
    keep, mix = voice_center_gains(0.35)
    assert keep == pytest.approx(1 / 1.35)
    assert mix == pytest.approx(0.35 / 1.35)
    filt = build_voice_center_filter(0.35)
    assert filt is not None
    assert filt.startswith("pan=stereo|c0=")
    assert "*c1|c1=c1" in filt

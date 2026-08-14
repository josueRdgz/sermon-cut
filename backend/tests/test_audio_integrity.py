from app.services.audio_integrity import AvAlignment


def test_aligned_media_does_not_need_heal() -> None:
    aligned = AvAlignment(
        video_start=0.0,
        audio_start=0.0,
        video_duration=40.0,
        audio_duration=40.0,
    )
    assert aligned.needs_heal() is False


def test_aac_frame_rounding_does_not_need_heal() -> None:
    """Stream-copy cuts often leave ~20–200 ms of container clock noise."""
    mild = AvAlignment(
        video_start=0.0,
        audio_start=0.12,
        video_duration=40.0,
        audio_duration=39.75,
    )
    assert mild.needs_heal() is False


def test_large_start_or_duration_drift_needs_heal() -> None:
    late_audio = AvAlignment(
        video_start=0.0,
        audio_start=0.20,
        video_duration=40.0,
        audio_duration=40.0,
    )
    short_audio = AvAlignment(
        video_start=0.0,
        audio_start=0.0,
        video_duration=40.0,
        audio_duration=39.5,
    )
    assert late_audio.needs_heal() is True
    assert short_audio.needs_heal() is True

from app.services.sermon_range import should_trim


def test_should_trim_skips_nearly_full_window() -> None:
    assert should_trim(start=0, end=125.5, duration=125.5) is False
    assert should_trim(start=20, end=60, duration=125.5) is True
    assert should_trim(start=0, end=1, duration=0) is False

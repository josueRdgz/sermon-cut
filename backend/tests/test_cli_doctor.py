"""Smoke tests for ``python -m app.cli doctor``."""

from __future__ import annotations

from app.cli.doctor import collect_checks, run_doctor


def test_collect_checks_includes_core_names() -> None:
    names = {item.name for item in collect_checks()}
    assert "python" in names
    assert "ffmpeg" in names
    assert "ffprobe" in names
    assert "sqlite" in names
    assert "gemini" in names
    assert "whisper_package" in names


def test_run_doctor_returns_int(capsys) -> None:
    code = run_doctor(as_json=False)
    assert code in {0, 1}
    out = capsys.readouterr().out
    assert "Sermon Cut" in out or "python" in out.lower()

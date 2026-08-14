from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from app.core import paths
from app.services.media_audio import preview_audio_path


def test_preview_audio_uses_cached_extract_from_current_video(
    tmp_path: Path, monkeypatch: object
) -> None:
    monkeypatch.setattr(paths, "PROJECTS_DIR", tmp_path)
    project_id = uuid4()
    project_dir = tmp_path / str(project_id)
    project_dir.mkdir()
    video = project_dir / "video.mp4"
    video.write_bytes(b"video")
    cached = project_dir / "preview-audio.m4a"
    cached.write_bytes(b"\x00" * 2048)

    result = preview_audio_path(project_id, "video.mp4")
    assert result == cached


def test_preview_audio_ignores_repair_wavs(tmp_path: Path, monkeypatch: object) -> None:
    monkeypatch.setattr(paths, "PROJECTS_DIR", tmp_path)
    project_id = uuid4()
    project_dir = tmp_path / str(project_id)
    project_dir.mkdir()
    (project_dir / "repaired-audio.wav").write_bytes(b"RIFF" + b"\x00" * 2048)
    (project_dir / "video.mp4").write_bytes(b"video")

    def fake_extract(
        _ffmpeg: str, _source: Path, destination: Path, _log: Path, *, copy: bool  # noqa: ARG001
    ) -> None:
        destination.write_bytes(b"\x00" * 2048)

    with (
        patch("app.services.media_audio.locate_ffmpeg", return_value="ffmpeg"),
        patch("app.services.media_audio._extract", side_effect=fake_extract),
    ):
        result = preview_audio_path(project_id, "video.mp4")

    assert result.name == "preview-audio.m4a"

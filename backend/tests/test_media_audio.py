from pathlib import Path
from uuid import uuid4

from app.core import paths
from app.services.media_audio import preview_audio_path


def test_preview_audio_reuses_repaired_wav(tmp_path: Path, monkeypatch: object) -> None:
    monkeypatch.setattr(paths, "PROJECTS_DIR", tmp_path)
    project_id = uuid4()
    project_dir = tmp_path / str(project_id)
    project_dir.mkdir()
    audio = project_dir / "repaired-audio.wav"
    audio.write_bytes(b"RIFF" + b"\x00" * 2048)
    (project_dir / "video.mp4").write_bytes(b"video")

    result = preview_audio_path(project_id, "video.mp4")
    assert result == audio

"""In-app settings persist to SERMON_CUT_ENV_FILE without leaking the key."""

from __future__ import annotations

from pathlib import Path

from app.core.config import get_settings
from app.main import create_app
from fastapi.testclient import TestClient


def test_settings_roundtrip_masks_gemini_key(tmp_path: Path, monkeypatch) -> None:
    env_file = tmp_path / "desktop.env"
    env_file.write_text("SERMON_CUT_WHISPER_MODEL=base\n", encoding="utf-8")
    monkeypatch.setenv("SERMON_CUT_ENV_FILE", str(env_file))
    monkeypatch.delenv("SERMON_CUT_GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("SERMON_CUT_AI_PROVIDER", raising=False)
    monkeypatch.delenv("SERMON_CUT_WHISPER_MODEL", raising=False)
    monkeypatch.setenv("SERMON_CUT_AUTO_MIGRATE", "false")
    get_settings.cache_clear()

    with TestClient(create_app()) as client:
        listed = client.get("/api/settings")
        assert listed.status_code == 200
        body = listed.json()
        assert body["whisper_model"] == "base"
        assert body["gemini_configured"] is False
        assert body["gemini_api_key_masked"] is None

        saved = client.put(
            "/api/settings",
            json={
                "gemini_api_key": "test-key-not-a-real-secret",
                "ai_provider": "gemini",
                "whisper_model": "small",
                "gemini_model": "gemini-2.5-flash",
            },
        )
        assert saved.status_code == 200, saved.text
        payload = saved.json()
        assert payload["gemini_configured"] is True
        assert payload["whisper_model"] == "small"
        assert payload["ai_provider"] == "gemini"
        assert payload["gemini_api_key_masked"] == "test…cret"
        assert "test-key-not-a-real-secret" not in saved.text

    raw = env_file.read_text(encoding="utf-8")
    assert "SERMON_CUT_GEMINI_API_KEY=test-key-not-a-real-secret" in raw
    assert "SERMON_CUT_WHISPER_MODEL=small" in raw
    get_settings.cache_clear()

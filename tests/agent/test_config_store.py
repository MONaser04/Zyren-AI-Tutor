import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "agent"))

import config_store  # noqa: E402


def test_resolve_gemini_api_key_priority_and_deletion(tmp_path, monkeypatch):
    appdata_dir = tmp_path / "zyren_appdata"
    dotenv_file = tmp_path / ".env"
    dotenv_file.write_text("GEMINI_API_KEY=AIzaSyDotEnvFallbackKey123456\n", encoding="utf-8")

    monkeypatch.setenv("ZYREN_APPDATA_DIR", str(appdata_dir))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    # 1. With no UI config yet, falls back cleanly to .env
    key, source = config_store.resolve_gemini_api_key(dotenv_path=dotenv_file)
    assert key == "AIzaSyDotEnvFallbackKey123456"
    assert source == "env"

    # 2. When UI writes a verified key atomically, UI key wins over .env
    config_store.write_app_config_atomic(
        {
            "geminiApiKey": "AIzaSyInAppUserKey999999999",
            "keyDeletedByUser": False,
        }
    )
    key, source = config_store.resolve_gemini_api_key(dotenv_path=dotenv_file)
    assert key == "AIzaSyInAppUserKey999999999"
    assert source == "ui"

    # 3. When user explicitly deletes the key in the UI, keyDeletedByUser=True prevents silent .env resurrection
    config_store.write_app_config_atomic(
        {
            "geminiApiKey": "",
            "keyDeletedByUser": True,
        }
    )
    key, source = config_store.resolve_gemini_api_key(dotenv_path=dotenv_file)
    assert key == ""
    assert source == "none"


def test_mask_api_key_hides_middle_secret():
    masked = config_store.mask_api_key("AIzaSyD8374928374928374AbCd")
    assert masked.startswith("AIzaSy")
    assert masked.endswith("AbCd")
    assert "D8374928374928374" not in masked
    assert "•" in masked

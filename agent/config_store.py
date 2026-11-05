import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional, Tuple


APP_FOLDER_NAME = "ZYREN_AI_Tutor"


def get_zyren_appdata_dir() -> Path:
    """
    Returns the OS-standard per-user application data directory for ZYREN AI Tutor:
      - Windows: %APPDATA%\\ZYREN_AI_Tutor
      - macOS:   ~/Library/Application Support/ZYREN_AI_Tutor
      - Linux:   $XDG_CONFIG_HOME/ZYREN_AI_Tutor or ~/.config/ZYREN_AI_Tutor
    Keeping runtime secrets & auto-saved sessions here prevents Vite's project
    watcher from restarting the dev server and keeps git workspaces clean.
    """
    override_dir = os.environ.get("ZYREN_APPDATA_DIR", "").strip()
    if override_dir:
        base = Path(override_dir)
    elif sys.platform == "win32":
        appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        base = Path(appdata) / APP_FOLDER_NAME
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / APP_FOLDER_NAME
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
        base = Path(xdg) / APP_FOLDER_NAME

    base.mkdir(parents=True, exist_ok=True)
    return base


def get_config_file_path() -> Path:
    return get_zyren_appdata_dir() / "config.json"


def read_app_config() -> dict:
    cfg_path = get_config_file_path()
    if not cfg_path.exists():
        return {}
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_app_config_atomic(data: dict) -> None:
    cfg_dir = get_zyren_appdata_dir()
    cfg_path = cfg_dir / "config.json"
    fd, tmp_path = tempfile.mkstemp(prefix="config_", suffix=".tmp", dir=str(cfg_dir))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        if sys.platform != "win32":
            try:
                os.chmod(tmp_path, 0o600)
            except Exception:
                pass
        os.replace(tmp_path, cfg_path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def _read_dotenv_gemini_key(dotenv_path: Optional[Path] = None) -> str:
    if dotenv_path is None:
        dotenv_path = Path(__file__).resolve().parent.parent / ".env"
    if not dotenv_path.exists():
        return ""
    try:
        with open(dotenv_path, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                key_name = k.strip()
                if key_name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
                    cleaned = v.strip().strip('"').strip("'")
                    if len(cleaned) > 5:
                        return cleaned
    except Exception:
        pass
    return ""


def resolve_gemini_api_key(dotenv_path: Optional[Path] = None) -> Tuple[str, str]:
    """
    Resolves the active Gemini API key and its source ('ui', 'env', or 'none').
    Priority:
      1. UI-configured key in OS AppData config.json (if set -> 'ui'; if explicitly deleted -> 'none')
      2. .env file / process environment fallback ('env')
    """
    cfg = read_app_config()
    ui_key = str(cfg.get("geminiApiKey") or "").strip()
    if len(ui_key) > 5:
        return ui_key, "ui"

    if cfg.get("keyDeletedByUser") is True:
        return "", "none"

    env_file_key = _read_dotenv_gemini_key(dotenv_path)
    if len(env_file_key) > 5:
        return env_file_key, "env"

    proc_key = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
    if len(proc_key) > 5:
        return proc_key, "env"

    return "", "none"


def mask_api_key(key: str) -> str:
    cleaned = (key or "").strip()
    if not cleaned:
        return ""
    if len(cleaned) <= 10:
        return cleaned[:2] + "•" * max(4, len(cleaned) - 4) + cleaned[-2:]
    return f"{cleaned[:6]}{'•' * 12}{cleaned[-4:]}"


def get_media_dir() -> Path:
    media_dir = get_zyren_appdata_dir() / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    return media_dir


_EXT_TO_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".ogv": "video/ogg",
    ".ogg": "video/ogg",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
}


def resolve_media_file_path(media_id_or_url: str) -> Optional[Tuple[Path, str, str]]:
    """
    Resolves a slide media item ('media_...', 'media_....mp4', or '/api/media/media_....mp4')
    directly on local disk inside the ZYREN AppData media vault.
    Returns (Path, mime_type, original_file_name) or None if not found.
    """
    raw = str(media_id_or_url or "").strip()
    if not raw:
        return None
    if "/api/media/" in raw:
        raw = raw.split("/api/media/", 1)[1].split("?", 1)[0]
    raw = raw.strip("/\\")
    if not raw or ".." in raw or "/" in raw or "\\" in raw:
        return None

    media_dir = get_media_dir().resolve()
    stem = Path(raw).stem if Path(raw).suffix.lower() in _EXT_TO_MIME else raw
    safe_stem = "".join(c if (c.isalnum() or c in "_-") else "_" for c in stem)[:96]

    meta_path = media_dir / f"{safe_stem}.meta.json"
    if meta_path.is_file():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            stored_name = Path(str(meta.get("storedFileName") or "")).name
            if stored_name:
                candidate = (media_dir / stored_name).resolve()
                if candidate.parent == media_dir and candidate.is_file():
                    mime = str(meta.get("mimeType") or _EXT_TO_MIME.get(candidate.suffix.lower(), "application/octet-stream"))
                    orig_name = str(meta.get("fileName") or stored_name)
                    return candidate, mime, orig_name
        except Exception:
            pass

    direct = (media_dir / Path(raw).name).resolve()
    if direct.parent == media_dir and direct.is_file() and not direct.name.endswith(".meta.json"):
        mime = _EXT_TO_MIME.get(direct.suffix.lower(), "application/octet-stream")
        return direct, mime, direct.name

    for ext, mime in _EXT_TO_MIME.items():
        cand = (media_dir / f"{safe_stem}{ext}").resolve()
        if cand.parent == media_dir and cand.is_file():
            return cand, mime, cand.name

    return None

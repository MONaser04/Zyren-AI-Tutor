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


# ─── Multi-Provider & Intermediate Model Storage Helpers ───────────────────────

PROVIDER_DEFAULT_BASE_URLS: dict[str, str] = {
    "nvidia_nim": "https://integrate.api.nvidia.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
    "clinepass": "https://api.cline.bot/v1",
    "xai": "https://api.x.ai/v1",
    "qwen_cloud_token": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "qwen_cloud_coding": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "together": "https://api.together.xyz/v1",
    "deepinfra": "https://api.deepinfra.com/v1/openai",
    "siliconflow": "https://api.siliconflow.cn/v1",
    "nebius": "https://api.studio.nebius.ai/v1",
    "chutes": "https://chutes.ai/v1",
    "featherless": "https://api.featherless.ai/v1",
    "agnes": "https://api.agnes-ai.com/v1",
    "zenmux": "https://api.zenmux.ai/v1",
    "wandb": "https://api.wandb.ai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "deepseek": "https://api.deepseek.com/v1",
    "mistral": "https://api.mistral.ai/v1",
    "mistral_codestral": "https://codestral.mistral.ai/v1",
    "opencode_zen": "https://api.opencode.ai/v1",
    "opencode_go": "https://go.opencode.ai/v1",
    "vercel_ai_gateway": "https://ai.vercel.app/v1",
    "huggingface": "https://api-inference.huggingface.co/v1",
    "cohere": "https://api.cohere.com/v2",
    "github_models": "https://models.inference.ai.azure.com",
    "water": "https://api.water.ai/v1",
    "kimi": "https://api.moonshot.cn/v1",
    "kimi_code": "https://api.moonshot.cn/v1",
    "kelo": "https://api.kelo.ai/v1",
    "minimax": "https://api.minimax.chat/v1",
    "cerebras": "https://api.cerebras.ai/v1",
    "sambanova": "https://api.sambanova.ai/v1",
    "fireworks": "https://api.fireworks.ai/inference/v1",
    "novita": "https://api.novita.ai/v1",
    "zai_coding": "https://open.bigmodel.cn/api/paas/v4",
    "zai_api": "https://open.bigmodel.cn/api/paas/v4",
    "tokenrouter": "https://api.tokenrouter.io/v1",
    "nararoute": "https://router.bynara.id/v1",
    "poolside": "https://api.poolside.ai/v1",
    "llm7": "https://api.llm7.io/v1",
    "ollama_cloud": "https://api.ollama.com/v1",
    "lmstudio": "http://localhost:1234/v1",
    "llamacpp": "http://localhost:8080/v1",
    "ollama": "http://localhost:11434/v1",
    "custom_openai_compatible": "http://localhost:8000/v1",
}

PROVIDER_ENV_KEYS: dict[str, str] = {
    "nvidia_nim": "NVIDIA_NIM_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "groq": "GROQ_API_KEY",
    "clinepass": "CLINE_API_KEY",
    "xai": "XAI_API_KEY",
    "qwen_cloud_token": "QWENCLOUD_API_KEY",
    "qwen_cloud_coding": "QWENCLOUD_CODING_API_KEY",
    "together": "TOGETHER_API_KEY",
    "deepinfra": "DEEPINFRA_API_KEY",
    "siliconflow": "SILICONFLOW_API_KEY",
    "nebius": "NEBIUS_API_KEY",
    "chutes": "CHUTES_API_KEY",
    "featherless": "FEATHERLESS_API_KEY",
    "agnes": "AGNES_API_KEY",
    "zenmux": "ZENMUX_API_KEY",
    "wandb": "WANDB_API_KEY",
    "azure_openai": "AZURE_OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "google_vertex": "VERTEX_PROJECT_ID",
    "deepseek": "DEEPSEEK_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "mistral_codestral": "CODESTRAL_API_KEY",
    "opencode_zen": "OPENCODE_API_KEY",
    "opencode_go": "OPENCODE_GO_API_KEY",
    "vercel_ai_gateway": "AI_GATEWAY_API_KEY",
    "amazon_bedrock": "AWS_BEARER_TOKEN_BEDROCK",
    "huggingface": "HUGGINGFACE_API_KEY",
    "cohere": "COHERE_API_KEY",
    "github_models": "GITHUB_MODELS_TOKEN",
    "water": "WATER_API_KEY",
    "kimi": "KIMI_API_KEY",
    "kimi_code": "KIMI_CODE_API_KEY",
    "kelo": "KELO_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "cerebras": "CEREBRAS_API_KEY",
    "sambanova": "SAMBANOVA_API_KEY",
    "fireworks": "FIREWORKS_API_KEY",
    "novita": "NOVITA_API_KEY",
    "cloudflare": "CLOUDFLARE_API_TOKEN",
    "zai_coding": "ZAI_CODING_API_KEY",
    "zai_api": "ZAI_API_KEY",
    "tokenrouter": "TOKENROUTER_API_KEY",
    "nararoute": "NARAROUTE_API_KEY",
    "poolside": "POOLSIDE_API_KEY",
    "llm7": "LLM7_API_KEY",
    "ollama_cloud": "OLLAMA_API_KEY",
    "custom_openai_compatible": "CUSTOM_OPENAI_API_KEY",
}


def get_intermediate_model_config() -> dict:
    """
    Returns the persistent Intermediate Executive Model configuration:
    {
      'enabled': bool,
      'providerId': str,
      'modelId': str,
      'thinkingLevel': str ('off' | 'minimal' | 'low' | 'medium' | 'high'),
      'customBaseUrl': str
    }
    """
    cfg = read_app_config()
    stored = cfg.get("intermediateModel") or {}
    return {
        "enabled": bool(stored.get("enabled", False)),
        "providerId": str(stored.get("providerId") or "nvidia_nim").strip(),
        "modelId": str(stored.get("modelId") or "nvidia/nemotron-4-340b-instruct").strip(),
        "thinkingLevel": str(stored.get("thinkingLevel") or "high").strip().lower(),
        "customBaseUrl": str(stored.get("customBaseUrl") or "").strip(),
    }


def get_provider_credentials(provider_id: str) -> dict:
    """
    Retrieves effective API key, base URL, and configuration for a given provider.
    Priority:
      1. Stored in config.json under providers[provider_id]
      2. Environment variable fallback (from .env or os.environ)
    """
    pid = (provider_id or "").strip()
    cfg = read_app_config()
    stored_providers = cfg.get("providers") or {}
    prov_data = stored_providers.get(pid) or {}

    stored_key = str(prov_data.get("apiKey") or "").strip()
    env_var_name = PROVIDER_ENV_KEYS.get(pid, "")
    env_key = (os.environ.get(env_var_name) or "").strip() if env_var_name else ""
    effective_key = stored_key or env_key

    stored_base = str(prov_data.get("baseUrl") or "").strip()
    default_base = PROVIDER_DEFAULT_BASE_URLS.get(pid, "")
    effective_base = stored_base or default_base

    selected_model = str(prov_data.get("selectedModel") or "").strip()
    thinking_level = str(prov_data.get("thinkingLevel") or "high").strip().lower()

    is_local = pid in ("lmstudio", "llamacpp", "ollama")
    is_configured = is_local or len(effective_key) > 3

    return {
        "providerId": pid,
        "apiKey": effective_key,
        "baseUrl": effective_base,
        "configured": is_configured,
        "selectedModel": selected_model,
        "thinkingLevel": thinking_level,
        "cachedModels": prov_data.get("cachedModels") or [],
    }

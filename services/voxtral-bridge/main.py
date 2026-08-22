"""Bridge between Vexa-Lite multipart audio and OpenRouter JSON STT.

Vexa-Lite hard-codes a Whisper-style transcription endpoint and a fixed
model name. The bridge sits in between to:

  * encode Vexa's multipart audio as OpenRouter ``input_audio``,
  * fetch the current effective OpenRouter key/model from the GhostTyper webapp
    at request time (cached ~60s) so workspace admins can rotate the key
    via the UI without restarting any container,
  * request ``verbose_json`` only for the integration-probed live model.

If the callback to GhostTyper fails, the bridge can use the operator-managed
``OPENROUTER_API_KEY`` fallback. There is no legacy-provider fallback.
"""

from __future__ import annotations

import logging
import os
import base64
from pathlib import Path

import aiohttp
import cachetools
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

UPSTREAM_URL = os.environ.get(
    "UPSTREAM_URL",
    "https://openrouter.ai/api/v1/audio/transcriptions",
)
DEFAULT_MODEL = os.environ.get("MODEL_OVERRIDE", "")
TIMEOUT_S = float(os.environ.get("UPSTREAM_TIMEOUT_S", "120"))

WEBAPP_URL = os.environ.get("WEBAPP_URL", "").rstrip("/")
BRIDGE_SECRET = os.environ.get("BRIDGE_SECRET", "")
WEBAPP_TIMEOUT_S = float(os.environ.get("WEBAPP_TIMEOUT_S", "5"))
CACHE_TTL_S = float(os.environ.get("WEBAPP_CACHE_TTL_S", "60"))
# Per-scope config cache. Keyed by (org_id | meeting | "global"); a
# multi-tenant deployment can therefore accumulate one entry per org +
# one per active meeting. The previous implementation used a plain dict
# with no eviction, which would grow unbounded in long-running pods.
# TTLCache evicts on access once an entry's age exceeds CACHE_TTL_S
# AND caps the working set at WEBAPP_CACHE_MAXSIZE (LRU when full).
CACHE_MAXSIZE = max(1, int(os.environ.get("WEBAPP_CACHE_MAXSIZE", "1024")))

FALLBACK_API_KEY = os.environ.get("OPENROUTER_API_KEY") or ""

LOG_LEVEL = os.environ.get("LOG_LEVEL", "info").upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))
logger = logging.getLogger("voxtral-bridge")

app = FastAPI()
_cache_by_scope: cachetools.TTLCache[str, dict] = cachetools.TTLCache(
    maxsize=CACHE_MAXSIZE, ttl=CACHE_TTL_S,
)

def _scope_key(org_id: str | None, platform: str | None, native_meeting_id: str | None) -> str:
    if org_id:
        return f"org:{org_id}"
    if platform and native_meeting_id:
        return f"meeting:{platform}:{native_meeting_id}"
    return "global"


def _cache_default() -> dict:
    return {
        "api_key": None,
        "base_url": None,
        "model": DEFAULT_MODEL,
        "verbose_json": False,
        "context_bias": [],
        "source": None,
    }


async def fetch_effective_config(
    org_id: str | None = None,
    platform: str | None = None,
    native_meeting_id: str | None = None,
) -> dict:
    """Pull the live effective OpenRouter key/model from the webapp.

    Cached ``CACHE_TTL_S`` seconds so we don't hammer the webapp on every
    transcription, but short enough that admin-side key rotations take
    effect within a minute.
    """
    scope = _scope_key(org_id, platform, native_meeting_id)
    cached = _cache_by_scope.get(scope)
    if cached is not None and cached.get("api_key"):
        # Still inside the TTL window — TTLCache lazily evicts older
        # entries on access, so a non-None hit means it has not aged out.
        return cached
    if not WEBAPP_URL or not BRIDGE_SECRET:
        return cached if cached is not None else _cache_default()
    try:
        timeout = aiohttp.ClientTimeout(total=WEBAPP_TIMEOUT_S)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            callback_headers = {"X-Bridge-Secret": BRIDGE_SECRET}
            if org_id:
                callback_headers["X-Romaco-Org"] = org_id
            if platform:
                callback_headers["X-Romaco-Platform"] = platform
            if native_meeting_id:
                callback_headers["X-Romaco-Native-Meeting-Id"] = native_meeting_id
            async with session.post(
                f"{WEBAPP_URL}/api/internal/whisper-config",
                headers=callback_headers,
            ) as resp:
                if resp.status == 200:
                    body = await resp.json()
                    bias = body.get("contextBias") or []
                    if not isinstance(bias, list):
                        bias = []
                    fresh = _cache_default()
                    fresh.update(
                        api_key=body.get("apiKey"),
                        base_url=(body.get("baseUrl") or "").rstrip("/") or None,
                        model=body.get("model") or DEFAULT_MODEL,
                        verbose_json=bool(body.get("verboseJson")),
                        context_bias=[str(term) for term in bias if term],
                        source=body.get("source"),
                    )
                    # __setitem__ on a TTLCache stamps the entry with a
                    # fresh expiry, so the per-scope cache only hits the
                    # webapp once per CACHE_TTL_S window.
                    _cache_by_scope[scope] = fresh
                    logger.info(
                        "bridge config refreshed (source=%s, bias_terms=%d)",
                        body.get("source"),
                        len(fresh["context_bias"]),
                    )
                    return fresh
                logger.warning("bridge config callback returned %s", resp.status)
    except Exception as exc:  # noqa: BLE001
        logger.warning("bridge config callback failed: %s", exc)
    return cached if cached is not None else _cache_default()


@app.get("/")
async def health() -> dict:
    return {"ok": True, "upstream": UPSTREAM_URL, "default_model": DEFAULT_MODEL}


@app.post("/v1/audio/transcriptions")
async def proxy(request: Request) -> Response:
    form = await request.form()

    audio_file: tuple[str | None, bytes, str | None] | None = None
    data: dict[str, str] = {}
    seen_fields: set[str] = set()

    org_id = (request.headers.get("x-romaco-org") or "").strip() or None
    platform = str(form.get("platform") or "").strip() or None
    native_meeting_id = str(form.get("native_meeting_id") or "").strip() or None

    config = await fetch_effective_config(
        org_id=org_id,
        platform=platform,
        native_meeting_id=native_meeting_id,
    )
    effective_model = config.get("model") or DEFAULT_MODEL
    if not effective_model:
        return JSONResponse(status_code=503, content={"error": "model_unavailable"})
    upstream_url = config.get("base_url") or None
    upstream_url = f"{upstream_url.rstrip('/')}/audio/transcriptions" if upstream_url else UPSTREAM_URL

    for key, value in form.multi_items():
        if hasattr(value, "read") and hasattr(value, "filename"):
            content = await value.read()
            if audio_file is None:
                audio_file = (value.filename, content, value.content_type)
        elif key == "model":
            data["model"] = effective_model
            seen_fields.add("model")
        else:
            data[key] = str(value)
            seen_fields.add(key)

    if "model" not in seen_fields:
        if not effective_model:
            return JSONResponse(status_code=503, content={"error": "model_unavailable"})
        data["model"] = effective_model

    # Default to verbose_json so providers can return segments when the
    # selected model supports them. Non-destructive: only set if the caller did not.
    if config.get("verbose_json") and "response_format" not in seen_fields:
        data["response_format"] = "verbose_json"

    if audio_file is None:
        return JSONResponse(status_code=400, content={"error": "audio_required"})

    api_key = config.get("api_key") or FALLBACK_API_KEY
    if not api_key:
        # Last-resort fallback: if even the env key is missing, try forwarding
        # whatever the caller sent (that was the original behaviour).
        forwarded = request.headers.get("authorization")
        if not forwarded:
            return JSONResponse(
                status_code=503,
                content={
                    "error": "no_api_key",
                    "message": "OpenRouter API key not configured (workspace UI nor ENV).",
                },
            )
        headers = {"Authorization": forwarded}
    else:
        headers = {"Authorization": f"Bearer {api_key}"}

    filename, audio_content, content_type = audio_file
    extension = Path(filename or "audio.webm").suffix.lower().lstrip(".") or "webm"
    if extension == "weba":
        extension = "webm"
    payload = {
        "input_audio": {
            "data": base64.b64encode(audio_content).decode("ascii"),
            "format": extension,
        },
        "model": data["model"],
        "provider": {"zdr": True, "data_collection": "deny"},
    }
    for field in ("language", "temperature", "response_format"):
        if data.get(field):
            payload[field] = data[field]
    headers["HTTP-Referer"] = os.environ.get("APP_URL", "http://localhost:3000")
    headers["X-OpenRouter-Title"] = "GhostTyper Vexa Bridge"

    timeout = aiohttp.ClientTimeout(total=TIMEOUT_S)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(upstream_url, json=payload, headers=headers) as upstream:
                body = await upstream.read()
                return Response(
                    content=body,
                    status_code=upstream.status,
                    media_type=upstream.headers.get("content-type", "application/json"),
                )
    except aiohttp.ClientError as exc:
        logger.error("upstream request failed: %s", exc)
        return JSONResponse(
            status_code=502,
            content={"error": "upstream_unreachable", "message": str(exc)},
        )

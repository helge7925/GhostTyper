"""Bridge between Vexa-Lite and Mistral Voxtral.

Vexa-Lite hard-codes a Whisper-style transcription endpoint and a fixed
model name; Voxtral-Mini lives at a different URL and expects its own
model identifier. The bridge sits in between to:

  * rewrite the `model` form field in flight,
  * fetch the current effective Mistral key from the GhostTyper webapp
    at request time (cached ~60s) so workspace admins can rotate the key
    via the UI without restarting any container,
  * inject the workspace-global `context_bias` into the multipart form,
    so user-defined jargon also benefits live transcriptions,
  * default `response_format=verbose_json` and
    `timestamp_granularities=word` when Vexa-Lite does not set them,
    so the JSON response carries segments, speakers and word timestamps.

If the callback to GhostTyper fails (webapp down, secret mismatch), we
fall back to the MISTRAL_API_KEY env we were started with — so a degraded
webapp does not take down audio transcription. The legacy
FIREWORKS_API_KEY / VEXA_TRANSCRIPTION_TOKEN env vars are still honoured
during the migration window for setups that have not yet renamed them.
"""

from __future__ import annotations

import logging
import os

import aiohttp
import cachetools
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

UPSTREAM_URL = os.environ.get(
    "UPSTREAM_URL",
    "https://api.mistral.ai/v1/audio/transcriptions",
)
DEFAULT_MODEL = os.environ.get("MODEL_OVERRIDE", "voxtral-mini-transcribe-realtime-2602")
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

FALLBACK_API_KEY = (
    os.environ.get("MISTRAL_API_KEY")
    or os.environ.get("FIREWORKS_API_KEY")
    or os.environ.get("VEXA_TRANSCRIPTION_TOKEN")
    or ""
)

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
        "model": DEFAULT_MODEL,
        "context_bias": [],
        "source": None,
    }


async def fetch_effective_config(
    org_id: str | None = None,
    platform: str | None = None,
    native_meeting_id: str | None = None,
) -> dict:
    """Pull the live effective Mistral key + context bias from the webapp.

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
                        model=body.get("model") or DEFAULT_MODEL,
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

    files: list[tuple[str, tuple[str | None, bytes, str | None]]] = []
    data: list[tuple[str, str]] = []
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

    for key, value in form.multi_items():
        if hasattr(value, "read") and hasattr(value, "filename"):
            content = await value.read()
            files.append((key, (value.filename, content, value.content_type)))
        elif key == "model":
            data.append(("model", effective_model))
            seen_fields.add("model")
        else:
            data.append((key, str(value)))
            seen_fields.add(key)

    if "model" not in seen_fields:
        data.append(("model", effective_model))

    # Default to verbose_json/word-level timestamps so Vexa-Lite gets the
    # segments + speaker_id + words[] it relies on, regardless of what it
    # sends. Non-destructive: only set if the caller did not.
    if "response_format" not in seen_fields:
        data.append(("response_format", "verbose_json"))
    if "timestamp_granularities" not in seen_fields:
        data.append(("timestamp_granularities", "word"))

    # Inject the workspace-global context bias when the caller has not
    # supplied its own. Vexa-Lite has no notion of org-scoped bias, so this
    # is the only way to surface user-pinned jargon to the live path.
    if "context_bias" not in seen_fields and config.get("context_bias"):
        bias_terms = [t for t in config["context_bias"] if isinstance(t, str) and t.strip()]
        if bias_terms:
            data.append(("context_bias", ",".join(bias_terms)))

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
                    "message": "Mistral API key not configured (workspace UI nor ENV).",
                },
            )
        headers = {"Authorization": forwarded}
    else:
        headers = {"Authorization": f"Bearer {api_key}"}

    form_data = aiohttp.FormData()
    for key, value in data:
        form_data.add_field(key, value)
    for key, (filename, content, content_type) in files:
        form_data.add_field(
            key,
            content,
            filename=filename or "audio.bin",
            content_type=content_type or "application/octet-stream",
        )

    timeout = aiohttp.ClientTimeout(total=TIMEOUT_S)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(UPSTREAM_URL, data=form_data, headers=headers) as upstream:
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

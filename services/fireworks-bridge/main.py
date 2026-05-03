"""Tiny model-name-rewriting proxy for Vexa → Fireworks.

The bridge sits between Vexa-Lite (which hard-codes the Whisper model name)
and Fireworks (which expects its own naming). We rewrite the `model` form
field in flight.

Auth: instead of forwarding whatever Vexa-Lite sends as Bearer token, the
bridge fetches the current effective key from GhostTyper at request time
(cached ~60s). This is what lets the workspace admin rotate the Fireworks
key from the UI without restarting any container.

If the callback to GhostTyper fails (webapp down, secret mismatch), we fall
back to the FIREWORKS_API_KEY env we were started with — so a degraded
webapp does not take down audio transcription.
"""

from __future__ import annotations

import logging
import os
import time

import aiohttp
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

UPSTREAM_URL = os.environ.get(
    "UPSTREAM_URL",
    "https://api.fireworks.ai/inference/v1/audio/transcriptions",
)
DEFAULT_MODEL = os.environ.get("MODEL_OVERRIDE", "whisper-v3")
TIMEOUT_S = float(os.environ.get("UPSTREAM_TIMEOUT_S", "120"))

WEBAPP_URL = os.environ.get("WEBAPP_URL", "").rstrip("/")
BRIDGE_SECRET = os.environ.get("BRIDGE_SECRET", "")
WEBAPP_TIMEOUT_S = float(os.environ.get("WEBAPP_TIMEOUT_S", "5"))
CACHE_TTL_S = float(os.environ.get("WEBAPP_CACHE_TTL_S", "60"))

FALLBACK_API_KEY = os.environ.get("FIREWORKS_API_KEY", "")

LOG_LEVEL = os.environ.get("LOG_LEVEL", "info").upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))
logger = logging.getLogger("fireworks-bridge")

app = FastAPI()
_cache: dict = {"expires": 0, "api_key": None, "model": DEFAULT_MODEL, "source": None}


async def fetch_effective_config() -> dict:
    """Pull the live effective Fireworks key from the webapp. Cache 60s."""
    now = time.monotonic()
    if _cache["api_key"] and now < _cache["expires"]:
        return _cache
    if not WEBAPP_URL or not BRIDGE_SECRET:
        return _cache
    try:
        timeout = aiohttp.ClientTimeout(total=WEBAPP_TIMEOUT_S)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                f"{WEBAPP_URL}/api/internal/whisper-config",
                headers={"X-Bridge-Secret": BRIDGE_SECRET},
            ) as resp:
                if resp.status == 200:
                    body = await resp.json()
                    _cache.update(
                        api_key=body.get("apiKey"),
                        model=body.get("model") or DEFAULT_MODEL,
                        source=body.get("source"),
                        expires=now + CACHE_TTL_S,
                    )
                    logger.info("whisper-config refreshed (source=%s)", body.get("source"))
                else:
                    logger.warning("whisper-config callback returned %s", resp.status)
    except Exception as exc:  # noqa: BLE001
        logger.warning("whisper-config callback failed: %s", exc)
    return _cache


@app.get("/")
async def health() -> dict:
    return {"ok": True, "upstream": UPSTREAM_URL, "default_model": DEFAULT_MODEL}


@app.post("/v1/audio/transcriptions")
async def proxy(request: Request) -> Response:
    form = await request.form()

    files: list[tuple[str, tuple[str | None, bytes, str | None]]] = []
    data: list[tuple[str, str]] = []
    saw_model = False

    config = await fetch_effective_config()
    effective_model = config.get("model") or DEFAULT_MODEL

    for key, value in form.multi_items():
        if hasattr(value, "read") and hasattr(value, "filename"):
            content = await value.read()
            files.append((key, (value.filename, content, value.content_type)))
        elif key == "model":
            data.append(("model", effective_model))
            saw_model = True
        else:
            data.append((key, str(value)))

    if not saw_model:
        data.append(("model", effective_model))

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
                    "message": "Fireworks API key not configured (workspace UI nor ENV).",
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

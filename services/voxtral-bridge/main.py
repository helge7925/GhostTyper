"""Bridge between Vexa-Lite multipart audio and Mistral's realtime STT.

Vexa-Lite hard-codes a Whisper-style transcription endpoint and a fixed
model name. The bridge sits in between to:

  * decode Vexa's chunk audio (webm/opus, whatever container it sends)
    to raw PCM via ffmpeg — Mistral's realtime endpoint takes PCM only,
    Vexa sends compressed audio,
  * stream that PCM to Mistral's realtime transcription WebSocket
    (``voxtral-mini-transcribe-realtime-2602``) and wait for the final
    transcript,
  * fetch the current effective Mistral key from the GhostTyper webapp
    at request time (cached ~60s) so workspace admins can rotate the key
    via the UI without restarting any container,
  * return a Whisper-style ``{"text": "..."}`` response, matching what
    Vexa-Lite already expected from the old OpenRouter path.

Routes exclusively to Mistral direct — not OpenRouter, not EdenAI. Both
were measured too slow for a live meeting's ~2-3s audio-chunk cadence
(EdenAI: 3.5-8.6s async-job round trip for a ~2s chunk; OpenRouter: not
meaningfully faster per manual testing) — see
migrate-live-meeting-stt-to-edenai/design.md for the full comparison.
Mistral's realtime endpoint measured 0.76-1.5s end-to-end (audio fed as
fast as it arrives, not throttled to real-time playback speed — Vexa
already has each chunk fully recorded before it POSTs here) for chunks
up to ~6s, comfortably inside the chunk-arrival cadence.

If the callback to GhostTyper fails, the bridge can use the operator-managed
``MISTRAL_API_KEY`` fallback. There is no other-provider fallback — this
capability is exclusively Mistral, not a "prefer X, fall back to Y" gate.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import tempfile
from pathlib import Path

import aiohttp
import cachetools
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from mistralai.client.sdk import Mistral
from mistralai.client.models import AudioFormat, RealtimeTranscriptionError
from mistralai.extra.exceptions import RealtimeTranscriptionException

MISTRAL_MODEL_DEFAULT = os.environ.get("MISTRAL_MODEL_OVERRIDE", "voxtral-mini-transcribe-realtime-2602")
TRANSCODE_TIMEOUT_S = float(os.environ.get("TRANSCODE_TIMEOUT_S", "10"))
REALTIME_TIMEOUT_S = float(os.environ.get("REALTIME_TIMEOUT_S", "15"))
# 16kHz mono is plenty for speech and keeps the WS payload small; one of
# Mistral's documented supported rates (8000/16000/22050/44100/48000).
PCM_SAMPLE_RATE = int(os.environ.get("PCM_SAMPLE_RATE", "16000"))
FFMPEG_BIN = os.environ.get("FFMPEG_BIN", "ffmpeg")

WEBAPP_URL = os.environ.get("WEBAPP_URL", "").rstrip("/")
BRIDGE_SECRET = os.environ.get("BRIDGE_SECRET", "")
WEBAPP_TIMEOUT_S = float(os.environ.get("WEBAPP_TIMEOUT_S", "5"))
CACHE_TTL_S = float(os.environ.get("WEBAPP_CACHE_TTL_S", "60"))
# Per-scope config cache. Keyed by (org_id | meeting | "global"); a
# multi-tenant deployment can therefore accumulate one entry per org +
# one per active meeting. TTLCache evicts on access once an entry's age
# exceeds CACHE_TTL_S AND caps the working set at WEBAPP_CACHE_MAXSIZE
# (LRU when full).
CACHE_MAXSIZE = max(1, int(os.environ.get("WEBAPP_CACHE_MAXSIZE", "1024")))

FALLBACK_API_KEY = os.environ.get("MISTRAL_API_KEY") or ""

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
        "model": MISTRAL_MODEL_DEFAULT,
        "context_bias": [],
        "source": None,
    }


async def fetch_effective_config(
    org_id: str | None = None,
    platform: str | None = None,
    native_meeting_id: str | None = None,
) -> dict:
    """Pull the live effective Mistral key/model from the webapp.

    Cached ``CACHE_TTL_S`` seconds so we don't hammer the webapp on every
    transcription, but short enough that admin-side key rotations take
    effect within a minute.
    """
    scope = _scope_key(org_id, platform, native_meeting_id)
    cached = _cache_by_scope.get(scope)
    if cached is not None and cached.get("api_key"):
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
                        model=body.get("model") or MISTRAL_MODEL_DEFAULT,
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
    return {"ok": True, "provider": "mistral", "default_model": MISTRAL_MODEL_DEFAULT}


def _transcode_to_pcm(audio_bytes: bytes, suffix: str) -> bytes:
    """Decode arbitrary compressed audio (webm/opus etc.) to raw PCM
    S16LE mono at PCM_SAMPLE_RATE via ffmpeg — Mistral's realtime
    endpoint only accepts PCM, Vexa sends compressed audio. Synchronous/
    blocking; the caller runs this via asyncio.to_thread so it doesn't
    block the event loop. Measured ~10ms for a ~2s chunk in local
    testing — negligible against the realtime call's own latency.
    """
    with tempfile.NamedTemporaryFile(suffix=f".{suffix}", delete=True) as src:
        src.write(audio_bytes)
        src.flush()
        proc = subprocess.run(
            [
                FFMPEG_BIN, "-y", "-i", src.name,
                "-f", "s16le", "-acodec", "pcm_s16le",
                "-ar", str(PCM_SAMPLE_RATE), "-ac", "1",
                "-",
            ],
            capture_output=True,
            timeout=TRANSCODE_TIMEOUT_S,
        )
        if proc.returncode != 0:
            detail = proc.stderr.decode("utf-8", errors="replace")[-500:]
            raise RuntimeError(f"ffmpeg transcode failed: {detail}")
        return proc.stdout


async def _pcm_chunks(pcm_bytes: bytes, chunk_bytes: int = 9600):
    # Fed as fast as the event loop can go, not throttled to real-time
    # playback speed — the whole chunk is already in memory (Vexa POSTs
    # a fully-recorded 2-3s segment, not a live mic feed), and feeding
    # it immediately is what produced the measured 0.76-1.5s latency.
    for i in range(0, len(pcm_bytes), chunk_bytes):
        yield pcm_bytes[i:i + chunk_bytes]


async def _transcribe_via_mistral(pcm_bytes: bytes, api_key: str, model: str) -> str:
    client = Mistral(api_key=api_key)
    final_text = None
    async for event in client.audio.realtime.transcribe_stream(
        audio_stream=_pcm_chunks(pcm_bytes),
        model=model,
        audio_format=AudioFormat(encoding="pcm_s16le", sample_rate=PCM_SAMPLE_RATE),
        timeout_ms=int(REALTIME_TIMEOUT_S * 1000),
    ):
        if isinstance(event, RealtimeTranscriptionError):
            raise RuntimeError(f"Mistral realtime error: {event.error.message} (code {event.error.code})")
        if getattr(event, "type", None) == "transcription.done":
            final_text = getattr(event, "text", "") or ""
            break
    if final_text is None:
        raise RuntimeError("Mistral realtime stream ended without a transcription.done event")
    return final_text


@app.post("/v1/audio/transcriptions")
async def proxy(request: Request) -> JSONResponse:
    form = await request.form()

    audio_file: tuple[str | None, bytes, str | None] | None = None
    org_id = (request.headers.get("x-romaco-org") or "").strip() or None
    platform = str(form.get("platform") or "").strip() or None
    native_meeting_id = str(form.get("native_meeting_id") or "").strip() or None

    for key, value in form.multi_items():
        if hasattr(value, "read") and hasattr(value, "filename"):
            content = await value.read()
            if audio_file is None:
                audio_file = (value.filename, content, value.content_type)

    if audio_file is None:
        return JSONResponse(status_code=400, content={"error": "audio_required"})

    config = await fetch_effective_config(
        org_id=org_id,
        platform=platform,
        native_meeting_id=native_meeting_id,
    )
    api_key = config.get("api_key") or FALLBACK_API_KEY
    if not api_key:
        return JSONResponse(
            status_code=503,
            content={
                "error": "no_api_key",
                "message": "Mistral API key not configured (workspace UI nor ENV).",
            },
        )
    model = config.get("model") or MISTRAL_MODEL_DEFAULT

    context_bias = config.get("context_bias") or []
    if context_bias:
        # Mistral's realtime protocol has no documented vocabulary/prompt
        # hint parameter (unlike OpenRouter's Groq-specific passthrough,
        # which this replaces) — best-effort context bias is not
        # currently forwarded. Logged, not silently dropped.
        logger.info(
            "context-bias terms configured (%d) but not forwarded — unsupported by Mistral realtime",
            len(context_bias),
        )

    filename, audio_content, _content_type = audio_file
    extension = Path(filename or "audio.webm").suffix.lower().lstrip(".") or "webm"
    if extension == "weba":
        extension = "webm"

    try:
        pcm_bytes = await asyncio.to_thread(_transcode_to_pcm, audio_content, extension)
    except Exception as exc:  # noqa: BLE001
        logger.error("audio transcode failed: %s", exc)
        return JSONResponse(status_code=502, content={"error": "transcode_failed", "message": str(exc)})

    try:
        text = await _transcribe_via_mistral(pcm_bytes, api_key, model)
        return JSONResponse(status_code=200, content={"text": text})
    except RealtimeTranscriptionException as exc:
        logger.error("Mistral realtime connection failed: %s", exc)
        return JSONResponse(status_code=502, content={"error": "upstream_unreachable", "message": str(exc)})
    except Exception as exc:  # noqa: BLE001
        logger.error("Mistral realtime transcription failed: %s", exc)
        return JSONResponse(status_code=502, content={"error": "transcription_failed", "message": str(exc)})

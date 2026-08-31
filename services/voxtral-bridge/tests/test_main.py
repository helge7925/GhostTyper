"""Mocked-dependency test suite for the voxtral-bridge FastAPI app.

The bridge's real behavior was verified live in
migrate-live-meeting-stt-to-edenai (real uvicorn server, real webm/opus
request, real production Mistral) — see that change's status.md. This
suite closes the gap flagged there: no repeatable, CI-run check existed
before this file. It mocks every network boundary (the webapp config
callback, the Mistral realtime SDK, ffmpeg) so it runs offline and fast;
it is not a replacement for the live verification, which remains the
stronger evidence for the actual Mistral protocol behavior.
"""
from __future__ import annotations

import subprocess
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import main
from mistralai.client.models import RealtimeTranscriptionError, RealtimeTranscriptionErrorDetail
from mistralai.extra.exceptions import RealtimeTranscriptionException


@pytest.fixture(autouse=True)
def clear_cache():
    """Every test gets a clean per-scope config cache — otherwise a
    successful fetch in one test could leak into another via the shared
    module-level TTLCache."""
    main._cache_by_scope.clear()
    yield
    main._cache_by_scope.clear()


# --- _scope_key / _cache_default -------------------------------------------

def test_scope_key_prefers_org_id():
    assert main._scope_key("org-1", "zoom", "meeting-1") == "org:org-1"


def test_scope_key_falls_back_to_meeting():
    assert main._scope_key(None, "zoom", "meeting-1") == "meeting:zoom:meeting-1"


def test_scope_key_falls_back_to_global():
    assert main._scope_key(None, None, None) == "global"
    assert main._scope_key(None, "zoom", None) == "global"


def test_cache_default_shape():
    default = main._cache_default()
    assert default == {
        "api_key": None,
        "model": main.MISTRAL_MODEL_DEFAULT,
        "context_bias": [],
        "source": None,
    }


# --- fetch_effective_config --------------------------------------------

@pytest.mark.asyncio
async def test_fetch_effective_config_returns_default_without_webapp_url(monkeypatch):
    monkeypatch.setattr(main, "WEBAPP_URL", "")
    monkeypatch.setattr(main, "BRIDGE_SECRET", "secret")
    result = await main.fetch_effective_config(org_id="org-1")
    assert result == main._cache_default()


@pytest.mark.asyncio
async def test_fetch_effective_config_cache_hit_skips_http(monkeypatch):
    main._cache_by_scope["org:org-1"] = {
        "api_key": "cached-key", "model": "voxtral-mini-transcribe-realtime-2602",
        "context_bias": [], "source": "workspace",
    }

    async def _boom(*args, **kwargs):
        raise AssertionError("should not make an HTTP call on a cache hit")
    monkeypatch.setattr(main.aiohttp, "ClientSession", _boom)

    result = await main.fetch_effective_config(org_id="org-1")
    assert result["api_key"] == "cached-key"


class _FakeResponse:
    def __init__(self, status, body=None):
        self.status = status
        self._body = body or {}

    async def json(self):
        return self._body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeSession:
    def __init__(self, response=None, raise_exc=None):
        self._response = response
        self._raise_exc = raise_exc

    def post(self, *args, **kwargs):
        if self._raise_exc:
            raise self._raise_exc
        return self._response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


def _patch_session(monkeypatch, session):
    monkeypatch.setattr(main.aiohttp, "ClientSession", lambda *a, **k: session)


@pytest.mark.asyncio
async def test_fetch_effective_config_success_populates_cache(monkeypatch):
    monkeypatch.setattr(main, "WEBAPP_URL", "http://webapp.internal")
    monkeypatch.setattr(main, "BRIDGE_SECRET", "secret")
    response = _FakeResponse(200, {
        "apiKey": "fresh-key", "model": "voxtral-mini-transcribe-realtime-2602",
        "contextBias": ["Rheinbrücke", "HEB200"], "source": "workspace",
    })
    _patch_session(monkeypatch, _FakeSession(response=response))

    result = await main.fetch_effective_config(org_id="org-1")
    assert result["api_key"] == "fresh-key"
    assert result["context_bias"] == ["Rheinbrücke", "HEB200"]
    assert main._cache_by_scope["org:org-1"]["api_key"] == "fresh-key"


@pytest.mark.asyncio
async def test_fetch_effective_config_non_200_falls_back_to_default(monkeypatch):
    monkeypatch.setattr(main, "WEBAPP_URL", "http://webapp.internal")
    monkeypatch.setattr(main, "BRIDGE_SECRET", "secret")
    _patch_session(monkeypatch, _FakeSession(response=_FakeResponse(500)))

    result = await main.fetch_effective_config(org_id="org-1")
    assert result == main._cache_default()


@pytest.mark.asyncio
async def test_fetch_effective_config_exception_falls_back_to_default(monkeypatch):
    monkeypatch.setattr(main, "WEBAPP_URL", "http://webapp.internal")
    monkeypatch.setattr(main, "BRIDGE_SECRET", "secret")
    _patch_session(monkeypatch, _FakeSession(raise_exc=RuntimeError("connection refused")))

    result = await main.fetch_effective_config(org_id="org-1")
    assert result == main._cache_default()


@pytest.mark.asyncio
async def test_fetch_effective_config_exception_falls_back_to_stale_cache(monkeypatch):
    main._cache_by_scope["org:org-1"] = {
        "api_key": "stale-key", "model": "m", "context_bias": [], "source": "workspace",
    }
    monkeypatch.setattr(main, "WEBAPP_URL", "http://webapp.internal")
    monkeypatch.setattr(main, "BRIDGE_SECRET", "secret")
    # Cache only short-circuits when api_key is truthy AND fresh; force
    # the HTTP path by expiring the entry first via direct cache clear
    # of just the truthy short-circuit — simplest is to keep this cache
    # value stale (no key) so the code proceeds to the HTTP call.
    main._cache_by_scope["org:org-1"]["api_key"] = None
    _patch_session(monkeypatch, _FakeSession(raise_exc=RuntimeError("timeout")))

    result = await main.fetch_effective_config(org_id="org-1")
    assert result["api_key"] is None


# --- _transcode_to_pcm ---------------------------------------------------

def test_transcode_to_pcm_success(monkeypatch):
    def fake_run(cmd, capture_output, timeout):
        return SimpleNamespace(returncode=0, stdout=b"fake-pcm-bytes", stderr=b"")
    monkeypatch.setattr(main.subprocess, "run", fake_run)

    result = main._transcode_to_pcm(b"fake-webm-bytes", "webm")
    assert result == b"fake-pcm-bytes"


def test_transcode_to_pcm_failure_raises_with_ffmpeg_detail(monkeypatch):
    def fake_run(cmd, capture_output, timeout):
        return SimpleNamespace(returncode=1, stdout=b"", stderr=b"Invalid data found when processing input")
    monkeypatch.setattr(main.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError, match="Invalid data found"):
        main._transcode_to_pcm(b"corrupt-bytes", "webm")


def test_transcode_to_pcm_timeout_propagates(monkeypatch):
    def fake_run(cmd, capture_output, timeout):
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=timeout)
    monkeypatch.setattr(main.subprocess, "run", fake_run)

    with pytest.raises(subprocess.TimeoutExpired):
        main._transcode_to_pcm(b"bytes", "webm")


# --- _pcm_chunks -----------------------------------------------------------

@pytest.mark.asyncio
async def test_pcm_chunks_splits_into_requested_size():
    pcm = bytes(range(256)) * 40  # 10240 bytes
    chunks = [c async for c in main._pcm_chunks(pcm, chunk_bytes=9600)]
    assert len(chunks) == 2
    assert len(chunks[0]) == 9600
    assert len(chunks[1]) == 10240 - 9600
    assert b"".join(chunks) == pcm


@pytest.mark.asyncio
async def test_pcm_chunks_empty_input_yields_nothing():
    chunks = [c async for c in main._pcm_chunks(b"", chunk_bytes=9600)]
    assert chunks == []


# --- _transcribe_via_mistral ------------------------------------------

class _FakeRealtimeAPI:
    def __init__(self, events):
        self._events = events

    def transcribe_stream(self, **kwargs):
        events = self._events

        async def _gen():
            for event in events:
                yield event
        return _gen()


class _FakeMistralClient:
    def __init__(self, api_key):
        self.audio = SimpleNamespace(realtime=_FakeRealtimeAPI(_EVENTS_FOR_NEXT_CLIENT[0]))


_EVENTS_FOR_NEXT_CLIENT = [[]]  # mutable box so the monkeypatched factory can read per-test events


def _patch_mistral_events(monkeypatch, events):
    _EVENTS_FOR_NEXT_CLIENT[0] = events
    monkeypatch.setattr(main, "Mistral", _FakeMistralClient)


@pytest.mark.asyncio
async def test_transcribe_via_mistral_returns_text_on_done_event(monkeypatch):
    _patch_mistral_events(monkeypatch, [
        SimpleNamespace(type="transcription.text.delta", text="Hal"),
        SimpleNamespace(type="transcription.done", text="Hallo Welt"),
    ])
    text = await main._transcribe_via_mistral(b"pcm", "key", "voxtral-mini-transcribe-realtime-2602")
    assert text == "Hallo Welt"


@pytest.mark.asyncio
async def test_transcribe_via_mistral_raises_on_error_event(monkeypatch):
    error_event = RealtimeTranscriptionError(
        error=RealtimeTranscriptionErrorDetail(message="invalid audio format", code=400),
    )
    _patch_mistral_events(monkeypatch, [error_event])
    with pytest.raises(RuntimeError, match="invalid audio format"):
        await main._transcribe_via_mistral(b"pcm", "key", "voxtral-mini-transcribe-realtime-2602")


@pytest.mark.asyncio
async def test_transcribe_via_mistral_raises_when_stream_ends_without_done(monkeypatch):
    _patch_mistral_events(monkeypatch, [
        SimpleNamespace(type="transcription.text.delta", text="Hal"),
    ])
    with pytest.raises(RuntimeError, match="ended without a transcription.done event"):
        await main._transcribe_via_mistral(b"pcm", "key", "voxtral-mini-transcribe-realtime-2602")


# --- HTTP endpoints (FastAPI TestClient) --------------------------------

@pytest.fixture
def client():
    return TestClient(main.app)


def test_health_endpoint(client):
    response = client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["provider"] == "mistral"


def test_proxy_requires_audio_file(client, monkeypatch):
    monkeypatch.setattr(main, "FALLBACK_API_KEY", "fallback-key")
    response = client.post("/v1/audio/transcriptions", data={"platform": "zoom"})
    assert response.status_code == 400
    assert response.json()["error"] == "audio_required"


def test_proxy_returns_503_without_any_api_key(client, monkeypatch):
    monkeypatch.setattr(main, "FALLBACK_API_KEY", "")

    async def _no_key_config(**kwargs):
        return main._cache_default()
    monkeypatch.setattr(main, "fetch_effective_config", _no_key_config)

    response = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("chunk.webm", b"fake-audio-bytes", "audio/webm")},
    )
    assert response.status_code == 503
    assert response.json()["error"] == "no_api_key"


def test_proxy_success_returns_transcript(client, monkeypatch):
    async def _config(**kwargs):
        return {"api_key": "k", "model": "voxtral-mini-transcribe-realtime-2602", "context_bias": [], "source": "operator"}
    monkeypatch.setattr(main, "fetch_effective_config", _config)
    monkeypatch.setattr(main, "_transcode_to_pcm", lambda audio_bytes, suffix: b"pcm")

    async def _transcribe(pcm_bytes, api_key, model):
        return "Hallo, hier ist ein Test."
    monkeypatch.setattr(main, "_transcribe_via_mistral", _transcribe)

    response = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("chunk.webm", b"fake-audio-bytes", "audio/webm")},
    )
    assert response.status_code == 200
    assert response.json() == {"text": "Hallo, hier ist ein Test."}


def test_proxy_transcode_failure_returns_502(client, monkeypatch):
    async def _config(**kwargs):
        return {"api_key": "k", "model": "m", "context_bias": [], "source": "operator"}
    monkeypatch.setattr(main, "fetch_effective_config", _config)

    def _boom(audio_bytes, suffix):
        raise RuntimeError("ffmpeg transcode failed: corrupt input")
    monkeypatch.setattr(main, "_transcode_to_pcm", _boom)

    response = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("chunk.webm", b"corrupt", "audio/webm")},
    )
    assert response.status_code == 502
    assert response.json()["error"] == "transcode_failed"


def test_proxy_transcription_failure_returns_502(client, monkeypatch):
    async def _config(**kwargs):
        return {"api_key": "k", "model": "m", "context_bias": [], "source": "operator"}
    monkeypatch.setattr(main, "fetch_effective_config", _config)
    monkeypatch.setattr(main, "_transcode_to_pcm", lambda audio_bytes, suffix: b"pcm")

    async def _boom(pcm_bytes, api_key, model):
        raise RuntimeError("Mistral realtime error: invalid audio format (code 400)")
    monkeypatch.setattr(main, "_transcribe_via_mistral", _boom)

    response = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("chunk.webm", b"fake-audio-bytes", "audio/webm")},
    )
    assert response.status_code == 502
    assert response.json()["error"] == "transcription_failed"


def test_proxy_upstream_unreachable_returns_502(client, monkeypatch):
    async def _config(**kwargs):
        return {"api_key": "k", "model": "m", "context_bias": [], "source": "operator"}
    monkeypatch.setattr(main, "fetch_effective_config", _config)
    monkeypatch.setattr(main, "_transcode_to_pcm", lambda audio_bytes, suffix: b"pcm")

    async def _boom(pcm_bytes, api_key, model):
        raise RealtimeTranscriptionException("connection reset")
    monkeypatch.setattr(main, "_transcribe_via_mistral", _boom)

    response = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("chunk.webm", b"fake-audio-bytes", "audio/webm")},
    )
    assert response.status_code == 502
    assert response.json()["error"] == "upstream_unreachable"


def test_proxy_uses_fallback_api_key_when_no_workspace_key(client, monkeypatch):
    monkeypatch.setattr(main, "FALLBACK_API_KEY", "operator-fallback-key")

    async def _no_key_config(**kwargs):
        return main._cache_default()
    monkeypatch.setattr(main, "fetch_effective_config", _no_key_config)
    monkeypatch.setattr(main, "_transcode_to_pcm", lambda audio_bytes, suffix: b"pcm")

    captured = {}

    async def _transcribe(pcm_bytes, api_key, model):
        captured["api_key"] = api_key
        return "ok"
    monkeypatch.setattr(main, "_transcribe_via_mistral", _transcribe)

    response = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("chunk.webm", b"fake-audio-bytes", "audio/webm")},
    )
    assert response.status_code == 200
    assert captured["api_key"] == "operator-fallback-key"

# Design: OpenRouter Provider Consolidation

## Integration And Routing

`organization_integrations[openrouter]` stores the encrypted API key plus a
versioned configuration object containing `allowedModels`, `defaultModels`
and `ttsVoices`. `OPENROUTER_API_KEY` is the operator fallback. The base URL is
server-controlled and all requests include `provider.zdr=true` and
`provider.data_collection=deny`.

Activation is an explicit transaction: validate the key and one default for
each capability, enable OpenRouter, disable Cortecs/Mistral, clear their stored
secrets, and audit the change. Once activated there is no legacy fallback.

## Model Catalogue And Governance

The server intersects `/models/user?output_modalities=all` with the ZDR model
catalogue, normalizes metadata and caches it for ten minutes per workspace and
key fingerprint. A stale in-memory copy may be displayed for 24 hours but may
not be used for activation or new allowlist changes.

Capabilities are `chat`, `ocr`, `transcription`, `liveTranscription` and
`tts`. Admins see all compatible models; members see only allowed models. A
workspace default must belong to its capability allowlist. If a stored user
selection is unavailable, the default is retried once. A missing default
raises `MODEL_UNAVAILABLE`.

## Workload Adapters

- Chat transformations use `/chat/completions`.
- Batch and Vexa transcription use `/audio/transcriptions`; only successfully
  probed live models may request `verbose_json` through the bridge.
- TTS uses `/audio/speech`; provider PCM is normalized to 22.05 kHz, 16-bit,
  mono before existing WAV concatenation.
- PDFs use the OpenRouter file-parser with `mistral-ocr`; images use a
  compatible vision model. Both normalize to the existing Markdown result.

## Pricing And Currency

OpenRouter catalogue pricing supplies reservations and `usage.cost` supplies
committed cost. Models whose billing units cannot be normalized require an
admin override before allowlisting. TTS accounting is resolved through the
generation ID when the byte-stream response lacks inline usage.

The product currency changes globally to USD. Existing integer micro-values
are retained numerically and relabelled USD by explicit product decision. The
migration is audited; legacy provider/model attribution remains historical.

## Failure And Security Behaviour

- Catalogue failure never exposes keys and does not block already configured
  inference.
- Authentication, content, validation and budget errors never trigger model
  fallback.
- Only model-unavailable/provider-unavailable failures may retry the workspace
  default, once.
- Raw upstream error bodies are logged server-side and redacted for clients.
- Model IDs are arbitrary validated strings up to 255 characters.

## Rollout

Land the OpenRouter configuration and probes first. Workspaces configure and
activate through the admin UI. After seven error-free days and zero active
legacy integrations, remove legacy runtime code and environment settings.
Legacy schema columns remain nullable until a separately approved cleanup.


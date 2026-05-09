# GDPR-conformant setup (Romaco-Scriptor)

> Status: defensive baseline guidance for self-hosted operators. This is
> not legal advice. The recommendations below reflect the architecture
> as of v1.2.0 + Phase 2 hardening (2026-05-09). For a binding
> assessment, consult your DPO and your legal team.

## Why this matters

Romaco-Scriptor processes audio from voice memos and live meetings.
Biometric voice data is a **special category** under
[GDPR Art. 9](https://gdpr-info.eu/art-9-gdpr/) and may not be
transferred to a third country without an Art. 46 safeguard plus a
fact-specific transfer impact assessment (TIA) per *Schrems II*.

Two scenarios in particular need explicit attention:

1. **Live remote-meeting transcription** (Vexa profile). Audio is
   captured by a bot that joins the meeting and is streamed to a
   transcription endpoint.
2. **Voice memo upload** (`/api/upload`). Audio is uploaded to the
   webapp and forwarded to a transcription provider.

Both pipelines go through `lib/integrations.js → resolveBridgeTranscriptionConfig`
(or `lib/ai-service.js` for non-Vexa uploads). Phase 1 of the
2026-05-09 audit closed the cross-org-leakage path (C2) and Phase 2
added a central `assertOutboundUrl` egress guard plus an OUTBOUND_ALLOWED_HOSTS
positive allowlist (M10).

## Default deployment (recommended)

| Component                   | Provider               | Region   |
|-----------------------------|------------------------|----------|
| Webapp + database + uploads | Self-hosted            | Operator |
| Chat / OCR / TTS            | Mistral AI             | FR       |
| Live transcription          | Mistral Voxtral        | FR       |
| Email invites               | none / SMTP / Resend EU| EU       |

With this setup, biometric audio never crosses the EU boundary.
Operator obligations:

- Conclude a Data Processing Agreement with Mistral AI (DPA template:
  https://mistral.ai/legal/data-processing-agreement).
- Maintain a `Verzeichnis von Verarbeitungstätigkeiten` (Art. 30) entry
  for each processing pipeline. The fields you need are listed in the
  appendix.
- Set `OUTBOUND_ALLOWED_HOSTS=api.mistral.ai` in production so a
  compromised dependency cannot exfiltrate audio to an unlisted host.
- Document retention: `lib/db-init.js` ships a 90-day retention default
  on `transcriptions` and `usage_log`; verify the cron job in
  `scripts/apply-retention-policy.js` is actually scheduled in your
  deployment.

## If you must use Fireworks AI (US)

Fireworks AI is *technically* still wired through the
`fireworks-bridge` container as a fallback, because the original
upstream Vexa-Lite contract was built around their Whisper-v3
inference. The bridge directory name is now misleading — by default
the bridge calls Mistral.

If your scenario genuinely requires Fireworks (e.g. on-prem GPU not
available, no Mistral DPA possible), you must:

1. Sign Fireworks's
   [Data Processing Addendum](https://docs.fireworks.ai/legal/dpa)
   *and* their EU Standard Contractual Clauses module 2 addendum.
2. Run a transfer impact assessment (TIA). Schrems II made this
   non-optional for US transfers; a generic SCC by itself is not
   enough.
3. Document the legal basis for processing Art. 9 data — typically
   explicit, documented consent from each meeting participant
   (Art. 9(2)(a)). A workspace-level config flag is not consent.
4. Set `OUTBOUND_ALLOWED_HOSTS=api.mistral.ai,api.fireworks.ai` so
   the egress allowlist accepts both hosts but nothing else.
5. Provide the EEA-resident data subjects with a **transparent**
   notice that their voice data crosses to the US and may be subject
   to FISA 702 / EO 12333 requests, and how to object.

If any of the four steps cannot be honored, **do not enable
`COMPOSE_PROFILES=vexa` with a Fireworks endpoint**. Use Mistral
Voxtral or self-host a Whisper-compatible endpoint inside the EU
instead.

## Self-hosted Whisper inside the EU

Cortecs (https://cortecs.ai/) ships a Whisper-v3 endpoint that is
contractually EU-resident and is API-compatible with the Vexa
transcription contract:

```
VEXA_TRANSCRIPTION_URL=https://api.cortecs.ai/v1/audio/transcriptions
VEXA_TRANSCRIPTION_TOKEN=…
```

Note: Cortecs as of 2026-05-09 does not publish a model SLA equivalent
to Mistral Voxtral. Voxtral is still the recommended default; Cortecs
is the recommended fallback when Mistral capacity is unavailable.

You may also self-host Whisper-v3 on an internal GPU and point
`VEXA_TRANSCRIPTION_URL` at a private network address. The Phase 2
egress guard explicitly allows loopback / private IPs in non-production
NODE_ENV; in production, set `OUTBOUND_BLOCK_LOOPBACK=false` and add
the internal hostname to `OUTBOUND_ALLOWED_HOSTS`.

## Data flow reference (default deployment)

```
┌──────────────┐  audio  ┌─────────────────┐  audio   ┌────────────┐
│ Browser /    │────────►│ Romaco webapp   │─────────►│ Mistral AI │
│ Vexa bot     │         │ (self-hosted)   │ encrypted│ (FR)       │
└──────────────┘         └────────┬────────┘  TLS     └────────────┘
                                  │
                                  ▼
                          ┌──────────────┐
                          │ PostgreSQL   │  transcripts, segments,
                          │ (operator)   │  usage_log, audit_log
                          └──────────────┘
```

Audio bytes are not persisted upstream once the transcription request
returns; only the textual transcript is retained in the operator's
PostgreSQL. Mistral's DPA confirms a zero-day model-training opt-out
on the workspace API key; verify this is enabled in your Mistral
console.

## Operator checklist

- [ ] Mistral DPA signed and on file
- [ ] `Verzeichnis von Verarbeitungstätigkeiten` entry created
- [ ] `OUTBOUND_ALLOWED_HOSTS` configured in production
- [ ] Retention cron scheduled and verified (logs show daily runs)
- [ ] Audit-log retention covers your industry's minimum (typically
      90 d for ops, 7 y for finance/regulated)
- [ ] Privacy notice for end users covers: provider list, retention
      windows, deletion request flow
- [ ] If Fireworks is enabled: SCC + TIA + explicit consent flow

## Appendix — Art. 30 record fields

Per controller:

- Name and contact details of controller / DPO
- Purpose of processing (transcription / search / live translation)
- Categories of data subjects (employees / external speakers)
- Categories of personal data (audio = biometric, transcript = name +
  voice content, possibly Art. 9 special categories if topics include
  health, ethnicity, …)
- Recipients (Mistral AI; bridge container; postgres; operator
  back-ups)
- Third-country transfers (none in default; Mistral is FR)
- Erasure deadlines (transcriptions: 90 d; usage_log: 90 d;
  audit_log: 365 d — adjust to your retention policy)
- Description of technical and organizational measures (TOMs):
  AES-256-GCM at rest, TLS 1.2+ in transit, HKDF-derived keys with
  AAD binding (Phase 2 M1), magic-byte upload validation,
  ClamAV/equivalent virus scan, RBAC with org-scope, audit log,
  CSP nonce, HSTS preload, sandboxed PDF render

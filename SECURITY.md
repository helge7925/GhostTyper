# Security Policy

## Supported Versions

| Version  | Supported          |
| -------- | ------------------ |
| `1.2.x`  | :white_check_mark: |
| `1.1.x`  | :x:                |
| `< 1.1`  | :x:                |

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, contact the maintainer privately via the repository's contact
channel. Include:

- A description of the issue
- Steps to reproduce
- Affected versions
- Optional: a proof-of-concept

We will acknowledge receipt within 72 hours and aim to provide a fix or
mitigation plan within 14 days for high-severity findings.

## Hardening Notes

GhostTyper is designed to run self-hosted. Operators are expected to:

- Set `SETTINGS_ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `DB_INIT_SECRET` to strong
  random values (32+ random bytes).
- Run behind TLS termination (Traefik, Nginx, Caddy) — the app does not
  serve HTTPS itself.
- Disable `ENABLE_DB_INIT_API` after the initial migration.
- Apply the retention policy regularly (`npm run retention:apply`).
- Review `docs/cybersecurity-audit-2026-02-21.md` for the latest audit.

## Known Threat Model Notes

- **Per-user API keys** (Mistral, etc.) are AES-256-GCM-encrypted at rest
  via `lib/secrets.js`.
- **Webhook payloads** from Vexa are HMAC-signed with a per-org secret and
  validated with timing-safe compare.
- **Inter-container traffic** (webapp ↔ vexa-lite ↔ voxtral-bridge) stays
  on the internal Docker network; no ports exposed except the webapp.

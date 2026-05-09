import { logInfo, logError } from './observability';
import { safeFetch } from './network-guard';

/**
 * Workspace invite e-mail dispatcher.
 *
 * Provider order (first match wins):
 *   1. Resend         — RESEND_API_KEY set → POST to api.resend.com
 *   2. SendGrid       — SENDGRID_API_KEY set → POST to api.sendgrid.com
 *   3. SMTP           — SMTP_HOST + SMTP_USER + SMTP_PASS set → nodemailer
 *   4. Console fallback — always logs the link so admins can copy it
 *
 * The fallback is intentional: even when a provider is configured but
 * fails (timeout, 5xx, bad credentials), the invite remains actionable
 * because the API response also returns the URL.
 */

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
const FROM_ADDRESS =
  process.env.INVITE_FROM_ADDRESS ||
  process.env.SMTP_FROM ||
  'no-reply@ghosttyper.local';
const FROM_NAME = process.env.INVITE_FROM_NAME || 'GhostTyper';

export function buildInviteUrl(token) {
  if (!token) return null;
  const base = APP_BASE_URL.replace(/\/+$/, '');
  return base
    ? `${base}/invite/accept?token=${encodeURIComponent(token)}`
    : `/invite/accept?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return null;
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(date.valueOf())) return null;
  try {
    return date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return date.toISOString();
  }
}

function renderInviteContent({ organizationName, inviterName, role, url, expiresAt }) {
  const subject = `Einladung in den Workspace „${organizationName}“`;
  const expiryStr = formatExpiry(expiresAt);

  const text = [
    `Hallo,`,
    ``,
    `${inviterName} hat Sie als „${role}“ in den GhostTyper-Workspace „${organizationName}“ eingeladen.`,
    ``,
    `Einladung annehmen:`,
    `${url}`,
    ``,
    expiryStr ? `Diese Einladung läuft am ${expiryStr} ab.` : '',
    ``,
    `— GhostTyper`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#fafafa; padding:24px; color:#1a1a20;">
    <div style="max-width:560px; margin:0 auto; background:#fff; border:1px solid rgba(0,0,0,0.08); border-radius:14px; padding:28px;">
      <h1 style="margin:0 0 12px 0; font-size:18px; color:#1a1a20;">Workspace-Einladung</h1>
      <p style="margin:0 0 12px 0; line-height:1.55;">
        <strong>${escapeHtml(inviterName)}</strong> hat Sie als
        <strong>${escapeHtml(role)}</strong> in den GhostTyper-Workspace
        <strong>${escapeHtml(organizationName)}</strong> eingeladen.
      </p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(url)}"
           style="display:inline-block; background:linear-gradient(135deg,#ff5917,#ff8c00); color:#fff; padding:11px 20px; border-radius:10px; font-weight:700; text-decoration:none;">
          Einladung annehmen
        </a>
      </p>
      <p style="margin:0 0 6px 0; font-size:12px; color:#52525b;">
        Falls der Button nicht funktioniert, kopieren Sie diesen Link:
      </p>
      <p style="margin:0 0 18px 0; font-size:12px; word-break:break-all; color:#3f3f46;">
        ${escapeHtml(url)}
      </p>
      ${expiryStr ? `<p style="margin:0; font-size:12px; color:#71717a;">Diese Einladung läuft am ${escapeHtml(expiryStr)} ab.</p>` : ''}
    </div>
    <p style="text-align:center; font-size:11px; color:#a1a1aa; margin-top:18px;">— GhostTyper</p>
  </body>
</html>`;

  return { subject, text, html };
}

async function sendViaResend({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  const response = await safeFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_ADDRESS}>`,
      to,
      subject,
      text,
      html,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend API ${response.status}: ${body.slice(0, 200)}`);
  }
  return { provider: 'resend' };
}

async function sendViaSendGrid({ to, subject, text, html }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return null;
  const response = await safeFetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_ADDRESS, name: FROM_NAME },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`SendGrid API ${response.status}: ${body.slice(0, 200)}`);
  }
  return { provider: 'sendgrid' };
}

async function sendViaSmtp({ to, subject, text, html }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  // Lazy-load nodemailer — keeps the module out of cold starts when SMTP
  // isn't configured.
  const { default: nodemailer } = await import('nodemailer');
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: `${FROM_NAME} <${FROM_ADDRESS}>`,
    to,
    subject,
    text,
    html,
  });
  return { provider: 'smtp', host };
}

export async function sendInviteEmail({
  to,
  organizationName,
  inviterName,
  role,
  token,
  expiresAt,
}) {
  const url = buildInviteUrl(token);
  const expiresStr = expiresAt instanceof Date
    ? expiresAt.toISOString()
    : expiresAt
      ? new Date(expiresAt).toISOString()
      : null;

  const content = renderInviteContent({
    organizationName,
    inviterName: inviterName || FROM_NAME,
    role,
    url,
    expiresAt,
  });

  const providers = [sendViaResend, sendViaSendGrid, sendViaSmtp];

  for (const send of providers) {
    try {
      const result = await send({ to, ...content });
      if (result) {
        logInfo('email_invite.sent', { provider: result.provider, to, organizationName });
        return { delivered: true, provider: result.provider, url };
      }
    } catch (error) {
      logError('email_invite.provider_failed', error, { to, organizationName });
      // Try the next provider; we only fall through to console if all fail
      // or none are configured.
    }
  }

  // Console fallback — also returned to the caller so admins can copy.
  logInfo('email_invite.scaffold', {
    to,
    subject: content.subject,
    organizationName,
    inviterName: inviterName || FROM_NAME,
    role,
    url,
    expiresAt: expiresStr,
  });
  return { delivered: false, fallbackLogged: true, url };
}

import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';
import { logAuditEvent } from '../../../lib/audit-log';
import { addTranscriptionEvent } from '../../../lib/transcription-events';
import { resolveVexaConfig } from '../../../lib/integrations';
import { encryptSecret, decryptSecret } from '../../../lib/secrets';
import {
  parseMeetingUrl,
  startBot,
  ensureVexaUser,
  createVexaUserToken,
  setUserWebhook,
} from '../../../lib/api/vexa';
import { startBridgeForTranscription } from '../../../lib/vexa-bridge';
import { ensureShareTokenForRow } from '../../../lib/share-chat-poster';
import { logError } from '../../../lib/observability';

const PROVIDER = 'vexa';
const SUPPORTED_PLATFORMS = new Set(['google_meet', 'teams', 'zoom', 'nextcloud_talk']);
const PLATFORM_LABELS = {
  google_meet: 'Google Meet',
  teams: 'Microsoft Teams',
  zoom: 'Zoom',
  nextcloud_talk: 'Nextcloud Talk',
};

async function loadUserEmail(userId) {
  const result = await query('SELECT email, name FROM users WHERE id = $1', [userId]);
  if (!result.rows.length) {
    const error = new Error('User row not found.');
    error.code = 'USER_NOT_FOUND';
    throw error;
  }
  return result.rows[0];
}

function buildWebhookUrl() {
  // APP_PUBLIC_URL is the service-to-service address (e.g. compose-internal
  // hostname like http://transkription-webapp:3000) and wins over the
  // browser-facing NEXTAUTH_URL so Vexa containers can actually reach us.
  const base = process.env.APP_PUBLIC_URL || process.env.NEXTAUTH_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/api/webhooks/vexa`;
}

async function registerWebhookForToken({ vexaConfig, apiKey }) {
  const webhookUrl = buildWebhookUrl();
  if (!webhookUrl) return false;
  await setUserWebhook(
    { baseUrl: vexaConfig.baseUrl, apiKey },
    {
      webhookUrl,
      webhookSecret: vexaConfig.webhookSecret || undefined,
      events: {
        'meeting.started': true,
        'meeting.completed': true,
        'meeting.status_change': true,
        'bot.failed': true,
      },
    },
  );
  return true;
}

async function ensureUserToken({ userId, orgId, userEmail, userName, vexaConfig }) {
  const existing = await query(
    `SELECT id, vexa_user_id, api_key_encrypted FROM vexa_user_tokens
      WHERE user_id = $1 AND organization_id = $2`,
    [userId, orgId],
  );
  if (existing.rows.length) {
    const row = existing.rows[0];
    const apiKey = decryptSecret(row.api_key_encrypted);
    if (apiKey) {
      await query(`UPDATE vexa_user_tokens SET last_used_at = NOW() WHERE id = $1`, [row.id]);
      return { vexaUserId: row.vexa_user_id, apiKey, fresh: false };
    }
  }

  const adminCreds = { baseUrl: vexaConfig.baseUrl, adminToken: vexaConfig.adminToken };
  const vexaUser = await ensureVexaUser(adminCreds, { email: userEmail, name: userName });
  const vexaUserId = vexaUser.id;
  const tokenResponse = await createVexaUserToken(adminCreds, {
    vexaUserId,
    scopes: ['bot', 'tx'],
    name: 'ghosttyper',
  });
  const apiKey = tokenResponse.token || tokenResponse.api_key || tokenResponse;
  if (typeof apiKey !== 'string' || !apiKey) {
    throw new Error('Vexa returned no token.');
  }
  const encrypted = encryptSecret(apiKey);
  if (!encrypted) {
    const error = new Error('SETTINGS_ENCRYPTION_KEY missing.');
    error.code = 'ENCRYPTION_UNAVAILABLE';
    throw error;
  }
  await query(
    `INSERT INTO vexa_user_tokens (user_id, organization_id, vexa_user_id, api_key_encrypted, scopes)
     VALUES ($1, $2, $3, $4, ARRAY['bot','tx']::TEXT[])
     ON CONFLICT (user_id, organization_id) DO UPDATE SET
       vexa_user_id = EXCLUDED.vexa_user_id,
       api_key_encrypted = EXCLUDED.api_key_encrypted,
       last_used_at = NOW()`,
    [userId, orgId, vexaUserId, encrypted],
  );
  return { vexaUserId, apiKey, fresh: true };
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'meeting.start')) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
  }

  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'meetings-start',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const {
    url: rawUrl,
    platform: rawPlatform,
    nativeMeetingId: rawNativeId,
    passcode,
    botName: rawBotName,
    language: rawLanguage,
    autoAnalyze,
    template,
    customPrompt,
    folderId,
    consentAccepted,
    translation: rawTranslation,
    inMeetingOverlay: rawInMeetingOverlay,
    audioInjectionLang: rawAudioInjectionLang,
    gdprChatNotice: rawGdprChatNotice,
  } = body;

  // Optional live-translation block; if absent the row is created with
  // translation_config = NULL and the bridge skips the translation hook.
  // Shape: { enabled: bool, fromLang: 'de', toLang: 'en' }
  const translationConfig = (() => {
    if (!rawTranslation || typeof rawTranslation !== 'object') return null;
    if (rawTranslation.enabled !== true) return null;
    const fromLang = typeof rawTranslation.fromLang === 'string' ? rawTranslation.fromLang.slice(0, 8) : null;
    const toLang = typeof rawTranslation.toLang === 'string' ? rawTranslation.toLang.slice(0, 8) : null;
    if (!fromLang || !toLang || fromLang === toLang) return null;
    return { enabled: true, fromLang, toLang, autoDetect: true };
  })();

  // Subtitle overlay only makes sense when translation is on. If the
  // caller asks for overlay without translation we silently drop it.
  // GDPR chat announcement — host-controlled per meeting. The dialog
  // pre-checks this from the org default, so an unset value here means
  // "host explicitly opted out".
  const gdprChatNoticeEnabled = rawGdprChatNotice === true;

  const inMeetingOverlay = !!translationConfig && rawInMeetingOverlay === true;
  // Audio injection: only meaningful when translation is on, and the
  // chosen language must be one of the configured pair. Silently drop
  // anything else so a malformed request can't enable audio in an
  // unintended state.
  const audioInjectionLang = (() => {
    if (!translationConfig) return null;
    if (typeof rawAudioInjectionLang !== 'string') return null;
    const lang = rawAudioInjectionLang.slice(0, 8).trim().toLowerCase();
    if (!lang) return null;
    if (lang !== translationConfig.fromLang.toLowerCase() && lang !== translationConfig.toLang.toLowerCase()) {
      return null;
    }
    return lang;
  })();

  if (consentAccepted !== true) {
    return res.status(400).json({
      code: 'CONSENT_REQUIRED',
      message: 'Bitte bestätigen Sie, dass alle Teilnehmer der Aufzeichnung zugestimmt haben.',
    });
  }

  let platform = rawPlatform;
  let nativeMeetingId = rawNativeId;
  let resolvedPasscode = passcode || undefined;

  if (rawUrl && (!platform || !nativeMeetingId)) {
    const parsed = parseMeetingUrl(rawUrl);
    if (!parsed) {
      return res.status(400).json({ code: 'INVALID_URL', message: 'Meeting-Link konnte nicht erkannt werden.' });
    }
    platform = parsed.platform;
    nativeMeetingId = parsed.nativeMeetingId;
    if (parsed.passcode && !resolvedPasscode) resolvedPasscode = parsed.passcode;
  }

  if (!platform || !SUPPORTED_PLATFORMS.has(platform)) {
    return res.status(400).json({ code: 'INVALID_PLATFORM', message: 'Nicht unterstützte Plattform.' });
  }
  if (!nativeMeetingId || typeof nativeMeetingId !== 'string') {
    return res.status(400).json({ code: 'INVALID_MEETING_ID', message: 'Meeting-ID fehlt.' });
  }

  const integration = await resolveVexaConfig(orgId);
  if (!integration.enabled) {
    return res.status(400).json({ code: 'INTEGRATION_DISABLED', message: 'Vexa-Integration ist nicht aktiviert.' });
  }
  const vexaConfig = integration.config;
  if (!vexaConfig.baseUrl || !vexaConfig.adminToken) {
    return res.status(400).json({ code: 'INTEGRATION_INCOMPLETE', message: 'Vexa-Konfiguration ist unvollständig.' });
  }

  const language = typeof rawLanguage === 'string' && rawLanguage ? rawLanguage : (vexaConfig.defaultLanguage || 'de');
  const botName = (typeof rawBotName === 'string' && rawBotName.trim()) || vexaConfig.defaultBotName || `${req.org.name} Notes`;
  const shouldAutoAnalyze = autoAnalyze !== false;
  // Friendly placeholder until the auto-analyse step replaces it with
  // the LLM-generated title. We avoid showing the raw join URL in the
  // transcription list — it leaks the meeting credentials and looks
  // ugly. Format: "Remote Meeting · Teams · 04.05.2026 09:42".
  const platformLabel = { google_meet: 'Google Meet', teams: 'Teams', zoom: 'Zoom' }[platform] || platform;
  const meetingUrlForOriginalName = `Remote Meeting · ${platformLabel} · ${new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

  let userInfo;
  try {
    userInfo = await loadUserEmail(userId);
  } catch (error) {
    logApiError('Meeting start: user lookup failed', error);
    return serverError(res, 'Benutzer konnte nicht aufgelöst werden.');
  }

  let userToken;
  try {
    userToken = await ensureUserToken({
      userId,
      orgId,
      userEmail: userInfo.email,
      userName: userInfo.name,
      vexaConfig,
    });
  } catch (error) {
    if (error.code === 'ENCRYPTION_UNAVAILABLE') {
      return res.status(500).json({ code: 'ENCRYPTION_UNAVAILABLE', message: error.message });
    }
    logApiError('Meeting start: token provisioning failed', error);
    return res.status(502).json({ code: 'VEXA_PROVISION_FAILED', message: 'Konnte keinen Vexa-Token bereitstellen.' });
  }

  if (userToken.fresh) {
    try {
      await registerWebhookForToken({ vexaConfig, apiKey: userToken.apiKey });
    } catch (error) {
      logError('vexa.webhook_registration_failed', error, { userId, orgId });
    }
  }

  const insertResult = await query(
    `INSERT INTO transcriptions
       (user_id, organization_id, original_name, source, meeting_platform, native_meeting_id,
        bot_status, status, template, model, diarize, custom_prompt, auto_analyze, folder_id,
        translation_config, in_meeting_overlay_enabled, audio_injection_lang, gdpr_notice_enabled)
     VALUES ($1, $2, $3, 'vexa', $4, $5, 'requested', 'pending', $6, $7, true, $8, $9, $10, $11::jsonb, $12, $13, $14)
     RETURNING id, status, source, meeting_platform, native_meeting_id, created_at`,
    [
      userId,
      orgId,
      meetingUrlForOriginalName,
      platform,
      nativeMeetingId,
      template || null,
      vexaConfig.preferredModel || null,
      typeof customPrompt === 'string' && customPrompt.trim() ? customPrompt.trim() : null,
      shouldAutoAnalyze,
      Number.isFinite(Number(folderId)) ? Number(folderId) : null,
      translationConfig ? JSON.stringify(translationConfig) : null,
      inMeetingOverlay,
      audioInjectionLang,
      gdprChatNoticeEnabled,
    ],
  );
  const transcription = insertResult.rows[0];

  // When translation is enabled at meeting start we mint the public
  // share-token NOW so it's ready by the time the bot joins. The
  // `meeting.started` webhook will then auto-post the link into the
  // meeting chat once the bot is actually in the room (see
  // `lib/share-chat-poster.js`).
  if (translationConfig) {
    try {
      await ensureShareTokenForRow({
        transcriptionId: transcription.id,
        organizationId: orgId,
        ttlHours: 24,
      });
    } catch (error) {
      logError('meetings.share_token_mint_failed', error, {
        transcriptionId: transcription.id,
      });
    }
  }

  await addTranscriptionEvent({
    transcriptionId: transcription.id,
    userId,
    organizationId: orgId,
    stage: 'vexa_requested',
    message: `Bot wird zu ${platform} gesendet (${nativeMeetingId}).`,
    meta: { platform, nativeMeetingId, botName, language },
  });

  let botResponse;
  try {
    botResponse = await startBot(
      { baseUrl: vexaConfig.baseUrl, apiKey: userToken.apiKey },
      {
        platform,
        nativeMeetingId,
        botName,
        language,
        passcode: resolvedPasscode,
        meetingUrl: rawUrl,
      },
    );
  } catch (error) {
    // Vexa returns FastAPI-style errors. `detail` may be a string or an
    // array of {loc, msg, type} entries — coerce both into a readable line.
    const upstreamRaw = error.response?.data?.detail ?? error.response?.data?.message;
    const upstreamMessage = Array.isArray(upstreamRaw)
      ? upstreamRaw.map((d) => `${(d.loc || []).join('.')}: ${d.msg}`).join('; ')
      : (typeof upstreamRaw === 'string' ? upstreamRaw : (upstreamRaw ? JSON.stringify(upstreamRaw) : error.message));
    await query(
      `UPDATE transcriptions SET status = 'error', bot_status = 'failed',
                                 error = $1, updated_at = NOW()
        WHERE id = $2`,
      [String(upstreamMessage || 'Bot start failed.').slice(0, 500), transcription.id],
    );
    await addTranscriptionEvent({
      transcriptionId: transcription.id,
      userId,
      organizationId: orgId,
      stage: 'error',
      message: `Bot konnte nicht gestartet werden: ${upstreamMessage || error.message}`,
    });
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'meeting.bot.start_failed',
      targetType: 'transcription',
      targetId: String(transcription.id),
      severity: 'warn',
      metadata: { platform, nativeMeetingId, error: upstreamMessage || error.message },
    });
    return res.status(502).json({ code: 'VEXA_BOT_FAILED', message: upstreamMessage || error.message });
  }

  const externalMeetingId = botResponse?.id || botResponse?.meeting?.id || null;
  await query(
    `UPDATE transcriptions SET external_meeting_id = $1, bot_status = $2, updated_at = NOW()
      WHERE id = $3`,
    [externalMeetingId ? String(externalMeetingId) : null, botResponse?.status || 'requested', transcription.id],
  );

  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: 'meeting.bot.start',
    targetType: 'transcription',
    targetId: String(transcription.id),
    metadata: {
      platform,
      nativeMeetingId,
      botName,
      language,
      autoAnalyze: shouldAutoAnalyze,
      consent: true,
      externalMeetingId,
    },
  });

  startBridgeForTranscription(transcription.id);

  return res.status(201).json({
    id: transcription.id,
    status: transcription.status,
    source: transcription.source,
    platform,
    nativeMeetingId,
    externalMeetingId,
    createdAt: transcription.created_at,
  });
}

export default withOrgScope({ permission: 'meeting.start' }, handler);

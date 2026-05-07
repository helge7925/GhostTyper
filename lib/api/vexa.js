import axios from 'axios';

const DEFAULT_TIMEOUT_MS = 15_000;

function joinUrl(base, path) {
  if (!base) throw new Error('Vexa baseUrl is not configured.');
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

function userClient(baseUrl, apiKey, options = {}) {
  return axios.create({
    baseURL: baseUrl.replace(/\/+$/, ''),
    timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    validateStatus: (s) => s >= 200 && s < 300,
  });
}

function adminClient(baseUrl, adminToken, options = {}) {
  return axios.create({
    baseURL: baseUrl.replace(/\/+$/, ''),
    timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    headers: { 'X-Admin-API-Key': adminToken, 'Content-Type': 'application/json' },
    validateStatus: (s) => s >= 200 && s < 300,
  });
}

export async function startBot({ baseUrl, apiKey }, { platform, nativeMeetingId, botName, language, passcode, meetingUrl }) {
  const client = userClient(baseUrl, apiKey);
  const body = { platform, native_meeting_id: nativeMeetingId };
  if (botName) body.bot_name = botName;
  if (language) body.language = language;
  if (passcode) body.passcode = passcode;
  // Vexa v0.10.5+ uses meeting_url as a best-effort fallback when our
  // parser misses something (e.g. white-label Teams URLs). Sending it
  // is harmless even when our parsed values already work.
  if (meetingUrl) body.meeting_url = meetingUrl;
  const { data } = await client.post('/bots', body);
  return data;
}

export async function stopBot({ baseUrl, apiKey }, { platform, nativeMeetingId }) {
  const client = userClient(baseUrl, apiKey);
  const { data } = await client.delete(`/bots/${encodeURIComponent(platform)}/${encodeURIComponent(nativeMeetingId)}`);
  return data;
}

export async function updateBotConfig({ baseUrl, apiKey }, { platform, nativeMeetingId, language }) {
  const client = userClient(baseUrl, apiKey);
  const body = {};
  if (language) body.language = language;
  const { data } = await client.put(
    `/bots/${encodeURIComponent(platform)}/${encodeURIComponent(nativeMeetingId)}/config`,
    body
  );
  return data;
}

export async function getTranscript({ baseUrl, apiKey }, { platform, nativeMeetingId }) {
  const client = userClient(baseUrl, apiKey);
  const { data } = await client.get(
    `/transcripts/${encodeURIComponent(platform)}/${encodeURIComponent(nativeMeetingId)}`
  );
  return data;
}

/**
 * Render arbitrary HTML/image/url content onto the bot's webcam feed.
 * Per Vexa-Lite 0.10.0 source (`vexa-bot/src/services/screen-content.ts`),
 * the bot doesn't actually screen-share — it monkey-patches
 * `navigator.mediaDevices.getUserMedia` and substitutes a 1920×1080
 * canvas for its camera. Whatever we ship as `url` (preferred) gets
 * loaded into that canvas via an iframe, which Google Meet / Teams
 * then renders as the bot's video tile.
 *
 * Endpoint contract:
 *   POST /bots/{platform}/{nativeMeetingId}/screen
 *   body: {
 *     type: "url" | "html" | "image" | "video",
 *     url?: string,         // for type=url|image|video
 *     html?: string,        // for type=html
 *     start_share?: boolean // ignored on platforms where Xvfb screen-share
 *                           // doesn't work; the camera-feed path is used
 *                           // either way
 *   }
 *
 * For our live-translation overlay we always use `type: "url"` pointing
 * at a public `/share/[token]/overlay` page. The page itself does the
 * SSE-based live updates so the bot doesn't need to be re-poked.
 */
export async function setBotScreenContent(
  { baseUrl, apiKey },
  { platform, nativeMeetingId, type = 'url', url, html, startShare = true },
) {
  const body = { type, start_share: startShare };
  if (url) body.url = url;
  if (html) body.html = html;
  const client = userClient(baseUrl, apiKey);
  const { data } = await client.post(
    `/bots/${encodeURIComponent(platform)}/${encodeURIComponent(nativeMeetingId)}/screen`,
    body,
  );
  return data;
}

/**
 * Stop the bot's custom screen content and revert the camera feed to
 * the Vexa default avatar. Called on `meeting.completed` so the bot
 * exits cleanly even if the host never toggled the overlay off.
 */
export async function clearBotScreenContent({ baseUrl, apiKey }, { platform, nativeMeetingId }) {
  const client = userClient(baseUrl, apiKey);
  const { data } = await client.delete(
    `/bots/${encodeURIComponent(platform)}/${encodeURIComponent(nativeMeetingId)}/screen`,
  );
  return data;
}

/**
 * Post a text message into the meeting chat via the Vexa bot.
 * Used today to share the live-translation companion-link with all
 * meeting participants — they don't need a GhostTyper account, they
 * just click the link the bot just typed.
 *
 * Endpoint contract (Vexa-Lite ≥ 0.10.0):
 *   POST /bots/{platform}/{nativeMeetingId}/chat
 *   body: { "text": "..." }
 *
 * The Vexa bot writes into whichever chat surface the platform exposes
 * (Google Meet sidebar, Teams chat, Zoom chat). Per-platform formatting
 * may differ — pass plain text + URL, no markdown.
 */
export async function sendBotChatMessage({ baseUrl, apiKey }, { platform, nativeMeetingId, text }) {
  if (!text || !String(text).trim()) {
    throw new Error('CHAT_MESSAGE_EMPTY');
  }
  const client = userClient(baseUrl, apiKey);
  const { data } = await client.post(
    `/bots/${encodeURIComponent(platform)}/${encodeURIComponent(nativeMeetingId)}/chat`,
    { text: String(text).slice(0, 1000) },
  );
  return data;
}

export async function setUserWebhook({ baseUrl, apiKey }, { webhookUrl, webhookSecret, events }) {
  const client = userClient(baseUrl, apiKey);
  const body = { webhook_url: webhookUrl };
  if (webhookSecret) body.webhook_secret = webhookSecret;
  if (events) body.webhook_events = events;
  const { data } = await client.put('/user/webhook', body);
  return data;
}

export async function ensureVexaUser({ baseUrl, adminToken }, { email, name }) {
  const client = adminClient(baseUrl, adminToken);
  const body = { email };
  if (name) body.name = name;
  const { data } = await client.post('/admin/users', body);
  return data;
}

export async function createVexaUserToken({ baseUrl, adminToken }, { vexaUserId, scopes = ['bot', 'tx'], name = 'ghosttyper' }) {
  const client = adminClient(baseUrl, adminToken);
  const params = new URLSearchParams();
  params.set('scopes', scopes.join(','));
  if (name) params.set('name', name);
  const { data } = await client.post(`/admin/users/${vexaUserId}/tokens?${params.toString()}`);
  return data;
}

export async function adminHealthCheck({ baseUrl, adminToken }) {
  try {
    await axios.get(joinUrl(baseUrl, '/'), { timeout: 5000 });
  } catch (error) {
    const message = error.response ? `Vexa returned ${error.response.status}` : error.message;
    throw new Error(`Health check failed: ${message}`);
  }
  const client = adminClient(baseUrl, adminToken, { timeoutMs: 8000 });
  const { data } = await client.get('/admin/users?limit=1');
  return { ok: true, sample: Array.isArray(data) ? data.length : 0 };
}

const MEETING_URL_PATTERNS = [
  {
    platform: 'google_meet',
    test: /(?:meet\.google\.com\/)([a-z]{3}-[a-z]{4}-[a-z]{3})/i,
    extract: (match) => ({ nativeMeetingId: match[1].toLowerCase() }),
  },
  {
    platform: 'zoom',
    test: /zoom\.us\/j\/(\d+)(?:\?[^#]*?\bpwd=([^&#]+))?/i,
    extract: (match) => ({ nativeMeetingId: match[1], passcode: match[2] || undefined }),
  },
  {
    platform: 'teams',
    // Microsoft Teams meeting URLs come in four shapes:
    //   1) teams.microsoft.com/l/meetup-join/19%3ameeting_<id>%40thread.v2/...   (Outlook-generated, most common)
    //   2) teams.microsoft.com/meet/<numeric-id>?p=<passcode>                    (modern simplified business links)
    //   3) teams.live.com/meet/<short-id>                                        (personal/consumer Teams)
    //   4) teams.microsoft.com/_#/conv/19:meeting_<id>@thread.v2                 (legacy hash route)
    // Group 4 captures an optional `?p=<passcode>` query parameter, used by shapes 2 and 3.
    test: /teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join\/(19[%:][^/?#\s]+)|meet\/([A-Za-z0-9_-]+)|_#\/conv\/(19[%:][^/?#\s]+))(?:\?[^#]*?\bp=([^&#]+))?/i,
    extract: (match) => ({
      nativeMeetingId: decodeURIComponent(match[1] || match[2] || match[3]),
      passcode: match[4] || undefined,
    }),
  },
];

export function parseMeetingUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  for (const pattern of MEETING_URL_PATTERNS) {
    const match = trimmed.match(pattern.test);
    if (match) {
      return { platform: pattern.platform, ...pattern.extract(match) };
    }
  }
  return null;
}

const SPEAKER_COLORS = ['#f97316', '#0ea5e9', '#22c55e', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444'];

export function mapVexaTranscriptToGhostTyper(vexaTranscript) {
  const rawSegments = Array.isArray(vexaTranscript?.segments) ? vexaTranscript.segments : [];
  const segments = rawSegments.map((seg) => ({
    start: typeof seg.start === 'number' ? seg.start : 0,
    end: typeof seg.end === 'number' ? seg.end : 0,
    text: typeof seg.text === 'string' ? seg.text.trim() : '',
    speaker: seg.speaker ?? null,
    language: seg.language ?? null,
  }));
  const text = segments
    .map((s) => s.text)
    .filter(Boolean)
    .join(' ');
  const speakerIds = [...new Set(segments.map((s) => s.speaker).filter((s) => s !== null && s !== undefined))];
  const speakers = speakerIds.map((id, idx) => ({
    id: String(id),
    label: typeof id === 'string' && id.trim() ? id : `Sprecher ${idx + 1}`,
    color: SPEAKER_COLORS[idx % SPEAKER_COLORS.length],
  }));
  return { text, segments, speakers };
}

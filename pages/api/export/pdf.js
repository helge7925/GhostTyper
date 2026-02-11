import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { checkRateLimit, applyRateLimitHeaders } from '../../../lib/rate-limit';
import { logApiError, serverError } from '../../../lib/api-utils';
import { renderPdfBufferFromHtml } from '../../../lib/pdf-export';
import { getSettingsRow } from '../../../lib/settings-service';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '3mb',
    },
  },
};

const ALLOWED_THEMES = new Set(['atelier', 'ghosttyper', 'minimal']);
const ALLOWED_FONT_PRESETS = new Set(['google-sans', 'google-serif', 'system', 'humanist', 'serif']);

function normalizeFilename(filename) {
  const base = String(filename || 'dokument')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

  return base || 'dokument';
}

function normalizeDocumentTitle(filename) {
  const value = String(filename || 'Dokument')
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, 120);
  return value || 'Dokument';
}

function normalizeTheme(theme) {
  if (typeof theme !== 'string') return 'atelier';
  return ALLOWED_THEMES.has(theme) ? theme : 'atelier';
}

function normalizeFontPreset(fontPreset) {
  if (typeof fontPreset !== 'string') return 'google-sans';
  return ALLOWED_FONT_PRESETS.has(fontPreset) ? fontPreset : 'google-sans';
}

function normalizePremiumLayout(value) {
  if (value === true || value === 'true') return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const userIdentifier = session?.user?.id || session?.user?.email || 'unknown';
  const rate = checkRateLimit(req, {
    keyPrefix: 'export-pdf',
    identifier: `user:${userIdentifier}`,
    limit: 20,
    windowMs: 60_000,
  });
  applyRateLimitHeaders(res, rate);
  if (!rate.allowed) {
    return res.status(429).json({ message: 'Zu viele Exporte. Bitte später erneut versuchen.' });
  }

  try {
    const { html, filename, theme, fontPreset, premiumLayout } = req.body || {};
    if (!html || typeof html !== 'string') {
      return res.status(400).json({ message: 'HTML-Inhalt fehlt.' });
    }

    const settings = await getSettingsRow(session.user.id);
    const premiumProfile = settings
      ? {
          project: settings.pdf_premium_company,
          company: settings.pdf_premium_company,
          name: settings.pdf_premium_name,
          role: settings.pdf_premium_role,
          contact: settings.pdf_premium_contact,
          footer: settings.pdf_premium_footer,
        }
      : null;

    const pdfBuffer = await renderPdfBufferFromHtml(html, {
      theme: normalizeTheme(theme),
      fontPreset: normalizeFontPreset(fontPreset),
      premiumLayout: normalizePremiumLayout(premiumLayout),
      premiumProfile,
      documentTitle: normalizeDocumentTitle(filename),
    });
    const safeName = `${normalizeFilename(filename)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    if (error.message === 'PDF_RENDERER_UNAVAILABLE') {
      return res.status(503).json({ message: 'PDF-Renderer ist nicht verfügbar.' });
    }
    if (error.message === 'PDF_RENDER_TIMEOUT') {
      return res.status(504).json({ message: 'PDF-Erstellung dauerte zu lange.' });
    }
    logApiError('PDF export error', error);
    return serverError(res, 'PDF-Export fehlgeschlagen');
  }
}

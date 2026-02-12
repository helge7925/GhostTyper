import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { renderPdfBufferFromHtml } from '../../../lib/pdf-export';
import { getSettingsRow } from '../../../lib/settings-service';
import { withPdfRenderSlot } from '../../../lib/pdf-render-limiter';
import { normalizePdfFontPreset, normalizePdfTheme } from '../../../lib/pdf-print-style';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '3mb',
    },
  },
};

const MAX_PDF_HTML_LENGTH = 2_000_000;

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
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'export-pdf',
    identifier: `user:${userIdentifier}`,
    limit: 20,
    windowMs: 60_000,
  }, 'Zu viele Exporte. Bitte später erneut versuchen.');
  if (!allowed) return;

  try {
    const { html, filename, theme, fontPreset, premiumLayout } = req.body || {};
    if (!html || typeof html !== 'string') {
      return res.status(400).json({ message: 'HTML-Inhalt fehlt.' });
    }
    if (html.length > MAX_PDF_HTML_LENGTH) {
      return res.status(413).json({ message: 'HTML-Inhalt ist zu groß für den PDF-Export.' });
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

    const pdfBuffer = await withPdfRenderSlot(() => renderPdfBufferFromHtml(html, {
      theme: normalizePdfTheme(theme),
      fontPreset: normalizePdfFontPreset(fontPreset),
      premiumLayout: normalizePremiumLayout(premiumLayout),
      premiumProfile,
      documentTitle: normalizeDocumentTitle(filename),
    }));
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
    if (error.message === 'PDF_RENDER_BUSY') {
      return res.status(503).json({ message: 'PDF-Export ist derzeit ausgelastet. Bitte in wenigen Sekunden erneut versuchen.' });
    }
    logApiError('PDF export error', error);
    return serverError(res, 'PDF-Export fehlgeschlagen');
  }
}

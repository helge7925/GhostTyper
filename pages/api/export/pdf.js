import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { renderPdfBufferFromHtml } from '../../../lib/pdf-export';
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
    const { html, filename, theme, fontPreset } = req.body || {};
    if (!html || typeof html !== 'string') {
      return res.status(400).json({ message: 'HTML-Inhalt fehlt.' });
    }
    if (html.length > MAX_PDF_HTML_LENGTH) {
      return res.status(413).json({ message: 'HTML-Inhalt ist zu groß für den PDF-Export.' });
    }

    const pdfBuffer = await withPdfRenderSlot(() => renderPdfBufferFromHtml(html, {
      theme: normalizePdfTheme(theme),
      fontPreset: normalizePdfFontPreset(fontPreset),
      documentTitle: normalizeDocumentTitle(filename),
    }));
    const safeName = `${normalizeFilename(filename)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    const errorMessage = String(error?.message || '');
    if (errorMessage.startsWith('PDF_RENDERER_UNAVAILABLE')) {
      return res.status(503).json({ message: 'PDF-Renderer ist nicht verfügbar. Chromium/Chrome installieren oder PDF_CHROMIUM_PATH setzen.' });
    }
    if (errorMessage === 'PDF_RENDER_TIMEOUT') {
      return res.status(504).json({ message: 'PDF-Erstellung dauerte zu lange.' });
    }
    if (errorMessage === 'PDF_RENDER_BUSY') {
      return res.status(503).json({ message: 'PDF-Export ist derzeit ausgelastet. Bitte in wenigen Sekunden erneut versuchen.' });
    }
    if (errorMessage.startsWith('PDF_RENDER_FAILED')) {
      return res.status(503).json({ message: 'PDF-Renderer konnte kein PDF erzeugen.' });
    }
    if (errorMessage.startsWith('PDF_RENDER_SPAWN_FAILED')) {
      return res.status(503).json({ message: 'PDF-Renderer konnte nicht gestartet werden.' });
    }
    logApiError('PDF export error', error);
    return serverError(res, 'PDF-Export fehlgeschlagen');
  }
}

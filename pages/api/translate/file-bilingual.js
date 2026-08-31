import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { buildBilingualHtml, normalizeBilingualExportInput } from '../../../lib/bilingual-export';
import { renderPdfBufferFromHtml } from '../../../lib/pdf-export';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'translate-file-bilingual',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const { value, error: validationError } = normalizeBilingualExportInput(req.body);
  if (validationError) return res.status(400).json({ message: validationError });

  try {
    const html = buildBilingualHtml(value);

    if (value.format === 'pdf') {
      const buffer = await renderPdfBufferFromHtml(html, {});
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="bilingual-translation.pdf"');
      return res.status(200).send(buffer);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bilingual-translation.html"');
    return res.status(200).send(html);
  } catch (error) {
    logApiError('Bilingual export error', error);
    return serverError(res, 'Bilingualer Export konnte nicht erstellt werden');
  }
}

export default withOrgScope({ permission: 'document.read' }, handler);

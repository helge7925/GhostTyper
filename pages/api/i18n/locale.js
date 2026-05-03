import { SUPPORTED_LOCALES, normalizeLocale, LOCALE_COOKIE } from '../../../lib/i18n';

/**
 * POST /api/i18n/locale  body: { locale: 'de' | 'en' }
 *
 * Persists the chosen locale in an httpOnly=false cookie so the next SSR
 * render can pick it up via _document.getInitialProps. Public on purpose:
 * choosing a UI language doesn't require auth.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  const next = normalizeLocale(req.body?.locale);
  if (!next) {
    return res.status(400).json({
      code: 'UNSUPPORTED_LOCALE',
      message: 'locale muss einer der unterstützten Werte sein.',
      supported: SUPPORTED_LOCALES,
    });
  }

  const oneYear = 60 * 60 * 24 * 365;
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${LOCALE_COOKIE}=${encodeURIComponent(next)}`,
    'Path=/',
    `Max-Age=${oneYear}`,
    'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
  return res.status(200).json({ ok: true, locale: next });
}

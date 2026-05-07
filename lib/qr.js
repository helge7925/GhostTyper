import QRCode from 'qrcode';

/**
 * Server-side QR-code generation for the bot-camera overlay page.
 *
 * Returns an inline SVG string ready to drop into HTML. We deliberately
 * default to the "M" error-correction level (~15% redundancy) which
 * stays scannable when the bot's webcam canvas is downscaled into a
 * tiny gallery tile (Meet/Teams ship the camera feed at <320 px on
 * mobile or in a 12-tile grid).
 *
 * `size` is the rendered SVG side-length in pixels. The QR matrix
 * itself is fixed by the data length and error level; the `width`
 * option scales the SVG viewBox.
 *
 * Inline (string) output rather than a Buffer/file because the
 * overlay route stitches everything into a single self-contained HTML
 * response — no extra HTTP round-trips for the iframe.
 */
const DEFAULT_OPTIONS = {
  type: 'svg',
  errorCorrectionLevel: 'M',
  margin: 1,
  color: {
    dark: '#FFFFFF',  // QR dots: white
    light: '#000000', // background: black (matches overlay theme)
  },
};

export async function buildQrSvg(text, { size = 240 } = {}) {
  if (!text || typeof text !== 'string') {
    throw new Error('QR_TEXT_REQUIRED');
  }
  return QRCode.toString(text, {
    ...DEFAULT_OPTIONS,
    width: size,
  });
}

/**
 * Convenience: returns an `<img>`-suitable data URI. Useful when the
 * caller wants to embed the QR in a non-HTML context (e.g. a JSON API
 * response). For the overlay page itself we prefer raw SVG so the
 * markup stays inspectable.
 */
export async function buildQrDataUri(text, options = {}) {
  const svg = await buildQrSvg(text, options);
  const base64 = Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

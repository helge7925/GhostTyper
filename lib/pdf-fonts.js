import { readFile } from 'fs/promises';
import path from 'path';
import fontkit from '@pdf-lib/fontkit';

const FONT_PACKAGES = {
  latin: { packageDir: 'noto-sans', packageName: '@fontsource/noto-sans', family: 'Noto Sans' },
  arabic: { packageDir: 'noto-sans-arabic', packageName: '@fontsource/noto-sans-arabic', family: 'Noto Sans Arabic' },
  sc: { packageDir: 'noto-sans-sc', packageName: '@fontsource/noto-sans-sc', family: 'Noto Sans SC' },
  tc: { packageDir: 'noto-sans-tc', packageName: '@fontsource/noto-sans-tc', family: 'Noto Sans TC' },
};
const STYLE = {
  regular: { weight: 400, style: 'normal' },
  bold: { weight: 700, style: 'normal' },
  italic: { weight: 400, style: 'italic' },
  bolditalic: { weight: 700, style: 'italic' },
};
const assetBytesCache = new Map();
const manifestCache = new Map();

export class PdfFontCoverageError extends Error {
  constructor(missingGlyphs) {
    super(`PDF target text contains ${missingGlyphs.length} unsupported glyph(s)`);
    this.name = 'PdfFontCoverageError';
    this.code = 'PDF_FONT_COVERAGE';
    this.reason = 'missing-glyphs';
    this.missingGlyphs = missingGlyphs;
  }
}

function packageRoot(key) {
  const descriptor = FONT_PACKAGES[key];
  const packaged = path.join(process.cwd(), 'pdf-fonts', descriptor.packageDir);
  const installed = path.join(process.cwd(), 'node_modules', ...descriptor.packageName.split('/'));
  return { descriptor, packaged, installed };
}

async function readAsset(key, relativePath) {
  const cacheKey = `${key}:${relativePath}`;
  if (!assetBytesCache.has(cacheKey)) {
    const { packaged, installed } = packageRoot(key);
    assetBytesCache.set(cacheKey, readFile(path.join(packaged, relativePath))
      .catch(() => readFile(path.join(installed, relativePath))));
  }
  return assetBytesCache.get(cacheKey);
}

function parseRanges(value) {
  return String(value || '').split(',').map((part) => {
    const [start, end = start] = part.trim().replace(/^U\+/i, '').split('-');
    return [Number.parseInt(start, 16), Number.parseInt(end, 16)];
  }).filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end));
}

async function getManifest(key) {
  if (!manifestCache.has(key)) {
    manifestCache.set(key, readAsset(key, 'unicode.json').then((bytes) => {
      const json = JSON.parse(Buffer.from(bytes).toString('utf8'));
      return Object.entries(json).map(([subset, range]) => ({ subset, ranges: parseRanges(range) }));
    }));
  }
  return manifestCache.get(key);
}

function includesCodePoint(entry, codePoint) {
  return entry.ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function normalizedSubset(subset) {
  return subset.replace(/^\[/, '').replace(/\]$/, '');
}

function isHan(codePoint) {
  return (codePoint >= 0x3400 && codePoint <= 0x9fff)
    || (codePoint >= 0x20000 && codePoint <= 0x2ffff);
}

function isArabic(codePoint) {
  return (codePoint >= 0x0600 && codePoint <= 0x06ff)
    || (codePoint >= 0x0750 && codePoint <= 0x077f)
    || (codePoint >= 0x08a0 && codePoint <= 0x08ff)
    || (codePoint >= 0xfb50 && codePoint <= 0xfdff)
    || (codePoint >= 0xfe70 && codePoint <= 0xfeff);
}

function styleForSegment(segment) {
  const value = `${segment.fontName || ''} ${segment.fontFamily || ''}`.toLowerCase();
  const bold = /bold|black|heavy|semibold/.test(value);
  const italic = /italic|oblique/.test(value);
  return bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
}

function cjkPreference(targetLanguage) {
  const language = String(targetLanguage || '').toLowerCase().replace(/_/g, '-');
  if (/traditional|zh-tw|zh-hk|zh-hant|繁體|繁体/.test(language)) return ['tc', 'sc'];
  return ['sc', 'tc'];
}

function filenameFor(key, subset, styleKey) {
  const { weight, style } = key === 'latin' ? STYLE[styleKey] : STYLE.regular;
  const prefix = FONT_PACKAGES[key].packageDir;
  return `files/${prefix}-${normalizedSubset(subset)}-${weight}-${style}.woff`;
}

async function candidatesForCharacter(char, styleKey, targetLanguage) {
  const codePoint = char.codePointAt(0);
  const latinManifest = await getManifest('latin');
  const cjkKeys = cjkPreference(targetLanguage);
  const orderedKeys = isHan(codePoint)
    ? cjkKeys
    : isArabic(codePoint)
      ? ['arabic']
      : ['latin', ...cjkKeys];
  const candidates = [];
  for (const key of orderedKeys) {
    const manifest = key === 'latin' ? latinManifest : await getManifest(key);
    for (const entry of manifest) {
      if (!includesCodePoint(entry, codePoint)) continue;
      candidates.push({
        key,
        family: FONT_PACKAGES[key].family,
        subset: entry.subset,
        styleKey: key === 'latin' || key === 'arabic' ? styleKey : 'regular',
        path: filenameFor(key, entry.subset, styleKey),
      });
    }
  }
  return candidates;
}

function missingGlyph(char, segmentIndex) {
  return {
    segment: segmentIndex,
    character: char,
    codePoint: `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
  };
}

/**
 * Resolve and embed only assets used by this document. Fontsource's OFL web
 * fonts are already unicode-range subsets; pdf-lib subsets them again to the
 * glyphs actually drawn.
 */
export async function createPdfFontPlan(pdfDoc, segments, translations, { targetLanguage } = {}) {
  pdfDoc.registerFontkit(fontkit);
  const embedded = new Map();
  const embeddedFonts = new Map();
  const substitutions = [];
  const scriptFallbackReasons = [];
  const missingGlyphs = [];

  async function getEmbedded(candidate) {
    const cacheKey = `${candidate.key}:${candidate.path}`;
    if (!embedded.has(cacheKey)) {
      embedded.set(cacheKey, readAsset(candidate.key, candidate.path).then(async (bytes) => {
        const font = await pdfDoc.embedFont(bytes, { subset: true });
        const characterSet = new Set(font.getCharacterSet());
        embeddedFonts.set(cacheKey, {
          family: candidate.family,
          asset: path.basename(candidate.path),
          subset: true,
          license: 'OFL-1.1',
        });
        return { font, characterSet, candidate };
      }));
    }
    return embedded.get(cacheKey);
  }

  const plannedSegments = [];
  for (let index = 0; index < segments.length; index += 1) {
    const text = String(translations[index] ?? '').replace(/\s+/g, ' ').trim();
    const styleKey = styleForSegment(segments[index]);
    const glyphs = [];
    let usedCjkStyleFallback = false;
    for (const char of text) {
      if (/\s/.test(char)) {
        const fallback = glyphs[glyphs.length - 1]?.embedded;
        glyphs.push({ char: ' ', embedded: fallback || null });
        continue;
      }
      const candidates = await candidatesForCharacter(char, styleKey, targetLanguage);
      let selected = null;
      for (const candidate of candidates) {
        try {
          const resolved = await getEmbedded(candidate);
          if (resolved.characterSet.has(char.codePointAt(0))) {
            selected = resolved;
            break;
          }
        } catch {
          // A bad or unsupported asset is equivalent to missing coverage. The
          // complete list is reported and the rewrite fails before returning.
        }
      }
      if (!selected) {
        missingGlyphs.push(missingGlyph(char, index));
        continue;
      }
      if (selected.candidate.key !== 'latin' && styleKey !== 'regular') {
        usedCjkStyleFallback = true;
      }
      glyphs.push({ char, embedded: selected });
    }
    const first = glyphs.find((glyph) => glyph.embedded)?.embedded;
    for (const glyph of glyphs) if (!glyph.embedded) glyph.embedded = first;
    if (usedCjkStyleFallback) {
      scriptFallbackReasons.push({ segment: index, reason: 'cjk-regular-style-substitution' });
    }
    if (first) {
      const families = [...new Set(glyphs.map((glyph) => glyph.embedded.candidate.family))];
      substitutions.push({
        segment: index,
        from: segments[index].fontFamily || segments[index].fontName || 'unknown',
        to: families.join(', '),
        reason: 'application-font-substitution',
      });
    }
    plannedSegments.push({ text, glyphs });
  }

  if (missingGlyphs.length > 0) throw new PdfFontCoverageError(missingGlyphs);
  return {
    segments: plannedSegments,
    report: {
      embeddedFonts: [...embeddedFonts.values()],
      substitutions,
      missingGlyphs,
      scriptFallbackReasons,
    },
  };
}

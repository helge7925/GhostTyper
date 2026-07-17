// Layout-preserving ("in-place") PDF translation for digital PDFs.
//
// Pipeline (see openspec/changes/pdf-inplace-translation/design.md):
//   detectTextLayer → extractRuns → segmentRuns → (translate) → rewritePdf
//
// Digital PDFs carry an embedded text layer we can extract with positions and
// rewrite in place. Scanned PDFs (image-only) have no meaningful text layer and
// stay on the existing OCR → re-render fallback path. This module owns the
// digital path only; the routing decision lives in pages/api/translate/file.js.
//
// Coordinate model: pdfjs `getTextContent` returns each run's transform in the
// PDF's bottom-left-origin text space, and pdf-lib draws in the same space, so
// extracted baselines are reused directly when redrawing — no Y-flip needed.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// --- text-layer detection tuning -------------------------------------------
// A page counts as "text-bearing" when it exposes at least this many
// non-whitespace characters through the text layer. Scanned pages typically
// expose 0 (image only) or a few stray OCR-less glyphs. The whole document is
// treated as digital when the sampled pages average at least this many chars.
export const MIN_CHARS_PER_TEXT_PAGE = 40;
export const DEFAULT_TEXT_LAYER_SAMPLE_PAGES = 3;

// Baseline height ratios used when the font program does not expose ascent /
// descent metrics through pdfjs styles. Deliberately generous so white-out
// rectangles fully cover the original glyphs.
const DEFAULT_ASCENT_RATIO = 0.8;
const DEFAULT_DESCENT_RATIO = 0.22;

function toUint8(buffer) {
  if (buffer instanceof Uint8Array) {
    // pdfjs may detach/transfer the backing buffer; hand it a private copy so
    // the caller's Buffer stays usable afterwards.
    return new Uint8Array(buffer);
  }
  return new Uint8Array(Buffer.from(buffer));
}

async function loadPdfDocument(buffer) {
  const task = getDocument({
    data: toUint8(buffer),
    useSystemFonts: false,
    isEvalSupported: false,
    // 0 = errors only; silences the harmless "standardFontDataUrl" info the
    // Node build logs when it renders nothing (we only read text).
    verbosity: 0,
  });
  return task.promise;
}

function countNonWhitespace(text) {
  return (String(text || '').match(/\S/g) || []).length;
}

/**
 * Sample up to `samplePages` pages and decide whether the PDF has a usable
 * embedded text layer. Returns a descriptor even on parse failure (digital:
 * false) so the caller can fall back cleanly.
 */
export async function detectTextLayer(buffer, {
  samplePages = DEFAULT_TEXT_LAYER_SAMPLE_PAGES,
  minCharsPerPage = MIN_CHARS_PER_TEXT_PAGE,
} = {}) {
  let pdf;
  try {
    pdf = await loadPdfDocument(buffer);
  } catch (error) {
    return {
      digital: false,
      pages: 0,
      sampledPages: 0,
      totalChars: 0,
      avgCharsPerPage: 0,
      textPageRatio: 0,
      reason: `pdf-parse-failed: ${error?.message || 'unknown'}`,
    };
  }

  try {
    const pageCount = pdf.numPages;
    const sampled = Math.max(1, Math.min(samplePages, pageCount));
    let totalChars = 0;
    let textPages = 0;
    for (let i = 1; i <= sampled; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const chars = content.items.reduce((sum, item) => sum + countNonWhitespace(item.str), 0);
      totalChars += chars;
      if (chars >= minCharsPerPage) textPages += 1;
    }
    const avgCharsPerPage = totalChars / sampled;
    return {
      digital: avgCharsPerPage >= minCharsPerPage,
      pages: pageCount,
      sampledPages: sampled,
      totalChars,
      avgCharsPerPage,
      textPageRatio: textPages / sampled,
      reason: avgCharsPerPage >= minCharsPerPage ? 'text-layer-present' : 'no-meaningful-text-layer',
    };
  } finally {
    await pdf.cleanup().catch(() => {});
    await pdf.destroy().catch(() => {});
  }
}

function fontMetrics(styles, fontName, fontSize) {
  const style = styles && styles[fontName];
  const ascentRatio = Number.isFinite(style?.ascent) && style.ascent > 0 ? style.ascent : DEFAULT_ASCENT_RATIO;
  const descentRatio = Number.isFinite(style?.descent) ? Math.abs(style.descent) : DEFAULT_DESCENT_RATIO;
  const fontFamily = style?.fontFamily || '';
  return {
    top: fontSize * ascentRatio,
    bottom: fontSize * descentRatio,
    fontFamily,
  };
}

/**
 * Extract positioned text runs for every page. Empty / whitespace-only items
 * with no advance width are dropped (pdfjs emits them as line separators).
 * Returns { pageCount, pages: [{number,width,height}], runs: [...] }.
 */
export async function extractRuns(buffer) {
  const pdf = await loadPdfDocument(buffer);
  try {
    const pageCount = pdf.numPages;
    const pages = [];
    const runs = [];
    for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ number: pageNum, width: viewport.width, height: viewport.height });
      const content = await page.getTextContent();
      const styles = content.styles || {};
      for (const item of content.items) {
        const str = item.str;
        if (!str || (!/\S/.test(str) && !(item.width > 0))) continue;
        const transform = item.transform || [1, 0, 0, 1, 0, 0];
        const x = transform[4];
        const y = transform[5];
        // Non-rotated text: fontSize ≈ |d|; hypot keeps sheared/scaled text sane.
        const fontSize = Math.hypot(transform[2], transform[3]) || Math.abs(transform[3]) || item.height || 10;
        const width = item.width || 0;
        const { top, bottom, fontFamily } = fontMetrics(styles, item.fontName, fontSize);
        runs.push({
          page: pageNum,
          str,
          x,
          y,
          width,
          height: item.height || fontSize,
          fontSize,
          fontName: item.fontName || '',
          fontFamily,
          // Absolute glyph-box edges in PDF space (bottom-left origin).
          top: y + top,
          bottom: y - bottom,
          right: x + width,
        });
      }
    }
    return { pageCount, pages, runs };
  } finally {
    await pdf.cleanup().catch(() => {});
    await pdf.destroy().catch(() => {});
  }
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function modeString(values) {
  const counts = new Map();
  let best = '';
  let bestCount = 0;
  for (const value of values) {
    const next = (counts.get(value) || 0) + 1;
    counts.set(value, next);
    if (next > bestCount) {
      bestCount = next;
      best = value;
    }
  }
  return best;
}

// Join runs of one visual line, inserting a space where pdfjs split words at a
// horizontal gap without emitting the space glyph.
function joinLineRuns(lineRuns) {
  let text = '';
  for (let i = 0; i < lineRuns.length; i += 1) {
    const run = lineRuns[i];
    if (i > 0) {
      const prev = lineRuns[i - 1];
      const gap = run.x - prev.right;
      const needsSpace = gap > 0.25 * Math.max(prev.fontSize, run.fontSize)
        && !/\s$/.test(text) && !/^\s/.test(run.str);
      if (needsSpace) text += ' ';
    }
    text += run.str;
  }
  return text;
}

// Cluster runs on a page into visual lines by baseline proximity.
function clusterLines(pageRuns) {
  const sorted = [...pageRuns].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  let current = null;
  for (const run of sorted) {
    const tol = 0.45 * run.fontSize;
    if (current && Math.abs(run.y - current.y) <= tol) {
      current.runs.push(run);
    } else {
      current = { runs: [run], y: run.y };
      lines.push(current);
    }
  }
  return lines.map((line) => {
    const lineRuns = [...line.runs].sort((a, b) => a.x - b.x);
    const fontSize = median(lineRuns.map((r) => r.fontSize));
    return {
      runs: lineRuns,
      y: median(lineRuns.map((r) => r.y)),
      fontSize,
      xStart: Math.min(...lineRuns.map((r) => r.x)),
      xEnd: Math.max(...lineRuns.map((r) => r.right)),
      top: Math.max(...lineRuns.map((r) => r.top)),
      bottom: Math.min(...lineRuns.map((r) => r.bottom)),
      text: joinLineRuns(lineRuns),
    };
  });
}

function pageWidthFor(pageNum, pages, pageRuns) {
  const meta = Array.isArray(pages) ? pages.find((p) => p.number === pageNum) : null;
  if (meta && meta.width > 0) return meta.width;
  return Math.max(...pageRuns.map((r) => r.right), 1);
}

// Detect a two-column split from a vertical gutter in the run coverage. Runs
// on the same row of a two-column layout share a baseline, so columns MUST be
// separated before lines are clustered — otherwise a left- and a right-column
// row would merge into one bogus full-width line. The gutter is the widest
// horizontal band with no run coverage and content on both sides.
//
// Conservative by design: no clear gutter (any line spans the center, or one
// side is nearly empty) collapses to single-column ordering — a wrong reading
// order is worse than an honest single-column pass (see the change's RULES).
function detectColumns(pageRuns, pageWidth) {
  if (pageRuns.length < 6 || pageWidth <= 0) return { count: 1, splitX: Infinity };
  const intervals = pageRuns.map((r) => [r.x, r.right]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  let bestGap = 0;
  let splitX = Infinity;
  for (let i = 0; i < merged.length - 1; i += 1) {
    const gap = merged[i + 1][0] - merged[i][1];
    if (gap > bestGap) {
      bestGap = gap;
      splitX = (merged[i][1] + merged[i + 1][0]) / 2;
    }
  }
  if (bestGap < 0.05 * pageWidth) return { count: 1, splitX: Infinity };

  const columnOf = (run) => ((run.x + run.right) / 2 < splitX ? 0 : 1);
  const left = pageRuns.filter((run) => columnOf(run) === 0);
  const right = pageRuns.filter((run) => columnOf(run) === 1);
  if (left.length < 3 || right.length < 3) return { count: 1, splitX: Infinity };

  return { count: 2, splitX, columnOf };
}

// Merge ordered lines into paragraphs. A new paragraph starts on a column
// change, a vertical gap larger than the leading, a significant font-size
// change, or a left-edge jump (indent / unrelated block).
function groupParagraphs(orderedLines) {
  const paragraphs = [];
  let current = null;
  for (const line of orderedLines) {
    if (!current) {
      current = { lines: [line], column: line.column, fontSize: line.fontSize, xStart: line.xStart };
      paragraphs.push(current);
      continue;
    }
    const prev = current.lines[current.lines.length - 1];
    const baselineGap = prev.y - line.y;
    const leading = 1.6 * Math.max(current.fontSize, line.fontSize);
    const sameColumn = line.column === current.column;
    const fontChange = Math.abs(line.fontSize - current.fontSize) > 0.25 * current.fontSize;
    const xJump = Math.abs(line.xStart - current.xStart) > 2.5 * current.fontSize;
    const contiguous = baselineGap > 0 && baselineGap <= leading;

    if (sameColumn && contiguous && !fontChange && !xJump) {
      current.lines.push(line);
    } else {
      current = { lines: [line], column: line.column, fontSize: line.fontSize, xStart: line.xStart };
      paragraphs.push(current);
    }
  }
  return paragraphs;
}

function buildSegment(paragraph, pageNum, order) {
  const lines = paragraph.lines.map((line) => ({
    text: line.text,
    y: line.y,
    fontSize: line.fontSize,
    runs: line.runs,
    bbox: {
      x0: line.xStart,
      y0: line.bottom,
      x1: line.xEnd,
      y1: line.top,
    },
  }));
  const runs = lines.flatMap((line) => line.runs);
  const bbox = {
    x0: Math.min(...runs.map((r) => r.x)),
    y0: Math.min(...runs.map((r) => r.bottom)),
    x1: Math.max(...runs.map((r) => r.right)),
    y1: Math.max(...runs.map((r) => r.top)),
  };
  return {
    page: pageNum,
    order,
    column: paragraph.column,
    text: lines.map((line) => line.text).join(' '),
    bbox,
    fontSize: median(runs.map((r) => r.fontSize)),
    fontName: modeString(runs.map((r) => r.fontName)),
    fontFamily: modeString(runs.map((r) => r.fontFamily)),
    runs,
    lines,
  };
}

/**
 * Group extracted runs into translatable segments (paragraphs), preserving the
 * run→segment map (each segment keeps its `runs`) and reading order (segments
 * are emitted per page, columns left-to-right, lines top-to-bottom). Accepts
 * the runs array; pass `pages` (from extractRuns) for accurate column detection.
 */
export function segmentRuns(runs, pages = null) {
  const byPage = new Map();
  for (const run of runs) {
    if (!byPage.has(run.page)) byPage.set(run.page, []);
    byPage.get(run.page).push(run);
  }
  const segments = [];
  let order = 0;
  for (const pageNum of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageRuns = byPage.get(pageNum);
    const pageWidth = pageWidthFor(pageNum, pages, pageRuns);
    const columns = detectColumns(pageRuns, pageWidth);

    // Cluster lines WITHIN each column so same-row runs from different columns
    // never merge, then emit columns left-to-right, lines top-to-bottom.
    const columnRuns = columns.count === 2
      ? [pageRuns.filter((r) => columns.columnOf(r) === 0), pageRuns.filter((r) => columns.columnOf(r) === 1)]
      : [pageRuns];

    columnRuns.forEach((runsInColumn, columnIndex) => {
      const lines = clusterLines(runsInColumn)
        .sort((a, b) => b.y - a.y)
        .map((line) => ({ ...line, column: columnIndex }));
      for (const paragraph of groupParagraphs(lines)) {
        segments.push(buildSegment(paragraph, pageNum, order));
        order += 1;
      }
    });
  }
  return segments;
}

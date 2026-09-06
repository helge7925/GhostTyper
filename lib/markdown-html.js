/**
 * Markdown and analysis rendering, split out of lib/export-utils.js.
 *
 * These two functions are needed by pages that only display text (translate,
 * text optimisation, OCR, the transcription editor). They used to live beside
 * exportToDoc, which pulls in `docx` — a library with no `sideEffects: false`
 * flag, so bundlers could not tree-shake it back out. Every one of those pages
 * shipped the whole DOCX writer without ever calling it.
 *
 * NOTE: mdToHtml depends on DOMPurify, which needs a DOM. It works in the
 * browser and throws under Node — see the server-side call in
 * pages/api/translate/file.js, which is a known open issue.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { hasMeaningfulContent, sanitizeStructuredValue } from './analysis-cleaner.js';

/**
 * Professional Markdown to HTML converter using 'marked'.
 *
 * The output is rendered via `dangerouslySetInnerHTML` (e.g. in
 * pages/translate.js for AI-translated text), so the HTML must be
 * sanitised. `marked` no longer ships its own sanitiser since v5,
 * and translated text comes from a model that is — by definition —
 * untrusted: a prompt-injection in the source text can persuade
 * the model to return executable HTML.
 */
export function mdToHtml(md) {
  if (!md) return '';
  const rawHtml = marked.parse(md, { breaks: true, gfm: true });
  return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
}

/**
 * Markdown to HTML for the server-side PDF pipeline. Does NOT sanitise.
 *
 * mdToHtml above cannot run here: DOMPurify needs a DOM and throws under Node,
 * which is why the scanned-PDF translation path had been failing outright. The
 * fix is not to sanitise in a second place but to name the one sink where
 * unsanitised markup is acceptable, because that sink already handles it twice
 * over — renderPdfBufferFromHtml runs the markup through sanitizePrintHtml
 * (scripts, iframes, event handlers, javascript: URLs) and then renders it in
 * Chromium under a `default-src 'none'; script-src 'none'` CSP with no network
 * access, so nothing in it can execute or phone home.
 *
 * The separate name is the point: the ONLY permitted destination for this
 * output is renderPdfBufferFromHtml. Anything that reaches a browser, an email
 * or an API response must use mdToHtml instead. A silent
 * "skip sanitising when there is no DOM" inside mdToHtml would have made the
 * unsafe path the invisible default.
 */
export function mdToPrintHtml(md) {
  if (!md) return '';
  return marked.parse(md, { breaks: true, gfm: true });
}

function toDisplayLabel(rawKey) {
  if (!rawKey) return '';

  const normalized = String(rawKey).toLowerCase();
  const explicitLabels = {
    prioritaet: 'Priorität',
    offene_punkte: 'Offene Punkte',
    naechste_schritte: 'Nächste Schritte',
    raeume: 'Räume',
    masse: 'Maße',
    hoehe: 'Höhe',
    gesamtflaechen: 'Gesamtflächen',
  };

  if (explicitLabels[normalized]) {
    return explicitLabels[normalized];
  }

  const withSpaces = String(rawKey).replace(/_/g, ' ').trim();
  if (!withSpaces) return '';

  return withSpaces
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function hasRenderableContent(value) {
  return hasMeaningfulContent(value);
}

/**
 * Recursively converts objects/arrays to clean HTML strings.
 */
function renderValue(value) {
  const cleanedValue = sanitizeStructuredValue(value);
  if (!hasRenderableContent(cleanedValue)) return '';

  if (Array.isArray(cleanedValue)) {
    const items = cleanedValue
      .map((entry) => {
        if (!hasRenderableContent(entry)) return '';
        if (typeof entry === 'object') {
          const nested = renderValue(entry);
          return nested ? `<li>${nested}</li>` : '';
        }
        return `<li>${entry}</li>`;
      })
      .filter(Boolean)
      .join('');

    return items ? `<ul>${items}</ul>` : '';
  }
  if (typeof cleanedValue === 'object') {
    const items = Object.entries(cleanedValue)
      .map(([k, v]) => {
        if (!hasRenderableContent(v)) return '';
        const label = toDisplayLabel(k);

        if (typeof v === 'object') {
          const nested = renderValue(v);
          if (!nested) return '';
          return `<li><strong>${label}:</strong>${nested}</li>`;
        }

        return `<li><strong>${label}:</strong> ${v}</li>`;
      })
      .filter(Boolean)
      .join('');

    return items ? `<ul>${items}</ul>` : '';
  }
  return cleanedValue;
}

/**
 * Converts structured analysis to clean HTML for the editor.
 */
export function analysisToHtml(transcription) {
  if (!transcription) return '';
  const { original_name, analysis, text } = transcription;
  const normalizedAnalysis = analysis && typeof analysis === 'object'
    ? sanitizeStructuredValue(analysis)
    : analysis;
  
  let html = `<div class="content-wrapper">`;
  
  let displayTitle = original_name?.replace(/\.[^/.]+$/, "")?.replace(/_/g, ' ') || 'Dokument';
  if (normalizedAnalysis && typeof normalizedAnalysis === 'object') {
    displayTitle = normalizedAnalysis.projekt || normalizedAnalysis.project || normalizedAnalysis.titel || normalizedAnalysis.title || displayTitle;
  }
  
  html += `<h1 class="main-title">${displayTitle}</h1>`;
  
  if (normalizedAnalysis && typeof normalizedAnalysis === 'object') {
    if (hasRenderableContent(normalizedAnalysis.zusammenfassung) || hasRenderableContent(normalizedAnalysis.summary)) {
      html += `<h2>Zusammenfassung</h2><p>${normalizedAnalysis.zusammenfassung || normalizedAnalysis.summary}</p>`;
    }
    
    const core = normalizedAnalysis.kernpunkte || normalizedAnalysis.key_points || normalizedAnalysis.themen || normalizedAnalysis.topics;
    if (Array.isArray(core) && core.length > 0) {
      html += `<h2>Wichtigste Punkte</h2><ul>${core.map(item => `<li>${item}</li>`).join('')}</ul>`;
    }

    const recs = normalizedAnalysis.handlungsempfehlungen || normalizedAnalysis.recommendations;
    if (Array.isArray(recs) && recs.length > 0) {
      html += `<h2>Handlungsempfehlungen</h2><ul>${recs.map(item => `<li>${item}</li>`).join('')}</ul>`;
    }

    const handled = [
      'zusammenfassung', 'summary',
      'kernpunkte', 'key_points', 'themen', 'topics',
      'raw',
      'projekt', 'project', 'titel', 'title',
      'handlungsempfehlungen', 'recommendations',
      // Metadata fields used by the generic prompt: render the *content*
      // (stichpunkte, themen, action_items, …) but suppress the classifier itself.
      'format', 'inhaltstyp', 'content_type', 'klassifikation', 'classification',
    ];
    Object.entries(normalizedAnalysis).forEach(([key, value]) => {
      if (handled.includes(key.toLowerCase()) || !hasRenderableContent(value)) return;
      const renderedValue = renderValue(value);
      if (!renderedValue) return;
      html += `<h2>${toDisplayLabel(key)}</h2>`;
      html += `<div>${renderedValue}</div>`;
    });
  } else if (typeof normalizedAnalysis === 'string') {
    html += mdToHtml(normalizedAnalysis);
  }

  if (text && !normalizedAnalysis) {
    html += mdToHtml(text);
  }
  
  html += `</div>`;
  return html;
}

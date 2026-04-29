import JSZip from 'jszip';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const OFFICE_CONFIG = {
  [DOCX_MIME]: {
    family: 'docx',
    textNode: /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g,
    includeFile: (name) => /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(name),
  },
  [XLSX_MIME]: {
    family: 'xlsx',
    textNode: /<t\b([^>]*)>([\s\S]*?)<\/t>/g,
    includeFile: (name) => name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  },
  [PPTX_MIME]: {
    family: 'pptx',
    textNode: /<a:t\b([^>]*)>([\s\S]*?)<\/a:t>/g,
    includeFile: (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name),
  },
};

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function encodeXmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function splitEdgeWhitespace(value) {
  const text = String(value ?? '');
  const leading = text.match(/^\s*/)?.[0] || '';
  const trailing = text.match(/\s*$/)?.[0] || '';
  const core = text.slice(leading.length, text.length - trailing.length);
  return { leading, core, trailing };
}

function collectXmlTextEntries(xml, config) {
  const entries = [];
  const regex = new RegExp(config.textNode.source, config.textNode.flags);
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const decoded = decodeXmlText(match[2]);
    const parts = splitEdgeWhitespace(decoded);
    if (!parts.core.trim()) continue;
    entries.push({
      text: parts.core,
      leading: parts.leading,
      trailing: parts.trailing,
    });
  }
  return entries;
}

function applyXmlTranslations(xml, config, translations, startIndex = 0) {
  let index = startIndex;
  const regex = new RegExp(config.textNode.source, config.textNode.flags);
  const xmlWithTranslations = xml.replace(regex, (match, attrs, content) => {
    const decoded = decodeXmlText(content);
    const parts = splitEdgeWhitespace(decoded);
    if (!parts.core.trim()) return match;

    const translated = translations[index] ?? parts.core;
    index += 1;
    return match.replace(content, encodeXmlText(`${parts.leading}${translated}${parts.trailing}`));
  });

  return { xml: xmlWithTranslations, nextIndex: index };
}

async function loadOfficeZip(buffer) {
  return JSZip.loadAsync(buffer);
}

async function collectOfficeEntries(zip, mimeType) {
  const config = OFFICE_CONFIG[mimeType];
  if (!config) {
    throw new Error('UNSUPPORTED_OFFICE_TYPE');
  }

  const files = [];
  const segments = [];

  const names = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir && config.includeFile(name))
    .sort((a, b) => a.localeCompare(b));

  for (const name of names) {
    const xml = await zip.file(name).async('string');
    const entries = collectXmlTextEntries(xml, config);
    if (entries.length === 0) continue;
    files.push({ name, xml, entries });
    segments.push(...entries.map((entry) => entry.text));
  }

  return { config, files, segments };
}

export async function inspectOfficeDocumentBuffer(buffer, mimeType) {
  const zip = await loadOfficeZip(buffer);
  const { segments, config } = await collectOfficeEntries(zip, mimeType);
  return {
    family: config.family,
    segmentCount: segments.length,
    characterCount: segments.reduce((total, segment) => total + segment.length, 0),
    text: segments.join('\n'),
  };
}

function buildBatches(segments, maxSegmentsPerBatch, maxCharsPerBatch) {
  const batches = [];
  let current = [];
  let currentChars = 0;

  segments.forEach((segment) => {
    const segmentChars = segment.length;
    const wouldOverflow = current.length > 0
      && (current.length >= maxSegmentsPerBatch || currentChars + segmentChars > maxCharsPerBatch);

    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(segment);
    currentChars += segmentChars;
  });

  if (current.length > 0) batches.push(current);
  return batches;
}

export async function translateOfficeDocumentBuffer(buffer, mimeType, {
  translator,
  maxSegmentsPerBatch = 30,
  maxCharsPerBatch = 10_000,
} = {}) {
  if (typeof translator !== 'function') {
    throw new Error('OFFICE_TRANSLATOR_REQUIRED');
  }

  const zip = await loadOfficeZip(buffer);
  const { config, files, segments } = await collectOfficeEntries(zip, mimeType);
  if (segments.length === 0) {
    return {
      buffer,
      stats: {
        family: config.family,
        segmentCount: 0,
        characterCount: 0,
        warningCount: 0,
      },
    };
  }

  const translations = [];
  const batches = buildBatches(segments, maxSegmentsPerBatch, maxCharsPerBatch);
  for (const batch of batches) {
    const translatedBatch = await translator(batch);
    if (!Array.isArray(translatedBatch) || translatedBatch.length !== batch.length) {
      throw new Error('OFFICE_TRANSLATION_BATCH_SHAPE_MISMATCH');
    }
    translations.push(...translatedBatch.map((entry) => String(entry ?? '')));
  }

  let translationIndex = 0;
  for (const file of files) {
    const next = applyXmlTranslations(file.xml, config, translations, translationIndex);
    translationIndex = next.nextIndex;
    zip.file(file.name, next.xml);
  }

  const output = await zip.generateAsync({ type: 'nodebuffer' });
  const warningCount = translations.reduce((count, translated, index) => {
    const sourceLength = Math.max(1, segments[index]?.length || 1);
    return translated.length > sourceLength * 1.8 ? count + 1 : count;
  }, 0);

  return {
    buffer: output,
    stats: {
      family: config.family,
      segmentCount: segments.length,
      characterCount: segments.reduce((total, segment) => total + segment.length, 0),
      warningCount,
    },
  };
}

export const OFFICE_TRANSLATION_MIME_TYPES = {
  DOCX_MIME,
  XLSX_MIME,
  PPTX_MIME,
};

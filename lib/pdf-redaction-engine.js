import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from 'pdf-lib';

const TEXT_SHOW_OPERATORS = new Set(['Tj', 'TJ', "'", '"']);
const MARKED_CONTENT_TEXT_KEYS = new Set(['ActualText', 'Alt', 'E']);
const ANNOTATION_TEXT_KEYS = new Set(['Contents', 'RC', 'V', 'DV', 'TU', 'T', 'Subj']);
const WHITE_SPACE = /[\x00\x09\x0a\x0c\x0d\x20]/;
const DELIMITER = /[()[\]<>\/{%}]/;

export class PdfRedactionError extends Error {
  constructor(message, reason = 'unsafe-redaction') {
    super(message);
    this.name = 'PdfRedactionError';
    this.code = 'PDF_REDACTION_UNSAFE';
    this.reason = reason;
  }
}

function isWhiteSpace(char) {
  return char !== undefined && WHITE_SPACE.test(char);
}

function isDelimiter(char) {
  return char !== undefined && DELIMITER.test(char);
}

function decodePdfName(value) {
  return String(value || '')
    .replace(/^\//, '')
    .replace(/#([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function operationContainsName(operation, expectedName) {
  const names = String(operation || '').match(/\/[^\s()[\]<>\/{%}]+/g) || [];
  return names.some((name) => decodePdfName(name) === expectedName);
}

function sourceBearingOperationName(operation) {
  for (const name of MARKED_CONTENT_TEXT_KEYS) {
    if (operationContainsName(operation, name)) return name;
  }
  return null;
}

function readLiteralString(source, start) {
  let depth = 1;
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      continue;
    }
    if (char === '\\') {
      escaped = true;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new PdfRedactionError('Unterminated PDF literal string', 'malformed-content-stream');
}

function nextToken(source, start) {
  let index = start;
  while (index < source.length) {
    if (isWhiteSpace(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '%') {
      while (index < source.length && source[index] !== '\r' && source[index] !== '\n') index += 1;
      continue;
    }
    break;
  }
  if (index >= source.length) return null;

  const tokenStart = index;
  const char = source[index];
  if (char === '(') {
    const end = readLiteralString(source, index);
    return { start: tokenStart, end, value: source.slice(tokenStart, end), type: 'object' };
  }
  if (char === '<') {
    if (source[index + 1] === '<') return { start: tokenStart, end: index + 2, value: '<<', type: 'open-dict' };
    index += 1;
    while (index < source.length && source[index] !== '>') index += 1;
    if (index >= source.length) throw new PdfRedactionError('Unterminated PDF hex string', 'malformed-content-stream');
    return { start: tokenStart, end: index + 1, value: source.slice(tokenStart, index + 1), type: 'object' };
  }
  if (char === '>' && source[index + 1] === '>') return { start: tokenStart, end: index + 2, value: '>>', type: 'close-dict' };
  if (char === '[') return { start: tokenStart, end: index + 1, value: '[', type: 'open-array' };
  if (char === ']') return { start: tokenStart, end: index + 1, value: ']', type: 'close-array' };
  if (char === "'" || char === '"') return { start: tokenStart, end: index + 1, value: char, type: 'word' };
  if (char === '/') {
    index += 1;
    while (index < source.length && !isWhiteSpace(source[index]) && !isDelimiter(source[index])) index += 1;
    return { start: tokenStart, end: index, value: source.slice(tokenStart, index), type: 'object' };
  }
  if (isDelimiter(char)) {
    throw new PdfRedactionError(`Unexpected PDF content delimiter ${char}`, 'malformed-content-stream');
  }

  index += 1;
  while (index < source.length && !isWhiteSpace(source[index]) && !isDelimiter(source[index])) index += 1;
  const value = source.slice(tokenStart, index);
  const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value);
  return { start: tokenStart, end: index, value, type: numeric ? 'object' : 'word' };
}

/**
 * Remove text-show operations and their operands while preserving every other
 * byte-level content operation. Unsupported PDF grammar fails closed.
 */
export function stripTextShowingOperators(bytes) {
  const source = Buffer.from(bytes).toString('latin1');
  const output = [];
  let cursor = 0;
  let operationStart = 0;
  let arrayDepth = 0;
  let dictDepth = 0;
  let textDepth = 0;
  let removed = 0;
  let renderingMode = 0;

  while (true) {
    const token = nextToken(source, cursor);
    if (!token) break;
    cursor = token.end;
    if (token.type === 'open-array') arrayDepth += 1;
    if (token.type === 'close-array') arrayDepth -= 1;
    if (token.type === 'open-dict') dictDepth += 1;
    if (token.type === 'close-dict') dictDepth -= 1;
    if (arrayDepth < 0 || dictDepth < 0) {
      throw new PdfRedactionError('Unbalanced PDF content object', 'malformed-content-stream');
    }
    if (token.type !== 'word' || arrayDepth > 0 || dictDepth > 0) continue;

    const operation = source.slice(operationStart, token.end);
    if (token.value === 'BI') {
      throw new PdfRedactionError('Inline images make content boundaries ambiguous', 'inline-image-unsupported');
    }
    const sourceBearingName = token.value === 'BDC' || token.value === 'DP'
      ? sourceBearingOperationName(operation)
      : null;
    if (sourceBearingName) {
      throw new PdfRedactionError(
        `Marked content contains source-bearing ${sourceBearingName} metadata`,
        'source-bearing-marked-content-unsupported',
      );
    }
    if (token.value === 'BT') textDepth += 1;
    if (token.value === 'ET') textDepth -= 1;
    if (textDepth < 0 || textDepth > 1) {
      throw new PdfRedactionError('Unbalanced PDF text object', 'malformed-text-object');
    }
    if (token.value === 'Tr') {
      const match = operation.match(/([+-]?(?:\d+\.?\d*|\.\d+))\s+Tr\s*$/);
      if (!match) throw new PdfRedactionError('Unreadable text rendering mode', 'malformed-text-state');
      renderingMode = Number(match[1]);
      if (renderingMode >= 4) {
        throw new PdfRedactionError('Text clipping paths cannot be removed without changing vector output', 'text-clipping-unsupported');
      }
    }

    if (TEXT_SHOW_OPERATORS.has(token.value)) {
      if (textDepth !== 1) throw new PdfRedactionError('Text-show operator outside a text object', 'malformed-text-object');
      if (renderingMode >= 4) throw new PdfRedactionError('Text clipping path is active', 'text-clipping-unsupported');
      output.push(source.slice(operationStart, token.start).replace(/\S[\s\S]*$/, ''));
      removed += 1;
    } else {
      output.push(operation);
    }
    operationStart = token.end;
  }

  if (arrayDepth !== 0 || dictDepth !== 0 || textDepth !== 0) {
    throw new PdfRedactionError('Unbalanced PDF content stream', 'malformed-content-stream');
  }
  output.push(source.slice(operationStart));
  return { bytes: Buffer.from(output.join(''), 'latin1'), removed };
}

function getStreamRefs(page) {
  const contents = page.node.get(PDFName.of('Contents'));
  if (!contents) return [];
  if (contents instanceof PDFRef) return [contents];
  if (contents instanceof PDFArray) {
    const refs = [];
    for (let index = 0; index < contents.size(); index += 1) {
      const value = contents.get(index);
      if (!(value instanceof PDFRef)) {
        throw new PdfRedactionError('Direct page content streams are not safely replaceable', 'direct-content-stream-unsupported');
      }
      refs.push(value);
    }
    return refs;
  }
  throw new PdfRedactionError('Direct page content streams are not safely replaceable', 'direct-content-stream-unsupported');
}

function rectangleFromArray(array) {
  if (!(array instanceof PDFArray) || array.size() !== 4) return null;
  const values = [];
  for (let index = 0; index < 4; index += 1) {
    const number = array.lookup(index);
    if (!(number instanceof PDFNumber)) return null;
    values.push(number.asNumber());
  }
  return {
    x0: Math.min(values[0], values[2]),
    y0: Math.min(values[1], values[3]),
    x1: Math.max(values[0], values[2]),
    y1: Math.max(values[1], values[3]),
  };
}

function intersects(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function removeOverlappingLinks(pdfDoc, page, segments) {
  const annots = page.node.Annots();
  if (!annots) return 0;
  let removed = 0;
  for (let index = annots.size() - 1; index >= 0; index -= 1) {
    const value = annots.get(index);
    const annot = pdfDoc.context.lookup(value);
    if (!(annot instanceof PDFDict)) continue;
    const subtype = annot.get(PDFName.of('Subtype'));
    if (!(subtype instanceof PDFName) || subtype.asString() !== '/Link') continue;
    const rect = rectangleFromArray(annot.lookup(PDFName.of('Rect')));
    if (!rect || !segments.some((segment) => intersects(rect, segment.bbox))) continue;
    annots.remove(index);
    if (value instanceof PDFRef) pdfDoc.context.delete(value);
    removed += 1;
  }
  return removed;
}

function isFormXObject(stream) {
  const subtype = stream.dict.get(PDFName.of('Subtype'));
  return subtype instanceof PDFName && subtype.asString() === '/Form';
}

function resolveObject(value, context) {
  return value instanceof PDFRef ? context.lookup(value) : value;
}

function decodedDictEntry(dict, expectedName) {
  if (!(dict instanceof PDFDict)) return null;
  for (const [key, value] of dict.entries()) {
    if (decodePdfName(key.asString()) === expectedName) return value;
  }
  return null;
}

function containsNamedMetadata(value, context, names, seenRefs = new Set(), seenObjects = new WeakSet()) {
  if (value instanceof PDFRef) {
    const key = value.toString();
    if (seenRefs.has(key)) return false;
    seenRefs.add(key);
    return containsNamedMetadata(context.lookup(value), context, names, seenRefs, seenObjects);
  }
  if (value instanceof PDFRawStream) {
    return containsNamedMetadata(value.dict, context, names, seenRefs, seenObjects);
  }
  if (value instanceof PDFArray) {
    if (seenObjects.has(value)) return false;
    seenObjects.add(value);
    for (let index = 0; index < value.size(); index += 1) {
      if (containsNamedMetadata(value.get(index), context, names, seenRefs, seenObjects)) return true;
    }
    return false;
  }
  if (value instanceof PDFDict) {
    if (seenObjects.has(value)) return false;
    seenObjects.add(value);
    for (const [key, entry] of value.entries()) {
      if (names.has(decodePdfName(key.asString()))) return true;
      if (containsNamedMetadata(entry, context, names, seenRefs, seenObjects)) return true;
    }
  }
  return false;
}

function containsMarkedContentPropertyMetadata(
  value,
  context,
  seenRefs = new Set(),
  seenObjects = new WeakSet(),
) {
  if (value instanceof PDFRef) {
    const key = value.toString();
    if (seenRefs.has(key)) return false;
    seenRefs.add(key);
    return containsMarkedContentPropertyMetadata(context.lookup(value), context, seenRefs, seenObjects);
  }
  if (value instanceof PDFRawStream) {
    return containsMarkedContentPropertyMetadata(value.dict, context, seenRefs, seenObjects);
  }
  if (value instanceof PDFArray) {
    if (seenObjects.has(value)) return false;
    seenObjects.add(value);
    for (let index = 0; index < value.size(); index += 1) {
      if (containsMarkedContentPropertyMetadata(value.get(index), context, seenRefs, seenObjects)) return true;
    }
    return false;
  }
  if (value instanceof PDFDict) {
    if (seenObjects.has(value)) return false;
    seenObjects.add(value);
    for (const [key, entry] of value.entries()) {
      if (
        decodePdfName(key.asString()) === 'Properties'
        && containsNamedMetadata(entry, context, MARKED_CONTENT_TEXT_KEYS)
      ) {
        return true;
      }
      if (containsMarkedContentPropertyMetadata(entry, context, seenRefs, seenObjects)) return true;
    }
  }
  return false;
}

function assertNoSourceBearingMetadata(pdfDoc, objects, pages) {
  if (decodedDictEntry(pdfDoc.catalog, 'AcroForm')) {
    throw new PdfRedactionError('PDF AcroForm data cannot be safely redacted', 'source-bearing-form-metadata-unsupported');
  }

  for (const page of pages) {
    const annots = resolveObject(decodedDictEntry(page.node, 'Annots'), pdfDoc.context);
    if (!(annots instanceof PDFArray)) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      const annotation = resolveObject(annots.get(index), pdfDoc.context);
      if (!(annotation instanceof PDFDict)) continue;
      for (const key of ANNOTATION_TEXT_KEYS) {
        if (decodedDictEntry(annotation, key)) {
          throw new PdfRedactionError(
            `PDF annotation contains source-bearing ${key} metadata`,
            'source-bearing-annotation-metadata-unsupported',
          );
        }
      }
    }
  }

  const actualTextOnly = new Set(['ActualText']);
  const metadataSeenRefs = new Set();
  const metadataSeenObjects = new WeakSet();
  for (const [, object] of objects) {
    if (containsNamedMetadata(
      object,
      pdfDoc.context,
      actualTextOnly,
      metadataSeenRefs,
      metadataSeenObjects,
    )) {
      throw new PdfRedactionError(
        'PDF contains source-bearing ActualText metadata',
        'source-bearing-marked-content-unsupported',
      );
    }
  }

  const structTree = decodedDictEntry(pdfDoc.catalog, 'StructTreeRoot');
  if (structTree && containsNamedMetadata(structTree, pdfDoc.context, MARKED_CONTENT_TEXT_KEYS)) {
    throw new PdfRedactionError(
      'PDF structure tree contains source-bearing accessibility metadata',
      'source-bearing-marked-content-unsupported',
    );
  }

  const propertySeenRefs = new Set();
  const propertySeenObjects = new WeakSet();
  for (const [, object] of objects) {
    if (containsMarkedContentPropertyMetadata(
      object,
      pdfDoc.context,
      propertySeenRefs,
      propertySeenObjects,
    )) {
      throw new PdfRedactionError(
        'PDF marked-content properties contain source-bearing accessibility metadata',
        'source-bearing-marked-content-unsupported',
      );
    }
  }
}

function isTilingPatternStream(stream, context) {
  const patternType = resolveObject(decodedDictEntry(stream.dict, 'PatternType'), context);
  return patternType instanceof PDFNumber && patternType.asNumber() === 1;
}

function collectType3CharProcRefs(objects, context) {
  const refs = new Set();
  for (const [, object] of objects) {
    if (!(object instanceof PDFDict)) continue;
    const subtype = resolveObject(decodedDictEntry(object, 'Subtype'), context);
    if (!(subtype instanceof PDFName) || decodePdfName(subtype.asString()) !== 'Type3') continue;
    const charProcs = resolveObject(decodedDictEntry(object, 'CharProcs'), context);
    if (!(charProcs instanceof PDFDict)) continue;
    for (const [, value] of charProcs.entries()) {
      if (value instanceof PDFRef) refs.add(value.toString());
      else {
        throw new PdfRedactionError(
          'Direct Type3 CharProc streams are unsupported',
          'content-stream-type-unsupported',
        );
      }
    }
  }
  return refs;
}

function replacementStream(pdfDoc, object, bytes) {
  const replacement = pdfDoc.context.flateStream(bytes);
  for (const [key, value] of object.dict.entries()) {
    const name = key.asString();
    if (name !== '/Filter' && name !== '/DecodeParms' && name !== '/Length') {
      replacement.dict.set(key, value);
    }
  }
  return replacement;
}

/**
 * Permissively licensed redaction engine based on pdf-lib (MIT). It removes
 * all source text-show operators from translated pages and all Form
 * XObjects. It never paints cover rectangles.
 */
export async function redactPdfSourceText(buffer, segments) {
  const pdfDoc = await PDFDocument.load(new Uint8Array(buffer));
  const byPage = new Map();
  for (const segment of segments) {
    if (!byPage.has(segment.page)) byPage.set(segment.page, []);
    byPage.get(segment.page).push(segment);
  }

  const objects = pdfDoc.context.enumerateIndirectObjects();
  const refsByKey = new Map(objects.map(([ref]) => [ref.toString(), ref]));
  const pageStreamUsage = new Map();
  let removedLinks = 0;
  const pages = pdfDoc.getPages();
  assertNoSourceBearingMetadata(pdfDoc, objects, pages);
  const type3CharProcRefs = collectType3CharProcRefs(objects, pdfDoc.context);
  const unsegmentedPages = new Set();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const pageNumber = pageIndex + 1;
    const page = pages[pageIndex];
    const pageSegments = byPage.get(pageNumber) || [];
    if (pageSegments.length === 0) unsegmentedPages.add(pageNumber);
    for (const ref of getStreamRefs(page)) {
      const key = ref.toString();
      const usage = pageStreamUsage.get(key) || { ref, translatedPages: new Set(), unsegmentedPages: new Set() };
      if (pageSegments.length > 0) usage.translatedPages.add(pageNumber);
      else usage.unsegmentedPages.add(pageNumber);
      pageStreamUsage.set(key, usage);
    }
    if (pageSegments.length > 0) removedLinks += removeOverlappingLinks(pdfDoc, page, pageSegments);
  }

  for (const pageNumber of byPage.keys()) {
    if (!pages[pageNumber - 1]) {
      throw new PdfRedactionError(`Missing PDF page ${pageNumber}`, 'invalid-page-geometry');
    }
  }

  // Forms are shared resources and can contain text extracted as page runs.
  // Sanitizing every Form is safe because this path translates all extracted
  // document text; non-text image/vector operations remain byte-for-byte.
  let removedTextOperators = 0;
  let sanitizedStreams = 0;
  let pageStreamsInspected = 0;
  const replacements = new Map();
  for (const [ref, object] of objects) {
    const key = ref.toString();
    const pageUsage = pageStreamUsage.get(key);
    const form = object instanceof PDFRawStream && isFormXObject(object);
    const contentResource = object instanceof PDFRawStream
      && (isTilingPatternStream(object, pdfDoc.context) || type3CharProcRefs.has(key));
    if (!pageUsage && !form && !contentResource) continue;
    if (!(object instanceof PDFRawStream)) {
      throw new PdfRedactionError('Unsupported PDF content stream type', 'content-stream-type-unsupported');
    }
    let decoded;
    try {
      decoded = decodePDFRawStream(object).decode();
    } catch (error) {
      throw new PdfRedactionError(`Cannot decode PDF content stream: ${error.message}`, 'content-stream-decode-failed');
    }
    const stripped = stripTextShowingOperators(decoded);
    if (contentResource && stripped.removed > 0) {
      throw new PdfRedactionError(
        'Text-show operators in a content resource cannot be mapped to extracted segments',
        'source-text-resource-stream-unsupported',
      );
    }
    if (form && stripped.removed > 0 && unsegmentedPages.size > 0) {
      throw new PdfRedactionError(
        `Text-bearing Form XObjects cannot be safely mapped while page(s) lack extracted segments: ${[...unsegmentedPages].join(', ')}`,
        'unsegmented-page-text',
      );
    }
    if (pageUsage) {
      pageStreamsInspected += 1;
      if (stripped.removed > 0 && pageUsage.unsegmentedPages.size > 0) {
        throw new PdfRedactionError(
          `Source text operators exist on page(s) without extracted segments: ${[...pageUsage.unsegmentedPages].join(', ')}`,
          'unsegmented-page-text',
        );
      }
    }
    if (form || pageUsage?.translatedPages.size > 0) {
      removedTextOperators += stripped.removed;
      sanitizedStreams += 1;
      replacements.set(key, replacementStream(pdfDoc, object, stripped.bytes));
    }
  }

  for (const [key, replacement] of replacements) {
    const ref = pageStreamUsage.get(key)?.ref || refsByKey.get(key);
    if (ref) pdfDoc.context.assign(ref, replacement);
  }

  if (removedTextOperators < segments.length) {
    throw new PdfRedactionError('Not every extracted source segment mapped to a removable text operator', 'operator-coverage-insufficient');
  }

  const bytes = await pdfDoc.save({ useObjectStreams: false, addDefaultPage: false });
  return {
    buffer: bytes,
    report: {
      engine: 'pdf-lib-content-stream-v1',
      license: 'MIT',
      strategy: 'remove-all-text-show-operators-on-translated-pages',
      redactedSegments: segments.length,
      removedTextOperators,
      sanitizedStreams,
      pageStreamsInspected,
      removedLinks,
      geometryConfidence: 'exact-page-user-space',
      sourceBearingMetadata: 'verified-absent',
      whiteOutUsed: false,
    },
  };
}

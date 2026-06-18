const DEFAULT_CHUNK_MAX_CHARS = 2_800;
const DEFAULT_CHUNK_OVERLAP_CHARS = 280;

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function safeJsonParse(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function trimChunkBoundary(text, start, end) {
  let chunkStart = start;
  let chunkEnd = Math.min(end, text.length);

  if (chunkStart > 0) {
    const nextSpace = text.indexOf(' ', chunkStart);
    if (nextSpace > chunkStart && nextSpace < chunkStart + 120) chunkStart = nextSpace + 1;
  }

  if (chunkEnd < text.length) {
    const lastBreak = Math.max(text.lastIndexOf('\n', chunkEnd), text.lastIndexOf('. ', chunkEnd));
    if (lastBreak > chunkStart + 600) chunkEnd = lastBreak + 1;
  }

  return { start: chunkStart, end: chunkEnd };
}

export function chunkPlainText(text, options = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const maxChars = options.maxChars || DEFAULT_CHUNK_MAX_CHARS;
  const overlapChars = Math.min(options.overlapChars || DEFAULT_CHUNK_OVERLAP_CHARS, Math.floor(maxChars / 3));
  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    const rawEnd = Math.min(start + maxChars, normalized.length);
    const { start: chunkStart, end: chunkEnd } = trimChunkBoundary(normalized, start, rawEnd);
    const content = normalized.slice(chunkStart, chunkEnd).trim();
    if (content) {
      chunks.push({
        content,
        tokenEstimate: estimateTokens(content),
        metadata: {
          char_start: chunkStart,
          char_end: chunkEnd,
        },
      });
    }

    if (rawEnd >= normalized.length) break;
    start = Math.max(chunkEnd - overlapChars, start + 1);
  }

  return chunks;
}

function chunkTranscriptSegments(segments, fallbackText) {
  if (!Array.isArray(segments) || segments.length === 0) return chunkPlainText(fallbackText);

  const chunks = [];
  let current = [];
  let currentChars = 0;
  const maxChars = DEFAULT_CHUNK_MAX_CHARS;

  function flush() {
    if (current.length === 0) return;
    const content = current
      .map((segment) => {
        const speaker = segment.speaker || segment.speaker_label || segment.channel || null;
        return speaker ? `${speaker}: ${segment.text}` : segment.text;
      })
      .join('\n')
      .trim();
    if (!content) {
      current = [];
      currentChars = 0;
      return;
    }
    const first = current[0];
    const last = current[current.length - 1];
    chunks.push({
      content,
      tokenEstimate: estimateTokens(content),
      metadata: {
        start_seconds: first.start ?? first.start_seconds ?? null,
        end_seconds: last.end ?? last.end_seconds ?? null,
        segment_ids: current.map((segment) => segment.id).filter((id) => id !== undefined && id !== null),
      },
    });
    current = [];
    currentChars = 0;
  }

  for (const rawSegment of segments) {
    const segment = rawSegment && typeof rawSegment === 'object' ? rawSegment : { text: rawSegment };
    const text = normalizeText(segment.text);
    if (!text) continue;
    if (currentChars + text.length > maxChars && current.length > 0) flush();
    current.push({ ...segment, text });
    currentChars += text.length;
  }
  flush();

  return chunks.length > 0 ? chunks : chunkPlainText(fallbackText);
}

const MARKDOWN_HEADING = /^(#{1,6})\s+(.*\S)\s*$/;

/**
 * Markdown/OCR-aware chunker. Splits on headings so each chunk stays within a
 * single section and carries its heading in metadata (useful for citations).
 * Oversized sections fall back to the paragraph/size-based plain-text splitter.
 * Plain text without headings degrades gracefully to size-based chunks.
 */
export function chunkMarkdown(text, options = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const maxChars = options.maxChars || DEFAULT_CHUNK_MAX_CHARS;
  const lines = normalized.split('\n');
  const chunks = [];
  let heading = null;
  let buffer = [];
  let bufferLen = 0;

  const flush = () => {
    const content = buffer.join('\n').trim();
    buffer = [];
    bufferLen = 0;
    if (!content) return;
    const headingMeta = heading ? { heading } : {};
    if (content.length <= maxChars) {
      chunks.push({ content, tokenEstimate: estimateTokens(content), metadata: headingMeta });
      return;
    }
    for (const sub of chunkPlainText(content, options)) {
      chunks.push({ ...sub, metadata: { ...(sub.metadata || {}), ...headingMeta } });
    }
  };

  for (const line of lines) {
    const match = line.match(MARKDOWN_HEADING);
    if (match) {
      flush();
      heading = match[2].trim();
      buffer.push(line);
      bufferLen += line.length + 1;
      continue;
    }
    buffer.push(line);
    bufferLen += line.length + 1;
    // Soft guard so a long heading-less section doesn't grow unbounded.
    if (bufferLen > maxChars) flush();
  }
  flush();

  return chunks;
}

export function buildDocumentChunks(document) {
  const segments = safeJsonParse(document?.segments);
  const primaryText = document?.text || document?.summary || document?.text_preview || '';
  const chunks = (Array.isArray(segments) && segments.length > 0)
    ? chunkTranscriptSegments(segments, primaryText)
    : chunkMarkdown(primaryText);
  return chunks.map((chunk, index) => ({
    ...chunk,
    chunkIndex: index,
    metadata: {
      ...(chunk.metadata || {}),
      source_type: document?.source_type || null,
      title: document?.title || document?.original_name || null,
    },
  }));
}

/**
 * Pure orchestration for best-effort auto-indexing. All side-effecting
 * dependencies are injected so this stays unit-testable without a database or
 * Cortecs endpoint. Never throws: any failure is swallowed and logged.
 *
 * Accepts either a `documentId` or a `transcriptionId` (the document id is then
 * resolved from the latter). `cortecs` may be passed if already resolved.
 */
export async function runAutoIndex(
  { documentId, transcriptionId, organizationId, userId, cortecs = null },
  { resolveDocumentIdForTranscription, resolveCortecsConfig, indexDocument, logWarn } = {},
) {
  try {
    if (!organizationId || !userId) return null;

    let resolvedDocumentId = documentId ?? null;
    if (!resolvedDocumentId && transcriptionId) {
      resolvedDocumentId = await resolveDocumentIdForTranscription(transcriptionId, organizationId);
    }
    if (!resolvedDocumentId) return null;

    const resolvedCortecs = cortecs || (await resolveCortecsConfig({ userId, organizationId }));
    if (!resolvedCortecs?.apiKey) return null;

    return await indexDocument({ documentId: resolvedDocumentId, organizationId, userId, cortecs: resolvedCortecs });
  } catch (error) {
    logWarn?.('document.auto_index_failed', {
      documentId: documentId ?? null,
      transcriptionId: transcriptionId ?? null,
      organizationId: organizationId ?? null,
      message: error?.message,
    });
    return null;
  }
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i]);
    const bv = Number(b[i]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function buildRetrievalPrompt(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return '';
  const blocks = sources.map((source, index) => {
    const label = `S${index + 1}`;
    const title = source.title ? ` (${source.title})` : '';
    return `[${label}]${title}\n${String(source.content || '').trim()}`;
  });
  return `Nutze diese Quellen fuer dokumentbasierte Aussagen und zitiere sie mit [S1], [S2] usw. Wenn die Quellen nicht ausreichen, sage das klar.\n\n${blocks.join('\n\n')}`;
}

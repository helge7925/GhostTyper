import formidable from 'formidable';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { performOCR, translateText, translateTextSegments } from '../../../lib/ai-service';
import {
  CostLimitCheckUnavailableError,
  assertBudgetWithinLimits,
  estimateTextTransformCost,
  logUsage,
} from '../../../lib/usage';
import { getSettingsRow, resolveCortecsConfig, resolveMistralApiKey } from '../../../lib/settings-service';
import { resolveChatModel } from '../../../lib/model-policy';
import {
  ACCEPTED_FILE_TRANSLATION_TYPES,
  ACCEPTED_OFFICE_TRANSLATION_TYPES,
  ACCEPTED_PDF_TRANSLATION_TYPES,
  MAX_FILE_SIZE,
  MAX_TRANSLATE_INPUT_LENGTH,
} from '../../../lib/constants';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { detectTranslatableMimeType, extensionFromDetectedMime } from '../../../lib/file-signature';
import { inspectOfficeDocumentBuffer, translateOfficeDocumentBuffer } from '../../../lib/office-translation';
import { scanFileForViruses } from '../../../lib/virus-scan';
import { logAuditEvent } from '../../../lib/audit-log';
import { addTranscriptionEvent } from '../../../lib/transcription-events';
import { buildTranslatedFilename } from '../../../lib/translate-filename';
import { mdToHtml } from '../../../lib/export-utils';
import { renderPdfBufferFromHtml } from '../../../lib/pdf-export';
import { upsertDocumentForTranscription } from '../../../lib/documents';
import {
  detectTextLayer,
  extractRuns,
  segmentRuns,
  rewritePdf,
  findNonEncodableTranslations,
} from '../../../lib/pdf-inplace';
import {
  aggregateSegmentMetadata,
  describeGlossaryApplication,
  getGlossaryForPair,
  lookupTM,
  shouldSkipTMForText,
  storeTM,
  translateSegmentsWithGlossaryGuard,
  translateTextWithGlossaryGuard,
} from '../../../lib/translation-glossary';

export const config = {
  api: {
    bodyParser: false,
  },
};

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

async function ensureUploadDir() {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  await unlink(filePath).catch(() => {});
}

function parseForm(req) {
  const form = formidable({
    maxFileSize: MAX_FILE_SIZE,
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function safeDownloadName(filename, extension, languageLabel, fallbackLabel = 'translated') {
  return buildTranslatedFilename(filename, extension, languageLabel, fallbackLabel);
}

/**
 * Splits a long markdown string into chunks small enough to translate in one
 * model round-trip. Splits on blank lines (paragraph boundaries) so structure
 * is preserved; never splits a paragraph mid-sentence.
 */
function splitMarkdownIntoSegments(markdown, maxChars = 6000) {
  const paragraphs = String(markdown || '').split(/\n{2,}/);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (!paragraph) continue;
    if (current && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Phase-1 in-place PDF translation renders with pdf-lib StandardFonts (WinAnsi),
// which only cover latin-script targets. Non-latin targets are routed to the OCR
// fallback up front so we never spend a translation call we can't render. This
// is a coarse gate by language name/code; the encodability net after translation
// (findNonEncodableTranslations) still catches stragglers.
const NON_LATIN_TARGETS = new Set([
  'chinese', 'mandarin', 'cantonese', 'zh', 'zh-cn', 'zh-tw',
  'japanese', 'ja', 'korean', 'ko',
  'russian', 'ru', 'ukrainian', 'uk', 'bulgarian', 'bg', 'serbian', 'sr',
  'macedonian', 'mk', 'belarusian', 'be',
  'greek', 'el', 'arabic', 'ar', 'hebrew', 'he', 'persian', 'farsi', 'fa',
  'urdu', 'ur', 'thai', 'th', 'hindi', 'hi', 'bengali', 'bn',
  'tamil', 'ta', 'telugu', 'te', 'georgian', 'ka', 'armenian', 'hy',
]);

function isLatinScriptTarget(language) {
  const normalized = String(language || '').trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return true;
  return !NON_LATIN_TARGETS.has(normalized);
}

function addUsage(total, usage = {}) {
  return {
    prompt_tokens: (total.prompt_tokens || 0) + (usage.prompt_tokens || usage.input_tokens || 0),
    completion_tokens: (total.completion_tokens || 0) + (usage.completion_tokens || usage.output_tokens || 0),
  };
}

async function loadTranslationGlossary(orgId, sourceLanguage, targetLanguage, userId) {
  try {
    return await getGlossaryForPair(orgId, sourceLanguage, targetLanguage, { userId });
  } catch (error) {
    logApiError('File translation glossary lookup error', error);
    return { entries: [], doNotTranslate: [], personalTerms: [] };
  }
}

async function translateSegmentsWithGlossary({
  segments,
  orgId,
  sourceLanguage,
  targetLanguage,
  apiKey,
  model,
  glossary,
  providerOptions = {},
}) {
  try {
    const translations = new Array(segments.length).fill(null);
    const perSegment = new Array(segments.length).fill(null);
    const misses = [];
    let tmHits = 0;
    for (let i = 0; i < segments.length; i += 1) {
      let cachedTranslation = null;
      try {
        cachedTranslation = await lookupTM(orgId, sourceLanguage, targetLanguage, segments[i]);
      } catch (error) {
        logApiError('File translation memory lookup error', error);
      }
      if (cachedTranslation) {
        translations[i] = cachedTranslation;
        tmHits += 1;
        const meta = describeGlossaryApplication(glossary, segments[i]);
        perSegment[i] = {
          source: segments[i],
          target: cachedTranslation,
          applied: meta.applied,
          masked: meta.masked,
          dntViolations: [],
          retried: false,
          fromTM: true,
        };
      } else {
        misses.push({ index: i, text: segments[i] });
      }
    }

    let usage = {};
    let usedModel = model;
    if (misses.length > 0) {
      const guard = await translateSegmentsWithGlossaryGuard({
        texts: misses.map((entry) => entry.text),
        glossary,
        translateSegments: (maskedSegments, { glossaryBlock, strict }) => translateTextSegments(
          maskedSegments,
          targetLanguage,
          sourceLanguage,
          apiKey,
          model,
          { glossaryBlock, strictPlaceholders: strict, ...providerOptions },
        ),
      });
      usage = guard.usage || {};
      usedModel = guard.model || model;
      for (let i = 0; i < misses.length; i += 1) {
        const restored = guard.translations[i];
        translations[misses[i].index] = restored;
        perSegment[misses[i].index] = { ...guard.perSegment[i], fromTM: false };
        // TM leak guard: skip caching segments shaped by a personal glossary.
        if (!shouldSkipTMForText(glossary, misses[i].text)) {
          try {
            await storeTM(orgId, sourceLanguage, targetLanguage, misses[i].text, restored);
          } catch (error) {
            logApiError('File translation memory store error', error);
          }
        }
      }
    }

    return { translations, usage, model: usedModel, tmHits, perSegment };
  } catch (error) {
    logApiError('File translation glossary/TM error', error);
    const fallback = await translateTextSegments(segments, targetLanguage, sourceLanguage, apiKey, model, providerOptions);
    return { ...fallback, tmHits: 0, perSegment: [] };
  }
}

// Per-segment review data rides along in the header only when it stays small
// (≤ 40 segments AND ≤ 6 KB encoded); otherwise the client shows the aggregate
// coverage panel alone. Trade-off documented in the change's status.md: the
// binary file is the response body, so streaming the full segment list would
// need a second round-trip — not worth it for large documents.
const SEGMENT_HEADER_MAX_COUNT = 40;
const SEGMENT_HEADER_MAX_BYTES = 6 * 1024;

function buildReviewSegments(segments = []) {
  return segments
    .filter(Boolean)
    .map((segment) => ({
      s: String(segment.source ?? ''),
      t: String(segment.target ?? ''),
      a: (segment.applied || []).map((entry) => entry.source),
      m: (segment.masked || []).map((entry) => entry.term),
    }));
}

// Glossary metadata rides on a response header (the body is the translated
// file). Kept compact and URI-encoded; arrays are capped so the header stays
// well under server limits even for large terminology sets.
function glossaryMetadataHeader({
  applied = [], masked = [], dntViolations = [], tmHits = 0, retriedSegments = 0,
  segments = null, sourceLang = null, targetLang = null,
}) {
  const cap = (list) => list.slice(0, 50);
  const meta = {
    applied: cap(applied),
    masked: cap(masked),
    dntViolations: cap(dntViolations),
    tmHits,
    retriedSegments,
  };
  if (sourceLang) meta.sourceLang = sourceLang;
  if (targetLang) meta.targetLang = targetLang;

  if (Array.isArray(segments) && segments.length > 0) {
    const reviewSegments = buildReviewSegments(segments);
    const encoded = encodeURIComponent(JSON.stringify(reviewSegments));
    if (reviewSegments.length <= SEGMENT_HEADER_MAX_COUNT && encoded.length <= SEGMENT_HEADER_MAX_BYTES) {
      meta.segments = reviewSegments;
    }
  }

  return encodeURIComponent(JSON.stringify(meta));
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'translate-file',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 20,
    windowMs: 60_000,
  }, 'Zu viele Dateiübersetzungen. Bitte später erneut versuchen.');
  if (!allowed) return;

  let tempUploadPath = '';
  let outputPath = '';

  try {
    await ensureUploadDir();
    const { fields, files } = await parseForm(req);
    const file = files.file?.[0] || files.file;
    if (!file) {
      return res.status(400).json({ message: 'Keine Datei hochgeladen' });
    }

    tempUploadPath = file.filepath || '';
    const detectedMimeType = await detectTranslatableMimeType(tempUploadPath);
    if (!detectedMimeType || !ACCEPTED_FILE_TRANSLATION_TYPES.includes(detectedMimeType)) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Ungültiges Dateiformat. Erlaubt sind PDF, DOCX, XLSX und PPTX.' });
    }
    const isPdf = ACCEPTED_PDF_TRANSLATION_TYPES.includes(detectedMimeType);
    const isOffice = ACCEPTED_OFFICE_TRANSLATION_TYPES.includes(detectedMimeType);

    const scanResult = await scanFileForViruses(tempUploadPath);
    if (!scanResult.clean) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'office_translation.virus_detected',
        targetType: 'office_translation',
        targetId: file.originalFilename || null,
        severity: 'warn',
        metadata: {
          mode: scanResult.mode,
          detail: scanResult.detail,
          mimeType: detectedMimeType,
          size: Number(file.size || 0),
        },
      });
      return res.status(400).json({ message: 'Datei wurde vom Sicherheits-Scan blockiert' });
    }

    const targetLanguage = fields.targetLanguage?.[0] || fields.targetLanguage || 'German';
    const sourceLanguage = fields.sourceLanguage?.[0] || fields.sourceLanguage || 'auto';
    const requestModel = fields.model?.[0] || fields.model || null;
    const languageLabelRaw = fields.languageLabel?.[0] || fields.languageLabel || '';
    const fallbackLabelRaw = fields.fallbackLabel?.[0] || fields.fallbackLabel || 'translated';
    const inputBuffer = await readFile(tempUploadPath);

    const settingsRow = await getSettingsRow(userId);
    const cortecs = await resolveCortecsConfig({ userId, organizationId: req.org?.id });
    const mistralApiKey = await resolveMistralApiKey({ userId, organizationId: req.org?.id });
    const preferredModel = resolveChatModel(requestModel, null)
      || resolveChatModel(settingsRow?.preferred_model, null)
      || cortecs.chatModel;
    if (!cortecs.apiKey) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
    }
    if (!preferredModel) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Ungültiges KI-Modell' });
    }

    // ====== OFFICE PATH (DOCX/XLSX/PPTX) ======
    if (isOffice) {
      const inspection = await inspectOfficeDocumentBuffer(inputBuffer, detectedMimeType);
      if (inspection.segmentCount === 0) {
        await safeUnlink(tempUploadPath);
        tempUploadPath = '';
        return res.status(400).json({ message: 'Die Datei enthält keinen direkt übersetzbaren Office-Text.' });
      }
      if (inspection.characterCount > MAX_TRANSLATE_INPUT_LENGTH) {
        await safeUnlink(tempUploadPath);
        tempUploadPath = '';
        return res.status(400).json({ message: `Office-Datei enthält zu viel Text (max. ${MAX_TRANSLATE_INPUT_LENGTH} Zeichen)` });
      }

      const glossary = await loadTranslationGlossary(orgId, sourceLanguage, targetLanguage, userId);
      let totalUsage = {};
      let tmHitTotal = 0;
      const reviewSegments = [];
      // Budget gate first (short advisory-lock hold), then the translation
      // outside the lock so it doesn't pin a pool connection.
      const estimatedCost = estimateTextTransformCost(preferredModel, inspection.text, {
        inputBufferTokens: inspection.segmentCount * 8,
        outputMultiplier: 1.15,
        outputBufferTokens: inspection.segmentCount * 8,
      });
      await assertBudgetWithinLimits(userId, orgId, estimatedCost);

      const translated = await translateOfficeDocumentBuffer(inputBuffer, detectedMimeType, {
        translator: async (segments) => {
          const result = await translateSegmentsWithGlossary({
            segments,
            orgId,
            sourceLanguage,
            targetLanguage,
            apiKey: cortecs.apiKey,
            model: preferredModel,
            glossary,
            providerOptions: { baseUrl: cortecs.baseUrl, preference: cortecs.preference },
          });
          totalUsage = addUsage(totalUsage, result.usage);
          tmHitTotal += result.tmHits || 0;
          for (const segment of result.perSegment || []) {
            if (segment) reviewSegments.push(segment);
          }
          return result.translations;
        },
      });

      const glossaryMeta = aggregateSegmentMetadata(reviewSegments);

      await logUsage(userId, preferredModel, 'office_translation', totalUsage, orgId);

      const extension = extensionFromDetectedMime(detectedMimeType);
      const outputFilename = `${randomUUID()}${extension}`;
      outputPath = path.join(UPLOAD_DIR, outputFilename);
      await writeFile(outputPath, translated.buffer);

      const downloadName = safeDownloadName(file.originalFilename, extension, languageLabelRaw, fallbackLabelRaw);
      const historyResult = await query(
        `INSERT INTO transcriptions (user_id, organization_id, filename, original_name, file_path, file_size, mime_type, status, template, text, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'translation', $8, $9)
         RETURNING id`,
        [
          userId,
          orgId,
          outputFilename,
          downloadName,
          outputPath,
          translated.buffer.length,
          detectedMimeType,
          `Office-Datei wurde nach ${targetLanguage} übersetzt. Formatstruktur wurde beibehalten; ${translated.stats.segmentCount} Textsegmente wurden ersetzt.`,
          preferredModel,
        ]
      );
      await upsertDocumentForTranscription({
        transcriptionId: historyResult.rows[0].id,
        organizationId: orgId,
        ownerUserId: userId,
        visibility: 'private',
        sourceType: 'translation',
        title: downloadName,
        mimeType: detectedMimeType,
        fileSize: translated.buffer.length,
        status: 'completed',
        textPreview: `Office-Datei wurde nach ${targetLanguage} übersetzt.`,
      });
      await addTranscriptionEvent({
        transcriptionId: historyResult.rows[0].id,
        userId,
        organizationId: orgId,
        stage: 'completed',
        message: 'Office-Dateiübersetzung abgeschlossen.',
        meta: {
          segmentCount: translated.stats.segmentCount,
          warningCount: translated.stats.warningCount,
        },
      });

      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'office_translation.completed',
        targetType: 'transcription',
        targetId: String(historyResult.rows[0].id),
        metadata: {
          originalName: file.originalFilename || null,
          outputName: downloadName,
          mimeType: detectedMimeType,
          targetLanguage,
          sourceLanguage,
          languageLabel: languageLabelRaw || null,
          model: preferredModel,
          segmentCount: translated.stats.segmentCount,
          warningCount: translated.stats.warningCount,
          glossaryApplied: glossaryMeta.applied.length,
          dntMasked: glossaryMeta.masked.length,
          dntViolations: glossaryMeta.dntViolations.length,
          tmHits: tmHitTotal,
        },
      });

      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      outputPath = '';

      res.setHeader('Content-Type', detectedMimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      res.setHeader('X-GhostTyper-History-Id', String(historyResult.rows[0].id));
      res.setHeader('X-GhostTyper-Layout-Warnings', String(translated.stats.warningCount || 0));
      res.setHeader('X-GhostTyper-Glossary', glossaryMetadataHeader({
        ...glossaryMeta,
        tmHits: tmHitTotal,
        segments: reviewSegments,
        sourceLang: sourceLanguage,
        targetLang: targetLanguage,
      }));
      return res.status(200).send(translated.buffer);
    }

    // ====== PDF PATH ======
    // Digital PDFs (embedded text layer, latin-script target) are translated
    // IN PLACE: extract positioned runs, translate segment-wise via the same
    // glossary/TM machinery as the office path, and redraw the translation over
    // the original layout. Scans, non-latin targets, and non-encodable results
    // fall through to the existing OCR → re-render path (flagged approximated).
    if (isPdf) {
      const glossary = await loadTranslationGlossary(orgId, sourceLanguage, targetLanguage, userId);

      // ---- In-place attempt (digital + latin target) --------------------
      let pdfFallbackReason = null;
      let detection = null;
      try {
        detection = await detectTextLayer(inputBuffer);
      } catch (error) {
        logApiError('PDF text-layer detection error', error);
      }
      if (detection && detection.digital && !isLatinScriptTarget(targetLanguage)) {
        pdfFallbackReason = 'non-latin-target';
      }
      if (detection && detection.digital && isLatinScriptTarget(targetLanguage)) {
        try {
          const extraction = await extractRuns(inputBuffer);
          const segments = segmentRuns(extraction.runs, extraction.pages);
          const joined = segments.map((s) => s.text).join('\n\n');
          if (segments.length === 0 || !joined.trim()) {
            pdfFallbackReason = 'no-extractable-segments';
          } else if (joined.length > MAX_TRANSLATE_INPUT_LENGTH) {
            throw Object.assign(
              new Error(`PDF enthält zu viel Text (max. ${MAX_TRANSLATE_INPUT_LENGTH} Zeichen)`),
              { code: 'PDF_TOO_LARGE' },
            );
          } else {
            // Budget gate mirrors the office path: estimate over the joined
            // segment text before any provider call (short advisory-lock hold).
            const estimatedCost = estimateTextTransformCost(preferredModel, joined, {
              inputBufferTokens: segments.length * 8,
              outputMultiplier: 1.15,
              outputBufferTokens: segments.length * 8,
            });
            await assertBudgetWithinLimits(userId, orgId, estimatedCost);

            const result = await translateSegmentsWithGlossary({
              segments: segments.map((s) => s.text),
              orgId,
              sourceLanguage,
              targetLanguage,
              apiKey: cortecs.apiKey,
              model: preferredModel,
              glossary,
              providerOptions: { baseUrl: cortecs.baseUrl, preference: cortecs.preference },
            });

            // Safety net: if the target text needs glyphs a WinAnsi standard
            // font can't render, reroute to OCR (renders full Unicode via HTML).
            const nonEncodable = findNonEncodableTranslations(result.translations);
            if (nonEncodable.length > 0) {
              pdfFallbackReason = 'non-encodable-target';
            } else {
              const { buffer: rewritten, report } = await rewritePdf(inputBuffer, segments, result.translations);
              const outBuffer = Buffer.from(rewritten);
              await logUsage(userId, preferredModel, 'translation', result.usage || {}, orgId);

              const inPlaceMeta = aggregateSegmentMetadata(result.perSegment || []);
              const extension = '.pdf';
              const outputFilename = `${randomUUID()}${extension}`;
              outputPath = path.join(UPLOAD_DIR, outputFilename);
              await writeFile(outputPath, outBuffer);

              const downloadName = safeDownloadName(file.originalFilename, extension, languageLabelRaw, fallbackLabelRaw);
              const historyResult = await query(
                `INSERT INTO transcriptions (user_id, organization_id, filename, original_name, file_path, file_size, mime_type, status, template, text, model)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'translation', $8, $9)
                 RETURNING id`,
                [
                  userId,
                  orgId,
                  outputFilename,
                  downloadName,
                  outputPath,
                  outBuffer.length,
                  'application/pdf',
                  `PDF wurde layouterhaltend nach ${targetLanguage} übersetzt (In-Place). ${report.translated}/${report.segments} Segmente ersetzt; ${report.overflows} Überläufe.`,
                  preferredModel,
                ]
              );
              await upsertDocumentForTranscription({
                transcriptionId: historyResult.rows[0].id,
                organizationId: orgId,
                ownerUserId: userId,
                visibility: 'private',
                sourceType: 'translation',
                title: downloadName,
                mimeType: 'application/pdf',
                fileSize: outBuffer.length,
                status: 'completed',
                textPreview: `PDF wurde layouterhaltend nach ${targetLanguage} übersetzt.`,
              });
              await addTranscriptionEvent({
                transcriptionId: historyResult.rows[0].id,
                userId,
                organizationId: orgId,
                stage: 'completed',
                message: 'PDF-Dateiübersetzung abgeschlossen (Layout erhalten).',
                meta: {
                  segmentCount: report.segments,
                  overflows: report.overflows,
                  fontFallbacks: report.fontFallbacks,
                },
              });
              await logAuditEvent({
                userId,
                organizationId: orgId,
                action: 'pdf_translation.completed',
                targetType: 'transcription',
                targetId: String(historyResult.rows[0].id),
                metadata: {
                  originalName: file.originalFilename || null,
                  outputName: downloadName,
                  mimeType: 'application/pdf',
                  targetLanguage,
                  sourceLanguage,
                  languageLabel: languageLabelRaw || null,
                  model: preferredModel,
                  layoutMode: 'in-place',
                  segmentCount: report.segments,
                  overflows: report.overflows,
                  fontFallbacks: report.fontFallbacks,
                  glossaryApplied: inPlaceMeta.applied.length,
                  dntMasked: inPlaceMeta.masked.length,
                  dntViolations: inPlaceMeta.dntViolations.length,
                  tmHits: result.tmHits || 0,
                },
              });

              await safeUnlink(tempUploadPath);
              tempUploadPath = '';
              outputPath = '';

              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
              res.setHeader('X-GhostTyper-History-Id', String(historyResult.rows[0].id));
              res.setHeader('X-GhostTyper-PDF-Layout-Mode', 'in-place');
              res.setHeader('X-GhostTyper-Layout', encodeURIComponent(JSON.stringify(report)));
              res.setHeader('X-GhostTyper-Glossary', glossaryMetadataHeader({
                ...inPlaceMeta,
                tmHits: result.tmHits || 0,
                segments: result.perSegment || [],
                sourceLang: sourceLanguage,
                targetLang: targetLanguage,
              }));
              return res.status(200).send(outBuffer);
            }
          }
        } catch (error) {
          // Budget / size errors are real — let them reach the handler catch.
          // Anything else means the in-place path couldn't cope; fall back.
          if (
            error?.code === 'PDF_TOO_LARGE'
            || error?.code === 'COST_LIMIT_EXCEEDED'
            || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED'
            || error?.code === 'COST_CHECK_UNAVAILABLE'
            || error instanceof CostLimitCheckUnavailableError
          ) {
            throw error;
          }
          logApiError('PDF in-place translation failed; falling back to OCR', error);
          pdfFallbackReason = pdfFallbackReason || 'in-place-error';
        }
      }
      if (!pdfFallbackReason) {
        pdfFallbackReason = detection && detection.digital ? 'in-place-unavailable' : 'scanned-no-text-layer';
      }

      // ---- OCR fallback (scan / non-latin / non-encodable) --------------
      let totalOcrUsage = {};
      let totalTranslateUsage = {};
      let segmentCount = 0;
      let pdfTmHits = 0;
      const pdfReviewSegments = [];
      let pdfBuffer;

      // Budget gate first (short advisory-lock hold); OCR + translation run
      // outside the lock so the long provider calls don't pin a pool
      // connection.
      await assertBudgetWithinLimits(userId, orgId);
      pdfBuffer = await (async () => {
        // Step 1: OCR via Mistral — returns Markdown.
        if (!mistralApiKey) {
          throw Object.assign(new Error('Kein Mistral API-Key für PDF-OCR konfiguriert.'), { code: 'NO_MISTRAL_OCR_KEY' });
        }
        const ocrResult = await performOCR(tempUploadPath, mistralApiKey, 'application/pdf');
        const sourceMarkdown = String(ocrResult?.markdown || '').trim();
        if (ocrResult?.usage) {
          totalOcrUsage = addUsage(totalOcrUsage, ocrResult.usage);
        }
        if (!sourceMarkdown) {
          throw Object.assign(new Error('PDF enthält keinen extrahierbaren Text.'), { code: 'PDF_NO_TEXT' });
        }
        if (sourceMarkdown.length > MAX_TRANSLATE_INPUT_LENGTH) {
          throw Object.assign(
            new Error(`PDF enthält zu viel Text (max. ${MAX_TRANSLATE_INPUT_LENGTH} Zeichen)`),
            { code: 'PDF_TOO_LARGE' },
          );
        }

        // Project the LLM cost for the translation step now that the OCR
        // text size is known (second short gate, again without holding the
        // lock through the translation itself).
        const estimatedCost = estimateTextTransformCost(preferredModel, sourceMarkdown, {
          outputMultiplier: 1.15,
        });
        await assertBudgetWithinLimits(userId, orgId, estimatedCost);

        // Step 2: Translate Markdown chunk-by-chunk to keep token windows safe.
        const segments = splitMarkdownIntoSegments(sourceMarkdown, 6000);
        segmentCount = segments.length;
        const translatedSegments = [];
        for (const segment of segments) {
          let cachedTranslation = null;
          try {
            cachedTranslation = await lookupTM(orgId, sourceLanguage, targetLanguage, segment);
          } catch (error) {
            logApiError('PDF translation memory lookup error', error);
          }
          if (cachedTranslation) {
            translatedSegments.push(cachedTranslation);
            pdfTmHits += 1;
            const meta = describeGlossaryApplication(glossary, segment);
            pdfReviewSegments.push({
              source: segment,
              target: cachedTranslation,
              applied: meta.applied,
              masked: meta.masked,
              dntViolations: [],
              retried: false,
              fromTM: true,
            });
            continue;
          }

          const guard = await translateTextWithGlossaryGuard({
            text: segment,
            glossary,
            translate: async (maskedText, { glossaryBlock, strict }) => {
              const result = await translateText(
                maskedText,
                targetLanguage,
                sourceLanguage,
                cortecs.apiKey,
                preferredModel,
                { glossaryBlock, strictPlaceholders: strict, baseUrl: cortecs.baseUrl, preference: cortecs.preference }
              );
              return { translatedText: result?.translatedText, usage: result?.usage, model: result?.model };
            },
          });
          const restored = guard.translatedText || segment;
          translatedSegments.push(restored);
          totalTranslateUsage = addUsage(totalTranslateUsage, guard.usage);
          pdfReviewSegments.push({
            source: segment,
            target: restored,
            applied: guard.applied,
            masked: guard.masked,
            dntViolations: guard.dntViolations,
            retried: guard.retried,
            fromTM: false,
          });
          // TM leak guard: skip caching chunks shaped by a personal glossary.
          if (!shouldSkipTMForText(glossary, segment)) {
            try {
              await storeTM(orgId, sourceLanguage, targetLanguage, segment, restored);
            } catch (error) {
              logApiError('PDF translation memory store error', error);
            }
          }
        }
        const translatedMarkdown = translatedSegments.join('\n\n');

        // Step 3: Markdown → HTML → PDF via existing Chromium renderer.
        const html = mdToHtml(translatedMarkdown);
        const buffer = await renderPdfBufferFromHtml(html, {});

        await logUsage(userId, 'mistral-ocr-latest', 'ocr', totalOcrUsage, orgId);
        await logUsage(userId, preferredModel, 'translation', totalTranslateUsage, orgId);
        return buffer;
      })();

      const pdfGlossaryMeta = aggregateSegmentMetadata(pdfReviewSegments);

      const extension = '.pdf';
      const outputFilename = `${randomUUID()}${extension}`;
      outputPath = path.join(UPLOAD_DIR, outputFilename);
      await writeFile(outputPath, pdfBuffer);

      const downloadName = safeDownloadName(file.originalFilename, extension, languageLabelRaw, fallbackLabelRaw);
      const historyResult = await query(
        `INSERT INTO transcriptions (user_id, organization_id, filename, original_name, file_path, file_size, mime_type, status, template, text, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'translation', $8, $9)
         RETURNING id`,
        [
          userId,
          orgId,
          outputFilename,
          downloadName,
          outputPath,
          pdfBuffer.length,
          'application/pdf',
          `PDF wurde nach ${targetLanguage} übersetzt. Layout aus dem Originaltext neu aufgebaut; ${segmentCount} Textsegmente.`,
          preferredModel,
        ]
      );
      await upsertDocumentForTranscription({
        transcriptionId: historyResult.rows[0].id,
        organizationId: orgId,
        ownerUserId: userId,
        visibility: 'private',
        sourceType: 'translation',
        title: downloadName,
        mimeType: 'application/pdf',
        fileSize: pdfBuffer.length,
        status: 'completed',
        textPreview: `PDF wurde nach ${targetLanguage} übersetzt.`,
      });
      await addTranscriptionEvent({
        transcriptionId: historyResult.rows[0].id,
        userId,
        organizationId: orgId,
        stage: 'completed',
        message: 'PDF-Dateiübersetzung abgeschlossen (Layout approximiert).',
        meta: { segmentCount, layoutMode: 'approximated', reason: pdfFallbackReason },
      });

      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'pdf_translation.completed',
        targetType: 'transcription',
        targetId: String(historyResult.rows[0].id),
        metadata: {
          originalName: file.originalFilename || null,
          outputName: downloadName,
          mimeType: 'application/pdf',
          targetLanguage,
          sourceLanguage,
          languageLabel: languageLabelRaw || null,
          model: preferredModel,
          layoutMode: 'approximated',
          fallbackReason: pdfFallbackReason,
          segmentCount,
          glossaryApplied: pdfGlossaryMeta.applied.length,
          dntMasked: pdfGlossaryMeta.masked.length,
          dntViolations: pdfGlossaryMeta.dntViolations.length,
          tmHits: pdfTmHits,
        },
      });

      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      outputPath = '';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      res.setHeader('X-GhostTyper-History-Id', String(historyResult.rows[0].id));
      res.setHeader('X-GhostTyper-PDF-Layout-Mode', 'approximated');
      res.setHeader('X-GhostTyper-Layout', encodeURIComponent(JSON.stringify({
        pages: detection?.pages || 0,
        segments: segmentCount,
        translated: segmentCount,
        overflows: 0,
        fontFallbacks: 0,
        nonEncodable: 0,
        mode: 'approximated',
        reason: pdfFallbackReason,
      })));
      res.setHeader('X-GhostTyper-Glossary', glossaryMetadataHeader({
        ...pdfGlossaryMeta,
        tmHits: pdfTmHits,
        segments: pdfReviewSegments,
        sourceLang: sourceLanguage,
        targetLang: targetLanguage,
      }));
      return res.status(200).send(pdfBuffer);
    }

    // Should never be reached due to whitelist above.
    await safeUnlink(tempUploadPath);
    tempUploadPath = '';
    return res.status(400).json({ message: 'Ungültiges Dateiformat' });
  } catch (error) {
    await safeUnlink(tempUploadPath);
    if (outputPath) await safeUnlink(outputPath);
    if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    if (error.code === 'LIMIT_FILE_SIZE' || error.message?.includes('maxFileSize')) {
      return res.status(413).json({ message: 'Datei ist zu groß (max. 500 MB)' });
    }
    if (error?.code === 'PDF_NO_TEXT' || error?.code === 'PDF_TOO_LARGE' || error?.code === 'NO_MISTRAL_OCR_KEY') {
      return res.status(400).json({ message: error.message });
    }
    logApiError('File translation error', error);
    return serverError(res, 'Datei-Übersetzung fehlgeschlagen');
  }
}

export default withOrgScope({ permission: 'transcription.write' }, handler);

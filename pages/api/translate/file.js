import formidable from 'formidable';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { performOCR, translateTextSegments } from '../../../lib/ai-service';
import { composeAbortSignals, executeReservedSpend, estimateTextUsage, requestBudgetScope } from '../../../lib/budget-runtime';
import { getSettingsRow, resolveOpenRouterConfig } from '../../../lib/settings-service';
import { resolveConfiguredModel } from '../../../lib/openrouter';
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
  aggregateSegmentMetadata,
  describeGlossaryApplication,
  getGlossaryForPair,
  lookupTMMatchesBatch,
  shouldSkipTMForText,
  storeTM,
  translateSegmentsWithGlossaryGuard,
} from '../../../lib/translation-glossary';
import {
  detectTextLayer,
  extractRuns,
  segmentRuns,
  rewritePdf,
} from '../../../lib/pdf-inplace';

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

function safeDownloadName(filename, extension, languageLabel, fallbackLabel = 'translated', suffix = '') {
  const name = buildTranslatedFilename(filename, extension, languageLabel, fallbackLabel);
  if (!suffix) return name;
  // Insert the suffix right before the extension so approximated-layout
  // downloads stay visibly labeled even after the browser's save dialog
  // (GxP requirement: a QA reviewer must see the fallback from the filename
  // alone, not just the response header).
  const ext = String(extension || '').startsWith('.') ? extension : extension ? `.${extension}` : '';
  if (ext && name.endsWith(ext)) {
    return `${name.slice(0, name.length - ext.length)}${suffix}${ext}`;
  }
  return `${name}${suffix}`;
}

// GxP: the layout report (segments, overflows, font substitutions) is
// persisted with the history row's analysis_meta so a QA reviewer can see
// exactly what was altered, in-place or approximated.
function buildLayoutAnalysisMeta(report) {
  return { pdfLayoutReport: report };
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

async function loadTranslationGlossary(orgId, sourceLanguage, targetLanguage, userId) {
  try {
    return await getGlossaryForPair(orgId, sourceLanguage, targetLanguage, { userId });
  } catch (error) {
    logApiError('File translation glossary lookup error', error);
    return {
      entries: [],
      doNotTranslate: [],
      personalTerms: [],
      personalGlossaryUnavailable: true,
    };
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
  budgetContext,
}) {
  const translatePaid = async (texts, { glossaryBlock = '', strict = false } = {}) => {
    if (providerOptions.signal?.aborted) {
      throw providerOptions.signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
    }
    budgetContext.counter.value += 1;
    const joined = texts.join('\n');
    return executeReservedSpend(
      {
        idempotencyKey: `${budgetContext.scope}:call:${budgetContext.counter.value}`,
        organizationId: orgId,
        userId: budgetContext.userId,
        transcriptionId: budgetContext.transcriptionId || null,
        operation: budgetContext.operation,
        provider: 'openrouter',
        model,
        estimatedUsage: estimateTextUsage(joined, {
          inputBufferTokens: 320 + texts.length * 16,
          outputMultiplier: 1.3,
          outputBufferTokens: 192 + texts.length * 16,
        }),
      },
      (_reservation, budgetSignal) => translateTextSegments(
        texts,
        targetLanguage,
        sourceLanguage,
        apiKey,
        model,
        {
          glossaryBlock,
          strictPlaceholders: strict,
          ...providerOptions,
          signal: composeAbortSignals(providerOptions.signal, budgetSignal),
        },
      ),
    );
  };
  try {
    const translations = new Array(segments.length).fill(null);
    const perSegment = new Array(segments.length).fill(null);
    const misses = [];
    let tmHits = 0;
    let tmMatches = new Array(segments.length).fill(null);
    try {
      tmMatches = await lookupTMMatchesBatch(
        orgId,
        sourceLanguage,
        targetLanguage,
        segments,
        { glossary },
      );
    } catch (error) {
      logApiError('File translation memory lookup error', error);
    }
    for (let i = 0; i < segments.length; i += 1) {
      const tmMatch = tmMatches[i];
      if (tmMatch?.autoReusable) {
        translations[i] = tmMatch.targetText;
        tmHits += 1;
        const meta = describeGlossaryApplication(glossary, segments[i]);
        perSegment[i] = {
          source: segments[i],
          target: tmMatch.targetText,
          applied: meta.applied,
          masked: meta.masked,
          dntViolations: [],
          retried: false,
          fromTM: true,
          tmMatch,
          tmSuggestions: [],
        };
      } else {
        misses.push({
          index: i,
          text: segments[i],
          tmSuggestions: tmMatch && !tmMatch.personalGlossaryUnavailableBlocked ? [tmMatch] : [],
        });
      }
    }

    let usage = {};
    let usedModel = model;
    if (misses.length > 0) {
      const guard = await translateSegmentsWithGlossaryGuard({
        texts: misses.map((entry) => entry.text),
        glossary,
        tmSuggestions: misses.map((entry) => entry.tmSuggestions),
        translateSegments: (maskedSegments, options) => translatePaid(maskedSegments, options),
      });
      usage = guard.usage || {};
      usedModel = guard.model || model;
      for (let i = 0; i < misses.length; i += 1) {
        const restored = guard.translations[i];
        translations[misses[i].index] = restored;
        perSegment[misses[i].index] = {
          ...guard.perSegment[i],
          fromTM: false,
          tmMatch: null,
          tmSuggestions: misses[i].tmSuggestions,
        };
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
    if (['BUDGET_EXCEEDED', 'BUDGET_ACCOUNTING_UNAVAILABLE', 'PRICING_CONFIGURATION_MISSING', 'PAID_JOB_CANCELLED'].includes(error?.code)) {
      throw error;
    }
    logApiError('File translation glossary/TM error', error);
    const fallback = await translatePaid(segments);
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

function compactTMMatch(match) {
  if (!match) return null;
  return {
    type: match.type,
    score: match.score,
    id: match.id,
    sourceText: String(match.sourceText || '').slice(0, 240),
    targetText: String(match.targetText || '').slice(0, 240),
    verified: match.verified,
  };
}

function buildReviewSegments(segments = []) {
  return segments
    .filter(Boolean)
    .map((segment) => ({
      s: String(segment.source ?? ''),
      t: String(segment.target ?? ''),
      a: (segment.applied || []).map((entry) => entry.source),
      m: (segment.masked || []).map((entry) => entry.term),
      tm: compactTMMatch(segment.tmMatch),
      tmSuggestions: (segment.tmSuggestions || []).map(compactTMMatch),
    }));
}

// Glossary metadata rides on a response header (the body is the translated
// file). Kept compact and URI-encoded; arrays are capped so the header stays
// well under server limits even for large terminology sets.
function glossaryMetadataHeader({
  applied = [], masked = [], dntViolations = [], tmHits = 0, retriedSegments = 0,
  exactTmHits = 0, fuzzyTmHits = 0, tmSuggestions = [],
  segments = null, sourceLang = null, targetLang = null,
}) {
  const cap = (list) => list.slice(0, 50);
  const meta = {
    applied: cap(applied),
    masked: cap(masked),
    dntViolations: cap(dntViolations),
    tmHits,
    retriedSegments,
    translationMemory: {
      exactHits: exactTmHits,
      fuzzyHits: fuzzyTmHits,
      suggestions: tmSuggestions.slice(0, 10).map(compactTMMatch),
    },
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
  const requestController = new AbortController();
  req.once('aborted', () => requestController.abort());
  res.once('close', () => {
    if (!res.writableEnded) requestController.abort();
  });

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
    const budgetScope = requestBudgetScope(req, 'file-translation', {
      originalFilename: file.originalFilename,
      size: file.size,
      sourceLanguage,
      targetLanguage,
    });
    const budgetCounter = { value: 0 };

    const settingsRow = await getSettingsRow(userId);
    const openrouter = await resolveOpenRouterConfig({ userId, organizationId: req.org?.id });
    const ocrModel = resolveConfiguredModel(openrouter, 'ocr', settingsRow?.ocr_model);
    const preferredModel = resolveConfiguredModel(openrouter, 'chat', requestModel || settingsRow?.preferred_model);
    if (!openrouter.apiKey) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Kein OpenRouter-API-Key konfiguriert' });
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
      let tmHitTotal = 0;
      const reviewSegments = [];
      const translated = await translateOfficeDocumentBuffer(inputBuffer, detectedMimeType, {
        translator: async (segments) => {
          const result = await translateSegmentsWithGlossary({
            segments,
            orgId,
            sourceLanguage,
            targetLanguage,
            apiKey: openrouter.apiKey,
            model: preferredModel,
            glossary,
            providerOptions: { baseUrl: openrouter.baseUrl, fallbackModel: openrouter.defaultModels.chat, signal: requestController.signal },
            budgetContext: {
              scope: `${budgetScope}:office`,
              counter: budgetCounter,
              userId,
              operation: 'office_translation',
            },
          });
          tmHitTotal += result.tmHits || 0;
          for (const segment of result.perSegment || []) {
            if (segment) reviewSegments.push(segment);
          }
          return result.translations;
        },
      });

      const glossaryMeta = aggregateSegmentMetadata(reviewSegments);

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
    // Digital PDFs with a supported target glyph set are translated
    // IN PLACE: extract positioned runs, translate segment-wise via the same
    // glossary/TM machinery as the office path (translateSegmentsWithGlossary),
    // after physical source-text removal. Scans, unsupported glyphs, and any
    // unsafe redaction/verification result use the labeled approximated path.
    if (isPdf) {
      const glossary = await loadTranslationGlossary(orgId, sourceLanguage, targetLanguage, userId);

      // ---- In-place attempt (digital + verified font/redaction support) --
      let pdfFallbackReason = null;
      let pdfIntegrityFailure = null;
      let detection = null;
      try {
        detection = await detectTextLayer(inputBuffer);
      } catch (error) {
        logApiError('PDF text-layer detection error', error);
      }
      if (detection && detection.digital) {
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
            const result = await translateSegmentsWithGlossary({
              segments: segments.map((s) => s.text),
              orgId,
              sourceLanguage,
              targetLanguage,
              apiKey: openrouter.apiKey,
              model: preferredModel,
              glossary,
              providerOptions: { baseUrl: openrouter.baseUrl, fallbackModel: openrouter.defaultModels.chat, signal: requestController.signal },
              budgetContext: {
                scope: `${budgetScope}:pdf-in-place`,
                counter: budgetCounter,
                userId,
                operation: 'translation',
              },
            });

            const { buffer: rewritten, report } = await rewritePdf(
              inputBuffer,
              segments,
              result.translations,
              { targetLanguage },
            );
              const outBuffer = Buffer.from(rewritten);
              const inPlaceMeta = aggregateSegmentMetadata(result.perSegment || []);
              const extension = '.pdf';
              const outputFilename = `${randomUUID()}${extension}`;
              outputPath = path.join(UPLOAD_DIR, outputFilename);
              await writeFile(outputPath, outBuffer);

              const downloadName = safeDownloadName(file.originalFilename, extension, languageLabelRaw, fallbackLabelRaw);
              const historyResult = await query(
                `INSERT INTO transcriptions (user_id, organization_id, filename, original_name, file_path, file_size, mime_type, status, template, text, model, analysis_meta)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'translation', $8, $9, $10)
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
                  JSON.stringify(buildLayoutAnalysisMeta(report)),
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
                  layoutMode: 'in-place',
                  segmentCount: report.segments,
                  overflows: report.overflows,
                  fontFallbacks: report.fontFallbacks,
                  nonEncodable: report.nonEncodable,
                  embeddedFonts: report.embeddedFonts.map((font) => font.family),
                  redactedSegments: report.redaction.redactedSegments,
                  sourceTextVerified: report.sourceTextVerification.verified,
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
                  layoutMode: report.mode,
                  layoutReport: {
                    mode: report.mode,
                    segments: report.segments,
                    overflows: report.overflows,
                    fontFallbacks: report.fontFallbacks,
                    nonEncodable: report.nonEncodable,
                    embeddedFonts: report.embeddedFonts,
                    substitutions: report.substitutions,
                    missingGlyphs: report.missingGlyphs,
                    redaction: report.redaction,
                    sourceTextVerification: report.sourceTextVerification,
                  },
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
        } catch (error) {
          // Budget / size errors are real — let them reach the handler catch.
          // Anything else means the in-place path couldn't cope; fall back.
          if (
            error?.code === 'PDF_TOO_LARGE'
             || error?.code === 'BUDGET_EXCEEDED'
             || error?.code === 'BUDGET_ACCOUNTING_UNAVAILABLE'
              || error?.code === 'PRICING_CONFIGURATION_MISSING'
              || error?.code === 'PAID_JOB_CANCELLED'
          ) {
            throw error;
          }
          logApiError('PDF in-place translation failed; falling back to OCR', error);
          pdfFallbackReason = pdfFallbackReason || error?.reason || 'in-place-error';
          pdfIntegrityFailure = {
            code: error?.code || 'PDF_IN_PLACE_ERROR',
            reason: error?.reason || 'in-place-error',
            missingGlyphs: Array.isArray(error?.missingGlyphs) ? error.missingGlyphs.slice(0, 100) : [],
          };
        }
      }
      if (!pdfFallbackReason) {
        pdfFallbackReason = detection && detection.digital ? 'in-place-unavailable' : 'scanned-no-text-layer';
      }

      // ---- OCR fallback (scan / non-latin / non-encodable / approximated) ----
      let segmentCount = 0;
      let pdfTmHits = 0;
      const pdfReviewSegments = [];
      let pdfBuffer;

      pdfBuffer = await (async () => {
        // Step 1: OCR via Mistral — returns Markdown.
        if (!openrouter.apiKey || !ocrModel) {
          throw Object.assign(new Error('OpenRouter OCR ist nicht vollständig konfiguriert.'), { code: 'NO_OPENROUTER_OCR' });
        }
        const estimatedPages = Math.max(
          1,
          Number(detection?.pages || 0),
          Math.ceil(inputBuffer.length / (250 * 1024)),
        );
        const ocrResult = await executeReservedSpend(
          {
            idempotencyKey: `${budgetScope}:pdf-ocr`,
            organizationId: orgId,
            userId,
            operation: 'ocr',
            provider: 'openrouter',
            model: ocrModel,
            estimatedUsage: { inputQuantity: estimatedPages, outputQuantity: 0 },
          },
          (_reservation, budgetSignal) => performOCR(tempUploadPath, openrouter.apiKey, 'application/pdf', {
            model: ocrModel,
            signal: composeAbortSignals(requestController.signal, budgetSignal),
          }),
          (result) => ({
            ...(result.usage || {}),
            inputQuantity: result.usage?.pages_processed || result.usage?.pages || estimatedPages,
            outputQuantity: 0,
          }),
        );
        const sourceMarkdown = String(ocrResult?.markdown || '').trim();
        if (!sourceMarkdown) {
          throw Object.assign(new Error('PDF enthält keinen extrahierbaren Text.'), { code: 'PDF_NO_TEXT' });
        }
        if (sourceMarkdown.length > MAX_TRANSLATE_INPUT_LENGTH) {
          throw Object.assign(
            new Error(`PDF enthält zu viel Text (max. ${MAX_TRANSLATE_INPUT_LENGTH} Zeichen)`),
            { code: 'PDF_TOO_LARGE' },
          );
        }

        // Step 2: Translate Markdown chunk-by-chunk to keep token windows safe.
        const segments = splitMarkdownIntoSegments(sourceMarkdown, 6000);
        segmentCount = segments.length;
        const translationResult = await translateSegmentsWithGlossary({
          segments,
          orgId,
          sourceLanguage,
          targetLanguage,
          apiKey: openrouter.apiKey,
          model: preferredModel,
          glossary,
          providerOptions: { baseUrl: openrouter.baseUrl, fallbackModel: openrouter.defaultModels.chat, signal: requestController.signal },
          budgetContext: {
            scope: `${budgetScope}:pdf-fallback`,
            counter: budgetCounter,
            userId,
            operation: 'translation',
          },
        });
        pdfTmHits = translationResult.tmHits || 0;
        pdfReviewSegments.push(...(translationResult.perSegment || []));
        const translatedMarkdown = translationResult.translations.join('\n\n');

        // Step 3: Markdown → HTML → PDF via existing Chromium renderer.
        const html = mdToHtml(translatedMarkdown);
        const buffer = await renderPdfBufferFromHtml(html, {});

        return buffer;
      })();

      const pdfGlossaryMeta = aggregateSegmentMetadata(pdfReviewSegments);

      // Scan fallback labeling (GxP): the approximated layout report rides
      // along on the same X-GhostTyper-Layout header the in-place path uses,
      // and is persisted with the history row so it shows the same shape in
      // both modes.
      const approximatedReport = {
        pages: detection?.pages || 0,
        pageGeometry: [],
        segments: segmentCount,
        translated: segmentCount,
        overflows: 0,
        fontFallbacks: 0,
        nonEncodable: 0,
        embeddedFonts: [],
        substitutions: [],
        missingGlyphs: pdfIntegrityFailure?.missingGlyphs || [],
        scriptFallbackReasons: [],
        redaction: {
          engine: 'pdf-lib-content-stream-v1',
          status: pdfIntegrityFailure?.code === 'PDF_REDACTION_UNSAFE' ? 'failed-closed' : 'not-run',
          failures: pdfIntegrityFailure ? [pdfIntegrityFailure] : [],
          removedLinks: 0,
          whiteOutUsed: false,
        },
        sourceTextVerification: { verified: false },
        mode: 'approximated',
        reason: pdfFallbackReason,
      };

      const extension = '.pdf';
      const outputFilename = `${randomUUID()}${extension}`;
      outputPath = path.join(UPLOAD_DIR, outputFilename);
      await writeFile(outputPath, pdfBuffer);

      // Visibly label the approximated-layout fallback in the download
      // filename itself, not just the response header — a QA reviewer
      // opening the file later must be able to tell at a glance.
      const downloadName = safeDownloadName(
        file.originalFilename, extension, languageLabelRaw, fallbackLabelRaw, '-layout-angenaehert',
      );
      const historyResult = await query(
        `INSERT INTO transcriptions (user_id, organization_id, filename, original_name, file_path, file_size, mime_type, status, template, text, model, analysis_meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'translation', $8, $9, $10)
         RETURNING id`,
        [
          userId,
          orgId,
          outputFilename,
          downloadName,
          outputPath,
          pdfBuffer.length,
          'application/pdf',
          `PDF wurde nach ${targetLanguage} übersetzt. Layout angenähert (${pdfFallbackReason}); ${segmentCount} Textsegmente.`,
          preferredModel,
          JSON.stringify(buildLayoutAnalysisMeta(approximatedReport)),
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
        textPreview: `PDF wurde nach ${targetLanguage} übersetzt (Layout angenähert).`,
      });
      await addTranscriptionEvent({
        transcriptionId: historyResult.rows[0].id,
        userId,
        organizationId: orgId,
        stage: 'completed',
        message: 'PDF-Dateiübersetzung abgeschlossen (Layout angenähert).',
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
          layoutReport: {
            mode: approximatedReport.mode,
            segments: approximatedReport.segments,
            overflows: approximatedReport.overflows,
            fontFallbacks: approximatedReport.fontFallbacks,
            nonEncodable: approximatedReport.nonEncodable,
            missingGlyphs: approximatedReport.missingGlyphs,
            redaction: approximatedReport.redaction,
            sourceTextVerification: approximatedReport.sourceTextVerification,
          },
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
      res.setHeader('X-GhostTyper-Layout', encodeURIComponent(JSON.stringify(approximatedReport)));
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
    if (error?.code === 'BUDGET_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error?.code === 'BUDGET_ACCOUNTING_UNAVAILABLE' || error?.code === 'PRICING_CONFIGURATION_MISSING') {
      return res.status(503).json({ message: error.message });
    }
    if (error.code === 'LIMIT_FILE_SIZE' || error.message?.includes('maxFileSize')) {
      return res.status(413).json({ message: 'Datei ist zu groß (max. 500 MB)' });
    }
    if (error?.code === 'PDF_NO_TEXT' || error?.code === 'PDF_TOO_LARGE' || error?.code === 'NO_OPENROUTER_OCR') {
      return res.status(400).json({ message: error.message });
    }
    logApiError('File translation error', error);
    return serverError(res, 'Datei-Übersetzung fehlgeschlagen');
  }
}

export default withOrgScope({ permission: 'paid.execute' }, handler);

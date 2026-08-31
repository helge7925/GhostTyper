import { query } from './db.js';
import { transcribeAudio, analyzeTranscription } from './ai-service.js';
import { transcribeAudioEdenAi, analyzeTranscriptionEdenAi } from './edenai-service.js';
import { resolveActiveProviderConfig } from './ai-provider-router.js';
import {
  assertTranscriptionPaidWorkActive,
  budgetIdempotencyKey,
  composeAbortSignals,
  estimateTextUsage,
  executeReservedSpend,
  paidJobAbortSignal,
} from './budget-runtime.js';
import { resolveConfiguredModel, getOpenRouterCatalogue, modelSupportsCapability } from './openrouter.js';
import { logAuditEvent } from './audit-log.js';
import { inferProviderForModel } from './pricing-core.js';
import { getSettingsRow, resolveOpenRouterConfig } from './settings-service.js';
import { addTranscriptionEvent } from './transcription-events.js';
import { resolveTemplate } from './template-service.js';
import { logApiError } from './api-utils.js';
import { normalizeAndValidateTableAnalysis } from './table-analysis.js';
import { normalizeDataTableAnalysis } from './data-table.js';
import { mergeContextBias } from './context-bias.js';
import { upsertDocumentFromTranscription } from './documents.js';
import {
  logInfo,
  trackJobCompleted,
  trackJobFailed,
  trackJobQueued,
  trackJobStarted,
  trackWorkerScan,
  updateWorkerMetrics,
} from './observability.js';

const DEFAULT_WORKER_CONCURRENCY = 1;
const DEFAULT_SCAN_INTERVAL_MS = 8_000;
const DEFAULT_SCAN_BATCH = 20;

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getWorkerConfig() {
  return {
    concurrency: toPositiveInt(process.env.TRANSCRIPTION_WORKER_CONCURRENCY, DEFAULT_WORKER_CONCURRENCY),
    scanIntervalMs: toPositiveInt(process.env.TRANSCRIPTION_WORKER_SCAN_INTERVAL_MS, DEFAULT_SCAN_INTERVAL_MS),
    scanBatch: toPositiveInt(process.env.TRANSCRIPTION_WORKER_SCAN_BATCH, DEFAULT_SCAN_BATCH),
  };
}

function getWorkerState() {
  const globalKey = '__ghosttyperTranscriptionWorkerState';
  if (!globalThis[globalKey]) {
    globalThis[globalKey] = {
      started: false,
      scanTimer: null,
      queue: [],
      queuedKeys: new Set(),
      activeCount: 0,
      pumpRunning: false,
      scanRunning: false,
    };
  }
  return globalThis[globalKey];
}

function toKey(transcriptionId, userId) {
  return `${userId}:${transcriptionId}`;
}

function parseKey(key) {
  const [userIdRaw, transcriptionIdRaw] = String(key).split(':');
  return {
    userId: Number.parseInt(userIdRaw, 10),
    transcriptionId: Number.parseInt(transcriptionIdRaw, 10),
  };
}

function mapWorkerFailure(error) {
  const message = String(error?.message || '');
  const normalized = message.toLowerCase();
  const provider = normalized.includes('openrouter') ? 'OpenRouter' : null;

  if (provider && (normalized.includes('401') || normalized.includes('unauthorized'))) {
    return {
      message: `${provider} API-Key ungültig oder abgelaufen. Bitte in den Einstellungen aktualisieren.`,
      eventMessage: `Verarbeitung gestoppt: ${provider} API-Key ungültig.`,
    };
  }

  if (provider && (normalized.includes('429') || normalized.includes('rate limit'))) {
    return {
      message: `${provider} API-Limit erreicht. Bitte später erneut versuchen.`,
      eventMessage: `Verarbeitung pausiert: ${provider} API-Limit erreicht.`,
    };
  }

  if (normalized.includes('http_timeout')) {
    return {
      message: 'Zeitüberschreitung bei der KI-Verarbeitung. Bitte erneut versuchen.',
      eventMessage: 'Verarbeitung pausiert: KI-Timeout.',
    };
  }

  return {
    message: 'Transkription fehlgeschlagen. Bitte erneut versuchen.',
    eventMessage: 'Fehler bei der Transkription/Analyse.',
  };
}

async function markJobError({ transcriptionId, userId, organizationId = null, message, eventMessage }) {
  await query(
    "UPDATE transcriptions SET status = 'error', error = $1, updated_at = NOW() WHERE id = $2",
    [message, transcriptionId]
  );
  await addTranscriptionEvent({
    transcriptionId,
    userId,
    organizationId,
    stage: 'error',
    message: eventMessage || message,
  });
}

async function processClaimedJob(job) {
  const transcriptionId = Number(job.id);
  const userId = Number(job.user_id);
  const orgId = job.organization_id ?? null;

  // Helpers that auto-tag every event/error with the resolved org so we
  // don't have to repeat `organizationId: orgId` at every call site.
  const ev = (extra) => addTranscriptionEvent({ transcriptionId, userId, organizationId: orgId, ...extra });
  const errJob = (extra) => markJobError({ transcriptionId, userId, organizationId: orgId, ...extra });

  const settingsRow = await getSettingsRow(userId, { organizationId: orgId });
  const openrouter = await resolveOpenRouterConfig({ userId, organizationId: orgId });
  const language = settingsRow?.language || 'de';
  const contextBias = mergeContextBias(
    settingsRow?.organization_context_bias,
    settingsRow?.context_bias,
  );

  // Resolved independently from `openrouter` above: a workspace can have
  // `transcription` on EdenAI while analysis (further below) stays on
  // OpenRouter in the same job, or vice versa, or both/neither — the two
  // capabilities are activated independently (see
  // migrate-batch-transcription-to-edenai/design.md for why the STT
  // block was split out from analysis originally, and
  // migrate-chat-to-edenai for analysis's own migration).
  const activeTranscription = await resolveActiveProviderConfig({
    userId, organizationId: orgId, capability: 'transcription',
  });
  const activeChat = await resolveActiveProviderConfig({
    userId, organizationId: orgId, capability: 'chat',
  });
  // EdenAI's chat model is hardcoded — no per-user "preferred model"
  // concept, unlike OpenRouter's catalogue-driven preference.
  const preferredModel = activeChat.provider === 'edenai'
    ? activeChat.model
    : resolveConfiguredModel(activeChat, 'chat', settingsRow?.preferred_model);
  const transcriptionModel = activeTranscription.provider === 'edenai'
    ? activeTranscription.model
    : openrouter.defaultModels.transcription;

  if (!activeTranscription.apiKey) {
    await errJob({
      message: activeTranscription.provider === 'edenai'
        ? 'Kein EdenAI-API-Key konfiguriert. Bitte in den Einstellungen hinterlegen.'
        : 'Kein OpenRouter-API-Key konfiguriert. Bitte in den Einstellungen hinterlegen.',
      eventMessage: 'Verarbeitung konnte ohne API-Key nicht gestartet werden.',
    });
    return 'error';
  }

  // verbose_json/precise-timestamp support is an OpenRouter catalogue
  // signal with no EdenAI equivalent — EdenAI's speech_to_text_async
  // schema has no per-segment timestamps at all (see
  // transcribeAudioEdenAi's comment), so this check is skipped entirely
  // for the EdenAI branch rather than probing a catalogue that doesn't
  // apply.
  let verboseJsonSupported = false;
  if (activeTranscription.provider !== 'edenai') {
    try {
      const { models } = await getOpenRouterCatalogue({
        apiKey: openrouter.apiKey,
        organizationId: orgId,
        allowStale: true,
      });
      const transcriptionModelEntry = models.find((entry) => entry.id === transcriptionModel);
      verboseJsonSupported = Boolean(
        transcriptionModelEntry && modelSupportsCapability(transcriptionModelEntry, 'liveTranscription'),
      );
    } catch {
      // Catalogue lookup failure never blocks an already-configured
      // transcription; it just falls back to the untimestamped response.
    }
  }

  let text = '';
  let segments = [];
  let contextBiasForwarded = false;
  try {
    const signal = paidJobAbortSignal(transcriptionId, { organizationId: orgId, userId });
    const executeChunk = async ({ chunk, chunkIndex, execute }) => {
      await assertTranscriptionPaidWorkActive(transcriptionId);
      const key = budgetIdempotencyKey('upload-stt', transcriptionId, chunkIndex);
      return executeReservedSpend({
        idempotencyKey: key,
        organizationId: orgId,
        userId,
        transcriptionId,
        operation: 'transcription',
        provider: activeTranscription.provider,
        model: transcriptionModel,
        estimatedUsage: {
          inputQuantity: Math.max(1, chunk.estimatedSeconds || 1200),
          outputQuantity: 0,
        },
        reservationMs: 30 * 60 * 1000,
        stopOnDenied: true,
      }, (_reservation, budgetSignal) => execute({
        signal: composeAbortSignals(signal, budgetSignal),
      }));
    };
    const transcriptionResult = activeTranscription.provider === 'edenai'
      ? await transcribeAudioEdenAi(job.file_path, activeTranscription.apiKey, activeTranscription.model, {
        language,
        signal,
        executeChunk,
      })
      : await transcribeAudio(job.file_path, openrouter.apiKey, {
        contextBias,
        language,
        transcriptionModel,
        baseUrl: openrouter.baseUrl,
        fallbackModel: transcriptionModel,
        verboseJsonSupported,
        signal,
        executeChunk,
      });
    await assertTranscriptionPaidWorkActive(transcriptionId);

    text = transcriptionResult.text;
    segments = transcriptionResult.segments;
    contextBiasForwarded = transcriptionResult.contextBiasForwarded;
  } catch (error) {
    if (error?.code === 'BUDGET_EXCEEDED') {
      await errJob({
        message: error.message,
        eventMessage: 'Verarbeitung wegen erreichtem Kostenlimit gestoppt.',
      });
      return 'error';
    }
    if (error?.code === 'BUDGET_ACCOUNTING_UNAVAILABLE' || error?.code === 'PRICING_CONFIGURATION_MISSING') {
      await errJob({
        message: error.message,
        eventMessage: 'Verarbeitung pausiert: Kostenlimit-Prüfung aktuell nicht verfügbar.',
      });
      return 'error';
    }
    throw error;
  }

  await ev({
    stage: 'processing',
    message: 'Audio erfolgreich transkribiert.',
  });

  if (contextBias.length > 0) {
    const note = contextBiasForwarded
      ? `Kontextbegriffe (${contextBias.length}) wurden als Best-Effort-Hinweis an OpenRouter übergeben; die Anwendung hängt vom gewählten Anbieter ab und ist nicht garantiert.`
      : `Kontextbegriffe (${contextBias.length}) konnten für dieses Modell nicht übergeben werden.`;
    await ev({ stage: 'processing', message: note });
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'transcription.context_bias_forwarded',
      targetType: 'transcription',
      targetId: String(transcriptionId),
      metadata: {
        termCount: contextBias.length,
        forwarded: contextBiasForwarded,
        provider: activeTranscription.provider,
        model: transcriptionModel,
        bestEffort: true,
      },
    });
  }

  if (job.diarize && segments.length > 0) {
    await query(
      "UPDATE transcriptions SET status = 'transcribed', text = $1, segments = $2, updated_at = NOW() WHERE id = $3",
      [text, JSON.stringify(segments), transcriptionId]
    );
    await ev({
      stage: 'speaker_assignment',
      message: 'Sprecherzuweisung erforderlich.',
    });
    await upsertDocumentFromTranscription(transcriptionId, orgId);
    return 'completed';
  }

  if (!job.auto_analyze) {
    await query(
      "UPDATE transcriptions SET status = 'transcribed', text = $1, updated_at = NOW() WHERE id = $2",
      [text, transcriptionId]
    );
    await ev({
      stage: 'completed',
      message: 'Transkription abgeschlossen.',
    });
    await upsertDocumentFromTranscription(transcriptionId, orgId);
    return 'completed';
  }

  await query(
    "UPDATE transcriptions SET status = 'analyzing', text = $1, updated_at = NOW() WHERE id = $2",
    [text, transcriptionId]
  );
  await ev({
    stage: 'analyzing',
    message: 'KI-Analyse gestartet.',
  });

  let analysis = null;
  let resolvedTemplate = null;
  let isTableTemplate = false;
  let isBuiltinDataTableTemplate = false;
  let tableSchema = null;
  try {
    resolvedTemplate = await resolveTemplate(job.template, userId);
    isTableTemplate = resolvedTemplate?.template_type === 'table';
    isBuiltinDataTableTemplate = resolvedTemplate?.name === 'data_table' || job.template === 'data_table';
    tableSchema = resolvedTemplate?.table_schema || null;

    await assertTranscriptionPaidWorkActive(transcriptionId);
    const { analysis: analysisValue } = await executeReservedSpend(
      {
        idempotencyKey: budgetIdempotencyKey('upload-analysis', transcriptionId),
        organizationId: orgId,
        userId,
        transcriptionId,
        operation: 'analysis',
        provider: activeChat.provider,
        model: preferredModel,
        estimatedUsage: estimateTextUsage(`${text}\n${job.custom_prompt || ''}`, {
          inputBufferTokens: 1600,
          outputMultiplier: 0.8,
          outputBufferTokens: 3500,
        }),
        reservationMs: 10 * 60 * 1000,
        stopOnDenied: true,
      },
      (_reservation, budgetSignal) => (activeChat.provider === 'edenai'
        ? analyzeTranscriptionEdenAi(
          text,
          resolvedTemplate,
          activeChat.apiKey,
          job.custom_prompt || '',
          preferredModel,
          language,
          {
            signal: composeAbortSignals(
              paidJobAbortSignal(transcriptionId, { organizationId: orgId, userId }),
              budgetSignal,
            ),
          },
        )
        : analyzeTranscription(
          text,
          resolvedTemplate,
          activeChat.apiKey,
          job.custom_prompt || '',
          preferredModel,
          language,
          {
            baseUrl: activeChat.baseUrl,
            fallbackModel: activeChat.defaultModels.chat,
            organizationId: orgId,
            signal: composeAbortSignals(
              paidJobAbortSignal(transcriptionId, { organizationId: orgId, userId }),
              budgetSignal,
            ),
          },
        )),
    );
    await assertTranscriptionPaidWorkActive(transcriptionId);
    analysis = analysisValue;
  } catch (error) {
    if (error?.code === 'BUDGET_EXCEEDED') {
      await errJob({
        message: error.message,
        eventMessage: 'Analyse wegen erreichtem Kostenlimit gestoppt.',
      });
      return 'error';
    }
    if (error?.code === 'BUDGET_ACCOUNTING_UNAVAILABLE' || error?.code === 'PRICING_CONFIGURATION_MISSING') {
      await errJob({
        message: error.message,
        eventMessage: 'Analyse pausiert: Kostenlimit-Prüfung aktuell nicht verfügbar.',
      });
      return 'error';
    }
    throw error;
  }

  if (isTableTemplate && tableSchema) {
    const tableAnalysis = normalizeAndValidateTableAnalysis(analysis, tableSchema);

    await query(
      `UPDATE transcriptions
       SET status = 'completed',
           analysis = $1,
           analysis_type = 'table',
           analysis_meta = $2,
           table_schema = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [
        JSON.stringify({ metadata: tableAnalysis.metadata, rows: tableAnalysis.rows }),
        JSON.stringify({
          missing_fields_by_row: tableAnalysis.missing_fields_by_row,
          missing_metadata_fields: tableAnalysis.missing_metadata_fields,
          unvollstaendige_daten: tableAnalysis.unvollstaendige_daten,
          extrahierte_zeilen_anzahl: tableAnalysis.extrahierte_zeilen_anzahl,
          zusammenfassung: tableAnalysis.zusammenfassung,
        }),
        tableSchema,
        transcriptionId,
      ]
    );
    await ev({
      stage: 'completed',
      message: `Tabellen-Analyse abgeschlossen. ${tableAnalysis?.rows?.length || 0} Zeilen extrahiert.`,
    });
    await upsertDocumentFromTranscription(transcriptionId, orgId);
    return 'completed';
  }

  if (isBuiltinDataTableTemplate) {
    const tableAnalysis = normalizeDataTableAnalysis(analysis, language);

    await query(
      `UPDATE transcriptions
       SET status = 'completed',
           analysis = $1,
           analysis_type = 'table',
           analysis_meta = $2,
           table_schema = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [
        JSON.stringify({ rows: tableAnalysis.rows }),
        JSON.stringify(tableAnalysis.meta),
        tableAnalysis.schema,
        transcriptionId,
      ]
    );
    await ev({
      stage: 'completed',
      message: `Datentabelle abgeschlossen. ${tableAnalysis?.rows?.length || 0} Zeilen extrahiert.`,
    });
    await upsertDocumentFromTranscription(transcriptionId, orgId);
    return 'completed';
  }

  await query(
    `UPDATE transcriptions
     SET status = 'completed',
         analysis = $1,
         analysis_type = 'text',
         analysis_meta = NULL,
         table_schema = NULL,
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(analysis), transcriptionId]
  );
  await ev({
    stage: 'completed',
    message: 'KI-Analyse abgeschlossen.',
  });
  await upsertDocumentFromTranscription(transcriptionId, orgId);
  return 'completed';
}

async function claimQueuedJob(transcriptionId, userId) {
  const result = await query(
    `UPDATE transcriptions
     SET status = 'processing',
         error = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
        AND status = 'queued'
        AND budget_stop_state = 'none'
     RETURNING id, user_id, organization_id, file_path, template, diarize, custom_prompt, auto_analyze`,
    [transcriptionId, userId]
  );
  return result.rows[0] || null;
}

async function processQueuedJob(key) {
  const { transcriptionId, userId } = parseKey(key);
  if (!Number.isFinite(transcriptionId) || !Number.isFinite(userId)) return;

  const claimedJob = await claimQueuedJob(transcriptionId, userId);
  if (!claimedJob) return;
  trackJobStarted();

  const orgId = claimedJob.organization_id ?? null;

  await addTranscriptionEvent({
    transcriptionId,
    userId,
    organizationId: orgId,
    stage: 'processing',
    message: 'Transkription gestartet.',
  });

  try {
    const outcome = await processClaimedJob(claimedJob);
    if (outcome === 'error') {
      trackJobFailed('domain_error');
      return;
    }
    trackJobCompleted();
  } catch (error) {
    logApiError(`Transcription worker ${transcriptionId} failed`, error);
    trackJobFailed(error?.message || 'unknown_error');
    const failure = mapWorkerFailure(error);
    await markJobError({
      transcriptionId,
      organizationId: orgId,
      userId,
      message: failure.message,
      eventMessage: failure.eventMessage,
    });
    if (error?.code === 'MODEL_UNAVAILABLE') {
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'org.integration.openrouter.model_unavailable',
        targetType: 'transcription',
        targetId: String(transcriptionId),
        severity: 'warn',
        metadata: { message: String(error.message || '') },
      });
    }
  }
}

async function enqueueQueuedJobsFromDb() {
  const { scanBatch } = getWorkerConfig();
  const result = await query(
    `SELECT id, user_id
     FROM transcriptions
     WHERE status = 'queued'
       AND budget_stop_state = 'none'
     ORDER BY updated_at ASC
    LIMIT $1`,
    [scanBatch]
  );
  trackWorkerScan(result.rows.length);
  if (result.rows.length > 0) {
    logInfo('worker.scan_found_jobs', { count: result.rows.length });
  }
  result.rows.forEach((row) => {
    queueTranscriptionJob({
      transcriptionId: row.id,
      userId: row.user_id,
    });
  });
}

async function runWorkerScan(logScope = 'scan') {
  const state = getWorkerState();
  if (state.scanRunning) return;
  state.scanRunning = true;
  try {
    await enqueueQueuedJobsFromDb();
  } catch (error) {
    logApiError(`Transcription worker ${logScope} failed`, error);
  } finally {
    state.scanRunning = false;
  }
}

async function runQueuePump() {
  const state = getWorkerState();
  if (state.pumpRunning) return;
  state.pumpRunning = true;
  updateWorkerMetrics({
    queueDepth: state.queue.length,
    activeJobs: state.activeCount,
  });

  try {
    const { concurrency } = getWorkerConfig();
    while (state.activeCount < concurrency && state.queue.length > 0) {
      const key = state.queue.shift();
      state.queuedKeys.delete(key);
      state.activeCount += 1;
      updateWorkerMetrics({
        queueDepth: state.queue.length,
        activeJobs: state.activeCount,
      });

      Promise.resolve()
        .then(() => processQueuedJob(key))
        .catch((error) => {
          logApiError('Transcription queue pump', error);
        })
        .finally(() => {
          state.activeCount = Math.max(0, state.activeCount - 1);
          updateWorkerMetrics({
            queueDepth: state.queue.length,
            activeJobs: state.activeCount,
          });
          queueMicrotask(() => {
            void runQueuePump();
          });
        });
    }
  } finally {
    state.pumpRunning = false;
    updateWorkerMetrics({
      queueDepth: state.queue.length,
      activeJobs: state.activeCount,
    });
  }
}

export function queueTranscriptionJob({ transcriptionId, userId }) {
  const state = getWorkerState();
  const key = toKey(Number(transcriptionId), Number(userId));
  if (state.queuedKeys.has(key)) return;
  state.queuedKeys.add(key);
  state.queue.push(key);
  trackJobQueued();
  updateWorkerMetrics({
    queueDepth: state.queue.length,
    activeJobs: state.activeCount,
  });
  queueMicrotask(() => {
    void runQueuePump();
  });
}

export function ensureTranscriptionWorkerRunning() {
  const state = getWorkerState();
  if (state.started) return;
  state.started = true;

  const { scanIntervalMs, concurrency } = getWorkerConfig();
  updateWorkerMetrics({
    running: true,
    scanIntervalMs,
    concurrency,
    queueDepth: state.queue.length,
    activeJobs: state.activeCount,
  });
  logInfo('worker.started', { scanIntervalMs, concurrency });

  state.scanTimer = setInterval(() => {
    void runWorkerScan('scan');
  }, scanIntervalMs);

  void runWorkerScan('bootstrap');
}

import { query } from './db';
import { transcribeAudio, analyzeTranscription } from './ai-service';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  logUsage,
  checkCostLimit,
  withUserCostLock,
} from './usage';
import { resolveChatModel } from './model-policy';
import { getSettingsRow, resolveStoredApiKey } from './settings-service';
import { addTranscriptionEvent } from './transcription-events';
import { resolveTemplate } from './template-service';
import { logApiError } from './api-utils';
import { normalizeAndValidateTableAnalysis } from './table-analysis';
import { normalizeDataTableAnalysis } from './data-table';
import {
  logInfo,
  trackJobCompleted,
  trackJobFailed,
  trackJobQueued,
  trackJobStarted,
  trackWorkerScan,
  updateWorkerMetrics,
} from './observability';

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

function parseContextBias(value) {
  if (!value || typeof value !== 'string') return [];

  const parts = value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const seen = new Set();
  const unique = [];
  for (const part of parts) {
    const key = part.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }
  return unique;
}

function mapWorkerFailure(error) {
  const message = String(error?.message || '');
  const normalized = message.toLowerCase();

  if (
    normalized.includes('mistral')
    && (normalized.includes('401') || normalized.includes('unauthorized'))
  ) {
    return {
      message: 'Mistral API-Key ungültig oder abgelaufen. Bitte in den Einstellungen aktualisieren.',
      eventMessage: 'Verarbeitung gestoppt: Mistral API-Key ungültig.',
    };
  }

  if (
    normalized.includes('mistral')
    && (normalized.includes('429') || normalized.includes('rate limit'))
  ) {
    return {
      message: 'Mistral API-Limit erreicht. Bitte später erneut versuchen.',
      eventMessage: 'Verarbeitung pausiert: Mistral API-Limit erreicht.',
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

async function markJobError({ transcriptionId, userId, message, eventMessage }) {
  await query(
    "UPDATE transcriptions SET status = 'error', error = $1, updated_at = NOW() WHERE id = $2",
    [message, transcriptionId]
  );
  await addTranscriptionEvent({
    transcriptionId,
    userId,
    stage: 'error',
    message: eventMessage || message,
  });
}

async function processClaimedJob(job) {
  const transcriptionId = Number(job.id);
  const userId = Number(job.user_id);
  const settingsRow = await getSettingsRow(userId);
  const apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;
  const preferredModel = resolveChatModel(settingsRow?.preferred_model) || null;
  const language = settingsRow?.language || 'de';
  const contextBias = parseContextBias(settingsRow?.context_bias);

  if (!apiKey) {
    await markJobError({
      transcriptionId,
      userId,
      message: 'Kein Mistral API-Key konfiguriert. Bitte in den Einstellungen hinterlegen.',
      eventMessage: 'Verarbeitung konnte ohne API-Key nicht gestartet werden.',
    });
    return 'error';
  }

  let text = '';
  let segments = [];
  try {
    const transcriptionResult = await withUserCostLock(userId, async () => {
      const costCheck = await checkCostLimit(userId);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }

      const result = await transcribeAudio(job.file_path, apiKey, {
        diarize: job.diarize,
        contextBias,
        language,
      });
      await logUsage(userId, result.model, 'transcription', result.usage);
      return result;
    });

    text = transcriptionResult.text;
    segments = transcriptionResult.segments;
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED') {
      await markJobError({
        transcriptionId,
        userId,
        message: error.message,
        eventMessage: 'Verarbeitung wegen erreichtem Kostenlimit gestoppt.',
      });
      return 'error';
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      await markJobError({
        transcriptionId,
        userId,
        message: error.message,
        eventMessage: 'Verarbeitung pausiert: Kostenlimit-Prüfung aktuell nicht verfügbar.',
      });
      return 'error';
    }
    throw error;
  }

  await addTranscriptionEvent({
    transcriptionId,
    userId,
    stage: 'processing',
    message: 'Audio erfolgreich transkribiert.',
  });

  if (job.diarize && segments.length > 0) {
    await query(
      "UPDATE transcriptions SET status = 'transcribed', text = $1, segments = $2, updated_at = NOW() WHERE id = $3",
      [text, JSON.stringify(segments), transcriptionId]
    );
    await addTranscriptionEvent({
      transcriptionId,
      userId,
      stage: 'speaker_assignment',
      message: 'Sprecherzuweisung erforderlich.',
    });
    return 'completed';
  }

  if (!job.auto_analyze) {
    await query(
      "UPDATE transcriptions SET status = 'transcribed', text = $1, updated_at = NOW() WHERE id = $2",
      [text, transcriptionId]
    );
    await addTranscriptionEvent({
      transcriptionId,
      userId,
      stage: 'completed',
      message: 'Transkription abgeschlossen.',
    });
    return 'completed';
  }

  await query(
    "UPDATE transcriptions SET status = 'analyzing', text = $1, updated_at = NOW() WHERE id = $2",
    [text, transcriptionId]
  );
  await addTranscriptionEvent({
    transcriptionId,
    userId,
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

    analysis = await withUserCostLock(userId, async () => {
      const costCheck = await checkCostLimit(userId);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }

      const { analysis, usage: analysisUsage, model: analysisModel } = await analyzeTranscription(
        text,
        resolvedTemplate,
        apiKey,
        job.custom_prompt || '',
        preferredModel,
        language
      );

      await logUsage(userId, analysisModel, 'analysis', analysisUsage);
      return analysis;
    });
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED') {
      await markJobError({
        transcriptionId,
        userId,
        message: error.message,
        eventMessage: 'Analyse wegen erreichtem Kostenlimit gestoppt.',
      });
      return 'error';
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      await markJobError({
        transcriptionId,
        userId,
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
    await addTranscriptionEvent({
      transcriptionId,
      userId,
      stage: 'completed',
      message: `Tabellen-Analyse abgeschlossen. ${tableAnalysis?.rows?.length || 0} Zeilen extrahiert.`,
    });
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
    await addTranscriptionEvent({
      transcriptionId,
      userId,
      stage: 'completed',
      message: `Datentabelle abgeschlossen. ${tableAnalysis?.rows?.length || 0} Zeilen extrahiert.`,
    });
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
  await addTranscriptionEvent({
    transcriptionId,
    userId,
    stage: 'completed',
    message: 'KI-Analyse abgeschlossen.',
  });
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
     RETURNING id, user_id, file_path, template, diarize, custom_prompt, auto_analyze`,
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

  await addTranscriptionEvent({
    transcriptionId,
    userId,
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
      userId,
      message: failure.message,
      eventMessage: failure.eventMessage,
    });
  }
}

async function enqueueQueuedJobsFromDb() {
  const { scanBatch } = getWorkerConfig();
  const result = await query(
    `SELECT id, user_id
     FROM transcriptions
     WHERE status = 'queued'
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

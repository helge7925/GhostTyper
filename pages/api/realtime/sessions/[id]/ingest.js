import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]';
import { enforceRateLimit, logApiError, serverError } from '../../../../../lib/api-utils';
import { MAX_REALTIME_AUDIO_CHUNK_BYTES, MAX_REALTIME_TEXT_CHUNK_LENGTH } from '../../../../../lib/constants';
import { transcribeAudioBuffer } from '../../../../../lib/ai-service';
import { ingestRealtimeChunk } from '../../../../../lib/realtime-service';
import { getSettingsRow, resolveStoredApiKey } from '../../../../../lib/settings-service';
import {
  CostLimitCheckUnavailableError,
  checkCostLimit,
  CostLimitExceededError,
  enforceProjectedBudgetGuardrail,
  estimateCost,
  logUsage,
} from '../../../../../lib/usage';

function parseSessionId(rawId) {
  const parsed = Number.parseInt(rawId, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseContextBias(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return [];
  const parts = rawValue
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

function decodeBase64Payload(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim();
  const match = value.match(/^data:([a-zA-Z0-9/+\-.]+);base64,(.+)$/);
  if (match) {
    return {
      mimeType: match[1],
      buffer: Buffer.from(match[2], 'base64'),
    };
  }
  return {
    mimeType: null,
    buffer: Buffer.from(value, 'base64'),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const sessionId = parseSessionId(req.query.id);
  if (!sessionId) {
    return res.status(400).json({ message: 'Ungültige Session-ID' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'realtime-session-ingest',
    identifier: `user:${session.user.id}`,
    limit: 240,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const { text, audioBase64, mimeType, language } = req.body || {};
    let chunkText = typeof text === 'string' ? text.trim() : '';
    let usage = null;
    let source = 'text';

    if (!chunkText && audioBase64) {
      const decoded = decodeBase64Payload(audioBase64);
      if (!decoded?.buffer || decoded.buffer.length === 0) {
        return res.status(400).json({ message: 'Audio-Chunk konnte nicht dekodiert werden' });
      }
      if (decoded.buffer.length > MAX_REALTIME_AUDIO_CHUNK_BYTES) {
        return res.status(413).json({ message: `Audio-Chunk ist zu groß (max. ${MAX_REALTIME_AUDIO_CHUNK_BYTES} Bytes)` });
      }

      const settings = await getSettingsRow(session.user.id);
      const apiKey = resolveStoredApiKey(settings) || process.env.MISTRAL_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
      }

      const costCheck = await checkCostLimit(session.user.id);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }
      // Conservative estimate for one realtime chunk transcription request.
      await enforceProjectedBudgetGuardrail(
        session.user.id,
        estimateCost('voxtral-mini-latest', 0, 450)
      );

      const contextBias = parseContextBias(settings?.context_bias || '');
      const transcription = await transcribeAudioBuffer(decoded.buffer, apiKey, {
        mimeType: mimeType || decoded.mimeType || 'audio/webm',
        language: language || settings?.language || 'de',
        contextBias,
      });

      chunkText = String(transcription.text || '').trim();
      usage = transcription.usage || null;
      source = 'audio';
      await logUsage(session.user.id, transcription.model, 'realtime_transcription', transcription.usage);
    }

    if (!chunkText) {
      return res.status(400).json({ message: 'Kein Text oder Audio-Chunk vorhanden' });
    }
    if (chunkText.length > MAX_REALTIME_TEXT_CHUNK_LENGTH) {
      return res.status(400).json({ message: `Text-Chunk ist zu lang (max. ${MAX_REALTIME_TEXT_CHUNK_LENGTH} Zeichen)` });
    }

    const snapshot = await ingestRealtimeChunk({
      sessionId,
      userId: session.user.id,
      chunkText,
      transcriptSource: source,
      usage,
    });

    return res.status(200).json({
      chunkText,
      source,
      snapshot,
    });
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    if (error?.message === 'EMPTY_CHUNK') {
      return res.status(400).json({ message: 'Leerer Chunk' });
    }
    if (error?.message === 'FORBIDDEN') {
      return res.status(403).json({ message: 'Keine Berechtigung für diese Session' });
    }
    if (error?.message === 'READ_ONLY') {
      return res.status(403).json({ message: 'Session ist nur lesbar' });
    }
    if (error?.message === 'SESSION_COMPLETED') {
      return res.status(400).json({ message: 'Session ist bereits abgeschlossen' });
    }
    logApiError('Realtime ingest API error', error);
    return serverError(res, 'Realtime-Chunk konnte nicht verarbeitet werden');
  }
}

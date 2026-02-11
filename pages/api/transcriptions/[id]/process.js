import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query, resolveTemplate } from '../../../../lib/db';
import { transcribeAudio, analyzeTranscription } from '../../../../lib/ai-service';
import { logUsage, checkCostLimit } from '../../../../lib/usage';
import { resolveChatModel } from '../../../../lib/model-policy';
import { getSettingsRow, resolveStoredApiKey } from '../../../../lib/settings-service';
import { checkRateLimit, applyRateLimitHeaders } from '../../../../lib/rate-limit';
import { logApiError } from '../../../../lib/api-utils';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const rate = checkRateLimit(req, {
    keyPrefix: 'transcription-process',
    identifier: `user:${session.user.id}`,
    limit: 30,
    windowMs: 60_000,
  });
  applyRateLimitHeaders(res, rate);
  if (!rate.allowed) {
    return res.status(429).json({ message: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }

  const { id } = req.query;
  let job;
  let apiKey;
  let preferredModel;
  let language;
  let contextBias;

  try {
    const transcription = await query(
      'SELECT id, file_path, template, diarize, custom_prompt, auto_analyze, status FROM transcriptions WHERE id = $1 AND user_id = $2',
      [id, session.user.id]
    );

    if (transcription.rows.length === 0) {
      return res.status(404).json({ message: 'Transkription nicht gefunden' });
    }

    job = transcription.rows[0];

    if (job.status !== 'pending') {
      if (job.status === 'processing' || job.status === 'analyzing') {
        return res.status(202).json({
          message: 'Verarbeitung läuft bereits.',
          status: job.status,
        });
      }
      if (job.status === 'transcribed' || job.status === 'completed') {
        return res.status(200).json({
          message: 'Verarbeitung ist bereits abgeschlossen.',
          status: job.status,
        });
      }
      return res.status(400).json({ message: `Transkription hat Status "${job.status}" und kann nicht erneut gestartet werden` });
    }

    const settingsRow = await getSettingsRow(session.user.id);
    apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;
    preferredModel = resolveChatModel(settingsRow?.preferred_model) || null;
    language = settingsRow?.language || 'de';
    contextBias = settingsRow?.context_bias
      ? settingsRow.context_bias.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert. Bitte in den Einstellungen hinterlegen.' });
    }

    // Check cost limit
    const costCheck = await checkCostLimit(session.user.id);
    if (!costCheck.allowed) {
      return res.status(429).json({
        message: `Monatliches Kostenlimit erreicht (${costCheck.currentCost.toFixed(2)} / ${costCheck.limit.toFixed(2)} EUR)`,
      });
    }

    // Atomically lock this job transition and prevent duplicate starts.
    const lockResult = await query(
      "UPDATE transcriptions SET status = 'processing', updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id",
      [id, session.user.id]
    );
    if (lockResult.rowCount === 0) {
      const latestResult = await query(
        'SELECT status FROM transcriptions WHERE id = $1 AND user_id = $2',
        [id, session.user.id]
      );
      const latestStatus = latestResult.rows[0]?.status;
      if (latestStatus === 'processing' || latestStatus === 'analyzing') {
        return res.status(202).json({
          message: 'Verarbeitung läuft bereits.',
          status: latestStatus,
        });
      }
      return res.status(409).json({ message: 'Transkription wurde bereits gestartet oder hat den Status geändert.' });
    }

    // Start processing (non-blocking response)
    await addTranscriptionEvent({
      transcriptionId: Number(id),
      userId: session.user.id,
      stage: 'processing',
      message: 'Transkription gestartet.',
    });
    res.status(202).json({ message: 'Transkription gestartet', status: 'processing' });
  } catch (error) {
    logApiError(`Transcription ${id} preflight failed`, error);
    if (error?.code === '42703') {
      return res.status(500).json({ message: 'Datenbank-Schema ist veraltet. Bitte DB-Init ausführen.' });
    }
    return res.status(500).json({ message: 'Verarbeitung konnte nicht gestartet werden.' });
  }

  // Process in background
  try {
    const { text, segments, usage: transcriptionUsage, model: transcriptionModel } = await transcribeAudio(job.file_path, apiKey, {
      diarize: job.diarize,
      contextBias,
      language,
    });
    await addTranscriptionEvent({
      transcriptionId: Number(id),
      userId: session.user.id,
      stage: 'processing',
      message: 'Audio erfolgreich transkribiert.',
    });

    // Log transcription usage
    await logUsage(session.user.id, transcriptionModel, 'transcription', transcriptionUsage);

    if (job.diarize && segments.length > 0) {
      // Two-step workflow: stop at 'transcribed' so user can assign speaker names
      await query(
        "UPDATE transcriptions SET status = 'transcribed', text = $1, segments = $2, updated_at = NOW() WHERE id = $3",
        [text, JSON.stringify(segments), id]
      );
      await addTranscriptionEvent({
        transcriptionId: Number(id),
        userId: session.user.id,
        stage: 'speaker_assignment',
        message: 'Sprecherzuweisung erforderlich.',
      });
    } else if (!job.auto_analyze) {
      // Transcription-only mode: stop at 'transcribed' without analysis
      await query(
        "UPDATE transcriptions SET status = 'transcribed', text = $1, updated_at = NOW() WHERE id = $2",
        [text, id]
      );
      await addTranscriptionEvent({
        transcriptionId: Number(id),
        userId: session.user.id,
        stage: 'completed',
        message: 'Transkription abgeschlossen.',
      });
    } else {
      // Auto-analyze: go straight to analysis
      await query(
        "UPDATE transcriptions SET status = 'analyzing', text = $1, updated_at = NOW() WHERE id = $2",
        [text, id]
      );
      await addTranscriptionEvent({
        transcriptionId: Number(id),
        userId: session.user.id,
        stage: 'analyzing',
        message: 'KI-Analyse gestartet.',
      });

      const resolvedTemplate = await resolveTemplate(job.template, session.user.id);
      const { analysis, usage: analysisUsage, model: analysisModel } = await analyzeTranscription(text, resolvedTemplate, apiKey, job.custom_prompt || '', preferredModel, language);

      // Log analysis usage
      await logUsage(session.user.id, analysisModel, 'analysis', analysisUsage);

      await query(
        "UPDATE transcriptions SET status = 'completed', analysis = $1, updated_at = NOW() WHERE id = $2",
        [JSON.stringify(analysis), id]
      );
      await addTranscriptionEvent({
        transcriptionId: Number(id),
        userId: session.user.id,
        stage: 'completed',
        message: 'KI-Analyse abgeschlossen.',
      });
    }
  } catch (error) {
    logApiError(`Transcription ${id} failed`, error);
    await query(
      "UPDATE transcriptions SET status = 'error', error = $1, updated_at = NOW() WHERE id = $2",
      ['Transkription fehlgeschlagen. Bitte erneut versuchen.', id]
    );
    await addTranscriptionEvent({
      transcriptionId: Number(id),
      userId: session.user.id,
      stage: 'error',
      message: 'Fehler bei der Transkription/Analyse.',
    });
  }
}

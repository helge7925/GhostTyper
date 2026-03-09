import { query } from './db';
import { getSettingsRow, resolveStoredApiKey } from './settings-service';
import { updateKnowledgeGraph, buildLiveDocumentMarkdown } from './realtime-knowledge';
import { resolveChatModel } from './model-policy';
import { resolveTemplate } from './template-service';
import { getPrompt } from './prompts';
import { fetchWithTimeout, logApiError } from './api-utils';
import { logUsage } from './usage';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1';
const BUILTIN_TEMPLATE_IDS = new Set(['generic', 'meeting', 'aufmass', 'knowledge_graph', 'mindmap']);

async function createAiFinalDocument({
  transcriptText,
  title,
  language,
  model,
  apiKey,
  templateLabel,
  templateInstruction,
}) {
  const response = await fetchWithTimeout(`${MISTRAL_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: language === 'en'
            ? 'Create a precise final markdown report from a realtime transcript. No filler. Follow the selected document template.'
            : 'Erstelle aus einem Live-Transkript eine präzise finale Markdown-Dokumentation ohne Floskeln. Folge der gewählten Dokumentvorlage.',
        },
        {
          role: 'user',
          content: [
            `Titel: ${title || 'Live-Session'}`,
            '',
            `Vorlage: ${templateLabel || 'generic'}`,
            '',
            'Vorlagenanweisung:',
            templateInstruction || (language === 'en'
              ? 'Create a concise final summary with key points, decisions, tasks, and next steps.'
              : 'Erstelle eine prägnante finale Zusammenfassung mit Kernpunkten, Entscheidungen, Aufgaben und nächsten Schritten.'),
            '',
            'Formatregeln:',
            '- Ausgabe als Markdown.',
            '- Keine JSON-Ausgabe.',
            '- Nur relevante Fakten, keine Floskeln.',
            '',
            'Quelle:',
            transcriptText,
          ].join('\n'),
        },
      ],
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || `AI finalization error: ${response.status}`);
  }

  const payload = await response.json();
  return {
    text: payload.choices?.[0]?.message?.content || '',
    usage: payload.usage || {},
  };
}

function resolveTemplateInstruction(template, language) {
  if (!template) return getPrompt('generic', language);
  if (template.id === null && BUILTIN_TEMPLATE_IDS.has(template.name)) {
    return getPrompt(template.name, language);
  }
  if (template.prompt_text && typeof template.prompt_text === 'string') {
    return template.prompt_text.trim();
  }
  return getPrompt('generic', language);
}

export async function runRealtimeFinalization({ sessionId, userId }) {
  let claimed = false;
  try {
    const claimResult = await query(
      `UPDATE realtime_sessions s
       SET finalization_state = 'running',
           finalization_error = NULL,
           updated_at = NOW()
       FROM realtime_session_members m
       WHERE s.id = $1
         AND m.session_id = s.id
         AND m.user_id = $2
         AND s.status = 'completed'
         AND COALESCE(s.finalization_state, 'idle') IN ('idle', 'failed')
       RETURNING s.id, s.title, s.language, s.model, s.document_template, s.status, s.transcript_text, s.graph_json`,
      [sessionId, userId]
    );
    if (claimResult.rowCount === 0) {
      return false;
    }
    claimed = true;
    const session = claimResult.rows[0];
    const transcriptText = String(session.transcript_text || '').trim();
    if (!transcriptText) {
      await query(
        `UPDATE realtime_sessions
         SET finalization_state = 'done',
             finalized_at = NOW(),
             finalization_error = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [sessionId]
      );
      return true;
    }

    // Rebuild graph once from full transcript for consistency.
    const finalizedGraph = updateKnowledgeGraph({ nodes: [], edges: [] }, transcriptText);
    const heuristicDocument = buildLiveDocumentMarkdown({
      title: session.title,
      template: session.document_template || 'generic',
      transcript: transcriptText,
      graph: finalizedGraph,
    });

    let finalDocument = heuristicDocument;
    const settings = await getSettingsRow(userId);
    const apiKey = resolveStoredApiKey(settings) || process.env.MISTRAL_API_KEY;
    const model = resolveChatModel(session.model || settings?.preferred_model || 'mistral-small-latest')
      || 'mistral-small-latest';
    const language = session.language || settings?.language || 'de';
    const resolvedTemplate = await resolveTemplate(session.document_template || 'generic', userId);
    const templateInstruction = resolveTemplateInstruction(resolvedTemplate, language);
    const templateLabel = resolvedTemplate?.name || session.document_template || 'generic';

    if (apiKey) {
      try {
        const aiResult = await createAiFinalDocument({
          transcriptText,
          title: session.title,
          language,
          model,
          apiKey,
          templateLabel,
          templateInstruction,
        });
        if (aiResult.text.trim()) {
          finalDocument = aiResult.text.trim();
        }
        await logUsage(userId, model, 'realtime_finalize', aiResult.usage);
      } catch (error) {
        logApiError('Realtime finalization AI fallback', error, { sessionId, userId });
      }
    }

    await query(
      `UPDATE realtime_sessions
       SET document_markdown = $1,
           graph_json = $2::jsonb,
           finalization_state = 'done',
           finalization_error = NULL,
           finalized_at = NOW(),
           updated_at = NOW()
       WHERE id = $3`,
      [finalDocument, JSON.stringify(finalizedGraph), sessionId]
    );

    await query(
      `INSERT INTO realtime_session_events (session_id, user_id, event_type, payload)
       VALUES ($1, $2, 'finalized', $3::jsonb)`,
      [
        sessionId,
        userId,
        JSON.stringify({
          status: 'done',
          transcriptLength: transcriptText.length,
        }),
      ]
    );

    return true;
  } catch (error) {
    if (claimed) {
      await query(
        `UPDATE realtime_sessions
         SET finalization_state = 'failed',
             finalization_error = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [sessionId, String(error?.message || 'Finalisierung fehlgeschlagen').slice(0, 2000)]
      ).catch(() => {});
    }

    logApiError('Realtime finalization failed', error, { sessionId, userId });
    return false;
  }
}

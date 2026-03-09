import { GoogleGenAI } from '@google/genai';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { MAX_TEXT_AI_INPUT_LENGTH } from '../../lib/constants';
import { enforceRateLimit, logApiError } from '../../lib/api-utils';
import { getSettingsRow, resolveStoredGoogleApiKey } from '../../lib/settings-service';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  checkCostLimit,
  logUsage,
  withUserCostLock,
} from '../../lib/usage';
import {
  applyIllustrationPlan,
  buildIllustrationPrompt,
  buildHeuristicStructure,
  buildStructurePrompt,
  normalizeDetailLevel,
  normalizeIllustrationStyle,
  normalizeLayoutMode,
  parseAndNormalizeStructure,
  renderInfographicSvg,
} from '../../lib/infographic-engine';

const GEMINI_STRUCTURE_MODEL = process.env.GEMINI_STRUCTURE_MODEL || 'gemini-2.5-flash';
const GEMINI_ILLUSTRATION_MODEL = process.env.GEMINI_ILLUSTRATION_MODEL || 'gemini-2.5-flash';
const FALLBACK_IMAGE_MIME_TYPE = 'image/svg+xml';
const MAX_SKETCH_FOCUS_LENGTH = 400;

function normalizeGeminiUsage(usageMetadata, text) {
  const fallbackInput = Math.max(1, Math.ceil(String(text || '').length / 4));
  const promptTokens = Number.parseInt(usageMetadata?.promptTokenCount, 10);
  const outputTokens = Number.parseInt(usageMetadata?.candidatesTokenCount, 10);

  return {
    input_tokens: Number.isFinite(promptTokens) && promptTokens > 0 ? promptTokens : fallbackInput,
    output_tokens: Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 800,
  };
}

function extractTextPayload(response) {
  if (typeof response?.text === 'string' && response.text.trim()) {
    return response.text.trim();
  }

  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const textParts = [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const value = typeof part?.text === 'string' ? part.text.trim() : '';
      if (value) textParts.push(value);
    }
  }

  return textParts.join('\n').trim();
}

function createSvgPayload(structure, options = {}) {
  const svgMarkup = renderInfographicSvg(structure, {
    text: options.text || '',
    focus: options.focus || '',
    detailLevel: options.detailLevel || 'standard',
    illustrationStyle: options.illustrationStyle || 'editorial',
  });

  return {
    imageBase64: Buffer.from(svgMarkup, 'utf8').toString('base64'),
    mimeType: FALLBACK_IMAGE_MIME_TYPE,
    fallback: Boolean(options.fallback),
    notice: options.notice || '',
    layout: structure?.layout || 'auto',
    illustrationStyle: options.illustrationStyle || 'editorial',
    blocks: Array.isArray(structure?.blocks) ? structure.blocks.length : 0,
    illustrations: Array.isArray(structure?.blocks)
      ? structure.blocks.filter((block) => block?.illustration?.icon).length
      : 0,
  };
}

function createHeuristicPayload(text, options = {}, reason = '') {
  const baseStructure = buildHeuristicStructure(text, options);
  const structure = applyIllustrationPlan(baseStructure, '', options);
  return createSvgPayload(structure, {
    ...options,
    fallback: true,
    notice: reason
      ? `${reason} Es wurde eine lokale Layout-Engine verwendet.`
      : 'Es wurde eine lokale Layout-Engine verwendet.',
  });
}

function classifyGeminiError(error) {
  const message = String(error?.message || '').toLowerCase();

  if (
    message.includes('api key')
    || message.includes('unauth')
    || message.includes('permission')
    || message.includes('forbidden')
  ) {
    return 'Google API-Key ungültig oder ohne Berechtigung.';
  }

  if (
    message.includes('quota')
    || message.includes('resource exhausted')
    || message.includes('rate limit')
    || message.includes('429')
  ) {
    return 'Gemini-Kontingent erreicht. Bitte später erneut versuchen.';
  }

  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'sketch-summary',
    identifier: `user:${session.user.id}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const text = String(req.body?.text || '').trim();
  const layoutMode = normalizeLayoutMode(req.body?.layoutMode);
  const detailLevel = normalizeDetailLevel(req.body?.detailLevel);
  const illustrationStyle = normalizeIllustrationStyle(req.body?.illustrationStyle);
  const focus = String(req.body?.focus || '').trim();

  if (!text) {
    return res.status(400).json({ message: 'Text ist erforderlich.' });
  }
  if (text.length > MAX_TEXT_AI_INPUT_LENGTH) {
    return res.status(400).json({ message: `Text ist zu lang (max. ${MAX_TEXT_AI_INPUT_LENGTH} Zeichen)` });
  }
  if (focus.length > MAX_SKETCH_FOCUS_LENGTH) {
    return res.status(400).json({ message: `Fokus ist zu lang (max. ${MAX_SKETCH_FOCUS_LENGTH} Zeichen)` });
  }

  const sketchOptions = {
    text,
    focus,
    layoutMode,
    detailLevel,
    illustrationStyle,
  };

  try {
    const settingsRow = await getSettingsRow(session.user.id);
    const googleApiKey = resolveStoredGoogleApiKey(settingsRow) || process.env.GEMINI_API_KEY;

    if (!googleApiKey) {
      return res.status(200).json(
        createHeuristicPayload(text, sketchOptions, 'Kein Google API-Key konfiguriert.')
      );
    }

    const ai = new GoogleGenAI({ apiKey: googleApiKey });

    const { structure, notice } = await withUserCostLock(session.user.id, async () => {
      const costCheck = await checkCostLimit(session.user.id);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }

      const response = await ai.models.generateContent({
        model: GEMINI_STRUCTURE_MODEL,
        contents: buildStructurePrompt({
          text,
          layoutMode,
          detailLevel,
          focus,
        }),
        config: {
          responseModalities: ['TEXT'],
        },
      });

      const rawStructureText = extractTextPayload(response);
      if (!rawStructureText) {
        const noTextError = new Error('Gemini response has no text payload');
        noTextError.code = 'NO_TEXT_PAYLOAD';
        throw noTextError;
      }

      await logUsage(
        session.user.id,
        GEMINI_STRUCTURE_MODEL,
        'sketch_summary',
        normalizeGeminiUsage(response?.usageMetadata, text)
      );

      const parsedStructure = parseAndNormalizeStructure(rawStructureText, {
        text,
        layoutMode,
        detailLevel,
        focus,
      });

      let enrichedStructure = applyIllustrationPlan(parsedStructure, '', sketchOptions);
      let noticeText = '';

      try {
        const illustrationResponse = await ai.models.generateContent({
          model: GEMINI_ILLUSTRATION_MODEL,
          contents: buildIllustrationPrompt({
            structure: parsedStructure,
            focus,
            illustrationStyle,
          }),
          config: {
            responseModalities: ['TEXT'],
          },
        });

        const rawIllustrationText = extractTextPayload(illustrationResponse);
        if (!rawIllustrationText) {
          throw new Error('NO_ILLUSTRATION_TEXT');
        }

        enrichedStructure = applyIllustrationPlan(parsedStructure, rawIllustrationText, sketchOptions);
        await logUsage(
          session.user.id,
          GEMINI_ILLUSTRATION_MODEL,
          'sketch_summary',
          normalizeGeminiUsage(illustrationResponse?.usageMetadata, text)
        );
      } catch (illustrationError) {
        noticeText = 'Illustrationen wurden lokal ergänzt.';
      }

      return {
        structure: enrichedStructure,
        notice: noticeText,
      };
    });

    return res.status(200).json(createSvgPayload(structure, {
      ...sketchOptions,
      notice,
    }));
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }

    if (error?.code === 'NO_TEXT_PAYLOAD') {
      return res.status(200).json(
        createHeuristicPayload(text, sketchOptions, 'Das Modell lieferte keine strukturierte Antwort.')
      );
    }

    const geminiMessage = classifyGeminiError(error);
    if (geminiMessage) {
      return res.status(200).json(createHeuristicPayload(text, sketchOptions, geminiMessage));
    }

    logApiError('Sketch summary structure error', error);
    return res.status(200).json(createHeuristicPayload(text, sketchOptions));
  }
}

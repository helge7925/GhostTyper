import { translateText } from '../../lib/ai-service';
import { withOrgScope } from '../../lib/api/with-org-scope';
import {
  CostLimitCheckUnavailableError,
  assertBudgetWithinLimits,
  estimateTextTransformCost,
  logUsage,
} from '../../lib/usage';
import { resolveChatModel } from '../../lib/model-policy';
import { getSettingsRow, resolveCortecsConfig } from '../../lib/settings-service';
import { MAX_TRANSLATE_INPUT_LENGTH } from '../../lib/constants';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';
import { logAuditEvent } from '../../lib/audit-log';
import {
  describeGlossaryApplication,
  getGlossaryForPair,
  lookupTM,
  shouldSkipTMForText,
  storeTM,
  translateTextWithGlossaryGuard,
} from '../../lib/translation-glossary';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'translate',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const { text, targetLanguage, sourceLanguage = 'auto', model: requestModel } = req.body;

  if (!text || !targetLanguage || typeof text !== 'string') {
    return res.status(400).json({ message: 'Text und Zielsprache sind erforderlich' });
  }
  if (text.length > MAX_TRANSLATE_INPUT_LENGTH) {
    return res.status(400).json({ message: `Text ist zu lang (max. ${MAX_TRANSLATE_INPUT_LENGTH} Zeichen)` });
  }

  try {
    const settingsRow = await getSettingsRow(userId);
    const cortecs = await resolveCortecsConfig({ userId, organizationId: req.org?.id });
    const apiKey = cortecs.apiKey;
    const preferredModel = resolveChatModel(requestModel, null)
      || resolveChatModel(settingsRow?.preferred_model, null)
      || cortecs.chatModel;

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
    }
    if (!preferredModel) {
      return res.status(400).json({ message: 'Ungültiges KI-Modell' });
    }

    let glossary = { entries: [], doNotTranslate: [] };
    try {
      glossary = await getGlossaryForPair(orgId, sourceLanguage, targetLanguage, { userId });
    } catch (error) {
      logApiError('Translation glossary lookup error', error);
    }

    try {
      const cachedTranslation = await lookupTM(orgId, sourceLanguage, targetLanguage, text);
      if (cachedTranslation) {
        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'translation.completed',
          targetType: 'translation',
          metadata: {
            targetLanguage,
            sourceLanguage,
            model: preferredModel,
            inputChars: text.length,
            translationMemory: true,
          },
        });
        const cachedMeta = describeGlossaryApplication(glossary, text);
        return res.status(200).json({
          translatedText: cachedTranslation,
          fromTranslationMemory: true,
          glossary: {
            applied: cachedMeta.applied,
            masked: cachedMeta.masked,
            dntViolations: [],
            tmHits: 1,
            retried: false,
          },
        });
      }
    } catch (error) {
      logApiError('Translation memory lookup error', error);
    }

    // Budget gate first (short advisory-lock hold), then the chat call
    // outside the lock so it doesn't pin a pool connection.
    const estimatedCost = estimateTextTransformCost(preferredModel, text, {
      inputBufferTokens: 90,
      outputMultiplier: 1.1,
      outputBufferTokens: 90,
    });
    await assertBudgetWithinLimits(userId, orgId, estimatedCost);

    const guard = await translateTextWithGlossaryGuard({
      text,
      glossary,
      translate: async (maskedText, { glossaryBlock, strict }) => {
        const result = await translateText(
          maskedText,
          targetLanguage,
          sourceLanguage,
          apiKey,
          preferredModel,
          { glossaryBlock, strictPlaceholders: strict, baseUrl: cortecs.baseUrl, preference: cortecs.preference }
        );
        return { translatedText: result.translatedText, usage: result.usage, model: result.model };
      },
    });
    const translatedText = guard.translatedText;

    await logUsage(userId, guard.model || preferredModel, 'translation', guard.usage, orgId);
    // TM leak guard: never cache a translation shaped by a personal glossary
    // entry into the org-wide translation memory.
    if (!shouldSkipTMForText(glossary, text)) {
      try {
        await storeTM(orgId, sourceLanguage, targetLanguage, text, translatedText);
      } catch (error) {
        logApiError('Translation memory store error', error);
      }
    }

    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'translation.completed',
      targetType: 'translation',
      metadata: {
        targetLanguage,
        sourceLanguage,
        model: preferredModel,
        inputChars: text.length,
        glossaryApplied: guard.applied.length,
        dntMasked: guard.masked.length,
        dntViolations: guard.dntViolations.length,
        retried: guard.retried,
      },
    });

    return res.status(200).json({
      translatedText,
      glossary: {
        applied: guard.applied,
        masked: guard.masked,
        dntViolations: guard.dntViolations,
        tmHits: 0,
        retried: guard.retried,
      },
    });
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Translation error', error);
    return serverError(res, 'Fehler bei der Übersetzung');
  }
}

export default withOrgScope(handler);

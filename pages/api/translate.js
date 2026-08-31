import { translateText } from '../../lib/ai-service';
import { withOrgScope } from '../../lib/api/with-org-scope';
import { composeAbortSignals, executeReservedSpend, estimateTextUsage, requestBudgetScope } from '../../lib/budget-runtime';
import { resolveConfiguredModel } from '../../lib/openrouter';
import { getSettingsRow } from '../../lib/settings-service';
import { translateTextEdenAi } from '../../lib/edenai-service';
import { resolveActiveProviderConfig } from '../../lib/ai-provider-router';
import { MAX_TRANSLATE_INPUT_LENGTH } from '../../lib/constants';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';
import { logAuditEvent } from '../../lib/audit-log';
import {
  describeGlossaryApplication,
  getGlossaryForPair,
  lookupTMMatch,
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
    // Translation has no EdenAI-native capability of its own — it routes
    // through `chat` like every other text operation (see lib/edenai.js's
    // EDENAI_HARDCODED_MODEL comment for why the dedicated
    // translation/automatic_translation feature was rejected).
    const active = await resolveActiveProviderConfig({ userId, organizationId: req.org?.id, capability: 'chat' });

    let preferredModel;
    if (active.provider === 'edenai') {
      if (!active.apiKey) {
        return res.status(400).json({ message: 'Kein EdenAI-API-Key konfiguriert' });
      }
      preferredModel = active.model;
    } else {
      preferredModel = resolveConfiguredModel(active, 'chat', requestModel || settingsRow?.preferred_model);
      if (!active.apiKey) {
        return res.status(400).json({ message: 'Kein OpenRouter-API-Key konfiguriert' });
      }
      if (!preferredModel) {
        return res.status(400).json({ message: 'Ungültiges KI-Modell' });
      }
    }

    let glossary = { entries: [], doNotTranslate: [], personalTerms: [] };
    try {
      glossary = await getGlossaryForPair(orgId, sourceLanguage, targetLanguage, { userId });
    } catch (error) {
      logApiError('Translation glossary lookup error', error);
      glossary = {
        entries: [],
        doNotTranslate: [],
        personalTerms: [],
        personalGlossaryUnavailable: true,
      };
    }

    let tmCandidate = null;
    try {
      tmCandidate = await lookupTMMatch(orgId, sourceLanguage, targetLanguage, text, { glossary });
      if (tmCandidate?.autoReusable) {
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
            translationMemoryType: tmCandidate.type,
            translationMemoryScore: tmCandidate.score,
          },
        });
        const cachedMeta = describeGlossaryApplication(glossary, text);
        return res.status(200).json({
          translatedText: tmCandidate.targetText,
          fromTranslationMemory: true,
          translationMemory: { match: tmCandidate, suggestions: [] },
          glossary: {
            applied: cachedMeta.applied,
            masked: cachedMeta.masked,
            dntViolations: [],
            tmHits: 1,
            retried: false,
            translationMemory: { match: tmCandidate, suggestions: [] },
          },
        });
      }
    } catch (error) {
      logApiError('Translation memory lookup error', error);
    }

    const budgetScope = requestBudgetScope(req, 'translation', { text, sourceLanguage, targetLanguage, preferredModel });
    let providerCall = 0;
    const guard = await translateTextWithGlossaryGuard({
      text,
      glossary,
      tmSuggestions: tmCandidate && !tmCandidate.personalGlossaryUnavailableBlocked ? [tmCandidate] : [],
      translate: async (maskedText, { glossaryBlock, strict }) => {
        providerCall += 1;
        const result = await executeReservedSpend(
          {
            idempotencyKey: `${budgetScope}:call:${providerCall}`,
            organizationId: orgId,
            userId,
            operation: 'translation',
            provider: active.provider,
            model: preferredModel,
            estimatedUsage: estimateTextUsage(maskedText, {
              inputBufferTokens: 320,
              outputMultiplier: 1.25,
              outputBufferTokens: 160,
            }),
          },
          (_reservation, budgetSignal) => (active.provider === 'edenai'
            ? translateTextEdenAi(
              maskedText,
              targetLanguage,
              sourceLanguage,
              active.apiKey,
              preferredModel,
              {
                glossaryBlock,
                strictPlaceholders: strict,
                signal: composeAbortSignals(budgetSignal),
              },
            )
            : translateText(
              maskedText,
              targetLanguage,
              sourceLanguage,
              active.apiKey,
              preferredModel,
              {
                glossaryBlock,
                strictPlaceholders: strict,
                baseUrl: active.baseUrl,
                fallbackModel: active.defaultModels.chat,
                organizationId: active.organizationId,
                signal: composeAbortSignals(budgetSignal),
              },
            )),
        );
        return { translatedText: result.translatedText, usage: result.usage, model: result.model };
      },
    });
    const translatedText = guard.translatedText;

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
        provider: active.provider,
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
      fromTranslationMemory: false,
      translationMemory: { match: null, suggestions: tmCandidate ? [tmCandidate] : [] },
      glossary: {
        applied: guard.applied,
        masked: guard.masked,
        dntViolations: guard.dntViolations,
        tmHits: 0,
        retried: guard.retried,
        translationMemory: { match: null, suggestions: tmCandidate ? [tmCandidate] : [] },
      },
    });
  } catch (error) {
    if (error?.code === 'BUDGET_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error?.code === 'BUDGET_ACCOUNTING_UNAVAILABLE' || error?.code === 'PRICING_CONFIGURATION_MISSING') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Translation error', error);
    return serverError(res, 'Fehler bei der Übersetzung');
  }
}

export default withOrgScope({ permission: 'paid.execute' }, handler);

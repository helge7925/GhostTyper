import { createPriceVersion } from './pricing-service';
import { normalizeCataloguePrice } from './openrouter-pricing-core';

const OPERATIONS = Object.freeze({
  chat: ['analysis', 'translation', 'office_translation', 'text_optimization', 'template_generation', 'knowledge_prep', 'live_translation'],
  ocr: ['ocr'],
  transcription: ['transcription'],
  liveTranscription: ['meeting_transcription'],
  tts: ['tts', 'live_tts', 'live_tts_share', 'in_meeting_tts'],
});

async function activePrice(client, model, operation, at) {
  const result = await client.query(
    `SELECT * FROM provider_price_versions
      WHERE provider = 'openrouter' AND model = $1 AND operation = $2
        AND effective_from <= $3::timestamptz
        AND (effective_until IS NULL OR effective_until > $3::timestamptz)
      ORDER BY effective_from DESC LIMIT 1`,
    [model, operation, at],
  );
  return result.rows[0] || null;
}

export async function syncAllowedOpenRouterPrices({ client, config, catalogue, actorUserId, effectiveFrom }) {
  const byId = new Map((catalogue || []).map((model) => [model.id, model]));
  const synchronized = [];
  for (const [capability, operations] of Object.entries(OPERATIONS)) {
    for (const modelId of config.allowedModels?.[capability] || []) {
      const model = byId.get(modelId);
      if (!model) continue;
      const normalized = normalizeCataloguePrice(model, capability);
      for (const operation of operations) {
        // eslint-disable-next-line no-await-in-loop
        const existing = await activePrice(client, modelId, operation, effectiveFrom);
        if (!normalized) {
          if (!existing) {
            const error = new Error(`Für ${modelId}/${operation} ist ein manueller USD-Preis erforderlich.`);
            error.code = 'PRICE_OVERRIDE_REQUIRED';
            error.model = modelId;
            error.operation = operation;
            throw error;
          }
          synchronized.push(existing);
          continue;
        }
        const unchanged = existing
          && Number(existing.input_price_per_million_micros) === normalized.inputRate
          && Number(existing.output_price_per_million_micros) === normalized.outputRate
          && existing.input_unit === normalized.inputUnit
          && existing.output_unit === normalized.outputUnit;
        if (unchanged) {
          synchronized.push(existing);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        synchronized.push(await createPriceVersion({
          provider: 'openrouter', model: modelId, operation, currency: 'USD',
          inputUnit: normalized.inputUnit, outputUnit: normalized.outputUnit,
          inputPricePerMillionMicros: normalized.inputRate,
          outputPricePerMillionMicros: normalized.outputRate,
          effectiveFrom,
        }, actorUserId, { client }));
      }
    }
  }
  return synchronized;
}

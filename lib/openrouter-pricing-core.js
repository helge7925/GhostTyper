function priceNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function perUnitUsdToPerMillionMicros(value) {
  const parsed = priceNumber(value);
  if (parsed === null) return null;
  const micros = Math.round(parsed * 1_000_000_000_000);
  return Number.isSafeInteger(micros) ? micros : null;
}

export function normalizeCataloguePrice(model, capability) {
  const pricing = model?.pricing || {};
  if (capability === 'chat') {
    const inputRate = perUnitUsdToPerMillionMicros(pricing.prompt);
    const outputRate = perUnitUsdToPerMillionMicros(pricing.completion);
    return inputRate === null || outputRate === null ? null : {
      inputUnit: 'token', outputUnit: 'token', inputRate, outputRate,
    };
  }
  if (capability === 'ocr') {
    const requestUsd = priceNumber(pricing.request) || 0;
    return {
      inputUnit: 'page', outputUnit: 'token',
      inputRate: perUnitUsdToPerMillionMicros(requestUsd + 0.002), outputRate: 0,
    };
  }
  if (capability === 'transcription' || capability === 'liveTranscription') {
    const inputRate = perUnitUsdToPerMillionMicros(pricing.audio);
    return inputRate === null ? null : {
      inputUnit: 'audio_second', outputUnit: 'token', inputRate, outputRate: 0,
    };
  }
  if (capability === 'tts') {
    const outputRate = perUnitUsdToPerMillionMicros(pricing.audio ?? pricing.completion);
    return outputRate === null ? null : {
      inputUnit: 'character', outputUnit: 'character', inputRate: 0, outputRate,
    };
  }
  return null;
}

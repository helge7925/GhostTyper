import { openRouterJsonRequest } from './openrouter';
import { openRouterTts } from './tts';

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function assertTextResponse(result, capability) {
  if (!String(result?.choices?.[0]?.message?.content || '').trim()) {
    const error = new Error(`OpenRouter-Probe für ${capability} lieferte keine Antwort.`);
    error.code = 'CAPABILITY_PROBE_FAILED';
    error.capability = capability;
    throw error;
  }
}

export async function probeOpenRouterDefaults({ apiKey, config, catalogue }) {
  const byId = new Map((catalogue || []).map((model) => [model.id, model]));
  const ttsModel = config.defaultModels.tts;
  const voice = config.ttsVoices?.[ttsModel];
  const advertisedVoices = byId.get(ttsModel)?.supportedVoices || [];
  if (!voice || (advertisedVoices.length > 0 && !advertisedVoices.includes(voice))) {
    const error = new Error('Für das TTS-Standardmodell ist eine gültige Stimme erforderlich.');
    error.code = 'TTS_VOICE_REQUIRED';
    error.capability = 'tts';
    throw error;
  }

  const speech = await openRouterTts({
    text: 'OpenRouter capability test.',
    language: 'en',
    format: 'mp3',
    apiKey,
    model: ttsModel,
    voice,
  });
  if (!speech.length) throw Object.assign(new Error('TTS-Probe lieferte kein Audio.'), { code: 'CAPABILITY_PROBE_FAILED', capability: 'tts' });

  const audioInput = { data: speech.toString('base64'), format: 'mp3' };
  const transcription = await openRouterJsonRequest('/audio/transcriptions', {
    input_audio: audioInput,
    model: config.defaultModels.transcription,
    language: 'en',
  }, apiKey);
  if (!String(transcription?.text || '').trim()) {
    throw Object.assign(new Error('STT-Probe lieferte keinen Text.'), { code: 'CAPABILITY_PROBE_FAILED', capability: 'transcription' });
  }

  const liveModel = byId.get(config.defaultModels.liveTranscription);
  const live = await openRouterJsonRequest('/audio/transcriptions', {
    input_audio: audioInput,
    model: config.defaultModels.liveTranscription,
    language: 'en',
    response_format: 'verbose_json',
  }, apiKey, { supportedParameters: liveModel?.supportedParameters || [] });
  if (!Array.isArray(live?.segments)) {
    throw Object.assign(new Error('Live-STT-Probe lieferte kein segmentiertes verbose_json.'), { code: 'CAPABILITY_PROBE_FAILED', capability: 'liveTranscription' });
  }

  const chatModel = byId.get(config.defaultModels.chat);
  const chat = await openRouterJsonRequest('/chat/completions', {
    model: config.defaultModels.chat,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    temperature: 0,
  }, apiKey, { supportedParameters: chatModel?.supportedParameters || [] });
  assertTextResponse(chat, 'chat');

  const ocrModel = byId.get(config.defaultModels.ocr);
  const ocr = await openRouterJsonRequest('/chat/completions', {
    model: config.defaultModels.ocr,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Return only Markdown describing any visible content.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${ONE_PIXEL_PNG}` } },
    ] }],
    temperature: 0,
  }, apiKey, { supportedParameters: ocrModel?.supportedParameters || [] });
  assertTextResponse(ocr, 'ocr');

  return {
    liveTranscriptionVerified: [config.defaultModels.liveTranscription],
    generationIds: [speech.providerRequestId, transcription.id, live.id, chat.id, ocr.id].filter(Boolean),
  };
}

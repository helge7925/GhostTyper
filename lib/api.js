const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || `Request failed: ${res.status}`);
  }

  return res.json();
}

export function getTranscriptions() {
  return request('/transcriptions');
}

export function getTranscription(id) {
  return request(`/transcriptions/${id}`);
}

export function deleteTranscription(id) {
  return request(`/transcriptions/${id}`, { method: 'DELETE' });
}

export function uploadAudio(file, { template, diarize, customPrompt, autoAnalyze } = {}) {
  const formData = new FormData();
  formData.append('file', file);
  if (template) formData.append('template', template);
  if (diarize) formData.append('diarize', 'true');
  if (customPrompt) formData.append('customPrompt', customPrompt);
  if (autoAnalyze !== undefined) formData.append('autoAnalyze', autoAnalyze ? 'true' : 'false');

  return fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  }).then(async (res) => {
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.message || `Upload failed: ${res.status}`);
    }
    return res.json();
  });
}

export function updateSpeakers(id, speakers) {
  return request(`/transcriptions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ speakers }),
  });
}

export function startAnalysis(id) {
  return request(`/transcriptions/${id}/analyze`, { method: 'POST' });
}

export function getSettings() {
  return request('/settings');
}

export function updateSettings(data) {
  return request('/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

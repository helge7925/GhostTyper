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

export function uploadAudio(file) {
  const formData = new FormData();
  formData.append('file', file);

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

export function getSettings() {
  return request('/settings');
}

export function updateSettings(data) {
  return request('/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

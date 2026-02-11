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

export function uploadAudio(file, { template, model, diarize, customPrompt, autoAnalyze } = {}) {
  const formData = new FormData();
  formData.append('file', file);
  if (template) formData.append('template', template);
  if (model) formData.append('model', model);
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

export function updateTranscription(id, data) {
  return request(`/transcriptions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function updateSpeakers(id, speakers) {
  return updateTranscription(id, { speakers });
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

// Templates
export function getTemplates() {
  return request('/templates');
}

export function createTemplate(data) {
  return request('/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateTemplate(id, data) {
  return request(`/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteTemplate(id) {
  return request(`/templates/${id}`, {
    method: 'DELETE',
  });
}

export function generateTemplatePrompt(goal) {
  return request('/templates/generate', {
    method: 'POST',
    body: JSON.stringify({ goal }),
  });
}

// Folders
export function getFolders() {
  return request('/folders');
}

export function createFolder(name) {
  return request('/folders', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function updateFolder(id, name) {
  return request(`/folders/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export function deleteFolder(id) {
  return request(`/folders/${id}`, {
    method: 'DELETE',
  });
}

// Text Assistant Tasks
export function getTextTasks() {
  return request('/text-tasks');
}

export function createTextTask(data) {
  return request('/text-tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateTextTask(id, data) {
  return request(`/text-tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteTextTask(id) {
  return request(`/text-tasks/${id}`, {
    method: 'DELETE',
  });
}

export function saveDocument(data) {
  return request('/transcriptions/save-doc', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

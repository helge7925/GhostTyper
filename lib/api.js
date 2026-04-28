const API_BASE = '';

async function fetchWithAuth(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// Upload
export async function uploadAudio(file, options = {}) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('template', options.template || 'generic');
  formData.append('model', options.model || 'mistral-large-latest');
  formData.append('diarize', String(Boolean(options.diarize)));
  formData.append('autoAnalyze', String(options.autoAnalyze !== false));
  if (typeof options.customPrompt === 'string' && options.customPrompt.trim()) {
    formData.append('customPrompt', options.customPrompt.trim());
  }
  if (typeof options.analysisFocus === 'string' && options.analysisFocus.trim()) {
    formData.append('analysisFocus', options.analysisFocus.trim());
  }

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// Settings
export async function getSettings() {
  return fetchWithAuth('/api/settings');
}

export async function updateSettings(data) {
  return fetchWithAuth('/api/settings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Productivity helpers
export async function getModelRecommendation(payload) {
  return fetchWithAuth('/api/model-assistant', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getGlossarySuggestions(limit = 30) {
  const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 30;
  return fetchWithAuth(`/api/glossary/suggestions?limit=${encodeURIComponent(safeLimit)}`);
}

export async function getWorkflows() {
  return fetchWithAuth('/api/workflows');
}

export async function saveWorkflow(data) {
  return fetchWithAuth('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

export async function deleteWorkflow(workflowId) {
  return fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowId)}`, {
    method: 'DELETE',
  });
}

export async function getWorkflowVersions(workflowId) {
  return fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowId)}/versions`);
}

export async function rollbackWorkflowVersion(workflowId, version) {
  return fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowId)}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export async function executeWorkflow(data) {
  return fetchWithAuth('/api/workflows/execute', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getAuditLog(limit = 80) {
  return fetchWithAuth(`/api/audit-log?limit=${encodeURIComponent(limit)}`);
}

// Echtzeitverarbeitung
export async function getRealtimeSessions() {
  return fetchWithAuth('/api/realtime/sessions');
}

export async function createRealtimeSession(data) {
  return fetchWithAuth('/api/realtime/sessions', {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

export async function getRealtimeSession(id) {
  return fetchWithAuth(`/api/realtime/sessions/${id}`);
}

export async function updateRealtimeSession(id, data) {
  return fetchWithAuth(`/api/realtime/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data || {}),
  });
}

export async function addRealtimeSessionMember(sessionId, data) {
  return fetchWithAuth(`/api/realtime/sessions/${sessionId}/members`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

export async function removeRealtimeSessionMember(sessionId, userId) {
  return fetchWithAuth(`/api/realtime/sessions/${sessionId}/members`, {
    method: 'DELETE',
    body: JSON.stringify({ userId }),
  });
}

export async function ingestRealtimeSessionChunk(sessionId, data) {
  return fetchWithAuth(`/api/realtime/sessions/${sessionId}/ingest`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

// Templates
export async function getTemplates() {
  return fetchWithAuth('/api/templates');
}

export async function createTemplate(data) {
  return fetchWithAuth('/api/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateTemplate(id, data) {
  return fetchWithAuth(`/api/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteTemplate(id) {
  return fetchWithAuth(`/api/templates/${id}`, {
    method: 'DELETE',
  });
}

export async function generateTemplatePrompt(goal) {
  return fetchWithAuth('/api/templates/generate', {
    method: 'POST',
    body: JSON.stringify({ goal }),
  });
}

// Template Categories
export async function getTemplateCategories() {
  return fetchWithAuth('/api/template-categories');
}

export async function createTemplateCategory(data) {
  return fetchWithAuth('/api/template-categories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateTemplateCategory(id, data) {
  return fetchWithAuth(`/api/template-categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteTemplateCategory(id) {
  return fetchWithAuth(`/api/template-categories/${id}`, {
    method: 'DELETE',
  });
}

// Text Tasks
export async function getTextTasks() {
  return fetchWithAuth('/api/text-tasks');
}

export async function createTextTask(data) {
  return fetchWithAuth('/api/text-tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateTextTask(id, data) {
  return fetchWithAuth(`/api/text-tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteTextTask(id) {
  return fetchWithAuth(`/api/text-tasks/${id}`, {
    method: 'DELETE',
  });
}

// Folders
export async function getFolders() {
  return fetchWithAuth('/api/folders');
}

export async function createFolder(name) {
  const normalizedName = typeof name === 'string' ? name : name?.name;
  return fetchWithAuth('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name: normalizedName }),
  });
}

export async function updateFolder(id, name) {
  const normalizedName = typeof name === 'string' ? name : name?.name;
  return fetchWithAuth(`/api/folders/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: normalizedName }),
  });
}

export async function deleteFolder(id) {
  return fetchWithAuth(`/api/folders/${id}`, {
    method: 'DELETE',
  });
}

// Transcriptions
export async function getTranscriptions(searchOrOptions = '', options = {}) {
  const isLegacySearchString = typeof searchOrOptions === 'string';
  const rawSearch = isLegacySearchString
    ? searchOrOptions
    : String(searchOrOptions?.search || '');
  const opts = isLegacySearchString ? options : (searchOrOptions || {});

  const params = new URLSearchParams();
  const search = rawSearch.trim();
  if (search) {
    params.set('search', search);
    params.set('scope', String(opts.scope || 'full'));
  }

  if (opts.limit !== undefined) {
    params.set('limit', String(opts.limit));
  }
  if (opts.offset !== undefined) {
    params.set('offset', String(opts.offset));
  }

  const query = params.toString();
  return fetchWithAuth(`/api/transcriptions${query ? `?${query}` : ''}`);
}

export async function getTranscription(id) {
  return fetchWithAuth(`/api/transcriptions/${id}`);
}

export async function deleteTranscription(id) {
  return fetchWithAuth(`/api/transcriptions/${id}`, {
    method: 'DELETE',
  });
}

export async function updateTranscription(id, data) {
  return fetchWithAuth(`/api/transcriptions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function updateSpeakers(id, speakers) {
  return updateTranscription(id, { speakers });
}

export async function analyzeTranscription(id, payload = null) {
  return fetchWithAuth(`/api/transcriptions/${id}/analyze`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export async function startAnalysis(id, payload = null) {
  return analyzeTranscription(id, payload);
}

// Document save
export async function saveDocument(data) {
  return fetchWithAuth('/api/transcriptions/save-doc', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// OCR
export async function processOCR(data) {
  const formData = new FormData();
  formData.append('file', data.file);
  if (data.customPrompt) formData.append('customPrompt', data.customPrompt);
  if (data.analysisFocus) formData.append('analysisFocus', data.analysisFocus);
  
  const response = await fetch('/api/ocr', {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message);
  }
  
  return response.json();
}



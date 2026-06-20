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
  formData.append('model', options.model || 'deepseek-v4-pro');
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

export async function getGlossarySuggestions(limit = 30) {
  const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 30;
  return fetchWithAuth(`/api/glossary/suggestions?limit=${encodeURIComponent(safeLimit)}`);
}

export async function getAuditLog(limit = 80) {
  return fetchWithAuth(`/api/audit-log?limit=${encodeURIComponent(limit)}`);
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
export async function getDocuments(searchOrOptions = '', options = {}) {
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
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  if (opts.visibility) params.set('visibility', String(opts.visibility));
  if (opts.sourceType) params.set('sourceType', String(opts.sourceType));
  if (opts.status) params.set('status', String(opts.status));
  if (opts.favorite !== undefined) params.set('favorite', String(opts.favorite));

  const query = params.toString();
  return fetchWithAuth(`/api/documents${query ? `?${query}` : ''}`);
}

export async function getDocument(id) {
  return fetchWithAuth(`/api/documents/${id}`);
}

export async function updateDocument(id, data) {
  return fetchWithAuth(`/api/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteDocument(id) {
  return fetchWithAuth(`/api/documents/${id}`, {
    method: 'DELETE',
  });
}

export async function reindexDocument(id) {
  return fetchWithAuth(`/api/documents/${id}/reindex`, {
    method: 'POST',
  });
}

export async function bulkDocuments(action, documentIds, options = {}) {
  const body = {
    action,
    documentIds,
    ...options,
  };
  return fetchWithAuth('/api/documents/bulk', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function createChatConversation(options = {}) {
  return fetchWithAuth('/api/chat/conversations', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function addChatContextItem(conversationId, item) {
  return fetchWithAuth('/api/chat/context', {
    method: 'POST',
    body: JSON.stringify({ conversationId, ...item }),
  });
}

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

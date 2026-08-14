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
  if (options.clientCaptureId) {
    formData.append('clientCaptureId', options.clientCaptureId);
    formData.append('clientCaptureUserId', String(options.clientCaptureUserId || ''));
    formData.append('clientCaptureOrganizationId', String(options.clientCaptureOrganizationId || ''));
  }

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    const uploadError = new Error(error.message || `HTTP ${response.status}`);
    uploadError.status = response.status;
    throw uploadError;
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

// Terminology suggestions derived from a specific source text the user just
// translated. `exclude` lists terms already covered by the applied glossary.
export async function getGlossarySuggestionsForText(text, { exclude = [], limit = 20 } = {}) {
  return fetchWithAuth('/api/glossary/suggestions', {
    method: 'POST',
    body: JSON.stringify({ text, exclude, limit }),
  });
}

export async function listGlossaryEntries(scope = 'workspace') {
  const safeScope = scope === 'personal' ? 'personal' : 'workspace';
  return fetchWithAuth(`/api/glossary?scope=${encodeURIComponent(safeScope)}`);
}

export async function createGlossaryEntry(data, scope = 'workspace') {
  const safeScope = scope === 'personal' ? 'personal' : 'workspace';
  return fetchWithAuth('/api/glossary', {
    method: 'POST',
    body: JSON.stringify({ ...data, scope: safeScope }),
  });
}

export async function updateGlossaryEntry(id, data, scope = 'workspace') {
  const safeScope = scope === 'personal' ? 'personal' : 'workspace';
  return fetchWithAuth(`/api/glossary/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...data, scope: safeScope }),
  });
}

export async function deleteGlossaryEntry(id, scope = 'workspace') {
  const safeScope = scope === 'personal' ? 'personal' : 'workspace';
  return fetchWithAuth(`/api/glossary/${id}?scope=${encodeURIComponent(safeScope)}`, {
    method: 'DELETE',
  });
}

// Glossary CSV/TBX interop
export async function exportGlossary(scope = 'workspace', format = 'csv') {
  const safeScope = scope === 'personal' ? 'personal' : 'workspace';
  const safeFormat = format === 'tbx' ? 'tbx' : 'csv';
  const response = await fetch(`/api/glossary/export?scope=${encodeURIComponent(safeScope)}&format=${encodeURIComponent(safeFormat)}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  const text = await response.text();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `glossary-${safeScope}.${safeFormat}`;
  return { text, filename };
}

export async function importGlossaryCsv(scope, csv) {
  const safeScope = scope === 'personal' ? 'personal' : 'workspace';
  return fetchWithAuth('/api/glossary/import', {
    method: 'POST',
    body: JSON.stringify({ scope: safeScope, csv }),
  });
}

// Translation memory (TM browser + review corrections)
export async function listTranslationMemory({ q = '', limit = 25, offset = 0 } = {}) {
  const params = new URLSearchParams();
  const search = String(q || '').trim();
  if (search) params.set('q', search);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return fetchWithAuth(`/api/glossary/tm?${params.toString()}`);
}

export async function deleteTranslationMemoryEntry(id) {
  return fetchWithAuth(`/api/glossary/tm?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function purgeUnverifiedTranslationMemory() {
  return fetchWithAuth('/api/glossary/tm?purgeUnverified=true', {
    method: 'DELETE',
  });
}

export async function saveTranslationMemoryCorrection(data) {
  return fetchWithAuth('/api/glossary/tm', {
    method: 'POST',
    body: JSON.stringify(data),
  });
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

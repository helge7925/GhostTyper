import { useEffect, useMemo, useState } from 'react';

export function useModelOptions(capability = 'chat') {
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/models?capability=${encodeURIComponent(capability)}&scope=allowed`, { credentials: 'same-origin' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.code || 'MODEL_CATALOGUE_FAILED');
        if (active) {
          setModels(payload.models || []);
          setDefaultModel(payload.defaultModel || '');
        }
      })
      .catch(() => {
        if (active) setModels([]);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [capability]);
  const options = useMemo(() => models.map((model) => ({ value: model.id, label: model.name || model.id })), [models]);
  return { models, options, defaultModel, loading };
}


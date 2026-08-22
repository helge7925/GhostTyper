import { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, Loader2, ShieldCheck } from 'lucide-react';
import { useUiFeedback } from '../../lib/use-ui-feedback';

const CAPABILITIES = ['chat', 'ocr', 'transcription', 'liveTranscription', 'tts'];
const LABELS = {
  chat: 'Text, Analyse und Übersetzung',
  ocr: 'OCR für Bilder und PDF',
  transcription: 'Datei-Transkription',
  liveTranscription: 'Live-Transkription',
  tts: 'Sprachausgabe',
};

const emptyLists = () => Object.fromEntries(CAPABILITIES.map((key) => [key, []]));
const emptyDefaults = () => Object.fromEntries(CAPABILITIES.map((key) => [key, '']));

export default function OpenRouterIntegrationPanel({ canEdit }) {
  const { showToast } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [operatorFallback, setOperatorFallback] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [allowedModels, setAllowedModels] = useState(emptyLists);
  const [defaultModels, setDefaultModels] = useState(emptyDefaults);
  const [ttsVoices, setTtsVoices] = useState({});
  const [catalogue, setCatalogue] = useState(emptyLists);
  const [catalogueStale, setCatalogueStale] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/organizations/integrations/openrouter', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('OpenRouter-Konfiguration konnte nicht geladen werden.');
      const payload = await response.json();
      const config = payload.config || {};
      setEnabled(Boolean(payload.enabled));
      setOperatorFallback(Boolean(payload.operatorFallback));
      setApiKeyConfigured(Boolean(config.apiKeyConfigured));
      setAllowedModels({ ...emptyLists(), ...(config.allowedModels || {}) });
      setDefaultModels({ ...emptyDefaults(), ...(config.defaultModels || {}) });
      setTtsVoices(config.ttsVoices || {});
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const fetchCatalogue = async () => {
    setBusy(true);
    try {
      const next = emptyLists();
      let stale = false;
      for (const capability of CAPABILITIES) {
        // Sequential requests intentionally reuse the server-side catalogue cache.
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(`/api/models?capability=${capability}&scope=catalog`, { credentials: 'same-origin' });
        // eslint-disable-next-line no-await-in-loop
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || `Katalog für ${capability} konnte nicht geladen werden.`);
        next[capability] = payload.models || [];
        stale = stale || Boolean(payload.stale);
      }
      setCatalogue(next);
      setCatalogueStale(stale);
      showToast('OpenRouter-Modellkatalog wurde aktualisiert.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = { allowedModels, defaultModels, ttsVoices };
      if (apiKey) body.apiKey = apiKey;
      const response = await fetch('/api/organizations/integrations/openrouter', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Speichern fehlgeschlagen.');
      setApiKey('');
      showToast('OpenRouter-Konfiguration gespeichert.', 'success');
      await load();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      if (apiKey) await save();
      const response = await fetch('/api/organizations/integrations/openrouter/test', { method: 'POST', credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Verbindungstest fehlgeschlagen.');
      showToast(`OpenRouter verbunden (${Object.values(payload.counts || {}).reduce((sum, count) => sum + count, 0)} Modellzuordnungen).`, 'success');
      await fetchCatalogue();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setBusy(true);
    try {
      await save();
      const response = await fetch('/api/organizations/integrations/openrouter/activate', { method: 'POST', credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Aktivierung fehlgeschlagen.');
      showToast('OpenRouter wurde als einziger KI-Provider aktiviert.', 'success');
      await load();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleModel = (capability, model) => {
    setAllowedModels((current) => {
      const selected = new Set(current[capability] || []);
      if (selected.has(model)) selected.delete(model); else selected.add(model);
      const next = { ...current, [capability]: [...selected] };
      if (!selected.has(defaultModels[capability])) setDefaultModels((defaults) => ({ ...defaults, [capability]: '' }));
      return next;
    });
  };

  if (loading) return <div className="bg-surface border border-subtle rounded-2xl p-6"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <section className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div><h3 className="text-sm font-semibold text-secondary uppercase tracking-widest flex items-center gap-2"><BrainCircuit className="w-4 h-4" /> OpenRouter</h3><p className="text-xs text-secondary mt-1">Ein API-Key, dynamische Modelle und datenschutzgefiltertes Routing.</p></div>
        {enabled && <span className="inline-flex items-center gap-1 text-xs text-success"><ShieldCheck className="w-4 h-4" /> Aktiv</span>}
      </header>
      <label className="block text-xs font-medium text-secondary">API-Key {apiKeyConfigured && '(konfiguriert)'}
        <input type="password" value={apiKey} disabled={!canEdit} onChange={(event) => setApiKey(event.target.value)} placeholder={apiKeyConfigured || operatorFallback ? '••••••••' : 'sk-or-v1-…'} className="mt-1.5 w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary" />
      </label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!canEdit || busy} onClick={test} className="px-4 py-2 rounded-xl border border-subtle text-sm">Verbindung testen und Modelle laden</button><button type="button" disabled={!canEdit || busy || catalogueStale} onClick={save} className="px-4 py-2 rounded-xl bg-accent-strong text-white text-sm">Speichern</button><button type="button" disabled={!canEdit || busy || enabled || catalogueStale} onClick={activate} className="px-4 py-2 rounded-xl bg-success text-white text-sm">Cutover aktivieren</button>{busy && <Loader2 className="w-4 h-4 animate-spin self-center" />}</div>
      {catalogueStale && <p className="text-xs text-warning">Es wird ein veralteter Katalog nur zur Ansicht gezeigt. Änderungen sind bis zur nächsten erfolgreichen Live-Abfrage gesperrt.</p>}
      {!enabled && <p className="text-xs text-warning">Die Aktivierung führt kleine kostenpflichtige Proben für Chat, OCR, STT, Live-STT und TTS aus.</p>}
      {CAPABILITIES.map((capability) => (
        <div key={capability} className="border border-subtle rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-semibold text-primary">{LABELS[capability]}</h4>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {(catalogue[capability] || []).map((model) => (
              <label key={model.id} className="flex gap-2 items-start text-xs text-secondary py-1"><input type="checkbox" checked={(allowedModels[capability] || []).includes(model.id)} onChange={() => toggleModel(capability, model.id)} disabled={!canEdit || catalogueStale} /><span><span className="text-primary">{model.name}</span><br /><span className="font-mono text-[10px]">{model.id}</span></span></label>
            ))}
            {catalogue[capability]?.length === 0 && <p className="text-xs text-secondary">Katalog laden, um Modelle auszuwählen.</p>}
          </div>
          <label className="block text-xs text-secondary">Organisationsstandard
            <select value={defaultModels[capability] || ''} onChange={(event) => setDefaultModels((current) => ({ ...current, [capability]: event.target.value }))} disabled={!canEdit || catalogueStale} className="mt-1 w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-primary"><option value="">Bitte auswählen</option>{(allowedModels[capability] || []).map((id) => <option key={id} value={id}>{catalogue[capability]?.find((model) => model.id === id)?.name || id}</option>)}</select>
          </label>
          {capability === 'tts' && defaultModels.tts && <label className="block text-xs text-secondary">Stimme
            <input list="openrouter-tts-voices" value={ttsVoices[defaultModels.tts] || ''} onChange={(event) => setTtsVoices((current) => ({ ...current, [defaultModels.tts]: event.target.value }))} className="mt-1 w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-primary" />
            <datalist id="openrouter-tts-voices">{(catalogue.tts.find((model) => model.id === defaultModels.tts)?.supportedVoices || []).map((voice) => <option key={voice} value={voice} />)}</datalist>
          </label>}
        </div>
      ))}
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Loader2, ShieldCheck } from 'lucide-react';
import { useUiFeedback } from '../../lib/use-ui-feedback';

const LABELS = {
  chat: 'Text, Analyse, Übersetzung, OCR',
  transcription: 'Datei-Transkription',
  liveTranscription: 'Live-Transkription',
  tts: 'Sprachausgabe',
};

// Models are hardcoded per capability (lib/edenai.js's
// EDENAI_HARDCODED_MODEL, chosen through a real comparison test against
// production EdenAI — see openspec/changes/hardcode-edenai-models) —
// this panel shows which model is used, but nothing here is a picker.
// The only remaining per-workspace choice is TTS voice, since that's a
// preference, not a quality decision the team pre-vets like a base model.
export default function EdenAiIntegrationPanel({ canEdit }) {
  const { showToast } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [busyCapability, setBusyCapability] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [operatorFallback, setOperatorFallback] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [ttsVoices, setTtsVoices] = useState({});
  const [activatedCapabilities, setActivatedCapabilities] = useState([]);
  const [capabilities, setCapabilities] = useState([]);
  const [hardcodedModels, setHardcodedModels] = useState({});
  const busy = busyCapability !== null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/organizations/integrations/edenai', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('EdenAI-Konfiguration konnte nicht geladen werden.');
      const payload = await response.json();
      const config = payload.config || {};
      setEnabled(Boolean(payload.enabled));
      setOperatorFallback(Boolean(payload.operatorFallback));
      setApiKeyConfigured(Boolean(config.apiKeyConfigured));
      setTtsVoices(config.ttsVoices || {});
      setActivatedCapabilities(Array.isArray(config.activatedCapabilities) ? config.activatedCapabilities : []);
      setCapabilities(Array.isArray(payload.capabilities) ? payload.capabilities : []);
      setHardcodedModels(payload.hardcodedModels || {});
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const body = { ttsVoices };
    if (apiKey) body.apiKey = apiKey;
    const response = await fetch('/api/organizations/integrations/edenai', {
      method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Speichern fehlgeschlagen.');
    setApiKey('');
    await load();
  };

  const runSave = async () => {
    setBusyCapability('__save__');
    try {
      await save();
      showToast('EdenAI-Konfiguration gespeichert.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusyCapability(null);
    }
  };

  const test = async () => {
    setBusyCapability('__test__');
    try {
      if (apiKey) await save();
      const response = await fetch('/api/organizations/integrations/edenai/test', { method: 'POST', credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Verbindungstest fehlgeschlagen.');
      showToast('EdenAI-Verbindung erfolgreich getestet.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusyCapability(null);
    }
  };

  const activateCapability = async (capability) => {
    setBusyCapability(capability);
    try {
      await save();
      const response = await fetch('/api/organizations/integrations/edenai/activate', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capability }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Aktivierung fehlgeschlagen.');
      showToast(
        payload.probed
          ? `${LABELS[capability]} wurde aktiviert.`
          : `${LABELS[capability]} wurde aktiviert (ohne Live-Probe — noch nicht für diese Fähigkeit verfügbar).`,
        'success',
      );
      await load();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusyCapability(null);
    }
  };

  if (loading) return <div className="bg-surface border border-subtle rounded-2xl p-6"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <section className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div><h3 className="text-sm font-semibold text-secondary uppercase tracking-widest flex items-center gap-2"><Sparkles className="w-4 h-4" /> EdenAI</h3><p className="text-xs text-secondary mt-1">Wird schrittweise pro Fähigkeit neben OpenRouter aktiviert. Modelle sind fest hinterlegt, keine Auswahl nötig.</p></div>
        {enabled && <span className="inline-flex items-center gap-1 text-xs text-success"><ShieldCheck className="w-4 h-4" /> Aktiv</span>}
      </header>
      <label className="block text-xs font-medium text-secondary">API-Key {apiKeyConfigured && '(konfiguriert)'}
        <input type="password" value={apiKey} disabled={!canEdit} onChange={(event) => setApiKey(event.target.value)} placeholder={apiKeyConfigured || operatorFallback ? '••••••••' : 'EdenAI-Key'} className="mt-1.5 w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary" />
      </label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!canEdit || busy} onClick={test} className="px-4 py-2 rounded-xl border border-subtle text-sm">Verbindung testen</button><button type="button" disabled={!canEdit || busy} onClick={runSave} className="px-4 py-2 rounded-xl bg-accent-strong text-white text-sm">Speichern</button>{busy && <Loader2 className="w-4 h-4 animate-spin self-center" />}</div>
      {capabilities.map((capability) => {
        const isActivated = activatedCapabilities.includes(capability);
        const model = hardcodedModels[capability];
        return (
          <div key={capability} className="border border-subtle rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-primary">{LABELS[capability]}</h4>
              {isActivated
                ? <span className="inline-flex items-center gap-1 text-xs text-success"><ShieldCheck className="w-3.5 h-3.5" /> Aktiviert</span>
                : <span className="text-xs text-secondary">Nicht aktiviert</span>}
            </div>
            <p className="text-xs text-secondary">Modell: {model ? <span className="font-mono text-primary">{model}</span> : 'noch nicht festgelegt'}</p>
            {capability === 'tts' && model && <label className="block text-xs text-secondary">Stimme (leer = Standard &quot;Kore&quot;)
              <input value={ttsVoices[model] || ''} onChange={(event) => setTtsVoices((current) => ({ ...current, [model]: event.target.value }))} placeholder="z. B. Kore" className="mt-1 w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-primary" />
            </label>}
            <button
              type="button"
              disabled={!canEdit || busy || !model}
              onClick={() => activateCapability(capability)}
              className="px-4 py-2 rounded-xl bg-success text-white text-sm disabled:opacity-50"
            >
              {isActivated ? 'Erneut aktivieren' : 'Aktivieren'}
            </button>
          </div>
        );
      })}
    </section>
  );
}

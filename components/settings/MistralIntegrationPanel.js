import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Loader2, ShieldCheck } from 'lucide-react';
import { useUiFeedback } from '../../lib/use-ui-feedback';

// Direct Mistral integration — bypasses both OpenRouter and EdenAI. Used
// only for live-meeting speech-to-text so far (see lib/mistral.js): both
// of those routed through their own async/aggregation layers too slowly
// for a live meeting's ~2-3s audio-chunk cadence, while Mistral's own
// realtime endpoint measured well under a second. No catalogue, no
// per-capability activation — a saved key is used immediately.
export default function MistralIntegrationPanel({ canEdit }) {
  const { showToast } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [operatorFallback, setOperatorFallback] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [liveTranscriptionModel, setLiveTranscriptionModel] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/organizations/integrations/mistral', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Mistral-Konfiguration konnte nicht geladen werden.');
      const payload = await response.json();
      const config = payload.config || {};
      setApiKeyConfigured(Boolean(config.apiKeyConfigured));
      setOperatorFallback(Boolean(payload.operatorFallback));
      setLiveTranscriptionModel(payload.liveTranscriptionModel || '');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const body = {};
      if (apiKey) body.apiKey = apiKey;
      const response = await fetch('/api/organizations/integrations/mistral', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Speichern fehlgeschlagen.');
      setApiKey('');
      await load();
      showToast('Mistral-Konfiguration gespeichert.', 'success');
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
      const response = await fetch('/api/organizations/integrations/mistral/test', { method: 'POST', credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Verbindungstest fehlgeschlagen.');
      showToast('Mistral-Verbindung erfolgreich getestet.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="bg-surface border border-subtle rounded-2xl p-6"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <section className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-secondary uppercase tracking-widest flex items-center gap-2"><Sparkles className="w-4 h-4" /> Mistral (Live-Meeting)</h3>
          <p className="text-xs text-secondary mt-1">Direkte Anbindung, unabhängig von OpenRouter/EdenAI — ausschließlich für die Live-Transkription in Meetings, da Latenz hier entscheidend ist.</p>
        </div>
        {(apiKeyConfigured || operatorFallback) && <span className="inline-flex items-center gap-1 text-xs text-success"><ShieldCheck className="w-4 h-4" /> Aktiv</span>}
      </header>
      <label className="block text-xs font-medium text-secondary">API-Key {apiKeyConfigured && '(konfiguriert)'}
        <input type="password" value={apiKey} disabled={!canEdit} onChange={(event) => setApiKey(event.target.value)} placeholder={apiKeyConfigured || operatorFallback ? '••••••••' : 'Mistral-Key'} className="mt-1.5 w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary" />
      </label>
      <p className="text-xs text-secondary">Modell (Live-Transkription): <span className="font-mono text-primary">{liveTranscriptionModel || '…'}</span> — fest hinterlegt, keine Auswahl nötig.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!canEdit || busy} onClick={test} className="px-4 py-2 rounded-xl border border-subtle text-sm">Verbindung testen</button>
        <button type="button" disabled={!canEdit || busy} onClick={save} className="px-4 py-2 rounded-xl bg-accent-strong text-white text-sm">Speichern</button>
        {busy && <Loader2 className="w-4 h-4 animate-spin self-center" />}
      </div>
    </section>
  );
}

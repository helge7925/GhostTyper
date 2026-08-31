import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import {
  flushOfflineQueue,
  getOfflineQueueSummary,
  subscribeOfflineQueue,
} from '../lib/offline-queue';
import { useTranslations } from '../lib/i18n';
import { Button } from './ui/button';

let serviceWorkerRegistration;

function registerServiceWorkerOnce() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!serviceWorkerRegistration) {
    serviceWorkerRegistration = navigator.serviceWorker.register('/sw.js').catch(() => null);
  }
  return serviceWorkerRegistration;
}

const EMPTY_SUMMARY = { supported: true, pending: 0, failed: 0, syncing: 0 };

function notifySuccessfulSync(result) {
  if (result?.synced > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ghosttyper:offline-sync-complete', { detail: result }));
  }
}

export default function OfflineStatus({ userId, organizationId }) {
  const t = useTranslations('offlineStatus');
  const [online, setOnline] = useState(true);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [syncing, setSyncing] = useState(false);
  const bootstrappedScope = useRef(null);

  const refresh = useCallback(async () => {
    try {
      if (!userId || !organizationId) return;
      setSummary(await getOfflineQueueSummary({ userId, organizationId }));
    } catch {
      setSummary((current) => ({ ...current, supported: false }));
    }
  }, [organizationId, userId]);

  const sync = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    setSyncing(true);
    try {
      const result = await flushOfflineQueue({ userId, organizationId, manual: true });
      notifySuccessfulSync(result);
    } catch {
      // The persistent queue retains retry state; the status remains visible.
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [organizationId, refresh, userId]);

  useEffect(() => {
    if (!userId || !organizationId) return undefined;
    setOnline(navigator.onLine);
    registerServiceWorkerOnce();
    const scopeKey = `${userId}:${organizationId}`;
    if (bootstrappedScope.current !== scopeKey) {
      bootstrappedScope.current = scopeKey;
      setSummary(EMPTY_SUMMARY);
      getOfflineQueueSummary({ userId, organizationId }).then(async (initialSummary) => {
        setSummary(initialSummary);
        if (navigator.onLine && initialSummary.pending + initialSummary.syncing > 0) {
          const result = await flushOfflineQueue({ userId, organizationId }).catch(() => null);
          notifySuccessfulSync(result);
          await refresh();
        }
      }).catch(() => setSummary((current) => ({ ...current, supported: false })));
    }
    const onOnline = () => {
      setOnline(true);
      flushOfflineQueue({ userId, organizationId })
        .catch(() => null)
        .then(notifySuccessfulSync)
        .finally(refresh);
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const unsubscribe = subscribeOfflineQueue(refresh);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsubscribe();
    };
  }, [organizationId, refresh, userId]);

  if (!userId || !organizationId) return null;
  const queued = summary.pending + summary.syncing;
  if (online && queued === 0 && summary.failed === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-50 left-4 right-4 sm:left-auto sm:right-6 bottom-20 sm:bottom-6 sm:max-w-md rounded-lg border border-subtle bg-surface/95 px-4 py-3 shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-3">
        <CloudOff className="h-5 w-5 text-warning flex-none" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-primary">{online ? t('queued', { count: queued }) : t('offline')}</p>
          <p className="text-secondary">
            {!summary.supported
              ? t('unsupported')
              : summary.failed > 0
                ? `${t('failed', { count: summary.failed })}${summary.lastError ? ` · ${summary.lastError}` : ''}`
                : t('hint')}
          </p>
        </div>
        {online && (queued > 0 || summary.failed > 0) ? (
          <Button
            type="button"
            onClick={sync}
            disabled={syncing}
            variant="ghost"
            size="sm"
            className="text-accent-ink"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {syncing ? t('syncing') : t('sync')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

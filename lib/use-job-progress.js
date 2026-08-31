import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deriveJobProgress,
  nextProgressPollDelay,
  shouldTrackJobProgress,
} from './job-progress.js';

export function useJobProgress(transcriptionId, {
  enabled = true,
  initialSnapshot = null,
  onSnapshot = null,
  staleAfterMs = 90_000,
} = {}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connectionState, setConnectionState] = useState('connecting');
  const [lastReceivedAt, setLastReceivedAt] = useState(() => Date.now());
  const callbackRef = useRef(onSnapshot);

  useEffect(() => { callbackRef.current = onSnapshot; }, [onSnapshot]);
  useEffect(() => {
    if (initialSnapshot) setSnapshot(initialSnapshot);
  }, [initialSnapshot]);

  useEffect(() => {
    if (!enabled || !transcriptionId) return undefined;
    let closed = false;
    let eventSource = null;
    let pollTimer = null;
    let staleTimer = null;
    let pollAttempt = 0;

    const accept = (next) => {
      if (closed || !next) return;
      setSnapshot(next);
      setLastReceivedAt(Date.now());
      callbackRef.current?.(next);
      if (!shouldTrackJobProgress(next)) cleanup();
    };

    const schedulePoll = () => {
      if (closed || pollTimer) return;
      setConnectionState('polling');
      pollTimer = setTimeout(async () => {
        pollTimer = null;
        try {
          const response = await fetch(`/api/transcriptions/${transcriptionId}`, { credentials: 'same-origin' });
          if (!response.ok) throw new Error(`HTTP_${response.status}`);
          pollAttempt = 0;
          accept(await response.json());
        } catch {
          pollAttempt += 1;
          if (!closed) setConnectionState('unavailable');
        }
        if (!closed) schedulePoll();
      }, nextProgressPollDelay(pollAttempt));
    };

    function cleanup() {
      closed = true;
      if (eventSource) eventSource.close();
      if (pollTimer) clearTimeout(pollTimer);
      if (staleTimer) clearInterval(staleTimer);
      pollTimer = null;
    }

    staleTimer = setInterval(() => {
      setLastReceivedAt((receivedAt) => {
        if (!closed && Date.now() - receivedAt > staleAfterMs) setConnectionState('stale');
        return receivedAt;
      });
    }, Math.min(15_000, Math.max(5000, Math.round(staleAfterMs / 3))));

    if (typeof window !== 'undefined' && 'EventSource' in window) {
      eventSource = new EventSource(`/api/transcriptions/${transcriptionId}/stream`);
      eventSource.addEventListener('transcription', (event) => {
        try {
          setConnectionState('live');
          accept(JSON.parse(event.data));
        } catch {
          setConnectionState('unavailable');
        }
      });
      eventSource.addEventListener('missing', () => {
        setConnectionState('unavailable');
        cleanup();
      });
      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        schedulePoll();
      };
    } else {
      schedulePoll();
    }

    return cleanup;
  }, [enabled, staleAfterMs, transcriptionId]);

  const progress = useMemo(() => deriveJobProgress(snapshot), [snapshot]);
  return { ...progress, snapshot, connectionState, lastReceivedAt };
}

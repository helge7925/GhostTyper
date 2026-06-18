import { useCallback, useEffect, useRef } from 'react';

/**
 * Small helper to keep the device screen awake while recording.
 * Falls back gracefully on browsers without Screen Wake Lock API.
 */
export function useWakeLock() {
  const wakeLockRef = useRef(null);
  const activeRef = useRef(false);

  const release = useCallback(async () => {
    activeRef.current = false;
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
    } catch {
      // ignore release errors
    }
    wakeLockRef.current = null;
  }, []);

  const request = useCallback(async () => {
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
    activeRef.current = true;
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockRef.current.addEventListener('release', () => {
        wakeLockRef.current = null;
      });
    } catch {
      // ignore request errors (e.g. already requested, unsupported)
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      if (activeRef.current) {
        await request();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      release();
    };
  }, [request, release]);

  return { request, release };
}

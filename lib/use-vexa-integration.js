import { useEffect, useState } from 'react';

let cache = null;
let inflight = null;

async function fetchStatus() {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = Promise.all([
    fetch('/api/organizations/integrations/vexa', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : { enabled: false }))
      .catch(() => ({ enabled: false })),
    fetch('/api/settings', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : { remoteMeetingEnabled: true }))
      .catch(() => ({ remoteMeetingEnabled: true })),
  ])
    .then(([orgData, userData]) => {
      const orgEnabled = !!orgData.enabled;
      const userEnabled = userData.remoteMeetingEnabled !== false;
      // Both gates must be open: workspace-admin enables globally,
      // each member opts in/out from their own settings.
      cache = { orgEnabled, userEnabled, enabled: orgEnabled && userEnabled };
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function invalidateVexaIntegrationCache() {
  cache = null;
}

export function useVexaIntegrationEnabled() {
  const [state, setState] = useState(cache ?? { orgEnabled: false, userEnabled: true, enabled: false });
  const [loaded, setLoaded] = useState(!!cache);

  useEffect(() => {
    let mounted = true;
    fetchStatus().then((data) => {
      if (!mounted) return;
      setState(data);
      setLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return { ...state, loaded };
}

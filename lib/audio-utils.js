export function getSystemAudioCapabilities() {
  if (typeof window === 'undefined') {
    return { tabAudio: false, systemAudio: false };
  }

  const hasGetDisplayMedia = !!navigator.mediaDevices?.getDisplayMedia;
  const ua = navigator.userAgent || '';
  const isChrome = /Chrome\//.test(ua) && !/Edge|Edg\//.test(ua);
  const isEdge = /Edge|Edg\//.test(ua);
  const isWindows = /Win/.test(navigator.platform || '');

  return {
    tabAudio: hasGetDisplayMedia && (isChrome || isEdge),
    systemAudio: hasGetDisplayMedia && (isChrome || isEdge) && isWindows,
  };
}

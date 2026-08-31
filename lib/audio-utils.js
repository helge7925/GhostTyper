export function stripOverlapPrefix(prevText, nextText, maxWords = 60) {
  if (!prevText || !nextText) return nextText;
  const norm = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const prevWords = String(prevText).split(/\s+/).filter(Boolean);
  const nextWords = String(nextText).split(/\s+/).filter(Boolean);
  const window = Math.min(maxWords, prevWords.length, nextWords.length);
  for (let k = window; k >= 4; k -= 1) {
    const prevTail = prevWords.slice(prevWords.length - k).map(norm).join(' ');
    const nextHead = nextWords.slice(0, k).map(norm).join(' ');
    if (prevTail && prevTail === nextHead) {
      return nextWords.slice(k).join(' ');
    }
  }
  return nextText;
}

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

import { useEffect, useMemo, useState } from 'react';

function hashSeed(seed) {
  let hash = 2166136261;
  const normalized = String(seed || '');
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffleMessages(messages, seed = '') {
  const arr = [...messages];
  let randomState = hashSeed(seed) || 1;

  for (let i = arr.length - 1; i > 0; i -= 1) {
    randomState = Math.imul(randomState, 1664525) + 1013904223;
    const j = Math.abs(randomState) % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

export default function ProcessStatusCard({
  title,
  description,
  steps = [],
  activeStep = 0,
  done = false,
  messages = [],
  startedAt = null,
  etaSeconds = null,
  messageRotationMs = 5600,
}) {
  const messagePool = useMemo(
    () => messages.filter((msg) => typeof msg === 'string' && msg.trim() !== ''),
    [messages]
  );
  const shuffledMessages = useMemo(
    () => shuffleMessages(messagePool, `${title}|${activeStep}`),
    [messagePool, title, activeStep]
  );
  const [messageIndex, setMessageIndex] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setMessageIndex(0);
    setNow(Date.now());
  }, [title, done, shuffledMessages.length, activeStep]);

  useEffect(() => {
    if (done || shuffledMessages.length < 2) return undefined;

    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % shuffledMessages.length);
    }, Math.max(2800, messageRotationMs));

    return () => clearInterval(interval);
  }, [done, shuffledMessages.length, messageRotationMs]);

  useEffect(() => {
    if (done || !etaSeconds) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [done, etaSeconds]);

  const currentMessage = !done && shuffledMessages.length > 0 ? shuffledMessages[messageIndex] : '';

  const startTimestamp = useMemo(() => {
    if (!startedAt) return null;
    const parsed = new Date(startedAt).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }, [startedAt]);

  const etaText = useMemo(() => {
    if (done || !etaSeconds || !startTimestamp) return '';
    const elapsedSeconds = Math.max(0, (now - startTimestamp) / 1000);
    const remainingSeconds = etaSeconds - elapsedSeconds;
    if (remainingSeconds > 0) {
      return `Restzeit ca. ${formatDuration(remainingSeconds)}`;
    }
    if (remainingSeconds > -25) {
      return 'Fast fertig. Letzter Feinschliff läuft.';
    }
    return 'Dauert etwas länger als üblich. Wir bleiben dran.';
  }, [done, etaSeconds, startTimestamp, now]);

  return (
    <div className="bg-dark-card border border-white/[0.08] rounded-2xl p-5 shadow-xl animate-fade-in">
      <div className="flex items-start gap-3 mb-4">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          done ? 'bg-accent-green/20 text-accent-green' : 'bg-accent-orange/20 text-accent-orange'
        }`}>
          {done ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
          )}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {description && <p className="text-xs text-text-secondary mt-1">{description}</p>}
        </div>
      </div>

      {steps.length > 0 && (
        <div className="space-y-2">
          {steps.map((step, index) => {
            const isCompleted = done || index < activeStep;
            const isActive = !done && index === activeStep;
            return (
              <div key={step.key || step.label || index} className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  isCompleted ? 'bg-accent-green' : isActive ? 'bg-accent-orange animate-pulse' : 'bg-white/20'
                }`} />
                <span className={`text-xs ${
                  isCompleted || isActive ? 'text-text-primary' : 'text-text-secondary'
                }`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {etaText && (
        <p className="mt-3 text-sm text-accent-orange font-medium">
          {etaText}
        </p>
      )}

      {currentMessage && (
        <p className="mt-4 text-sm md:text-base text-text-secondary italic leading-relaxed">
          {currentMessage}
        </p>
      )}
    </div>
  );
}

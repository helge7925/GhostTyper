const DEFAULT_MAX_CONCURRENT_EXPORTS = 2;
const DEFAULT_QUEUE_TIMEOUT_MS = 5_000;

const waitingQueue = [];
let activeExports = 0;

function resolveLimits() {
  const configuredConcurrency = Number(process.env.PDF_EXPORT_MAX_CONCURRENCY);
  const configuredQueueTimeout = Number(process.env.PDF_EXPORT_QUEUE_TIMEOUT_MS);

  const maxConcurrent = Number.isFinite(configuredConcurrency) && configuredConcurrency > 0
    ? Math.floor(configuredConcurrency)
    : DEFAULT_MAX_CONCURRENT_EXPORTS;
  const queueTimeoutMs = Number.isFinite(configuredQueueTimeout) && configuredQueueTimeout > 0
    ? Math.floor(configuredQueueTimeout)
    : DEFAULT_QUEUE_TIMEOUT_MS;

  return { maxConcurrent, queueTimeoutMs };
}

function acquireSlot() {
  const { maxConcurrent, queueTimeoutMs } = resolveLimits();

  if (activeExports < maxConcurrent) {
    activeExports += 1;
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waitingQueue.findIndex((entry) => entry.resolve === resolve);
      if (idx >= 0) {
        waitingQueue.splice(idx, 1);
      }
      reject(new Error('PDF_RENDER_BUSY'));
    }, queueTimeoutMs);

    waitingQueue.push({
      resolve: () => {
        clearTimeout(timer);
        activeExports += 1;
        resolve();
      },
    });
  });
}

function releaseSlot() {
  activeExports = Math.max(0, activeExports - 1);
  const next = waitingQueue.shift();
  if (next) {
    next.resolve();
  }
}

export async function withPdfRenderSlot(work) {
  await acquireSlot();
  try {
    return await work();
  } finally {
    releaseSlot();
  }
}

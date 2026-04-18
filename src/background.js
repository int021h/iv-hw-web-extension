const DEFAULT_BACKEND = 'https://hw-api.pankov.dev';
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 30;
const MAX_QUEUE = 500;

let queue = [];
let flushTimer = null;
let flushing = false;

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.local.get('backendUrl');
  const url = (backendUrl && backendUrl.trim()) || DEFAULT_BACKEND;
  return url.replace(/\/+$/, '');
}

async function getStats() {
  const { stats } = await chrome.storage.local.get('stats');
  return stats || {};
}

async function patchStats(patch) {
  const prev = await getStats();
  await chrome.storage.local.set({ stats: { ...prev, ...patch } });
}

async function flush() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    const batch = queue.splice(0, queue.length);
    const base = await getBackendUrl();

    const byPlayer = new Map();
    for (const item of batch) {
      const pid = item.playerId || 'unknown';
      if (!byPlayer.has(pid)) byPlayer.set(pid, []);
      byPlayer.get(pid).push(...item.calls);
    }

    let sent = 0;
    let failed = 0;
    for (const [playerId, calls] of byPlayer) {
      try {
        const res = await fetch(`${base}/api/hw/har/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId, calls })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        sent += calls.length;
      } catch (e) {
        failed += calls.length;
        console.warn('[HW-EXT-BG] flush failed:', e.message);
        if (queue.length + calls.length <= MAX_QUEUE) {
          queue.push({ playerId, calls });
        }
      }
    }

    const prev = await getStats();
    await patchStats({
      lastSyncAt: new Date().toISOString(),
      lastSyncSent: sent,
      lastSyncFailed: failed,
      totalSent: (prev.totalSent || 0) + sent
    });
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush();
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'rpc-capture') {
    if (queue.length < MAX_QUEUE) {
      queue.push(msg.payload);
    }
    patchStats({
      lastCaptureAt: new Date().toISOString(),
      playerId: msg.payload.playerId || null,
      queueSize: queue.length
    });
    if (queue.length >= FLUSH_BATCH_SIZE) {
      flush();
    } else {
      scheduleFlush();
    }
    reply && reply({ ok: true });
  } else if (msg && msg.type === 'force-flush') {
    flush().then(() => reply && reply({ ok: true }));
    return true;
  }
});
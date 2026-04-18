const $ = (id) => document.getElementById(id);

function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString(); } catch { return '—'; }
}

async function refresh() {
  const { stats, backendUrl } = await chrome.storage.local.get(['stats', 'backendUrl']);
  const s = stats || {};
  $('playerId').textContent = s.playerId || '—';
  $('queueSize').textContent = s.queueSize || 0;
  $('lastCapture').textContent = fmtTime(s.lastCaptureAt);
  $('lastSync').textContent = fmtTime(s.lastSyncAt);
  $('totalSent').textContent = s.totalSent || 0;
  $('lastFailed').textContent = s.lastSyncFailed || 0;
  if (document.activeElement !== $('backendUrl')) {
    $('backendUrl').value = backendUrl || '';
  }
}

$('save').onclick = async () => {
  await chrome.storage.local.set({ backendUrl: $('backendUrl').value.trim() });
  refresh();
};

$('flush').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'force-flush' });
  setTimeout(refresh, 300);
};

refresh();
setInterval(refresh, 1000);
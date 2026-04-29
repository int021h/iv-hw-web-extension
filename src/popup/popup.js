const $ = (id) => document.getElementById(id);

const WARDEN_URL_PROD = 'https://warden.pankov.dev';
const WARDEN_URL_DEV = 'http://localhost:3000';

const ROLE_LABELS = {
  MASTER: 'Мастер',
  GENERAL: 'Генерал',
  OFFICER: 'Офицер',
  MEMBER: 'Участник',
};

function formatAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '—';
  if (diff < 60_000) return `${Math.floor(diff / 1000)} сек назад`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`;
  return `${Math.floor(diff / 86_400_000)} д назад`;
}

/** Две буквы из имени: "VanDerVill" → "VD", "Вера" → "ВЕ". Для нечитаемых — "?". */
function initials(name) {
  if (!name) return '?';
  const clean = name.trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  // Один токен — берём первые две буквы
  return clean.slice(0, 2).toUpperCase();
}

/**
 * Вычисляет текущее состояние синхронизации:
 *  - ok: всё идёт штатно
 *  - warn: очередь копится И давно не было успешной отправки
 *  - error: последний батч упал
 *  - idle: ещё не входил в игру
 */
function computeStatus(stats) {
  if (!stats?.authName) {
    return { state: 'idle', text: 'Зайди в игру чтобы начать передачу' };
  }

  if (stats.lastSyncFailed > 0) {
    return { state: 'error', text: `Ошибка отправки (${stats.lastSyncFailed} звонков не дошло)` };
  }

  if (stats.queueSize > 0) {
    // Реально «застряло» только если давно не было успешной отправки. Иначе — просто
    // батч между flush'ами (FLUSH_INTERVAL = 5 сек).
    const syncAge = stats.lastSyncAt ? Date.now() - new Date(stats.lastSyncAt).getTime() : Infinity;
    if (syncAge > 60_000) {
      return { state: 'warn', text: `Очередь не уходит (${stats.queueSize} записей)` };
    }
    return { state: 'ok', text: 'Собираем данные…' };
  }

  if (stats.lastSyncAt) {
    return { state: 'ok', text: `Синхронизировано · ${stats.authName}` };
  }

  return { state: 'idle', text: 'Ожидание данных из игры…' };
}

async function refresh() {
  const { stats } = await chrome.storage.local.get('stats');
  const s = stats || {};

  // ----- Карточка игрока -----
  const role = s.authRole || 'UNKNOWN';
  const name = s.authName || '—';

  $('avatar').dataset.role = role;
  $('avatar').textContent = s.authName ? initials(s.authName) : '?';

  $('name').textContent = name;
  $('guild').textContent = s.authGuild || '—';

  $('roleBadge').dataset.role = role;
  $('roleBadge').textContent = ROLE_LABELS[role] || '—';

  $('ownerBadge').hidden = !s.authIsOwner;

  // ----- Статус -----
  const status = computeStatus(s);
  $('status').dataset.state = status.state;
  $('statusText').textContent = status.text;

  // ----- Статистика -----
  $('queueSize').textContent = s.queueSize || 0;
  $('lastCapture').textContent = formatAgo(s.lastCaptureAt);
  $('lastSync').textContent = formatAgo(s.lastSyncAt);
  $('totalSent').textContent = s.totalSent || 0;

  const failed = s.lastSyncFailed || 0;
  $('failedRow').hidden = failed === 0;
  $('lastFailed').textContent = failed;
}

async function showBackend() {
  let isDev = false;
  try {
    const info = await chrome.management.getSelf();
    isDev = info.installType === 'development';
  } catch { /* ignore — оставляем PROD по умолчанию */ }
  $('backend').textContent = isDev
    ? 'localhost + warden-api.pankov.dev (DEV)'
    : 'warden-api.pankov.dev';
  $('wardenLink').href = isDev ? WARDEN_URL_DEV : WARDEN_URL_PROD;
}

function showVersion() {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
}

showVersion();
showBackend();
refresh();
setInterval(refresh, 1000);
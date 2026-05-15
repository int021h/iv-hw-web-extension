const $ = (id) => document.getElementById(id);

const WARDEN_URL_PROD = 'https://warden.pankov.dev';
const WARDEN_URL_DEV = 'http://localhost:3000';

const ROLE_KEYS = {
  MASTER: 'role_MASTER',
  GENERAL: 'role_GENERAL',
  OFFICER: 'role_OFFICER',
  MEMBER: 'role_MEMBER',
};

function formatAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '—';
  if (diff < 60_000)     return HWI18N.t('ago_sec', Math.floor(diff / 1000));
  if (diff < 3_600_000)  return HWI18N.t('ago_min', Math.floor(diff / 60_000));
  if (diff < 86_400_000) return HWI18N.t('ago_hr',  Math.floor(diff / 3_600_000));
  return                       HWI18N.t('ago_day', Math.floor(diff / 86_400_000));
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
    return { state: 'idle', text: HWI18N.t('status_login') };
  }

  if (stats.lastSyncFailed > 0) {
    return { state: 'error', text: HWI18N.t('status_error', stats.lastSyncFailed) };
  }

  if (stats.queueSize > 0) {
    // Реально «застряло» только если давно не было успешной отправки. Иначе — просто
    // батч между flush'ами (FLUSH_INTERVAL = 5 сек).
    const syncAge = stats.lastSyncAt ? Date.now() - new Date(stats.lastSyncAt).getTime() : Infinity;
    if (syncAge > 60_000) {
      return { state: 'warn', text: HWI18N.t('status_warn', stats.queueSize) };
    }
    return { state: 'ok', text: HWI18N.t('status_collecting') };
  }

  if (stats.lastSyncAt) {
    return { state: 'ok', text: HWI18N.t('status_synced', stats.authName) };
  }

  return { state: 'idle', text: HWI18N.t('status_idle') };
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
  $('roleBadge').textContent = ROLE_KEYS[role] ? HWI18N.t(ROLE_KEYS[role]) : '—';

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

/**
 * Подсветка активной кнопки переключателя. Override="" (атрибут data-locale=""):
 * режим «Авто» — словарь грузится по chrome.i18n.getUILanguage().
 */
async function renderLocaleToggle() {
  const override = await HWI18N.getOverride();   // 'ru' | 'en' | null
  document.querySelectorAll('#localeToggle button').forEach(btn => {
    const value = btn.dataset.locale || null;
    btn.classList.toggle('active', value === override);
  });
}

function attachLocaleToggle() {
  document.getElementById('localeToggle').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-locale]');
    if (!btn) return;
    const value = btn.dataset.locale || null;   // '' → null = очистка override (Авто)
    await HWI18N.setOverride(value);
    HWI18N.applyDom();
    await renderLocaleToggle();
    await refresh();        // перерисовать ROLE_LABELS, status и т.п.
  });
}

(async function main() {
  await HWI18N.init();
  document.documentElement.lang = HWI18N.getLocale();   // accessibility
  HWI18N.applyDom();        // подставить data-i18n
  attachLocaleToggle();
  await renderLocaleToggle();
  showVersion();
  await showBackend();
  await refresh();
  setInterval(refresh, 1000);
})();
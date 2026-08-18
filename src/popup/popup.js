const $ = (id) => document.getElementById(id);
// Хосты — из общего src/config.js (HW_CONFIG), подключён в popup.html до этого файла.

const ROLE_KEYS = {
  MASTER: 'role_MASTER',
  GENERAL: 'role_GENERAL',
  OFFICER: 'role_OFFICER',
  MEMBER: 'role_MEMBER',
};

/* =========================================================================
 * Игровые визуалы: портрет (аватарка + рамка) и флаг гильдии — как в игре.
 *
 * Ассеты и словарь резолва id → путь берём ВСЕГДА с прод-API: это публичный
 * статический игровой контент (Access.PUBLIC, Cache-Control сутки), от
 * DEV/PROD-режима расширения не зависит, и в DEV работает при потушенном
 * локальном бэке. Любой сбой деградирует в текущие фолбэки (инициалы / 🛡).
 * ========================================================================= */

const ASSET_API = HW_CONFIG.API_PROD;

/** Палитра цветов гильдейских флагов (индексы 0..19 из игры) — копия CLAN_PALETTE сайта. */
const CLAN_PALETTE = [
  '#e41d18', '#4990f4', '#5ba526', '#ffe025', '#b0e721',
  '#ff8b24', '#ffa2e4', '#3e3e3e', '#2e9588', '#54e8ff',
  '#9465ff', '#d465ff', '#ff65a9', '#ff1e5b', '#b05c03',
  '#828282', '#2857e7', '#28e7b7', '#a5ff87', '#ffffff',
];

const assetUrl = (path) => `${ASSET_API}/api/hw/asset/${path}.png`;

const paletteColor = (idx, fallback) =>
  (idx == null || idx < 0 || idx >= CLAN_PALETTE.length) ? fallback : CLAN_PALETTE[idx];

/** Словарь `GET /player-avatars` ({avatars:{id:path}, borders:{id:path}}), memo на попап. */
let avatarDictPromise = null;
function loadAvatarDict() {
  if (avatarDictPromise === null) {
    avatarDictPromise = fetch(`${ASSET_API}/api/hw/gamedata/player-avatars`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
  }
  return avatarDictPromise;
}

/** PNG → ImageBitmap через fetch: host_permissions снимает CORS, canvas не таинтится. */
async function loadBitmap(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch {
    return null;
  }
}

/**
 * Портрет игрока. Пока картинки нет (нет id, словаря, ассета или сети) — виден
 * фолбэк-квадрат с инициалами; при успешной загрузке аватарки он подменяется.
 * Рамка независима: без неё рисуется тонкое кольцо (как на сайте).
 */
async function renderPortrait(s) {
  const avatarImg = $('portraitAvatar');
  const borderImg = $('portraitBorder');
  const ring = $('portraitRing');

  const showFallback = () => {
    $('avatar').hidden = false;
    avatarImg.hidden = true;
    borderImg.hidden = true;
    ring.hidden = true;
  };

  if (!s.authAvatarId) { showFallback(); return; }
  const dict = await loadAvatarDict();
  const avatarPath = dict?.avatars?.[s.authAvatarId];
  if (!avatarPath) { showFallback(); return; }

  avatarImg.onload = () => {
    $('avatar').hidden = true;
    avatarImg.hidden = false;
  };
  avatarImg.onerror = showFallback;
  avatarImg.src = assetUrl(avatarPath);

  const borderPath = s.authBorderId ? dict?.borders?.[s.authBorderId] : null;
  if (borderPath) {
    borderImg.onload = () => { borderImg.hidden = false; ring.hidden = true; };
    borderImg.onerror = () => { borderImg.hidden = true; ring.hidden = false; };
    borderImg.src = assetUrl(borderPath);
  } else {
    borderImg.hidden = true;
    ring.hidden = false;
  }
}

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Узор флага. PNG из игры — маска каналов, не силуэт: красный канал = зона узора
 * (flagColor1), зелёный = зона фона (flagColor2). Перекрашиваем попиксельно: альфа
 * результата = R·A (фон уже залит цветом под узором, антиалиас краёв смешивается сам).
 */
function recolorPattern(bmp, colorHex) {
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  const [r, g, b] = hexToRgb(colorHex);
  for (let i = 0; i < p.length; i += 4) {
    const coverage = (p[i] / 255) * (p[i + 3] / 255);
    p[i] = r; p[i + 1] = g; p[i + 2] = b;
    p[i + 3] = Math.round(coverage * 255);
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

/**
 * Тонировка символа в iconColor — алгоритм IconPng сайта: плоская заливка по
 * альфа-маске + оригинал поверх multiply/0.5 (проявляет внутренние линии ETC2-декода).
 */
function tintSymbol(bmp, colorHex) {
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.5;
  ctx.drawImage(bmp, 0, 0);
  return c;
}

/**
 * Флаг гильдии на canvas — рендер GuildFlag сайта: круг цвета flagColor2, узор
 * flagShape цвета flagColor1 (cover по кругу), символ iconShape цвета iconColor в
 * центральном боксе 51×62% (meet), ободок цвета iconColor. Индексы ассетов в игре
 * с нуля, файлы CDN — с единицы (+1). Вернёт false, если рисовать нечего.
 */
async function renderGuildFlag(icon) {
  const canvas = $('guildFlag');
  if (!icon || icon.flagColor2 == null) return false;

  const bg = paletteColor(icon.flagColor2, CLAN_PALETTE[0]);
  const patternColor = paletteColor(icon.flagColor1, bg);
  const iconColor = paletteColor(icon.iconColor, '#ffffff');
  const [patternBmp, symbolBmp] = await Promise.all([
    icon.flagShape != null
      ? loadBitmap(assetUrl(`icons/clan_icons/clan_icon_patterns/clan_icon_pattern_x2_${icon.flagShape + 1}`))
      : null,
    icon.iconShape != null
      ? loadBitmap(assetUrl(`icons/clan_icons/clan_icon_symbols/clan_icon_symbol_x2_${icon.iconShape + 1}`))
      : null,
  ]);

  const S = canvas.width;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  if (patternBmp) {
    // preserveAspectRatio slice: заполняем круг по меньшей стороне, центрируем.
    const tinted = recolorPattern(patternBmp, patternColor);
    const scale = Math.max(S / tinted.width, S / tinted.height);
    const w = tinted.width * scale;
    const h = tinted.height * scale;
    ctx.drawImage(tinted, (S - w) / 2, (S - h) / 2, w, h);
  }

  if (symbolBmp) {
    // Центральный бокс иконки 51×62 в координатах 100×100 (ICON_BOX сайта), meet.
    const bw = 0.51 * S;
    const bh = 0.62 * S;
    const scale = Math.min(bw / symbolBmp.width, bh / symbolBmp.height);
    const w = symbolBmp.width * scale;
    const h = symbolBmp.height * scale;
    ctx.drawImage(tintSymbol(symbolBmp, iconColor), 0.245 * S + (bw - w) / 2, 0.19 * S + (bh - h) / 2, w, h);
  }
  ctx.restore();

  // Ободок цвета iconColor — как border у GuildFlag.
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
  ctx.strokeStyle = iconColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  return true;
}

/**
 * Перерисовка визуалов только при смене входных данных: refresh() тикает раз в
 * секунду, а тут сетевые загрузки. Ошибка сети не ретраится до следующего
 * изменения stats/переоткрытия попапа — фолбэки и так на экране.
 */
let lastVisualKey = null;
function renderGameVisuals(s) {
  const key = JSON.stringify([s.authAvatarId, s.authBorderId, s.authClanIcon]);
  if (key === lastVisualKey) return;
  lastVisualKey = key;

  renderPortrait(s);
  renderGuildFlag(s.authClanIcon).then(drawn => {
    $('guildFlag').hidden = !drawn;
    $('guild').classList.toggle('has-flag', drawn);
  });
}

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

  // ----- Игровой портрет и флаг гильдии (лениво, только при смене данных) -----
  renderGameVisuals(s);

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
  const apiHost = new URL(HW_CONFIG.API_PROD).host;
  $('backend').textContent = isDev ? `localhost + ${apiHost} (DEV)` : apiHost;
  $('wardenLink').href = isDev ? HW_CONFIG.SITE_DEV : HW_CONFIG.SITE_PROD;
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
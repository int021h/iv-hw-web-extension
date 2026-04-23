// Хардкод: адрес бэка — не настраивается пользователем. Чтобы сменить — bump версию расширения и пересобрать.
const BACKEND_URL = 'https://warden-api.pankov.dev';
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 30;
const MAX_QUEUE = 500;

let queue = [];
let flushTimer = null;
let flushing = false;

// Service worker в MV3 засыпает через ~30 сек неактивности, и при пробуждении
// `queue` начинается с нуля (in-memory). Синхронизируем stats.queueSize на старте,
// иначе popup и бейдж показывают стейл-значение от прошлой жизни SW.
(async () => {
  try {
    const { stats } = await chrome.storage.local.get('stats');
    const fresh = { ...(stats || {}), queueSize: 0 };
    await chrome.storage.local.set({ stats: fresh });
    updateBadge(fresh);
  } catch { /* ignore */ }
})();

function getBackendUrl() {
  return BACKEND_URL.replace(/\/+$/, '');
}

async function getStats() {
  const { stats } = await chrome.storage.local.get('stats');
  return stats || {};
}

async function patchStats(patch) {
  const prev = await getStats();
  const next = { ...prev, ...patch };
  await chrome.storage.local.set({ stats: next });
  updateBadge(next);
}

/**
 * Рассылает в content-script каждой открытой вкладки hero-wars-alliance.com
 * список методов, только что успешно отправленных на бэк. Content.js рендерит
 * toast-уведомления в правом верхнем углу страницы игры.
 */
async function broadcastToastToGameTabs(methods) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.hero-wars-alliance.com/*' });
    for (const tab of tabs) {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: 'hw-toast', methods }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[HW-EXT-BG] broadcastToast failed:', e.message);
  }
}

/**
 * Обновляет бейдж на иконке расширения. Бейдж рисуется только когда надо
 * привлечь внимание — в норме иконка чистая:
 *  - жёлтый N когда в очереди N записей (ждут flush'а)
 *  - красный '!' когда был fail последнего батча
 *  - пусто во всех остальных случаях (в т.ч. «всё синхронизировано»)
 */
function updateBadge(stats) {
  const action = chrome.action;
  if (!action) return;

  if (stats.lastSyncFailed > 0) {
    action.setBadgeText({ text: '!' });
    action.setBadgeBackgroundColor({ color: '#dc2626' });
    return;
  }
  if (stats.queueSize > 0) {
    action.setBadgeText({ text: String(Math.min(stats.queueSize, 99)) });
    action.setBadgeBackgroundColor({ color: '#f59e0b' });
    return;
  }
  action.setBadgeText({ text: '' });
}

async function flush() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    const batch = queue.splice(0, queue.length);
    const base = getBackendUrl();

    const byPlayer = new Map();
    for (const item of batch) {
      const pid = item.playerId || 'unknown';
      if (!byPlayer.has(pid)) byPlayer.set(pid, []);
      byPlayer.get(pid).push(...item.calls);
    }

    let sent = 0;
    let failed = 0;
    const sentMethods = [];
    for (const [playerId, calls] of byPlayer) {
      try {
        const res = await fetch(`${base}/api/hw/har/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId, calls })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        sent += calls.length;
        for (const c of calls) if (c?.method) sentMethods.push(c.method);
      } catch (e) {
        failed += calls.length;
        console.warn('[HW-EXT-BG] flush failed:', e.message);
        if (queue.length + calls.length <= MAX_QUEUE) {
          queue.push({ playerId, calls });
        }
      }
    }

    if (sentMethods.length > 0) broadcastToastToGameTabs(sentMethods);

    const prev = await getStats();
    await patchStats({
      lastSyncAt: new Date().toISOString(),
      lastSyncSent: sent,
      lastSyncFailed: failed,
      totalSent: (prev.totalSent || 0) + sent,
      // Важно: queueSize выставляем в реальное значение после flush'а.
      // Без этого popup показывает стейл-значение от последнего capture, и при
      // отсутствии новых вызовов «зависает» на старом числе → статус ошибочно
      // переключается в warn через 30 сек.
      queueSize: queue.length
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

/**
 * При каждом перехваченном user_getClanInfo дёргаем /api/auth/exchange.
 * Backend апсертит пользователя/гильдию и ставит HttpOnly JWT-куку на .pankov.dev,
 * после чего web-client на hw.pankov.dev автоматически авторизован.
 * credentials: 'include' обязательно — иначе браузер не сохранит Set-Cookie в jar.
 */
async function authExchange(playerId, clanInfoResponse) {
  if (!playerId || !clanInfoResponse) return;
  const base = getBackendUrl();
  console.log('[HW-EXT-BG] → POST /exchange', base, 'playerId=', playerId);
  try {
    const res = await fetch(`${base}/api/auth/exchange`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: parseInt(playerId, 10),
        clanInfoResponse
      })
    });
    if (!res.ok) {
      console.warn('[HW-EXT-BG] /exchange failed:', res.status);
      return;
    }
    const data = await res.json();

    // В Chrome MV3 fetch из service worker'а пишет Set-Cookie в изолированный partition,
    // недоступный веб-вкладкам. Поэтому ставим куку явно через chrome.cookies API — так она
    // попадёт в общий cookie jar и будет отправляться с warden.pankov.dev на warden-api.pankov.dev.
    if (data.token) {
      try {
        const cookie = await chrome.cookies.set({
          url: `${base}/`,
          name: 'hw_session',
          value: data.token,
          domain: '.pankov.dev',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          expirationDate: Math.floor(Date.now() / 1000) + 3600
        });
        if (cookie) {
          console.log('[HW-EXT-BG] cookie установлена:', cookie.domain, cookie.name);
        } else {
          console.warn('[HW-EXT-BG] chrome.cookies.set вернул null — проверь host_permissions');
        }
      } catch (e) {
        console.warn('[HW-EXT-BG] не удалось поставить cookie:', e.message);
      }
    }

    // Дополнительно тащим game-данные о себе из исходного ответа clanInfoResponse
    // (бэк их не возвращает, но они есть в members[playerId]).
    const pidStr = String(playerId);
    const myMember = clanInfoResponse?.clanData?.clan?.members?.[pidStr] || null;
    const clanIcon = clanInfoResponse?.clanData?.clan?.icon || null;

    await patchStats({
      authName: data.user?.name || null,
      authGuild: data.user?.guild?.name || null,
      authRole: data.user?.guildRole || null,
      authIsOwner: !!data.user?.isOwner,
      authLevel: myMember?.level || null,
      authAvatarId: myMember?.avatarId || null,
      authBorderId: myMember?.borderId || null,
      authClanIcon: clanIcon,
      authAt: new Date().toISOString()
    });
    console.log('[HW-EXT-BG] auth exchange ok:', data.user?.name, data.user?.guildRole);
  } catch (e) {
    console.warn('[HW-EXT-BG] /exchange error:', e.message);
  }
}

/**
 * user_getClanInfo прилетает в login-батче, до того как появится header x-auth-player-id.
 * Поэтому буферизуем clanInfoResponse в chrome.storage и вызываем /exchange как только
 * любой следующий батч принесёт playerId.
 */
async function tryExchange(payload) {
  const clanInfoCall = payload.calls.find(c => c.method === 'user_getClanInfo');

  if (clanInfoCall && clanInfoCall.response) {
    if (payload.playerId) {
      authExchange(payload.playerId, clanInfoCall.response);
      await chrome.storage.local.remove('pendingClanInfo');
      return;
    }
    await chrome.storage.local.set({ pendingClanInfo: clanInfoCall.response });
    console.log('[HW-EXT-BG] user_getClanInfo буферизован (ждём playerId в следующих батчах)');
    return;
  }

  if (payload.playerId) {
    const { pendingClanInfo } = await chrome.storage.local.get('pendingClanInfo');
    if (pendingClanInfo) {
      console.log('[HW-EXT-BG] обмен из буфера — playerId появился:', payload.playerId);
      authExchange(payload.playerId, pendingClanInfo);
      await chrome.storage.local.remove('pendingClanInfo');
    }
  }
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

    tryExchange(msg.payload);

    if (queue.length >= FLUSH_BATCH_SIZE) {
      flush();
    } else {
      scheduleFlush();
    }
    reply && reply({ ok: true });
  }
});
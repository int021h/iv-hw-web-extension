// Конфиг автоматически переключается между prod и dev в зависимости от
// способа установки расширения:
//   - "Load unpacked" из исходников   → installType === 'development' → fan-out: localhost + prod
//   - установка из Chrome Web Store   → installType === 'normal'      → только prod
// chrome.management.getSelf() — единственный метод management-namespace,
// который НЕ требует permission "management" в манифесте (самоинтроспекция).
//
// В DEV расширение шлёт каждый перехваченный батч (HAR ingest и auth-exchange) в ОБА бэка
// параллельно. Куки ставятся для каждого target'а в свой домен — конфликта нет, разные scope:
// `localhost` cookie шлётся только на localhost-fetch'и, `.pankov.dev` cookie только на prod.
// Это позволяет одной игровой сессии «прокармливать» и локалку (для тестирования), и прод
// (чтобы реальные уведомления/обновления не страдали).
// PROD: основной API-хост — api.hw-warden.com. Легаси-хост warden-api.pankov.dev ведёт на тот же
// бэкенд ms-hw и доживает переходный период (пока все копии расширения не авто-обновятся) —
// после чего будет погашен. /exchange делаем ОДИН раз (бэк один), а полученный JWT кладём в куку
// ОБОИХ доменов: токен валиден независимо от домена, так и hw-warden.com, и легаси
// warden.pankov.dev авторизованы без двойного обращения к бэку и без риска двойных
// side-effect'ов (upsert/уведомления при exchange).
const PROD_TARGET = {
    url: 'https://api.hw-warden.com',
    cookies: [
        { url: 'https://api.hw-warden.com/',     domain: '.hw-warden.com', secure: true },
        { url: 'https://warden-api.pankov.dev/', domain: '.pankov.dev',    secure: true },
    ],
};
const LOCAL_TARGET = {
    url: 'http://localhost:9102',
    cookies: [
        { url: 'http://localhost:9102/', domain: 'localhost', secure: false },
    ],
};
let configPromise = null;
function getConfig() {
    if (configPromise === null) {
        configPromise = (async () => {
            const info = await chrome.management.getSelf();
            const isDev = info.installType === 'development';
            const targets = isDev ? [LOCAL_TARGET, PROD_TARGET] : [PROD_TARGET];
            console.log('[HW-EXT-BG] mode:', isDev ? 'DEV' : 'PROD', '→ targets:', targets.map(t => t.url).join(', '));
            return { isDev, targets };
        })();
    }
    return configPromise;
}

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
    const cfg = await getConfig();  // прогрев — лог режима в консоли SW сразу при старте
    const { stats } = await chrome.storage.local.get('stats');
    const fresh = { ...(stats || {}), queueSize: 0 };
    await chrome.storage.local.set({ stats: fresh });
    updateBadge(fresh);

    // CDN-icon collector — DEV-only. В prod-сборку host_permission и `webRequest`
    // permission вырезается build.ps1, поэтому регистрировать listener бессмысленно
    // (а попытка вызвать chrome.webRequest без разрешения тихо падает).
    if (cfg.isDev) {
        initAssetUrlCollector(cfg);
        // Недоставленные asset/seen с прошлой жизни SW — допинать сразу при старте
        // (alarm мог не дожить до рестарта браузера, storage-очередь — доживает).
        flushAssetQueue(cfg);
    }
    if (cfg.isDev) initGameDataDumper();
  } catch { /* ignore */ }
})();

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
    const cfg = await getConfig();

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
      // Шлём в каждый target параллельно. Считаем batch принятым если хотя бы один target ответил OK
      // (если localhost не запущен, но прод доступен — данные не теряются, реальная работа продолжается).
      const results = await Promise.allSettled(cfg.targets.map(async (t) => {
        // credentials: 'include' — без него MV3 SW fetch на кросс-ориджин не аттачит
        // hw_session куку, и бэк (HarIngestService) не публикует InventoryGet/HeroGetAll
        // события, потому что не может атрибутировать данные владельцу.
        const res = await fetch(`${t.url}/api/hw/har/ingest`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId, calls })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }));

      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn('[HW-EXT-BG] ingest failed:', cfg.targets[i].url, '→', r.reason.message);
        }
      });

      const anyOk = results.some(r => r.status === 'fulfilled');
      if (anyOk) {
        sent += calls.length;
        for (const c of calls) if (c?.method) sentMethods.push(c.method);
      } else {
        failed += calls.length;
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
 * exp (unix-секунды) из payload'а JWT — чтобы срок куки совпадал со сроком токена,
 * какой бы TTL ни настроил бэкенд. null, если токен не разобрался.
 */
function jwtExpirationSeconds(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp = JSON.parse(atob(payload)).exp;
    return Number.isFinite(exp) ? exp : null;
  } catch (_) {
    return null;
  }
}

/**
 * При каждом перехваченном user_getClanInfo дёргаем /api/auth/exchange.
 * Backend апсертит пользователя/гильдию и возвращает JWT, который кладётся в куку
 * обоих сайтов (hw-warden.com + легаси warden.pankov.dev) — web-client сразу авторизован.
 * credentials: 'include' обязательно — иначе браузер не сохранит Set-Cookie в jar.
 */
async function authExchange(playerId, clanInfoResponse) {
  if (!playerId || !clanInfoResponse) return;
  const cfg = await getConfig();
  console.log('[HW-EXT-BG] → POST /exchange playerId=', playerId, 'targets=', cfg.targets.map(t => t.url).join(', '));

  // В Chrome MV3 fetch из service worker'а пишет Set-Cookie в изолированный partition,
  // недоступный веб-вкладкам. Поэтому ставим куку явно через chrome.cookies API — так она
  // попадёт в общий cookie jar браузера и будет отправляться при кросс-фетчах с web-страниц.
  // Каждый target → своя кука в свой scope (`localhost` vs `.hw-warden.com`), не конфликтуют.
  const results = await Promise.allSettled(cfg.targets.map(async (target) => {
    const res = await fetch(`${target.url}/api/auth/exchange`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: parseInt(playerId, 10),
        clanInfoResponse
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.token) {
      // Один токен → кука во все cookie-scope'ы цели (PROD: и .hw-warden.com, и .pankov.dev),
      // чтобы оба сайта (hw-warden.com и легаси warden.pankov.dev) подхватили сессию.
      for (const scope of target.cookies) {
        const cookie = await chrome.cookies.set({
          url: scope.url,
          name: 'hw_session',
          value: data.token,
          domain: scope.domain,
          path: '/',
          httpOnly: true,
          secure: scope.secure,
          sameSite: 'lax',
          // Срок куки = exp самого JWT: бэк выдаёт токен на 30 дней и скользяще
          // продлевает куку своими ответами (JwtCookieFilter). Захардкоженный здесь
          // час перебивал серверный TTL и убивал сессию сайта после каждого захода в игру.
          expirationDate: jwtExpirationSeconds(data.token) ?? Math.floor(Date.now() / 1000) + 30 * 24 * 3600
        });
        if (cookie) {
          console.log('[HW-EXT-BG] cookie установлена:', cookie.domain, '←', target.url);
        } else {
          console.warn('[HW-EXT-BG] chrome.cookies.set вернул null:', scope.url, '— проверь host_permissions');
        }
      }
    }
    return data;
  }));

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn('[HW-EXT-BG] /exchange failed:', cfg.targets[i].url, '→', r.reason.message);
    }
  });

  // patchStats — один раз из первого успешного target'а. Данные пользователя у обоих идентичны
  // (одинаковый playerId, один clanInfoResponse), отличается только токен/cookie scope.
  const firstOk = results.find(r => r.status === 'fulfilled');
  if (firstOk) {
    const data = firstOk.value;
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

    // Кука только что установлена в jar — форс-флашим всё, что накопилось ДО /exchange.
    // Без этого пре-auth батчи (включая первый inventoryGet/heroGetAll на cold-start
    // игры) уехали бы по обычному 5-сек таймеру; а если бы flush сработал раньше
    // /exchange (batch hit 30 → immediate flush), они бы вообще ушли без куки и бэк
    // молча дропнул бы InventoryGet/HeroGetAll события.
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (queue.length > 0) flush();
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

// ============================================================
// CDN asset collector (DEV-only)
// ============================================================
// Игра тащит с CDN кучу `.img` (иконки предметов, аватары героев, флаги, фоны и т.п.)
// по шаблону:
//   https://heroesmobile-a-cdn.nextersglobal.com/v/webgl/<version>/v0001/extends/<path>.img
// Подписываемся на webRequest, вырезаем каноничный `<path>` (всё после `/extends/`
// без `.img`) и батчами шлём на ms-hw → upsert в hw.game_asset. Сервер потом сам
// решает какие пути декодировать в PNG (по запросу из UI) — здесь только реестр.
//
// Только DEV: в prod-сборке для Chrome Web Store webRequest и host CDN вырезаются
// build.ps1, и эта функция вообще не вызывается (см. инициализацию выше).
// Никакой kind/gid классификации тут — фронт сам строит assetPath из доменных
// (kind, gameId), а реестр нужен бэку только чтобы знать какие URL он видел.

const ASSET_PATH_RE = /\/extends\/(.+?)\.img(?:\?|$)/;

const ASSET_FLUSH_MS = 10000;
const ASSET_BATCH_SIZE = 50;
const ASSET_MAX_QUEUE = 500;

// Per-target очередь недоставленного. Провал POST'а на конкретный target (деплой прода,
// сеть, 429) раньше терял батч для него НАВСЕГДА: «успех» считался по любому target'у,
// а in-memory дедуп assetSeen не давал повторного захвата — игра кэширует .img и может
// больше никогда его не скачать. Теперь недоставленное копится в chrome.storage.local
// (переживает выгрузку SW) и допинывается alarm'ом / при старте SW.
const ASSET_PENDING_KEY = 'assetPendingByTarget'; // { [targetUrl]: [{assetPath, assetUrl}] }
const ASSET_PENDING_MAX = 2000;   // на target; при переполнении вытесняется старое с головы
const ASSET_POST_CHUNK = 400;     // сервер (bulkUpsertSafe) молча режет батч по 500 — шлём меньшими кусками
const ASSET_RETRY_ALARM = 'hw-asset-retry';
const ASSET_RETRY_DELAY_MIN = 1;

const assetSeen = new Set(); // assetPath, дедуп захвата в рамках жизни SW
let assetQueue = [];
let assetTimer = null;
let assetFlushing = false;   // storage read-modify-write — параллельные flush'и клобберят pending

function initAssetUrlCollector(cfg) {
    if (!chrome.webRequest || !chrome.webRequest.onBeforeRequest) {
        console.warn('[HW-EXT-BG] webRequest API недоступен, asset collector выключен');
        return;
    }
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            const url = details.url;
            const m = ASSET_PATH_RE.exec(url);
            if (!m) return;
            const assetPath = m[1];
            // Дедуп по path в рамках жизни SW: версия CDN может меняться, но path стабилен.
            if (assetSeen.has(assetPath)) return;
            assetSeen.add(assetPath);
            if (assetQueue.length < ASSET_MAX_QUEUE) {
                assetQueue.push({ assetPath, assetUrl: url });
            }
            if (assetQueue.length >= ASSET_BATCH_SIZE) {
                flushAssetQueue(cfg);
            } else {
                scheduleAssetFlush(cfg);
            }
        },
        { urls: ['*://heroesmobile-a-cdn.nextersglobal.com/*/extends/*.img*'] }
    );
    console.log('[HW-EXT-BG] DEV asset collector активирован');
}

function scheduleAssetFlush(cfg) {
    if (assetTimer) return;
    assetTimer = setTimeout(() => { assetTimer = null; flushAssetQueue(cfg); }, ASSET_FLUSH_MS);
}

/**
 * Отправляет items на один target кусками по [ASSET_POST_CHUNK]. Возвращает число
 * доставленных элементов с начала списка (== items.length если всё ушло) — хвост
 * начиная с первого недоставленного куска вызывающий кладёт в pending.
 */
async function postAssetItems(targetUrl, items) {
    for (let i = 0; i < items.length; i += ASSET_POST_CHUNK) {
        const chunk = items.slice(i, i + ASSET_POST_CHUNK);
        try {
            const res = await fetch(`${targetUrl}/api/hw/asset/seen`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: chunk })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
            console.warn('[HW-EXT-BG] asset/seen failed →', targetUrl,
                `(доставлено ${i}/${items.length}, ретрай через ${ASSET_RETRY_DELAY_MIN} мин):`, e.message);
            return i;
        }
    }
    return items.length;
}

/**
 * Шлёт свежий батч + недоставленные остатки прошлых попыток В КАЖДЫЙ target независимо.
 * Провал одного target'а не влияет на другой: его порция сохраняется в storage и
 * повторяется alarm'ом. Endpoint PUBLIC, но валидируется на сервере (allowed prefixes,
 * лимиты) — мусор отбрасывается молча.
 */
async function flushAssetQueue(cfg) {
    if (assetFlushing) { scheduleAssetFlush(cfg); return; }
    assetFlushing = true;
    try {
        const batch = assetQueue.splice(0, assetQueue.length);
        const { [ASSET_PENDING_KEY]: stored } = await chrome.storage.local.get(ASSET_PENDING_KEY);
        const pending = stored || {};
        let anyOkForBatch = false;
        let havePending = false;

        for (const t of cfg.targets) {
            // pending прошлых попыток + свежий батч, дедуп по assetPath с сохранением порядка.
            const merged = new Map();
            for (const it of (pending[t.url] || [])) merged.set(it.assetPath, it);
            for (const it of batch) merged.set(it.assetPath, it);
            let items = [...merged.values()];
            if (items.length > ASSET_PENDING_MAX) items = items.slice(items.length - ASSET_PENDING_MAX);
            if (items.length === 0) { delete pending[t.url]; continue; }

            const delivered = await postAssetItems(t.url, items);
            if (delivered >= items.length) {
                delete pending[t.url];
                if (batch.length > 0) anyOkForBatch = true;
                console.log('[HW-EXT-BG] asset/seen ok →', t.url, 'items=', items.length);
            } else {
                pending[t.url] = items.slice(delivered);
                havePending = true;
            }
        }

        await chrome.storage.local.set({ [ASSET_PENDING_KEY]: pending });
        // chrome.alarms есть только в DEV-сборке (build.ps1 вырезает permission для CWS);
        // без него ретрай сработает при следующем flush'е или старте SW.
        if (chrome.alarms) {
            if (havePending) {
                chrome.alarms.create(ASSET_RETRY_ALARM, { delayInMinutes: ASSET_RETRY_DELAY_MIN });
            } else {
                chrome.alarms.clear(ASSET_RETRY_ALARM);
            }
        }

        // Toast — только по свежему батчу (ретраи молчат, чтобы не дублировать уведомления).
        if (anyOkForBatch) {
            const paths = batch.map(b => b.assetPath).filter(Boolean);
            if (paths.length > 0) broadcastAssetToastToGameTabs(paths);
        }
    } finally {
        assetFlushing = false;
    }
}

// Ретрай недоставленных батчей. Alarm переживает выгрузку SW: сработка будит SW,
// listener зарегистрирован на top-level (требование MV3). В prod-сборке permission
// `alarms` вырезан build.ps1 — там chrome.alarms undefined, и коллектор не работает вовсе.
if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
        if (alarm.name !== ASSET_RETRY_ALARM) return;
        const cfg = await getConfig();
        if (cfg.isDev) flushAssetQueue(cfg);
    });
}

/**
 * Broadcast в content-script списка assetPath, только что успешно отправленных в ms-hw.
 * Content.js рисует синие toast'ы — отдельная цветовая ветка от обычных RPC-toast'ов,
 * чтобы DEV-ассеты визуально не путались с боевым ingest'ом.
 */
async function broadcastAssetToastToGameTabs(assetPaths) {
    try {
        const tabs = await chrome.tabs.query({ url: 'https://*.hero-wars-alliance.com/*' });
        for (const tab of tabs) {
            if (tab.id != null) {
                chrome.tabs.sendMessage(tab.id, { type: 'hw-asset-toast', assetPaths }).catch(() => {});
            }
        }
    } catch (e) {
        console.warn('[HW-EXT-BG] broadcastAssetToast failed:', e.message);
    }
}

// ============================================================
// Game data dumper (DEV-only)
// ============================================================
// Перехват splitlib.json.zip + ru.json.gz / en.json.gz + JSON-ов remote-config
// (hwmb-remote-config-cdn) и сохранение их в Chrome Downloads под
// `HW/data/<version>/...`. Версия извлекается из path игровой CDN
// (`/v/webgl/<VER>/v0001/...`) и переиспользуется для remote-config файлов,
// у которых в URL нет game-version (только hash).
//
// Чтобы файлы оказывались в D:\HW\data — один раз вне расширения сделать симлинк:
//   mklink /D D:\HW\data %USERPROFILE%\Downloads\HW\data
//
// MV3 не пишет на произвольный путь файловой системы из SW: chrome.downloads.download
// работает только относительно Downloads-папки (Chrome создаёт подпапки сам). Сменить
// глобальную downloads-папку Chrome — альтернатива, но влияет на ВСЕ скачивания
// браузера; симлинк точечнее.
//
// Дедуп по точному URL: для splitlib/translations URL содержит версию в path
// (новая версия → новый URL), для remote-config URL содержит hash. Persist
// в chrome.storage.local чтобы SW-перезапуски не качали повторно.
//
// В prod-сборке build.ps1 вырезает host_permission `hwmb-remote-config-cdn` и
// permission `downloads`, поэтому эта функция вообще не вызывается (cfg.isDev=false).

// URL у вендора: /v/<platform>/<version>/v<manifest>/<hash>/<dir>/<file>
// Пример: /v/an/1.278.0/v0046/53bc272ae7c0148f676a648993bf0aec/lib/splitlib.json.zip
// platform может быть `an` (android), `webgl` и т.п. — берём любой.
// ВАЖНО: v<manifest> в пути — это НЕ номер текущей сборки, а номер сборки, в которой
// ЭТОТ файл последний раз менялся (та же схема, что у картинок под вечным `v0001`).
// Не менявшиеся файлы (типично ru/en.json.gz) игра и на свежей сборке запрашивает
// со старым vNNNN. Текущую сборку задаёт splitlib.json.zip — он меняется каждую
// сборку и приходит первым, поэтому detectedBuild двигается только ВПЕРЁД
// (см. buildIsNewer): отставший manifest перевода не откатывает папку.
// hash в URL различается по файлу (свой content-hash у splitlib / ru / en / каждого
// remote-config), поэтому ни в имя папки, ни в сравнение сборок он не входит.
const URL_PARTS_RE = /\/v\/[a-z0-9]+\/([0-9][0-9.]*)\/(v\d+)\/([a-f0-9]+)\//i;
const SPLITLIB_RE     = /\/splitlib\.json\.zip(?:\?|$)/i;
const TRANSLATION_RE  = /\/(ru|en)\.json\.gz(?:\?|$)/i;
// Remote-config с hwmb-remote-config-cdn имеет вид `/config/<name>/<hash>.json`.
// Из URL вытаскиваем <name> и пускаем дальше только то, что реально потребляет ms-hw —
// иначе листенер забьёт диск десятками вендорских JSON'ов (рейды/башни/локации/...).
const REMOTE_CFG_NAME_RE = /\/config\/([A-Za-z0-9_]+)\/[a-f0-9]+\.json(?:\?|$)/i;
const REMOTE_CFG_WANTED = new Set([
    'squadHeroSkill', 'squadHeroSkillLevel',              // strategic-умения «Царства»
    'personalResearch', 'personalResearchLevel', 'bonus', // Стратегическая База: Технологии
    // realm-эвенты («Осколки Прошлого» и пр.): движок специальных квест-эвентов «Царства».
    // specialQuestEvent → specialQuestGroup → questChain → quest. Эти конфиги immutable
    // (hash в URL) и часто отдаются из кеша игры — на CDN их URL берём из remoteConfigInit.
    'specialQuestEvent', 'specialQuestGroup', 'specialQuestEventView',
    'quest', 'questChain', 'questCondition', 'questResourceMapping',
    // Имена ресурсов наград realm-эвентов (которых нет в game_reward_resource).
    'material', 'lootboxChanced', 'refillableResource', 'unit',
    'speedUpConstruction', 'speedUpResearch', 'speedUpUnitTraining', 'speedUpUniversal',
    // «Путь героя» (Battle Pass): трек наград сезона + кампании. Расписание заданий и
    // сезоны лежат в splitlib.zip, а трек — только тут (remoteConfigInit.index.configs).
    'battlepass',
]);

// Любой *.nextersglobal.com — чтобы поймать splitlib/translations независимо от того,
// на каком конкретно поддомене CDN они лежат (`heroesmobile-a-cdn`, `heroesmobile-mb-cdn`
// и т.п. — у вендора иногда разные субдомены под разные ресурсы). host_permissions
// тоже расширен в manifest.json до `*://*.nextersglobal.com/*` (DEV-only).
const GAMEDATA_URL_PATTERNS = [
    '*://*.nextersglobal.com/*'
];

const SEEN_URLS_MAX = 500;

// Дедуп-ключи уже скачанных файлов — ОДИН разделяемый Set на всю жизнь SW.
// Раньше каждый вызов tryDumpGameData читал свой storage-снапшот, дописывал свой
// ключ и перезаписывал список целиком. При входе в игру listener срабатывает на
// десяток URL почти одновременно: все вызовы стартовали от одного старого снапшота
// и затирали записи друг друга — в storage выживал ключ последнего писателя, и при
// следующем входе «уже скачанные» файлы качались заново.
let seenUrlsPromise = null;
function getSeenUrls() {
    if (!seenUrlsPromise) {
        seenUrlsPromise = chrome.storage.local.get('gamedataSeenUrls')
            .then(({ gamedataSeenUrls }) => new Set(gamedataSeenUrls || []));
    }
    return seenUrlsPromise;
}

// Запись сериализована цепочкой: параллельные storage.set() могут завершиться не по
// порядку, и более старый снапшот затёр бы более новый. Снапшот Set'а берётся внутри
// цепочки — каждый write видит все добавления, сделанные к его моменту.
let persistSeenChain = Promise.resolve();
function persistSeenUrls(seen) {
    persistSeenChain = persistSeenChain
        .then(() => {
            const arr = Array.from(seen);
            const trimmed = arr.length > SEEN_URLS_MAX ? arr.slice(arr.length - SEEN_URLS_MAX) : arr;
            return chrome.storage.local.set({ gamedataSeenUrls: trimmed });
        })
        .catch(e => console.warn('[HW-EXT-BG] persist gamedataSeenUrls failed:', e.message));
    return persistSeenChain;
}

let detectedBuild = null; // { version, manifest, hash } — самая свежая замеченная сборка

/**
 * true, если сборка `fresh` строго новее `current` (или current ещё нет).
 * version сравнивается по числовым сегментам (`1.285.0`), при равенстве —
 * manifest числом (`v0067` > `v0059`). hash не участвует: он свой у каждого файла.
 */
function buildIsNewer(fresh, current) {
    if (!current) return true;
    if (fresh.version !== current.version) {
        const fa = fresh.version.split('.').map(Number);
        const ca = current.version.split('.').map(Number);
        for (let i = 0; i < Math.max(fa.length, ca.length); i++) {
            const d = (fa[i] || 0) - (ca[i] || 0);
            if (d !== 0) return d > 0;
        }
        return false;
    }
    return parseInt(fresh.manifest.slice(1), 10) > parseInt(current.manifest.slice(1), 10);
}

// Активна ли DEV-выгрузка (отработал initGameDataDumper). rpc-capture-листенер
// крутится всегда; этим флагом он отличает DEV от prod, чтобы не дёргать
// chrome.downloads — в prod-сборке этого permission нет.
let gamedataDumperActive = false;

// remote-config'и из remoteConfigInit, пришедшие до того как стала известна
// сборка. Сбрасываются в выгрузку, как только detectedBuild определится.
let pendingRemoteConfigUrls = [];

/** Догоняет отложенные remote-config'и, когда detectedBuild наконец известен. */
function flushPendingRemoteConfigs() {
    if (!detectedBuild || pendingRemoteConfigUrls.length === 0) return;
    const urls = pendingRemoteConfigUrls;
    pendingRemoteConfigUrls = [];
    for (const u of urls) {
        tryDumpGameData(u).catch(e => console.warn('[HW-EXT-BG] pending config dump fail:', e.message));
    }
}

/**
 * Активная выгрузка remote-config по манифесту из RPC `remoteConfigInit`.
 * `index.configs` = `{ <name>: { url, preload }, ... }` — полный список всех
 * конфигов с URL. Берём whitelist'нутые ([REMOTE_CFG_WANTED]) и качаем их сами,
 * не дожидаясь, пока игра запросит их с сети: immutable-конфиги (hash в URL)
 * она часто отдаёт из своего кеша, и пассивный webRequest-листенер их не видит.
 *
 * Дедуп — внутри [tryDumpGameData] (ключ `filename|url`): тот же конфиг в той же
 * сборке повторно не качается, так что на каждый вход в игру лишних скачиваний нет.
 */
function dumpRemoteConfigsFromIndex(index) {
    const configs = index && index.configs;
    if (!configs || typeof configs !== 'object') return;
    let queued = 0;
    for (const name of Object.keys(configs)) {
        if (!REMOTE_CFG_WANTED.has(name)) continue;
        const url = configs[name] && configs[name].url;
        if (!url) continue;
        if (detectedBuild) {
            tryDumpGameData(url).catch(e => console.warn('[HW-EXT-BG] config dump fail:', e.message));
        } else {
            pendingRemoteConfigUrls.push(url);
        }
        queued++;
    }
    if (queued > 0) {
        console.log('[HW-EXT-BG] remoteConfigInit: ' + queued + ' whitelist-конфигов' +
            (detectedBuild ? ' отправлено в выгрузку' : ' отложено до определения сборки'));
    }
}

function initGameDataDumper() {
    if (!chrome.webRequest || !chrome.downloads) {
        console.warn('[HW-EXT-BG] webRequest/downloads API недоступен, gamedata dumper выключен');
        return;
    }
    // Тоже через buildIsNewer: get() асинхронный, и к моменту его резолва ранний
    // webRequest-event мог уже определить более свежую сборку — не затирать её.
    chrome.storage.local.get('gamedataBuild').then(({ gamedataBuild }) => {
        if (gamedataBuild && buildIsNewer(gamedataBuild, detectedBuild)) {
            detectedBuild = gamedataBuild;
        }
    });
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            tryDumpGameData(details.url).catch(e => console.warn('[HW-EXT-BG] gamedata dump fail:', e.message));
        },
        { urls: GAMEDATA_URL_PATTERNS }
    );
    gamedataDumperActive = true;
    console.log('[HW-EXT-BG] DEV gamedata dumper активирован');
}

async function tryDumpGameData(url) {
    const isSplitlib    = SPLITLIB_RE.test(url);
    const trMatch       = TRANSLATION_RE.exec(url);
    const cfgNameMatch  = REMOTE_CFG_NAME_RE.exec(url);
    // <name> конфига, если он в whitelist'е ms-hw; иначе null (чужой remote-config — мимо).
    const cfgName       = cfgNameMatch && REMOTE_CFG_WANTED.has(cfgNameMatch[1]) ? cfgNameMatch[1] : null;

    // Диагностика: видим, какие URL вообще проходят через listener. Без
    // этого классификационный баг (например, splitlib на неизвестном поддомене)
    // невидим, потому что фильтр молча отбрасывает. Логируем только не-классифицированное
    // в `*.json` / `*.json.gz` / `*.json.zip` — чтобы не флудить картинками.
    if (!isSplitlib && !trMatch && !cfgName) {
        if (/\.json(\.gz|\.zip)?(\?|$)/i.test(url)) {
            console.debug('[HW-EXT-BG] gamedata IGNORED (no match):', url);
        }
        return;
    }

    const seen = await getSeenUrls();
    // Дедуп НЕ по одному url: см. dedupKey ниже — иначе version-стабильный remote-config
    // (его URL без версии, только content-hash) скачается лишь однажды и не попадёт в папки
    // последующих сборок игры.

    const partsMatch = URL_PARTS_RE.exec(url);
    if (partsMatch) {
        const fresh = { version: partsMatch[1], manifest: partsMatch[2], hash: partsMatch[3] };
        // Только ВПЕРЁД: manifest в URL — сборка последнего изменения ФАЙЛА, а не текущая.
        // Не менявшийся ru/en.json.gz приходит со старым vNNNN — раньше он откатывал
        // detectedBuild, уезжал в старую папку сам (и его приходилось переносить в папку
        // импорта руками) и утаскивал туда же remote-config'и, у чьих URL версии нет.
        if (buildIsNewer(fresh, detectedBuild)) {
            detectedBuild = fresh;
            chrome.storage.local.set({ gamedataBuild: fresh });
        }
        // Сборка определилась — догоняем remote-config'и, отложенные до этого момента.
        flushPendingRemoteConfigs();
    }
    // Если сборка (version+manifest+hash) ещё не известна — НЕ качаем. Раньше
    // дамп шёл в `unknown-version/`, и при первом запуске игры с пустым кешем туда
    // сваливалось всё подряд. Сборка определится из splitlib/translations URL
    // (он первым приходит с игровой CDN) — после этого конфиги поедут в нужную папку.
    if (!detectedBuild) {
        console.debug('[HW-EXT-BG] gamedata DEFERRED (build unknown):', url);
        return;
    }
    // Папка сборки — version+manifest БЕЗ hash. hash в URL различается ПО ФАЙЛУ
    // (splitlib, ru.json.gz, en.json.gz, remote-config'и — у каждого свой content-hash
    // в пределах одной сборки), поэтому если включать hash в имя папки, файлы одной
    // сборки разъезжаются по разным подпапкам (`v0048-<hashA>` / `v0048-<hashB>`) и их
    // приходится вручную сводить. manifest (`v0048`) бампается на каждую сборку игры —
    // его достаточно как идентификатора. Тройка version+manifest+hash по-прежнему
    // используется в detectedBuild для дедупа (URL несёт hash), но не в имени папки.
    const { version, manifest } = detectedBuild;
    const buildFolder = `${version}/${manifest}`;

    let folder, basename;
    if (isSplitlib) {
        folder = buildFolder;
        basename = 'splitlib.json.zip';
    } else if (trMatch) {
        folder = buildFolder;
        basename = `${trMatch[1].toLowerCase()}.json.gz`;
    } else {
        // remote-config: имя файла = <name> из `/config/<name>/<hash>.json`. Сохраняем
        // стабильным именем (`squadHeroSkill.json`) прямо в папку сборки, рядом со
        // splitlib.json.zip — там его и ищет импорт-скан.
        basename = `${cfgName}.json`;
        folder = buildFolder;
    }

    const filename = `HW/data/${folder}/${basename}`;
    // Дедуп по паре «назначение|источник»: filename несёт версию+сборку, url — content-hash.
    // Version-стабильный конфиг всё равно скачается в КАЖДУЮ новую папку сборки, а внутри
    // одной сборки тот же файл повторно не качается.
    const dedupKey = `${filename}|${url}`;
    if (seen.has(dedupKey)) return;
    // Помечаем ДО download: тот же URL может прийти параллельно из пассивного
    // webRequest-листенера и активной выгрузки remoteConfigInit — второй вызов
    // должен увидеть ключ до того, как первый докачает. При ошибке ключ снимаем.
    seen.add(dedupKey);
    try {
        const downloadId = await chrome.downloads.download({
            url,
            filename,
            saveAs: false,
            conflictAction: 'overwrite'
        });
        console.log('[HW-EXT-BG] gamedata dumped:', filename, 'id=', downloadId);

        // Зеркальная локаль: при перехвате ru.json.gz сразу качаем en.json.gz
        // (и наоборот). Иначе чтобы получить вторую локаль пришлось бы вручную
        // переключать язык в игре — она ленится и грузит только активный.
        if (trMatch) {
            const otherLang = trMatch[1].toLowerCase() === 'ru' ? 'en' : 'ru';
            const otherUrl = url.replace(/\/(ru|en)\.json\.gz/i, `/${otherLang}.json.gz`);
            const otherFilename = `HW/data/${buildFolder}/${otherLang}.json.gz`;
            const otherKey = `${otherFilename}|${otherUrl}`;
            if (otherUrl !== url && !seen.has(otherKey)) {
                seen.add(otherKey);
                try {
                    await chrome.downloads.download({
                        url: otherUrl,
                        filename: otherFilename,
                        saveAs: false,
                        conflictAction: 'overwrite'
                    });
                    console.log('[HW-EXT-BG] mirror locale dumped:', otherFilename);
                } catch (e) {
                    seen.delete(otherKey);
                    console.warn('[HW-EXT-BG] mirror download failed:', otherFilename, '→', e.message);
                }
            }
        }
    } catch (e) {
        seen.delete(dedupKey);
        console.warn('[HW-EXT-BG] download failed:', filename, '→', e.message);
        return;
    }
    await persistSeenUrls(seen);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'rpc-capture') {
    // DEV-выгрузка: remoteConfigInit несёт манифест всех remote-config'ов —
    // достаём из него нужные и качаем активно (см. dumpRemoteConfigsFromIndex).
    if (gamedataDumperActive && msg.payload && Array.isArray(msg.payload.calls)) {
        const rc = msg.payload.calls.find(c => c && c.method === 'remoteConfigInit');
        if (rc && rc.response && rc.response.index) {
            try {
                dumpRemoteConfigsFromIndex(rc.response.index);
            } catch (e) {
                console.warn('[HW-EXT-BG] remoteConfigInit dump fail:', e.message);
            }
        }
    }
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
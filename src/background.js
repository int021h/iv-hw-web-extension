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
const PROD_TARGET = {
    url: 'https://warden-api.pankov.dev',
    cookieDomain: '.pankov.dev',
    cookieSecure: true,
};
const LOCAL_TARGET = {
    url: 'http://localhost:9102',
    cookieDomain: 'localhost',
    cookieSecure: false,
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
    if (cfg.isDev) initAssetUrlCollector(cfg);
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
        const res = await fetch(`${t.url}/api/hw/har/ingest`, {
          method: 'POST',
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
 * При каждом перехваченном user_getClanInfo дёргаем /api/auth/exchange.
 * Backend апсертит пользователя/гильдию и ставит HttpOnly JWT-куку на .pankov.dev,
 * после чего web-client на hw.pankov.dev автоматически авторизован.
 * credentials: 'include' обязательно — иначе браузер не сохранит Set-Cookie в jar.
 */
async function authExchange(playerId, clanInfoResponse) {
  if (!playerId || !clanInfoResponse) return;
  const cfg = await getConfig();
  console.log('[HW-EXT-BG] → POST /exchange playerId=', playerId, 'targets=', cfg.targets.map(t => t.url).join(', '));

  // В Chrome MV3 fetch из service worker'а пишет Set-Cookie в изолированный partition,
  // недоступный веб-вкладкам. Поэтому ставим куку явно через chrome.cookies API — так она
  // попадёт в общий cookie jar браузера и будет отправляться при кросс-фетчах с web-страниц.
  // Каждый target → своя кука в свой scope (`localhost` vs `.pankov.dev`), не конфликтуют.
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
      const cookie = await chrome.cookies.set({
        url: `${target.url}/`,
        name: 'hw_session',
        value: data.token,
        domain: target.cookieDomain,
        path: '/',
        httpOnly: true,
        secure: target.cookieSecure,
        sameSite: 'lax',
        expirationDate: Math.floor(Date.now() / 1000) + 3600
      });
      if (cookie) {
        console.log('[HW-EXT-BG] cookie установлена:', cookie.domain, '←', target.url);
      } else {
        console.warn('[HW-EXT-BG] chrome.cookies.set вернул null:', target.url, '— проверь host_permissions');
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

const assetSeen = new Set(); // assetPath, дедуп в рамках жизни SW
let assetQueue = [];
let assetTimer = null;

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

async function flushAssetQueue(cfg) {
    if (assetQueue.length === 0) return;
    const batch = assetQueue.splice(0, assetQueue.length);
    // Шлём в каждый target параллельно, успех = хотя бы один OK. Endpoint PUBLIC,
    // но валидируется на сервере (allowed prefixes, лимиты) — мусор отбрасывается молча.
    const results = await Promise.allSettled(cfg.targets.map(async (t) => {
        const res = await fetch(`${t.url}/api/hw/asset/seen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: batch })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }));
    const anyOk = results.some(r => r.status === 'fulfilled');
    if (anyOk) {
        const paths = batch.map(b => b.assetPath).filter(Boolean);
        if (paths.length > 0) broadcastAssetToastToGameTabs(paths);
        console.log('[HW-EXT-BG] asset/seen ok, batch=', batch.length);
    } else {
        console.warn('[HW-EXT-BG] asset/seen failed для всех targets, batch=', batch.length);
    }
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
// platform может быть `an` (android), `webgl` и т.п. — берём любой; внутри одной
// версии игры (`1.278.0`) hash может меняться при горячих ребилдах ассетов —
// поэтому в folder name складываем оба, чтобы каждый ребилд лежал отдельно.
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
]);

// Любой *.nextersglobal.com — чтобы поймать splitlib/translations независимо от того,
// на каком конкретно поддомене CDN они лежат (`heroesmobile-a-cdn`, `heroesmobile-mb-cdn`
// и т.п. — у вендора иногда разные субдомены под разные ресурсы). host_permissions
// тоже расширен в manifest.json до `*://*.nextersglobal.com/*` (DEV-only).
const GAMEDATA_URL_PATTERNS = [
    '*://*.nextersglobal.com/*'
];

const SEEN_URLS_MAX = 500;
let detectedBuild = null; // { version, manifest, hash } — последняя замеченная сборка

function initGameDataDumper() {
    if (!chrome.webRequest || !chrome.downloads) {
        console.warn('[HW-EXT-BG] webRequest/downloads API недоступен, gamedata dumper выключен');
        return;
    }
    chrome.storage.local.get('gamedataBuild').then(({ gamedataBuild }) => {
        if (gamedataBuild) detectedBuild = gamedataBuild;
    });
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            tryDumpGameData(details.url).catch(e => console.warn('[HW-EXT-BG] gamedata dump fail:', e.message));
        },
        { urls: GAMEDATA_URL_PATTERNS }
    );
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

    const { gamedataSeenUrls } = await chrome.storage.local.get('gamedataSeenUrls');
    const seen = new Set(gamedataSeenUrls || []);
    // Дедуп НЕ по одному url: см. dedupKey ниже — иначе version-стабильный remote-config
    // (его URL без версии, только content-hash) скачается лишь однажды и не попадёт в папки
    // последующих сборок игры.

    const partsMatch = URL_PARTS_RE.exec(url);
    if (partsMatch) {
        const fresh = { version: partsMatch[1], manifest: partsMatch[2], hash: partsMatch[3] };
        if (!detectedBuild || detectedBuild.hash !== fresh.hash) {
            detectedBuild = fresh;
            chrome.storage.local.set({ gamedataBuild: fresh });
        }
    }
    // Если сборка (version+manifest+hash) ещё не известна — НЕ качаем. Раньше
    // дамп шёл в `unknown-version/`, и при первом запуске игры с пустым кешем туда
    // сваливалось всё подряд. Сборка определится из splitlib/translations URL
    // (он первым приходит с игровой CDN) — после этого конфиги поедут в нужную папку.
    if (!detectedBuild) {
        console.debug('[HW-EXT-BG] gamedata DEFERRED (build unknown):', url);
        return;
    }
    const { version, manifest, hash } = detectedBuild;
    const buildFolder = `${version}/${manifest}-${hash}`;

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
    try {
        const downloadId = await chrome.downloads.download({
            url,
            filename,
            saveAs: false,
            conflictAction: 'overwrite'
        });
        seen.add(dedupKey);
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
                try {
                    await chrome.downloads.download({
                        url: otherUrl,
                        filename: otherFilename,
                        saveAs: false,
                        conflictAction: 'overwrite'
                    });
                    seen.add(otherKey);
                    console.log('[HW-EXT-BG] mirror locale dumped:', otherFilename);
                } catch (e) {
                    console.warn('[HW-EXT-BG] mirror download failed:', otherFilename, '→', e.message);
                }
            }
        }

        const arr = Array.from(seen);
        const trimmed = arr.length > SEEN_URLS_MAX ? arr.slice(arr.length - SEEN_URLS_MAX) : arr;
        await chrome.storage.local.set({ gamedataSeenUrls: trimmed });
    } catch (e) {
        console.warn('[HW-EXT-BG] download failed:', filename, '→', e.message);
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
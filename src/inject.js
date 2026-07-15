(() => {
  const API_HOST = 'api.hero-wars-alliance.com';
  const API_PATH = '/api/rpc';
  const DEBUG = true;

  const ALLOWED_METHODS = new Set([
    'user_getClanInfo',
    'clanClash_getUserClanResult',
    'clanClash_getLaneBattle',
    'clanClash_getCurrentState',
    // --- Глобальный Чемпионат ---
    'clanWarChampInfo_getInfo',
    'clanWarChampInfo_getBriefInfo',
    'clanWarChampInfo_getAvailableHistory',
    'clanWarChampInfo_getDayHistory',
    'clanWarChampInfo_getSeason',
    'clanWarChampDefence_getDefence',
    // --- GW (Война Гильдий) ---
    'clanWarGetInfo',
    'clanWarGetDayHistory',
    'clanWarGetAvailableHistory',
    'clanWarGetDefence',
    // --- GW current-day: назначения и бои ---
    'clanWar_SetTargetMark',
    'clanWarAttack',
    'clanWarEndBattle',
    // --- Player-scope: инвентарь и прогресс героев (для журнала-планировщика) ---
    'inventoryGet',
    'heroGetAll',
    'titanGetAll',
    'userGetInfo',
    // Полная мощь аккаунта участника (для /hw/progress «Мощь аккаунта»). Игра дёргает
    // при открытии карточки участника; ловим пассивно (свой вызов подписать нельзя — подпись в wasm).
    'heroGetSumPower',
    // --- Events: квесты пользователя + remote-config URLs для CDN-чейнов ---
    'questGetAll',
    'questGetEvents',
    'remoteConfigInit',
    // --- Эвент-магазины: ассортимент магазинов событий (shopId >= 1000000) ---
    // По вызову на каждый shopId; бэк фильтрует эвентовые и копит снимки (event_shop).
    'shopGet',
    // --- Арена: соперники из поиска и лог боёв ---
    // battleGetByType — общий метод логов; бэк обрабатывает только args.type === 'arena'.
    'arenaFindEnemies',
    'battleGetByType',
    'customArena_endBattle'
  ]);

  const log = (...a) => DEBUG && console.log('[HW-EXT]', ...a);
  const warn = (...a) => console.warn('[HW-EXT]', ...a);

  function shouldIntercept(url) {
    if (!url) return false;
    try {
      const u = new URL(url, location.href);
      return u.host === API_HOST && u.pathname.startsWith(API_PATH);
    } catch {
      return false;
    }
  }

  function postCaptured(payload) {
    window.postMessage({ source: 'hw-ext', type: 'rpc-capture', payload }, '*');
  }

  async function readBody(body) {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    try {
      if (body instanceof Blob) return await body.text();
      if (body instanceof ArrayBuffer) return new TextDecoder('utf-8').decode(body);
      if (ArrayBuffer.isView(body)) return new TextDecoder('utf-8').decode(body);
      if (body instanceof URLSearchParams) return body.toString();
    } catch (e) {
      warn('body read failed:', e);
    }
    return '';
  }

  function processCapture(requestText, responseText, headers) {
    let request;
    try {
      request = JSON.parse(requestText);
    } catch (e) {
      warn('request JSON parse failed; body head:', (requestText || '').slice(0, 120));
      return;
    }
    let response = null;
    try { response = responseText ? JSON.parse(responseText) : null; } catch {}

    const calls = request && Array.isArray(request.calls) ? request.calls : null;
    if (!calls || calls.length === 0) {
      log('no calls[] in request, keys:', Object.keys(request || {}));
      return;
    }

    const allMethods = calls.map(c => c && c.name).filter(Boolean);
    log('RPC batch:', allMethods);

    const responseMap = {};
    if (response && Array.isArray(response.results)) {
      for (const r of response.results) {
        if (r && r.ident) {
          responseMap[r.ident] = r.result && r.result.response != null ? r.result.response : null;
        }
      }
    }

    const playerId = headers['x-auth-player-id'] || null;
    const calledAt = new Date().toISOString();

    const filtered = calls
      .filter(c => c && ALLOWED_METHODS.has(c.name))
      .map(c => ({
        method: c.name,
        requestArgs: c.args != null ? c.args : null,
        response: responseMap[c.ident] != null ? responseMap[c.ident] : null,
        requestIdent: c.ident || null,
        calledAt
      }));

    log('matched MVP methods:', filtered.length, '/', calls.length, 'playerId:', playerId);

    if (filtered.length > 0) {
      postCaptured({ playerId, calls: filtered });
    }
  }

  function headersToObject(h) {
    const out = {};
    if (!h) return out;
    if (h instanceof Headers) {
      h.forEach((v, k) => { out[k.toLowerCase()] = v; });
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) out[k.toLowerCase()] = v;
    } else if (typeof h === 'object') {
      for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k];
    }
    return out;
  }

  // --- fetch wrapper ---
  const origFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!shouldIntercept(url)) {
      return origFetch.apply(this, arguments);
    }

    let requestText = '';
    let headers = {};
    try {
      if (init && init.body != null) {
        requestText = await readBody(init.body);
      } else if (input instanceof Request) {
        requestText = await input.clone().text();
      }
      const hSrc = (init && init.headers) || (input instanceof Request ? input.headers : null);
      headers = headersToObject(hSrc);
      log('fetch →', url, 'body bytes:', requestText.length);
    } catch (e) {
      warn('fetch request read failed:', e);
    }

    const response = await origFetch.apply(this, arguments);

    try {
      const cloned = response.clone();
      const respText = await cloned.text();
      processCapture(requestText, respText, headers);
    } catch (e) {
      warn('fetch capture failed:', e);
    }

    return response;
  };

  // --- XHR wrapper ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__hwUrl = url;
    this.__hwHeaders = {};
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (!this.__hwHeaders) this.__hwHeaders = {};
    this.__hwHeaders[String(name).toLowerCase()] = value;
    return origSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (shouldIntercept(this.__hwUrl)) {
      const xhr = this;
      log('xhr →', xhr.__hwUrl, 'body type:', body && body.constructor && body.constructor.name);
      xhr.addEventListener('load', async () => {
        try {
          const reqText = await readBody(body);
          processCapture(reqText, xhr.responseText || '', xhr.__hwHeaders || {});
        } catch (e) {
          warn('XHR capture failed:', e);
        }
      });
    }
    return origSend.apply(this, arguments);
  };

  log('fetch/XHR interception installed');
})();
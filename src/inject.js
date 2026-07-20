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
    // --- Сезонные эвенты «Царства» (liveOps-механика specialQuest) ---
    // На случай если вендор заведёт их и как HTTP-RPC; сейчас они приходят по MQTT
    // (см. MQTT_TYPES ниже) — имена методов вытащены из строк клиента.
    'specialQuestInit',
    'specialQuestEvents',
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

  // ===========================================================================
  // MQTT (WebSocket) — сезонные эвенты
  // ===========================================================================
  // Игра держит MQTT-соединение с `wss://emqx-hwmb-wss.nextersglobal.com/mqtt`
  // (paho-mqtt) и шлёт в него push'и по топикам `hwm/user/<id>`, `hwm/pub/clan/<id>`
  // и др. С 2026-07-16 вендор УБРАЛ конфиги specialQuestEvent/specialQuestGroup из
  // индекса remoteConfigInit — расписание тиров и состав вкладок сезонных эвентов
  // теперь приходят ТОЛЬКО сюда, сообщением `{"result":{"type":"specialQuestEvents",
  // "body":{"events":[{id,start,end,viewId,groups:[{id,repeatType,localeKey,quests}]}]}}}`.
  // Это ещё и авторитетнее конфига: repeatType живой (в снимке конфига вкладки арены
  // помечены Repeatable, а в игре они single).
  //
  // Забираем только whitelist'нутые типы: топики global-map сыплют сотни
  // mapChunksUpdated в минуту — их ловить незачем.
  const MQTT_TYPES = new Set(['specialQuestEvents']);

  /**
   * Разбирает MQTT-пакеты из бинарного фрейма и возвращает payload'ы PUBLISH'ей.
   * Формат: [1 байт type/flags][remaining length varint][2 байта длины топика][топик]
   * [2 байта packet id — только при QoS>0][payload]. В одном WS-фрейме пакетов
   * может быть несколько подряд.
   */
  function parseMqttPublishes(buf) {
    const out = [];
    const b = new Uint8Array(buf);
    let pos = 0;
    while (pos + 2 <= b.length) {
      const header = b[pos];
      const packetType = header >> 4;
      let mult = 1, remaining = 0, q = pos + 1;
      while (q < b.length) {
        const enc = b[q++];
        remaining += (enc & 127) * mult;
        mult *= 128;
        if ((enc & 128) === 0) break;
        if (mult > 128 * 128 * 128) return out; // битый varint — дальше не парсим
      }
      const bodyEnd = q + remaining;
      if (bodyEnd > b.length) break;
      if (packetType === 3 && remaining > 2) {
        const topicLen = (b[q] << 8) | b[q + 1];
        let p = q + 2 + topicLen;
        if ((header >> 1) & 3) p += 2; // packet id при QoS 1/2
        const topic = new TextDecoder('utf-8').decode(b.subarray(q + 2, q + 2 + topicLen));
        const payload = new TextDecoder('utf-8').decode(b.subarray(p, bodyEnd));
        out.push({ topic, payload });
      }
      pos = bodyEnd;
    }
    return out;
  }

  /** Отдаёт push бэкенду как обычный «вызов» — метод = тип сообщения. */
  function handleMqttFrame(data) {
    let buf = null;
    if (data instanceof ArrayBuffer) buf = data;
    else if (ArrayBuffer.isView(data)) buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    else return; // текстовые фреймы MQTT не использует
    let publishes;
    try { publishes = parseMqttPublishes(buf); } catch (e) { return; }
    for (const { topic, payload } of publishes) {
      if (payload.indexOf('specialQuest') < 0) continue; // дешёвый фильтр до JSON.parse
      let msg;
      try { msg = JSON.parse(payload); } catch { continue; }
      const result = msg && msg.result;
      const type = result && result.type;
      if (!type || !MQTT_TYPES.has(type)) continue;
      const body = result.body || null;
      const playerId = body && body.pushUserId != null ? String(body.pushUserId) : null;
      log('MQTT capture:', type, 'topic:', topic);
      postCaptured({
        playerId,
        calls: [{
          method: type,
          requestArgs: { transport: 'mqtt', topic },
          response: body,
          requestIdent: null,
          calledAt: new Date().toISOString()
        }]
      });
    }
  }

  const OrigWebSocket = window.WebSocket;
  if (OrigWebSocket) {
    const WrappedWebSocket = function(url, protocols) {
      const ws = protocols === undefined ? new OrigWebSocket(url) : new OrigWebSocket(url, protocols);
      try {
        // Слушаем на самом сокете: paho вешает свой onmessage, а addEventListener
        // работает параллельно и не мешает игре (мы только читаем).
        ws.addEventListener('message', (ev) => {
          try { handleMqttFrame(ev.data); } catch (e) { warn('MQTT capture failed:', e); }
        });
      } catch (e) {
        warn('WebSocket hook failed:', e);
      }
      return ws;
    };
    WrappedWebSocket.prototype = OrigWebSocket.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) WrappedWebSocket[k] = OrigWebSocket[k];
    window.WebSocket = WrappedWebSocket;
  }

  log('fetch/XHR/WebSocket interception installed');
})();
(() => {
  const API_HOST = 'api.hero-wars-alliance.com';
  const API_PATH = '/api/rpc';

  const ALLOWED_METHODS = new Set([
    'user_getClanInfo',
    'clanClash_getUserClanResult',
    'clanClash_getLaneBattle',
    'clanClash_getCurrentState'
  ]);

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

  function processCapture(requestText, responseText, headers) {
    let request, response;
    try { request = JSON.parse(requestText); } catch { return; }
    try { response = responseText ? JSON.parse(responseText) : null; } catch { response = null; }

    const calls = request && Array.isArray(request.calls) ? request.calls : null;
    if (!calls || calls.length === 0) return;

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
      if (init && init.body != null && typeof init.body === 'string') {
        requestText = init.body;
      } else if (input instanceof Request) {
        requestText = await input.clone().text();
      }
      const hSrc = (init && init.headers) || (input instanceof Request ? input.headers : null);
      headers = headersToObject(hSrc);
    } catch (e) {
      console.warn('[HW-EXT] request read failed:', e);
    }

    const response = await origFetch.apply(this, arguments);

    try {
      const cloned = response.clone();
      const respText = await cloned.text();
      processCapture(requestText, respText, headers);
    } catch (e) {
      console.warn('[HW-EXT] fetch capture failed:', e);
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
      const requestText = typeof body === 'string' ? body : '';
      xhr.addEventListener('load', () => {
        try {
          processCapture(requestText, xhr.responseText || '', xhr.__hwHeaders || {});
        } catch (e) {
          console.warn('[HW-EXT] XHR capture failed:', e);
        }
      });
    }
    return origSend.apply(this, arguments);
  };

  console.log('[HW-EXT] fetch/XHR interception installed');
})();
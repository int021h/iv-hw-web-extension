(() => {
  // --- Инжект inject.js в MAIN world для обёртки fetch/XHR ----------------
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/inject.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  // --- Relay из MAIN world в background ------------------------------------
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'hw-ext' || data.type !== 'rpc-capture') return;
    chrome.runtime.sendMessage({ type: 'rpc-capture', payload: data.payload }).catch(() => {});
  });

  // --- Плавающий pill на странице игры -------------------------------------
  // Только в top-frame. `all_frames: true` в manifest держим для fetch/XHR
  // перехвата во вложенных iframe'ах с игрой, но UI рисуем один раз.
  if (window.top !== window) return;

  const PILL_ID = 'hw-ext-status-pill';
  const TOAST_CONTAINER_ID = 'hw-ext-toast-container';
  const TOAST_MAX_STACK = 6;          // одновременно видно не более 6 toast'ов
  const TOAST_DURATION_MS = 3500;     // время «висения» одного toast'а
  const TOAST_FADE_MS = 250;          // длительность fade-out при удалении

  // Человекочитаемые имена для RPC-методов из ALLOWED_METHODS (см. inject.js).
  // Если метод не в словаре — показываем сырой код, чтобы было видно что добавить.
  const METHOD_LABELS = {
    'user_getClanInfo':               'Профиль и гильдия',
    'clanClash_getUserClanResult':    'Столкновение: результаты дня',
    'clanClash_getLaneBattle':        'Столкновение: составы боя',
    'clanClash_getCurrentState':      'Столкновение: текущее состояние',
    'clanWarChampDefence_getDefence': 'Чемпионат: защита игроков',
    'clanWarGetInfo':                 'Война: активная война',
    'clanWarGetDayHistory':           'Война: история дня',
    'clanWarGetAvailableHistory':     'Война: список войн',
    'clanWarGetDefence':              'Война: наша защита',
    'clanWar_SetTargetMark':          'Война: назначение на цель',
    'clanWarAttack':                  'Война: старт атаки',
    'clanWarEndBattle':               'Война: результат боя',
    'inventoryGet':                   'Инвентарь игрока',
    'heroGetAll':                     'Прогресс героев',
    'titanGetAll':                    'Прогресс титанов',
    'userGetInfo':                    'Профиль игрока',
  };

  const labelFor = (method) => METHOD_LABELS[method] || method;

  // Стили подключаем через constructable stylesheets — бежит мимо Content-Security-Policy
  // сайта (иначе inline style на элементе игрой бы блокировался).
  const HW_EXT_CSS = `
    /* ===== Pill (нижний правый) ===== */
    #${PILL_ID} {
      position: fixed !important;
      right: 10px !important;
      bottom: 10px !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 5px 10px 5px 8px !important;
      background: rgba(17, 24, 39, 0.88) !important;
      color: #e5e7eb !important;
      font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      border-radius: 999px !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
      backdrop-filter: blur(4px) !important;
      pointer-events: none !important;
      user-select: none !important;
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    #${PILL_ID}.hw-ext-visible { opacity: 0.88; }
    #${PILL_ID} .hw-ext-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #6b7280;
      transition: background 0.2s, box-shadow 0.2s;
    }
    #${PILL_ID}.hw-ext-ok .hw-ext-dot    { background: #16a34a; box-shadow: 0 0 6px rgba(22,163,74,0.6); }
    #${PILL_ID}.hw-ext-warn .hw-ext-dot  { background: #f59e0b; box-shadow: 0 0 6px rgba(245,158,11,0.6); }
    #${PILL_ID}.hw-ext-error .hw-ext-dot { background: #dc2626; box-shadow: 0 0 6px rgba(220,38,38,0.7); }

    /* ===== Toast-стек (верхний правый) ===== */
    #${TOAST_CONTAINER_ID} {
      position: fixed !important;
      top: 15px !important;
      right: 15px !important;
      z-index: 2147483647 !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 6px !important;
      pointer-events: none !important;
    }
    .hw-ext-toast {
      min-width: 200px;
      max-width: 300px;
      padding: 7px 12px;
      background: rgba(17, 24, 39, 0.95);
      color: #e5e7eb;
      border-radius: 6px;
      border-left: 3px solid #16a34a;
      box-shadow: 0 4px 10px rgba(0,0,0,0.35);
      font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      opacity: 0;
      transform: translateX(24px);
      transition: opacity ${TOAST_FADE_MS}ms ease, transform ${TOAST_FADE_MS}ms ease;
    }
    .hw-ext-toast.hw-ext-asset {
      border-left-color: #3b82f6;
    }
    .hw-ext-toast.hw-ext-visible {
      opacity: 0.95;
      transform: translateX(0);
    }
    .hw-ext-toast .hw-ext-toast-label {
      font-size: 9px;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 700;
      margin-bottom: 2px;
    }
    .hw-ext-toast.hw-ext-asset .hw-ext-toast-label {
      color: #60a5fa;
    }
    .hw-ext-toast .hw-ext-toast-method {
      font-size: 12px;
      font-weight: 600;
      color: #e5e7eb;
    }
    .hw-ext-toast.hw-ext-asset .hw-ext-toast-method {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      word-break: break-all;
    }
  `;

  function injectStyles() {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(HW_EXT_CSS);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return;
    } catch { /* fall back */ }
    const style = document.createElement('style');
    style.textContent = HW_EXT_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensurePill() {
    let host = document.getElementById(PILL_ID);
    if (host) return host;

    host = document.createElement('div');
    host.id = PILL_ID;

    const dot = document.createElement('span');
    dot.className = 'hw-ext-dot';
    const label = document.createElement('span');
    label.className = 'hw-ext-label';
    label.textContent = 'HW';

    host.appendChild(dot);
    host.appendChild(label);

    (document.body || document.documentElement).appendChild(host);
    requestAnimationFrame(() => host.classList.add('hw-ext-visible'));
    return host;
  }

  function renderPill(stats) {
    const host = ensurePill();
    const label = host.querySelector('.hw-ext-label');

    host.classList.remove('hw-ext-ok', 'hw-ext-warn', 'hw-ext-error');

    if (!stats || !stats.authName) {
      label.textContent = 'HW';
      return;
    }
    if (stats.lastSyncFailed > 0) {
      host.classList.add('hw-ext-error');
      label.textContent = `HW ⚠ ${stats.lastSyncFailed}`;
      return;
    }
    if (stats.queueSize > 0) {
      host.classList.add('hw-ext-warn');
      label.textContent = `HW ↑${stats.totalSent || 0} · Q${stats.queueSize}`;
      return;
    }
    host.classList.add('hw-ext-ok');
    label.textContent = `HW ↑${stats.totalSent || 0}`;
  }

  // ----- Toast-стек в правом верхнем углу --------------------------------
  function ensureToastContainer() {
    let container = document.getElementById(TOAST_CONTAINER_ID);
    if (container) return container;
    container = document.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    (document.body || document.documentElement).appendChild(container);
    return container;
  }

  function showToast(method) {
    spawnToast({
      variant: 'rpc',
      titleAttr: method,
      labelText: '↑ Отправлено',
      bodyText: labelFor(method),
    });
  }

  function showAssetToast(assetPath) {
    spawnToast({
      variant: 'asset',
      titleAttr: assetPath,
      labelText: '↑ CDN-ассет',
      bodyText: assetPath,
    });
  }

  function spawnToast({ variant, titleAttr, labelText, bodyText }) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = 'hw-ext-toast' + (variant === 'asset' ? ' hw-ext-asset' : '');
    toast.title = titleAttr;

    const label = document.createElement('div');
    label.className = 'hw-ext-toast-label';
    label.textContent = labelText;

    const text = document.createElement('div');
    text.className = 'hw-ext-toast-method';
    text.textContent = bodyText;

    toast.appendChild(label);
    toast.appendChild(text);
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('hw-ext-visible'));

    while (container.children.length > TOAST_MAX_STACK) {
      container.firstElementChild?.remove();
    }

    setTimeout(() => {
      toast.classList.remove('hw-ext-visible');
      setTimeout(() => toast.remove(), TOAST_FADE_MS);
    }, TOAST_DURATION_MS);
  }

  // Background после успешного flush броадкастит сюда имена методов / пути ассетов.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'hw-toast' && Array.isArray(msg.methods)) {
      for (const method of msg.methods) {
        if (typeof method === 'string' && method.length) showToast(method);
      }
      return;
    }
    if (msg.type === 'hw-asset-toast' && Array.isArray(msg.assetPaths)) {
      for (const path of msg.assetPaths) {
        if (typeof path === 'string' && path.length) showAssetToast(path);
      }
      return;
    }
  });

  function init() {
    injectStyles();
    chrome.storage.local.get('stats').then(({ stats }) => renderPill(stats));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.stats) return;
      renderPill(changes.stats.newValue);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
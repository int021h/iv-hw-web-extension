/**
 * Mini-i18n для расширения с UI-переключателем поверх chrome.i18n.
 *
 * Зачем свой механизм: chrome.i18n.getMessage() жёстко берёт язык из
 * chrome.i18n.getUILanguage() (= язык браузера) и не умеет переключаться
 * рантайм. Чтобы дать пользователю выбор в popup'е, грузим messages.json
 * каждой локали через fetch и сами подставляем $1/$2.
 *
 * Источник языка:
 *   1) chrome.storage.local.localeOverride ('ru'|'en'|null), если задан явно;
 *   2) иначе chrome.i18n.getUILanguage() — 'en' если начинается с 'en', иначе 'ru'.
 *
 * Подключение:
 *   popup.html  — <script src="../i18n.js"></script> перед popup.js
 *   content.js  — в manifest.json: "js": ["src/i18n.js", "src/content.js"]
 */

const HWI18N = (() => {
    const SUPPORTED = ['ru', 'en'];
    const DEFAULT = 'ru';

    let dict = {};
    let currentLocale = DEFAULT;
    let ready = false;
    const readyListeners = [];

    async function loadDict(locale) {
        const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
        const res = await fetch(url);
        return res.json();
    }

    function pickAutoLocale() {
        const ui = (chrome.i18n.getUILanguage() || '').toLowerCase();
        return ui.startsWith('en') ? 'en' : 'ru';
    }

    async function getEffectiveLocale() {
        const { localeOverride } = await chrome.storage.local.get('localeOverride');
        if (localeOverride && SUPPORTED.includes(localeOverride)) return localeOverride;
        return pickAutoLocale();
    }

    /** Грузит словарь и проставляет ready. Можно вызывать повторно для смены локали. */
    async function init() {
        currentLocale = await getEffectiveLocale();
        try {
            dict = await loadDict(currentLocale);
        } catch (e) {
            // fallback на дефолт если файл недоступен (обычно — забыли добавить
            // _locales/<lang>/messages.json в web_accessible_resources в manifest.json).
            console.warn('[HWI18N] failed to load', currentLocale, '→ fallback to', DEFAULT, e);
            dict = await loadDict(DEFAULT);
            currentLocale = DEFAULT;
        }
        ready = true;
        readyListeners.splice(0).forEach(fn => { try { fn(); } catch {} });
    }

    /**
     * Подписка на смену localeOverride из любого контекста (popup ↔ content).
     * Без неё после переключения локали в popup'е content.js на странице игры
     * продолжает использовать словарь, загруженный при старте — и тосты идут
     * на старом языке до перезагрузки страницы.
     */
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !('localeOverride' in changes)) return;
        init();
    });

    /** Регистрация колбэка после готовности словаря (или сразу, если уже готов). */
    function onReady(fn) {
        if (ready) fn();
        else readyListeners.push(fn);
    }

    /**
     * Перевод по ключу с подстановкой $1, $2, ... — формат как у chrome.i18n.
     * Если словарь ещё не загружен или ключ не найден — возвращает сам ключ
     * (видимый артефакт, чтобы пропуски были заметны).
     */
    function t(key, ...subs) {
        const entry = dict[key];
        if (!entry || !entry.message) return key;
        let msg = entry.message;
        subs.forEach((s, i) => {
            msg = msg.split(`$${i + 1}`).join(String(s));
        });
        return msg;
    }

    function getLocale() { return currentLocale; }
    function isReady() { return ready; }

    /** Применяет data-i18n атрибуты ко всем элементам в указанном root'е. */
    function applyDom(root = document) {
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = t(key);
        });
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.title = t(el.getAttribute('data-i18n-title'));
        });
    }

    /** Сохраняет явный выбор пользователя (null/undefined → удаляет override). */
    async function setOverride(locale) {
        if (locale === null || locale === undefined) {
            await chrome.storage.local.remove('localeOverride');
        } else if (SUPPORTED.includes(locale)) {
            await chrome.storage.local.set({ localeOverride: locale });
        }
        await init();
    }

    async function getOverride() {
        const { localeOverride } = await chrome.storage.local.get('localeOverride');
        return SUPPORTED.includes(localeOverride) ? localeOverride : null;
    }

    return { init, onReady, t, getLocale, isReady, applyDom, setOverride, getOverride, SUPPORTED };
})();
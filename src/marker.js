// Запускается на страницах Warden web-app (warden.pankov.dev / localhost:3000)
// на document_start. Ставит <meta name="warden-version" content="..."> в <head>,
// чтобы страница логина по этому маркеру могла понять, что расширение установлено.
//
// Content-script крутится в isolated world и не может тронуть `window` страницы
// напрямую — поэтому используем DOM-атрибут, его видят оба мира.
(() => {
    try {
        const version = chrome.runtime.getManifest().version;

        const setMeta = () => {
            if (document.querySelector('meta[name="warden-version"]')) return;
            const meta = document.createElement('meta');
            meta.name = 'warden-version';
            meta.content = version;
            (document.head || document.documentElement).appendChild(meta);
        };

        setMeta();
        // На document_start <head> может ещё не существовать — повторяем после построения DOM.
        if (!document.head) {
            document.addEventListener('DOMContentLoaded', setMeta, { once: true });
        }
    } catch { /* ignore */ }
})();
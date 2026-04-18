(() => {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/inject.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'hw-ext' || data.type !== 'rpc-capture') return;
    chrome.runtime.sendMessage({ type: 'rpc-capture', payload: data.payload }).catch(() => {});
  });
})();
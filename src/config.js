// Единственное место, где живут хосты Warden. История переездов доменов
// (hwwarden.com → hw-warden.com, легаси warden-api.pankov.dev) показала, что
// хост — не константа навечно: при следующей смене правится только этот файл
// (плюс host_permissions в manifest.json — туда конфиг не подключить).
//
// Подключение (обычные глобальные константы, без модулей):
//   - background.js (service worker): importScripts('config.js')
//   - popup/popup.html: <script src="../config.js"></script> перед popup.js
const HW_CONFIG = {
  /** Основной API-бэкенд (ingest, exchange, публичные ассеты и словари). */
  API_PROD: 'https://api.hw-warden.com',
  /** Легаси API-хост — тот же бэкенд, доживает до авто-обновления старых копий. */
  API_LEGACY: 'https://warden-api.pankov.dev',
  /** Локальный ms-hw для DEV-режима (fan-out вторым target'ом). */
  API_LOCAL: 'http://localhost:9102',
  /** Сайт Warden (кнопка «Открыть Warden» в попапе). */
  SITE_PROD: 'https://hw-warden.com',
  SITE_DEV: 'http://localhost:3000',
};

# IV-HW-WEB-EXTENSION

Browser-расширение (Chrome / Edge, Manifest V3) — перехватывает RPC-вызовы Hero Wars Alliance
и отправляет их в ms-hw для аналитики гильдии.

## MVP-методы

Расширение фильтрует и пересылает только:

- `user_getClanInfo` — player id + гильдия
- `clanClash_getUserClanResult` — расстановки турнира
- `clanClash_getLaneBattle` — составы боёв
- `clanClash_getCurrentState` — наша расстановка до боёв

## Структура

```
manifest.json
src/
  inject.js          # MAIN world: обёртка fetch + XMLHttpRequest
  content.js         # bridge: инжектит inject.js, пересылает сообщения в background
  background.js      # очередь + батчинг + POST /api/hw/har/ingest
  popup/
    popup.html
    popup.js
    popup.css
```

## Установка (dev)

1. Открыть `chrome://extensions/` (или `edge://extensions/`).
2. Включить **Developer mode**.
3. **Load unpacked** → выбрать эту папку.
4. В popup расширения проверить адрес бэка (по умолчанию `http://localhost:9102`).
5. Открыть https://www.hero-wars-alliance.com/ и зайти в игру — в popup появится player id
   и счётчик отправленных вызовов.

## Эндпоинт приёма

`POST {backend}/api/hw/har/ingest`

```json
{
  "playerId": "123456",
  "calls": [
    {
      "method": "user_getClanInfo",
      "requestArgs": { ... },
      "response":    { ... },
      "requestIdent": "body_abc",
      "calledAt": "2026-04-18T12:34:56.789Z"
    }
  ]
}
```

Бэк создаёт (или переиспользует) сессию импорта `ext-{playerId}-{yyyy-MM-dd}`
и складывает записи в `hw.har_rpc_call`.

## Иконки

Минимально MV3 работает без иконок — Chrome подставит заглушку.
При публикации нужны 16/48/128 px PNG в папке `icons/` и ссылки в `manifest.json.action.default_icon`.
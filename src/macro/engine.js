// ==UserScript==
// @name         Dungeon runner
// @namespace    http://tampermonkey.net/
// @version      2026-08-24_19:02
// @description  try to take over the world!
// @author       You
// @match        https://www.hero-wars-alliance.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=hero-wars-alliance.com
// @grant        none
// ==/UserScript==

(async function() {
    'use strict';

    /// ======== OPTIONS ==========
    const WARDEN = false

    const PERSIST_LOGS = true
    const PERSISTED_LOGS_KEY = 'persistedLogs'

    const MACRO_SESSION_START_KEY = 'macroSessionStart'
    const MACRO_RELOAD_COUNT_KEY = 'macroReloadCount'

    let GAME_LOAD_TIMEOUT = Number(localStorage.getItem('GAME_LOAD_TIMEOUT') || 10000) // Time required for the game to initialize

    let DELAY_CHECK_CYCLE = Number(localStorage.getItem('DELAY_CHECK_CYCLE') || 5000) // check control pixel every 100msec until MAX_WAIT_BEFORE_RETRY
    const MAX_WAIT_BEFORE_RETRY = 5000 // max waiting time for a new screen to appear
    const MAX_RETRIES = 3 // after 3 retries if screen didn't appear => page will be reloaded and script restarts
    const RELOAD_PAGE_ON_FAILURE = true //

    //initial dungeon delays
    const MAX_FLOORS = 10000
    let DELAY_AFTER_CLICKING_GUILD = Number(localStorage.getItem('DELAY_AFTER_CLICKING_GUILD') || 5000)
    let DELAY_AFTER_CLICKING_DUNGEON = Number(localStorage.getItem('DELAY_AFTER_CLICKING_DUNGEON') || 5000)
    let EXTRA_GATE_DELAY_FIRST_FLOOR = Number(localStorage.getItem('EXTRA_GATE_DELAY_FIRST_FLOOR') || 500)
    let EXTRA_WALK_DELAY_FIRST_FLOOR = Number(localStorage.getItem('EXTRA_WALK_DELAY_FIRST_FLOOR') || 2000)
    let EXTRA_FLOOR_DELAY_FIRST_FLOOR = Number(localStorage.getItem('EXTRA_FLOOR_DELAY_FIRST_FLOOR') || 3000)

    let EXTRA_DELAY_BEFORE_CONFIRM_BATTLE = Number(localStorage.getItem('EXTRA_DELAY_BEFORE_CONFIRM_BATTLE') || 0)

    // dungeon delays
    let DELAY_FOR_TITANS_WALK = Number(localStorage.getItem('DELAY_FOR_TITANS_WALK') || 500) // after battle results confirmed titans walk to another lvl
    let DELAY_AFTER_CLICKING_AUTOBATTLE = Number(localStorage.getItem('DELAY_AFTER_CLICKING_AUTOBATTLE') || 500) // minimum duration of the battle
    let DELAY_AFTER_GATE_CLICKED = Number(localStorage.getItem('DELAY_AFTER_GATE_CLICKED') || 500) // delay after clicking on lvl gate, before rooms selection popup appeared
    let DELAY_AFTER_ROOM_CLICKED = Number(localStorage.getItem('DELAY_AFTER_ROOM_CLICKED') || 0) // delay between choosing the room and opening the battlefield
    let DELAY_AFTER_CLICKING_FLOOR_REWARD = Number(localStorage.getItem('DELAY_AFTER_CLICKING_FLOOR_REWARD') || 1000) // click on shield at the end of the floor on lvl5 or lvl10
    let DELAY_AFTER_FINISHING_FLOOR = Number(localStorage.getItem('DELAY_AFTER_FINISHING_FLOOR') || 1000) // click on accept gold for the floor, titans slowly walk to the next floor

    const COLORS_MATCH_THRESHOLD = 10
    let DEBUG_CLICKS = false

    const BUTTON_TEXT_RUN_DUNGEON = 'Run Dungeon'
    //const BUTTON_TEXT_STOP_DUNGEON = 'Stop Dungeon'

    const BUTTON_TEXT_RUN_CUSTOM = 'Run Macro'
    const BUTTON_TEXT_STOP_CUSTOM = 'Stop Macro'
    const BUTTON_TEXT_STOP_MACRO = 'Stop '

    const BUTTON_TEXT_RUN_DEBUG = '👀 Debug'
    const BUTTON_TEXT_STOP_DEBUG = '🚫 Stop debug'

    const BUTTON_TEXT_RUN_REPEAT_CLICK = 'Start recording'
    const BUTTON_TEXT_ARMED_REPEAT_CLICK = 'Recording...'
    const BUTTON_TEXT_STOP_REPEAT_CLICK = 'Stop repeating'
    const BUTTON_TEXT_STOP_RECORDING = 'Stop recording'

    const MACRO_DUNGEON = 'dungeon'
    const MACRO_DAILY = 'daily'
    const MACRO_FRONTIER = 'frontier'
    const MACRO_REPEAT_CLICK = 'repeat_click'
    const LAST_MACRO_KEY = 'last_macro'

    const DEFAULT_ORDER = [
        //{ id: 'mixed', label: '⚡', background: 'linear-gradient(to bottom, #806104, #FFC107)', bColor: '#806104' },
        { id: 'mixed', label: '⚡', background: 'radial-gradient(circle,#806104,#ffffff)', bColor: '#806104' },
        { id: 'water', label: '💧', background: 'linear-gradient(to bottom, #104B7A, #2196F3)', bColor: '#104B7A' },
        { id: 'earth', label: '🍀', background: 'linear-gradient(to bottom, #265828, #4CAF50)', bColor: '#265828' },
        { id: 'fire', label: '🔥', background: 'linear-gradient(to bottom, #7A211B, #F44336)', bColor: '#7A211B' },
    ]

    
    // service actions
    const actionTitle = 1
    const actionDelay = 2
    const actionJump = 3
    const actionJumpIfScreen = 4
    const actionJumpIfNotScreen = 5

    // clicker
    const actionClick = 10
    const actionDragDrop = 11

    // actions with some logic
    const actionChooseRoom = 21
    const actionWaitForScreen = 22
    const actionInterruptIfColor = 24
    const actionInterruptIfNotColor = 25

    
    // ======== screens (control pixels used to detect game state) ==========
    // ============ Home ===========
    const screenHomePopup = [{x: 0.971644, y: 0.054499, color: [245,209,117]}]
    const screenHomeScreen = [{x: 0.59375, y: 0.908112, color: [235,236,199]}]
    const screenGuildScreen = [{x: 0.273832, y: 0.612474, color: [72,39,0]}, {x: 0.241437, y: 0.297075, color: [213,21,26]}]
    
    // ============ Dungeon ===========
    const screenRightGate = [{x: 0.695023, y: 0.105830, color: [226,226,235]}]
    const screenMidGate = [{x: 0.500000, y: 0.104563, color: [232,233,240]}]
    const screenLeftGate = [{x: 0.314815, y: 0.107098, color: [235,234,241]}]
    const popupOneRoomSelection = [{x: 0.714699, y: 0.098226, color: [241,192,102]}]
    const popupTwoRoomsSelection = [{x: 0.876736, y: 0.102028, color: [244,203,113]}]
    const screenBattlefield = [{x: 0.039352, y: 0.047529, color: [234,203,151]}]
    const popupBattleResult = [{x: 0.60083, y: 0.127563, color: [137,1,0]}]
    const popupBattleResult5Titans = [{x: 0.500418, y: 0.287934, color: [235,235,235]}]
    const screenFloor1Final = [{x: 0.3163664839467502, y: 0.1320754716981132, color: [18,21,26]}]
    const screenFloor2Final = [{x: 0.6985121378230227, y: 0.14408233276157806, color: [20,22,28]}]
    const popupFloorReward = [{x: 0.5, y: 0.5, color: [22,12,8]}]
    const screenPastRightGate = [{x: 0.6703741152679474, y: 0.11393805309734513, color: [29,37,83]}]
    const screenPastMidGate = [{x: 0.4752275025278059, y: 0.11172566371681415, color: [28,36,81]}]
    const screenPastLeftGate = [{x: 0.2901921132457027, y: 0.11172566371681415, color: [28,36,81]}]
    
    // ============ Frontier ===========
    const screenFrontier = [{x: 0.049190, y: 0.434094, color: [237,209,158]}]
    const screenBattlePrep = [{x: 0.841435, y: 0.766195, color: [65,158,28]}]
    const screenLose = [{x: 0.497106, y: 0.251584, color: [180,14,36]}]
    const screenReorderTeams = [{x: 0.499421, y: 0.004436, color: [3,6,9]}]
    
    // ============ Expedition ===========
    const screenExpeditionOpened = [{x: 0.721644, y: 0.143219, color: [24,12,8]}]
    const screenValkyrieGift = [{x: 0.659722, y: 0.903676, color: [73,158,22]}]
    
    // ============ Hydra ===========
    const screenHydraNoMoreFairies = [{x: 0.823495, y: 0.067807, color: [30,15,20]}]
    
    // ============ Tower ===========
    const screenTowerChestAvailable = [{x: 0.638889, y: 0.731939, color: [69, 166, 31]}]
    const screenTowerRewardPopup = [{x: 0.711806, y: 0.900507, color: [68,165,30]}]
    
    // ============ Camp ===========
    const screenCampAttackButton = [{x: 0.659722, y: 0.493663, color: [255,253,239]}]
    const screenCampBattleTransition = [{x: 0.500000, y: 0.500000, color: [0,0,0]}]
    const screenCampPopupAttackButton = [{x: 0.460648, y: 0.756654, color: [56,146,0]}]
    const screenCampBattleEnd = [{x: 0.860532, y: 0.867554, color: [92,192,35]}]
    const screenCampSearchClosed = [{x: 0.854167, y: 0.527883, color: [36,48,67]}]
    
    // ============ Chest ===========
    const screenChestRewardPopup = [{x: 0.381366, y: 0.050697, color: [255,250,187]}]
    const screenFreeChestAvailable = [{x: 0.409144, y: 0.857414, color: [169,255,190]}]


    // ======== REMOTE CONTROL via own Telegram bot ==========
    const TELEGRAM_REMOTE_CONTROL = false
    const TELEGRAM_CONTROL_URL = 'http://127.0.0.1:8765'
    const TELEGRAM_POLL_INTERVAL = 1000
    const TELEGRAM_LAST_COMMAND_KEY = 'telegram_dungeon_last_command'
    const TELEGRAM_NOTIFY_EVERY_N_FLOORS = 10 // отправлять сообщение в Telegram каждые N пройденных этажей

    // Отправляет произвольное сообщение в Telegram через локальный сервер.
    // ОЖИДАЕТСЯ, что локальный сервер (TELEGRAM_CONTROL_URL) умеет принимать
    // POST /notify с телом {message: "..."} и пересылать его в Telegram.
    async function sendTelegramNotify(message) {
        if (!TELEGRAM_REMOTE_CONTROL) {
            return
        }

        console.log('[Telegram] sending notify:', message)

        try {
            const response = await fetch(
                `${TELEGRAM_CONTROL_URL}/notify`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    cache: 'no-store',
                    body: JSON.stringify({ message })
                }
            )

            if (!response.ok) {
                console.log('[Telegram] notify server responded with error:', response.status, await response.text())
            } else {
                console.log('[Telegram] notify sent OK')
            }
        } catch (error) {
            console.log('[Telegram] notify failed:', error.message)
        }
    }

    function formatNowForTelegram() {
        return new Date().toLocaleString('ru-RU', { hour12: false })
    }

    
    // ========= CRASH HANDLERS =========
    // ----------------------- mmoebius
    // ugly workaround to check if errors occured
    // hwa displays an exception popup (class = 'error-card') in client if an error occures
    // we use that to continously check if an exception is fired since console.error not always includes something to handle
    async function checkError() {
        function resolveAfterDelay() {
            return new Promise((resolve) => {
                setTimeout(() => {
                    const errors = document.getElementsByClassName('error-card');
                    if(errors.length > 0) {
                        reloadPage('обнаружена ошибка на странице (error-card)');
                    }
                    resolve("");
                }, 1000);
            });
        }
        while (true) {
            const result = await resolveAfterDelay();
        };
    }
    checkError();

    function processRequest(call) {
        //addError('Captured:' + JSON.stringify(call));
    }

    const ALLOWED_METHODS = new Set(['eternalStory_getState', 'dungeonGetInfo'])
    window.addEventListener('message', (event) => {
        if (
            event.source === window &&
            event.data?.source === 'hw-ext' &&
            event.data?.type === 'rpc-capture'
        ) {
            const payload = event.data.payload;
            for (const c of payload.calls) {
                if (ALLOWED_METHODS.has(c.method)) {
                    processRequest(c)
                }
            }
        }
    });

    // keeps the last 10 errors as separate spans inside #errorContainer
    function addError(msg) {
        const container = document.getElementById('errorContainer')
        if (!container) return

        const now = new Date();
        const time = now.toTimeString().slice(0, 8);

        const span = document.createElement('div')
        span.textContent = "[" + time + "] " + msg.slice(0, 200);

        container.appendChild(span)

        while (container.children.length > 20) {
            container.removeChild(container.firstChild)
        }

        container.scrollTop = container.scrollHeight

        if (PERSIST_LOGS) {
            const logs = Array.from(container.children).map(el => el.textContent)
            localStorage.setItem(PERSISTED_LOGS_KEY, JSON.stringify(logs))
        }
    }

    let macroErrorPopupEl = null
    function showMacroErrorPopup(message) {
        if (!macroErrorPopupEl) {
            macroErrorPopupEl = document.createElement('div')
            macroErrorPopupEl.id = 'macroErrorPopup'
            Object.assign(macroErrorPopupEl.style, {
                position: 'fixed',
                display: 'none',
                zIndex: '9999999',
                minWidth: '320px',
                maxWidth: '480px',
                padding: '16px',
                border: '1px solid rgb(212,161,110)',
                borderRadius: '10px',
                background: 'rgb(14,20,35)',
                boxShadow: '0 0 18px rgba(0,140,255,0.3)',
                color: '#d9ecff',
                fontSize: '14px',
                fontFamily: 'Trebuchet MS, Verdana, sans-serif',
                backdropFilter: 'blur(4px)'
            })

            const textEl = document.createElement('div')
            textEl.id = 'macroErrorPopupText'
            Object.assign(textEl.style, {
                marginBottom: '12px',
                wordBreak: 'break-word'
            })
            macroErrorPopupEl.appendChild(textEl)

            const okButton = document.createElement('button')
            okButton.textContent = 'OK'
            Object.assign(okButton.style, {
                display: 'block',
                marginLeft: 'auto',
                marginRight: 'auto',
                background: 'linear-gradient(180deg, #8bd0ff 0%, #2f7fc4 55%, #1a4f80 100%)',
                color: '#eef7ff',
                border: '1px solid #7ec8f2',
                borderRadius: '8px',
                padding: '4px 16px',
                fontWeight: 'bold',
                cursor: 'pointer',
                textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                boxShadow: '0 0 10px rgba(80,180,255,0.3), inset 0 1px 0 rgba(255,255,255,0.25)',
                transition: '0.15s ease'
            })
            okButton.onmouseenter = () => {
                okButton.style.filter = 'brightness(1.12)'
            }
            okButton.onmouseleave = () => {
                okButton.style.filter = 'brightness(1)'
            }
            okButton.addEventListener('click', (e) => {
                e.stopPropagation()
                macroErrorPopupEl.style.display = 'none'
            })
            macroErrorPopupEl.appendChild(okButton)

            document.body.appendChild(macroErrorPopupEl)
        }

        macroErrorPopupEl.querySelector('#macroErrorPopupText').textContent = message

        const anchor = document.getElementById('dailyButton')
        if (anchor) {
            const rect = anchor.getBoundingClientRect()
            macroErrorPopupEl.style.left = `${rect.left}px`
            macroErrorPopupEl.style.top = `${rect.bottom + 6}px`
        }
        macroErrorPopupEl.style.display = 'block'
    }

    // counts reloads towards the "reloads: [N]" toolbar indicator, notifies Telegram
    // (awaited BEFORE location.reload(), otherwise navigation can cut off the request), then reloads the page.
    // reloadInFlight guards against duplicate triggers piling up while the notify is in flight
    // (e.g. checkError()'s 1s poll seeing the same still-present error-card again) - only the
    // first call counts the reload and sends the notify.
    let reloadInFlight = false
    async function reloadPage(reason = 'unknown') {
        if (reloadInFlight) {
            return
        }
        reloadInFlight = true

        const count = (parseInt(localStorage.getItem(MACRO_RELOAD_COUNT_KEY), 10) || 0) + 1
        localStorage.setItem(MACRO_RELOAD_COUNT_KEY, String(count))
        await sendTelegramNotify(`🔄 Страница перезагружается (${reason})\nВремя: ${formatNowForTelegram()}`)
        location.reload()
    }

    window.addEventListener('unhandledrejection', (e) => {
        const msg = String(e.reason);
        if (msg.includes('OOM') || msg.includes('memory access out of bounds') || msg.includes('Internal Server Error')) {
            reloadPage('критическая ошибка (unhandledrejection): ' + msg.slice(0, 120));
        } else {
            addError(msg)
        }
    });

    const originalError = console.error;
    console.error = function (...args) {
        const msg = args.join(' ');
        if (msg.includes('OOM') || msg.includes('memory access out of bounds') || msg.includes('Internal Server Error')) {
            reloadPage('критическая ошибка (console.error): ' + msg.slice(0, 120));
        } else {
            addError(msg)
        }
        return originalError.apply(console, args);
    };

    // ===== WAITING UNTIL GAME INITIALIZED =====
    const check = setInterval(async () => {
        const canvas = document.getElementById('gameCanvas')
        if (canvas) {
            clearInterval(check)
            setTimeout(async () => await startMainScript(canvas), GAME_LOAD_TIMEOUT)
        }
    }, 200)

    async function startMainScript(gameCanvas) {
        /// Send your ideas for improvements to HWA: Deidara/Phoenix Rebirth or to Discord: @int021h

        await sendTelegramNotify(`🚀 Скрипт запущен\nВремя: ${formatNowForTelegram()}`)

        let gameArea = gameCanvas.getBoundingClientRect()
        let canvasScaleX = gameCanvas.width / gameArea.width
        let canvasScaleY = gameCanvas.height / gameArea.height

        // MACRO stuff

        let isRunningMacro = null

        // ======== TELEGRAM CONTROL =====================================================
        let telegramPollTimer = null
        let telegramPollRunning = false

        function telegramGetLastCommand() {
            return localStorage.getItem(TELEGRAM_LAST_COMMAND_KEY) || '0'
        }

        function telegramSetLastCommand(id) {
            localStorage.setItem(TELEGRAM_LAST_COMMAND_KEY, String(id))
        }

        async function telegramPoll() {
            if (telegramPollRunning) return
            telegramPollRunning = true

            try {
                const response = await fetch(
                    `${TELEGRAM_CONTROL_URL}/command?last=${encodeURIComponent(telegramGetLastCommand())}`,
                    {
                        method: 'GET',
                        cache: 'no-store'
                    }
                )

                if (!response.ok) {
                    return
                }

                const command = await response.json()

                if (!command || !command.id || !command.command) {
                    return
                }

                telegramSetLastCommand(command.id)

                console.log(
                    '[Telegram] command:',
                    command.command,
                    'id:',
                    command.id
                )

                if (command.command === 'start') {

                    // Не запускаем второй экземпляр Dungeon
                    if (isRunningMacro !== MACRO_DUNGEON) {
                        console.log('[Telegram] Starting Dungeon')
                        // ВАЖНО: не await'им - runDungeonMacro() работает часами,
                        // а await здесь заблокировал бы опрос команд (в т.ч. /stop)
                        // до самого завершения забега.
                        runDungeonMacro().catch((error) => {
                            console.log('[Dungeon] runDungeonMacro error:', error?.message || error)
                        })
                    }

                } else if (command.command === 'stop') {

                    // Останавливаем только если Dungeon действительно работает
                    if (isRunningMacro === MACRO_DUNGEON) {
                        console.log('[Telegram] Stopping Dungeon')

                        isRunningMacro = null

                        setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
                        await releaseWakeLock()
                        await sendTelegramNotify(`⏹ Скрипт остановлен\nВремя: ${formatNowForTelegram()}`)
                    }
                }

            } catch (error) {
                // Telegram server может быть временно недоступен.
                // Не считаем это ошибкой игры.
                console.log('[Telegram] control unavailable:', error.message)
            } finally {
                telegramPollRunning = false
            }
        }

        async function startTelegramControl() {
            if (!TELEGRAM_REMOTE_CONTROL) {
                return
            }

            if (telegramPollTimer !== null) {
                return
            }

            // Получаем текущую команду Telegram,
            // но НЕ выполняем её.
            try {
                const response = await fetch(
                    `${TELEGRAM_CONTROL_URL}/status`,
                    {
                        method: 'GET',
                        cache: 'no-store'
                    }
                )

                if (response.ok) {
                    const status = await response.json()

                    if (status && status.id) {
                        telegramSetLastCommand(status.id)

                        console.log(
                            '[Telegram] Ignoring old command:',
                            status.command,
                            'id:',
                            status.id
                        )
                    }
                }

            } catch (error) {
                console.log(
                    '[Telegram] Initial sync unavailable:',
                    error.message
                )
            }

            telegramPollTimer = setInterval(
                telegramPoll,
                TELEGRAM_POLL_INTERVAL
            )
        }

        let lvlTitle = ""
        let delayFactor = Number(localStorage.getItem("delayFactor") || 1.0)

        // Pixel color picker
        const gl = gameCanvas.getContext('webgl2')
        const pixels = new Uint8Array(4)
        let pendingRead = null
        
        let isRecordingClicks = false
        let recordedClicks = []
        let recordingConfig = { repeats: 1000, delay: 300 }

        // ======== MACRO SESSION STATUS (time since start / reload count) ========
        let macroTimeEl = null
        let macroTimerInterval = null

        //// =========== ELEMENTS PRIORITY =========== ////
        const STORAGE_KEY = 'elements_priority'
        let elementsOrder = loadOrder()
        function loadOrder() {
            try {
                const saved = JSON.parse(
                    localStorage.getItem(STORAGE_KEY)
                )
                if (!Array.isArray(saved)) {
                    return DEFAULT_ORDER
                }
                const mapped = saved
                    .map(id => DEFAULT_ORDER.find(x => x.id === id))
                    .filter(Boolean)
                if (mapped.length !== DEFAULT_ORDER.length) {
                    return DEFAULT_ORDER
                }
                return mapped
            } catch {
                return DEFAULT_ORDER
            }
        }

        function saveOrder() {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(elementsOrder.map(x => x.id))
            )
        }

        function formatDuration(ms) {
            const totalSeconds = Math.max(0, Math.floor(ms / 1000))
            const hours = Math.floor(totalSeconds / 3600)
            const minutes = Math.floor((totalSeconds % 3600) / 60)
            const seconds = totalSeconds % 60
            if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
            if (minutes > 0) return `${minutes}m ${seconds}s`
            return `${seconds}s`
        }

        function updateMacroStatusDisplay() {
            const startTime = parseInt(localStorage.getItem(MACRO_SESSION_START_KEY), 10)
            const reloads = parseInt(localStorage.getItem(MACRO_RELOAD_COUNT_KEY), 10) || 0
            if (macroTimeEl) {
                const duration = Number.isFinite(startTime) ? formatDuration(Date.now() - startTime) : '0s'
                macroTimeEl.textContent = `${duration} (${reloads})`
            }
        }

        // isResume: true when a macro is being auto-continued after a page reload,
        // as opposed to a fresh start requested by the user - only a fresh start resets the counters
        function startMacroSession(isResume = false) {
            if (!isResume) {
                localStorage.setItem(MACRO_SESSION_START_KEY, String(Date.now()))
                localStorage.setItem(MACRO_RELOAD_COUNT_KEY, '0')
            }
            if (macroTimerInterval == null) {
                macroTimerInterval = setInterval(updateMacroStatusDisplay, 1000)
            }
            updateMacroStatusDisplay()
        }

        function stopMacroSession() {
            localStorage.setItem(LAST_MACRO_KEY, null)

            if (macroTimerInterval != null) {
                clearInterval(macroTimerInterval)
                macroTimerInterval = null
            }
            updateMacroStatusDisplay()
        }

        async function releaseWakeLock() {
            stopMacroSession()
            if (wakeLock != null) {
                await wakeLock.release()
                wakeLock = null
            }
        }

        async function sleep(ms, macro = null) {
            const time = Math.round(ms * delayFactor)
            if (macro == null) {
                return new Promise(r => setTimeout(r, time))
            } else {
                return new Promise(resolve => {
                    const start = Date.now()
                    const check = () => {
                        if (macro == null && isRunningMacro == null) {
                            resolve(false)
                            return;
                        } else if (isRunningMacro != macro) {
                            resolve(false)
                            return
                        }
                        if (Date.now() - start >= time) {
                            resolve(true)
                            return
                        }
                        setTimeout(check, 100)
                    }
                    check()
                })
            }
        }

        const originalRAF = window.requestAnimationFrame.bind(window)
        window.requestAnimationFrame = function(callback) {
            return originalRAF(function(time) {
                try {
                    callback(time)
                } finally {
                }

                const req = pendingRead
                if (!req) return
                pendingRead = null

                const colors = req.coords.map(([x, y]) => {
                    gl.readPixels(
                        x,
                        gl.canvas.height - y,
                        1,
                        1,
                        gl.RGBA,
                        gl.UNSIGNED_BYTE,
                        pixels
                    )

                    return [pixels[0], pixels[1], pixels[2]]
                })

                req.resolve(colors)
            })
        }

        function readColorsAtCoords(coords) {
            return new Promise(resolve => {
                pendingRead = { coords, resolve }
            })
        }

        let wakeLock = null
        async function enableWakeLock() {
            try {
                wakeLock = await navigator.wakeLock.request('screen')
                console.log('Wake Lock enabled')
                wakeLock.addEventListener('release', () => {
                    console.log('Wake Lock released')
                })
            } catch (err) {
                console.error(err)
            }
        }

        function getColorCategory(pixel) {
            const [r, g, b, a] = pixel
            if (r > 195 && r < 240 && g > 200 && b < 100) {
                return 'mixed' // gray
            }
            if (r >= g && r >= b) {
                return 'fire' // red
            }
            if (g >= r && g >= b) {
                return 'earth' // green
            }
            return 'water' // blue
        }

        function colorsAreSame(color1, color2, threshold = COLORS_MATCH_THRESHOLD) {
            if (Math.abs(color1[0] - color2[0]) > threshold) return false
            if (Math.abs(color1[1] - color2[1]) > threshold) return false
            if (Math.abs(color1[2] - color2[2]) > threshold) return false
            return true
        }

        function setActivated(button, active, activeLabel, inactiveLabel) {
            button.textContent = active ? activeLabel : inactiveLabel
            if (active) {
                button.style.background = 'linear-gradient(180deg, #d39a45 0%, #a86d1d 50%, #7b480d 100%)'
                button.style.border = '1px solid #d5a45d'
                button.style.boxShadow = '0 3px 6px rgba(0,0,0,0.65), inset 0 2px 3px rgba(255,255,255,0.45), inset 0 -4px 6px rgba(70,35,0,0.35)'
                button.style.color = '#fffdf5'
                button.style.textShadow = '0 2px 2px rgba(0,0,0,0.8)'
            } else {
                button.style.background = 'linear-gradient(180deg, #65d51a 0%, #3cab08 50%, #247d00 100%)'
                button.style.border = '1px solid #c9974b'
                button.style.boxShadow = '0 3px 6px rgba(0,0,0,0.65), inset 0 2px 3px rgba(255,255,255,0.45), inset 0 -4px 6px rgba(0,60,0,0.3)'
                button.style.color = '#fffdf5'
                button.style.textShadow = '0 2px 2px rgba(0,0,0,0.8)'
            }
        }

        const FRONTIER_ATTEMPTS_STORAGE_KEY = 'frontierAttempts'
        const FRONTIER_TEAMS_STORAGE_KEY = 'frontierTeams'
        const FRONTIER_GROUPS_STORAGE_KEY = 'frontierGroups'

        function parseFrontierGroups(text) {
            if (text === null) return null
            const groups = text.split(',').map(s => s.trim()).filter(s => s.length > 0)
            if (groups.length === 0) {
                return null
            }
            const pairs = []
            for (const group of groups) {
                const match = group.match(/^(\d+)(?:-(\d+))?$/)
                if (!match) {
                    return null
                }
                const start = parseInt(match[1], 10)
                const end = match[2] !== undefined ? parseInt(match[2], 10) : start
                if (end < start) {
                    return null
                }
                pairs.push([start, end])
            }
            return pairs
        }

        function addNiceToolbar() {
            const greenButtonStyle = {
                background: 'linear-gradient(180deg, #65d51a 0%, #3cab08 50%, #247d00 100%)',
                color: '#fffdf5',
                border: '1px solid #c9974b',
                borderRadius: '8px',
                padding: '4px 12px',
                minHeight: '32px',
                fontWeight: 'normal',
                fontSize: '14px',
                cursor: 'pointer',
                textShadow: '0 2px 2px rgba(0,0,0,0.8)',
                boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.45), inset 0 -4px 6px rgba(0,60,0,0.3)',
                transition: 'all 0.15s ease'
            }

            
            const blueButtonStyle = {
                background: 'linear-gradient(180deg, rgb(48,141,219) 0%, rgb(12,103,182) 55%, rgb(4, 69, 125) 100%)',
                color: '#fff6d6',
                border: '1px solid #b18f45',
                borderRadius: '8px',
                padding: '4px 12px',
                minHeight: '32px',
                fontWeight: 'normal',
                fontSize: '14px',
                cursor: 'pointer',
                textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.45), inset 0 -4px 6px rgba(0,60,0,0.3)',
                transition: '0.15s ease'
            }
            
            
            const inputStyle = {
                borderRadius: '6px',
                border: '2px solid transparent',
                background: 'linear-gradient(#2d3543, #2d3543) padding-box, linear-gradient(to right, rgb(42,29,15), rgb(212,161,110), rgb(42,29,15)) border-box',
                color: '#eef7ff',
                padding: '4px 6px',
                transition: 'background-color 0.2s ease, border-color 0.2s ease'
            }

            const frontierFieldStyle = {
                width: '100%',
                boxSizing: 'border-box',
                borderRadius: '6px',
                border: '2px solid transparent',
                background: 'linear-gradient(#2d3543, #2d3543) padding-box, linear-gradient(to right, rgb(42,29,15), rgb(212,161,110), rgb(42,29,15)) border-box',
                color: '#eef7ff',
                padding: '4px 6px',
                transition: 'background-color 0.2s ease, border-color 0.2s ease'
            }

            /*
            textInput.style.border = '2px solid transparent';
            textInput.style.borderRadius = '8px';   
            textInput.style.background = 'linear-gradient(#fff, #fff) padding-box, linear-gradient(to right, rgb(42,29,15), rgb(212,161,110), rgb(42,29,15)) border-box';
            */
            const hpLimit = Number(localStorage.getItem("stopHPLimit") || 0)

            const container = document.createElement('span')
            container.style.display = 'inline-flex'
            container.style.alignItems = 'center'
            container.style.gap = '6px'
            container.style.padding = '10px 50px'
            container.style.marginLeft = '12px'
            //container.style.border = '1px solid rgba(120,180,255,0.35)'
            //container.style.borderRadius = '10px'
            //container.style.background = 'linear-gradient(180deg, rgba(20,30,55,0.92) 0%, rgba(8,12,25,0.92) 100%)'
            container.style.background = 'linear-gradient(90deg, transparent 0%, rgba(20, 30, 55, 0.92) 10%, rgba(20, 30, 55, 0.92) 90%, transparent 100%)'
            //container.style.boxShadow = '0 0 12px rgba(0,140,255,0.18)'
            container.style.color = '#d9ecff'
            container.style.fontSize = '16px'
            container.style.fontFamily = 'Trebuchet MS, Verdana, sans-serif'
            container.style.backdropFilter = 'blur(2px)'

            const selectStyle = (el) => {
                el.style.background = 'linear-gradient(180deg, #31486d 0%, #1a2740 100%)'
                el.style.color = '#eef7ff'
                el.style.border = '1px solid #5ea8ff'
                el.style.borderRadius = '6px'
                el.style.padding = '2px 6px'
                el.style.outline = 'none'
                el.style.cursor = 'pointer'
                el.style.boxShadow = '0 0 6px rgba(80,160,255,0.25)'
            }

            const selectFactor = document.createElement('select')
            selectFactor.id = 'delayFactor'
            selectStyle(selectFactor)

            const factor1 = document.createElement('option')
            factor1.value = '1.0'
            factor1.selected = delayFactor == 1.0
            factor1.textContent = '1x'

            const factor11 = document.createElement('option')
            factor11.value = '1.1'
            factor11.selected = delayFactor == 1.1
            factor11.textContent = '1.1x'

            const factor12 = document.createElement('option')
            factor12.value = '1.2'
            factor12.selected = delayFactor == 1.2
            factor12.textContent = '1.2x'

            const factor15 = document.createElement('option')
            factor15.value = '1.5'
            factor15.selected = delayFactor == 1.5
            factor15.textContent = '1.5x'

            const factor20 = document.createElement('option')
            factor20.value = '2.0'
            factor20.selected = delayFactor == 2.0
            factor20.textContent = '2x'

            const factor30 = document.createElement('option')
            factor30.value = '3.0'
            factor30.selected = delayFactor == 3.0
            factor30.textContent = '3x'

            selectFactor.append(
                factor1,
                factor11,
                factor12,
                factor15,
                factor20,
                factor30
            )

            const select = document.createElement('select')
            select.id = 'stopHPLimit'
            selectStyle(select)

            const option1 = document.createElement('option')
            option1.value = '0'
            option1.textContent = 'If titan dies'
            option1.selected = hpLimit == 0
            const option2 = document.createElement('option')
            option2.value = '30'
            option2.selected = hpLimit == 30
            option2.textContent = 'If HP < 30%'
            const option3 = document.createElement('option')
            option3.value = '50'
            option3.selected = hpLimit == 50
            option3.textContent = 'If HP < 50%'
            const option4 = document.createElement('option')
            option4.value = '100'
            option4.selected = hpLimit == 100
            option4.textContent = 'Never'
            select.append(option1, option2, option3, option4)

            const dungeonButton = document.createElement('button')
            dungeonButton.id = 'dungeonMacroButton'
            dungeonButton.textContent = BUTTON_TEXT_RUN_DUNGEON
            Object.assign(dungeonButton.style, greenButtonStyle)

            dungeonButton.onmouseenter = () => {
                dungeonButton.style.filter = 'brightness(1.12)'
            }
            dungeonButton.onmouseleave = () => {
                dungeonButton.style.filter = 'brightness(1)'
            }
            dungeonButton.addEventListener('click', () => runDungeonMacro())

            const debugButton = document.createElement('button')
            debugButton.id = 'debugButton'
            debugButton.textContent = BUTTON_TEXT_RUN_DEBUG

            Object.assign(debugButton.style, greenButtonStyle)
            debugButton.onmouseenter = () => {
                debugButton.style.filter = 'brightness(1.12)'
            }
            debugButton.onmouseleave = () => {
                debugButton.style.filter = 'brightness(1)'
            }
            debugButton.addEventListener('click', toggleDebug)

            // ---------- container ----------
            const elements = document.createElement('div')
            elements.id = 'elementsPriorityToolbar'
            Object.assign(elements.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                userSelect: 'none',
                zIndex: '999999'
            })

            // ---------- render ----------
            function render() {
                elements.innerHTML = ''
                elementsOrder.forEach((item, index) => {
                    const el = document.createElement('div')
                    el.draggable = true
                    el.dataset.index = index
                    el.dataset.id = item.id
                    el.textContent = item.label
                    Object.assign(el.style, {
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        cursor: 'grab',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'sans-serif',
                        fontSize: '12px',
                        fontWeight: 'normal',
                        background: item.background,
                        color: item.textColor || 'white',
                        border: `2px solid ${item.bColor}`,
                        boxSizing: 'border-box',
                        transition: 'transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease'
                    })
                    el.addEventListener('dragstart', onDragStart)
                    el.addEventListener('dragover', onDragOver)
                    el.addEventListener('drop', onDrop)
                    el.addEventListener('dragend', onDragEnd)
                    elements.appendChild(el)
                })
            }

            // ---------- drag ----------
            let dragIndex = null
            function onDragStart(e) {
                dragIndex = Number(e.target.dataset.index)
                e.target.style.opacity = '0.5'
                e.target.style.transform = 'scale(1.15)'
            }
            function onDragOver(e) {
                e.preventDefault()
            }
            function onDrop(e) {
                e.preventDefault()
                const dropIndex = Number(e.target.dataset.index)
                if (
                    dragIndex === null ||
                    dragIndex === dropIndex
                ) {
                    return
                }
                const moved = elementsOrder.splice(dragIndex, 1)[0]
                elementsOrder.splice(dropIndex, 0, moved)
                saveOrder()
                render()
            }

            function onDragEnd(e) {
                e.target.style.opacity = '1'
                e.target.style.transform = 'scale(1)'
            }

            // ---------- glow animation ----------
            let animationFrame = null
            let glowPhase = 0
            function animateGlow() {
                glowPhase += 0.08
                const intensity =
                      0.5 + (Math.sin(glowPhase) + 1) / 2
                document
                    .querySelectorAll('.element-circle-active')
                    .forEach(el => {
                    el.style.transform =
                        `scale(${1 + intensity * 0.12})`
                    el.style.boxShadow =
                        `0 0 ${8 + intensity * 10}px white`
                })
                animationFrame = requestAnimationFrame(animateGlow)
            }
            animateGlow()
            // ---------- public API ----------
            window.setActiveElements = function(ids) {
                document
                    .querySelectorAll('#elementsPriorityToolbar > div')
                    .forEach(el => {
                    if (ids.includes(el.dataset.id)) {
                        if (el.dataset.id == ids[0]) {
                            el.classList.add('element-circle-active')
                        } else {
                            el.classList.remove('element-circle-active')
                            el.style.transform = `scale(1.05)`
                            el.style.boxShadow = `0 0 8px white`
                        }
                    } else {
                        el.classList.remove('element-circle-active')
                        el.style.boxShadow = 'none'
                        el.style.transform = 'scale(1)'
                    }
                })
            }

            render()

            // =========== DAILY ===========

            const dailyButton = document.createElement('button')
            dailyButton.id = 'dailyButton'
            dailyButton.textContent = BUTTON_TEXT_RUN_CUSTOM

            Object.assign(dailyButton.style, greenButtonStyle, {
                marginLeft: '10px'
            })
            
            dailyButton.onmouseenter = () => {
                dailyButton.style.filter = 'brightness(1.12)'
            }

            dailyButton.onmouseleave = () => {
                dailyButton.style.filter = 'brightness(1)'
            }

            // ---------- macro session status (time since start (reloads)) ----------
            macroTimeEl = document.createElement('span')
            macroTimeEl.id = 'macroTimeEl'
            macroTimeEl.textContent = '0s (0)'
            Object.assign(macroTimeEl.style, {
                color: '#fff6d6',
                fontSize: '12px',
                padding: '6px 10px',
                marginLeft: '10px',
                marginRight: '10px',
                borderRadius: '6px',
                border: '1px solid rgb(212,161,110)',
            })

            //startMacroSession(true)

            // ---------- popup ----------

            const dailyPopup = document.createElement('div')
            dailyPopup.id = 'dailyPopup'
            Object.assign(dailyPopup.style, {
                position: 'fixed',
                display: 'none',
                zIndex: '9999999',
                minWidth: '470px',
                padding: '0',
                overflow: 'hidden',
                border: '1px solid rgb(212,161,110)',
                borderRadius: '10px',
                background: 'rgb(14,20,35)',
                boxShadow: '0 0 18px rgba(0,140,255,0.3)',
                color: '#d9ecff',
                fontSize: '14px',
                fontFamily: 'Trebuchet MS, Verdana, sans-serif',
                backdropFilter: 'blur(4px)'
            })

            // ---------- section menu (left) + content (right) ----------
            const dailyPopupBody = document.createElement('div')
            Object.assign(dailyPopupBody.style, {
                display: 'flex',
                alignItems: 'stretch',
                gap: '0',
                maxHeight: '800px',
                overflowY: 'auto',
                background: 'linear-gradient(to bottom,rgb(14,20,35),rgb(45, 53, 67),rgb(14,20,35))'
            })
            dailyPopup.appendChild(dailyPopupBody)

            const dailyPopupMenu = document.createElement('div')
            Object.assign(dailyPopupMenu.style, {
                display: 'flex',
                flexDirection: 'column',
                gap: '0',
                flex: '0 0 auto',
                background: 'rgb(13,19,32)'
            })
            dailyPopupBody.appendChild(dailyPopupMenu)

            const dailyPopupMenuSplitter = document.createElement('div')
            Object.assign(dailyPopupMenuSplitter.style, {
                width: '1px',
                background: 'linear-gradient(to bottom, transparent, rgb(212,161,110), transparent)'
            })
            dailyPopupBody.appendChild(dailyPopupMenuSplitter)

            const dailyPopupContent = document.createElement('div')
            Object.assign(dailyPopupContent.style, {
                flex: '1',
                minWidth: '320px',
                padding: '12px'
            })
            dailyPopupBody.appendChild(dailyPopupContent)

            const dailyPopupSections = []
            const ACTIVE_MENU_ITEM_TEXT_COLOR = '#fffdf5'
            const INACTIVE_MENU_ITEM_TEXT_COLOR = 'rgb(239,204,148)'

            function activateDailyPopupSection(section) {
                dailyPopupSections.forEach(s => {
                    const active = s === section
                    s.panel.style.display = active ? 'block' : 'none'
                    s.menuItem.style.background = active
                        ? 'linear-gradient(to bottom right, transparent, rgb(50,72,120), rgb(105,103,120))'
                        : 'transparent'
                    s.menuItem.style.color = active ? ACTIVE_MENU_ITEM_TEXT_COLOR : INACTIVE_MENU_ITEM_TEXT_COLOR
                })
            }

            function makeDailyPopupPanel(label, emoji) {
                const panel = document.createElement('div')
                panel.style.display = 'none'
                dailyPopupContent.appendChild(panel)

                if (dailyPopupSections.length > 0) {
                    const splitter = document.createElement('div')
                    Object.assign(splitter.style, {
                        height: '1px',
                        width: '100%',
                        background: 'linear-gradient(to right, transparent, rgb(212,161,110), transparent)'
                    })
                    dailyPopupMenu.appendChild(splitter)
                }

                const menuItem = document.createElement('div')
                Object.assign(menuItem.style, {
                    width: '120px',
                    height: '60px',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    padding: '4px',
                    border: 'none',
                    background: 'transparent',
                    color: INACTIVE_MENU_ITEM_TEXT_COLOR,
                    fontSize: '13px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: '0.15s ease',
                    userSelect: 'none'
                })

                const menuItemEmoji = document.createElement('div')
                menuItemEmoji.textContent = emoji
                Object.assign(menuItemEmoji.style, {
                    fontSize: '28px',
                    lineHeight: '1'
                })
                menuItem.appendChild(menuItemEmoji)

                const menuItemLabel = document.createElement('div')
                menuItemLabel.textContent = label
                menuItem.appendChild(menuItemLabel)

                dailyPopupMenu.appendChild(menuItem)

                const section = { panel, menuItem }
                menuItem.addEventListener('click', (e) => {
                    e.stopPropagation()
                    activateDailyPopupSection(section)
                })
                dailyPopupSections.push(section)
                return panel
            }

            // =========== DUNGEON ===========
            const dungeonPanel = makeDailyPopupPanel('Dungeon', '⛏️')
            const dungeonSectionTitle = document.createElement('div')
            dungeonSectionTitle.textContent = 'Dungeon'
            Object.assign(dungeonSectionTitle.style, {
                fontWeight: 'bold',
                marginBottom: '8px',
                color: '#eef7ff',
                textAlign: 'center'
            })
            dungeonPanel.appendChild(dungeonSectionTitle)

            function makeDungeonSettingRow(labelText, control) {
                const row = document.createElement('div')
                Object.assign(row.style, {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '8px'
                })
                const label = document.createElement('span')
                label.textContent = labelText
                Object.assign(label.style, {
                    color: '#bcd6f5',
                    fontSize: '12px'
                })
                row.appendChild(label)
                row.appendChild(control)
                return row
            }

            dungeonPanel.appendChild(makeDungeonSettingRow('Room priority:', elements))
            dungeonPanel.appendChild(makeDungeonSettingRow('Delays multiplier:', selectFactor))
            dungeonPanel.appendChild(makeDungeonSettingRow('Stop:', select))

            Object.assign(dungeonButton.style, {
                width: 'fit-content',
                display: 'block',
                marginTop: '2px',
                marginLeft: 'auto',
                marginRight: 'auto'
            })
            dungeonPanel.appendChild(dungeonButton)

            // =========== DAILY ===========
            const dailyPanel = makeDailyPopupPanel('Daily tasks', '📅')
            const dailyTitle = document.createElement('div')
            dailyTitle.textContent = 'Daily tasks'
            Object.assign(dailyTitle.style, {
                fontWeight: 'bold',
                marginBottom: '8px',
                color: '#eef7ff',
                textAlign: 'center'
            })
            dailyPanel.appendChild(dailyTitle)
            const dailyTasks = [
                'heroic_chest',
                'tower',
                'expeditions',
                'hydra',
                'camps',
                'dungeon'
            ]
            const DAILY_TASKS_STORAGE_KEY = 'dailyTasksParams'
            function loadDailyTasksParams() {
                try {
                    const saved = JSON.parse(localStorage.getItem(DAILY_TASKS_STORAGE_KEY))
                    if (saved && typeof saved === 'object') {
                        return saved
                    }
                } catch {}
                return {}
            }
            function saveDailyTasksParams(params) {
                localStorage.setItem(DAILY_TASKS_STORAGE_KEY, JSON.stringify(params))
            }

            const savedDailyParams = loadDailyTasksParams()
            const dailyCheckboxes = {}
            dailyTasks.forEach(task => {
                const label = document.createElement('label')
                Object.assign(label.style, {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '4px 2px',
                    cursor: 'pointer',
                    userSelect: 'none'
                })
                const checkbox = document.createElement('input')
                checkbox.type = 'checkbox'
                checkbox.checked = savedDailyParams[task] !== undefined ? savedDailyParams[task] : true
                dailyCheckboxes[task] = checkbox
                label.appendChild(checkbox)
                label.appendChild(document.createTextNode(task))
                dailyPanel.appendChild(label)
            })
            const dailyStartButton = document.createElement('button')
            dailyStartButton.textContent = 'Start daily tasks'
            Object.assign(dailyStartButton.style, greenButtonStyle, {
                width: 'fit-content',
                display: 'block',
                marginTop: '10px',
                marginLeft: 'auto',
                marginRight: 'auto'
            })

            dailyStartButton.onmouseenter = () => {
                dailyStartButton.style.filter = 'brightness(1.12)'
            }

            dailyStartButton.onmouseleave = () => {
                dailyStartButton.style.filter = 'brightness(1)'
            }

            dailyStartButton.addEventListener('click', async () => {
                const params = {}
                dailyTasks.forEach(task => {
                    params[task] = dailyCheckboxes[task].checked
                })
                saveDailyTasksParams(params)
                dailyPopup.style.display = 'none'
                await runDailyTasks(params)
            })
            dailyPanel.appendChild(dailyStartButton)

            // =========== REPEAT CLICKS ===========
            const repeatClickPanel = makeDailyPopupPanel('Repeat clicks', '🔁')
            const repeatClickTitle = document.createElement('div')
            repeatClickTitle.textContent = 'Repeat clicks'
            Object.assign(repeatClickTitle.style, {
                fontWeight: 'bold',
                marginBottom: '8px',
                color: '#eef7ff',
                textAlign: 'center'
            })
            repeatClickPanel.appendChild(repeatClickTitle)

            const repeatClickColumn = document.createElement('div')
            Object.assign(repeatClickColumn.style, {
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
            })

            const repeatClickButton = document.createElement('button')
            repeatClickButton.id = 'repeatClickButton'
            repeatClickButton.textContent = BUTTON_TEXT_RUN_REPEAT_CLICK
            Object.assign(repeatClickButton.style, greenButtonStyle, {
                width: 'fit-content',
                display: 'block',
                marginLeft: 'auto',
                marginRight: 'auto'
            })
            repeatClickButton.onmouseenter = () => {
                repeatClickButton.style.filter = 'brightness(1.12)'
            }
            repeatClickButton.onmouseleave = () => {
                repeatClickButton.style.filter = 'brightness(1)'
            }

            function makeRepeatClickInput(labelText, title, defaultValue, storageKey) {
                const wrapper = document.createElement('label')
                Object.assign(wrapper.style, {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '4px',
                    color: '#bcd6f5',
                    fontSize: '12px'
                })

                const label = document.createElement('span')
                label.textContent = labelText
                wrapper.appendChild(label)

                const input = document.createElement('input')
                input.type = 'text'
                input.title = title
                input.value = Number(localStorage.getItem(storageKey) || defaultValue)
                Object.assign(input.style, inputStyle)
                input.style.textAlign = 'center'
                input.style.width = '56px'
                wrapper.appendChild(input)

                return { wrapper, input }
            }

            const repeatClickCount = makeRepeatClickInput('Repeats:', 'Number of times to repeat the recorded sequence', 1000, 'repeatClickCount')
            const repeatClickDelay = makeRepeatClickInput('Delay:', 'Delay between repeats (ms)', 300, 'repeatClickDelay')
            const repeatClickCountInput = repeatClickCount.input
            const repeatClickDelayInput = repeatClickDelay.input

            repeatClickColumn.appendChild(repeatClickCount.wrapper)
            repeatClickColumn.appendChild(repeatClickDelay.wrapper)
            repeatClickColumn.appendChild(repeatClickButton)
            repeatClickPanel.appendChild(repeatClickColumn)

            const repeatClickHint = document.createElement('div')
            repeatClickHint.innerHTML = 'Click "Start recording", then make the clicks in the game you want repeated.<br>Click "Stop recording" when done — the whole sequence replays N times,<br>with a D ms delay between repeats<br><i>ps: delays between the recorded clicks themselves are captured automatically</i>.'
            Object.assign(repeatClickHint.style, {
                marginTop: '6px',
                color: '#8fa8c4',
                fontSize: '11px',
                lineHeight: '1.4'
            })
            repeatClickPanel.appendChild(repeatClickHint)

            // ---------- stop recording button (shown under the Run... button while recording) ----------
            const stopRecordingButton = document.createElement('button')
            stopRecordingButton.id = 'stopRecordingButton'
            stopRecordingButton.textContent = BUTTON_TEXT_STOP_RECORDING
            Object.assign(stopRecordingButton.style, {
                position: 'fixed',
                display: 'none',
                zIndex: '9999999',
                background: 'linear-gradient(180deg, #ff8a7a 0%, #b3261e 55%, #5e0d0d 100%)',
                color: '#fff0f0',
                border: '1px solid #ffb0a8',
                borderRadius: '8px',
                padding: '4px 12px',
                fontWeight: 'bold',
                cursor: 'pointer',
                textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                boxShadow: '0 0 12px rgba(255,70,70,0.45), inset 0 1px 0 rgba(255,255,255,0.18)',
                transition: '0.15s ease'
            })
            stopRecordingButton.onmouseenter = () => {
                stopRecordingButton.style.filter = 'brightness(1.12)'
            }
            stopRecordingButton.onmouseleave = () => {
                stopRecordingButton.style.filter = 'brightness(1)'
            }
            document.body.appendChild(stopRecordingButton)

            function showStopRecordingButton() {
                const rect = dailyButton.getBoundingClientRect()
                stopRecordingButton.style.left = `${rect.left}px`
                stopRecordingButton.style.top = `${rect.bottom + 6}px`
                stopRecordingButton.style.display = 'block'
            }

            function hideStopRecordingButton() {
                stopRecordingButton.style.display = 'none'
            }

            function startRecordingClicks(repeats, delay) {
                recordedClicks = []
                recordingConfig = { repeats, delay }
                isRecordingClicks = true
                if (!DEBUG_CLICKS) {
                    gameCanvas.addEventListener('click', logMouse)
                }
                showStopRecordingButton()
            }

            function stopRecordingClicks() {
                isRecordingClicks = false
                if (!DEBUG_CLICKS) {
                    gameCanvas.removeEventListener('click', logMouse)
                }
                hideStopRecordingButton()
            }

            repeatClickButton.addEventListener('click', (e) => {
                e.stopPropagation()

                if (isRunningMacro == MACRO_REPEAT_CLICK) {
                    isRunningMacro = null
                    releaseWakeLock()
                    setActivated(repeatClickButton, false, BUTTON_TEXT_STOP_REPEAT_CLICK, BUTTON_TEXT_RUN_REPEAT_CLICK)
                    setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
                    return
                }

                if (isRecordingClicks) {
                    stopRecordingClicks()
                    setActivated(repeatClickButton, false, BUTTON_TEXT_ARMED_REPEAT_CLICK, BUTTON_TEXT_RUN_REPEAT_CLICK)
                    setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
                    return
                }

                const repeats = parseInt(repeatClickCountInput.value, 10) || 1000
                const delay = parseInt(repeatClickDelayInput.value, 10) || 300
                localStorage.setItem('repeatClickCount', repeats)
                localStorage.setItem('repeatClickDelay', delay)

                setActivated(repeatClickButton, true, BUTTON_TEXT_ARMED_REPEAT_CLICK, BUTTON_TEXT_RUN_REPEAT_CLICK)
                setActivated(dailyButton, true, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
                dailyPopup.style.display = 'none'
                startRecordingClicks(repeats, delay)
            })

            stopRecordingButton.addEventListener('click', (e) => {
                e.stopPropagation()
                stopRecordingClicks()

                if (recordedClicks.length > 0) {
                    runRepeatClickMacro([...recordedClicks], recordingConfig.repeats, recordingConfig.delay)
                } else {
                    setActivated(repeatClickButton, false, BUTTON_TEXT_ARMED_REPEAT_CLICK, BUTTON_TEXT_RUN_REPEAT_CLICK)
                    setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
                }
            })

            // =========== ETERNAL FRONTIER ===========
            const frontierPanel = makeDailyPopupPanel('Eternal frontier', '⚔️')
            const frontierTitle = document.createElement('div')
            frontierTitle.textContent = 'Eternal frontier'
            Object.assign(frontierTitle.style, {
                fontWeight: 'bold',
                marginBottom: '8px',
                color: '#eef7ff',
                textAlign: 'center'
            })
            frontierPanel.appendChild(frontierTitle)

            function makeFrontierFieldWrapper() {
                const wrapper = document.createElement('div')
                Object.assign(wrapper.style, {
                    marginBottom: '8px'
                })
                return wrapper
            }

            function makeFrontierLabel(text, hint) {
                const label = document.createElement('div')
                label.textContent = text
                if (hint) {
                    label.title = hint
                }
                Object.assign(label.style, {
                    color: '#bcd6f5',
                    fontSize: '12px',
                    marginBottom: '2px'
                })
                return label
            }

            function computeFrontierGroupsFromTeams(teamsCount) {
                return `1-${teamsCount - 2},${teamsCount - 1}-${teamsCount}`
            }

            function updateGroupsFromTeamsInput() {
                const teamsCount = parseInt(frontierTeamsInput.value, 10)
                if (Number.isInteger(teamsCount)) {
                    frontierInput.value = computeFrontierGroupsFromTeams(teamsCount)
                }
            }

            // ---------- attempts ----------
            const frontierAttemptsHint = 'Number of attempts before shuffling'
            const frontierAttemptsWrapper = makeFrontierFieldWrapper()
            frontierAttemptsWrapper.appendChild(makeFrontierLabel('Attempts', frontierAttemptsHint))
            const frontierAttemptsInput = document.createElement('input')
            frontierAttemptsInput.type = 'number'
            frontierAttemptsInput.min = '1'
            frontierAttemptsInput.step = '1'
            frontierAttemptsInput.title = frontierAttemptsHint
            frontierAttemptsInput.value = Number(localStorage.getItem(FRONTIER_ATTEMPTS_STORAGE_KEY) || 3)
            Object.assign(frontierAttemptsInput.style, frontierFieldStyle)
            frontierAttemptsWrapper.appendChild(frontierAttemptsInput)
            frontierPanel.appendChild(frontierAttemptsWrapper)

            // ---------- teams ----------
            const frontierTeamsHint = 'Number of your teams'
            const frontierTeamsWrapper = makeFrontierFieldWrapper()
            frontierTeamsWrapper.appendChild(makeFrontierLabel('Teams', frontierTeamsHint))
            const frontierTeamsRow = document.createElement('div')
            Object.assign(frontierTeamsRow.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
            })
            const frontierStepperButtonStyle = {
                width: '32px',
                height: '32px',
                minHeight: '32px',
                flex: '0 0 auto',
                padding: '0', 
                borderRadius: '16px',
                background: 'linear-gradient(to bottom, rgb(56,72,95) 0%, rgb(32,48,64) 100%)',
                border: '2px solid rgb(212,161,110)',
                color: 'rgb(212,161,110)',
                fontSize: '16px', 
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: '0.15s ease'
            }
            const frontierTeamsDecButton = document.createElement('button')
            frontierTeamsDecButton.type = 'button'
            frontierTeamsDecButton.textContent = '-'
            Object.assign(frontierTeamsDecButton.style, frontierStepperButtonStyle)
            const frontierTeamsInput = document.createElement('input')
            frontierTeamsInput.type = 'number'
            frontierTeamsInput.min = '1'
            frontierTeamsInput.step = '1'
            frontierTeamsInput.title = frontierTeamsHint
            frontierTeamsInput.value = Number(localStorage.getItem(FRONTIER_TEAMS_STORAGE_KEY) || 10)
            Object.assign(frontierTeamsInput.style, frontierFieldStyle, { textAlign: 'center' })
            const frontierTeamsIncButton = document.createElement('button')
            frontierTeamsIncButton.type = 'button'
            frontierTeamsIncButton.textContent = '+'
            Object.assign(frontierTeamsIncButton.style, frontierStepperButtonStyle)
            frontierTeamsDecButton.addEventListener('click', (e) => {
                e.stopPropagation()
                const current = parseInt(frontierTeamsInput.value, 10) || 0
                frontierTeamsInput.value = Math.max(1, current - 1)
                updateGroupsFromTeamsInput()
            })
            frontierTeamsIncButton.addEventListener('click', (e) => {
                e.stopPropagation()
                const current = parseInt(frontierTeamsInput.value, 10) || 0
                frontierTeamsInput.value = current + 1
                updateGroupsFromTeamsInput()
            })
            frontierTeamsInput.addEventListener('input', updateGroupsFromTeamsInput)
            frontierTeamsRow.appendChild(frontierTeamsDecButton)
            frontierTeamsRow.appendChild(frontierTeamsInput)
            frontierTeamsRow.appendChild(frontierTeamsIncButton)
            frontierTeamsWrapper.appendChild(frontierTeamsRow)
            frontierPanel.appendChild(frontierTeamsWrapper)

            // ---------- groups ----------
            const frontierGroupsHint = 'Shuffling groups. Teams will be shuffled only within specified range (1-4 means two teams will be shuffled within the first 4 teams)'
            const frontierGroupsWrapper = makeFrontierFieldWrapper()
            frontierGroupsWrapper.appendChild(makeFrontierLabel('Groups', frontierGroupsHint))
            const frontierInput = document.createElement('input')
            frontierInput.type = 'text'
            frontierInput.title = frontierGroupsHint
            frontierInput.placeholder = 'e.g. 1-4,5-7,8-9'
            const storedFrontierGroups = localStorage.getItem(FRONTIER_GROUPS_STORAGE_KEY)
            frontierInput.value = storedFrontierGroups || computeFrontierGroupsFromTeams(parseInt(frontierTeamsInput.value, 10))
            Object.assign(frontierInput.style, frontierFieldStyle)
            frontierGroupsWrapper.appendChild(frontierInput)
            frontierPanel.appendChild(frontierGroupsWrapper)

            function flashInvalidInput(input) {
                const originalBorder = input.style.border
                const originalBackground = input.style.background
                input.style.border = '1px solid #ff4444'
                input.style.background = 'rgba(255,68,68,0.25)'
                setTimeout(() => {
                    input.style.border = originalBorder
                    input.style.background = originalBackground
                }, 1000)
            }


            const frontierStartButton = document.createElement('button')
            frontierStartButton.textContent = 'Start frontier'
            Object.assign(frontierStartButton.style, greenButtonStyle, {
                width: 'fit-content',
                display: 'block',
                marginLeft: 'auto',
                marginRight: 'auto'
            })
            frontierStartButton.onmouseenter = () => {
                frontierStartButton.style.filter = 'brightness(1.12)'
            }
            frontierStartButton.onmouseleave = () => {
                frontierStartButton.style.filter = 'brightness(1)'
            }
            frontierPanel.appendChild(frontierStartButton)

            frontierStartButton.addEventListener('click', (e) => {
                e.stopPropagation()

                const pairs = parseFrontierGroups(frontierInput.value)
                if (!pairs) {
                    flashInvalidInput(frontierInput)
                    return
                }

                const attempts = parseInt(frontierAttemptsInput.value, 10)
                if (!Number.isInteger(attempts) || attempts < 1) {
                    flashInvalidInput(frontierAttemptsInput)
                    return
                }

                const teams = parseInt(frontierTeamsInput.value, 10)
                if (!Number.isInteger(teams) || teams < 1) {
                    flashInvalidInput(frontierTeamsInput)
                    return
                }

                localStorage.setItem(FRONTIER_ATTEMPTS_STORAGE_KEY, attempts)
                localStorage.setItem(FRONTIER_TEAMS_STORAGE_KEY, teams)
                localStorage.setItem(FRONTIER_GROUPS_STORAGE_KEY, frontierInput.value)
                dailyPopup.style.display = 'none'
                runFrontier(pairs, attempts, teams)
            })

            // =========== DELAYS ===========
            const delaysPanel = makeDailyPopupPanel('Delays', '⏱️')
            const delaysTitle = document.createElement('div')
            delaysTitle.textContent = 'Delays'
            Object.assign(delaysTitle.style, {
                fontWeight: 'bold',
                marginBottom: '8px',
                color: '#eef7ff',
                textAlign: 'center'
            })
            delaysPanel.appendChild(delaysTitle)

            const DELAY_SETTINGS = [
                { key: 'GAME_LOAD_TIMEOUT', label: 'Game initialization min time', defaultValue: 10000, getValue: () => GAME_LOAD_TIMEOUT, setValue: v => { GAME_LOAD_TIMEOUT = v } },
                { key: 'DELAY_CHECK_CYCLE', label: 'Max wait time until any required screen appears', defaultValue: 5000, getValue: () => DELAY_CHECK_CYCLE, setValue: v => { DELAY_CHECK_CYCLE = v } },
                { key: 'DELAY_AFTER_CLICKING_GUILD', label: 'Delay after clicking on "Guild"', defaultValue: 5000, getValue: () => DELAY_AFTER_CLICKING_GUILD, setValue: v => { DELAY_AFTER_CLICKING_GUILD = v } },
                { key: 'DELAY_AFTER_CLICKING_DUNGEON', label: 'Delay after clicking on "Dungeon"', defaultValue: 5000, getValue: () => DELAY_AFTER_CLICKING_DUNGEON, setValue: v => { DELAY_AFTER_CLICKING_DUNGEON = v } },
                { key: 'EXTRA_GATE_DELAY_FIRST_FLOOR', label: 'Extra delay for the first floor gate', defaultValue: 500, getValue: () => EXTRA_GATE_DELAY_FIRST_FLOOR, setValue: v => { EXTRA_GATE_DELAY_FIRST_FLOOR = v } },
                { key: 'EXTRA_WALK_DELAY_FIRST_FLOOR', label: 'Extra walk delay for the first floor', defaultValue: 2000, getValue: () => EXTRA_WALK_DELAY_FIRST_FLOOR, setValue: v => { EXTRA_WALK_DELAY_FIRST_FLOOR = v } },
                { key: 'EXTRA_FLOOR_DELAY_FIRST_FLOOR', label: 'Extra floor delay for the first floor', defaultValue: 3000, getValue: () => EXTRA_FLOOR_DELAY_FIRST_FLOOR, setValue: v => { EXTRA_FLOOR_DELAY_FIRST_FLOOR = v } },
                { key: 'EXTRA_DELAY_BEFORE_CONFIRM_BATTLE', label: 'Extra delay after HP check', defaultValue: 0, getValue: () => EXTRA_DELAY_BEFORE_CONFIRM_BATTLE, setValue: v => { EXTRA_DELAY_BEFORE_CONFIRM_BATTLE = v } },
                { key: 'DELAY_FOR_TITANS_WALK', label: 'Extra delay after battle confirmation', defaultValue: 500, getValue: () => DELAY_FOR_TITANS_WALK, setValue: v => { DELAY_FOR_TITANS_WALK = v } },
                { key: 'DELAY_AFTER_CLICKING_AUTOBATTLE', label: 'Min battle duration', defaultValue: 500, getValue: () => DELAY_AFTER_CLICKING_AUTOBATTLE, setValue: v => { DELAY_AFTER_CLICKING_AUTOBATTLE = v } },
                { key: 'DELAY_AFTER_GATE_CLICKED', label: 'Extra delay after clicking on lvl gate', defaultValue: 500, getValue: () => DELAY_AFTER_GATE_CLICKED, setValue: v => { DELAY_AFTER_GATE_CLICKED = v } },
                { key: 'DELAY_AFTER_ROOM_CLICKED', label: 'Extra delay after chosing a correct room', defaultValue: 0, getValue: () => DELAY_AFTER_ROOM_CLICKED, setValue: v => { DELAY_AFTER_ROOM_CLICKED = v } },
                { key: 'DELAY_AFTER_CLICKING_FLOOR_REWARD', label: 'Extra delay after clicking on ¨finish floor¨', defaultValue: 1000, getValue: () => DELAY_AFTER_CLICKING_FLOOR_REWARD, setValue: v => { DELAY_AFTER_CLICKING_FLOOR_REWARD = v } },
                { key: 'DELAY_AFTER_FINISHING_FLOOR', label: 'Extra delay after accepting floor reward', defaultValue: 1000, getValue: () => DELAY_AFTER_FINISHING_FLOOR, setValue: v => { DELAY_AFTER_FINISHING_FLOOR = v } }
            ]

            DELAY_SETTINGS.forEach(setting => {
                const input = document.createElement('input')
                input.type = 'number'
                input.step = '1'
                input.min = '0'
                input.value = setting.getValue()
                Object.assign(input.style, inputStyle)
                input.style.textAlign = 'center'
                input.style.width = '70px'
                setting.input = input

                const row = document.createElement('div')
                Object.assign(row.style, {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    marginBottom: '6px'
                })
                const label = document.createElement('span')
                label.textContent = setting.label
                label.title = setting.key
                Object.assign(label.style, {
                    flex: '1',
                    color: '#bcd6f5',
                    fontSize: '11px'
                })
                row.appendChild(label)
                row.appendChild(input)
                delaysPanel.appendChild(row)
            })

            const delaysButtonsRow = document.createElement('div')
            Object.assign(delaysButtonsRow.style, {
                display: 'flex',
                justifyContent: 'center',
                gap: '8px',
                marginTop: '10px'
            })

            const delaysSaveButton = document.createElement('button')
            delaysSaveButton.textContent = 'Save'
            Object.assign(delaysSaveButton.style, greenButtonStyle, {
                width: 'fit-content'
            })
            delaysSaveButton.onmouseenter = () => {
                delaysSaveButton.style.filter = 'brightness(1.12)'
            }
            delaysSaveButton.onmouseleave = () => {
                delaysSaveButton.style.filter = 'brightness(1)'
            }
            delaysSaveButton.addEventListener('click', (e) => {
                e.stopPropagation()
                DELAY_SETTINGS.forEach(setting => {
                    const value = parseInt(setting.input.value, 10) || 0
                    setting.setValue(value)
                    localStorage.setItem(setting.key, value)
                    setting.input.value = value
                })
            })
            delaysButtonsRow.appendChild(delaysSaveButton)

            const delaysResetButton = document.createElement('button')
            delaysResetButton.textContent = 'Reset to defaults'
            Object.assign(delaysResetButton.style, greenButtonStyle, {
                width: 'fit-content'
            })
            delaysResetButton.onmouseenter = () => {
                delaysResetButton.style.filter = 'brightness(1.12)'
            }
            delaysResetButton.onmouseleave = () => {
                delaysResetButton.style.filter = 'brightness(1)'
            }
            delaysResetButton.addEventListener('click', (e) => {
                e.stopPropagation()
                DELAY_SETTINGS.forEach(setting => {
                    setting.setValue(setting.defaultValue)
                    localStorage.setItem(setting.key, setting.defaultValue)
                    setting.input.value = setting.defaultValue
                })
            })
            delaysButtonsRow.appendChild(delaysResetButton)

            delaysPanel.appendChild(delaysButtonsRow)

            activateDailyPopupSection(dailyPopupSections[0])

            document.body.appendChild(dailyPopup)

            dailyButton.addEventListener('click', async (e) => {
                e.stopPropagation()
                if (isRunningMacro != null && isRunningMacro != MACRO_REPEAT_CLICK) {
                    await releaseWakeLock()
                    setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
                    isRunningMacro = null
                    return
                }

                if (isRecordingClicks || isRunningMacro == MACRO_REPEAT_CLICK) {
                    if (isRecordingClicks) {
                        stopRecordingClicks()
                    }
                    if (isRunningMacro == MACRO_REPEAT_CLICK) {
                        isRunningMacro = null
                        await releaseWakeLock()
                    }
                    setActivated(repeatClickButton, false, BUTTON_TEXT_STOP_REPEAT_CLICK, BUTTON_TEXT_RUN_REPEAT_CLICK)
                    setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
                    return
                }

                if (dailyPopup.style.display === 'none') {
                    const rect = dailyButton.getBoundingClientRect()
                    dailyPopup.style.left = `${rect.left}px`
                    dailyPopup.style.top = `${rect.bottom + 6}px`
                    dailyPopup.style.display = 'block'
                } else {
                    dailyPopup.style.display = 'none'
                }
            })
            document.addEventListener('click', (e) => {
                if (!dailyPopup.contains(e.target) && e.target !== dailyButton) {
                    dailyPopup.style.display = 'none'
                }
            })

            // ---------- logs button + popup ----------
            const logsButton = document.createElement('button')
            logsButton.id = 'logsButton'
            logsButton.textContent = '📋 Logs'
            
            Object.assign(logsButton.style, blueButtonStyle, { 
                marginLeft: '10px',
                marginRight: '10px',
            })
            logsButton.onmouseenter = () => {
                logsButton.style.filter = 'brightness(1.12)'
            }
            logsButton.onmouseleave = () => {
                logsButton.style.filter = 'brightness(1)'
            }

            const logsPopup = document.createElement('div')
            logsPopup.id = 'logsPopup'
            Object.assign(logsPopup.style, {
                position: 'fixed',
                display: 'none',
                zIndex: '9999999',
                minWidth: '400px',
                maxWidth: '600px',
                padding: '12px',
                border: '1px solid rgba(120,180,255,0.5)',
                borderRadius: '10px',
                background: 'linear-gradient(180deg, rgba(20,30,55,0.98) 0%, rgba(8,12,25,0.98) 100%)',
                boxShadow: '0 0 18px rgba(0,140,255,0.3)',
                color: '#d9ecff',
                fontSize: '14px',
                fontFamily: 'Trebuchet MS, Verdana, sans-serif',
                backdropFilter: 'blur(4px)'
            })

            const logsTitle = document.createElement('div')
            logsTitle.textContent = 'Recent errors'
            Object.assign(logsTitle.style, {
                fontWeight: 'bold',
                marginBottom: '8px',
                color: '#eef7ff',
                textAlign: 'center'
            })
            logsPopup.appendChild(logsTitle)

            const copyErrorsButton = document.createElement('button')
            copyErrorsButton.textContent = 'Copy 📋'
            Object.assign(copyErrorsButton.style, {
                width: 'fit-content',
                display: 'block',
                background: 'linear-gradient(180deg, #8bd0ff 0%, #2f7fc4 55%, #1a4f80 100%)',
                color: '#eef7ff',
                border: '1px solid #7ec8f2',
                borderRadius: '8px',
                padding: '4px 12px',
                fontWeight: 'bold',
                cursor: 'pointer',
                textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                boxShadow: '0 0 10px rgba(80,180,255,0.3), inset 0 1px 0 rgba(255,255,255,0.25)',
                transition: '0.15s ease',
                marginBottom: '8px',
                marginLeft: 'auto',
                marginRight: 'auto'
            })
            copyErrorsButton.onmouseenter = () => {
                copyErrorsButton.style.filter = 'brightness(1.12)'
            }
            copyErrorsButton.onmouseleave = () => {
                copyErrorsButton.style.filter = 'brightness(1)'
            }
            copyErrorsButton.addEventListener('click', (e) => {
                e.stopPropagation()
                const text = Array.from(errorContainerEl.querySelectorAll('div')).map(s => s.textContent).join('\n')
                navigator.clipboard.writeText(text)
            })
            logsPopup.appendChild(copyErrorsButton)

            const errorContainerEl = document.createElement('div')
            errorContainerEl.id = 'errorContainer'
            Object.assign(errorContainerEl.style, {
                color: 'white',
                fontSize: '12px',
                maxHeight: '500px',
                overflowY: 'auto',
                cursor: 'pointer'
            })
            errorContainerEl.title = 'Click to copy all errors to clipboard'
            errorContainerEl.addEventListener('click', () => {
                const text = Array.from(errorContainerEl.querySelectorAll('div')).map(s => s.textContent).join('\n')
                navigator.clipboard.writeText(text)
            })
            logsPopup.appendChild(errorContainerEl)

            if (PERSIST_LOGS) {
                try {
                    const savedLogs = JSON.parse(localStorage.getItem(PERSISTED_LOGS_KEY))
                    if (Array.isArray(savedLogs)) {
                        savedLogs.forEach(text => {
                            const span = document.createElement('div')
                            span.textContent = text
                            errorContainerEl.appendChild(span)
                        })
                        errorContainerEl.scrollTop = errorContainerEl.scrollHeight
                    }
                } catch {}
            }

            document.body.appendChild(logsPopup)

            logsButton.addEventListener('click', (e) => {
                e.stopPropagation()

                const text = Array.from(errorContainerEl.querySelectorAll('div')).map(s => s.textContent).join('\n')
                navigator.clipboard.writeText(text)

                if (logsPopup.style.display === 'none') {
                    const rect = logsButton.getBoundingClientRect()
                    logsPopup.style.left = `${rect.right - 400}px`
                    logsPopup.style.top = `${rect.bottom + 6}px`
                    logsPopup.style.display = 'block'
                } else {
                    logsPopup.style.display = 'none'
                }
            })
            document.addEventListener('click', (e) => {
                if (!logsPopup.contains(e.target) && e.target !== logsButton) {
                    logsPopup.style.display = 'none'
                }
            })

            if (WARDEN) {
                if (chrome && chrome.runtime) {
                    const iconUrl = chrome.runtime.getURL('icons/icon-48.png')
                    const img = document.createElement('img')
                    img.src = iconUrl
                    img.style.width = '26px'
                    img.style.height = '26px'
                    container.appendChild(img)
                }
            }

            container.appendChild(dailyButton)
            container.appendChild(macroTimeEl)
            container.appendChild(debugButton)
            container.appendChild(logsButton)

            const header = document.getElementById('header')
            header.insertBefore(container, header.children[1])

            setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
            setActivated(debugButton, DEBUG_CLICKS, BUTTON_TEXT_STOP_DEBUG, BUTTON_TEXT_RUN_DEBUG)
        }

        let lastPixel = [0,0,0]
        /// MACRO RUNNER
        async function runActions(actions, macro = MACRO_DUNGEON, maxRetries = MAX_RETRIES) {
            const target = gameCanvas
            target.focus()

            let skipUntilAction = null
            let skipActions = 0
            let prevClickAction = actions[0]
            for (const action of actions) {
                if (isRunningMacro != macro) return

                if (skipActions > 0) {
                    skipActions--
                    continue
                }

                const {
                    title = "",
                    actionType = actionClick
                } = action

                if (skipUntilAction) {
                    if (title == skipUntilAction) {
                        skipUntilAction = null
                    } else {
                        continue
                    }
                }

                if (actionType == actionTitle) {
                    lvlTitle = title
                    continue
                }

                if (title != "" && actionType != actionJumpIfScreen && actionType != actionJumpIfNotScreen && actionType != actionJump) {
                    document.title = lvlTitle + ": " + title
                    console.log(document.title)
                }

                if (actionType != actionDelay) {
                    addError("Running: " + JSON.stringify(action))
                }

                if (actionType == actionDelay) {
                    const { delay = 0 } = action
                    if (delay > 0) {
                        await sleep(delay, macro)
                    }
                } else if (actionType == actionInterruptIfColor || actionType == actionInterruptIfNotColor) {
                    const { xx = [], y = 0, color = [], threshold = COLORS_MATCH_THRESHOLD } = action
                    let isOk = true
                    let titanI = 0
                    let titanX = 0
                    let testPixel = []

                    for (let i = 0; i < xx.length; i++) {
                        ;[testPixel] = await readColorsAtCoords([
                            [gameArea.width * xx[i] * canvasScaleX, gameArea.height * y * canvasScaleY],
                        ])

                        if ((actionType == actionInterruptIfColor && colorsAreSame(testPixel, color, threshold)) || (actionType == actionInterruptIfNotColor && !colorsAreSame(testPixel, color, threshold))) {
                            isOk = false
                            titanI = i
                            titanX = xx[i]
                            addError("HP check failed for " + xx.length + " titans")
                            break
                        }
                    }

                    if (!isOk) {
                        await sleep(5000, macro)
                        isOk = true
                        for (let i = 0; i < xx.length; i++) {
                            ;[testPixel] = await readColorsAtCoords([
                                [gameArea.width * xx[i] * canvasScaleX, gameArea.height * y * canvasScaleY],
                            ])
                            if ((actionType == actionInterruptIfColor && colorsAreSame(testPixel, color, threshold)) || (actionType == actionInterruptIfNotColor && !colorsAreSame(testPixel, color, threshold))) {
                                isOk = false
                                titanI = i
                                titanX = xx[i]
                                addError("HP check failed for " + xx.length + " titans")
                                break
                            }
                        }
                    }

                    if (!isOk) {
                        const error = lvlTitle + ": " + (titanI + 1) + " titan's HP is tooo low [" + testPixel[0] + "," + testPixel[1] + "," + testPixel[2] + "] at (" + titanX + "," + y + ")"
                        document.title = error
                        addError(error)
                        if (isRunningMacro == macro) {
                            setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
                            isRunningMacro = null
                            await releaseWakeLock()

                            localStorage.setItem(LAST_MACRO_KEY, null)
                            showMacroErrorPopup(error)
                            await sendTelegramNotify(error)
                        }
                        return
                    }
                } else if (actionType == actionJump) {
                    const { jumpTitle = title } = action
                    skipUntilAction = jumpTitle
                    //addError("Jumping to: " + jumpTitle)
                } else if (actionType == actionJumpIfScreen) {
                    const { screen = [], threshold = COLORS_MATCH_THRESHOLD, jumpTitle = title } = action
                    const testPixels = await readColorsAtCoords(screen.map(p => [gameArea.width * p.x * canvasScaleX, gameArea.height * p.y * canvasScaleY]))

                    if (screen.every((p, i) => colorsAreSame(testPixels[i], p.color, threshold))) {
                        skipUntilAction = jumpTitle
                        addError("Detected: " + jumpTitle + " " + screen.map((p, i) => "[" + testPixels[i] + "] == [" + p.color + "]").join(", "))
                        //document.title = "Jump detected: " + jumpTitle
                    } else {
                        lastPixel = testPixels[0]
                    }
                } else if (actionType == actionJumpIfNotScreen) {
                    const { screen = [], threshold = COLORS_MATCH_THRESHOLD, jumpTitle = title } = action
                    const testPixels = await readColorsAtCoords(screen.map(p => [gameArea.width * p.x * canvasScaleX, gameArea.height * p.y * canvasScaleY]))
                    if (!screen.every((p, i) => colorsAreSame(testPixels[i], p.color, threshold))) {
                        skipUntilAction = jumpTitle
                        //document.title = "Jump detected: " + jumpTitle
                    }
                } else if (actionType == actionWaitForScreen) {
                    const { screen = [], delay = 0, threshold = COLORS_MATCH_THRESHOLD } = action
                    let retries = maxRetries
                    let maxDelay = delay
                    let testPixels = []
                    let allMatch = false
                    const describeMismatch = () => screen.map((p, i) => "[" + testPixels[i] + "] != [" + p.color + "]").join(", ")
                    do {
                        await sleep(100, macro)
                        maxDelay -= 100
                        if (isRunningMacro != macro) return
                        testPixels = await readColorsAtCoords(screen.map(p => [(gameArea.width * p.x) * canvasScaleX, (gameArea.height * p.y) * canvasScaleY]))
                        allMatch = screen.every((p, i) => colorsAreSame(testPixels[i], p.color, threshold))
                        if (maxDelay <= 0) {
                            if (maxRetries == 0) {
                                document.title = "failed " + lvlTitle + ": " + title
                                addError("failed waiting " + title + " " + describeMismatch())
                                break
                            }
                            // =========== didn't see the required color => try to click again and wait one more time ==========
                            if (retries > 0) {
                                document.title = "failed " + lvlTitle + ": " + title
                                // addError("popup detection: [" + lastPixel[0] + "," + lastPixel[1] + "," + lastPixel[2] + "]")
                                addError("re-clicking (retries:" + retries + ") " + title + " " + describeMismatch())
                                retries--
                                maxDelay = MAX_WAIT_BEFORE_RETRY
                                await runActions([prevClickAction], macro)
                            } else {
                                document.title = "skipped " + lvlTitle + ": " + title
                                addError("skipped waiting " + lvlTitle + ": " + title + " " + describeMismatch())
                                if (RELOAD_PAGE_ON_FAILURE) {
                                    reloadPage('превышено число попыток: ' + lvlTitle + ' / ' + title)
                                }
                                break
                            }
                        }
                    } while (!allMatch);
                } else if (actionType == actionChooseRoom) {
                    const { x = 0, y = 0, altX = 0 } = action
                    const [leftPixel, rightPixel] = await readColorsAtCoords([
                        [gameArea.width * x * canvasScaleX, gameArea.height * y * canvasScaleY],
                        [gameArea.width * altX * canvasScaleX, gameArea.height * y * canvasScaleY],
                    ])
                    let leftCategory = getColorCategory(leftPixel)
                    let rightCategory = getColorCategory(rightPixel)
                    
                    const priority = elementsOrder.map(x => x.id)
                    const chooseRight = priority.indexOf(rightCategory) <= priority.indexOf(leftCategory)
                    if (chooseRight) {
                        skipActions = 1
                    }
                    if (leftCategory != rightCategory) {
                        if (chooseRight) {
                            window.setActiveElements([rightCategory, leftCategory])
                        } else {
                            window.setActiveElements([leftCategory, rightCategory])
                        }
                    } else {
                        window.setActiveElements([])
                    }
                } else if (actionType == actionClick) {
                    const { x = 0, y = 0, delay = 0 } = action
                    prevClickAction = action
                    await runUnityInput(target, x, y)
                    if (delay > 0) {
                        await sleep(delay, macro)
                    }
                } else if (actionType == actionDragDrop) {
                    const { x = 0, y = 0, altX = 0, altY = 0, delay = 0 } = action
                    await runUnityDrag(target, x, y, altX, altY, 20, delay)
                }
            }
        }

        async function runUnityInput(canvas, x, y) {
            const cx = gameArea.left + x * gameArea.width
            const cy = gameArea.top + y * gameArea.height

            function fireMouse(type, buttons = 0) {
                const e = new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: cx,
                    clientY: cy,
                    button: 0,
                    buttons
                })
                canvas.dispatchEvent(e)
            }

            function fireTouch(type) {
                const touch = {
                    identifier: Date.now(),
                    target: canvas,
                    clientX: cx,
                    clientY: cy,
                    pageX: cx,
                    pageY: cy,
                    screenX: cx,
                    screenY: cy
                }
                const e = new Event(type, {
                    bubbles: true,
                    cancelable: true
                })
                if (type !== 'touchend') {
                    e.touches = [touch]
                    e.targetTouches = [touch]
                } else {
                    e.touches = []
                    e.targetTouches = []
                }
                e.changedTouches = [touch]
                canvas.dispatchEvent(e)
            }

            fireMouse('mousedown', 1)
            fireTouch('touchstart')
            await sleep(30)
            fireMouse('mouseup', 0)
            fireMouse('click', 0)
            fireTouch('touchend')
        }

        async function runUnityDrag(canvas, x, y, altX, altY, steps = 20, duration = 300) {
            const startX = gameArea.left + x * gameArea.width
            const startY = gameArea.top + y * gameArea.height
            const endX = gameArea.left + altX * gameArea.width
            const endY = gameArea.top + altY * gameArea.height
            const touchId = Date.now()

            function fireMouse(type, cx, cy, buttons = 0, button = 0) {
                canvas.dispatchEvent(new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: cx,
                    clientY: cy,
                    button: button,
                    buttons
                }))
            }

            function fireTouch(type, cx, cy) {
                const touch = {
                    identifier: touchId,
                    target: canvas,
                    clientX: cx,
                    clientY: cy,
                    pageX: cx,
                    pageY: cy,
                    screenX: cx,
                    screenY: cy
                }

                const e = new Event(type, {
                    bubbles: true,
                    cancelable: true
                })

                if (type !== 'touchend') {
                    e.touches = [touch]
                    e.targetTouches = [touch]
                } else {
                    e.touches = []
                    e.targetTouches = []
                }
                e.changedTouches = [touch]
                canvas.dispatchEvent(e)
            }

            fireMouse('mousedown', startX, startY, 1)
            fireTouch('touchstart', startX, startY)

            await sleep(16)
            for (let i = 1; i <= steps; i++) {
                const t = i / steps
                const cx = startX + (endX - startX) * t
                const cy = startY + (endY - startY) * t
                fireMouse('mousemove', cx, cy, 1, -1)
                fireTouch('touchmove', cx, cy)
                await sleep(duration / steps)
            }
            await sleep(700)
            fireMouse('mouseup', endX, endY, 0)
            fireTouch('touchend', endX, endY)
        }

        window.clicks = new Array()

        async function logMouse(e) {
            const gameX = e.clientX - gameArea.x
            const gameY = e.clientY - gameArea.y

            if (isRecordingClicks) {
                const x = Number((gameX / gameArea.width).toFixed(6))
                const y = Number((gameY / gameArea.height).toFixed(6))
                recordedClicks.push({ x, y, time: Date.now() })
                return
            }

            await sleep(1000)

            const [pixel] = await readColorsAtCoords([[gameX * canvasScaleX, gameY * canvasScaleY]])
            const r = pixel[0]
            const g = pixel[1]
            const b = pixel[2]
            const x = Number((gameX / gameArea.width).toFixed(6))
            const y = Number((gameY / gameArea.height).toFixed(6))
            const clickObj = {
                x: x,
                y: y,
                color: [r,g,b],
            }

            addError('{x: ' + clickObj.x + ', y: ' + clickObj.y + ', color: [' + clickObj.color.join(',') + ']}')
            //console.log(JSON.stringify(clickObj))
        }

        function buildRepeatClickActions(clicks, repeatDelay) {
            return clicks.map((click, i) => {
                const isLast = i === clicks.length - 1
                // delays between clicks are the recorded ones; the gap after the
                // last click (before repeating the sequence) uses the entered delay
                const delay = isLast ? repeatDelay : (clicks[i + 1].time - click.time)
                return { x: click.x, y: click.y, delay: delay, actionType: actionClick, title: "repeating click" }
            })
        }

        async function runRepeatClickMacro(clicks, repeats, delay) {
            if (isRunningMacro != null || clicks.length == 0) {
                return
            }
            isRunningMacro = MACRO_REPEAT_CLICK
            startMacroSession(false)
            setActivated(repeatClickButton, true, BUTTON_TEXT_STOP_REPEAT_CLICK, BUTTON_TEXT_RUN_REPEAT_CLICK)
            await enableWakeLock()

            const actions = buildRepeatClickActions(clicks, delay)

            for (let i = 0; i < repeats; i++) {
                if (isRunningMacro != MACRO_REPEAT_CLICK) break
                await runActions(actions, MACRO_REPEAT_CLICK)
            }

            if (isRunningMacro == MACRO_REPEAT_CLICK) {
                isRunningMacro = null
                await releaseWakeLock()
            }
            setActivated(repeatClickButton, false, BUTTON_TEXT_STOP_REPEAT_CLICK, BUTTON_TEXT_RUN_REPEAT_CLICK)
            setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
        }

        // ======== daily floor counter (feeds the Telegram progress notify) ========
        const DAILY_FLOOR_COUNT_KEY = 'daily_floor_count'
        const DAILY_FLOOR_DATE_KEY = 'daily_floor_date'
        const DAILY_FLOOR_START_TIME_KEY = 'daily_floor_start_time' // когда начался отсчёт текущих суток (мс)
        const DAILY_FLOOR_LAST_NOTIFY_TIME_KEY = 'daily_floor_last_notify_time' // когда было последнее уведомление о N этажах (мс)

        function getDailyGameDate() {
            const now = new Date()

            if (now.getHours() < 5) {
                now.setDate(now.getDate() - 1)
            }

            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        }

        function addDailyFloor() {
            const currentDay = getDailyGameDate()
            const savedDay = localStorage.getItem(DAILY_FLOOR_DATE_KEY)
            const dayChanged = savedDay !== currentDay
            // важно: ключи времени могли ни разу не создаться (например, если сутки
            // не менялись с момента добавления этой фичи) — тогда инициализируем их
            // отдельно, а не только при смене дня
            const timersMissing =
                !localStorage.getItem(DAILY_FLOOR_START_TIME_KEY) ||
                !localStorage.getItem(DAILY_FLOOR_LAST_NOTIFY_TIME_KEY)

            if (dayChanged) {
                localStorage.setItem(DAILY_FLOOR_DATE_KEY, currentDay)
                localStorage.setItem(DAILY_FLOOR_COUNT_KEY, '0')
            }

            if (dayChanged || timersMissing) {
                const now = String(Date.now())
                localStorage.setItem(DAILY_FLOOR_START_TIME_KEY, now)
                localStorage.setItem(DAILY_FLOOR_LAST_NOTIFY_TIME_KEY, now)
            }

            const count = Number(localStorage.getItem(DAILY_FLOOR_COUNT_KEY) || '0') + 1
            localStorage.setItem(DAILY_FLOOR_COUNT_KEY, String(count))

            return count
        }

        function formatTelegramDuration(ms) {
            const totalSeconds = Math.max(0, Math.round(ms / 1000))
            const hours = Math.floor(totalSeconds / 3600)
            const minutes = Math.floor((totalSeconds % 3600) / 60)
            const seconds = totalSeconds % 60

            const parts = []
            if (hours > 0) parts.push(`${hours}ч`)
            if (hours > 0 || minutes > 0) parts.push(`${minutes}м`)
            parts.push(`${seconds}с`)

            return parts.join(' ')
        }

        let fromHomePage = false
        // Dungeon MACRO
        async function runDungeonMacro(isResume = false) {
            if (isRunningMacro == MACRO_DUNGEON) {
                isRunningMacro = null
                setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
                await releaseWakeLock()
                await sendTelegramNotify(`⏹ Скрипт остановлен\nВремя: ${formatNowForTelegram()}`)
                return
            }
            localStorage.setItem(LAST_MACRO_KEY, MACRO_DUNGEON)

            setActivated(dailyButton, true, BUTTON_TEXT_STOP_MACRO + MACRO_DUNGEON, BUTTON_TEXT_RUN_CUSTOM)
            isRunningMacro = MACRO_DUNGEON
            startMacroSession(isResume)
            await enableWakeLock()

            // load settings
            const floors = MAX_FLOORS
            delayFactor = parseFloat(document.getElementById('delayFactor').value) || 1.0
            const hpLimit = parseInt(document.getElementById('stopHPLimit').value, 10) || 0
            localStorage.setItem("delayFactor", delayFactor)
            localStorage.setItem("maxFloors", floors)
            localStorage.setItem("stopHPLimit", hpLimit)

            // init coordinate system
            gameArea = gameCanvas.getBoundingClientRect()
            canvasScaleX = gameCanvas.width / gameArea.width
            canvasScaleY = gameCanvas.height / gameArea.height

            // utils
            function delay(msec) {
                return{x: 2, y: 2, delay: Math.round(msec * delayFactor), actionType: actionDelay}
            }
            function title(title) {
                return {actionType: actionTitle, title: title}
            }
            function getPointInRange(min, max, percent) {
                const t = percent / 100
                return min + (max - min) * t
            }


            // titans hp control points (for 5 and 4 titans)
            const titansHp5Points = [[0.316481, 0.368048], [0.39636, 0.446916], [0.4752275, 0.527806], [0.555106, 0.608696], [0.634985, 0.688574]]
            const titansHp4Points = [[0.354745, 0.406829], [0.434606, 0.48669], [0.514468, 0.565972], [0.59375, 0.645833]]
            let titansHP5 = [0,0,0,0,0]
            let titansHP4 = [0,0,0,0]
            if (hpLimit < 100) {
                for (let i = 0; i<5; i++) {
                    titansHP5[i] = getPointInRange(titansHp5Points[i][0], titansHp5Points[i][1], hpLimit)
                    if (i < 4) {
                        titansHP4[i] = getPointInRange(titansHp4Points[i][0], titansHp4Points[i][1], hpLimit)
                    }
                }
            }

            let delayAfterCheckHPTitle = "delay after checking titans HP"
            const delayAfterCheckHP = {actionType: actionDelay, delay: 0, title: delayAfterCheckHPTitle}
            const skipCheckHP = {actionType: actionJump, jumpTitle: delayAfterCheckHPTitle}
            let checkHP5 = skipCheckHP
            let checkHP4 = skipCheckHP
            const check5TitansHpTitle = "Check 5 titans HP"
            if (titansHP5[0] > 0) {
                checkHP5 = {xx: titansHP5, y: 0.461, color: [56,199,28], actionType: actionInterruptIfNotColor, title: check5TitansHpTitle, threshold: 20}
                checkHP4 = {xx: titansHP4, y: 0.461, color: [56,199,28], actionType: actionInterruptIfNotColor, title: "Check 4 titans HP", threshold: 20}
            }
            
            let checkIf5Titans = {screen: popupBattleResult5Titans, actionType: actionJumpIfScreen, title: "Check if there are 5 titans", threshold: 20, jumpTitle: check5TitansHpTitle}

            // ======= dungeon gates =======
            const waitForGateRight = {screen: screenRightGate, delay: DELAY_CHECK_CYCLE, actionType: actionWaitForScreen, title: "waiting for right gate scene", threshold: 15}
            const gateRight = {x: 0.691268, y: 0.5, delay: DELAY_AFTER_GATE_CLICKED, actionType: actionClick, title: "clicking on right gate"}

            const waitForGateMid = {screen: screenMidGate, delay: DELAY_CHECK_CYCLE, actionType: actionWaitForScreen, title: "waiting for mid gate scene", threshold: 15}
            const gateMid = {x: 0.500, y: 0.5, delay: DELAY_AFTER_GATE_CLICKED, actionType: actionClick, title: "clicking on mid gate"}

            const waitForGateLeft = {screen: screenLeftGate, delay: DELAY_CHECK_CYCLE, actionType: actionWaitForScreen, title: "waiting for left gate scene", threshold: 15}
            const gateLeft = {x: 0.312, y: 0.5, delay: DELAY_AFTER_GATE_CLICKED, actionType: actionClick, title: "clicking on left gate"}

            // ======= dungeon elemental rooms =======
            const roomSelectionTitle = "waiting for room selection popup"

            const waitFor1RoomSelection = {screen: popupOneRoomSelection, actionType: actionWaitForScreen, threshold: 20, delay: DELAY_CHECK_CYCLE, title: roomSelectionTitle}
            const waitFor2RoomSelection = {screen: popupTwoRoomsSelection, actionType: actionWaitForScreen, threshold: 20, delay: DELAY_CHECK_CYCLE, title: roomSelectionTitle}
            const roomMid = {x: 0.5, y: 0.795, delay: DELAY_AFTER_ROOM_CLICKED, actionType: actionClick, title: "clicking on mid room"}

            //  ======= usage: checkRoomColors, roomLeft, roomRight =======
            const checkRoomColors = {x: 0.31496881496881496, y: 0.6560364464692483, altX: 0.6891891891891891, delay: DELAY_CHECK_CYCLE, actionType: actionChooseRoom, title: "choosing a correct room"}
            const roomLeft = {x: 0.3076, y: 0.8, delay: DELAY_AFTER_ROOM_CLICKED, actionType: actionClick, title: "clicking on left room"}
            const roomRight = {x: 0.6833, y: 0.8, delay: DELAY_AFTER_ROOM_CLICKED, actionType: actionClick, title: "clicking on right room"}
            // ======= dungeon battlefield screen =======

            const waitForBattlefield = {screen: screenBattlefield, delay: DELAY_CHECK_CYCLE, actionType: actionWaitForScreen, title: "waiting for battlefield scene"}
            const autoBattle = {x: 0.87214, y: 0.758542, delay: DELAY_AFTER_CLICKING_AUTOBATTLE, actionType: actionClick, title: "clicking autobattle"}

            // ======= dungeon confirm auto-battle results screen =======
            const waitForConfirmBattle = {screen: popupBattleResult, delay: DELAY_CHECK_CYCLE, actionType: actionWaitForScreen, title: "waiting for battle result popup"}

            
            const confirmBattle = {x: 0.641372, y: 0.822323, delay: DELAY_FOR_TITANS_WALK, actionType: actionClick, title: "clicking on confirm battle result"}

            // ======= dungeon floor finished symbol =======
            const waitForFloor1Done = {screen: screenFloor1Final, delay: DELAY_CHECK_CYCLE, actionType: actionWaitForScreen, title: "waiting for floor1 final scene"}
            const floor1Done = {x: 0.7297, y: 0.47836, delay: DELAY_AFTER_CLICKING_FLOOR_REWARD, actionType: actionClick, title: "clicking on floor1 final symbol"}

            const waitForFloor2Done = {screen: screenFloor2Final, delay: DELAY_CHECK_CYCLE, actionType: actionWaitForScreen, title: "waiting for floor2 final scene"}
            const floor2Done = {x: 0.27755, y: 0.47836, delay: DELAY_AFTER_CLICKING_FLOOR_REWARD, actionType: actionClick, title: "clicking on floor2 final symbol"}


            // ======= dungeon floor finished popup ========
            const waitForFloorConfirm = {screen: popupFloorReward, delay: DELAY_CHECK_CYCLE, actionType: actionWaitForScreen, title: "waiting for floor confirmation popup"}
            const floorConfirm = {x: 0.635, y: 0.697, delay: DELAY_AFTER_FINISHING_FLOOR, actionType: actionClick, title: "clicking on floor confirmation popup"}


            // ======= speed up titan walk =========
            const fastRightGateTitle = "Fast right gate"
            let fastRightGateActions = [{x: 0.995370, y: 0.389100, actionType: actionClick, delay: 100}]
            for (let i=0; i<10; i++) {
                fastRightGateActions.push({screen: popupOneRoomSelection, actionType: actionJumpIfScreen, threshold: 20, title: fastRightGateTitle, jumpTitle: roomSelectionTitle})
                fastRightGateActions.push({screen: popupTwoRoomsSelection, actionType: actionJumpIfScreen, threshold: 20, title: fastRightGateTitle, jumpTitle: roomSelectionTitle})
                fastRightGateActions.push({x: 0.995370, y: 0.389100, actionType: actionClick, delay: 100})
            }

            const fastLeftGateTitle = "Fast left gate"
            let fastLeftGateActions = [{x: 0.005370, y: 0.389100, actionType: actionClick, delay: 50}]
            for (let i=0; i<10; i++) {
                fastLeftGateActions.push({screen: popupOneRoomSelection, actionType: actionJumpIfScreen, threshold: 20, title: fastLeftGateTitle, jumpTitle: roomSelectionTitle})
                fastLeftGateActions.push({screen: popupTwoRoomsSelection, actionType: actionJumpIfScreen, threshold: 20, title: fastLeftGateTitle, jumpTitle: roomSelectionTitle})
                fastLeftGateActions.push({x: 0.005370, y: 0.389100, actionType: actionClick, delay: 50})
            }

            // ======== screen detection for the first floor =========
            const jumpToRightGate = {screen: screenPastRightGate, delay: DELAY_CHECK_CYCLE, actionType: actionJumpIfScreen, title: gateRight.title}
            const jumpToMidGate = {screen: screenPastMidGate, delay: DELAY_CHECK_CYCLE, actionType: actionJumpIfScreen, title: gateMid.title}
            const jumpToLeftGate = {screen: screenPastLeftGate, delay: DELAY_CHECK_CYCLE, actionType: actionJumpIfScreen, title: gateLeft.title}
            const jumpToFloor1 = {screen: screenFloor1Final, delay: DELAY_CHECK_CYCLE, actionType: actionJumpIfScreen, title: floor1Done.title}
            const jumpToFloor2 = {screen: screenFloor2Final, delay: DELAY_CHECK_CYCLE, actionType: actionJumpIfScreen, title: floor2Done.title}


            if (fromHomePage) {
                fromHomePage = false

                // ========== initial game screen =============
                const waitForHomeTitle = "Waiting for home screen"
                const clickOnGuildTitle = "Click on guild"

                const checkHomePopup = {screen: screenHomePopup, actionType: actionJumpIfNotScreen, title: "Checking if there is a popup", jumpTitle: waitForHomeTitle}
                const closeHomePopup = {x: 0.971644, y: 0.054499, actionType: actionClick, title: "closing popup", delay: 1000}

                await runActions([
                    {screen: screenHomeScreen, actionType: actionJumpIfScreen, title: waitForHomeTitle, jumpTitle: clickOnGuildTitle},
                    checkHomePopup,
                    closeHomePopup,
                    checkHomePopup,
                    closeHomePopup,
                    {screen: screenHomeScreen, actionType: actionWaitForScreen, delay: 30000, title: waitForHomeTitle, threshold: 20},
                    {actionType: actionDelay, delay: 2000, title: clickOnGuildTitle}
                ], MACRO_DUNGEON, 0)

                await runActions([
                    {x: 0.594329, y: 0.908112, actionType: actionClick, title: clickOnGuildTitle},
                    {screen: screenGuildScreen, actionType: actionWaitForScreen, delay: DELAY_AFTER_CLICKING_GUILD, title: "Waiting for guild screen"},
                    delay(2000),
                    {x: 0.241220, y: 0.480769, actionType: actionClick, delay: DELAY_AFTER_CLICKING_DUNGEON, title: "click on dungeon"}
                ], MACRO_DUNGEON, 2)
            }

            const confirmBattleDelay = {actionType: actionDelay, delay: EXTRA_DELAY_BEFORE_CONFIRM_BATTLE, title: "Waiting for confirm battle"}
            const battleActions = [
                waitForBattlefield, autoBattle, waitForConfirmBattle, 
                checkIf5Titans, checkHP4, skipCheckHP, checkHP5, delayAfterCheckHP, 
                confirmBattleDelay, confirmBattle
            ]
            const initialFloorRooms = [checkRoomColors, roomLeft, roomRight, roomMid]

            await runActions([
                jumpToRightGate, jumpToMidGate, jumpToLeftGate, jumpToFloor1, jumpToFloor2,
                gateRight, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                jumpToMidGate, jumpToFloor2,
                gateMid, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                jumpToMidGate, jumpToRightGate, jumpToLeftGate,
                gateMid, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                jumpToMidGate, jumpToRightGate, jumpToLeftGate,
                gateMid, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                jumpToLeftGate, jumpToRightGate,
                gateLeft, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                jumpToFloor1, jumpToMidGate,
                floor1Done, waitForFloorConfirm, floorConfirm, delay(EXTRA_FLOOR_DELAY_FIRST_FLOOR),
                gateLeft, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                gateMid, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                jumpToMidGate, jumpToRightGate,
                gateMid, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                jumpToMidGate, jumpToRightGate,
                gateMid, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                gateRight, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                floor2Done, waitForFloorConfirm, floorConfirm,
            ], MACRO_DUNGEON)

            for (let i = 0; i < floors; i++) {
                if (isRunningMacro != MACRO_DUNGEON) break
                await runActions([
                    title("lvl1"), ...fastRightGateActions, waitForGateRight, gateRight, waitFor1RoomSelection, roomMid, ...battleActions,
                    title("lvl2"), ...fastRightGateActions, waitForGateMid, gateMid, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("lvl3"), ...fastRightGateActions, waitForGateMid, gateMid, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("lvl4"), ...fastRightGateActions, waitForGateMid, gateMid, waitFor1RoomSelection, roomMid, ...battleActions,
                    title("lvl5"), ...fastRightGateActions, waitForGateLeft, gateLeft, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("floor1"), waitForFloor1Done, floor1Done, waitForFloorConfirm, floorConfirm,
                    title("lvl6"), ...fastLeftGateActions, waitForGateLeft, gateLeft, waitFor1RoomSelection, roomMid, ...battleActions,
                    title("lvl7"), ...fastLeftGateActions, waitForGateMid, gateMid, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("lvl8"), ...fastLeftGateActions, waitForGateMid, gateMid, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("lvl9"), ...fastLeftGateActions, waitForGateMid, gateMid, waitFor1RoomSelection, roomMid, ...battleActions,
                    title("lvl0"), ...fastLeftGateActions, waitForGateRight, gateRight, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("floor2"), waitForFloor2Done, floor2Done, waitForFloorConfirm, floorConfirm,
                ], MACRO_DUNGEON)

                // за один проход итерации проходятся 2 этажа (floor1 и floor2)
                for (let f = 0; f < 2; f++) {
                    const floorCount = addDailyFloor()
                    if (floorCount % TELEGRAM_NOTIFY_EVERY_N_FLOORS === 0) {
                        const now = Date.now()
                        const startTime = Number(localStorage.getItem(DAILY_FLOOR_START_TIME_KEY) || now)
                        const lastNotifyTime = Number(localStorage.getItem(DAILY_FLOOR_LAST_NOTIFY_TIME_KEY) || startTime)

                        const batchDuration = formatTelegramDuration(now - lastNotifyTime)
                        const totalDuration = formatTelegramDuration(now - startTime)

                        localStorage.setItem(DAILY_FLOOR_LAST_NOTIFY_TIME_KEY, String(now))

                        await sendTelegramNotify(
                            `🏰 Пройдено ${TELEGRAM_NOTIFY_EVERY_N_FLOORS} этажей за ${batchDuration}\n` +
                            `Всего пройдено ${floorCount} этажей за ${totalDuration}`
                        )
                    }
                }
            }

            setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
            if (isRunningMacro == MACRO_DUNGEON) {
                isRunningMacro = null
                await releaseWakeLock()
            }
        }

        async function runFrontier(groups = [], attempts = 3, teams = 10, isResume = false) {
            if (isRunningMacro == MACRO_FRONTIER) {
                setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
                await releaseWakeLock()
                isRunningMacro = null
                return
            }
            localStorage.setItem(LAST_MACRO_KEY, MACRO_FRONTIER)
            setActivated(dailyButton, true, BUTTON_TEXT_STOP_MACRO + MACRO_FRONTIER, BUTTON_TEXT_RUN_CUSTOM)
            isRunningMacro = MACRO_FRONTIER
            startMacroSession(isResume)
            await enableWakeLock()

            gameCanvas.focus()
            gameArea = gameCanvas.getBoundingClientRect()
            canvasScaleX = gameCanvas.width / gameArea.width
            canvasScaleY = gameCanvas.height / gameArea.height

            const yTeam1 = 0.175539
            const yTeam5 = 0.858066
            const teamHeight = (yTeam5 - yTeam1)/4

            function delay(ms) {
                return {actionType: actionDelay, delay: ms}
            }
            function swapRandomTeams(tMin = 0, tMax = 3) {
                const t1 = Math.floor(Math.random() * (tMax - tMin + 1)) + tMin
                const t2 = Math.floor(Math.random() * (tMax - tMin + 1)) + tMin
                if (t1 == t2) {
                    return {actionType: actionDelay, delay: 200}
                }
                const y1 = yTeam1 + teamHeight * t1
                const y2 = yTeam1 + teamHeight * t2
                return {x: 0.135417, y: y1, altX: 0.135417, altY: y2, delay: 100, actionType: actionDragDrop, title: `swap ${t1+1} with ${t2+1}`}
            }
            function scrollDown(scrollTeams = 4) {
                const y = yTeam1 + teamHeight * scrollTeams

                return {x: 0.5, y: y, altX: 0.5, altY: yTeam1, delay: 100, actionType: actionDragDrop, title: "scroll +4 teams"}
            }
            const leaveFrontierLabel = "Leave Frontier"
            const waitForFrontier = {screen: screenFrontier, actionType: actionWaitForScreen, delay: 5000, title: "waiting for frontier"}
            const clickToBattle = {x: 0.909604, y: 0.888660, delay: 200, actionType: actionClick, title: "click to battle"}
            const waitForBattlePreparation = {screen: screenBattlePrep, actionType: actionWaitForScreen, delay: 5000, title: "waiting for battle prep."}
            const clickAutoBattle = {x: 0.893596, y: 0.760824, delay: 200, actionType: actionClick, title: "click auto battle"}
            const waitForLose = {screen: screenLose, actionType: actionWaitForScreen, delay: 60000, title: "waiting for lose"}
            const clickContinue = {x: 0.903013, y: 0.890721, delay: 200, actionType: actionClick, title: "click continue"}

            const clickReorderTeams = {x: 0.782407, y: 0.719899, actionType: actionClick, delay: 300, title: "click reorder teams"}
            const waitForReorderTeams = {screen: screenReorderTeams, actionType: actionWaitForScreen, delay: 2000, title: "waiting for reorder teams"}
            const clickCloseReorderTeams = {x: 0.971644, y: 0.052598, actionType: actionClick, delay: 300, title: "close reorder teams"}

            const battleLoop = [waitForBattlePreparation, delay(500), clickAutoBattle, waitForLose, delay(500), clickContinue, waitForFrontier, delay(500), clickToBattle]
            const clickFrontierTitle = "Click frontier"
            if (fromHomePage) {
                fromHomePage = false

                // ========== initial game screen =============
                const waitForHomeTitle = "Waiting for home screen"

                const checkHomePopup = {screen: screenHomePopup, actionType: actionJumpIfNotScreen, title: waitForHomeTitle}
                const closeHomePopup = {x: 0.971644, y: 0.054499, actionType: actionClick, title: "closing popup", delay: 1000}

                await runActions([
                    {screen: screenHomeScreen, actionType: actionJumpIfScreen, title: waitForHomeTitle, jumpTitle: clickFrontierTitle},
                    checkHomePopup,
                    closeHomePopup,
                    checkHomePopup,
                    closeHomePopup,
                    {screen: screenHomeScreen, actionType: actionWaitForScreen, delay: 30000, title: waitForHomeTitle},
                    delay(2000),
                ], MACRO_FRONTIER, 0)
            }

            await runActions([
                {actionType: actionTitle, title: "Frontier"},
                {x: 0.464120, y: 0.239544, actionType: actionClick, delay: 500, title: clickFrontierTitle},
                waitForFrontier, delay(500), clickToBattle
            ], MACRO_FRONTIER)

            for(let i=0; i<10000; i++) {
                if (isRunningMacro != MACRO_FRONTIER) break
                let actions = []
                for (let i=0; i<attempts; i++) {
                    actions.push(...battleLoop)
                }
                actions.push(clickReorderTeams)
                actions.push(waitForReorderTeams)

                let topIndex = 0
                let bottomIndex = topIndex + 4
                do {
                    bottomIndex = Math.min(topIndex + 4, teams - 1)
                    for(let g=0; g<groups.length; g++) {
                        const group = groups[g]
                        const gStart = group[0] - 1
                        const gEnd = group[1] - 1
                        let start = Math.max(topIndex, gStart)
                        let end = Math.min(bottomIndex, gEnd)
                        if (start < end) {
                            actions.push(swapRandomTeams(start - topIndex, end - topIndex))
                            addError(`swapRandomTeams(${start - topIndex}, ${end - topIndex})`)
                        }
                    }
                    const scrollOffset = Math.min(4, teams - 1 - bottomIndex)
                    if (scrollOffset > 0) {
                        actions.push(scrollDown(scrollOffset))
                        addError(`scrollDown(${scrollOffset})`)
                        topIndex += scrollOffset
                    }
                } while (bottomIndex < teams - 1);

                actions.push(clickCloseReorderTeams)

                await runActions(actions, MACRO_FRONTIER)
            }

            setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
            if (isRunningMacro == MACRO_FRONTIER) {
                await releaseWakeLock()
                isRunningMacro = null
            }
        }

        async function toggleDebug() {
            DEBUG_CLICKS = !DEBUG_CLICKS
            setActivated(debugButton, DEBUG_CLICKS, BUTTON_TEXT_STOP_DEBUG, BUTTON_TEXT_RUN_DEBUG)
            if (DEBUG_CLICKS) {
                gameCanvas.addEventListener('click', logMouse)
            } else {
                gameCanvas.removeEventListener('click', logMouse)
            }
        }

        async function runExpeditions() {
            const clickTitle = "click expedition"

            function clickAndStartExpAction(x, y) {
                return [
                    {x: x, y: y, delay: 0, actionType: actionClick, title: clickTitle},
                    {screen: screenExpeditionOpened, actionType: actionJumpIfNotScreen, title: clickTitle},
                    {x: 0.587384, y: 0.774398, delay: 500, actionType: actionClick, title: "click start"},
                    {x: 0.795718, y: 0.888466, delay: 500, actionType: actionClick, title: "click auto heroes"},
                    {x: 0.795718, y: 0.888466, delay: 500, actionType: actionClick, title: "click start with these hereos"},
                    {x: 0.826968, y: 0.095057, delay: 500, actionType: actionClick, title: "click close"}
                ]
            }

            const closeValkyrieTitle = "Close valkyrie"
            let actions = [
                {actionType: actionTitle, title: "Expeditions"},
                {x: 0.29456, y: 0.309252, delay: 1000, actionType: actionClick, title: "Navigate airship"},
                {x: 0.498264, y: 0.263625, delay: 1000, actionType: actionClick, title: "Click valkyrie"},
                {screen: screenValkyrieGift, delay: 100, actionType: actionJumpIfScreen, title: closeValkyrieTitle},
                {x: 0.502315, y: 0.745247, delay: 1000, actionType: actionClick, title: "Click valkyrie's gift"},
                {x: 0.969907, y: 0.060837, delay: 1000, actionType: actionClick, title: closeValkyrieTitle},
                {x: 0.501736, y: 0.667934, delay: 1000, actionType: actionClick, title: "Navigate expeditions"}
            ]
            for (let x = 0.9; x > 0; x -= 0.13) {
                for (let y = 0.81; y > 0.05; y -= 0.06) {
                    const act = clickAndStartExpAction(x, y)
                    actions.push(...act)
                }
            }

            const finishActions = [
                {x: 0.975694, y: 0.051965, actionType: actionClick, delay: 1000, title: clickTitle},
                {x: 0.969907, y: 0.060837, actionType: actionClick, delay: 1000, title: "Close airship"}
            ]

            actions.push(...finishActions)
            await runActions(actions, MACRO_DAILY)
        }

        async function runTower(macro = MACRO_DAILY) {
            const leaveTowerTitle = "Leave tower"
            let actions = [
                {actionType: actionTitle, title: "Tower"},
                {x: 0.683449, y: 0.309886, actionType: actionClick, delay: 1000, title: "Open tower"},
                {screen: screenTowerChestAvailable, actionType: actionJumpIfNotScreen, title: leaveTowerTitle, threshold: 20},
                {x: 0.638889, y: 0.731939, actionType: actionClick, delay: 1000, title: "Open 33 chests for 2k emeralds"},
                {screen: screenTowerRewardPopup, actionType: actionWaitForScreen, delay: 10000, threshold: 20},
                {x: 0.971065, y: 0.050063, actionType: actionClick, delay: 1000, title: leaveTowerTitle}
            ]
            await runActions(actions, macro, 0)
        }

        async function runHydra(macro = MACRO_DAILY) {
            let closeHydraTitle = "Close castle ruins"
            let actions = [
                {actionType: actionTitle, title: "Hydra"},
                {x: 0.333333, y: 0.908112, actionType: actionClick, delay: 2000, title: "Click guild"},
                {x: 0.553241, y: 0.240177, actionType: actionClick, delay: 2000, title: "Click elemental cradle"},
                {x: 0.771991, y: 0.366920, actionType: actionClick, delay: 2000, title: "Click castle ruins"},
                {x: 0.976273, y: 0.500000, actionType: actionClick, delay: 2000, title: "Scroll to fairies"},
                {screen: screenHydraNoMoreFairies, actionType: actionJumpIfScreen, title: closeHydraTitle},
                {x: 0.748843, y: 0.844740, actionType: actionClick, delay: 500, title: "Give horn to fairies"},
                {screen: screenHydraNoMoreFairies, actionType: actionJumpIfScreen, title: closeHydraTitle},
                {x: 0.748843, y: 0.844740, actionType: actionClick, delay: 500, title: "Give horn to fairies"},
                {screen: screenHydraNoMoreFairies, actionType: actionJumpIfScreen, title: closeHydraTitle},
                {x: 0.748843, y: 0.844740, actionType: actionClick, delay: 500, title: "Give horn to fairies"},
                {x: 0.970486, y: 0.061470, actionType: actionClick, delay: 1000, title: closeHydraTitle},
                {x: 0.970486, y: 0.061470, actionType: actionClick, delay: 1000, title: "Close elemental cradle"},
                {x: 0.970486, y: 0.061470, actionType: actionClick, delay: 1000, title: "Close guild"},

//                {"x":0.225694,"y":0.312421,"color":[255,62,41], title: "check if head has hp"},
  //              {"x":0.896991,"y":0.897972, title: "auto fight hydra"},
    //            {"x":0.501157,"y":0.892902, title: "confirm fight hydra"},
            ]
            await runActions(actions, macro)
        }

        async function runCamps(macro = MACRO_DAILY) {
            const titleLeaveRealm = "Leave realm"
            const titleAttackCamp = "Attack camp sword"
            const titleAttackCampBut = "Attack camp button"
            const titleStartBattle = "Start battle"
            const campActions = [
                {x: 0.877894, y: 0.753485, actionType: actionClick, delay: 1000, title: "Search icon"},
                {x: 0.768519, y: 0.207858, actionType: actionClick, delay: 1000, title: "Camps icon"},
                {x: 0.853588, y: 0.903676, actionType: actionClick, delay: 1000, title: "Search camp"},
                {screen: screenCampAttackButton, actionType: actionWaitForScreen, delay: 5000, title: "waiting for camp"},

                {screen: screenCampAttackButton, actionType: actionJumpIfNotScreen, title: titleAttackCampBut}, // check if there is white Attack button with swords
                {x: 0.657986, y: 0.490494, actionType: actionClick, delay: 1000, title: titleAttackCamp},
                {screen: screenCampBattleTransition, actionType: actionJumpIfNotScreen, title: titleStartBattle, treshold: 1},

                {screen: screenCampPopupAttackButton, actionType: actionJumpIfNotScreen, title: titleLeaveRealm}, // check if there is green Attack button in popup
                {x: 0.460648, y: 0.756654, actionType: actionClick, delay: 1000, title: titleAttackCamp},

                {x: 0.886574, y: 0.894804, actionType: actionClick, delay: 5000, title: titleStartBattle},
                {screen: screenCampBattleEnd, actionType: actionWaitForScreen, delay: 60000, title: "Waiting until battle ends...", threshold: 30},
                {actionType: actionDelay, delay: 500},
                {x: 0.914931, y: 0.893536, actionType: actionClick, delay: 5000, title: "confirm battle"}
            ]

            let actions = [
                {actionType: actionTitle, title: "Camps"},
                {x: 0.17419, y: 0.903676, delay: 3000, actionType: actionClick, title: "Navigate realm"}
            ]

            for (let i=0; i<10; i++) {
                actions.push(...campActions)
            }

            const leaveRealm = [
                {screen: screenCampSearchClosed, actionType: actionJumpIfNotScreen, title: titleLeaveRealm},
                {x: 0.969907, y: 0.051331, actionType: actionClick, delay: 2000, title: "close search"},
                {x: 0.046296, y: 0.897972, actionType: actionClick, delay: 2000, title: titleLeaveRealm}
            ]
            actions.push(...leaveRealm)

            await runActions(actions, macro, 0)
        }

        async function runHeroicChest(macro = MACRO_DAILY) {
            const gotoNextActionTitle = "collect next reward"
            const gotoNextChestTitle = "next chest"
            // heroic chests
            await runActions([
                {actionType: actionTitle, title: "Chest"},
                //{x: 0.523148, y: 0.797845, actionType: actionJumpIfNotScreen, color: [196,41,42], title: gotoNextActionTitle},
                {x: 0.480324, y: 0.711027, actionType: actionClick, delay: 1000, title: "Navigate heroic chest"},

                // chest for ad
                {x: 0.730000, y: 0.690000, actionType: actionClick, delay: 2000, title: "Open chest for AD"},
                {x: 0.730000, y: 0.690000, actionType: actionClick, delay: 2000, title: "Skip chest animation"},
                {screen: screenChestRewardPopup, actionType: actionJumpIfNotScreen, title: gotoNextChestTitle},
                {x: 0.968750, y: 0.054499, actionType: actionClick, delay: 1000, title: "Close chest"},

                {delay: 100, actionType: actionDelay, title: gotoNextChestTitle},
                {screen: screenFreeChestAvailable, actionType: actionJumpIfScreen, title: gotoNextChestTitle, threshold: 30}, // check if chest is free
                {x: 0.380000, y: 0.860000, actionType: actionClick, delay: 2000, title: "Open free chest"},
                {x: 0.730000, y: 0.690000, actionType: actionClick, delay: 2000, title: "Skip chest animation"},
                {screen: screenChestRewardPopup, actionType: actionJumpIfNotScreen, title: gotoNextChestTitle},
                {x: 0.968750, y: 0.054499, actionType: actionClick, delay: 1000, title: "Close chest"},

                {delay: 100, actionType: actionDelay, title: gotoNextChestTitle},
                {x: 0.968750, y: 0.054499, actionType: actionClick, delay: 2000, title: "Close heroic chests"},
                {delay: 100, actionType: actionDelay, title: gotoNextActionTitle}
            ], macro)
        }

        async function runRewards(macro = MACRO_DAILY) {
            await runActions([
                {actionType: actionTitle, title: "Rewards"},
                // collect free energy from shop
                {x: 0.939815, y: 0.053232, delay: 1000, actionType: actionClick, title: "navigate emeralds"},
                {x: 0.055, y: 0.10, delay: 500, actionType: actionClick, title: "click 1"},
                {x: 0.158565, y: 0.885932, delay: 500, actionType: actionClick, title: "gain 1"},
                {x: 0.055, y: 0.25, delay: 500, actionType: actionClick, title: "click 2"},
                {x: 0.153356, y: 0.878327, delay: 500, actionType: actionClick, title: "gain 2"},
                {x: 0.055, y: 0.40, delay: 500, actionType: actionClick, title: "click 3"},
                {x: 0.149884, y: 0.619772, delay: 500, actionType: actionClick, title: "gain 3"},
                {x: 0.055, y: 0.55, delay: 500, actionType: actionClick, title: "click 4"},
                {x: 0.917824, y: 0.233207, delay: 500, actionType: actionClick, title: "gain 4"},
                {x: 0.055, y: 0.7, delay: 500, actionType: actionClick, title: "click 5"},
                {x: 0.917824, y: 0.233207, delay: 500, actionType: actionClick, title: "gain 5"},
                {x: 0.055, y: 0.85, delay: 500, actionType: actionClick, title: "click 6"},
                {x: 0.971065, y: 0.04943, delay: 2000, actionType: actionClick, title: "close emeralds"},

                // daily rewards
                {x: 0.043403, y: 0.732573, actionType: actionClick, delay: 1000, title: "Open daily rewards"},
                {x: 0.939236, y: 0.882129, actionType: actionClick, delay: 200},
                {x: 0.939236, y: 0.882129, actionType: actionClick, delay: 200},
                {x: 0.939236, y: 0.882129, actionType: actionClick, delay: 200},
                {x: 0.939236, y: 0.882129, actionType: actionClick, delay: 200},
                {x: 0.939236, y: 0.882129, actionType: actionClick, delay: 200},
                {x: 0.939236, y: 0.882129, actionType: actionClick, delay: 200},
                {x: 0.971065, y: 0.048162, actionType: actionClick, delay: 2000, title: "close rewards"},

            ], macro)
        }

        async function runDailyTasks(params) {
            isRunningMacro = MACRO_DAILY
            startMacroSession(false)
            setActivated(dailyButton, true, BUTTON_TEXT_STOP_MACRO + MACRO_DAILY, BUTTON_TEXT_RUN_CUSTOM)

            if (isRunningMacro && params.heroic_chest) {
                await runHeroicChest(MACRO_DAILY)
            }

            if (isRunningMacro && params.expeditions) {
                await runExpeditions(MACRO_DAILY)
            }

            if (isRunningMacro && params.tower) {
                await runTower(MACRO_DAILY)
            }

            if (isRunningMacro && params.hydra) {
                await runHydra(MACRO_DAILY)
            }

            if (isRunningMacro && params.camps) {
                await runCamps(MACRO_DAILY)
            }

            if (isRunningMacro && params.rewards) {
                await runRewards(MACRO_DAILY)
            }

            setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
            if (isRunningMacro == MACRO_DAILY) {
                isRunningMacro = null
                await releaseWakeLock()

                if (params.dungeon) {
                    fromHomePage = true
                    await runDungeonMacro()
                }
            }
        }

        addNiceToolbar()

        await startTelegramControl()

        if (localStorage.getItem(LAST_MACRO_KEY) == MACRO_FRONTIER) {
            const groups = parseFrontierGroups(localStorage.getItem(FRONTIER_GROUPS_STORAGE_KEY)) || []
            fromHomePage = true
            await runFrontier(groups, Number(localStorage.getItem(FRONTIER_ATTEMPTS_STORAGE_KEY) || 3), Number(localStorage.getItem(FRONTIER_TEAMS_STORAGE_KEY) || 10), true)
        } else if (localStorage.getItem(LAST_MACRO_KEY) == MACRO_DUNGEON) {
            fromHomePage = true
            await runDungeonMacro(true)
        }
    }
})();
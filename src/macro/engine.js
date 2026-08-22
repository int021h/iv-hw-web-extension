// ==UserScript==
// @name         Dungeon runner
// @namespace    http://tampermonkey.net/
// @version      2026-08-22_19:57
// @description  try to take over the world!
// @author       You
// @match        https://www.hero-wars-alliance.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=hero-wars-alliance.com
// @grant        none
// ==/UserScript==

(() => {
    /// ======== OPTIONS ==========

    const GAME_LOAD_TIMEOUT = 10000; // Time required for the game to initialize

    const DELAY_CHECK_CYCLE = 5000 // check control pixel every 100msec until MAX_WAIT_BEFORE_RETRY
    const MAX_WAIT_BEFORE_RETRY = 5000 // max waiting time for a new screen to appear
    const MAX_RETRIES = 3 // after 3 retries if screen didn't appear => page will be reloaded and script restarts
    const RELOAD_PAGE_ON_FAILURE = true //

    //initial dungeon delays
    const MAX_FLOORS = 10000
    const DELAY_AFTER_CLICKING_GUILD = 5000
    const DELAY_AFTER_CLICKING_DUNGEON = 5000
    const EXTRA_GATE_DELAY_FIRST_FLOOR = 0
    const EXTRA_WALK_DELAY_FIRST_FLOOR = 2000
    const EXTRA_FLOOR_DELAY_FIRST_FLOOR = 3000

    const EXTRA_DELAY_BEFORE_CONFIRM_BATTLE = 0

    // dungeon delays
    const DELAY_FOR_TITANS_WALK = 500 // after battle results confirmed titans walk to another lvl
    const DELAY_AFTER_CLICKING_AUTOBATTLE = 500 // minimum duration of the battle
    const DELAY_AFTER_GATE_CLICKED = 500 // delay after clicking on lvl gate, before rooms selection popup appeared
    const DELAY_AFTER_ROOM_CLICKED = 0 // delay between choosing the room and opening the battlefield
    const DELAY_AFTER_CLICKING_FLOOR_REWARD = 1000 // click on shield at the end of the floor on lvl5 or lvl10
    const DELAY_AFTER_FINISHING_FLOOR = 4000 // click on accept gold for the floor, titans slowly walk to the next floor

    const COLORS_MATCH_THRESHOLD = 10
    let DEBUG_CLICKS = false

    const BUTTON_TEXT_RUN_DUNGEON = 'Run Dungeon'
    const BUTTON_TEXT_STOP_DUNGEON = 'Stop Dungeon'

    const BUTTON_TEXT_RUN_CUSTOM = 'Run...'
    const BUTTON_TEXT_STOP_CUSTOM = 'Stop...'

    const BUTTON_TEXT_RUN_DEBUG = '👀'
    const BUTTON_TEXT_STOP_DEBUG = '🚫'

    const BUTTON_TEXT_RUN_REPEAT_CLICK = 'Start recording'
    const BUTTON_TEXT_ARMED_REPEAT_CLICK = 'Recording...'
    const BUTTON_TEXT_STOP_REPEAT_CLICK = 'Stop repeating'
    const BUTTON_TEXT_STOP_RECORDING = 'Stop recording'

    const MACRO_DUNGEON = 'dungeon'
    const MACRO_DAILY = 'daily'
    const MACRO_FRONTIER = 'frontier'
    const MACRO_REPEAT_CLICK = 'repeat_click'

    const DEFAULT_ORDER = [
        { id: 'mixed', label: '⚡', color: '#FFC107', dColor: '#806104', bColor: '#806104' },
        { id: 'water', label: '💧', color: '#2196F3', dColor: '#104B7A', bColor: '#104B7A' },
        { id: 'earth', label: '🍀', color: '#4CAF50', dColor: '#265828', bColor: '#265828' },
        { id: 'fire', label: '🔥', color: '#F44336', dColor: '#7A211B', bColor: '#7A211B' },
    ]
    let elementsOrder = loadOrder()
            
    const WARDEN = false

    // service actions
    const actionTitle = 1
    const actionDelay = 2
    const actionJumpIf = 3
    const actionJumpIfNot = 4

    // clicker
    const actionClick = 10
    const actionDragDrop = 11

    // actions with some logic
    const actionChooseRoom = 21
    const actionWaitForColor = 22
    const actionWaitForColorNot = 23
    const actionInterruptIfColor = 24
    const actionInterruptIfNotColor = 25

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
                        location.reload();
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
        addError('Captured:' + JSON.stringify(call));
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
        span.textContent = "[" + time + "] " + msg

        container.appendChild(span)

        while (container.children.length > 10) {
            container.removeChild(container.firstChild)
        }

        container.scrollTop = container.scrollHeight
    }

    window.addEventListener('unhandledrejection', (e) => {
        const msg = String(e.reason);
        if (msg.includes('OOM') || msg.includes('memory access out of bounds') || msg.includes('Internal Server Error')) {
            location.reload();
        } else {
            addError(msg)
        }
    });

    const originalError = console.error;
    console.error = function (...args) {
        const msg = args.join(' ');
        if (msg.includes('OOM') || msg.includes('memory access out of bounds') || msg.includes('Internal Server Error')) {
            location.reload();
        } else {
            addError(msg)
        }
        return originalError.apply(console, args);
    };


    // ---------- storage ----------
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
    function getElementsPriority() {
        return elementsOrder.map(x => x.id)
    }

                
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

        let gameArea = gameCanvas.getBoundingClientRect()
        let canvasScaleX = gameCanvas.width / gameArea.width
        let canvasScaleY = gameCanvas.height / gameArea.height

        // MACRO stuff

        let isRunningMacro = null
        let lvlTitle = ""
        let delayFactor = restoreFloat("delayFactor", 1.0)

        // Pixel color picker
        const gl = gameCanvas.getContext('webgl2')
        let readPixelsOnce = 0
        let readX = 0
        let readY = 0
        const pixels = new Uint8Array(4)
        let pendingRead = null
        const originalRAF = window.requestAnimationFrame.bind(window)

        let isRecordingClicks = false
        let recordedClicks = []
        let recordingConfig = { repeats: 1000, delay: 300 }

        async function releaseWakeLock() {
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

        window.requestAnimationFrame = function(callback) {
            return originalRAF(function(time) {
                try {
                    callback(time)
                } finally {
                }

                const req = pendingRead
                if (!req) return
                pendingRead = null

                gl.readPixels(
                    req.x,
                    gl.canvas.height - req.y,
                    1,
                    1,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    pixels
                )

                req.resolve([
                    pixels[0],
                    pixels[1],
                    pixels[2],
                    pixels[3]
                ])
            })
        }

        function readPixelOnDraw(x, y) {
            return new Promise(resolve => {
                pendingRead = { x, y, resolve }
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
            if (active) {
                button.textContent = activeLabel
                button.style.background = 'linear-gradient(180deg, #ff8a7a 0%, #b3261e 55%, #5e0d0d 100%)'
                button.style.border = '1px solid #ffb0a8'
                button.style.boxShadow = '0 0 12px rgba(255,70,70,0.45), inset 0 1px 0 rgba(255,255,255,0.18)'
                button.style.color = '#fff0f0'
                button.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)'
            } else {
                button.textContent = inactiveLabel
                button.style.background = 'linear-gradient(180deg, #ffe08a 0%, #d08b18 55%, #8f5310 100%)'
                button.style.border = '1px solid #ffcf66'
                button.style.boxShadow = '0 0 10px rgba(255,180,50,0.35), inset 0 1px 0 rgba(255,255,255,0.25)'
                button.style.color = '#fff6d6'
                button.style.textShadow = '0 1px 2px rgba(0,0,0,0.7)'
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
            const hpLimit = restoreInt("stopHPLimit", 0)

            const container = document.createElement('span')
            container.style.display = 'inline-flex'
            container.style.alignItems = 'center'
            container.style.gap = '6px'
            container.style.padding = '4px 10px'
            container.style.marginLeft = '12px'
            container.style.border = '1px solid rgba(120,180,255,0.35)'
            container.style.borderRadius = '10px'
            container.style.background = 'linear-gradient(180deg, rgba(20,30,55,0.92) 0%, rgba(8,12,25,0.92) 100%)'
            container.style.boxShadow = '0 0 12px rgba(0,140,255,0.18)'
            container.style.color = '#d9ecff'
            container.style.fontSize = '14px'
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

            const button = document.createElement('button')
            button.id = 'dungeonMacroButton'
            button.textContent = BUTTON_TEXT_RUN_DUNGEON
            button.style.background = 'linear-gradient(180deg, #ffe08a 0%, #d08b18 55%, #8f5310 100%)'
            button.style.color = '#fff6d6'
            button.style.border = '1px solid #ffcf66'
            button.style.borderRadius = '8px'
            button.style.padding = '4px 12px'
            button.style.fontWeight = 'bold'
            button.style.cursor = 'pointer'
            button.style.textShadow = '0 1px 2px rgba(0,0,0,0.7)'
            button.style.boxShadow = '0 0 10px rgba(255,180,50,0.35), inset 0 1px 0 rgba(255,255,255,0.25)'
            button.style.transition = '0.15s ease'

            button.onmouseenter = () => {
                button.style.filter = 'brightness(1.12)'
            }
            button.onmouseleave = () => {
                button.style.filter = 'brightness(1)'
            }
            button.addEventListener('click', runDungeonMacro)

            const customButton = document.createElement('button')
            customButton.id = 'customMacroButton'
            customButton.textContent = '👀'
            customButton.style.background = 'linear-gradient(180deg, #ffe08a 0%, #d08b18 55%, #8f5310 100%)'
            customButton.style.color = '#fff6d6'
            customButton.style.border = '1px solid #ffcf66'
            customButton.style.borderRadius = '8px'
            customButton.style.padding = '4px 12px'
            customButton.style.fontWeight = 'bold'
            customButton.style.cursor = 'pointer'
            customButton.style.textShadow = '0 1px 2px rgba(0,0,0,0.7)'
            customButton.style.boxShadow = '0 0 10px rgba(255,180,50,0.35), inset 0 1px 0 rgba(255,255,255,0.25)'
            customButton.style.transition = '0.15s ease'

            customButton.onmouseenter = () => {
                customButton.style.filter = 'brightness(1.12)'
            }
            customButton.onmouseleave = () => {
                customButton.style.filter = 'brightness(1)'
            }
            customButton.addEventListener('click', toggleDebug)

            //// =========== ELEMENTS PRIORITY =========== ////
            const STORAGE_KEY = 'elements_priority'

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
                        background: `linear-gradient(to bottom, ${item.dColor}, ${item.color})`,
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
            setActiveElements = function(ids) {
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
            Object.assign(dailyButton.style, {
                background: 'linear-gradient(180deg, #ffe08a 0%, #d08b18 55%, #8f5310 100%)',
                color: '#fff6d6',
                border: '1px solid #ffcf66',
                borderRadius: '8px',
                padding: '4px 12px',
                fontWeight: 'bold',
                cursor: 'pointer',
                textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                boxShadow: '0 0 10px rgba(255,180,50,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
                transition: '0.15s ease'
            })

            dailyButton.onmouseenter = () => {
                dailyButton.style.filter = 'brightness(1.12)'
            }

            dailyButton.onmouseleave = () => {
                dailyButton.style.filter = 'brightness(1)'
            }

            // ---------- popup ----------

            const dailyPopup = document.createElement('div')
            dailyPopup.id = 'dailyPopup'
            Object.assign(dailyPopup.style, {
                position: 'fixed',
                display: 'none',
                zIndex: '9999999',
                minWidth: '400px',
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
            const dailyTitle = document.createElement('div')
            dailyTitle.textContent = 'Daily tasks'
            Object.assign(dailyTitle.style, {
                fontWeight: 'bold',
                marginBottom: '8px',
                color: '#eef7ff',
                textAlign: 'center'
            })
            dailyPopup.appendChild(dailyTitle)
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
                dailyPopup.appendChild(label)
            })
            const dailyStartButton = document.createElement('button')
            dailyStartButton.textContent = 'Start'
            Object.assign(dailyStartButton.style, {
                width: '100%',
                marginTop: '10px',
                background: 'linear-gradient(180deg, #8bd58b 0%, #3b9144 55%, #216128 100%)',
                color: '#efffec',
                border: '1px solid #7ee889',
                borderRadius: '8px',
                padding: '5px 12px',
                fontWeight: 'bold',
                cursor: 'pointer',
                textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                boxShadow: '0 0 10px rgba(80,220,100,0.3), inset 0 1px 0 rgba(255,255,255,0.25)',
                transition: '0.15s ease'
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
            dailyPopup.appendChild(dailyStartButton)

            // ---------- splitter ----------
            const repeatClickSplitter = document.createElement('hr')
            Object.assign(repeatClickSplitter.style, {
                margin: '10px 0',
                border: 'none',
                borderTop: '1px solid rgba(120,180,255,0.35)'
            })
            dailyPopup.appendChild(repeatClickSplitter)

            // ---------- repeat click ----------
            const repeatClickTitle = document.createElement('div')
            repeatClickTitle.textContent = 'Repeat clicks'
            Object.assign(repeatClickTitle.style, {
                fontWeight: 'bold',
                marginBottom: '8px',
                color: '#eef7ff',
                textAlign: 'center'
            })
            dailyPopup.appendChild(repeatClickTitle)

            const repeatClickRow = document.createElement('div')
            Object.assign(repeatClickRow.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
            })

            const repeatClickButton = document.createElement('button')
            repeatClickButton.id = 'repeatClickButton'
            repeatClickButton.textContent = BUTTON_TEXT_RUN_REPEAT_CLICK
            Object.assign(repeatClickButton.style, {
                flex: '1',
                background: 'linear-gradient(180deg, #ffe08a 0%, #d08b18 55%, #8f5310 100%)',
                color: '#fff6d6',
                border: '1px solid #ffcf66',
                borderRadius: '8px',
                padding: '5px 8px',
                fontWeight: 'bold',
                cursor: 'pointer',
                textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                boxShadow: '0 0 10px rgba(255,180,50,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
                transition: '0.15s ease'
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
                input.value = restoreInt(storageKey, defaultValue)
                Object.assign(input.style, {
                    width: '56px',
                    borderRadius: '6px',
                    border: '1px solid rgba(120,180,255,0.5)',
                    background: 'rgba(255,255,255,0.08)',
                    color: '#eef7ff',
                    padding: '4px 6px',
                    textAlign: 'center'
                })
                wrapper.appendChild(input)

                return { wrapper, input }
            }

            const repeatClickCount = makeRepeatClickInput('Repeats:', 'Number of times to repeat the recorded sequence', 1000, 'repeatClickCount')
            const repeatClickDelay = makeRepeatClickInput('Delay:', 'Delay between repeats (ms)', 300, 'repeatClickDelay')
            const repeatClickCountInput = repeatClickCount.input
            const repeatClickDelayInput = repeatClickDelay.input

            repeatClickRow.appendChild(repeatClickButton)
            repeatClickRow.appendChild(repeatClickCount.wrapper)
            repeatClickRow.appendChild(repeatClickDelay.wrapper)
            dailyPopup.appendChild(repeatClickRow)

            const repeatClickHint = document.createElement('div')
            repeatClickHint.innerHTML = 'Click "Start recording", then make the clicks in the game you want repeated.<br>Click "Stop recording" when done — the whole sequence replays N times,<br>with a D ms delay between repeats<br><i>ps: delays between the recorded clicks themselves are captured automatically</i>.'
            Object.assign(repeatClickHint.style, {
                marginTop: '6px',
                color: '#8fa8c4',
                fontSize: '11px',
                lineHeight: '1.4'
            })
            dailyPopup.appendChild(repeatClickHint)

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
                storeInt('repeatClickCount', repeats)
                storeInt('repeatClickDelay', delay)

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

            // ---------- splitter ----------
            const frontierSplitter = document.createElement('hr')
            Object.assign(frontierSplitter.style, {
                margin: '10px 0',
                border: 'none',
                borderTop: '1px solid rgba(120,180,255,0.35)'
            })
            dailyPopup.appendChild(frontierSplitter)

            // ---------- eternal frontier ----------
            const frontierTitle = document.createElement('div')
            frontierTitle.textContent = 'Eternal frontier'
            Object.assign(frontierTitle.style, {
                fontWeight: 'bold',
                marginBottom: '8px',
                color: '#eef7ff',
                textAlign: 'center'
            })
            dailyPopup.appendChild(frontierTitle)

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

            const frontierFieldStyle = {
                width: '100%',
                boxSizing: 'border-box',
                borderRadius: '6px',
                border: '1px solid rgba(120,180,255,0.5)',
                background: 'rgba(255,255,255,0.08)',
                color: '#eef7ff',
                padding: '4px 6px',
                transition: 'background-color 0.2s ease, border-color 0.2s ease'
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
            frontierAttemptsInput.value = restoreInt(FRONTIER_ATTEMPTS_STORAGE_KEY, 3)
            Object.assign(frontierAttemptsInput.style, frontierFieldStyle)
            frontierAttemptsWrapper.appendChild(frontierAttemptsInput)
            dailyPopup.appendChild(frontierAttemptsWrapper)

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
                width: '28px',
                height: '26px',
                flex: '0 0 auto',
                borderRadius: '6px',
                border: '1px solid rgba(120,180,255,0.5)',
                background: 'rgba(255,255,255,0.08)',
                color: '#eef7ff',
                cursor: 'pointer',
                fontWeight: 'bold'
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
            frontierTeamsInput.value = restoreInt(FRONTIER_TEAMS_STORAGE_KEY, 10)
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
            dailyPopup.appendChild(frontierTeamsWrapper)

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
            dailyPopup.appendChild(frontierGroupsWrapper)

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
            Object.assign(frontierStartButton.style, {
                width: '100%',
                background: 'linear-gradient(180deg, #8bd58b 0%, #3b9144 55%, #216128 100%)',
                color: '#efffec',
                border: '1px solid #7ee889',
                borderRadius: '8px',
                padding: '5px 12px',
                fontWeight: 'bold',
                cursor: 'pointer',
                textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                boxShadow: '0 0 10px rgba(80,220,100,0.3), inset 0 1px 0 rgba(255,255,255,0.25)',
                transition: '0.15s ease'
            })
            frontierStartButton.onmouseenter = () => {
                frontierStartButton.style.filter = 'brightness(1.12)'
            }
            frontierStartButton.onmouseleave = () => {
                frontierStartButton.style.filter = 'brightness(1)'
            }
            dailyPopup.appendChild(frontierStartButton)

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

                storeInt(FRONTIER_ATTEMPTS_STORAGE_KEY, attempts)
                storeInt(FRONTIER_TEAMS_STORAGE_KEY, teams)
                localStorage.setItem(FRONTIER_GROUPS_STORAGE_KEY, frontierInput.value)
                dailyPopup.style.display = 'none'
                runFrontier(pairs, attempts, teams)
            })

            document.body.appendChild(dailyPopup)

            dailyButton.addEventListener('click', async (e) => {
                e.stopPropagation()
                if (isRunningMacro == MACRO_DAILY || isRunningMacro == MACRO_FRONTIER) {
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
                    dailyPopup.style.left = `${rect.right - 400}px`
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
            logsButton.textContent = '📋'
            Object.assign(logsButton.style, {
                background: 'linear-gradient(180deg, #ffe08a 0%, #d08b18 55%, #8f5310 100%)',
                color: '#fff6d6',
                border: '1px solid #ffcf66',
                borderRadius: '8px',
                padding: '4px 12px',
                fontWeight: 'bold',
                cursor: 'pointer',
                textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                boxShadow: '0 0 10px rgba(255,180,50,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
                transition: '0.15s ease'
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
                width: '100%',
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
                marginBottom: '8px'
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

            container.appendChild(document.createTextNode('Priority:'))
            container.appendChild(elements)
            container.appendChild(document.createTextNode('Delays:'))
            container.appendChild(selectFactor)
            container.appendChild(document.createTextNode('Stop:'))
            container.appendChild(select)
            container.appendChild(button)
            container.appendChild(dailyButton)
            container.appendChild(customButton)
            container.appendChild(logsButton)

            const header = document.getElementById('header')
            header.insertBefore(container, header.children[1])

            setActivated(dungeonMacroButton, false, BUTTON_TEXT_STOP_DUNGEON, BUTTON_TEXT_RUN_DUNGEON)
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
                    x = 0,
                    y = 0,
                    xx = [],
                    color = [],
                    altX = 0,
                    altY = 0,
                    delay = 0,
                    title = "",
                    jumpTitle = title,
                    threshold = COLORS_MATCH_THRESHOLD,
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

                if (title != "" && actionType != actionJumpIf && actionType != actionJumpIfNot) {
                    document.title = lvlTitle + ": " + title
                    console.log(document.title)
                }

                if (actionType == actionDelay) {
                    if (delay > 0) {
                        await sleep(delay, macro)
                    }
                } else if (actionType == actionInterruptIfColor || actionType == actionInterruptIfNotColor) {
                    let isOk = true
                    let titanI = 0
                    let titanX = 0
                    let testPixel = []

                    for (let g=0; g<xx.length; g++) {
                        const hp = xx[g]
                        isOk = true
                        for (let i=0; i<hp.length; i++) {
                            let testPixel = []
                            testPixel = await readPixelOnDraw(
                                gameArea.width * hp[i] * canvasScaleX,
                                gameArea.height * y * canvasScaleY,
                            )

                            if ((actionType == actionInterruptIfColor && colorsAreSame(testPixel, color, threshold)) || (actionType == actionInterruptIfNotColor && !colorsAreSame(testPixel, color, threshold))) {
                                isOk = false
                                titanI = i
                                titanX = hp[i]
                                addError("HP check failed for " + hp.length + " titans")
                                break
                            }
                        }

                        if (isOk) {
                            break
                        }
                    }

                    if (!isOk) {
                        await sleep(5000, macro)
                        isOk = true
                        for (let g=0; g<xx.length; g++) {
                            const hp = xx[g]
                            isOk = true
                            for (let i=0; i<hp.length; i++) {
                                testPixel = await readPixelOnDraw(
                                    gameArea.width * hp[i] * canvasScaleX,
                                    gameArea.height * y * canvasScaleY,
                                )
                                if ((actionType == actionInterruptIfColor && colorsAreSame(testPixel, color, threshold)) || (actionType == actionInterruptIfNotColor && !colorsAreSame(testPixel, color, threshold))) {
                                    isOk = false
                                    titanI = i
                                    titanX = hp[i]
                                    addError("HP check failed for " + hp.length + " titans")
                                    break
                                }
                            }

                            if (isOk) {
                                break
                            }
                        }
                    }

                    if (!isOk) {
                        const error = lvlTitle + ": " + (titanI + 1) + " titan's HP is tooo low [" + testPixel[0] + "," + testPixel[1] + "," + testPixel[2] + "] at (" + titanX + "," + y + ")"
                        document.title = error
                        addError(error)
                        if (isRunningMacro == macro) {
                            setActivated(dungeonMacroButton, false, BUTTON_TEXT_STOP_DUNGEON, BUTTON_TEXT_RUN_DUNGEON)
                            isRunningMacro = null
                            await releaseWakeLock()

                            localStorage.setItem("last_macro", MACRO_FRONTIER)
                            location.reload()
                        }
                        return
                    }
                } else if (actionType == actionJumpIf) {
                    let testPixel = await readPixelOnDraw(
                        gameArea.width * x * canvasScaleX,
                        gameArea.height * y * canvasScaleY,
                    )

                    if (colorsAreSame(testPixel, color, threshold)) {
                        skipUntilAction = jumpTitle
                        addError("Detected: " + jumpTitle + " [" + testPixel[0] + ',' + testPixel[1] + ',' + testPixel[2] + '] == [' + color[0] + ',' + color[1] + ',' + color[2] + ']')
                        //document.title = "Jump detected: " + jumpTitle
                        //console.log("Room detected. Next action is:", title, " // ", testPixel[0], testPixel[1], testPixel[2], "!=", color[0], color[1], color[2])
                    } else {
                        lastPixel = testPixel
                    }
                } else if (actionType == actionJumpIfNot) {
                    let testPixel = await readPixelOnDraw(
                        gameArea.width * x * canvasScaleX,
                        gameArea.height * y * canvasScaleY,
                    )
                    if (!colorsAreSame(testPixel, color, threshold)) {
                        skipUntilAction = jumpTitle
                        //document.title = "Jump detected: " + jumpTitle
                        //console.log("Conditional jump. Next action is:", title, " // ", testPixel[0], testPixel[1], testPixel[2], "==", color[0], color[1], color[2])
                    }
                } else if (actionType == actionWaitForColorNot) {
                    let maxDelay = delay
                    let pixel = await readPixelOnDraw((gameArea.width * x) * canvasScaleX, (gameArea.height * y) * canvasScaleY)

                    do {
                        pixel = await readPixelOnDraw((gameArea.width * x) * canvasScaleX, (gameArea.height * y) * canvasScaleY)
                        if (!colorsAreSame(pixel, color, threshold)) {
                            break
                        }
                        await sleep(100, macro)
                        maxDelay -= 100
                        if (isRunningMacro != macro) return
                    } while (maxDelay > 0);

                    if (colorsAreSame(pixel, color, threshold)) {
                        document.title = "failed " + lvlTitle + ": " + title
                        addError("failed waiting " + title + " [" + pixel[0] + "," + pixel[1] +","+ pixel[2] + "] != [" + color[0] +","+ color[1]+","+ color[2] + "]")
                        location.reload()
                        break
                    }
                } else if (actionType == actionWaitForColor) {
                    let retries = maxRetries
                    let maxDelay = delay
                    let pixel = []
                    do {
                        await sleep(100, macro)
                        maxDelay -= 100
                        if (isRunningMacro != macro) return
                        pixel = await readPixelOnDraw((gameArea.width * x) * canvasScaleX, (gameArea.height * y) * canvasScaleY)
                        if (maxDelay <= 0) {
                            if (maxRetries == 0) {
                                document.title = "failed " + lvlTitle + ": " + title
                                addError("failed waiting " + title + " [" + pixel[0] + "," + pixel[1] +","+ pixel[2] + "] != [" + color[0] +","+ color[1]+","+ color[2] + "]")
                                break
                            }
                            // =========== didn't see the required color => try to click again and wait one more time ==========
                            if (retries > 0) {
                                document.title = "failed " + lvlTitle + ": " + title
                                addError("popup detection: [" + lastPixel[0] + "," + lastPixel[1] + "," + lastPixel[2] + "]")
                                addError("re-clicking (retries:" + retries + ") " + title + " [" + pixel[0] + "," + pixel[1] +","+ pixel[2] + "] != [" + color[0] +","+ color[1]+","+ color[2] + "]")
                                retries--
                                maxDelay = MAX_WAIT_BEFORE_RETRY
                                await runActions([prevClickAction], macro)
                            } else {
                                document.title = "skipped " + lvlTitle + ": " + title
                                addError("skipped waiting " + lvlTitle + ": " + title + " [" + pixel[0] + "," + pixel[1] +","+ pixel[2] + "] != [" + color[0] +","+ color[1]+","+ color[2] + "]")
                                if (RELOAD_PAGE_ON_FAILURE) {
                                    location.reload()
                                }
                                break
                            }
                        }
                    } while (!colorsAreSame(pixel, color, threshold));
                } else if (actionType == actionChooseRoom) {
                    let leftPixel = await readPixelOnDraw(gameArea.width * x * canvasScaleX,gameArea.height * y * canvasScaleY)
                    let leftCategory = getColorCategory(leftPixel)
                    
                    let rightPixel = await readPixelOnDraw(gameArea.width * altX * canvasScaleX,gameArea.height * y * canvasScaleY)
                    let rightCategory = getColorCategory(rightPixel)
                    
                    const priority = getElementsPriority()
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
                    prevClickAction = action
                    await runUnityInput(target, x, y)
                    if (delay > 0) {
                        await sleep(delay, macro)
                    }
                } else if (actionType == actionDragDrop) {
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

            const pixel = await readPixelOnDraw(gameX * canvasScaleX, gameY * canvasScaleY, 100)
            const r = pixel[0]
            const g = pixel[1]
            const b = pixel[2]
            const a = pixel[3]
            const x = Number((gameX / gameArea.width).toFixed(6))
            const y = Number((gameY / gameArea.height).toFixed(6))
            const clickObj = {
                x: x,
                y: y,
                color: [r,g,b],
            }

            addError(JSON.stringify(clickObj))
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

        function storeInt(key, value) {
            localStorage.setItem(key, value)
        }

        function storeFloat(key, value) {
            localStorage.setItem(key, value)
        }

        function restoreInt(key, defaultValue = 0) {
            return Number(localStorage.getItem(key) || defaultValue)
        }

        function restoreFloat(key, defaultValue = 0.0) {
            return Number(localStorage.getItem(key) || defaultValue)
        }

        let fromHomePage = false
        // Dungeon MACRO
        async function runDungeonMacro() {
            if (isRunningMacro == MACRO_DUNGEON) {
                isRunningMacro = null
                setActivated(dungeonMacroButton, false, BUTTON_TEXT_STOP_DUNGEON, BUTTON_TEXT_RUN_DUNGEON)
                await releaseWakeLock()
                return
            }
            localStorage.setItem("last_macro", MACRO_DUNGEON)
            setActivated(dungeonMacroButton, true, BUTTON_TEXT_STOP_DUNGEON, BUTTON_TEXT_RUN_DUNGEON)
            isRunningMacro = MACRO_DUNGEON
            await enableWakeLock()

            // load settings
            const floors = MAX_FLOORS
            delayFactor = parseFloat(document.getElementById('delayFactor').value) || 1.0
            const hpLimit = parseInt(document.getElementById('stopHPLimit').value, 10) || 0
            storeFloat("delayFactor", delayFactor)
            storeInt("maxFloors", floors)
            storeInt("stopHPLimit", hpLimit)

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


            const titansHp5Points = [[0.316481, 0.368048], [0.39636, 0.446916], [0.4752275, 0.527806], [0.555106, 0.608696], [0.634985, 0.688574]]
            const titansHp4Points = [[0.354745, 0.406829], [0.434606, 0.48669], [0.514468, 0.565972], [0.59375, 0.645833]]

            let titansHP = [[0,0,0,0,0], [0,0,0,0]]
            if (hpLimit < 100) {
                for (let i = 0; i<5; i++) {
                    titansHP[0][i] = getPointInRange(titansHp5Points[i][0], titansHp5Points[i][1], hpLimit)
                    if (i < 4) {
                        titansHP[1][i] = getPointInRange(titansHp4Points[i][0], titansHp4Points[i][1], hpLimit)
                    }
                }
            }

            // ======= dungeon gates =======
            const waitForGateRight = {x :0.6703741152679474, y:0.11393805309734513, color: [29,37,83], delay: DELAY_CHECK_CYCLE, actionType: actionWaitForColor, title: "waiting for right gate scene"}
            const gateRight = {x: 0.691268, y: 0.5, delay: DELAY_AFTER_GATE_CLICKED, actionType: actionClick, title: "clicking on right gate"}

            const waitForGateMid = {x: 0.4752275025278059, y: 0.11172566371681415, color: [28,36,81], delay: DELAY_CHECK_CYCLE, actionType: actionWaitForColor, title: "waiting for mid gate scene"}
            const gateMid = {x: 0.500, y: 0.5, delay: DELAY_AFTER_GATE_CLICKED, actionType: actionClick, title: "clicking on mid gate"}

            const waitForGateLeft = {x: 0.2901921132457027, y: 0.11172566371681415, color: [28,36,81], delay: DELAY_CHECK_CYCLE, actionType: actionWaitForColor, title: "waiting for left gate scene"}
            const gateLeft = {x: 0.312, y: 0.5, delay: DELAY_AFTER_GATE_CLICKED, actionType: actionClick, title: "clicking on left gate"}

            // ======= dungeon elemental rooms =======
            const roomSelectionTitle = "waiting for room selection popup"
            const waitFor1RoomSelection = {x: 0.69969666, y: 0.8506637, actionType: actionWaitForColor, color: [17,12,6], delay: DELAY_CHECK_CYCLE, title: roomSelectionTitle}
            const waitFor2RoomSelection = {x: 0.5, y: 0.5, color: [19,17,7], delay: DELAY_CHECK_CYCLE, actionType: actionWaitForColor, title: roomSelectionTitle}
            const roomMid = {x: 0.5, y: 0.795, delay: DELAY_AFTER_ROOM_CLICKED, actionType: actionClick, title: "clicking on mid room"}

            //  ======= usage: checkRoomColors, roomLeft, roomRight =======
            const checkRoomColors = {x: 0.31496881496881496, y: 0.6560364464692483, altX: 0.6891891891891891, delay: DELAY_CHECK_CYCLE, actionType: actionChooseRoom, title: "choosing a correct room"}
            const roomLeft = {x: 0.3076, y: 0.8, delay: DELAY_AFTER_ROOM_CLICKED, actionType: actionClick, title: "clicking on left room"}
            const roomRight = {x: 0.6833, y: 0.8, delay: DELAY_AFTER_ROOM_CLICKED, actionType: actionClick, title: "clicking on right room"}
            // ======= dungeon battlefield screen =======

            const waitForBattlefield = {x: 0.014553, y: 0.952164, color: [34,46,64], delay: DELAY_CHECK_CYCLE, actionType: actionWaitForColor, title: "waiting for battlefield scene"}
            const autoBattle = {x: 0.87214, y: 0.758542, delay: DELAY_AFTER_CLICKING_AUTOBATTLE, actionType: actionClick, title: "clicking autobattle"}

            // ======= dungeon confirm auto-battle results screen =======
            const waitForConfirmBattle = {x: 0.60083, y: 0.127563, color: [137,1,0], delay: DELAY_CHECK_CYCLE, actionType: actionWaitForColor, title: "waiting for battle result popup"}

            let checkHP = delay(1)
            if (titansHP[0][0] > 0) {
                checkHP = {x: 0, xx: titansHP, y: 0.461, color: [56,199,28], actionType: actionInterruptIfNotColor, title: "Check titans HP", threshold: 20}
            }

            const confirmBattle = {x: 0.641372, y: 0.822323, delay: 0, actionType: actionClick, title: "clicking on confirm battle result"}

            // ======= dungeon floor finished symbol =======
            const waitForFloor1Done = {x: 0.3163664839467502, y: 0.1320754716981132, color: [18,21,26], delay: DELAY_CHECK_CYCLE, actionType: actionWaitForColor, title: "waiting for floor1 final scene"}
            const floor1Done = {x: 0.7297, y: 0.47836, delay: DELAY_AFTER_CLICKING_FLOOR_REWARD, actionType: actionClick, title: "clicking on floor1 final symbol"}

            const waitForFloor2Done = {x: 0.6985121378230227, y: 0.14408233276157806, color: [20,22,28], delay: DELAY_CHECK_CYCLE, actionType: actionWaitForColor, title: "waiting for floor2 final scene"}
            const floor2Done = {x: 0.27755, y: 0.47836, delay: DELAY_AFTER_CLICKING_FLOOR_REWARD, actionType: actionClick, title: "clicking on floor2 final symbol"}


            // ======= dungeon floor finished popup ========
            const waitForFloorConfirm = {x: 0.5, y: 0.5, color: [22,12,8], delay: DELAY_CHECK_CYCLE, actionType: actionWaitForColor, title: "waiting for floor confirmation popup"}
            const floorConfirm = {x: 0.635, y: 0.697, delay: 0, actionType: actionClick, title: "clicking on floor confirmation popup"}


            // ======= speed up titan walk =========
            const fastRightGateTitle = "Fast right gate"
            let fastRightGateActions = [{x: 0.995370, y: 0.389100, actionType: actionClick, delay: 50}]
            for (let i=0; i<10; i++) {
                fastRightGateActions.push({x: 0.502315, y: 0.126743, actionType: actionJumpIf, color: [20,17,4], threshold: 15, title: fastRightGateTitle, jumpTitle: roomSelectionTitle})
                fastRightGateActions.push({x: 0.995370, y: 0.389100, actionType: actionClick, delay: 50})
            }

            const fast6thGateTitle = "Fast 6th gate"
            let fast6thGateActions = [{x: 0.005370, y: 0.609100, actionType: actionClick, delay: 50}]
            for (let i=0; i<10; i++) {
                fast6thGateActions.push({x: 0.502315, y: 0.126743, actionType: actionJumpIf, color: [20,17,4], threshold: 15, title: fast6thGateTitle, jumpTitle: roomSelectionTitle})
                fast6thGateActions.push({x: 0.005370, y: 0.609100, actionType: actionClick, delay: 50})
            }

            const fastLeftGateTitle = "Fast left gate"
            let fastLeftGateActions = [{x: 0.005370, y: 0.389100, actionType: actionClick, delay: 50}]
            for (let i=0; i<10; i++) {
                fastLeftGateActions.push({x: 0.502315, y: 0.126743, actionType: actionJumpIf, color: [20,17,4], threshold: 15, title: fastLeftGateTitle, jumpTitle: roomSelectionTitle})
                fastLeftGateActions.push({x: 0.005370, y: 0.389100, actionType: actionClick, delay: 50})
            }

            const fast1stGateTitle = "Fast 1st gate"
            let fast1stGateActions = [{x: 0.995370, y: 0.600000, actionType: actionClick, delay: 50}]
            for (let i=0; i<10; i++) {
                fast1stGateActions.push({x: 0.502315, y: 0.126743, actionType: actionJumpIf, color: [20,17,4], threshold: 15, title: fast1stGateTitle, jumpTitle: roomSelectionTitle})
                fast1stGateActions.push({x: 0.995370, y: 0.600000, actionType: actionClick, delay: 50})
            }


            // ======== screen detection for the first floor =========
            const jumpToRightGate = {x :0.6703741152679474, y:0.11393805309734513, color: [29,37,83], delay: DELAY_CHECK_CYCLE, actionType: actionJumpIf, title: gateRight.title}
            const jumpToMidGate = {x: 0.4752275025278059, y: 0.11172566371681415, color: [28,36,81], delay: DELAY_CHECK_CYCLE, actionType: actionJumpIf, title: gateMid.title}
            const jumpToLeftGate = {x: 0.2901921132457027, y: 0.11172566371681415, color: [28,36,81], delay: DELAY_CHECK_CYCLE, actionType: actionJumpIf, title: gateLeft.title}
            const jumpToFloor1 = {x: 0.3163664839467502, y: 0.1320754716981132, color: [18,21,26], delay: DELAY_CHECK_CYCLE, actionType: actionJumpIf, title: floor1Done.title}
            const jumpToFloor2 = {x: 0.6985121378230227, y: 0.14408233276157806, color: [20,22,28], delay: DELAY_CHECK_CYCLE, actionType: actionJumpIf, title: floor2Done.title}


            if (fromHomePage) {
                fromHomePage = false

                // ========== initial game screen =============
                const waitForHomeTitle = "Waiting for home screen"
                const clickOnGuildTitle = "Click on guild"

                const checkHomePopup = {x: 0.971644, y: 0.054499, actionType: actionJumpIfNot, color: [245,209,117], title: waitForHomeTitle}
                const closeHomePopup = {x: 0.971644, y: 0.054499, actionType: actionClick, title: "closing popup", delay: 1000}

                await runActions([
                    {x: 0.334182, y: 0.907063, actionType: actionWaitForColor, color: [235,236,198], delay: 30000, title: waitForHomeTitle},
                    {x: 0.334182, y: 0.907063, actionType: actionJumpIf, color: [235,236,198], delay: 5000, title: waitForHomeTitle, jumpTitle: clickOnGuildTitle},
                    checkHomePopup,
                    closeHomePopup,
                    checkHomePopup,
                    closeHomePopup,
                    {x: 0.334182, y: 0.907063, actionType: actionWaitForColor, color: [235,236,198], delay: 30000, title: waitForHomeTitle},
                    {actionType: actionDelay, delay: 2000, title: clickOnGuildTitle}
                ], MACRO_DUNGEON, 0)

                await runActions([
                    {x: 0.332755, y: 0.910013, actionType: actionClick, title: clickOnGuildTitle},
                    {x: 0.273832, y: 0.612474, actionType: actionWaitForColor, color:[72,39,0], delay: DELAY_AFTER_CLICKING_GUILD, title: "Waiting for guild screen"},
                    delay(2000),
                    {x: 0.241220, y: 0.480769, actionType: actionClick, delay: DELAY_AFTER_CLICKING_DUNGEON, title: "click on dungeon"}
                ], MACRO_DUNGEON, 2)
            }

            const confirmBattleDelay = {actionType: actionDelay, delay: EXTRA_DELAY_BEFORE_CONFIRM_BATTLE, title: "Waiting for confirm battle"}
            const battleActions = [waitForBattlefield, autoBattle, waitForConfirmBattle, checkHP, confirmBattleDelay, confirmBattle, delay(DELAY_FOR_TITANS_WALK)]
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
                floor1Done, waitForFloorConfirm, floorConfirm, delay(DELAY_AFTER_FINISHING_FLOOR), delay(EXTRA_FLOOR_DELAY_FIRST_FLOOR),
                gateLeft, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                gateMid, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                jumpToMidGate, jumpToRightGate,
                gateMid, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                jumpToMidGate, jumpToRightGate,
                gateMid, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                gateRight, delay(EXTRA_GATE_DELAY_FIRST_FLOOR), ...initialFloorRooms, ...battleActions, delay(EXTRA_WALK_DELAY_FIRST_FLOOR),
                floor2Done, waitForFloorConfirm, floorConfirm, delay(500),
            ], MACRO_DUNGEON)

            for (let i = 0; i < floors; i++) {
                if (isRunningMacro != MACRO_DUNGEON) break
                await runActions([
                    title("lvl1"), ...fast1stGateActions, waitForGateRight, gateRight, waitFor1RoomSelection, roomMid, ...battleActions,
                    title("lvl2"), ...fastRightGateActions, waitForGateMid, gateMid, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("lvl3"), ...fastRightGateActions, waitForGateMid, gateMid, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("lvl4"), ...fastRightGateActions, waitForGateMid, gateMid, waitFor1RoomSelection, roomMid, ...battleActions,
                    title("lvl5"), ...fastRightGateActions, waitForGateLeft, gateLeft, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("floor1"), waitForFloor1Done, floor1Done, waitForFloorConfirm, floorConfirm, delay(500),
                    title("lvl6"), ...fast6thGateActions, waitForGateLeft, gateLeft, waitFor1RoomSelection, roomMid, ...battleActions,
                    title("lvl7"), ...fastLeftGateActions, waitForGateMid, gateMid, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("lvl8"), ...fastLeftGateActions, waitForGateMid, gateMid, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("lvl9"), ...fastLeftGateActions, waitForGateMid, gateMid, waitFor1RoomSelection, roomMid, ...battleActions,
                    title("lvl0"), ...fastLeftGateActions, waitForGateRight, gateRight, waitFor2RoomSelection, checkRoomColors, roomLeft, roomRight, ...battleActions,
                    title("floor2"), waitForFloor2Done, floor2Done, waitForFloorConfirm, floorConfirm, delay(500),
                ], MACRO_DUNGEON)
            }

            setActivated(dungeonMacroButton, false, BUTTON_TEXT_STOP_DUNGEON, BUTTON_TEXT_RUN_DUNGEON)
            if (isRunningMacro == MACRO_DUNGEON) {
                isRunningMacro = null
                await releaseWakeLock()
            }
        }

        async function runFrontier(groups = [], attempts = 3, teams = 10) {
            if (isRunningMacro == MACRO_FRONTIER) {
                setActivated(dailyButton, false, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
                await releaseWakeLock()
                isRunningMacro = null
                return
            }
            localStorage.setItem("last_macro", MACRO_FRONTIER)
            setActivated(dailyButton, true, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)
            isRunningMacro = MACRO_FRONTIER
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
            const waitForFrontier = {x: 0.049190, y: 0.434094, actionType: actionWaitForColor, color: [237,209,158], delay: 5000, title: "waiting for frontier"}
            const clickToBattle = {x: 0.909604, y: 0.888660, delay: 200, actionType: actionClick, title: "click to battle"}
            const waitForBattlePreparation = {x: 0.841435, y: 0.766195, actionType: actionWaitForColor, color: [65,158,28], delay: 5000, title: "waiting for battle prep."}
            const clickAutoBattle = {x: 0.893596, y: 0.760824, delay: 200, actionType: actionClick, title: "click auto battle"}
            const waitForLose = {x: 0.497106, y: 0.251584, actionType: actionWaitForColor, color: [180,14,36], delay: 60000, title: "waiting for lose"}
            const clickContinue = {x: 0.903013, y: 0.890721, delay: 200, actionType: actionClick, title: "click continue"}

            const clickReorderTeams = {x: 0.782407, y: 0.719899, actionType: actionClick, delay: 300, title: "click reorder teams"}
            const waitForReorderTeams = {x: 0.499421, y: 0.004436, actionType: actionWaitForColor, color: [3,6,9], delay: 2000, title: "waiting for reorder teams"}
            const clickCloseReorderTeams = {x: 0.971644, y: 0.052598, actionType: actionClick, delay: 300, title: "close reorder teams"}

            const battleLoop = [waitForBattlePreparation, delay(500), clickAutoBattle, waitForLose, delay(500), clickContinue, waitForFrontier, delay(500), clickToBattle]

            if (fromHomePage) {
                fromHomePage = false

                // ========== initial game screen =============
                const waitForHomeTitle = "Waiting for home screen"
                const clickOnGuildTitle = "Click on guild"

                const checkHomePopup = {x: 0.971644, y: 0.054499, actionType: actionJumpIfNot, color: [245,209,117], title: waitForHomeTitle}
                const closeHomePopup = {x: 0.971644, y: 0.054499, actionType: actionClick, title: "closing popup", delay: 1000}

                await runActions([
                    {x: 0.334182, y: 0.907063, actionType: actionWaitForColor, color: [235,236,198], delay: 30000, title: waitForHomeTitle},
                    {x: 0.334182, y: 0.907063, actionType: actionJumpIf, color: [235,236,198], delay: 5000, title: waitForHomeTitle, jumpTitle: clickOnGuildTitle},
                    checkHomePopup,
                    closeHomePopup,
                    checkHomePopup,
                    closeHomePopup,
                    {x: 0.334182, y: 0.907063, actionType: actionWaitForColor, color: [235,236,198], delay: 30000, title: waitForHomeTitle},
                    delay(2000),
                ], MACRO_DUNGEON, 0)
            }

            await runActions([
                {actionType: actionTitle, title: "Frontier"},
                {x: 0.464120, y: 0.239544, actionType: actionClick, delay: 500, title: "Click frontier"},
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
            setActivated(customMacroButton, DEBUG_CLICKS, BUTTON_TEXT_STOP_DEBUG, BUTTON_TEXT_RUN_DEBUG)
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
                    {x: 0.721644, y: 0.143219, color:[24,12,8], actionType: actionJumpIfNot, title: clickTitle},
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
                {x: 0.659722, y: 0.903676, delay: 100, color: [73,158,22], actionType: actionJumpIf, title: closeValkyrieTitle},
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
                {x: 0.638889, y: 0.731939, actionType: actionJumpIfNot, color: [69, 166, 31], title: leaveTowerTitle, threshold: 20},
                {x: 0.638889, y: 0.731939, actionType: actionClick, delay: 1000, title: "Open 33 chests for 2k emeralds"},
                {x: 0.711806, y: 0.900507, actionType: actionWaitForColor, color: [68,165,30], delay: 10000, threshold: 20},
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
                {x: 0.823495, y: 0.067807, actionType: actionJumpIf, color: [30,15,20], title: closeHydraTitle},
                {x: 0.748843, y: 0.844740, actionType: actionClick, delay: 500, title: "Give horn to fairies"},
                {x: 0.823495, y: 0.067807, actionType: actionJumpIf, color: [30,15,20], title: closeHydraTitle},
                {x: 0.748843, y: 0.844740, actionType: actionClick, delay: 500, title: "Give horn to fairies"},
                {x: 0.823495, y: 0.067807, actionType: actionJumpIf, color: [30,15,20], title: closeHydraTitle},
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
                {x: 0.659722, y: 0.493663, actionType: actionWaitForColor, delay: 5000, color: [255,253,239], title: "waiting for camp"},

                {x: 0.659722, y: 0.493663, actionType: actionJumpIfNot, color: [255,253,239], title: titleAttackCampBut}, // check if there is white Attack button with swords
                {x: 0.657986, y: 0.490494, actionType: actionClick, delay: 1000, title: titleAttackCamp},
                {x: 0.500000, y: 0.500000, actionType: actionJumpIfNot, color: [0,0,0], title: titleStartBattle, treshold: 1},

                {x: 0.460648, y: 0.756654, actionType: actionJumpIfNot, color: [56,146,0], title: titleLeaveRealm}, // check if there is green Attack button in popup
                {x: 0.460648, y: 0.756654, actionType: actionClick, delay: 1000, title: titleAttackCamp},

                {x: 0.886574, y: 0.894804, actionType: actionClick, delay: 5000, title: titleStartBattle},
                {x: 0.860532, y: 0.867554, actionType: actionWaitForColor, delay: 60000, color: [92,192,35], title: "Waiting until battle ends...", threshold: 30},
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
                {x: 0.854167, y: 0.527883, actionType: actionJumpIfNot, color: [36,48,67], title: titleLeaveRealm},
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
                //{x: 0.523148, y: 0.797845, actionType: actionJumpIfNot, color: [196,41,42], title: gotoNextActionTitle},
                {x: 0.480324, y: 0.711027, actionType: actionClick, delay: 1000, title: "Navigate heroic chest"},

                // chest for ad
                {x: 0.730000, y: 0.690000, actionType: actionClick, delay: 2000, title: "Open chest for AD"},
                {x: 0.730000, y: 0.690000, actionType: actionClick, delay: 2000, title: "Skip chest animation"},
                {x: 0.381366, y: 0.050697, actionType: actionJumpIfNot, color:[255,250,187], title: gotoNextChestTitle},
                {x: 0.968750, y: 0.054499, actionType: actionClick, delay: 1000, title: "Close chest"},

                {delay: 100, actionType: actionDelay, title: gotoNextChestTitle},
                {x: 0.409144, y: 0.857414, actionType: actionJumpIf, color: [169,255,190], title: gotoNextChestTitle, threshold: 30}, // check if chest is free
                {x: 0.380000, y: 0.860000, actionType: actionClick, delay: 2000, title: "Open free chest"},
                {x: 0.730000, y: 0.690000, actionType: actionClick, delay: 2000, title: "Skip chest animation"},
                {x: 0.381366, y: 0.050697, actionType: actionJumpIfNot, color:[255,250,187], title: gotoNextChestTitle},
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
            setActivated(dailyButton, true, BUTTON_TEXT_STOP_CUSTOM, BUTTON_TEXT_RUN_CUSTOM)

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

        fromHomePage = true
        if (localStorage.getItem("last_macro") == MACRO_FRONTIER) {
            const groups = parseFrontierGroups(localStorage.getItem(FRONTIER_GROUPS_STORAGE_KEY)) || []
            await runFrontier(groups, restoreInt(FRONTIER_ATTEMPTS_STORAGE_KEY, 3), restoreInt(FRONTIER_TEAMS_STORAGE_KEY, 10))
        } else {
            await runDungeonMacro()
        }
    }
})();
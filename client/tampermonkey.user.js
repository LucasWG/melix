// ==UserScript==
// @name         Melix Client
// @namespace    https://debugzone.com.br/
// @version      4.0.0
// @description  Cliente Melix com UI profissional
// @author       Melix
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

;(function () {
	'use strict'

	const MELIX_ENV = 'development' // 'development' | 'production'
	const WS_ENDPOINTS = {
		development: 'ws://127.0.0.1:3001/ws',
		production: 'wss://melix.debugzone.com.br/ws'
	}
	const WS_URL = WS_ENDPOINTS[MELIX_ENV] || WS_ENDPOINTS.production

	const DEVICE_ID_KEY = 'melix_device_id'
	const ACTIVE_TAB_KEY = 'melix_active_tab'
	const UI_MINIMIZED_KEY = 'melix_ui_minimized'
	const GLOBAL_DEVICE_ID_KEY = 'melix_global_device_id'

	const getGlobalDeviceId = () => {
		try {
			const existing = typeof GM_getValue === 'function' ? GM_getValue(GLOBAL_DEVICE_ID_KEY) : null
			if (existing) return String(existing)
		} catch (_error) {}

		const localExisting = localStorage.getItem(DEVICE_ID_KEY)
		if (localExisting) {
			try {
				if (typeof GM_setValue === 'function') GM_setValue(GLOBAL_DEVICE_ID_KEY, localExisting)
			} catch (_error) {}
			return localExisting
		}

		const generated = `device-${Math.random().toString(36).slice(2, 10)}`
		try {
			if (typeof GM_setValue === 'function') GM_setValue(GLOBAL_DEVICE_ID_KEY, generated)
		} catch (_error) {}
		localStorage.setItem(DEVICE_ID_KEY, generated)
		return generated
	}

	const deviceId = getGlobalDeviceId()
	localStorage.setItem(DEVICE_ID_KEY, deviceId)

	let socket = null
	let reconnectTimer = null
	let pingTimer = null
	const COMPOSER_TABS = new Set(['global'])

	const state = {
		isConnected: false,
		isMinimized: localStorage.getItem(UI_MINIMIZED_KEY) !== 'false',
		users: [],
		clipboard: [],
		activeTab: localStorage.getItem(ACTIVE_TAB_KEY) || 'global',
		privateTabs: [],
		unreadTabs: {},
		feeds: {
			global: [],
			users: [],
			log: [],
			system: []
		},
		privateFeeds: {}
	}

	const dom = {
		root: null,
		statusDot: null,
		statusText: null,
		toggleBtn: null,
		wsGate: null,
		app: null,
		standardTabBar: null,
		privateTabBar: null,
		feed: null,
		title: null,
		compose: null,
		input: null,
		sendBtn: null,
		clipBtn: null,
		floatingMessage: null,
		tabs: {}
	}

	const send = (payload) => {
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			toast('Sem conexao com servidor.', 'warning')
			return
		}
		socket.send(JSON.stringify({ ...payload, from: deviceId, timestamp: Date.now() }))
	}

	const styles = `
    #melix-root, #melix-root * { box-sizing: border-box; }
    #melix-root {
      position: fixed; right: 16px; bottom: 16px; width: 430px; height: 580px;
      background: #0f1119; color: #e7eaf3; z-index: 2147483647;
      border: 1px solid #2b354b; border-radius: 14px; overflow: hidden;
      box-shadow: 0 20px 44px rgba(0,0,0,.45);
      font: 13px/1.45 Inter, Segoe UI, Arial, sans-serif;
      display: flex; flex-direction: column;
    }
    #melix-root.minimized { width: 320px; height: 54px; }
    #melix-root.minimized #melix-tabs-main,
    #melix-root.minimized #melix-tabs-private,
    #melix-root.minimized #melix-body,
    #melix-root.minimized #melix-gate { display: none !important; }

    #melix-header {
      height: 54px; flex: 0 0 auto; padding: 10px 12px; border-bottom: 1px solid #273149;
      display: flex; align-items: center; justify-content: space-between;
      background: linear-gradient(180deg, #12192a 0%, #111726 100%);
    }
    #melix-title { font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .melix-dot { width: 8px; height: 8px; border-radius: 999px; background: #f59e0b; }
    #melix-sub { color: #9fb0cb; font-size: 12px; }

    #melix-tabs-main, #melix-tabs-private {
      flex: 0 0 auto; display: flex; align-items: center; gap: 6px;
      padding: 8px; border-bottom: 1px solid #273149; overflow-x: auto;
      scrollbar-width: thin;
    }
    #melix-tabs-private { background: #0d1422; min-height: 42px; }
    .melix-tab {
      border: 1px solid #34415b; background: #151d2e; color: #c9d5ea;
      border-radius: 8px; padding: 6px 10px; white-space: nowrap; cursor: pointer;
    }
    .melix-tab.active { background: #27406f; border-color: #4a6fae; color: #fff; }
    .melix-tab.unread {
      border-color: #6ea4ff;
      box-shadow: 0 0 0 1px rgba(110,164,255,.35) inset;
      animation: melixPulse 1.2s infinite;
    }
    .melix-badge {
      margin-left: 6px; min-width: 18px; height: 18px; border-radius: 999px;
      background: #f97316; color: #fff; font-size: 11px; line-height: 18px; text-align: center; padding: 0 5px;
      display: inline-block;
    }
    @keyframes melixPulse {
      0% { box-shadow: 0 0 0 0 rgba(110,164,255,.35); }
      70% { box-shadow: 0 0 0 6px rgba(110,164,255,0); }
      100% { box-shadow: 0 0 0 0 rgba(110,164,255,0); }
    }

    #melix-body {
      position: relative; flex: 1 1 auto; min-height: 0;
      display: flex; flex-direction: column;
    }
    #melix-feed {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
      padding: 10px; display: flex; flex-direction: column; gap: 8px;
    }
    .melix-msg { border: 1px solid #2b3852; border-radius: 10px; padding: 8px; background: #121929; }
    .melix-msg.mine { border-color: #3d5f95; background: #172745; }
    .melix-meta { color: #9cb0d0; font-size: 11px; margin-bottom: 4px; }
    .melix-body { white-space: pre-wrap; word-break: break-word; }
    .melix-chip {
      display: inline-block; border: 1px solid #33435f; background: #141d2f;
      color: #c5d1e8; border-radius: 999px; padding: 6px 10px; cursor: pointer;
      margin: 0 6px 6px 0;
    }
    .melix-chip:hover { border-color: #4c6ea8; color: #fff; }

    #melix-compose {
      flex: 0 0 auto; border-top: 1px solid #273149; padding: 10px;
      display: flex; gap: 8px; background: #0f1626;
    }
    .melix-input {
      flex: 1 1 auto; min-width: 0; background: #0f1524; color: #eef2fb;
      border: 1px solid #33435f; border-radius: 8px; padding: 8px;
    }
    .melix-btn {
      border: 0; border-radius: 8px; background: #2f65d9; color: #fff;
      padding: 8px 10px; cursor: pointer;
    }
    .melix-btn.alt { background: #26344f; }
    .melix-btn.icon {
      min-width: 34px; width: 34px; height: 34px; border-radius: 999px;
      padding: 0; display: inline-flex; align-items: center; justify-content: center; font-weight: 700;
    }

    #melix-gate {
      position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
      background: rgba(10,14,24,.9); color: #d6e1f4; text-align: center; padding: 16px;
    }
    #melix-gate.show { display: flex; }
    #melix-toast {
      position: fixed; right: 16px; bottom: 610px; display: grid; gap: 6px; z-index: 2147483647;
    }
    .melix-toast-item {
      min-width: 220px; max-width: 360px; padding: 8px 10px; border-radius: 8px;
      border: 1px solid #3b4d6d; background: #111826; color: #edf3ff;
    }
    .melix-toast-item.warning { border-color: #8a5f1d; }
    .melix-toast-item.error { border-color: #8a1d2e; }
    .melix-toast-item.success { border-color: #22643d; }

    #melix-floating {
      position: fixed; right: 16px; bottom: 72px; z-index: 2147483647;
      max-width: 360px; border: 1px solid #3c5c90; border-radius: 10px;
      background: #101a2d; color: #e8f1ff; padding: 10px; display: none;
      cursor: pointer; box-shadow: 0 10px 24px rgba(0,0,0,.35);
    }
    #melix-floating.show { display: block; }
    #melix-floating-title { font-size: 11px; color: #9eb4d9; margin-bottom: 4px; }
    #melix-floating-text { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `

	const injectStyles = () => {
		if (document.getElementById('melix-style')) return
		const style = document.createElement('style')
		style.id = 'melix-style'
		style.textContent = styles
		document.head.appendChild(style)
	}

	const toast = (message, level = 'info') => {
		let holder = document.getElementById('melix-toast')
		if (!holder) {
			holder = document.createElement('div')
			holder.id = 'melix-toast'
			document.body.appendChild(holder)
		}
		const item = document.createElement('div')
		item.className = `melix-toast-item ${level}`
		item.textContent = message
		holder.appendChild(item)
		setTimeout(() => item.remove(), 3000)
	}

	const playAlert = (priority) => {
		const AudioCtx = window.AudioContext || window.webkitAudioContext
		if (!AudioCtx) return
		const ctx = new AudioCtx()
		const beep = (freq, duration, delay = 0) => {
			const osc = ctx.createOscillator()
			const gain = ctx.createGain()
			osc.type = 'sine'
			osc.frequency.value = freq
			gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay)
			gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + delay + 0.01)
			gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration)
			osc.connect(gain)
			gain.connect(ctx.destination)
			osc.start(ctx.currentTime + delay)
			osc.stop(ctx.currentTime + delay + duration)
		}

		if (priority === 'high') {
			beep(880, 0.09, 0)
			beep(1040, 0.09, 0.12)
		} else {
			beep(620, 0.12, 0)
		}
		setTimeout(() => ctx.close(), 450)
	}

	const showFloatingMessage = (title, message, targetTab) => {
		if (!dom.floatingMessage) return
		dom.floatingMessage.querySelector('#melix-floating-title').textContent = title
		dom.floatingMessage.querySelector('#melix-floating-text').textContent = message || 'Nova mensagem'
		dom.floatingMessage.classList.add('show')
		dom.floatingMessage.onclick = () => {
			setMinimized(false)
			activateTab(targetTab)
			dom.floatingMessage.classList.remove('show')
		}
		setTimeout(() => {
			if (dom.floatingMessage) dom.floatingMessage.classList.remove('show')
		}, 6000)
	}

	const statusLabel = () => {
		if (!socket) return 'offline'
		if (socket.readyState === WebSocket.OPEN) return 'online'
		if (socket.readyState === WebSocket.CONNECTING) return 'conectando'
		return 'offline'
	}

	const setStatus = () => {
		const status = statusLabel()
		if (!dom.statusText || !dom.statusDot) return
		dom.statusText.textContent =
			status === 'online'
				? 'Conectado'
				: status === 'conectando'
					? 'Conectando...'
					: 'Desconectado'
		dom.statusDot.style.background =
			status === 'online' ? '#10b981' : status === 'conectando' ? '#f59e0b' : '#ef4444'
	}

	const stamp = (ts = Date.now()) =>
		new Date(ts).toLocaleTimeString('pt-BR', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		})

	const normalizeTab = (tabId) => {
		if (tabId.startsWith('private:')) return tabId
		if (['users', 'global', 'clipboard', 'log'].includes(tabId)) return tabId
		return 'global'
	}

	const getFeedForTab = (tabId) => {
		if (tabId === 'global') return state.feeds.global
		if (tabId === 'users') return state.feeds.users
		if (tabId === 'log') return state.feeds.log
		if (tabId === 'clipboard') return []
		if (tabId.startsWith('private:')) {
			const target = tabId.replace('private:', '')
			return state.privateFeeds[target] || []
		}
		return []
	}

	const renderFeed = () => {
		if (!dom.feed) return
		if (state.activeTab === 'clipboard') {
			renderClipboard()
			return
		}
		if (state.activeTab === 'users') {
			renderUsersListAsMain()
			return
		}

		dom.feed.innerHTML = ''
		const base = getFeedForTab(state.activeTab)
		const feed = [...base].slice(-80)
		if (!feed.length) {
			const empty = document.createElement('div')
			empty.className = 'melix-meta'
			empty.textContent = 'Sem mensagens ainda.'
			dom.feed.appendChild(empty)
			return
		}
		feed.forEach(msg => {
			const card = document.createElement('div')
			card.className = `melix-msg ${msg.from === deviceId ? 'mine' : ''}`
			const meta = document.createElement('div')
			meta.className = 'melix-meta'
			meta.textContent = `${msg.type} • ${msg.from || 'system'} • ${stamp(msg.timestamp)}`
			const body = document.createElement('div')
			body.className = 'melix-body'
			body.textContent = msg.message || ''
			card.appendChild(meta)
			card.appendChild(body)
			dom.feed.appendChild(card)
		})
		dom.feed.scrollTop = dom.feed.scrollHeight
	}

	const activateTab = (tabId) => {
		const normalized = normalizeTab(tabId)
		state.activeTab = normalized
		localStorage.setItem(ACTIVE_TAB_KEY, normalized)
		clearUnread(normalized)
		Object.entries(dom.tabs).forEach(([id, element]) => {
			element.classList.toggle('active', id === normalized)
		})

		if (dom.title) {
			dom.title.textContent = normalized.startsWith('private:')
				? `MELIX • PRIVATE • ${normalized.replace('private:', '')}`
				: `MELIX • ${normalized.toUpperCase()}`
		}
		setComposerVisibility()
		renderFeed()
	}

	const setComposerVisibility = () => {
		if (!dom.compose || !dom.input || !dom.sendBtn || !dom.clipBtn) return
		const isPrivateTab = state.activeTab.startsWith('private:')
		const canCompose = COMPOSER_TABS.has(state.activeTab) || isPrivateTab
		dom.compose.style.display = canCompose && state.isConnected ? 'flex' : 'none'
		if (!canCompose) {
			dom.input.value = ''
		}
	}

	const addFeed = (tab, entry) => {
		if (!state.feeds[tab]) return
		state.feeds[tab].push(entry)
		if (state.feeds[tab].length > 120) state.feeds[tab].shift()
		if (state.activeTab === tab) renderFeed()
	}

	const addLog = (message) => {
		addFeed('log', {
			type: 'log',
			from: 'melix',
			message,
			timestamp: Date.now()
		})
	}

	const getUnreadCount = (tabId) => Number(state.unreadTabs[tabId] || 0)

	const incrementUnread = (tabId) => {
		state.unreadTabs[tabId] = getUnreadCount(tabId) + 1
		buildTabs()
	}

	const clearUnread = (tabId) => {
		if (!state.unreadTabs[tabId]) return
		delete state.unreadTabs[tabId]
		buildTabs()
	}

	const ensurePrivateTab = (targetDeviceId, shouldFocus = false) => {
		const tabId = `private:${targetDeviceId}`
		if (!state.privateTabs.includes(targetDeviceId)) {
			state.privateTabs.push(targetDeviceId)
			state.privateFeeds[targetDeviceId] = state.privateFeeds[targetDeviceId] || []
			buildTabs()
		}
		if (shouldFocus) activateTab(tabId)
	}

	const addPrivateMessage = (targetDeviceId, data, shouldFocus = false) => {
		ensurePrivateTab(targetDeviceId, false)
		const list = state.privateFeeds[targetDeviceId]
		list.push(data)
		if (list.length > 120) list.shift()
		if (shouldFocus || state.activeTab === `private:${targetDeviceId}`) {
			activateTab(`private:${targetDeviceId}`)
		}
	}

	const renderUsersListAsMain = () => {
		if (!dom.feed) return
		dom.feed.innerHTML = ''
		if (!state.users.length) {
			const empty = document.createElement('div')
			empty.className = 'melix-meta'
			empty.textContent = 'Nenhum device conectado.'
			dom.feed.appendChild(empty)
			return
		}
		state.users.forEach((user) => {
			const item = document.createElement('button')
			item.className = 'melix-chip'
			item.textContent = user
			item.onclick = () => ensurePrivateTab(user, true)
			dom.feed.appendChild(item)
		})
	}

	const renderUsers = () => {
		if (state.activeTab === 'users') renderUsersListAsMain()
	}

	const renderClipboard = () => {
		if (!dom.feed) return
		dom.feed.innerHTML = ''
		if (!state.clipboard.length) {
			const empty = document.createElement('div')
			empty.className = 'melix-meta'
			empty.textContent = 'Clipboard vazio.'
			dom.feed.appendChild(empty)
			return
		}
		state.clipboard.forEach((entry, index) => {
			const item =
				typeof entry === 'string'
					? { id: `legacy_${index}`, content: entry, owner: 'desconhecido' }
					: entry
			const row = document.createElement('div')
			row.className = 'melix-msg'
			const meta = document.createElement('div')
			meta.className = 'melix-meta'
			meta.textContent = `Item ${index + 1} • ${item.owner}`
			const body = document.createElement('div')
			body.className = 'melix-body'
			body.textContent = item.content
			const copy = document.createElement('button')
			copy.className = 'melix-btn alt'
			copy.style.marginTop = '6px'
			copy.textContent = 'Copiar'
			copy.onclick = () => {
				GM_setClipboard(item.content)
				toast('Copiado para o clipboard.', 'success')
			}
			row.append(meta, body, copy)

			if (item.owner === deviceId && item.id && !String(item.id).startsWith('legacy_')) {
				const del = document.createElement('button')
				del.className = 'melix-btn alt'
				del.style.marginTop = '6px'
				del.style.marginLeft = '6px'
				del.textContent = 'Apagar'
				del.onclick = () => send({ type: 'clipboard_delete', clipboardId: item.id })
				row.append(del)
			}
			dom.feed.appendChild(row)
		})
	}

	const setConnectionGate = () => {
		if (
			!dom.wsGate ||
			!dom.app ||
			!dom.input ||
			!dom.sendBtn ||
			!dom.clipBtn ||
			!dom.standardTabBar ||
			!dom.privateTabBar
		)
			return
		if (state.isConnected) {
			dom.wsGate.classList.remove('show')
			dom.app.classList.remove('hide')
			dom.input.disabled = false
			dom.sendBtn.disabled = false
			dom.clipBtn.disabled = false
			dom.standardTabBar.style.display = 'flex'
			dom.privateTabBar.style.display = 'flex'
			setComposerVisibility()
			return
		}

		dom.wsGate.classList.add('show')
		dom.app.classList.add('hide')
		dom.input.disabled = true
		dom.sendBtn.disabled = true
		dom.clipBtn.disabled = true
		dom.standardTabBar.style.display = 'none'
		dom.privateTabBar.style.display = 'none'
		setComposerVisibility()
	}

	const setMinimized = (minimized) => {
		state.isMinimized = minimized
		localStorage.setItem(UI_MINIMIZED_KEY, minimized ? 'true' : 'false')
		if (!dom.root || !dom.toggleBtn) return
		dom.root.classList.toggle('minimized', minimized)
		dom.toggleBtn.textContent = minimized ? '▲' : '▼'
		dom.toggleBtn.title = minimized ? 'Abrir chat' : 'Minimizar chat'
		if (!minimized && dom.floatingMessage) {
			dom.floatingMessage.classList.remove('show')
		}
	}

	const isTabVisible = (tabId) => state.activeTab === tabId && !state.isMinimized

	const notifyIncomingMessage = ({ tabId, text, priority, floatingTitle }) => {
		if (isTabVisible(tabId)) return
		incrementUnread(tabId)
		playAlert(priority)
		if (state.isMinimized) {
			showFloatingMessage(floatingTitle, text, tabId)
		}
	}

	const sendFromComposer = () => {
		const text = (dom.input.value || '').trim()
		if (!text) return

		if (state.activeTab === 'global') {
			send({ type: 'chat_global', message: text })
			dom.input.value = ''
			return
		}

		if (state.activeTab.startsWith('private:')) {
			const to = state.activeTab.replace('private:', '')
			send({ type: 'chat_private', to, message: text })
			addPrivateMessage(to, {
				type: 'chat_private',
				from: deviceId,
				to,
				message: text,
				timestamp: Date.now()
			})
			dom.input.value = ''
			return
		}

		toast('Abra GLOBAL ou uma aba PRIVATE.', 'warning')
	}

	const create = (tag, attrs = {}, text = '') => {
		const el = document.createElement(tag)
		Object.entries(attrs).forEach(([k, v]) => {
			if (k === 'class') el.className = v
			else if (k === 'id') el.id = v
			else el.setAttribute(k, v)
		})
		if (text) el.textContent = text
		return el
	}

	const buildTabs = () => {
		if (!dom.standardTabBar || !dom.privateTabBar) return
		dom.standardTabBar.innerHTML = ''
		dom.privateTabBar.innerHTML = ''
		dom.tabs = {}

		const fixedTabs = [
			{ id: 'users', label: 'USUARIOS' },
			{ id: 'global', label: 'GLOBAL' },
			{ id: 'clipboard', label: 'CLIPBOARD' },
			{ id: 'log', label: 'LOG' }
		]

		fixedTabs.forEach(tab => {
			const button = create('button', { class: 'melix-tab' }, tab.label)
			button.onclick = () => activateTab(tab.id)
			const unread = getUnreadCount(tab.id)
			if (unread > 0) {
				button.classList.add('unread')
				button.appendChild(create('span', { class: 'melix-badge' }, String(unread)))
			}
			dom.tabs[tab.id] = button
			dom.standardTabBar.appendChild(button)
		})

		state.privateTabs.forEach(target => {
			const id = `private:${target}`
			const button = create('button', { class: 'melix-tab' }, `PRIVATE • ${target}`)
			button.onclick = () => activateTab(id)
			const unread = getUnreadCount(id)
			if (unread > 0) {
				button.classList.add('unread')
				button.appendChild(create('span', { class: 'melix-badge' }, String(unread)))
			}
			dom.tabs[id] = button
			dom.privateTabBar.appendChild(button)
		})

		Object.entries(dom.tabs).forEach(([id, element]) => {
			element.classList.toggle('active', id === state.activeTab)
		})
	}

	const buildUi = () => {
		injectStyles()
		const root = create('div', { id: 'melix-root' })
		dom.root = root

		const header = create('div', { id: 'melix-header' })
		dom.title = create('div', { id: 'melix-title' }, 'MELIX • GLOBAL')
		dom.statusDot = create('span', { class: 'melix-dot' })
		dom.title.prepend(dom.statusDot)
		dom.statusText = create('div', { id: 'melix-sub' }, 'conectando')
		const headerRight = create('div')
		headerRight.style.display = 'flex'
		headerRight.style.alignItems = 'center'
		headerRight.style.gap = '8px'
		headerRight.style.alignItems = 'center'
		dom.toggleBtn = create('button', { class: 'melix-btn icon alt', title: 'Abrir chat' }, '▲')
		dom.toggleBtn.onclick = () => setMinimized(!state.isMinimized)
		headerRight.append(dom.statusText, dom.toggleBtn)
		header.append(dom.title, headerRight)
		root.appendChild(header)

		dom.standardTabBar = create('div', { id: 'melix-tabs-main' })
		root.appendChild(dom.standardTabBar)
		dom.privateTabBar = create('div', { id: 'melix-tabs-private' })
		root.appendChild(dom.privateTabBar)

		dom.app = create('div', { id: 'melix-body' })

		dom.feed = create('div', { id: 'melix-feed' })
		dom.app.appendChild(dom.feed)

		const compose = create('div', { id: 'melix-compose' })
		dom.compose = compose
		dom.input = create('input', {
			class: 'melix-input',
			placeholder: 'Digite e pressione Enter'
		})
		dom.input.onkeydown = event => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault()
				sendFromComposer()
			}
		}
		dom.sendBtn = create('button', { class: 'melix-btn' }, 'Enviar')
		dom.sendBtn.onclick = sendFromComposer
		dom.clipBtn = create('button', { class: 'melix-btn alt' }, 'Salvar')
		dom.clipBtn.onclick = () => {
			const text = (dom.input.value || '').trim()
			if (!text) return toast('Digite um texto para salvar no clipboard.', 'warning')
			send({ type: 'clipboard_add', message: text })
			toast('Item salvo no clipboard.', 'success')
			dom.input.value = ''
		}
		compose.append(dom.input, dom.sendBtn, dom.clipBtn)
		dom.app.appendChild(compose)

		root.appendChild(dom.app)

		dom.wsGate = create('div', { id: 'melix-gate', class: 'show' }, 'Conectando ao Melix...')
		dom.app.appendChild(dom.wsGate)

		dom.floatingMessage = create('div', { id: 'melix-floating' })
		dom.floatingMessage.appendChild(create('div', { id: 'melix-floating-title' }, 'Nova mensagem'))
		dom.floatingMessage.appendChild(create('div', { id: 'melix-floating-text' }, ''))
		document.body.appendChild(dom.floatingMessage)

		document.body.appendChild(root)

		buildTabs()
		activateTab('global')
		setStatus()
		setConnectionGate()
		setMinimized(state.isMinimized)
	}

	const connect = () => {
		state.isConnected = false
		setConnectionGate()
		socket = new WebSocket(WS_URL)
		setStatus()

		socket.onopen = () => {
			clearInterval(pingTimer)
			pingTimer = setInterval(() => send({ type: 'ping' }), 30000)
			send({ type: 'register' })
			send({ type: 'clipboard_history' })
			state.isConnected = true
			setConnectionGate()
			activateTab('global')
			setStatus()
		}

		socket.onclose = () => {
			clearTimeout(reconnectTimer)
			clearInterval(pingTimer)
			state.isConnected = false
			setConnectionGate()
			setStatus()
			reconnectTimer = setTimeout(connect, 2500)
		}

		socket.onmessage = (event) => {
			const data = JSON.parse(event.data || '{}')
			if (data.type === 'presence_list') {
				state.users = JSON.parse(data.message || '[]')
					.filter((user) => user !== deviceId)
					.sort()
				renderUsers()
				return
			}

			if (data.type === 'clipboard_history') {
				state.clipboard = JSON.parse(data.message || '[]')
				if (state.activeTab === 'clipboard') renderClipboard()
				return
			}

			if (data.type === 'notification') {
				const isSelfJoinNotification =
					data.from === deviceId && typeof data.message === 'string' && data.message.includes('entrou no Melix')
				if (!isSelfJoinNotification) {
					toast(data.message || 'Nova notificacao', data.level || 'info')
				}
				const isPresenceNotice =
					typeof data.message === 'string' &&
					(data.message.includes('entrou no Melix') || data.message.includes('saiu'))
				if (!isPresenceNotice) {
					addLog(data.message || 'Notificacao recebida.')
				}
			}

			if (data.type === 'chat_global') {
				addFeed('global', data)
				if (data.from !== deviceId) {
					notifyIncomingMessage({
						tabId: 'global',
						text: `Global • ${data.from || 'device'}: ${data.message || ''}`,
						priority: 'normal',
						floatingTitle: 'Mensagem global'
					})
				}
			} else if (data.type === 'chat_private') {
				const target = data.from === deviceId ? data.to : data.from
				if (target) addPrivateMessage(target, data, false)
				if (data.from !== deviceId && target) {
					const privateTabId = `private:${target}`
					notifyIncomingMessage({
						tabId: privateTabId,
						text: `Privado • ${target}: ${data.message || ''}`,
						priority: 'high',
						floatingTitle: `PRIVATE • ${target}`
					})
				}
			} else if (data.type === 'user_join' || data.type === 'user_leave') {
				addFeed('users', data)
				addLog(data.message || `${data.from || 'device'} atualizou presenca.`)
			} else if (data.type === 'pong') {
				setStatus()
			} else {
				addLog(data.message || `Evento: ${data.type}`)
			}
		}
	}

	buildUi()
	renderUsers()
	connect()
})()

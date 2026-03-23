// ==UserScript==
// @name         Melix Client
// @namespace    https://debugzone.com.br/
// @version      5.0.0
// @description  Cliente Melix com notificacoes unificadas
// @author       Melix
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

;(function () {
	'use strict'

	const MELIX_ENV = 'development' // 'auto' | 'development' | 'production'
	const WS_URL_OVERRIDE_KEY = 'melix_ws_url_override'
	const WS_ENDPOINTS = {
		development: 'ws://127.0.0.1:3001/ws',
		production: 'wss://melix.debugzone.com.br/ws'
	}
	const resolveWsUrl = () => {
		const override = localStorage.getItem(WS_URL_OVERRIDE_KEY)
		if (override) {
			const isValidOverride = /^wss?:\/\/.+/i.test(override)
			if (isValidOverride) return override
			localStorage.removeItem(WS_URL_OVERRIDE_KEY)
		}
		if (MELIX_ENV === 'development') return WS_ENDPOINTS.development
		if (MELIX_ENV === 'production') return WS_ENDPOINTS.production
		const isLocalPage = ['localhost', '127.0.0.1'].includes(window.location.hostname)
		return isLocalPage ? WS_ENDPOINTS.development : WS_ENDPOINTS.production
	}
	const WS_URL = resolveWsUrl()
	const WS_CANDIDATES = [...new Set([WS_URL, WS_ENDPOINTS.development, WS_ENDPOINTS.production])]
	const DEVICE_ID_KEY = 'melix_device_id'
	const GLOBAL_DEVICE_ID_KEY = 'melix_global_device_id'
	const ACTIVE_TAB_KEY = 'melix_active_tab'
	const UI_MINIMIZED_KEY = 'melix_ui_minimized'
	const COMPOSER_TABS = new Set(['global'])

	const getGlobalDeviceId = () => {
		try {
			const existing =
				typeof GM_getValue === 'function' ? GM_getValue(GLOBAL_DEVICE_ID_KEY) : null
			if (existing) return String(existing)
		} catch (_error) {}
		const generated =
			localStorage.getItem(DEVICE_ID_KEY) ||
			`device-${Math.random().toString(36).slice(2, 10)}`
		try {
			if (typeof GM_setValue === 'function') GM_setValue(GLOBAL_DEVICE_ID_KEY, generated)
		} catch (_error) {}
		localStorage.setItem(DEVICE_ID_KEY, generated)
		return generated
	}

	const deviceId = getGlobalDeviceId()
	let socket = null
	let reconnectTimer = null
	let pingTimer = null
	let wsCandidateIndex = 0
	let notifSeq = 0
	let feedRenderFrame = null
	const notifTimeouts = new Map()

	const state = {
		isConnected: false,
		isMinimized: localStorage.getItem(UI_MINIMIZED_KEY) !== 'false',
		activeTab: localStorage.getItem(ACTIVE_TAB_KEY) || 'global',
		users: [],
		clipboard: [],
		privateTabs: [],
		privateFeeds: {},
		globalReadByMessage: {},
		privateReadByMessage: {},
		readSentRegistry: new Set(),
		unreadTabs: {},
		notifications: [],
		feeds: {
			global: [],
			users: [],
			log: [],
			system: []
		}
	}

	const dom = {
		root: null,
		title: null,
		statusDot: null,
		statusText: null,
		toggleBtn: null,
		standardTabBar: null,
		privateTabBar: null,
		body: null,
		feed: null,
		compose: null,
		input: null,
		sendBtn: null,
		clipBtn: null,
		gate: null,
		notifications: null,
		tabs: {}
	}

	const uiState = {
		lastFeedSignature: '',
		animatedMessageIds: new Set()
	}

	const injectEnhancementStyles = () => {
		if (document.getElementById('melix-enhance-style')) return
		const style = document.createElement('style')
		style.id = 'melix-enhance-style'
		style.textContent = `
			@keyframes melixFadeUp {
				from { opacity: 0; transform: translateY(8px); }
				to { opacity: 1; transform: translateY(0); }
			}
			@keyframes melixFadeIn {
				from { opacity: 0; transform: scale(.98); }
				to { opacity: 1; transform: scale(1); }
			}
			.melix-enter { animation: melixFadeUp .18s ease-out; }
			.melix-enter-soft { animation: melixFadeIn .16s ease-out; }
			#melix-root {
				font-family: Inter, "Proxima Nova", "Segoe UI", Roboto, Arial, sans-serif !important;
				font-size: clamp(12px, 0.72vw, 14px);
			}
		`
		document.head.appendChild(style)
	}

	const ensureTailwind = () =>
		new Promise(resolve => {
			let done = false
			const finish = () => {
				if (done) return
				done = true
				resolve()
			}

			// Nunca travar o app por causa de estilo.
			setTimeout(finish, 1200)

			if (window.tailwind) return finish()
			const existing = document.getElementById('melix-tailwind')
			if (existing) {
				existing.addEventListener('load', finish, { once: true })
				existing.addEventListener('error', finish, { once: true })
				return
			}
			const script = document.createElement('script')
			script.id = 'melix-tailwind'
			script.src = 'https://cdn.tailwindcss.com'
			script.onload = finish
			script.onerror = finish
			document.head.appendChild(script)
		})

	const icon = name => {
		const map = {
			chat: '<svg viewBox="0 0 24 24" class="w-4 h-4"><path fill="currentColor" d="M4 4h16v11H7l-3 3V4z"/></svg>',
			users: '<svg viewBox="0 0 24 24" class="w-4 h-4"><path fill="currentColor" d="M16 11a4 4 0 1 0-4-4a4 4 0 0 0 4 4M8 11a3 3 0 1 0-3-3a3 3 0 0 0 3 3m8 2c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4M8 13c-.29 0-.62.02-.97.05A5.53 5.53 0 0 1 9 17v3H2v-3c0-2 3.33-4 6-4"/></svg>',
			clip: '<svg viewBox="0 0 24 24" class="w-4 h-4"><path fill="currentColor" d="M16 4h-1.18A3 3 0 0 0 12 2a3 3 0 0 0-2.82 2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H8V6h2v1h4V6h2v7h2V6a2 2 0 0 0-2-2"/></svg>',
			log: '<svg viewBox="0 0 24 24" class="w-4 h-4"><path fill="currentColor" d="M3 4h18v2H3zm0 7h18v2H3zm0 7h12v2H3z"/></svg>',
			private:
				'<svg viewBox="0 0 24 24" class="w-4 h-4"><path fill="currentColor" d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5m-3 8V6a3 3 0 0 1 6 0v3z"/></svg>',
			send: '<svg viewBox="0 0 24 24" class="w-4 h-4"><path fill="currentColor" d="M2 21l20-9L2 3v7l14 2l-14 2z"/></svg>'
		}
		return map[name] || ''
	}

	const create = (tag, className = '', text = '') => {
		const el = document.createElement(tag)
		if (className) el.className = className
		if (text) el.textContent = text
		return el
	}

	const send = payload => {
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			pushNotification({
				title: 'Conexao',
				message: 'Sem conexao com servidor.',
				level: 'warning',
				priority: null,
				reuseKey: 'system-connection'
			})
			return
		}
		socket.send(JSON.stringify({ ...payload, from: deviceId, timestamp: Date.now() }))
	}

	const formatStamp = (ts = Date.now()) =>
		new Date(ts).toLocaleTimeString('pt-BR', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		})

	const createMessageId = () => `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

	const markVisibleMessagesAsRead = () => {
		if (!socket || socket.readyState !== WebSocket.OPEN) return

		if (state.activeTab === 'global') {
			const feed = state.feeds.global || []
			for (const msg of feed) {
				if (!msg?.messageId || msg.from === deviceId) continue
				const key = `g:${msg.messageId}`
				if (state.readSentRegistry.has(key)) continue
				state.readSentRegistry.add(key)
				send({ type: 'chat_global_read', messageId: msg.messageId })
			}
			return
		}

		if (state.activeTab.startsWith('private:')) {
			const target = state.activeTab.replace('private:', '')
			const feed = state.privateFeeds[target] || []
			for (const msg of feed) {
				if (!msg?.messageId || msg.from === deviceId) continue
				const key = `p:${msg.messageId}`
				if (state.readSentRegistry.has(key)) continue
				state.readSentRegistry.add(key)
				send({ type: 'chat_private_read', messageId: msg.messageId, to: target })
			}
		}
	}

	const statusLabel = () => {
		if (!socket) return 'Desconectado'
		if (socket.readyState === WebSocket.OPEN) return 'Conectado'
		if (socket.readyState === WebSocket.CONNECTING) return 'Conectando...'
		return 'Desconectado'
	}

	const pushNotification = ({
		title,
		message,
		level = 'info',
		tabId = null,
		priority = 'normal',
		reuseKey = null
	}) => {
		let item = null
		if (reuseKey) {
			item = state.notifications.find(n => n.reuseKey === reuseKey) || null
		}
		if (item) {
			item.title = title
			item.message = message
			item.level = level
			item.tabId = tabId
			state.notifications = [item, ...state.notifications.filter(n => n.id !== item.id)]
		} else {
			item = { id: `n_${++notifSeq}`, title, message, level, tabId, reuseKey }
			state.notifications.unshift(item)
		}
		state.notifications = state.notifications.slice(0, 6)
		renderNotifications()
		if (priority) playAlert(priority)
		const timeoutKey = reuseKey || item.id
		if (notifTimeouts.has(timeoutKey)) {
			clearTimeout(notifTimeouts.get(timeoutKey))
		}
		const timeoutId = setTimeout(() => {
			state.notifications = state.notifications.filter(n => n.id !== item.id)
			renderNotifications()
			notifTimeouts.delete(timeoutKey)
		}, 5500)
		notifTimeouts.set(timeoutKey, timeoutId)
	}

	const renderNotifications = () => {
		if (!dom.notifications) return
		dom.notifications.innerHTML = ''
		for (const n of state.notifications) {
			const levelClass =
				n.level === 'error'
					? 'border-red-500/70'
					: n.level === 'warning'
						? 'border-amber-500/70'
						: n.level === 'success'
							? 'border-emerald-500/70'
							: 'border-sky-500/70'
			const card = create(
				'button',
				`w-full text-left rounded-lg border ${levelClass} bg-slate-900 px-3 py-2 shadow-lg`
			)
			card.classList.add('melix-enter-soft')
			const h = create('div', 'text-[11px] text-slate-300', n.title)
			const m = create('div', 'text-xs text-slate-100 truncate', n.message || 'Nova notificacao')
			card.append(h, m)
			card.onclick = () => {
				if (n.tabId) {
					setMinimized(false)
					activateTab(n.tabId)
				}
				state.notifications = state.notifications.filter(x => x.id !== n.id)
				renderNotifications()
			}
			dom.notifications.appendChild(card)
		}
	}

	const playAlert = priority => {
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

	const addLog = message => {
		state.feeds.log.push({ type: 'log', from: 'melix', message, timestamp: Date.now() })
		state.feeds.log = state.feeds.log.slice(-120)
		if (state.activeTab === 'log') renderFeed()
	}

	const addFeed = (tab, entry) => {
		if (!state.feeds[tab]) return
		state.feeds[tab].push(entry)
		state.feeds[tab] = state.feeds[tab].slice(-120)
		if (state.activeTab === tab) scheduleRenderFeed()
	}

	const normalizeTab = tabId => {
		if (tabId.startsWith('private:')) return tabId
		return ['users', 'global', 'clipboard', 'log'].includes(tabId) ? tabId : 'global'
	}

	const getFeedForTab = tabId => {
		if (tabId === 'global') return state.feeds.global
		if (tabId === 'users') return state.feeds.users
		if (tabId === 'log') return state.feeds.log
		if (tabId.startsWith('private:'))
			return state.privateFeeds[tabId.replace('private:', '')] || []
		return []
	}

	const getUnread = tabId => Number(state.unreadTabs[tabId] || 0)
	const incrementUnread = tabId => {
		state.unreadTabs[tabId] = getUnread(tabId) + 1
		buildTabs()
	}
	const clearUnread = tabId => {
		if (!state.unreadTabs[tabId]) return
		delete state.unreadTabs[tabId]
		buildTabs()
	}

	const isTabVisible = tabId => state.activeTab === tabId && !state.isMinimized

	const ensurePrivateTab = (target, focus = false) => {
		if (!state.privateTabs.includes(target)) {
			state.privateTabs.push(target)
			state.privateFeeds[target] = state.privateFeeds[target] || []
			buildTabs()
		}
		if (focus) activateTab(`private:${target}`)
	}

	const addPrivateMessage = (target, message) => {
		ensurePrivateTab(target, false)
		state.privateFeeds[target].push(message)
		state.privateFeeds[target] = state.privateFeeds[target].slice(-120)
		if (state.activeTab === `private:${target}`) scheduleRenderFeed()
	}

	const setComposerVisibility = () => {
		if (!dom.compose) return
		const canCompose =
			COMPOSER_TABS.has(state.activeTab) || state.activeTab.startsWith('private:')
		dom.compose.style.display = canCompose && state.isConnected ? 'flex' : 'none'
	}

	const setStatus = () => {
		if (!dom.statusText || !dom.statusDot) return
		const label = statusLabel()
		dom.statusText.textContent = label
		dom.statusDot.className =
			'w-2 h-2 rounded-full ' +
			(label === 'Conectado'
				? 'bg-emerald-400'
				: label === 'Conectando...'
					? 'bg-amber-400'
					: 'bg-rose-400')
	}

	const setConnectionGate = () => {
		if (!dom.gate) return
		dom.gate.style.display = state.isConnected ? 'none' : 'flex'
		if (!state.isConnected) dom.gate.textContent = 'Conectando ao Melix...'
	}

	const setMinimized = minimized => {
		state.isMinimized = minimized
		localStorage.setItem(UI_MINIMIZED_KEY, minimized ? 'true' : 'false')
		if (!dom.root || !dom.toggleBtn) return
		dom.root.style.height = minimized ? '54px' : '590px'
		dom.root.style.width = minimized ? '320px' : '440px'
		const mainParts = dom.root.querySelectorAll('.melix-main')
		mainParts.forEach(el => {
			el.style.display = minimized ? 'none' : ''
		})
		dom.toggleBtn.innerHTML = minimized ? '▲' : '▼'
		dom.toggleBtn.title = minimized ? 'Abrir chat' : 'Minimizar chat'
	}

	const notifyIncomingMessage = ({ tabId, title, text, priority }) => {
		if (isTabVisible(tabId)) return
		incrementUnread(tabId)
		pushNotification({
			title,
			message: text,
			tabId,
			priority
		})
	}

	const renderUsersList = () => {
		dom.feed.innerHTML = ''
		if (!state.users.length) {
			dom.feed.appendChild(
				create('div', 'text-xs text-slate-400', 'Nenhum device conectado.')
			)
			return
		}
		dom.feed.appendChild(
			create('div', 'mb-3 text-xs font-medium text-slate-400', `${state.users.length} devices online`)
		)
		const wrap = create('div', 'grid grid-cols-1 gap-2')
		for (const user of state.users) {
			const card = create('div', 'rounded-lg border border-slate-700 bg-slate-900 p-3 melix-enter')
			const top = create('div', 'flex items-center justify-between')
			const idText = create('div', 'text-xs font-semibold text-slate-100', user)
			const status = create('span', 'rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300', 'Disponivel')
			top.append(idText, status)

			const meta = create('div', 'mt-1 text-[11px] text-slate-400', `Canal privado disponivel • ID ${user.slice(0, 18)}...`)
			const actions = create('div', 'mt-2 flex gap-2')
			const openBtn = create('button', 'rounded bg-[#2d6cdf] px-2 py-1 text-[11px] text-white hover:bg-[#2258b8]', 'Abrir chat')
			openBtn.onclick = () => ensurePrivateTab(user, true)
			const copyBtn = create('button', 'rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600', 'Copiar ID')
			copyBtn.onclick = () => {
				GM_setClipboard(user)
				pushNotification({ title: 'Usuarios', message: `ID ${user} copiado.`, level: 'success', priority: null })
			}
			actions.append(openBtn, copyBtn)

			card.append(top, meta, actions)
			wrap.appendChild(card)
		}
		dom.feed.appendChild(wrap)
	}

	const renderClipboard = () => {
		dom.feed.innerHTML = ''
		if (!state.clipboard.length) {
			dom.feed.appendChild(create('div', 'text-xs text-slate-400', 'Clipboard vazio.'))
			return
		}
		for (let i = 0; i < state.clipboard.length; i++) {
			const raw = state.clipboard[i]
			const item =
				typeof raw === 'string'
					? { id: `legacy_${i}`, owner: 'desconhecido', content: raw }
					: raw
			const card = create('div', 'rounded-lg border border-slate-700 bg-slate-900 p-3')
			card.classList.add('melix-enter')
			card.appendChild(
				create('div', 'mb-1 text-[11px] text-slate-400', `Item ${i + 1} • ${item.owner}`)
			)
			card.appendChild(
				create('div', 'whitespace-pre-wrap break-words text-xs text-slate-100', item.content)
			)
			const actions = create('div', 'mt-2 flex gap-2')
			const copy = create(
				'button',
				'rounded bg-[#2d6cdf] px-2 py-1 text-[11px] text-white hover:bg-[#2258b8]',
				'Copiar'
			)
			copy.onclick = () => {
				GM_setClipboard(item.content)
				pushNotification({
					title: 'Clipboard',
					message: 'Copiado.',
					level: 'success',
					priority: null
				})
			}
			actions.appendChild(copy)
			if (item.owner === deviceId && item.id && !String(item.id).startsWith('legacy_')) {
				const del = create(
					'button',
					'rounded bg-rose-700 px-2 py-1 text-[11px] text-white',
					'Apagar'
				)
				del.onclick = () => send({ type: 'clipboard_delete', clipboardId: item.id })
				actions.appendChild(del)
			}
			card.appendChild(actions)
			dom.feed.appendChild(card)
		}
	}

	const getFeedSignature = feed =>
		feed
			.slice(-100)
			.map(msg => `${msg.messageId || ''}:${msg.timestamp || ''}:${msg.from || ''}:${msg.message || ''}`)
			.join('|')

	const scheduleRenderFeed = () => {
		if (feedRenderFrame) return
		feedRenderFrame = requestAnimationFrame(() => {
			feedRenderFrame = null
			renderFeed()
		})
	}

	const invalidateFeedRender = () => {
		uiState.lastFeedSignature = ''
	}

	const renderFeed = () => {
		if (!dom.feed) return
		if (state.activeTab === 'users') return renderUsersList()
		if (state.activeTab === 'clipboard') return renderClipboard()
		const feed = getFeedForTab(state.activeTab)
		const signature = `${state.activeTab}::${getFeedSignature(feed)}`
		if (signature === uiState.lastFeedSignature) return
		uiState.lastFeedSignature = signature
		const previousScrollBottom = dom.feed.scrollHeight - dom.feed.scrollTop - dom.feed.clientHeight
		const shouldStickBottom = previousScrollBottom < 24
		dom.feed.innerHTML = ''
		if (!feed.length) {
			dom.feed.appendChild(create('div', 'text-xs text-slate-400', 'Sem mensagens ainda.'))
			return
		}
		for (const msg of feed.slice(-100)) {
			const mine = msg.from === deviceId
			const row = create('div', `flex ${mine ? 'justify-end' : 'justify-start'}`)
			const card = create(
				'div',
				`max-w-[78%] rounded-xl border p-3 ${mine ? 'border-[#2d6cdf] bg-[#122646]' : 'border-slate-700 bg-slate-900'}`
			)
			if (msg.messageId && !uiState.animatedMessageIds.has(msg.messageId)) {
				card.classList.add('melix-enter')
				uiState.animatedMessageIds.add(msg.messageId)
			}
			card.appendChild(
				create(
					'div',
					'mb-1 text-[11px] text-slate-400',
					`${msg.type} • ${msg.from || 'system'} • ${formatStamp(msg.timestamp)}`
				)
			)
			const body = create(
				'div',
				'whitespace-pre-wrap break-words text-xs text-slate-100',
				msg.message || ''
			)
			card.appendChild(body)

			const footer = create('div', 'mt-2 flex items-center gap-2 text-[10px] text-slate-400')
			if (state.activeTab === 'global' && mine && msg.messageId) {
				const viewers = state.globalReadByMessage[msg.messageId] || []
				const viewedIcon = create('span', 'cursor-help select-none', '👁')
				viewedIcon.title = viewers.length
					? `Visualizado por: ${viewers.join(', ')}`
					: 'Ainda nao visualizada'
				footer.append(viewedIcon, create('span', '', `${viewers.length} visualizaram`))
			}
			if (state.activeTab.startsWith('private:') && mine && msg.messageId) {
				const read = Boolean(state.privateReadByMessage[msg.messageId])
				const readMark = create('span', read ? 'text-emerald-400' : 'text-slate-500', read ? '✓✓' : '✓')
				readMark.title = read ? 'Lida' : 'Enviada'
				footer.append(readMark, create('span', '', read ? 'Lida' : 'Enviada'))
			}
			if (footer.childElementCount > 0) {
				card.appendChild(footer)
			}
			row.appendChild(card)
			dom.feed.appendChild(row)
		}
		if (shouldStickBottom) {
			dom.feed.scrollTop = dom.feed.scrollHeight
		}
	}

	const buildTabs = () => {
		if (!dom.standardTabBar || !dom.privateTabBar) return
		dom.standardTabBar.innerHTML = ''
		dom.privateTabBar.innerHTML = ''
		dom.tabs = {}
		const fixed = [
			{ id: 'users', label: 'USUARIOS', icon: 'users' },
			{ id: 'global', label: 'GLOBAL', icon: 'chat' },
			{ id: 'clipboard', label: 'CLIPBOARD', icon: 'clip' },
			{ id: 'log', label: 'LOG', icon: 'log' }
		]
		for (const t of fixed) {
			const b = create(
				'button',
				'flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-[#2d6cdf]'
			)
			b.innerHTML = `${icon(t.icon)}<span>${t.label}</span>`
			const unread = getUnread(t.id)
			if (unread) {
				b.classList.add('ring-1', 'ring-sky-400', 'animate-pulse')
				b.innerHTML += `<span class="ml-1 rounded-full bg-orange-500 px-1.5 text-[10px] text-white">${unread > 9 ? '9+' : unread}</span>`
			}
			b.onclick = () => activateTab(t.id)
			dom.standardTabBar.appendChild(b)
			dom.tabs[t.id] = b
		}
		for (const p of state.privateTabs) {
			const id = `private:${p}`
			const b = create(
				'button',
				'flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-[#2d6cdf]'
			)
			b.innerHTML = `${icon('private')}<span>PRIVATE • ${p}</span>`
			const unread = getUnread(id)
			if (unread) {
				b.classList.add('ring-1', 'ring-sky-400', 'animate-pulse')
				b.innerHTML += `<span class="ml-1 rounded-full bg-orange-500 px-1.5 text-[10px] text-white">${unread > 9 ? '9+' : unread}</span>`
			}
			b.onclick = () => activateTab(id)
			dom.privateTabBar.appendChild(b)
			dom.tabs[id] = b
		}
		Object.entries(dom.tabs).forEach(([id, el]) => {
			applyTabVisualState(el, id === state.activeTab)
		})
	}

	const applyTabVisualState = (el, active) => {
		if (!el) return
		if (active) {
			el.style.background = 'linear-gradient(180deg, #2d6cdf 0%, #1f4fa3 100%)'
			el.style.borderColor = '#5c8de6'
			el.style.color = '#ffffff'
			el.style.boxShadow = '0 0 0 2px rgba(92,141,230,0.45), inset 0 0 0 1px rgba(255,255,255,0.08)'
			el.style.fontWeight = '600'
		} else {
			el.style.background = ''
			el.style.borderColor = ''
			el.style.color = ''
			el.style.boxShadow = ''
			el.style.fontWeight = ''
		}
	}

	const activateTab = tabId => {
		const normalized = normalizeTab(tabId)
		state.activeTab = normalized
		localStorage.setItem(ACTIVE_TAB_KEY, normalized)
		clearUnread(normalized)
		if (dom.title) {
			dom.title.innerHTML = `${icon('chat')}<span>${normalized.startsWith('private:') ? `MELIX • PRIVATE • ${normalized.replace('private:', '')}` : `MELIX • ${normalized.toUpperCase()}`}</span>`
		}
		Object.entries(dom.tabs).forEach(([id, el]) => {
			applyTabVisualState(el, id === normalized)
		})
		setComposerVisibility()
		renderFeed()
		markVisibleMessagesAsRead()
	}

	const sendFromComposer = () => {
		const text = (dom.input.value || '').trim()
		if (!text) return
		const messageId = createMessageId()
		if (state.activeTab === 'global') {
			send({ type: 'chat_global', message: text, messageId })
			state.globalReadByMessage[messageId] = []
			dom.input.value = ''
			return
		}
		if (state.activeTab.startsWith('private:')) {
			const to = state.activeTab.replace('private:', '')
			send({ type: 'chat_private', to, message: text, messageId })
			state.privateReadByMessage[messageId] = false
			addPrivateMessage(to, {
				type: 'chat_private',
				from: deviceId,
				to,
				messageId,
				message: text,
				timestamp: Date.now()
			})
			dom.input.value = ''
			return
		}
		pushNotification({
			title: 'Melix',
			message: 'Abra GLOBAL ou PRIVATE.',
			level: 'warning',
			priority: null
		})
	}

	const buildUi = () => {
		const root = create(
			'div',
			'fixed bottom-4 right-4 z-[2147483647] flex h-[590px] w-[440px] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl'
		)
		root.id = 'melix-root'
		dom.root = root

		const header = create(
			'div',
			'flex h-14 items-center justify-between border-b border-slate-700 bg-gradient-to-b from-slate-900 to-slate-950 px-3'
		)
		dom.title = create('div', 'flex items-center gap-2 text-sm font-semibold')
		dom.title.innerHTML = `${icon('chat')}<span>MELIX • GLOBAL</span>`
		const right = create('div', 'flex items-center gap-2')
		dom.statusDot = create('span', 'h-2 w-2 rounded-full bg-amber-400')
		dom.statusText = create('span', 'text-xs text-slate-300', 'Conectando...')
		dom.toggleBtn = create(
			'button',
			'h-8 w-8 rounded-full bg-[#2d6cdf] text-sm text-white hover:bg-[#2258b8]',
			'▲'
		)
		dom.toggleBtn.onclick = () => setMinimized(!state.isMinimized)
		right.append(dom.statusDot, dom.statusText, dom.toggleBtn)
		header.append(dom.title, right)

		dom.standardTabBar = create(
			'div',
			'melix-main flex gap-2 overflow-x-auto border-b border-slate-700 bg-slate-900/70 p-2'
		)
		dom.privateTabBar = create(
			'div',
			'melix-main flex gap-2 overflow-x-auto border-b border-slate-700 bg-slate-900/40 p-2'
		)

		dom.body = create('div', 'melix-main relative flex min-h-0 flex-1 flex-col')
		dom.feed = create('div', 'flex-1 overflow-y-auto p-3')
		dom.compose = create('div', 'flex gap-2 border-t border-slate-700 bg-slate-900/70 p-3')
		dom.input = create(
			'input',
			'min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-2 text-xs text-slate-100 outline-none focus:border-[#2d6cdf]'
		)
		dom.input.placeholder = 'Digite sua mensagem...'
		dom.input.onkeydown = event => {
			if (event.key === 'Enter') {
				event.preventDefault()
				sendFromComposer()
			}
		}
		dom.sendBtn = create(
			'button',
			'inline-flex items-center whitespace-nowrap rounded bg-[#2d6cdf] px-3 py-2 text-xs text-white hover:bg-[#2258b8]'
		)
		dom.sendBtn.innerHTML = `${icon('send')}<span class="ml-1 leading-none">Enviar</span>`
		dom.sendBtn.onclick = sendFromComposer
		dom.clipBtn = create(
			'button',
			'rounded bg-slate-700 px-3 py-2 text-xs text-slate-100 hover:bg-slate-600',
			'Salvar'
		)
		dom.clipBtn.onclick = () => {
			const text = (dom.input.value || '').trim()
			if (!text) {
				pushNotification({
					title: 'Clipboard',
					message: 'Digite um texto para salvar.',
					level: 'warning',
					priority: null
				})
				return
			}
			send({ type: 'clipboard_add', message: text })
			pushNotification({
				title: 'Clipboard',
				message: 'Item salvo.',
				level: 'success',
				priority: null
			})
			dom.input.value = ''
		}
		dom.compose.append(dom.input, dom.sendBtn, dom.clipBtn)
		dom.body.append(dom.feed, dom.compose)

		dom.gate = create(
			'div',
			'absolute inset-0 z-20 hidden items-center justify-center bg-slate-950/90 text-xs text-slate-300',
			'Conectando ao Melix...'
		)
		dom.body.appendChild(dom.gate)

		dom.notifications = create(
			'div',
			'fixed right-4 top-4 z-[2147483647] grid w-[320px] max-w-[92vw] gap-2'
		)

		root.append(header, dom.standardTabBar, dom.privateTabBar, dom.body)
		document.body.append(root, dom.notifications)

		buildTabs()
		activateTab(state.activeTab)
		setStatus()
		setConnectionGate()
		setMinimized(state.isMinimized)
	}

	const connect = () => {
		state.isConnected = false
		setConnectionGate()
		const currentUrl = WS_CANDIDATES[wsCandidateIndex % WS_CANDIDATES.length]
		let opened = false
		try {
			socket = new WebSocket(currentUrl)
		} catch (_error) {
			wsCandidateIndex++
			reconnectTimer = setTimeout(connect, 1200)
			return
		}
		setStatus()

		socket.onopen = () => {
			opened = true
			clearInterval(pingTimer)
			pingTimer = setInterval(() => send({ type: 'ping' }), 30000)
			send({ type: 'register' })
			send({ type: 'clipboard_history' })
			state.isConnected = true
			setConnectionGate()
			activateTab(state.activeTab)
			setStatus()
		}
		socket.onclose = () => {
			clearTimeout(reconnectTimer)
			clearInterval(pingTimer)
			state.isConnected = false
			setConnectionGate()
			setStatus()
			if (!opened) wsCandidateIndex++
			reconnectTimer = setTimeout(connect, opened ? 2500 : 1200)
		}
		socket.onerror = () => {
			pushNotification({
				title: 'Conexao',
				message: `Falha ao conectar em ${currentUrl}`,
				level: 'error',
				priority: null,
				reuseKey: 'system-connection'
			})
		}
		socket.onmessage = event => {
			const data = JSON.parse(event.data || '{}')
			if (data.type === 'presence_list') {
				state.users = JSON.parse(data.message || '[]')
					.filter(u => u !== deviceId)
					.sort()
				renderFeed()
				return
			}
			if (data.type === 'clipboard_history') {
				state.clipboard = JSON.parse(data.message || '[]')
				if (state.activeTab === 'clipboard') renderClipboard()
				return
			}
			if (data.type === 'notification') {
				const isSelfJoin =
					data.from === deviceId &&
					typeof data.message === 'string' &&
					data.message.includes('entrou no Melix')
				if (!isSelfJoin) {
					pushNotification({
						title: 'Sistema',
						message: data.message || 'Nova notificacao',
						level: data.level || 'info',
						priority: null,
						reuseKey: 'system-notice'
					})
				}
				return
			}
			if (data.type === 'chat_global') {
				if (!data.messageId) data.messageId = createMessageId()
				addFeed('global', data)
				if (data.from !== deviceId) {
					notifyIncomingMessage({
						tabId: 'global',
						title: 'Mensagem global',
						text: `${data.from || 'device'}: ${data.message || ''}`,
						priority: 'normal'
					})
				}
			} else if (data.type === 'chat_private') {
				if (!data.messageId) data.messageId = createMessageId()
				const target = data.from === deviceId ? data.to : data.from
				if (target) addPrivateMessage(target, data)
				if (data.from !== deviceId && target) {
					const tabId = `private:${target}`
					notifyIncomingMessage({
						tabId,
						title: `PRIVATE • ${target}`,
						text: data.message || 'Nova mensagem privada',
						priority: 'high'
					})
				}
			} else if (data.type === 'chat_private_read') {
				if (data.messageId) {
					state.privateReadByMessage[data.messageId] = true
					invalidateFeedRender()
					scheduleRenderFeed()
				}
			} else if (data.type === 'chat_global_read') {
				if (data.messageId) {
					if (Array.isArray(data.readers)) {
						state.globalReadByMessage[data.messageId] = [...data.readers]
					} else if (data.from) {
						const current = new Set(state.globalReadByMessage[data.messageId] || [])
						current.add(data.from)
						state.globalReadByMessage[data.messageId] = [...current]
					}
					invalidateFeedRender()
					scheduleRenderFeed()
				}
			} else if (data.type === 'user_join' || data.type === 'user_leave') {
				addFeed('users', data)
				addLog(data.message || `${data.from || 'device'} atualizou presenca.`)
			} else if (data.type === 'pong') {
				setStatus()
			} else {
				addLog(data.message || `Evento: ${data.type}`)
			}
			renderFeed()
			markVisibleMessagesAsRead()
		}
	}

	const init = async () => {
		await ensureTailwind()
		injectEnhancementStyles()
		buildUi()
		connect()
	}

	init()
})()

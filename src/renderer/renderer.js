// Global uncaught-error logger — surfaces real errors hidden behind
// Electron's "GUEST_VIEW_MANAGER_CALL: Script failed to execute" proxy message.
window.addEventListener('error', (e) => {
    console.error('[renderer] Uncaught error:', e.message, '\n  at', e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('[renderer] Unhandled promise rejection:', e.reason);
});

// Tab Management
class TabManager {
    constructor() {
        this.tabs = [];
        this.activeTabId = null;
        this.tabCounter = 0;
        this.init();
    }

    init() {
        // Wire main-process tab plumbing before creating any tab so we don't miss
        // early dom-ready / navigation events.
        this._setupTabEvents();
        this._startBridgePoll();
        this._watchOverlays();
        this._watchContentBounds();
        // Create initial tab
        this.createTab('https://www.google.com');
        this.setupEventListeners();
        // Defer embed setup to the next tick so Electron's webview guest-view
        // manager can complete its IPC handshake before we attach more listeners.
        setTimeout(() => {
            try { this.setupEmbedFeature(); }
            catch (e) { console.error('[embed] setup error:', e); }
        }, 0);
    }

    setupEventListeners() {
        // Navigation buttons
        document.getElementById('back-btn').addEventListener('click', () => this.goBack());
        document.getElementById('forward-btn').addEventListener('click', () => this.goForward());
        document.getElementById('reload-btn').addEventListener('click', () => this.reload());
        document.getElementById('home-btn').addEventListener('click', () => this.goHome());
        document.getElementById('new-tab-btn').addEventListener('click', () => this.createTab());

        // Address bar
        const addressBar = document.getElementById('address-bar');
        addressBar.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.navigate(addressBar.value);
            }
        });

        // Welcome search
        const welcomeSearch = document.getElementById('welcome-search');
        welcomeSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.navigate(welcomeSearch.value);
            }
        });

        // Picture-in-Picture button
        const pipBtn = document.getElementById('pip-btn');
        if (pipBtn) pipBtn.addEventListener('click', () => this.triggerPiP());

        // Menu button
        document.getElementById('menu-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMainMenu();
        });

        // Close menu on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#menu-btn') && !e.target.closest('.main-menu')) {
                this.hideMainMenu();
            }
        });

        // Main menu actions
        document.querySelectorAll('#main-menu .menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.getAttribute('data-action');
                this.handleMenuAction(action);
                this.hideMainMenu();
            });
        });

        // Settings panel
        this.setupSettingsPanel();

        // New-tab page (greeting, date, app shortcuts) + theme toggle
        this.setupNewTabPage();
        this.setupThemeToggle();
    }

    setupNewTabPage() {
        // Time-based greeting + formatted date
        const greetingEl = document.getElementById('nt-greeting');
        const dateEl = document.getElementById('nt-date');
        if (greetingEl && dateEl) {
            const now = new Date();
            const h = now.getHours();
            const greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
            greetingEl.textContent = greeting;
            const dateStr = now.toLocaleDateString(undefined, {
                weekday: 'long', month: 'long', day: 'numeric'
            });
            dateEl.textContent = `${dateStr} · QuantumX`;
        }

        // App shortcut tiles → navigate
        document.querySelectorAll('.nt-tile[data-url]').forEach(tile => {
            tile.addEventListener('click', () => {
                const url = tile.getAttribute('data-url');
                if (url) this.navigate(url);
            });
        });

        // "Add" tile → focus the address bar
        const addTile = document.getElementById('nt-tile-add');
        if (addTile) {
            addTile.addEventListener('click', () => {
                const addr = document.getElementById('address-bar');
                if (addr) { addr.focus(); addr.select(); }
            });
        }
    }

    setupThemeToggle() {
        const btn = document.getElementById('theme-toggle-btn');
        if (!btn) return;
        const darkIcon = btn.querySelector('.theme-icon-dark');
        const lightIcon = btn.querySelector('.theme-icon-light');

        const apply = (theme) => {
            const light = theme === 'light';
            document.body.classList.toggle('light-theme', light);
            if (darkIcon) darkIcon.style.display = light ? 'none' : '';
            if (lightIcon) lightIcon.style.display = light ? '' : 'none';
            // Make web page content (prefers-color-scheme) follow the theme too
            if (window.electronAPI?.setNativeTheme) window.electronAPI.setNativeTheme(theme);
        };

        // Restore saved preference (default dark)
        apply(localStorage.getItem('quantumx_theme') || 'dark');

        btn.addEventListener('click', () => {
            const next = document.body.classList.contains('light-theme') ? 'dark' : 'light';
            localStorage.setItem('quantumx_theme', next);
            apply(next);
        });
    }

    createTab(url = '') {
        this.tabCounter++;
        const tabId = `tab-${this.tabCounter}`;

        const tab = {
            id: tabId,
            url: url || '',
            title: 'New Tab',
            type: 'web',
            embedHwnd: null,
            webview: null
        };

        this.tabs.push(tab);
        this.renderTab(tab);
        this.createWebview(tab);
        this.switchTab(tabId);
    }

    createEmbedTab(hwnd, title = 'App', exePath = '') {
        this.tabCounter++;
        const tabId = `tab-${this.tabCounter}`;

        const tab = {
            id: tabId,
            url: '',
            title,
            type: 'embed',
            embedHwnd: hwnd,
            exePath,
            embedIcon: null,
            heartbeatInterval: null,
            webview: null
        };

        this.tabs.push(tab);

        // Load app icon asynchronously and update tab favicon
        if (exePath && window.electronAPI?.getWindowIcon) {
            window.electronAPI.getWindowIcon({ exePath }).then(dataUrl => {
                if (!dataUrl) return;
                tab.embedIcon = dataUrl;
                const faviconEl = document.querySelector(`#tab-element-${tabId} .tab-favicon`);
                if (faviconEl) faviconEl.innerHTML = `<img src="${dataUrl}" style="width:16px;height:16px;object-fit:contain;border-radius:3px">`;
                // Update toolbar if this tab is currently active
                if (this.activeTabId === tabId) this._updateEmbedToolbar(tab);
            }).catch(() => {});
        }

        // Render tab element with embed icon
        const tabsContainer = document.getElementById('tabs-container');
        const tabElement = document.createElement('div');
        tabElement.className = 'tab';
        tabElement.id = `tab-element-${tabId}`;
        tabElement.setAttribute('data-tab-type', 'embed');
        tabElement.innerHTML = `
            <div class="tab-favicon">⊞</div>
            <span class="tab-title">${title}</span>
            <button class="tab-close" data-tab-id="${tabId}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        `;
        tabElement.addEventListener('click', (e) => {
            if (!e.target.closest('.tab-close')) this.switchTab(tabId);
        });
        tabElement.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(tabId);
        });
        tabsContainer.appendChild(tabElement);

        // Placeholder div (keeps layout consistent when embed is shown/hidden)
        const container = document.getElementById('webview-container');
        const placeholder = document.createElement('div');
        placeholder.id = `webview-${tabId}`;
        placeholder.className = 'embed-placeholder';
        placeholder.innerHTML = `<span>⊞</span><span>${title} is embedded below</span>`;
        container.appendChild(placeholder);

        this._startEmbedHeartbeat(tabId);
        this.switchTab(tabId);
    }

    renderTab(tab) {
        const tabsContainer = document.getElementById('tabs-container');
        const tabElement = document.createElement('div');
        tabElement.className = 'tab';
        tabElement.id = `tab-element-${tab.id}`;
        tabElement.innerHTML = `
            <div class="tab-favicon">🌐</div>
            <span class="tab-title">${tab.title}</span>
            <button class="tab-close" data-tab-id="${tab.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        `;

        tabElement.addEventListener('click', (e) => {
            if (!e.target.closest('.tab-close')) {
                this.switchTab(tab.id);
            }
        });

        tabElement.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(tab.id);
        });

        tabsContainer.appendChild(tabElement);
    }

    createWebview(tab) {
        // Web tabs are hosted as main-process WebContentsViews. Create the view
        // and attach a thin shim so existing injection / find / zoom / print code
        // keeps working by routing through IPC.
        const url = tab.url ? this.formatUrl(tab.url) : '';
        window.electronAPI.tab.create(tab.id, url);
        tab.webview = this._makeTabShim(tab.id);
    }

    // webview-compatible facade over the main-process WebContentsView (via IPC).
    _makeTabShim(id) {
        const api = window.electronAPI.tab;
        return {
            id,
            isShim: true,
            executeJavaScript: (code) => api.exec(id, code),
            getURL: () => api.getURL(id),
            reload: () => api.reload(id),
            stop: () => api.stop(id),
            print: () => api.print(id),
            openDevTools: () => api.devtools(id),
            findInPage: (text, opts) => api.find(id, text, opts),
            stopFindInPage: () => api.stopFind(id),
            setZoomFactor: (f) => api.zoom(id, f)
        };
    }

    // Single dispatcher for page events forwarded from the main process. Replaces
    // the per-<webview> event listeners that used to live in createWebview.
    _setupTabEvents() {
        if (this._tabEventsWired || !window.electronAPI?.tab?.onEvent) return;
        this._tabEventsWired = true;
        window.electronAPI.tab.onEvent((msg) => {
            const id = msg.id;
            switch (msg.type) {
                case 'did-start-loading': this.updateLoadingState(id, true); break;
                case 'did-stop-loading':  this.updateLoadingState(id, false); break;
                case 'page-title-updated': {
                    this.updateTabTitle(id, msg.title);
                    const tab = this.tabs.find(t => t.id === id);
                    if (window.historyManager && tab?.url) window.historyManager.addEntry(tab.url, msg.title);
                    break;
                }
                case 'did-navigate': {
                    this.updateTabUrl(id, msg.url);
                    const tab = this.tabs.find(t => t.id === id);
                    if (window.historyManager) window.historyManager.addEntry(msg.url, tab?.title || 'Untitled');
                    break;
                }
                case 'did-navigate-in-page':
                    this.updateTabUrl(id, msg.url);
                    setTimeout(() => this._injectAll(id), 500);
                    break;
                case 'page-favicon-updated':
                    if (msg.favicons && msg.favicons.length) this.updateTabFavicon(id, msg.favicons[0]);
                    break;
                case 'open-url':
                    this.createTab(msg.url);
                    break;
                case 'dom-ready':
                    this._injectAll(id);
                    break;
                case 'found-in-page':
                    if (window.findManager && msg.result) window.findManager.updateResults(msg.result);
                    break;
            }
        });
    }

    // Run all page injections for a web tab (mirrors the old dom-ready handler).
    _injectAll(id) {
        if (window.electronAPI?.flags?.noInject) return;  // dev bisect switch
        const tab = this.tabs.find(t => t.id === id);
        if (!tab || tab.type !== 'web' || !tab.webview) return;
        this.injectChromeFingerprint(tab.webview);
        // YouTube ad-blocking now runs entirely in page-preload.js at document-start
        // (API ad-strip + IMA stub + cosmetic/skip) — no dom-ready injection needed.
        this.injectYouTubeDownloader(tab.webview, id, tab.url);
        if (localStorage.getItem('proton_grammar_enabled') === 'true') {
            this.injectGrammarAssistant(tab.webview);
        }
    }

    // Poll the active web tab for messages the injected scripts leave in
    // sessionStorage (YouTube info/download, open-folder, grammar). Replaces the
    // per-<webview> interval; one loop targets whichever web tab is active.
    _startBridgePoll() {
        if (this._bridgePollStarted) return;
        if (window.electronAPI?.flags?.noInject) return;  // dev bisect switch
        this._bridgePollStarted = true;
        const self = this;
        setInterval(async () => {
            const tab = self.tabs.find(t => t.id === self.activeTabId);
            if (!tab || tab.type !== 'web' || !tab.webview) return;
            let msg;
            try {
                msg = await tab.webview.executeJavaScript(`
                    (function() {
                        const infoReq = sessionStorage.getItem('proton_info_request');
                        const dlReq = sessionStorage.getItem('proton_download_request');
                        const openFolder = sessionStorage.getItem('proton_open_folder');
                        const grammarReq = sessionStorage.getItem('proton_grammar_request');
                        if (infoReq) { sessionStorage.removeItem('proton_info_request'); return { type: 'info', data: JSON.parse(infoReq) }; }
                        if (dlReq) { sessionStorage.removeItem('proton_download_request'); return { type: 'download', data: JSON.parse(dlReq) }; }
                        if (openFolder) { sessionStorage.removeItem('proton_open_folder'); return { type: 'openFolder', path: openFolder }; }
                        if (grammarReq) { sessionStorage.removeItem('proton_grammar_request'); return { type: 'grammar', data: JSON.parse(grammarReq) }; }
                        return null;
                    })();
                `);
            } catch (e) { return; }
            if (!msg) return;

            if (msg.type === 'info') {
                try {
                    const info = await window.electronAPI.getYouTubeInfo(msg.data.url);
                    const infoJson = JSON.stringify(info).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
                    tab.webview.executeJavaScript(`(function(){ sessionStorage.setItem('proton_info_response', \`${infoJson}\`); })();`).catch(() => {});
                } catch (err) {
                    const errJson = JSON.stringify({ success: false, error: err.message });
                    tab.webview.executeJavaScript(`sessionStorage.setItem('proton_info_response', '${errJson.replace(/'/g, "\\'")}');`).catch(() => {});
                }
            } else if (msg.type === 'download') {
                self.handleYouTubeDownloadFromPage(msg.data);
            } else if (msg.type === 'openFolder') {
                if (window.electronAPI && window.electronAPI.openDownloadsFolder) window.electronAPI.openDownloadsFolder();
            } else if (msg.type === 'grammar') {
                self.handleGrammarRequest(tab.webview, msg.data);
            }
        }, 400);
    }

    // Report layout to main: the content-top offset (tab-strip + navbar, +embed
    // toolbar) and whether an overlay is open. Main sizes the chrome view
    // (collapsed vs expanded) and the active tab view from these values, so we
    // don't measure the (possibly clipped) container here.
    _pushLayout() {
        if (!window.electronAPI?.ui) return;
        const activeTab = this.tabs.find(t => t.id === this.activeTabId);
        const embedActive = activeTab && activeTab.type === 'embed';
        const blankWeb = activeTab && activeTab.type === 'web' && !activeTab.url;
        const contentTop = embedActive ? 136 : 98;
        // Embed tabs keep the chrome expanded so #webview-container measures full
        // size (the native embedded window is positioned from it) and the embed
        // toolbar is visible; the native child window renders on top regardless.
        const expanded = !activeTab || blankWeb || embedActive || this._anyOverlayOpen();
        window.electronAPI.ui.layout({ contentTop, expanded });
    }

    _anyOverlayOpen() {
        const shown = (el) => {
            if (!el || el.classList.contains('hidden')) return false;
            return getComputedStyle(el).display !== 'none';
        };
        const displayIds = ['main-menu', 'settings-panel', 'vpn-panel', 'lan-panel',
            'bookmarks-panel', 'downloads-panel', 'history-panel', 'find-bar', 'zoom-controls',
            'youtube-modal', 'torrent-modal', 'shortcuts-panel'];
        if (displayIds.some(id => shown(document.getElementById(id)))) return true;
        // .open-class overlays
        if (['window-picker-modal', 'launch-loader'].some(id => {
            const el = document.getElementById(id); return el && el.classList.contains('open');
        })) return true;
        // update notification (visible unless .hidden)
        const upd = document.getElementById('update-notification');
        if (upd && !upd.classList.contains('hidden') && getComputedStyle(upd).display !== 'none') return true;
        // dynamically-created toasts
        if (document.querySelector('.grammar-toast, .qx-toast, .toast, .notification-toast')) return true;
        return false;
    }

    // Watch overlay elements so the chrome view expands the instant one opens and
    // collapses when the last one closes (no per-call-site hooks needed).
    _watchOverlays() {
        if (this._overlaysWatched) return;
        this._overlaysWatched = true;
        const push = () => this._pushLayout();
        const mo = new MutationObserver(push);
        const ids = ['main-menu', 'settings-panel', 'vpn-panel', 'lan-panel', 'bookmarks-panel',
            'downloads-panel', 'history-panel', 'find-bar', 'zoom-controls', 'youtube-modal',
            'torrent-modal', 'shortcuts-panel', 'window-picker-modal', 'launch-loader',
            'welcome-screen', 'update-notification', 'embed-toolbar'];
        ids.forEach(id => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] }); });
        if (document.body) mo.observe(document.body, { childList: true });
        window.addEventListener('resize', push);
    }

    async handleGrammarRequest(webview, data) {
        try {
            if (!window.electronAPI || !window.electronAPI.checkGrammar) return;
            if (!data || !data.text || String(data.text).trim().length < 3) return;

            const inputId = data.inputId || '';
            const result = await window.electronAPI.checkGrammar(String(data.text), 'en-US');
            const matches = (result && result.success ? (result.matches || []) : []).map((m) => ({
                offset: m.offset,
                length: m.length,
                message: m.message,
                category: m.category,
                replacements: (m.replacements || []).map((r) => (r && r.value ? r.value : String(r || ''))).filter(Boolean),
                context: m.context || null,
                inputId
            }));

            const payload = JSON.stringify({ matches });
            const b64 = btoa(unescape(encodeURIComponent(payload)));
            const inputIdSafe = JSON.stringify(inputId);
            const script = `
                (function() {
                    try {
                        var d = JSON.parse(decodeURIComponent(escape(atob('${b64}'))));
                        if (window.__protonGrammarResult) {
                            window.__protonGrammarResult(d, ${inputIdSafe});
                        }
                    } catch (e) {}
                })();
            `;
            webview.executeJavaScript(script).catch(() => {});
        } catch (e) {
            // keep silent to avoid noisy UX
        }
    }

    injectGrammarAssistant(webview) {
        const script = `
(function () {
    if (window.__proton_grammar_v8__) return;
    window.__proton_grammar_v8__ = true;

    // ─────────────────────────────────────────────────────────────────────────
    // STATE  (v8 — universal, stealth, works on any website)
    // ─────────────────────────────────────────────────────────────────────────
    const errorMap   = new Map();    // pgid → Match[]
    const ignoreSet  = new Set();    // "wrong:category" permanent-ignore keys
    const mirrorMap  = new Map();    // pgid → {wrapper, mirror}
    const badgeMap   = new Map();    // pgid → badge DOM element
    const pgidMap    = new Map();    // pgid → element  (STEALTH: no data-* attrs)
    const elMap      = new WeakMap();// element → pgid  (STEALTH: no data-* attrs)
    const rewriteCtx = new Map();    // pgid → {text, offset, selEnd}
    let   activePopup  = null;
    let   rewriteBtn   = null;
    let   checkTimer   = null;
    let   recheckTimer = null;
    let   grammarActive = true;   // toggled via __proton_grammar_disable / enable

    // Helper: look up element by pgid — NO querySelector needed (stealth)
    function getEl(pgid) { return pgidMap.get(pgid) || null; }

    // ── Disable / re-enable from settings toggle ───────────────────────────
    window.__proton_grammar_disable = function () {
        grammarActive = false;
        // Remove all mirror overlays
        mirrorMap.forEach(({wrapper}) => { try { wrapper.remove(); } catch(e){} });
        mirrorMap.clear();
        // Remove all error-count badges
        badgeMap.forEach(b => { try { b.remove(); } catch(e){} });
        badgeMap.clear();
        errorMap.clear();
        pgidMap.clear();
        // Remove contenteditable highlight spans — restore plain text
        document.querySelectorAll('.__pg8hl__').forEach(sp => {
            try {
                const t = document.createTextNode(sp.textContent);
                sp.parentNode.replaceChild(t, sp);
            } catch(e){}
        });
        // Close popup / rewrite panel
        if (activePopup) { try { activePopup.remove(); } catch(e){} activePopup = null; }
        document.querySelectorAll('#__pg8popup__,#__pg8rewrite__,.__pg8badge__').forEach(el => {
            try { el.remove(); } catch(e){}
        });
        // Allow re-injection later
        window.__proton_grammar_v8__ = false;
        console.log('%c✍️ Grammar Assistant — disabled', 'color:#ef4444;font-weight:600');
    };

    window.__proton_grammar_enable = function () {
        grammarActive = true;
        try { scan(document); } catch(e){}
        console.log('%c✍️ Grammar Assistant — enabled', 'color:#a855f7;font-weight:600');
    };

    // ─────────────────────────────────────────────────────────────────────────
    // CATEGORY CONFIG
    // ─────────────────────────────────────────────────────────────────────────
    const C = {
        spelling:    { color:'#ef4444', bg:'rgba(239,68,68,.15)',   label:'Spelling'    },
        grammar:     { color:'#f59e0b', bg:'rgba(245,158,11,.15)',  label:'Grammar'     },
        style:       { color:'#3b82f6', bg:'rgba(59,130,246,.15)',  label:'Style'       },
        punctuation: { color:'#a855f7', bg:'rgba(168,85,247,.15)',  label:'Punctuation' }
    };
    const getC = m => C[m.category] || C.grammar;

    // ─────────────────────────────────────────────────────────────────────────
    // ONE-TIME CSS
    // ─────────────────────────────────────────────────────────────────────────
    (function injectCSS() {
        const id = '__pg8css__';
        if (document.getElementById(id)) return;
        const s = document.createElement('style'); s.id = id;
        s.textContent = [
            '[data-pg8err]{cursor:pointer;border-radius:2px;text-decoration:underline wavy;text-underline-offset:3px;transition:background .15s}',
            '[data-pg8err="spelling"]{text-decoration-color:#ef4444}',
            '[data-pg8err="grammar"]{text-decoration-color:#f59e0b}',
            '[data-pg8err="style"]{text-decoration-color:#3b82f6}',
            '[data-pg8err="punctuation"]{text-decoration-color:#a855f7}',
            '[data-pg8err]:hover{background:rgba(251,191,36,.13)}',
            '@keyframes pg8in{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}',
            '@keyframes pg8tst{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}',
            '@keyframes pg8bdg{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}',
            '.pg8btn{border:none;border-radius:8px;padding:6px 14px;font:700 13px/1.4 inherit;cursor:pointer;transition:filter .15s,transform .1s;white-space:nowrap}',
            '.pg8btn:hover{filter:brightness(1.15);transform:translateY(-1px)}',
            '.pg8btn:active{transform:translateY(0)}',
        ].join('');
        (document.head || document.documentElement).appendChild(s);
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // TOAST  (with optional undo button)
    // ─────────────────────────────────────────────────────────────────────────
    function toast(msg, color, undoFn) {
        document.querySelectorAll('[data-pg8toast]').forEach(t => t.remove());
        const wrap = document.createElement('div');
        wrap.dataset.pg8toast = '1';
        Object.assign(wrap.style, {
            position:'fixed', bottom:'28px', left:'50%',
            transform:'translateX(-50%)', zIndex:'2147483647',
            background:'#0c0a09', border:'1px solid '+color+'60',
            borderRadius:'12px', padding:'8px 18px',
            font:'700 13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            color, boxShadow:'0 6px 28px rgba(0,0,0,.8)',
            display:'flex', alignItems:'center', gap:'12px',
            whiteSpace:'nowrap', animation:'pg8tst .2s ease',
        });
        const msgEl = document.createElement('span');
        msgEl.textContent = msg;
        wrap.appendChild(msgEl);
        if (typeof undoFn === 'function') {
            const u = document.createElement('button');
            u.textContent = 'Undo';
            Object.assign(u.style, { background:'rgba(255,255,255,.15)', border:'none', borderRadius:'6px', padding:'3px 10px', color:'#fff', cursor:'pointer', font:'600 11px/1.4 inherit' });
            u.addEventListener('click', () => { undoFn(); wrap.remove(); });
            wrap.appendChild(u);
        }
        document.body.appendChild(wrap);
        setTimeout(() => wrap.remove(), undoFn ? 6000 : 2500);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ERROR BADGE  — floating count near top-right of each monitored input
    // ─────────────────────────────────────────────────────────────────────────
    function updateBadge(el, pgid, count) {
        let badge = badgeMap.get(pgid);
        if (count === 0) { if (badge) { badge.remove(); badgeMap.delete(pgid); } return; }
        if (!badge) {
            badge = document.createElement('div');
            badge.dataset.pg8badge = pgid;
            Object.assign(badge.style, {
                position:'fixed', zIndex:'2147483646', minWidth:'18px', height:'18px',
                borderRadius:'9px', padding:'0 5px', fontSize:'10px', fontWeight:'800',
                color:'#fff', textAlign:'center', lineHeight:'18px',
                cursor:'pointer', pointerEvents:'auto',
                fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
                boxShadow:'0 2px 8px rgba(0,0,0,.5)',
            });
            badge.title = 'Click to see writing issues';
            badge.addEventListener('click', () => {
                const m = (errorMap.get(pgid) || []);
                const first = m.find(x => x.replacements && x.replacements.length > 0) || m[0];
                if (!first) return;
                const isTA = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
                const xy = isTA ? caretXY(el, first.offset) : { x: el.getBoundingClientRect().left, y: el.getBoundingClientRect().bottom + 4 };
                showPopup(xy.x, xy.y, first, pgid);
            });
            document.body.appendChild(badge);
            badgeMap.set(pgid, badge);
        }
        const r = el.getBoundingClientRect();
        badge.style.left       = (r.right - 22) + 'px';
        badge.style.top        = (r.top   + 3)  + 'px';
        badge.style.background = count >= 5 ? '#ef4444' : '#f59e0b';
        badge.textContent      = count > 9 ? '9+' : String(count);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLOSE POPUP
    // ─────────────────────────────────────────────────────────────────────────
    function closePopup() {
        if (activePopup) { try { activePopup.remove(); } catch(e){} activePopup = null; }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CARET PIXEL POSITION (textarea / input)
    // Returns {x, y} in viewport coords of the caret at char-index \`pos\`
    // ─────────────────────────────────────────────────────────────────────────
    function caretXY(el, pos) {
        try {
            const cs = window.getComputedStyle(el);
            const clone = document.createElement('div');
            const PROPS = ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight',
                           'letterSpacing','wordSpacing','textTransform','textIndent',
                           'paddingTop','paddingRight','paddingBottom','paddingLeft',
                           'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
                           'boxSizing','tabSize','whiteSpace','wordWrap','wordBreak'];
            PROPS.forEach(p => { clone.style[p] = cs[p]; });
            clone.style.position = 'absolute';
            clone.style.visibility = 'hidden';
            clone.style.top = '-9999px';
            clone.style.left = '-9999px';
            clone.style.width = el.clientWidth + 'px';
            clone.style.overflow = 'hidden';

            // text before caret
            const pre = document.createTextNode(el.value.slice(0, pos));
            clone.appendChild(pre);

            // marker span at caret
            const marker = document.createElement('span');
            marker.textContent = el.value[pos] || '|';
            clone.appendChild(marker);

            document.body.appendChild(clone);
            const elR = el.getBoundingClientRect();
            const lh  = parseFloat(cs.lineHeight) || 20;
            const x   = elR.left + marker.offsetLeft;
            const y   = elR.top  + marker.offsetTop  - el.scrollTop + lh;
            document.body.removeChild(clone);
            return { x: Math.min(x, window.innerWidth - 360), y: Math.min(y, window.innerHeight - 260) };
        } catch(e) {
            const r = el.getBoundingClientRect();
            return { x: r.left, y: r.bottom + 4 };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SHOW POPUP  (builds entire DOM, no innerHTML for interactive parts)
    // ─────────────────────────────────────────────────────────────────────────
    function showPopup(x, y, match, pgid) {
        closePopup();
        const fixes = (match.replacements || []).slice(0, 6);
        const c     = getC(match);
        const wrong = match._wrong || '';

        // ── container ────────────────────────────────────────────────────────
        const popup = document.createElement('div');
        popup.dataset.pg8popup = '1';
        Object.assign(popup.style, {
            position:'fixed', zIndex:'2147483647',
            left: Math.max(8, Math.min(x, window.innerWidth - 370)) + 'px',
            top:  Math.max(8, Math.min(y, window.innerHeight - 260)) + 'px',
            background:'#0d0b0a',
            border:'1px solid ' + c.color + '50',
            borderRadius:'16px',
            boxShadow:'0 24px 72px rgba(0,0,0,.92),0 0 0 1px rgba(255,255,255,.04)',
            fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            minWidth:'270px', maxWidth:'380px',
            overflow:'hidden',
            animation:'pg8in .2s cubic-bezier(.175,.885,.32,1.275)',
        });

        // ── header row ───────────────────────────────────────────────────────
        const hdr = document.createElement('div');
        Object.assign(hdr.style, {
            display:'flex', alignItems:'center', gap:'8px',
            padding:'11px 14px 9px',
            borderBottom:'1px solid rgba(255,255,255,.06)',
            background:'rgba(255,255,255,.025)',
        });

        const dot = document.createElement('span');
        Object.assign(dot.style, {
            width:'9px', height:'9px', borderRadius:'50%',
            background:c.color, flexShrink:'0',
            boxShadow:'0 0 6px '+c.color
        });

        const labelEl = document.createElement('span');
        Object.assign(labelEl.style, {
            fontSize:'10px', fontWeight:'800',
            color:c.color, textTransform:'uppercase', letterSpacing:'1px'
        });
        labelEl.textContent = c.label;

        hdr.appendChild(dot);
        hdr.appendChild(labelEl);

        if (wrong) {
            const wEl = document.createElement('span');
            Object.assign(wEl.style, {
                background:c.bg, color:c.color,
                padding:'2px 8px', borderRadius:'5px',
                fontSize:'12px', fontWeight:'700',
                textDecoration:'line-through', marginLeft:'auto'
            });
            wEl.textContent = wrong;
            hdr.appendChild(wEl);
        }

        const closeBtn = document.createElement('button');
        Object.assign(closeBtn.style, {
            marginLeft: wrong ? '6px' : 'auto',
            background:'none', border:'none',
            color:'#78716c', cursor:'pointer',
            fontSize:'16px', padding:'0 2px', lineHeight:'1',
        });
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('mousedown', e => e.preventDefault());
        closeBtn.addEventListener('click', closePopup);
        hdr.appendChild(closeBtn);

        popup.appendChild(hdr);

        // ── body ─────────────────────────────────────────────────────────────
        const body = document.createElement('div');
        body.style.padding = '10px 14px 12px';

        if (match.message) {
            const msgEl = document.createElement('div');
            Object.assign(msgEl.style, {
                fontSize:'12px', color:'#a8a29e',
                lineHeight:'1.55', marginBottom:'10px'
            });
            msgEl.textContent = match.message;
            body.appendChild(msgEl);
        }

        // ── suggestion buttons ────────────────────────────────────────────────
        const btnRow = document.createElement('div');
        Object.assign(btnRow.style, {
            display:'flex', flexWrap:'wrap', gap:'7px', marginBottom: fixes.length ? '10px' : '0'
        });

        // Count same wrong word for "Fix all"
        const sameCount = wrong ? (errorMap.get(pgid)||[]).filter(m => (m._wrong||'') === wrong).length : 0;

        fixes.forEach((fix, i) => {
            const btn = document.createElement('button');
            btn.className = 'pg8btn';
            Object.assign(btn.style, {
                background: i === 0 ? c.color : 'rgba(255,255,255,.08)',
                color:      i === 0 ? '#0a0807' : '#e7e5e0',
                boxShadow:  i === 0 ? '0 2px 10px '+c.color+'50' : 'none',
            });
            btn.textContent = fix;
            btn.addEventListener('mousedown', e => e.preventDefault());
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                const _el0 = getEl(pgid);
                const prevText = _el0 ? (_el0.value !== undefined ? _el0.value : (_el0.innerText||'')) : '';
                closePopup();
                const el = getEl(pgid);
                if (!el) return;
                applyFix(el, match, fix, pgid);
                toast('\u2713 Applied: ' + fix, c.color, () => undoFix(el, pgid, prevText));
            });
            btnRow.appendChild(btn);
        });

        // Fix-all button
        if (sameCount > 1 && fixes.length > 0) {
            const faBtn = document.createElement('button');
            faBtn.className = 'pg8btn';
            Object.assign(faBtn.style, { background:'rgba(255,255,255,.06)', color:'#a8a29e', border:'1px solid rgba(255,255,255,.12)' });
            faBtn.textContent = 'Fix all ' + sameCount + ' \u201c' + wrong + '\u201d';
            faBtn.addEventListener('mousedown', e => e.preventDefault());
            faBtn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                closePopup();
                const el = getEl(pgid);
                if (el) { applyFixAll(el, pgid, wrong, fixes[0]); toast('\u2713 Fixed all \u201c' + wrong + '\u201d \u2192 \u201c' + fixes[0] + '\u201d', c.color); }
            });
            btnRow.appendChild(faBtn);
        }

        if (!fixes.length) {
            const noFix = document.createElement('span');
            noFix.style.cssText = 'font:italic 12px/1.4 inherit;color:#57534e;';
            noFix.textContent = 'No suggestions available for this error.';
            btnRow.appendChild(noFix);
        }
        body.appendChild(btnRow);

        // ── bottom row: ignore + keyboard hint ───────────────────────────────
        const footer = document.createElement('div');
        Object.assign(footer.style, { display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:'6px' });

        const ignoreBtn = document.createElement('button');
        Object.assign(ignoreBtn.style, { background:'none', border:'1px solid rgba(255,255,255,.1)', borderRadius:'7px', padding:'4px 11px', fontSize:'11px', color:'#78716c', cursor:'pointer', fontFamily:'inherit' });
        ignoreBtn.textContent = '\uD83D\uDC41 Ignore';
        ignoreBtn.addEventListener('mousedown', e => e.preventDefault());
        ignoreBtn.addEventListener('click', () => {
            const key = (wrong||'') + ':' + match.category;
            ignoreSet.add(key);
            const list = (errorMap.get(pgid)||[]).filter(m => ((m._wrong||'')+':'+m.category) !== key);
            errorMap.set(pgid, list);
            const el = getEl(pgid);
            if (el) { rerenderHL(el, pgid, list); updateBadge(el, pgid, list.length); }
            closePopup();
        });
        footer.appendChild(ignoreBtn);

        const hint = document.createElement('span');
        Object.assign(hint.style, { fontSize:'10px', color:'#57534e' });
        hint.textContent = fixes.length ? 'Tab \u2192 accept  \u00B7  Esc \u2192 close' : 'Esc to close';
        footer.appendChild(hint);
        body.appendChild(footer);

        popup.appendChild(body);
        document.body.appendChild(popup);
        activePopup = popup;

        // ── keyboard: Tab = accept first, Esc = close ─────────────────────────
        function onKey(e) {
            if (e.key === 'Escape') { closePopup(); document.removeEventListener('keydown', onKey, true); }
            if (e.key === 'Tab' && fixes.length) {
                e.preventDefault();
                document.removeEventListener('keydown', onKey, true);
                const _el1 = getEl(pgid);
                const prevText2 = _el1 ? (_el1.value !== undefined ? _el1.value : (_el1.innerText||'')) : '';
                closePopup();
                const el = getEl(pgid);
                if (el) { applyFix(el, match, fixes[0], pgid); toast('\u2713 ' + fixes[0], c.color, () => undoFix(el, pgid, prevText2)); }
            }
        }
        document.addEventListener('keydown', onKey, true);

        setTimeout(() => {
            function outside(e) {
                if (!popup.contains(e.target)) { closePopup(); document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', onKey, true); }
            }
            document.addEventListener('mousedown', outside);
        }, 80);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RE-RENDER HIGHLIGHTS  (mirror OR CE spans)
    // ─────────────────────────────────────────────────────────────────────────
    function rerenderHL(el, pgid, matches) {
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            renderMirror(el, pgid, matches);
        } else if (el.isContentEditable || el.getAttribute('contenteditable') !== null) {
            renderCEHL(el, pgid, matches);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OFFSET RESOLVER  (handles stale offsets after user edits)
    // ─────────────────────────────────────────────────────────────────────────
    function resolveOffset(text, match) {
        const off = Math.max(0, Number(match.offset || 0));
        const len = Math.max(0, Number(match.length || 0));
        if (off + len <= text.length && text.slice(off, off + len).trim())
            return { offset: off, length: len };
        const w = match._wrong || '';
        if (w) {
            const lo = Math.max(0, off - 400), hi = Math.min(text.length, off + 400);
            const near = text.slice(lo, hi);
            const ni = near.toLowerCase().indexOf(w.toLowerCase());
            if (ni !== -1) return { offset: lo + ni, length: w.length };
            const gi = text.toLowerCase().indexOf(w.toLowerCase());
            if (gi !== -1) return { offset: gi, length: w.length };
        }
        const safeOff = Math.min(off, text.length);
        return { offset: safeOff, length: Math.min(len, text.length - safeOff) };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SHIFT ERROR MAP after applying a fix
    // ─────────────────────────────────────────────────────────────────────────
    function shiftMap(pgid, match, fixStr) {
        const delta = fixStr.length - Number(match.length || 0);
        const updated = (errorMap.get(pgid) || [])
            .filter(m => !(m.offset === match.offset && m.length === match.length))
            .map(m => m.offset > match.offset ? Object.assign({}, m, { offset: m.offset + delta }) : m);
        errorMap.set(pgid, updated);
        return updated;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UNDO  — restore previous full text value
    // ─────────────────────────────────────────────────────────────────────────
    function undoFix(el, pgid, prevText) {
        if (!el) return;
        if (el.value !== undefined) {
            try {
                const P = (el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement).prototype;
                const d = Object.getOwnPropertyDescriptor(P, 'value');
                if (d && d.set) d.set.call(el, prevText); else el.value = prevText;
            } catch(e) { el.value = prevText; }
            ['input','change'].forEach(t => el.dispatchEvent(new InputEvent(t, { bubbles:true })));
        } else {
            el.focus();
            document.execCommand('selectAll');
            document.execCommand('insertText', false, prevText);
        }
        scheduleRecheck(el, pgid);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FIX ALL  — replace every instance of the same wrong word in one shot
    // ─────────────────────────────────────────────────────────────────────────
    function applyFixAll(el, pgid, wrongWord, fix) {
        if (!wrongWord || !fix || !el) return;
        // Sort back-to-front so offsets remain valid after each replacement
        const targets = (errorMap.get(pgid) || [])
            .filter(m => (m._wrong || '') === wrongWord)
            .sort((a, b) => b.offset - a.offset);
        targets.forEach(m => applyFix(el, m, fix, pgid));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AUTO-CORRECT  — silent fix for single-suggestion spelling on space/punc
    // ─────────────────────────────────────────────────────────────────────────
    function autoCorrect(el, pgid, key) {
        if (key !== ' ' && !'.!?,;:'.includes(key)) return;
        const matches = errorMap.get(pgid) || [];
        if (!matches.length) return;
        try {
            const v      = el.value || el.innerText || el.textContent || '';
            const cursor = typeof el.selectionStart === 'number' ? el.selectionStart : v.length;
            const before = v.slice(0, cursor - 1); // text before the trigger char
            const lw     = (before.match(/[a-zA-Z\u00C0-\u024F']+$/) || [''])[0];
            if (!lw || lw.length < 2) return;
            const wStart = cursor - 1 - lw.length;
            const hit = matches.find(m =>
                m.category === 'spelling' &&
                m.replacements && m.replacements.length === 1 &&
                (m._wrong || '').toLowerCase() === lw.toLowerCase() &&
                Math.abs(m.offset - wStart) <= 2
            );
            if (!hit) return;
            const fix      = hit.replacements[0];
            const prevText = el.value !== undefined ? el.value : (el.innerText || el.textContent || '');
            applyFix(el, hit, fix, pgid);
            toast('\u270E Auto: ' + lw + ' \u2192 ' + fix, '#f59e0b', () => undoFix(el, pgid, prevText));
        } catch(e) {}
    }

    // ─────────────────────────────────────────────────────────────────────────
    // APPLY FIX  — the core replacement engine
    // ─────────────────────────────────────────────────────────────────────────
    function applyFix(el, match, fix, pgid) {
        const f = String(fix || ''); if (!f || !el) return;

        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            // ── textarea / input ──────────────────────────────────────────────
            const v   = el.value || '';
            const pos = resolveOffset(v, match);
            const s   = pos.offset, e2 = pos.offset + pos.length;

            // Method 1: setRangeText — works WITHOUT requiring focus
            let done = false;
            try {
                if (typeof el.setRangeText === 'function') {
                    el.setRangeText(f, s, e2, 'end');
                    done = true;
                }
            } catch(err) {}

            // Method 2: native prototype setter (bypasses React etc.)
            if (!done) {
                const nv = v.slice(0, s) + f + v.slice(e2);
                try {
                    const P = (el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement).prototype;
                    const desc = Object.getOwnPropertyDescriptor(P, 'value');
                    if (desc && desc.set) { desc.set.call(el, nv); done = true; }
                } catch(err) {}
                if (!done) el.value = nv;
                try { el.setSelectionRange(s + f.length, s + f.length); } catch(err) {}
            }

            // Fire events so React/Vue/Angular pick up the change
            ['input','change'].forEach(t =>
                el.dispatchEvent(new InputEvent(t, { bubbles:true, cancelable:true, inputType:'insertText', data:f }))
            );

            const updated = shiftMap(pgid, match, f);
            renderMirror(el, pgid, updated);
            updateBadge(el, pgid, updated.length);
            scheduleRecheck(el, pgid);

        } else if (el.isContentEditable || el.getAttribute('contenteditable') !== null) {
            // ── contenteditable ───────────────────────────────────────────────
            const text = el.innerText || el.textContent || '';
            const pos  = resolveOffset(text, match);
            el.focus();

            // Walk text nodes to find the one containing offset
            const nodes = []; let tot = 0;
            (function walk(n) {
                if (n.nodeType === 3) {
                    nodes.push({ n, s:tot, e:tot + n.nodeValue.length });
                    tot += n.nodeValue.length;
                } else if (n.nodeType === 1 && n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE')
                    Array.from(n.childNodes).forEach(walk);
            })(el);

            let applied = false;
            for (const nd of nodes) {
                if (nd.e <= pos.offset || nd.s >= pos.offset + pos.length) continue;
                const ls = Math.max(0, pos.offset - nd.s);
                const le = Math.min(nd.n.nodeValue.length, pos.offset + pos.length - nd.s);
                if (ls >= le) continue;
                try {
                    const r = document.createRange();
                    r.setStart(nd.n, ls); r.setEnd(nd.n, le);
                    const sel = window.getSelection();
                    sel.removeAllRanges(); sel.addRange(r);
                    // execCommand is the most compatible for CE
                    applied = document.execCommand('insertText', false, f);
                    if (!applied) {
                        r.deleteContents();
                        r.insertNode(document.createTextNode(f));
                        el.normalize();
                    }
                } catch(err) {}
                break;
            }
            el.dispatchEvent(new InputEvent('input', { bubbles:true }));

            const updated = shiftMap(pgid, match, f);
            renderCEHL(el, pgid, updated);
            updateBadge(el, pgid, updated.length);
            scheduleRecheck(el, pgid);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SCHEDULE RE-CHECK  (debounced, 1.2 s after last fix)
    // ─────────────────────────────────────────────────────────────────────────
    function scheduleRecheck(el, pgid) {
        clearTimeout(recheckTimer);
        recheckTimer = setTimeout(() => {
            const text = String(el.value || el.innerText || el.textContent || '').trim();
            if (text.length < 3) return;
            try {
                sessionStorage.setItem('proton_grammar_request', JSON.stringify({
                    text: text.slice(0, 120000), inputId: pgid, timestamp: Date.now()
                }));
            } catch(e) {}
        }, 1200);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MIRROR DIV (textarea / input)
    // A hidden pixel-perfect clone sits behind the (now transparent) textarea
    // and shows color-coded highlight blocks where errors are.
    // ─────────────────────────────────────────────────────────────────────────
    const MIRROR_PROPS = ['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing',
        'wordSpacing','textTransform','textIndent','lineHeight','whiteSpace','wordWrap',
        'wordBreak','paddingTop','paddingRight','paddingBottom','paddingLeft',
        'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
        'boxSizing','tabSize'];

    function syncMirror(ta, mirror) {
        const cs = window.getComputedStyle(ta);
        MIRROR_PROPS.forEach(p => { mirror.style[p] = cs[p]; });
        mirror.style.width  = ta.offsetWidth  + 'px';
        mirror.style.height = ta.offsetHeight + 'px';
    }

    function buildMirrorDOM(text, matches) {
        const frag = document.createDocumentFragment();
        const sorted = [...matches].sort((a,b) => a.offset - b.offset);
        let pos = 0;
        for (const m of sorted) {
            if (m.offset < pos) continue;
            if (m.offset > pos) frag.appendChild(document.createTextNode(text.slice(pos, m.offset)));
            const c = getC(m);
            const mark = document.createElement('mark');
            mark.style.cssText = 'background:' + c.bg + ';border-bottom:2.5px solid ' + c.color + ';border-radius:2px;color:transparent;cursor:text;';
            mark.textContent = text.slice(m.offset, m.offset + m.length);
            frag.appendChild(mark);
            pos = m.offset + m.length;
        }
        if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
        return frag;
    }

    function renderMirror(ta, pgid, matches) {
        let info = mirrorMap.get(pgid);
        if (!info) {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'position:relative!important;display:inline-block!important;vertical-align:top!important;width:' + ta.offsetWidth + 'px!important;';
            ta.parentNode.insertBefore(wrapper, ta);
            wrapper.appendChild(ta);

            const mirror = document.createElement('div');
            mirror.dataset.pg8mirror = pgid;
            mirror.style.cssText = 'position:absolute!important;inset:0!important;pointer-events:none!important;overflow:hidden!important;z-index:0!important;background:transparent!important;';
            wrapper.insertBefore(mirror, ta);

            ta.style.setProperty('background', 'transparent', 'important');
            ta.style.setProperty('position',   'relative',    'important');
            ta.style.setProperty('z-index',    '1',           'important');
            ta.addEventListener('scroll', () => { mirror.scrollTop = ta.scrollTop; }, { passive:true });

            info = { wrapper, mirror };
            mirrorMap.set(pgid, info);
        }
        syncMirror(ta, info.mirror);
        info.mirror.textContent = '';
        info.mirror.appendChild(buildMirrorDOM(ta.value, matches));
        info.mirror.scrollTop = ta.scrollTop;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONTENTEDITABLE HIGHLIGHTS  (wavy-underline <span> wrapping)
    // ─────────────────────────────────────────────────────────────────────────
    function renderCEHL(el, pgid, matches) {
        // Remove old error spans (unwrap content back to plain text)
        el.querySelectorAll('[data-pg8err]').forEach(sp => {
            const p = sp.parentNode; if (!p) return;
            while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
            p.removeChild(sp);
        });
        el.normalize();
        if (!matches.length) return;

        // Build a fresh node list after normalisation
        const nodes = []; let tot = 0;
        (function walk(n) {
            if (n.nodeType === 3) { nodes.push({ n, s:tot, e:tot+n.nodeValue.length }); tot += n.nodeValue.length; }
            else if (n.nodeType === 1 && n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE' && !n.getAttribute('data-pg8err'))
                Array.from(n.childNodes).forEach(walk);
        })(el);

        // Process from end → start so offsets stay valid
        [...matches].sort((a,b) => b.offset - a.offset).forEach(m => {
            for (const nd of nodes) {
                if (nd.e <= m.offset || nd.s >= m.offset + m.length) continue;
                const ls = Math.max(0, m.offset - nd.s);
                const le = Math.min(nd.n.nodeValue.length, m.offset + m.length - nd.s);
                if (ls >= le) continue;
                try {
                    const range = document.createRange();
                    range.setStart(nd.n, ls); range.setEnd(nd.n, le);

                    // surroundContents only works when range is within one text node
                    const sp = document.createElement('span');
                    sp.dataset.pg8err  = m.category || 'grammar';
                    sp.dataset.pg8off  = m.offset;
                    sp.dataset.pg8len  = m.length;
                    sp.dataset.pg8pgid = pgid;
                    range.surroundContents(sp);

                    sp.addEventListener('click', ev => {
                        ev.stopPropagation();
                        const r = sp.getBoundingClientRect();
                        showPopup(r.left, r.bottom + 6, m, pgid);
                    });
                } catch(e) {}
                break;
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLICK HANDLER: show popup for word under caret (textarea / input)
    // ─────────────────────────────────────────────────────────────────────────
    function onCaret(el, pgid) {
        const matches = errorMap.get(pgid) || [];
        if (!matches.length) return;

        let cursor = 0;
        try { cursor = typeof el.selectionStart === 'number' ? el.selectionStart : 0; } catch(e){}

        // Primary: cursor falls inside an error range
        let hit = matches.find(m => m.replacements && m.replacements.length &&
                                     cursor >= m.offset && cursor <= m.offset + m.length);

        // Secondary: find the word at cursor, match by word text
        if (!hit) {
            const v = el.value || '';
            const lw = (v.slice(0, cursor).match(/[\\w\\u00C0-\\u024F']+$/) || [''])[0];
            const rw = (v.slice(cursor).match(/^[\\w\\u00C0-\\u024F']+/)    || [''])[0];
            const word = lw + rw;
            const wStart = cursor - lw.length;
            if (word) {
                hit = matches.find(m => m.replacements && m.replacements.length &&
                    (Math.abs(m.offset - wStart) <= 3 || (m._wrong || '').toLowerCase() === word.toLowerCase()));
                if (hit) hit = Object.assign({}, hit, { offset: wStart, length: word.length, _wrong: word });
            }
        }

        if (hit) {
            const xy = caretXY(el, hit.offset);
            showPopup(xy.x, xy.y, hit, pgid);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GRAMMAR RESULTS  (entry-point called from host renderer process)
    // ─────────────────────────────────────────────────────────────────────────
    window.__protonGrammarResult = function(result, pgid) {
        const raw = (result && result.matches) || [];
        const matches = raw.map(m => {
            // Normalise replacements to plain strings
            const reps = (m.replacements || []).map(r => r && r.value !== undefined ? String(r.value) : String(r || '')).filter(Boolean);
            // Extract the exact wrong word from LanguageTool context
            let wrongWord = '';
            try {
                if (m.context && typeof m.context.text === 'string')
                    wrongWord = m.context.text.slice(m.context.offset || 0, (m.context.offset||0) + m.length).trim();
            } catch(e){}
            return Object.assign({}, m, { replacements: reps, _wrong: wrongWord });
        }).filter(m => {
            // Skip anything the user has ignored
            const key = (m._wrong || '') + ':' + m.category;
            return !ignoreSet.has(key);
        });

        errorMap.set(pgid, matches);
        const el = getEl(pgid);
        if (!el) return;

        // Handle rewrite mode (paragraph selection)
        if (rewriteCtx.has(pgid)) {
            const ctx = rewriteCtx.get(pgid);
            rewriteCtx.delete(pgid);
            const corrected = applyAllFixes(ctx.text, matches);
            showRewritePopup(ctx.text, corrected, matches, el, pgid, ctx.offset, ctx.selEnd);
            return;
        }

        rerenderHL(el, pgid, matches);
        updateBadge(el, pgid, matches.length);

        // Show popup only when the element is focused (non-intrusive)
        const focused = document.activeElement === el || el.contains(document.activeElement);
        const first   = matches.find(m => m.replacements && m.replacements.length > 0);
        if (first && focused) {
            setTimeout(() => {
                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    const xy = caretXY(el, first.offset);
                    showPopup(xy.x, xy.y, first, pgid);
                } else {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0) showPopup(r.left, r.bottom + 6, first, pgid);
                }
            }, 300);
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // APPLY ALL FIXES  — produce a fully corrected text string from LT matches
    // ─────────────────────────────────────────────────────────────────────────
    function applyAllFixes(text, matches) {
        const sorted = [...matches]
            .filter(m => m.replacements && m.replacements.length > 0)
            .sort((a, b) => b.offset - a.offset);
        let result = text;
        for (const m of sorted) {
            result = result.slice(0, m.offset) + m.replacements[0] + result.slice(m.offset + m.length);
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WORD-LEVEL DIFF  — returns [{text, type:'same'|'del'|'ins'}] array
    // ─────────────────────────────────────────────────────────────────────────
    function wordDiff(a, b) {
        const aW = a.split(/(\s+)/);
        const bW = b.split(/(\s+)/);
        const out = [];
        let ai = 0, bi = 0;
        while (ai < aW.length || bi < bW.length) {
            if (ai >= aW.length) { out.push({ text: bW[bi++], type:'ins' }); continue; }
            if (bi >= bW.length) { out.push({ text: aW[ai++], type:'del' }); continue; }
            if (aW[ai] === bW[bi]) {
                out.push({ text: aW[ai], type:'same' });
                ai++; bi++;
            } else {
                // Scan ahead to find next matching token
                let found = false;
                for (let look = 1; look <= 5; look++) {
                    if (bi + look < bW.length && bW[bi + look] === aW[ai]) {
                        for (let k = 0; k < look; k++) out.push({ text: bW[bi++], type:'ins' });
                        found = true; break;
                    }
                    if (ai + look < aW.length && aW[ai + look] === bW[bi]) {
                        for (let k = 0; k < look; k++) out.push({ text: aW[ai++], type:'del' });
                        found = true; break;
                    }
                }
                if (!found) {
                    out.push({ text: aW[ai++], type:'del' });
                    out.push({ text: bW[bi++], type:'ins' });
                }
            }
        }
        return out;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REWRITE POPUP  — beautiful diff view with apply/dismiss
    // ─────────────────────────────────────────────────────────────────────────
    function showRewritePopup(original, corrected, matches, el, pgid, selStart, selEnd) {
        closePopup();
        document.querySelectorAll('[data-pg8rw]').forEach(p => p.remove());
        document.querySelectorAll('[data-pg8rwload]').forEach(p => p.remove());

        const hasChanges = original !== corrected;
        const diff = wordDiff(original, corrected);
        const errCount = matches.filter(m => m.replacements && m.replacements.length > 0).length;

        const popup = document.createElement('div');
        popup.dataset.pg8rw = '1';
        Object.assign(popup.style, {
            position:'fixed', zIndex:'2147483647',
            left:'50%', top:'50%',
            transform:'translate(-50%, -50%)',
            background:'#0d0b0a',
            border:'1px solid rgba(251,191,36,.35)',
            borderRadius:'20px',
            boxShadow:'0 40px 120px rgba(0,0,0,.97),0 0 0 1px rgba(255,255,255,.05),0 0 80px rgba(251,191,36,.08)',
            fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            width:'min(700px, 92vw)',
            maxHeight:'85vh',
            display:'flex', flexDirection:'column',
            overflow:'hidden',
            animation:'pg8in .25s cubic-bezier(.175,.885,.32,1.275)',
        });

        // ── Header ────────────────────────────────────────────────────────────
        const hdr = document.createElement('div');
        Object.assign(hdr.style, {
            display:'flex', alignItems:'center', gap:'10px',
            padding:'14px 18px 12px',
            borderBottom:'1px solid rgba(255,255,255,.07)',
            background:'rgba(251,191,36,.06)',
            flexShrink:'0',
        });
        const hTitle = document.createElement('span');
        Object.assign(hTitle.style, { fontSize:'14px', fontWeight:'800', color:'#fbbf24', letterSpacing:'.5px' });
        hTitle.textContent = '\u2728 Proton Writing — Paragraph Analysis';
        hdr.appendChild(hTitle);
        const statsEl = document.createElement('span');
        Object.assign(statsEl.style, { marginLeft:'auto', fontSize:'11px', color:'#78716c' });
        statsEl.textContent = hasChanges
            ? errCount + ' issue' + (errCount !== 1 ? 's' : '') + ' corrected'
            : '\u2713 No issues found — paragraph is perfect!';
        hdr.appendChild(statsEl);
        const xBtn = document.createElement('button');
        Object.assign(xBtn.style, { background:'none', border:'none', color:'#78716c', cursor:'pointer', fontSize:'18px', padding:'0 4px', marginLeft:'8px', lineHeight:'1' });
        xBtn.textContent = '\u2715';
        xBtn.addEventListener('click', () => popup.remove());
        hdr.appendChild(xBtn);
        popup.appendChild(hdr);

        // ── Scroll body ───────────────────────────────────────────────────────
        const body = document.createElement('div');
        Object.assign(body.style, { padding:'16px 18px', overflowY:'auto', flex:'1' });

        if (hasChanges) {
            // ── Side-by-side labels ───────────────────────────────────────────
            const labels = document.createElement('div');
            Object.assign(labels.style, { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'10px' });
            const lbl1 = document.createElement('div');
            Object.assign(lbl1.style, { fontSize:'10px', fontWeight:'800', color:'#ef4444', textTransform:'uppercase', letterSpacing:'1px' });
            lbl1.textContent = '\u2718 Original';
            const lbl2 = document.createElement('div');
            Object.assign(lbl2.style, { fontSize:'10px', fontWeight:'800', color:'#22c55e', textTransform:'uppercase', letterSpacing:'1px' });
            lbl2.textContent = '\u2714 Corrected';
            labels.appendChild(lbl1); labels.appendChild(lbl2);
            body.appendChild(labels);

            // ── Side-by-side panels ────────────────────────────────────────────
            const panels = document.createElement('div');
            Object.assign(panels.style, { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'16px' });

            // Original panel — show deletions in red
            const origPanel = document.createElement('div');
            Object.assign(origPanel.style, { background:'rgba(239,68,68,.07)', border:'1px solid rgba(239,68,68,.2)', borderRadius:'12px', padding:'12px 14px', fontSize:'13px', lineHeight:'1.7', color:'#d4d0c8', wordBreak:'break-word' });
            diff.forEach(tok => {
                if (tok.type === 'ins') return; // skip insertions in original view
                const span = document.createElement('span');
                span.textContent = tok.text;
                if (tok.type === 'del') {
                    Object.assign(span.style, { background:'rgba(239,68,68,.25)', color:'#fca5a5', textDecoration:'line-through', borderRadius:'3px', padding:'0 2px' });
                }
                origPanel.appendChild(span);
            });

            // Corrected panel — show insertions in green
            const corrPanel = document.createElement('div');
            Object.assign(corrPanel.style, { background:'rgba(34,197,94,.07)', border:'1px solid rgba(34,197,94,.2)', borderRadius:'12px', padding:'12px 14px', fontSize:'13px', lineHeight:'1.7', color:'#d4d0c8', wordBreak:'break-word' });
            diff.forEach(tok => {
                if (tok.type === 'del') return; // skip deletions in corrected view
                const span = document.createElement('span');
                span.textContent = tok.text;
                if (tok.type === 'ins') {
                    Object.assign(span.style, { background:'rgba(34,197,94,.25)', color:'#86efac', borderRadius:'3px', padding:'0 2px', fontWeight:'600' });
                }
                corrPanel.appendChild(span);
            });

            panels.appendChild(origPanel);
            panels.appendChild(corrPanel);
            body.appendChild(panels);

            // ── Issue breakdown ────────────────────────────────────────────────
            const issues = matches.filter(m => m.replacements && m.replacements.length > 0);
            if (issues.length > 0) {
                const issDiv = document.createElement('div');
                Object.assign(issDiv.style, { marginBottom:'14px' });
                const issTitle = document.createElement('div');
                Object.assign(issTitle.style, { fontSize:'10px', fontWeight:'800', color:'#78716c', textTransform:'uppercase', letterSpacing:'.9px', marginBottom:'8px' });
                issTitle.textContent = 'Issues Fixed';
                issDiv.appendChild(issTitle);
                const issGrid = document.createElement('div');
                Object.assign(issGrid.style, { display:'flex', flexWrap:'wrap', gap:'6px' });
                issues.slice(0, 12).forEach(m => {
                    const chip = document.createElement('div');
                    const c = getC(m);
                    Object.assign(chip.style, { background:c.bg, border:'1px solid '+c.color+'40', borderRadius:'20px', padding:'3px 10px', fontSize:'11px', color:c.color, display:'flex', alignItems:'center', gap:'5px' });
                    const badge = document.createElement('span');
                    Object.assign(badge.style, { width:'6px', height:'6px', borderRadius:'50%', background:c.color, flexShrink:'0' });
                    chip.appendChild(badge);
                    chip.appendChild(document.createTextNode((m._wrong || m.context && m.context.text.slice(m.context.offset||0,(m.context.offset||0)+m.length) || '?') + ' \u2192 ' + m.replacements[0]));
                    issGrid.appendChild(chip);
                });
                if (issues.length > 12) {
                    const more = document.createElement('span');
                    Object.assign(more.style, { fontSize:'11px', color:'#57534e', padding:'3px 8px' });
                    more.textContent = '+' + (issues.length - 12) + ' more';
                    issGrid.appendChild(more);
                }
                issDiv.appendChild(issGrid);
                body.appendChild(issDiv);
            }
        } else {
            // No issues
            const ok = document.createElement('div');
            Object.assign(ok.style, { textAlign:'center', padding:'30px 20px' });
            const emojiEl = document.createElement('div');
            emojiEl.style.cssText = 'font-size:40px;margin-bottom:12px;';
            emojiEl.textContent = '\u2705';
            const okMsg = document.createElement('div');
            Object.assign(okMsg.style, { fontSize:'15px', fontWeight:'700', color:'#22c55e', marginBottom:'6px' });
            okMsg.textContent = 'Perfect Paragraph!';
            const okSub = document.createElement('div');
            Object.assign(okSub.style, { fontSize:'12px', color:'#78716c' });
            okSub.textContent = 'No grammar, spelling, or style issues found.';
            ok.appendChild(emojiEl); ok.appendChild(okMsg); ok.appendChild(okSub);
            body.appendChild(ok);
        }

        popup.appendChild(body);

        // ── Footer ────────────────────────────────────────────────────────────
        const footer = document.createElement('div');
        Object.assign(footer.style, { display:'flex', gap:'10px', padding:'12px 18px', borderTop:'1px solid rgba(255,255,255,.07)', flexShrink:'0', background:'rgba(255,255,255,.015)' });

        if (hasChanges) {
            const applyBtn = document.createElement('button');
            applyBtn.className = 'pg8btn';
            Object.assign(applyBtn.style, { background:'#fbbf24', color:'#0a0807', flex:'1', padding:'10px 0', fontSize:'13px', boxShadow:'0 4px 20px rgba(251,191,36,.4)' });
            applyBtn.textContent = '\u2714 Apply Corrected Version';
            applyBtn.addEventListener('mousedown', e => e.preventDefault());
            applyBtn.addEventListener('click', () => {
                popup.remove();
                applyRewrite(el, pgid, corrected, selStart, selEnd);
                toast('\u2728 Paragraph corrected!', '#22c55e');
            });
            footer.appendChild(applyBtn);

            const partialBtn = document.createElement('button');
            partialBtn.className = 'pg8btn';
            Object.assign(partialBtn.style, { background:'rgba(255,255,255,.08)', color:'#a8a29e', padding:'10px 16px', fontSize:'13px' });
            partialBtn.textContent = '\uD83D\uDD0D Review Each';
            partialBtn.addEventListener('mousedown', e => e.preventDefault());
            partialBtn.addEventListener('click', () => {
                popup.remove();
                // Show regular highlights for the element
                const adjusted = matches.map(m => Object.assign({}, m, { offset: m.offset + (selStart||0) }));
                errorMap.set(pgid, adjusted);
                rerenderHL(el, pgid, adjusted);
                updateBadge(el, pgid, adjusted.length);
                const first = adjusted.find(x => x.replacements && x.replacements.length > 0);
                if (first) {
                    const isTA = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
                    const xy = isTA ? caretXY(el, first.offset) : { x: el.getBoundingClientRect().left, y: el.getBoundingClientRect().bottom + 6 };
                    showPopup(xy.x, xy.y, first, pgid);
                }
            });
            footer.appendChild(partialBtn);
        }

        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'pg8btn';
        Object.assign(dismissBtn.style, { background:'none', border:'1px solid rgba(255,255,255,.1)', color:'#78716c', padding:'10px 16px', fontSize:'13px' });
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.addEventListener('click', () => popup.remove());
        footer.appendChild(dismissBtn);
        popup.appendChild(footer);

        document.body.appendChild(popup);

        // Overlay backdrop
        const overlay = document.createElement('div');
        overlay.dataset.pg8rw = '1';
        Object.assign(overlay.style, { position:'fixed', inset:'0', zIndex:'2147483646', background:'rgba(0,0,0,.6)', backdropFilter:'blur(4px)' });
        overlay.addEventListener('click', () => { popup.remove(); overlay.remove(); });
        document.body.insertBefore(overlay, popup);

        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { popup.remove(); overlay.remove(); document.removeEventListener('keydown', esc); }
        });
    }

    // Apply the rewritten text back into the element at the right selection range
    function applyRewrite(el, pgid, corrected, selStart, selEnd) {
        if (!el) return;
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            const v = el.value || '';
            const start = typeof selStart === 'number' ? selStart : 0;
            const end   = typeof selEnd   === 'number' ? selEnd   : v.length;
            // Use setRangeText if available
            try {
                if (typeof el.setRangeText === 'function') {
                    el.setRangeText(corrected, start, end, 'end');
                } else { throw new Error(); }
            } catch(e) {
                const nv = v.slice(0, start) + corrected + v.slice(end);
                try {
                    const P = (el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement).prototype;
                    const d = Object.getOwnPropertyDescriptor(P, 'value');
                    if (d && d.set) d.set.call(el, nv); else el.value = nv;
                } catch(e2) { el.value = nv; }
            }
            ['input','change'].forEach(t => el.dispatchEvent(new InputEvent(t, { bubbles:true })));
            errorMap.set(pgid, []);
            mirrorMap.get(pgid) && renderMirror(el, pgid, []);
            updateBadge(el, pgid, 0);
            scheduleRecheck(el, pgid);
        } else if (el.isContentEditable || el.getAttribute('contenteditable') !== null) {
            el.focus();
            document.execCommand('selectAll');
            // Re-select just the range
            try {
                const sel = window.getSelection();
                const range = sel.getRangeAt(0);
                // Walk to start/end nodes
                const nodes = []; let tot = 0;
                (function walk(n) {
                    if (n.nodeType === 3) { nodes.push({ n, s:tot, e:tot+n.nodeValue.length }); tot += n.nodeValue.length; }
                    else if (n.nodeType === 1 && n.tagName !== 'SCRIPT') Array.from(n.childNodes).forEach(walk);
                })(el);
                const s = typeof selStart === 'number' ? selStart : 0;
                const e2 = typeof selEnd   === 'number' ? selEnd   : tot;
                let sNode, sOff = 0, eNode, eOff = 0;
                for (const nd of nodes) {
                    if (!sNode && nd.e > s) { sNode = nd.n; sOff = s - nd.s; }
                    if (!eNode && nd.e >= e2) { eNode = nd.n; eOff = e2 - nd.s; break; }
                }
                if (sNode && eNode) {
                    range.setStart(sNode, sOff); range.setEnd(eNode, eOff);
                    sel.removeAllRanges(); sel.addRange(range);
                }
            } catch(e) {}
            document.execCommand('insertText', false, corrected);
            el.dispatchEvent(new InputEvent('input', { bubbles:true }));
            errorMap.set(pgid, []);
            renderCEHL(el, pgid, []);
            updateBadge(el, pgid, 0);
            scheduleRecheck(el, pgid);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REWRITE BUTTON  — appears above selection when >= 40 chars selected
    // ─────────────────────────────────────────────────────────────────────────
    function hideRewriteBtn() {
        if (rewriteBtn) { try { rewriteBtn.remove(); } catch(e){} rewriteBtn = null; }
    }

    function checkSelection(el, pgid) {
        let selectedText = '', selStart = 0, selEnd = 0;

        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            selStart = el.selectionStart || 0;
            selEnd   = el.selectionEnd   || 0;
            selectedText = (el.value || '').slice(selStart, selEnd);
        } else if (el.isContentEditable || el.getAttribute('contenteditable') !== null) {
            try {
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
                    selectedText = sel.toString();
                    // Approximate offset in text content
                    const txt = el.innerText || el.textContent || '';
                    const idx = txt.indexOf(selectedText);
                    selStart = idx >= 0 ? idx : 0;
                    selEnd   = selStart + selectedText.length;
                }
            } catch(e) {}
        }

        if (selectedText.trim().length >= 40) {
            showRewriteBtn(el, pgid, selectedText, selStart, selEnd);
        } else {
            hideRewriteBtn();
        }
    }

    function showRewriteBtn(el, pgid, selectedText, selStart, selEnd) {
        hideRewriteBtn();
        // Get rect from selection or element
        let rect;
        try {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const r = sel.getRangeAt(0).getBoundingClientRect();
                if (r.width > 0) rect = r;
            }
        } catch(e){}
        if (!rect) rect = el.getBoundingClientRect();

        const btn = document.createElement('div');
        btn.dataset.pg8rwbtn = '1';
        Object.assign(btn.style, {
            position:'fixed', zIndex:'2147483647',
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)) + 'px',
            top:  Math.max(8, rect.top - 46) + 'px',
            background:'linear-gradient(135deg, #fbbf24, #f59e0b)',
            color:'#0a0807',
            borderRadius:'24px',
            padding:'8px 18px',
            fontSize:'12px', fontWeight:'800',
            boxShadow:'0 6px 24px rgba(251,191,36,.5)',
            cursor:'pointer',
            display:'flex', alignItems:'center', gap:'8px',
            animation:'pg8in .18s cubic-bezier(.175,.885,.32,1.275)',
            userSelect:'none',
            letterSpacing:'.3px',
        });

        const icon = document.createElement('span');
        icon.textContent = '\u2728';
        icon.style.fontSize = '14px';
        const label = document.createElement('span');
        label.textContent = 'Rewrite Paragraph';
        btn.appendChild(icon); btn.appendChild(label);

        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('click', () => {
            hideRewriteBtn();
            // Store rewrite context
            rewriteCtx.set(pgid, { text: selectedText, offset: selStart, selEnd });
            // Send to grammar check (will come back as rewrite mode)
            try {
                sessionStorage.setItem('proton_grammar_request', JSON.stringify({
                    text: selectedText.slice(0, 50000), inputId: pgid, timestamp: Date.now(), rewrite: true
                }));
            } catch(e) {}
            // Show loading indicator
            showLoadingRewrite();
        });

        document.body.appendChild(btn);
        rewriteBtn = btn;

        // Auto-hide after 6 s
        setTimeout(() => { if (rewriteBtn === btn) hideRewriteBtn(); }, 6000);
    }

    function showLoadingRewrite() {
        document.querySelectorAll('[data-pg8rwload]').forEach(e => e.remove());
        const el2 = document.createElement('div');
        el2.dataset.pg8rwload = '1';
        Object.assign(el2.style, {
            position:'fixed', bottom:'28px', left:'50%', transform:'translateX(-50%)',
            zIndex:'2147483647', background:'#0c0a09', border:'1px solid rgba(251,191,36,.4)',
            borderRadius:'12px', padding:'9px 22px',
            font:'700 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            color:'#fbbf24', boxShadow:'0 6px 28px rgba(0,0,0,.8)',
            display:'flex', alignItems:'center', gap:'10px', whiteSpace:'nowrap',
            animation:'pg8tst .2s ease',
        });
        const spinner = document.createElement('span');
        spinner.textContent = '\u23F3';
        el2.appendChild(spinner);
        el2.appendChild(document.createTextNode('Analyzing paragraph...'));
        document.body.appendChild(el2);
        setTimeout(() => el2.remove(), 8000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MONITOR ELEMENT
    // ─────────────────────────────────────────────────────────────────────────
    function monitorEl(el) {
        if (!el || elMap.has(el)) return;                      // STEALTH: no data-* attrs
        if (el.disabled || el.readOnly) return;
        if (el.getAttribute('contenteditable') === 'false') return;
        if (el.getAttribute('aria-readonly') === 'true') return;
        if (el.tagName === 'INPUT') {
            const t = String(el.type || '').toLowerCase();
            if (!['text','search','email','url','number',''].includes(t)) return;
        }
        if (!el.offsetWidth && !el.getBoundingClientRect().width) return;

        const pgid = 'pg_' + Math.random().toString(36).slice(2, 9);
        elMap.set(el, pgid);      // STEALTH: WeakMap — invisible to page scripts
        pgidMap.set(pgid, el);    // STEALTH: reverse lookup by pgid

        function requestCheck() {
            const text = String(el.value || el.innerText || el.textContent || '').trim();
            if (text.length < 3) return;
            try {
                sessionStorage.setItem('proton_grammar_request', JSON.stringify({
                    text: text.slice(0, 120000), inputId: pgid, timestamp: Date.now()
                }));
            } catch(e){}
        }

        el.addEventListener('input',  () => { clearTimeout(checkTimer); checkTimer = setTimeout(requestCheck, 900); hideRewriteBtn(); });
        el.addEventListener('focus',  () => { clearTimeout(checkTimer); checkTimer = setTimeout(requestCheck, 600); });
        el.addEventListener('paste',  () => { clearTimeout(checkTimer); checkTimer = setTimeout(requestCheck, 1000); });
        el.addEventListener('click',  () => setTimeout(() => { checkSelection(el, pgid); onCaret(el, pgid); }, 25));
        el.addEventListener('mouseup',() => setTimeout(() => checkSelection(el, pgid), 50));
        el.addEventListener('keyup',  ev => {
            autoCorrect(el, pgid, ev.key);
            if ([' ','.',',','!','?',';',':','Enter'].includes(ev.key))
                setTimeout(() => onCaret(el, pgid), 25);
            if (ev.shiftKey) setTimeout(() => checkSelection(el, pgid), 50);
        });
        // Reposition badge on scroll/resize
        el.addEventListener('scroll', () => { const b = badgeMap.get(pgid); if (b) { const r = el.getBoundingClientRect(); b.style.left = (r.right-22)+'px'; b.style.top = (r.top+3)+'px'; } }, { passive:true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SCAN DOM FOR EDITABLE ELEMENTS
    // ─────────────────────────────────────────────────────────────────────────
    // Comprehensive selector — covers every popular editor framework
    const SEL = [
        'textarea',
        'input[type=text]','input[type=search]','input[type=email]',
        'input[type=url]','input[type=number]','input:not([type])',
        '[contenteditable]:not([contenteditable=false])',
        '[role=textbox]','[role=combobox]','[aria-multiline=true]',
        '[data-lexical-editor]',      // Lexical (Meta)
        '[data-slate-editor]',        // Slate.js
        '.ql-editor',                 // Quill
        '.ProseMirror',               // ProseMirror / Tiptap / Remirror
        '.cm-content',                // CodeMirror v6
        '.CodeMirror-code',           // CodeMirror v5
        '.note-editable',             // Summernote
        '.codex-editor__redactor [contenteditable]',  // Editor.js
        '[data-placeholder][contenteditable]',        // generic
        '[data-gramm]',               // sites that had Grammarly
    ].join(',');

    function scan(rootDoc) {
        if (!grammarActive) return;   // disabled via settings toggle
        const doc = rootDoc || document;

        // Regular elements
        try { doc.querySelectorAll(SEL).forEach(monitorEl); } catch(e){}

        // document.designMode editors (old WYSIWYG, CKEditor classic)
        try { if (doc.designMode === 'on' && doc.body) monitorEl(doc.body); } catch(e){}

        // Shadow DOM components
        try {
            doc.querySelectorAll('*').forEach(h => {
                if (h.shadowRoot) try { h.shadowRoot.querySelectorAll(SEL).forEach(monitorEl); } catch(e){}
            });
        } catch(e){}

        // Same-origin iframes
        try {
            doc.querySelectorAll('iframe').forEach(f => {
                try { if (f.contentDocument && f.contentDocument !== doc) scan(f.contentDocument); } catch(e){}
            });
        } catch(e){}
    }

    window.__protonGrammarScan = scan;
    scan(document);

    // MutationObserver — catches dynamically rendered editors
    new MutationObserver(() => { try { scan(document); } catch(e){} })
        .observe(document.body || document.documentElement, { childList:true, subtree:true });

    // Periodic scan every 3 s — catches lazy/delayed editors
    setInterval(() => { try { scan(document); } catch(e){} }, 3000);

    // SPA URL change detection
    let _lastUrl = location.href;
    setInterval(() => {
        if (location.href !== _lastUrl) {
            _lastUrl = location.href;
            // Clear stale badges from previous page
            badgeMap.forEach(b => { try { b.remove(); } catch(e){} }); badgeMap.clear();
            setTimeout(() => { try { scan(document); } catch(e){} }, 800);
        }
    }, 1000);

    console.log('%c\u270D Grammar Assistant', 'color:#a855f7;font-weight:800;font-size:14px', '\u2014 active on', location.hostname);
})();
        `;
        webview.executeJavaScript(script).catch(() => {});
    }

    // Backup fingerprint fix applied at dom-ready.
    // The primary fix is fingerprint-preload.js (runs before page scripts via
    // will-attach-webview). This backup handles SPA navigations and late-loaded
    // iframes where the preload hasn't run again.
    injectChromeFingerprint(webview) {
        webview.executeJavaScript(`(function(){
            var brands=[{brand:'Not A Brand',version:'99'},{brand:'Google Chrome',version:'132'},{brand:'Chromium',version:'132'}];
            try{Object.defineProperty(navigator,'userAgentData',{value:{brands:brands,mobile:false,platform:'Windows',
                getHighEntropyValues:function(){return Promise.resolve({architecture:'x86',bitness:'64',brands:brands,
                    fullVersionList:[{brand:'Not A Brand',version:'99.0.0.0'},{brand:'Google Chrome',version:'132.0.6834.110'},{brand:'Chromium',version:'132.0.6834.110'}],
                    mobile:false,model:'',platform:'Windows',platformVersion:'15.0.0',uaFullVersion:'132.0.6834.110',wow64:false});},
                toJSON:function(){return{brands:brands,mobile:false,platform:'Windows'};}},configurable:true});}catch(e){}
            try{Object.defineProperty(navigator,'vendor',{get:function(){return'Google Inc.';},configurable:true});}catch(e){}
            try{delete window.electron;}catch(e){}
            try{if(typeof process!=='undefined'&&process.versions){
                Object.defineProperty(process.versions,'electron',{get:function(){return undefined;},configurable:true});
                Object.defineProperty(process.versions,'node',{get:function(){return undefined;},configurable:true});
            }}catch(e){}
            if(!window.chrome)window.chrome={};
            if(!window.chrome.runtime)window.chrome.runtime={id:undefined,connect:function(){return{onMessage:{addListener:function(){}},postMessage:function(){},disconnect:function(){}};},sendMessage:function(){},onMessage:{addListener:function(){},removeListener:function(){},hasListener:function(){return false;}},onConnect:{addListener:function(){},removeListener:function(){}}};
            if(!window.chrome.loadTimes)window.chrome.loadTimes=function(){return{requestTime:Date.now()/1000,startLoadTime:Date.now()/1000,commitLoadTime:Date.now()/1000,finishDocumentLoadTime:0,finishLoadTime:0,firstPaintTime:0,firstPaintAfterLoadTime:0,navigationType:'Other',wasFetchedViaSpdy:false,wasNpnNegotiated:true,npnNegotiatedProtocol:'h2',wasAlternateProtocolAvailable:false,connectionInfo:'h2'};};
            if(!window.chrome.csi)window.chrome.csi=function(){return{startE:Date.now(),onloadT:Date.now(),pageT:performance.now(),tran:15};};
            if(!window.chrome.app)window.chrome.app={isInstalled:false,getDetails:function(){return null;},getIsInstalled:function(){return false;},runningState:function(){return'cannot_run';}};
        })();`).catch(() => {});
    }

    async injectAdBlocker(webview, url) {
        try {
            if (!url || !url.includes('youtube.com')) return;
            const script = await window.electronAPI.getAdBlockScript();
            if (script) webview.executeJavaScript(script).catch(() => {});
        } catch (e) {}
    }

    injectYouTubeDownloader(webview, tabId, url) {
        if (!url || (!url.includes('youtube.com/watch') && !url.includes('youtu.be/'))) return;

        const script = `
(function() {
    if (document.getElementById('__proton_yt_btn__')) return;

    // ── Trusted Types shim (YouTube enforces this policy) ────────────────────
    let __policy__;
    try {
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
            __policy__ = window.trustedTypes.createPolicy('__proton_yt_dl__', {
                createHTML: (s) => s
            });
        }
    } catch (e) { /* policy already exists — reuse */ 
        try { __policy__ = window.trustedTypes.getAttributeType && window.trustedTypes; } catch(_) {}
    }
    const __sh__ = (el, html) => {
        try {
            el.innerHTML = __policy__ ? __policy__.createHTML(html) : html;
        } catch(e) {
            // Fallback: build via DOMParser if trusted types still blocks
            const doc = new DOMParser().parseFromString(html, 'text/html');
            el.replaceChildren(...Array.from(doc.body.childNodes));
        }
    };

    // ── Styles ──────────────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = \`
        #__proton_yt_btn__ {
            position: fixed; top: 80px; right: 20px; z-index: 2147483647;
            background: linear-gradient(135deg, #fbbf24, #f59e0b);
            color: #111; padding: 10px 18px; border-radius: 10px;
            font: 700 14px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            display: flex; align-items: center; gap: 8px; cursor: pointer;
            box-shadow: 0 4px 16px rgba(251,191,36,.45);
            border: none; outline: none;
            transition: transform .2s, box-shadow .2s;
            user-select: none;
        }
        #__proton_yt_btn__:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(251,191,36,.6); }
        #__proton_yt_btn__ svg { flex-shrink: 0; }

        #__proton_modal_wrap__ {
            position: fixed; inset: 0; z-index: 2147483646;
            background: rgba(0,0,0,.75); backdrop-filter: blur(6px);
            display: flex; align-items: center; justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            animation: __pm_fadein .2s ease;
        }
        @keyframes __pm_fadein { from { opacity:0; } to { opacity:1; } }

        #__proton_modal__ {
            background: #0f0d0b; border-radius: 18px; width: 520px; max-width: 92vw;
            border: 1px solid rgba(251,191,36,.25);
            box-shadow: 0 32px 80px rgba(0,0,0,.8);
            overflow: hidden; animation: __pm_slidein .25s cubic-bezier(.4,0,.2,1);
        }
        @keyframes __pm_slidein { from { transform: translateY(20px); opacity:0; } to { transform:none; opacity:1; } }

        .__pm_hdr__ {
            display: flex; align-items: center; justify-content: space-between;
            padding: 20px 24px 16px; border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .__pm_hdr__ h2 { margin:0; color:#fafaf9; font-size:17px; font-weight:700; display:flex; gap:8px; align-items:center; }
        .__pm_close__ {
            background: rgba(255,255,255,.08); border: none; color:#a8a29e;
            width:30px; height:30px; border-radius:8px; font-size:16px;
            cursor:pointer; display:flex; align-items:center; justify-content:center;
            transition: background .2s, color .2s;
        }
        .__pm_close__:hover { background: rgba(239,68,68,.2); color:#ef4444; }

        .__pm_body__ { padding: 20px 24px 24px; }

        .__pm_thumb_row__ { display:flex; gap:14px; align-items:flex-start; margin-bottom:20px; }
        .__pm_thumb__ { width:120px; height:68px; border-radius:8px; object-fit:cover; flex-shrink:0; background:#1a1410; }
        .__pm_meta__ { flex:1; min-width:0; }
        .__pm_title__ { font-size:14px; font-weight:600; color:#fafaf9; line-height:1.4; margin-bottom:6px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .__pm_sub__ { font-size:12px; color:#78716c; display:flex; gap:10px; }

        .__pm_loading__ { text-align:center; padding:32px 0; }
        .__pm_spinner__ {
            width:36px; height:36px; border:3px solid rgba(251,191,36,.2);
            border-top-color:#fbbf24; border-radius:50%; margin:0 auto 14px;
            animation: __spin .8s linear infinite;
        }
        @keyframes __spin { to { transform: rotate(360deg); } }
        .__pm_loading__ p { color:#a8a29e; font-size:14px; margin:0; }

        .__pm_error__ { padding:16px; background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.2); border-radius:10px; color:#fca5a5; font-size:13px; margin-bottom:16px; }

        .__pm_label__ { font-size:12px; font-weight:600; color:#78716c; text-transform:uppercase; letter-spacing:.8px; margin-bottom:10px; }

        .__pm_formats__ { display:flex; flex-direction:column; gap:8px; margin-bottom:20px; max-height:200px; overflow-y:auto; }
        .__pm_fmt__ {
            display:flex; align-items:center; gap:12px; padding:12px 14px;
            background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07);
            border-radius:10px; cursor:pointer; transition: border-color .2s, background .2s;
        }
        .__pm_fmt__:hover { border-color:rgba(251,191,36,.4); background:rgba(251,191,36,.07); }
        .__pm_fmt__.selected { border-color:rgba(251,191,36,.7); background:rgba(251,191,36,.1); }
        .__pm_fmt_badge__ {
            background:linear-gradient(135deg,#fbbf24,#f59e0b); color:#111;
            padding:4px 10px; border-radius:6px; font-size:13px; font-weight:700; flex-shrink:0;
        }
        .__pm_fmt_info__ { flex:1; }
        .__pm_fmt_quality__ { font-size:14px; font-weight:600; color:#fafaf9; }
        .__pm_fmt_size__ { font-size:12px; color:#78716c; margin-top:1px; }
        .__pm_fmt_check__ { color:#fbbf24; font-size:18px; opacity:0; transition:opacity .2s; }
        .__pm_fmt__.selected .__pm_fmt_check__ { opacity:1; }

        .__pm_dl_btn__ {
            width:100%; padding:15px; background:linear-gradient(135deg,#fbbf24,#f59e0b);
            border:none; border-radius:12px; color:#111; font:700 16px -apple-system,sans-serif;
            cursor:pointer; transition: transform .2s, box-shadow .2s;
            display:flex; align-items:center; justify-content:center; gap:8px;
        }
        .__pm_dl_btn__:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(251,191,36,.4); }
        .__pm_dl_btn__:disabled { opacity:.5; cursor:not-allowed; transform:none; }

        .__pm_progress_wrap__ { margin-bottom:16px; }
        .__pm_progress_bar_bg__ { background:rgba(255,255,255,.08); border-radius:100px; height:8px; overflow:hidden; margin:10px 0 6px; }
        .__pm_progress_bar__ { height:100%; background:linear-gradient(90deg,#fbbf24,#f59e0b); border-radius:100px; transition:width .3s ease; width:0%; }
        .__pm_progress_text__ { font-size:12px; color:#a8a29e; display:flex; justify-content:space-between; }

        .__pm_done__ { text-align:center; padding:16px 0 8px; }
        .__pm_done__ .icon { font-size:48px; margin-bottom:10px; }
        .__pm_done__ h3 { color:#fafaf9; font-size:18px; margin:0 0 6px; }
        .__pm_done__ p { color:#a8a29e; font-size:13px; margin:0; }

        .__pm_note__ { margin-top:14px; font-size:12px; color:#57534e; text-align:center; }
    \`;
    document.head.appendChild(style);

    // ── Download Button ──────────────────────────────────────────────────────
    const btn = document.createElement('button');
    btn.id = '__proton_yt_btn__';
    __sh__(btn, \`
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>Download</span>
    \`);
    document.body.appendChild(btn);

    // State
    let selectedItag = null;
    let videoInfo = null;
    let progressInterval = null;

    // ── Open Modal ───────────────────────────────────────────────────────────
    btn.onclick = () => {
        if (document.getElementById('__proton_modal_wrap__')) return;

        const wrap = document.createElement('div');
        wrap.id = '__proton_modal_wrap__';
        __sh__(wrap, \`
            <div id="__proton_modal__">
                <div class="__pm_hdr__">
                    <h2>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Download Video
                    </h2>
                    <button class="__pm_close__">✕</button>
                </div>
                <div class="__pm_body__" id="__pm_body__">
                    <div class="__pm_loading__">
                        <div class="__pm_spinner__"></div>
                        <p id="__pm_loading_text__">Fetching video info...</p>
                        <p style="font-size:11px;color:#57534e;margin-top:6px;">First run may take ~30s to set up downloader</p>
                    </div>
                </div>
            </div>
        \`);
        document.body.appendChild(wrap);

        wrap.querySelector('.__pm_close__').onclick = closeModal;
        wrap.onclick = (e) => { if (e.target === wrap) closeModal(); };

        // Request video info from Proton
        sessionStorage.setItem('proton_info_request', JSON.stringify({ url: window.location.href }));

        // Poll for response
        let attempts = 0;
        const infoPoller = setInterval(() => {
            // Update loading message to show progress
            const loadingText = document.getElementById('__pm_loading_text__');
            if (loadingText && attempts > 5) {
                loadingText.textContent = attempts > 30
                    ? 'Still working... (yt-dlp is downloading or processing)'
                    : 'Getting video information...';
            }

            const raw = sessionStorage.getItem('proton_info_response');
            if (raw || attempts > 150) {  // 150 × 400ms = 60s timeout
                clearInterval(infoPoller);
                sessionStorage.removeItem('proton_info_response');
                if (!raw) {
                    showError('Timed out. The video may be unavailable or private. Please try again.');
                    return;
                }
                const info = JSON.parse(raw);
                if (!info.success) {
                    showError(info.error || 'Failed to get video info.');
                    return;
                }
                videoInfo = info;
                selectedItag = info.formats?.[0]?.itag || null;
                renderInfo(info);
            }
            attempts++;
        }, 400);
    };

    function closeModal() {
        const wrap = document.getElementById('__proton_modal_wrap__');
        if (wrap) wrap.remove();
        if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    }

    function showError(msg) {
        const body = document.getElementById('__pm_body__');
        if (!body) return;
        __sh__(body, \`
            <div class="__pm_error__">⚠️ \${msg}</div>
            <button class="__pm_dl_btn__" onclick="sessionStorage.setItem('proton_info_request', JSON.stringify({url: window.location.href}));" style="margin-top:4px;">
                Try Again
            </button>
        \`);
    }

    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function renderInfo(info) {
        const body = document.getElementById('__pm_body__');
        if (!body) return;

        const fmtRows = (info.formats || []).map((f, i) => \`
            <div class="__pm_fmt__ \${i === 0 ? 'selected' : ''}" data-fmtid="\${f.formatId || ''}">
                <div class="__pm_fmt_badge__">\${f.quality}</div>
                <div class="__pm_fmt_info__">
                    <div class="__pm_fmt_quality__">\${f.quality} · \${f.format.toUpperCase()}</div>
                    <div class="__pm_fmt_size__">\${f.size}</div>
                </div>
                <div class="__pm_fmt_check__">✓</div>
            </div>
        \`).join('');

        __sh__(body, \`
            <div class="__pm_thumb_row__">
                \${info.thumbnail ? \`<img class="__pm_thumb__" src="\${info.thumbnail}" alt="thumbnail">\` : ''}
                <div class="__pm_meta__">
                    <div class="__pm_title__">\${info.title}</div>
                    <div class="__pm_sub__">
                        \${info.duration ? \`<span>⏱ \${info.duration}\` : ''}</span>
                        \${info.author ? \`<span>📺 \${info.author}</span>\` : ''}
                    </div>
                </div>
            </div>
            <div class="__pm_label__">Select Quality</div>
            <div class="__pm_formats__">\${fmtRows}</div>
            <button class="__pm_dl_btn__" id="__pm_dl_btn__">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download Now
            </button>
            <div class="__pm_note__">Saved to your Downloads folder automatically</div>
        \`);

        // Format selection
        body.querySelectorAll('.__pm_fmt__').forEach(el => {
            el.onclick = () => {
                body.querySelectorAll('.__pm_fmt__').forEach(x => x.classList.remove('selected'));
                el.classList.add('selected');
                selectedItag = el.dataset.fmtid || null;
            };
        });

        // Download button
        document.getElementById('__pm_dl_btn__').onclick = startDownload;
    }

    function startDownload() {
        const btn2 = document.getElementById('__pm_dl_btn__');
        if (btn2) { btn2.disabled = true; btn2.textContent = '⏳ Starting...'; }

        // Send download request to Proton
        sessionStorage.setItem('proton_download_request', JSON.stringify({
            type: 'youtube',
            url: window.location.href,
            itag: selectedItag   // passed as formatId to main.js
        }));

        // Show progress UI
        const body = document.getElementById('__pm_body__');
        if (!body) return;

        __sh__(body, \`
            <div class="__pm_thumb_row__" style="margin-bottom:16px;">
                \${videoInfo?.thumbnail ? \`<img class="__pm_thumb__" src="\${videoInfo.thumbnail}" alt="thumbnail">\` : ''}
                <div class="__pm_meta__">
                    <div class="__pm_title__">\${videoInfo?.title || 'Downloading...'}</div>
                    <div class="__pm_sub__"><span style="color:#fbbf24;">⬇ Downloading...</span></div>
                </div>
            </div>
            <div class="__pm_progress_wrap__">
                <div class="__pm_progress_bar_bg__"><div class="__pm_progress_bar__" id="__pm_bar__"></div></div>
                <div class="__pm_progress_text__">
                    <span id="__pm_pct__">0%</span>
                    <span id="__pm_bytes__">Starting...</span>
                </div>
                <div id="__pm_speed__" style="font-size:12px;color:#fbbf24;margin-top:4px;font-weight:600;"></div>
            </div>
        \`);

        // ── Direct progress function — called by renderer via executeJavaScript ──
        // Replaces the fragile sessionStorage polling approach
        window.__protonProgress = (prog) => {
            if (!prog) return;

            if (prog.state === 'failed') {
                const body = document.getElementById('__pm_body__');
                if (!body) return;
                const errMsg = prog.error || 'Download failed';
                __sh__(body, \`
                    <div class="__pm_error__" style="margin-bottom:16px;">⚠️ \${errMsg}</div>
                    <button class="__pm_dl_btn__" onclick="location.reload()" style="margin-top:8px;">Try Again</button>
                \`);
                if (progressInterval) {
                    clearInterval(progressInterval);
                    progressInterval = null;
                }
                window.__protonProgress = null;
                return;
            }

            const bar   = document.getElementById('__pm_bar__');
            const pct   = document.getElementById('__pm_pct__');
            const bytes = document.getElementById('__pm_bytes__');
            const speed = document.getElementById('__pm_speed__');

            if (bar)   bar.style.width = Math.min(prog.progress || 0, 100) + '%';
            if (pct)   pct.textContent  = Math.round(prog.progress || 0) + '%';
            if (bytes) bytes.textContent = (prog.received && prog.total)
                ? prog.received + ' / ' + prog.total
                : (prog.received || '');
            if (speed) speed.textContent = prog.speed
                ? '⚡ ' + prog.speed + (prog.eta ? '  ·  ETA ' + prog.eta : '')
                : '';

            if ((prog.progress || 0) >= 100 || prog.state === 'completed') {
                clearInterval(progressInterval);
                progressInterval = null;
                window.__protonProgress = null;
                setTimeout(() => showComplete(prog.fileName, prog.filePath), 300);
            }
        };

        // Fallback timeout message (in case download takes long to start)
        progressInterval = setTimeout(() => {
            const bytesEl = document.getElementById('__pm_bytes__');
            if (bytesEl && bytesEl.textContent === 'Starting...') {
                bytesEl.textContent = 'Downloading... (check Downloads panel Ctrl+J)';
            }
            progressInterval = null;
        }, 45000);
    }

    function showComplete(fileName, filePath) {
        const body = document.getElementById('__pm_body__');
        if (!body) return;

        // Format the path for display (show just Downloads folder if it's in there)
        let displayPath = filePath || '';
        if (displayPath) {
            const downloadsMatch = displayPath.match(/([^\\\\/]+[\\\\/]Downloads[\\\\/].+)/i);
            if (downloadsMatch) {
                displayPath = 'Downloads' + displayPath.substring(displayPath.indexOf(downloadsMatch[1]) + downloadsMatch[1].indexOf('Downloads') + 8);
            } else {
                // Just show filename if path is too long
                displayPath = displayPath.split(/[\\\\/]/).pop();
            }
        }

        __sh__(body, \`
            <div class="__pm_done__">
                <div class="icon">✅</div>
                <h3>Download Complete!</h3>
                <p style="margin:8px 0;font-weight:600;color:#fafaf9;">\${fileName || 'Video'}</p>
                <p style="font-size:12px;color:#a8a29e;margin:4px 0 16px;">
                    📁 Saved to: <span style="color:#fbbf24;">\${displayPath || 'Downloads folder'}</span>
                </p>
            </div>
            <div style="display:flex;gap:10px;margin-top:16px;">
                <button class="__pm_dl_btn__" style="flex:1;background:rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.3);" id="__pm_open_btn__">
                    📂 Open Folder
                </button>
                <button class="__pm_dl_btn__" style="flex:1;background:rgba(255,255,255,.08);color:#fafaf9;" id="__pm_close_btn__">Close</button>
            </div>
        \`);
        
        const openBtn = document.getElementById('__pm_open_btn__');
        const closeBtn = document.getElementById('__pm_close_btn__');
        
        if (openBtn && filePath) {
            openBtn.onclick = () => {
                // Request renderer to open the folder
                sessionStorage.setItem('proton_open_folder', filePath);
            };
        }
        
        if (closeBtn) {
            closeBtn.onclick = () => {
                const w = document.getElementById('__proton_modal_wrap__');
                if (w) w.remove();
            };
        }
    }

})();
        `;

        webview.executeJavaScript(script).catch(() => {});
    }

    getActiveWebview() {
        const tab = this.tabs.find(t => t.id === this.activeTabId);
        return tab?.webview || null;
    }

    injectProgressToWebview(data) {
        const wv = this.getActiveWebview();
        if (!wv) return;
        // Use base64 encoding to safely pass JSON — avoids all escaping issues
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
        wv.executeJavaScript(
            `if(typeof window.__protonProgress==='function'){window.__protonProgress(JSON.parse(decodeURIComponent(escape(atob('${b64}')))))}` 
        ).catch(() => {});
    }

    async handleYouTubeDownloadFromPage(request) {
        console.log('📹 YouTube download request:', request);

        if (!window.electronAPI || !window.electronAPI.downloadYouTube) {
            console.error('❌ electronAPI.downloadYouTube not available');
            this.injectProgressToWebview({ state: 'failed', error: 'YouTube downloader not available' });
            return;
        }

        // ── Register progress/complete handlers BEFORE starting download ────
        const self = this;

        const progressHandler = (data) => {
            const received = data.receivedBytes || 0;
            const total = data.totalBytes || 0;
            const speed = data.speed || 0;
            console.log(`📊 Progress: ${Math.round(data.progress || 0)}% | ${self.formatBytes(received)} / ${self.formatBytes(total)} | ${self.formatBytes(speed)}/s`);
            self.injectProgressToWebview({
                progress: data.progress || 0,
                received: self.formatBytes(received),
                total: total > 0 ? self.formatBytes(total) : 'Calculating...',
                speed: speed > 0 ? self.formatBytes(speed) + '/s' : '',
                eta: data.eta || '',
                state: 'downloading'
            });
        };

        const completeHandler = (data) => {
            console.log('✅ Download complete:', data.state, data.fileName, data.filePath);
            if (data.state === 'failed') {
                self.injectProgressToWebview({
                    progress: 0,
                    received: '',
                    total: '',
                    speed: '',
                    eta: '',
                    state: 'failed',
                    error: data.error || 'Download failed',
                    fileName: data.fileName || ''
                });
            } else {
                self.injectProgressToWebview({
                    progress: 100,
                    received: '',
                    total: '',
                    speed: '',
                    eta: '',
                    state: data.state || 'completed',
                    fileName: data.fileName || '',
                    filePath: data.filePath || ''
                });
            }
        };

        // Register IPC event listeners
        if (window.electronAPI.onDownloadProgress) {
            window.electronAPI.onDownloadProgress(progressHandler);
        }
        if (window.electronAPI.onDownloadComplete) {
            window.electronAPI.onDownloadComplete(completeHandler);
        }

        // ── Start download ────────────────────────────────────────────────────
        console.log('🚀 Starting YouTube download:', request.url, 'format:', request.itag);
        try {
            const result = await window.electronAPI.downloadYouTube(request.url, request.itag);
            console.log('📥 downloadYouTube resolved:', result);
            if (!result || !result.success) {
                const errMsg = result?.error || 'Download failed — check console';
                console.error('❌ Download failed:', errMsg);
                this.injectProgressToWebview({ state: 'failed', error: errMsg });
            }
        } catch (error) {
            console.error('❌ downloadYouTube threw:', error);
            this.injectProgressToWebview({ state: 'failed', error: error.message || 'Download failed' });
        }
    }

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    showNotification(title, message) {
        // Create a temporary notification element
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: linear-gradient(135deg, #1a1410 0%, #2d2418 100%);
            color: #fafaf9;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            z-index: 10000;
            border: 1px solid #fbbf24;
            max-width: 320px;
            animation: slideIn 0.3s ease;
        `;
        
        notification.innerHTML = `
            <div style="font-weight: 700; margin-bottom: 4px; color: #fbbf24;">${title}</div>
            <div style="font-size: 13px; color: #d6d3d1;">${message}</div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    switchTab(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        // Tab-strip active state
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.embed-placeholder').forEach(w => w.classList.remove('active'));

        // Hide all currently visible embedded windows (except the one we show)
        if (window.electronAPI?.showEmbedWindow) {
            this.tabs.forEach(t => {
                if (t.type === 'embed' && t.embedHwnd && t.id !== tabId) {
                    window.electronAPI.showEmbedWindow({ hwnd: t.embedHwnd, show: false });
                }
            });
        }

        const tabElement = document.getElementById(`tab-element-${tabId}`);
        if (tabElement) tabElement.classList.add('active');
        this.activeTabId = tabId;

        const welcome = document.getElementById('welcome-screen');
        const addressBar = document.getElementById('address-bar');
        const toolbar = document.getElementById('embed-toolbar');

        if (tab.type === 'embed') {
            // Embed tab: hide all web views, show the native embedded window.
            if (window.electronAPI?.tab) window.electronAPI.tab.hideAll();
            const el = document.getElementById(`webview-${tabId}`);
            if (el) el.classList.add('active');
            if (addressBar) addressBar.value = '';
            if (welcome) welcome.style.display = 'none';
            if (toolbar) { this._updateEmbedToolbar(tab); toolbar.style.display = 'flex'; }
            if (window.electronAPI?.showEmbedWindow && tab.embedHwnd) {
                const b = this._containerBounds();
                window.electronAPI.moveEmbedWindow({ hwnd: tab.embedHwnd, ...b });
                window.electronAPI.showEmbedWindow({ hwnd: tab.embedHwnd, show: true });
            }
        } else {
            // Web tab: show its WebContentsView, or the welcome screen if blank.
            if (toolbar) toolbar.style.display = 'none';
            if (addressBar) addressBar.value = tab.url || '';
            if (tab.url) {
                if (window.electronAPI?.tab) window.electronAPI.tab.activate(tabId);
                this._pushLayout();
                if (welcome) welcome.style.display = 'none';
            } else {
                if (window.electronAPI?.tab) window.electronAPI.tab.hideAll();
                if (welcome) welcome.style.display = 'flex';
            }
        }
    }

    // Physical-pixel content-area bounds for the native window-embed feature.
    // Prefer main's value (the chrome view may be collapsed, so the renderer
    // can't measure the real content area); fall back to DOM measurement.
    _containerBounds() {
        if (this._contentBoundsPhysical) return this._contentBoundsPhysical;
        const el = document.getElementById('webview-container');
        if (!el) return { x: 0, y: 0, w: 0, h: 0 };
        const r = el.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        return {
            x: Math.round(r.x * dpr),
            y: Math.round(r.y * dpr),
            w: Math.round(r.width * dpr),
            h: Math.round(r.height * dpr)
        };
    }

    // Cache physical content-area bounds from main; reposition the active embed
    // window when they change (window resize, chrome expand/collapse).
    _watchContentBounds() {
        if (!window.electronAPI?.ui?.onContentBounds) return;
        window.electronAPI.ui.onContentBounds((d) => {
            this._contentBoundsPhysical = d;
            const t = this.tabs.find(x => x.id === this.activeTabId);
            if (t && t.type === 'embed' && t.embedHwnd && window.electronAPI?.moveEmbedWindow) {
                window.electronAPI.moveEmbedWindow({ hwnd: t.embedHwnd, ...d });
            }
        });
    }

    closeTab(tabId) {
        const index = this.tabs.findIndex(t => t.id === tabId);
        if (index === -1) return;

        // Release embedded window back to the desktop before removing
        const tab = this.tabs[index];
        if (tab.type === 'embed') {
            if (tab.heartbeatInterval) { clearInterval(tab.heartbeatInterval); tab.heartbeatInterval = null; }
            if (tab.embedHwnd && window.electronAPI?.releaseEmbedWindow) {
                window.electronAPI.releaseEmbedWindow({ hwnd: tab.embedHwnd });
            }
            if (tab.id === this.activeTabId) {
                const toolbar = document.getElementById('embed-toolbar');
                if (toolbar) toolbar.style.display = 'none';
            }
        }

        // Destroy the main-process WebContentsView for web tabs.
        if (tab.type === 'web' && window.electronAPI?.tab) {
            window.electronAPI.tab.close(tabId);
        }

        // Remove tab strip element (and the embed placeholder div, if any).
        const tabElement = document.getElementById(`tab-element-${tabId}`);
        const webview = document.getElementById(`webview-${tabId}`);

        if (tabElement) tabElement.remove();
        if (webview) webview.remove();

        this.tabs.splice(index, 1);

        // If closing active tab, switch to another
        if (this.activeTabId === tabId) {
            if (this.tabs.length > 0) {
                const newActiveTab = this.tabs[Math.max(0, index - 1)];
                this.switchTab(newActiveTab.id);
            } else {
                // Create new tab if all closed
                this.createTab();
            }
        }
    }

    navigate(input) {
        const tab = this.tabs.find(t => t.id === this.activeTabId);
        if (!tab) return;

        const url = this.formatUrl(input);
        tab.url = url;

        if (tab.type === 'web' && window.electronAPI?.tab) {
            window.electronAPI.tab.navigate(tab.id, url);
            window.electronAPI.tab.activate(tab.id);
            this._pushLayout();
            document.getElementById('welcome-screen').style.display = 'none';
        }

        document.getElementById('address-bar').value = url;
    }

    formatUrl(input) {
        if (!input) return 'about:blank';

        // If it looks like a URL
        if (input.startsWith('http://') || input.startsWith('https://') || input.startsWith('file://')) {
            return input;
        }

        // If it has a domain extension
        if (input.includes('.') && !input.includes(' ')) {
            return 'https://' + input;
        }

        // Otherwise, search
        return 'https://www.google.com/search?q=' + encodeURIComponent(input);
    }

    updateTabTitle(tabId, title) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) {
            tab.title = title || 'Untitled';
            const tabElement = document.getElementById(`tab-element-${tabId}`);
            if (tabElement) {
                const titleSpan = tabElement.querySelector('.tab-title');
                if (titleSpan) titleSpan.textContent = tab.title;
            }
        }
    }

    updateTabUrl(tabId, url) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) {
            tab.url = url;
            if (this.activeTabId === tabId) {
                document.getElementById('address-bar').value = url;
                this.updateSecurityIcon(url);
            }
        }
    }

    updateTabFavicon(tabId, faviconUrl) {
        const tabElement = document.getElementById(`tab-element-${tabId}`);
        if (tabElement) {
            const faviconElement = tabElement.querySelector('.tab-favicon');
            if (faviconElement) {
                faviconElement.innerHTML = `<img src="${faviconUrl}" width="16" height="16" />`;
            }
        }
    }

    updateLoadingState(tabId, isLoading) {
        const tabElement = document.getElementById(`tab-element-${tabId}`);
        if (tabElement) {
            if (isLoading) {
                tabElement.classList.add('loading');
            } else {
                tabElement.classList.remove('loading');
            }
        }
    }

    updateSecurityIcon(url) {
        const securityIcon = document.getElementById('security-icon');
        if (url && url.startsWith('https://')) {
            securityIcon.style.color = '#4CAF50';
            securityIcon.title = 'Secure Connection';
        } else {
            securityIcon.style.color = '#9e9e9e';
            securityIcon.title = 'Not Secure';
        }
    }

    goBack() {
        const tab = this.tabs.find(t => t.id === this.activeTabId);
        if (tab && tab.type === 'web' && window.electronAPI?.tab) window.electronAPI.tab.back(tab.id);
    }

    goForward() {
        const tab = this.tabs.find(t => t.id === this.activeTabId);
        if (tab && tab.type === 'web' && window.electronAPI?.tab) window.electronAPI.tab.forward(tab.id);
    }

    reload() {
        const tab = this.tabs.find(t => t.id === this.activeTabId);
        if (tab && tab.type === 'web' && window.electronAPI?.tab) window.electronAPI.tab.reload(tab.id);
    }

    goHome() {
        this.navigate('https://www.google.com');
    }

    toggleMainMenu() {
        const menu = document.getElementById('main-menu');
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }

    hideMainMenu() {
        document.getElementById('main-menu').style.display = 'none';
    }

    showSettings() {
        document.getElementById('settings-panel').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    hideSettings() {
        document.getElementById('settings-panel').style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    setupSettingsPanel() {
        // Close settings button
        document.getElementById('settings-close').addEventListener('click', () => {
            this.hideSettings();
        });

        // Close on overlay click
        document.querySelector('.settings-overlay').addEventListener('click', () => {
            this.hideSettings();
        });

        // Settings navigation
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.addEventListener('click', () => {
                // Remove active from all
                document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
                document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
                
                // Add active to clicked
                item.classList.add('active');
                const section = item.getAttribute('data-section');
                document.getElementById(`section-${section}`).classList.add('active');
            });
        });

        // Zoom controls
        document.getElementById('zoom-in').addEventListener('click', () => {
            this.adjustZoom(10);
        });

        document.getElementById('zoom-out').addEventListener('click', () => {
            this.adjustZoom(-10);
        });

        document.getElementById('zoom-range').addEventListener('input', (e) => {
            const zoom = parseInt(e.target.value);
            document.getElementById('zoom-display').textContent = `${zoom}%`;
        });

        // Clear data button
        document.getElementById('clear-data').addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all browsing data?')) {
                alert('Browsing data cleared successfully!');
            }
        });

        // Reset settings
        document.getElementById('reset-settings').addEventListener('click', () => {
            if (confirm('Reset all settings to default values?')) {
                alert('Settings reset successfully!');
            }
        });

        // Set user agent display
        const userAgent = navigator.userAgent;
        document.getElementById('user-agent').value = userAgent;

        // ── Screenshot Protection Toggle ────────────────────────────────────
        this.initScreenProtectionToggle();

        // ── Grammar Assistant Toggle ─────────────────────────────────────────
        this.initGrammarAssistantToggle();

        // ── Stealth Mode ─────────────────────────────────────────────────────
        this.initStealthToggle();

        // ── Monitoring Detector ───────────────────────────────────────────────
        this.initMonitoringDetector();

        // ── Quick Toggle Hotkey ───────────────────────────────────────────────
        this.initHotkey();

        // ── Check for Updates Button ─────────────────────────────────────────
        this.initUpdateCheckButton();

        // ── Load App Version ─────────────────────────────────────────────────
        this.loadAppVersion();
    }

    async loadAppVersion() {
        if (window.electronAPI && window.electronAPI.getVersion) {
            try {
                const version = await window.electronAPI.getVersion();
                const versionEl = document.querySelector('.about-info .version');
                if (versionEl) {
                    versionEl.textContent = `Version ${version}`;
                }
            } catch (e) {
                console.warn('Could not load app version:', e);
            }
        }
    }

    async initScreenProtectionToggle() {
        const toggle    = document.getElementById('screenshot-protection');
        const badge     = document.getElementById('screenshot-protection-status');
        const group     = document.querySelector('.screenshot-protection-group');
        const indicator = document.querySelector('.protection-indicator');

        if (!toggle) return;

        // Read saved preference (default = true / active)
        const saved = localStorage.getItem('proton_screenshot_protection');
        const initialState = saved === null ? true : saved === 'true';

        // Apply stored state on load
        this._applyScreenProtectionUI(toggle, badge, group, indicator, initialState);
        if (window.electronAPI && window.electronAPI.setScreenProtection) {
            await window.electronAPI.setScreenProtection(initialState);
        }

        // Listen for toggle changes
        toggle.addEventListener('change', async () => {
            const enabled = toggle.checked;
            localStorage.setItem('proton_screenshot_protection', String(enabled));
            this._applyScreenProtectionUI(toggle, badge, group, indicator, enabled);

            if (window.electronAPI && window.electronAPI.setScreenProtection) {
                try {
                    await window.electronAPI.setScreenProtection(enabled);
                    this.showScreenProtectionToast(enabled);
                } catch (err) {
                    console.error('Screenshot protection toggle failed:', err);
                }
            }
        });
    }

    // ── Grammar Assistant Toggle ─────────────────────────────────────────────
    initGrammarAssistantToggle() {
        const toggle = document.getElementById('grammar-assistant-toggle');
        const badge  = document.getElementById('grammar-assistant-status');
        const group  = document.getElementById('grammar-assistant-group');

        if (!toggle) return;

        // Default is OFF — only enable if user explicitly turned it on
        const saved   = localStorage.getItem('proton_grammar_enabled');
        const enabled = saved === 'true';

        this._applyGrammarUI(toggle, badge, group, enabled);

        // If it was ON when settings load, inject into the active webview now
        if (enabled) {
            this._grammarEnableAllWebviews();
        }

        toggle.addEventListener('change', () => {
            const on = toggle.checked;
            localStorage.setItem('proton_grammar_enabled', String(on));
            this._applyGrammarUI(toggle, badge, group, on);

            if (on) {
                this._grammarEnableAllWebviews();
                this._showGrammarToast(true);
            } else {
                this._grammarDisableAllWebviews();
                this._showGrammarToast(false);
            }
        });
    }

    async initStealthToggle() {
        const toggle   = document.getElementById('stealth-mode-toggle');
        const badge    = document.getElementById('stealth-badge');
        const codeInput = document.getElementById('stealth-code-input');
        const saveBtn  = document.getElementById('stealth-code-save');
        const runCmd   = document.getElementById('stealth-run-cmd');

        if (!toggle || !window.electronAPI) return;

        // Load current config from main process
        try {
            const cfg = await window.electronAPI.getStealthConfig();
            toggle.checked = cfg.stealthMode;
            if (codeInput) codeInput.value = cfg.secretCode || '';
            this._applyStealthUI(badge, cfg.stealthMode);
            if (runCmd) runCmd.textContent = `${cfg.secretCode || 'quantumx'}://`;
        } catch (e) {}

        toggle.addEventListener('change', async () => {
            const on = toggle.checked;
            this._applyStealthUI(badge, on);
            try { await window.electronAPI.setStealthMode(on); } catch (e) {}
        });

        if (saveBtn && codeInput) {
            saveBtn.addEventListener('click', async () => {
                const code = codeInput.value.trim();
                try {
                    const result = await window.electronAPI.setSecretCode(code);
                    if (result.success) {
                        if (runCmd) runCmd.textContent = `${code}://`;
                        saveBtn.textContent = '✓ Saved';
                        saveBtn.style.background = '#34a853';
                        setTimeout(() => {
                            saveBtn.textContent = 'Save';
                            saveBtn.style.background = '';
                        }, 2000);
                    } else {
                        saveBtn.textContent = 'Invalid';
                        saveBtn.style.background = '#ea4335';
                        setTimeout(() => {
                            saveBtn.textContent = 'Save';
                            saveBtn.style.background = '';
                        }, 2000);
                    }
                } catch (e) {}
            });

            // Update hint live as user types
            codeInput.addEventListener('input', () => {
                const val = codeInput.value.trim();
                if (runCmd && val.length >= 3) runCmd.textContent = `${val}://`;
            });
        }
    }

    initMonitoringDetector() {
        if (!window.electronAPI) return;
        const badge    = document.getElementById('monitor-badge');
        const icon     = document.getElementById('monitor-icon');
        const alert    = document.getElementById('monitor-alert');
        const appsList = document.getElementById('monitor-apps-list');
        const desc     = document.getElementById('monitor-desc');
        const scanBtn  = document.getElementById('monitor-scan-btn');
        if (!badge) return;

        const applyResult = (apps) => {
            if (apps && apps.length > 0) {
                badge.textContent = 'Threat Detected';
                badge.className = 'stealth-badge stealth-on';
                badge.style.background = 'rgba(239,68,68,0.2)';
                badge.style.borderColor = 'rgba(239,68,68,0.4)';
                badge.style.color = '#ef4444';
                if (icon) icon.textContent = '⚠️';
                if (alert) alert.style.display = 'block';
                if (appsList) appsList.textContent = apps.join(', ');
                if (desc) desc.textContent = 'Monitoring software is running on this computer.';
            } else {
                badge.textContent = 'Safe';
                badge.className = 'stealth-badge stealth-off';
                badge.style.background = '';
                badge.style.borderColor = '';
                badge.style.color = '';
                if (icon) icon.textContent = '🛡️';
                if (alert) alert.style.display = 'none';
                if (desc) desc.textContent = 'Scans for employee monitoring apps every 30 seconds.';
            }
        };

        // Load initial status
        try {
            window.electronAPI.getMonitoringStatus().then(r => applyResult(r.apps)).catch(() => {});
        } catch (e) {}

        // Scan button
        if (scanBtn) {
            scanBtn.addEventListener('click', async () => {
                scanBtn.textContent = 'Scanning…';
                scanBtn.disabled = true;
                try {
                    const r = await window.electronAPI.checkMonitoringApps();
                    applyResult(r.apps);
                } catch (e) {}
                scanBtn.textContent = 'Scan Now';
                scanBtn.disabled = false;
            });
        }

        // React to periodic background scan events
        try {
            window.electronAPI.onMonitoringDetected((data) => applyResult(data.apps));
        } catch (e) {}
    }

    _applyStealthUI(badge, enabled) {
        if (!badge) return;
        badge.textContent = enabled ? 'On' : 'Off';
        badge.className = 'stealth-badge ' + (enabled ? 'stealth-on' : 'stealth-off');
    }

    async initHotkey() {
        const input     = document.getElementById('hotkey-input');
        const recordBtn = document.getElementById('hotkey-record-btn');
        const saveBtn   = document.getElementById('hotkey-save-btn');
        const status    = document.getElementById('hotkey-status');
        if (!input || !window.electronAPI) return;

        // Load current hotkey
        try {
            const { hotkey } = await window.electronAPI.getHotkey();
            input.value = hotkey || '';
        } catch (e) {}

        let recording = false;

        const stopRecording = () => {
            recording = false;
            recordBtn.textContent = 'Record';
            recordBtn.style.background = '';
            input.removeEventListener('keydown', onKey);
        };

        const onKey = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const parts = [];
            if (e.ctrlKey)  parts.push('Ctrl');
            if (e.altKey)   parts.push('Alt');
            if (e.shiftKey) parts.push('Shift');
            if (e.metaKey)  parts.push('Super');
            const k = e.key;
            if (!['Control','Alt','Shift','Meta'].includes(k)) {
                if (k === ' ')        parts.push('Space');
                else if (k.length === 1) parts.push(k.toUpperCase());
                else                  parts.push(k);
            }
            if (parts.length > 1 || (parts.length === 1 && !['Ctrl','Alt','Shift','Super'].includes(parts[0]))) {
                input.value = parts.join('+');
                stopRecording();
            }
        };

        recordBtn.addEventListener('click', () => {
            if (recording) { stopRecording(); return; }
            recording = true;
            recordBtn.textContent = 'Press keys…';
            recordBtn.style.background = '#ef4444';
            input.value = '';
            status.textContent = '';
            input.focus();
            input.addEventListener('keydown', onKey);
        });

        saveBtn.addEventListener('click', async () => {
            const key = input.value.trim();
            if (!key) return;
            try {
                const res = await window.electronAPI.setHotkey(key);
                status.textContent = res.success ? `Shortcut set: ${res.hotkey}` : 'Failed to set shortcut';
            } catch (e) {
                status.textContent = 'Error saving shortcut';
            }
        });
    }

    _applyGrammarUI(toggle, badge, group, enabled) {
        toggle.checked = enabled;
        if (badge) {
            badge.textContent = enabled ? 'On' : 'Off';
            badge.className   = 'grammar-status-badge ' + (enabled ? 'grammar-status-on' : 'grammar-status-off');
        }
        if (group) {
            group.classList.toggle('grammar-on', enabled);
        }
    }

    _grammarEnableAllWebviews() {
        // Inject into every open web tab (WebContentsView shims)
        this.tabs.filter(t => t.type === 'web' && t.webview).forEach(t => {
            try {
                // First try to re-enable if already injected
                t.webview.executeJavaScript(
                    'window.__proton_grammar_enable && window.__proton_grammar_enable();'
                ).catch(() => {});
                // Then do a full inject (idempotent — guarded by __proton_grammar_v8__)
                this.injectGrammarAssistant(t.webview);
            } catch(e){}
        });
    }

    _grammarDisableAllWebviews() {
        this.tabs.filter(t => t.type === 'web' && t.webview).forEach(t => {
            try {
                t.webview.executeJavaScript(
                    'window.__proton_grammar_disable && window.__proton_grammar_disable();'
                ).catch(() => {});
            } catch(e){}
        });
    }

    _showGrammarToast(enabled) {
        document.querySelectorAll('.grammar-toast').forEach(t => t.remove());
        const toast = document.createElement('div');
        toast.className = 'grammar-toast';
        toast.style.cssText = [
            'position:fixed', 'bottom:24px', 'right:24px', 'z-index:99999',
            'background:' + (enabled ? 'rgba(168,85,247,.92)' : 'rgba(60,60,70,.90)'),
            'color:#fff', 'padding:10px 18px', 'border-radius:10px',
            'font-size:13px', 'font-weight:600', 'box-shadow:0 4px 20px rgba(0,0,0,.35)',
            'transition:opacity .3s', 'pointer-events:none'
        ].join(';');
        toast.textContent = enabled
            ? '✍️  Grammar Assistant enabled'
            : '✍️  Grammar Assistant disabled';
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 350);
        }, 2500);
    }

    // ── Check for Updates Button ─────────────────────────────────────────────
    initUpdateCheckButton() {
        const btn = document.querySelector('.about-button');
        if (!btn || !window.electronAPI) return;

        // Find the "Check for Updates" button (first button in about-buttons)
        const buttons = document.querySelectorAll('.about-button');
        const updateBtn = Array.from(buttons).find(b => b.textContent.includes('Check for Updates'));
        
        if (!updateBtn) return;

        updateBtn.addEventListener('click', async () => {
            if (!window.electronAPI.checkForUpdates) {
                this._showUpdateToast('Auto-updates not configured yet. See AUTO_UPDATE_SETUP.md', false);
                return;
            }

            // Show loading state
            const originalText = updateBtn.textContent;
            updateBtn.disabled = true;
            updateBtn.textContent = '🔄 Checking...';
            updateBtn.style.opacity = '0.6';
            updateBtn.style.cursor = 'wait';

            try {
                const result = await window.electronAPI.checkForUpdates();
                if (result && result.success) {
                    // Update notification will be shown by UpdateManager
                    this._showUpdateToast('Checking for updates...', true);
                } else {
                    this._showUpdateToast(result?.error || 'Failed to check for updates', false);
                }
            } catch (err) {
                console.error('Update check error:', err);
                this._showUpdateToast('Error checking for updates', false);
            } finally {
                // Restore button after 2 seconds
                setTimeout(() => {
                    updateBtn.disabled = false;
                    updateBtn.textContent = originalText;
                    updateBtn.style.opacity = '1';
                    updateBtn.style.cursor = 'pointer';
                }, 2000);
            }
        });
    }

    _showUpdateToast(message, isInfo = true) {
        document.querySelectorAll('.update-check-toast').forEach(t => t.remove());
        const toast = document.createElement('div');
        toast.className = 'update-check-toast';
        toast.style.cssText = [
            'position:fixed', 'bottom:24px', 'right:24px', 'z-index:99999',
            'background:' + (isInfo ? 'rgba(59,130,246,.92)' : 'rgba(239,68,68,.92)'),
            'color:#fff', 'padding:12px 20px', 'border-radius:10px',
            'font-size:13px', 'font-weight:600', 'box-shadow:0 4px 20px rgba(0,0,0,.35)',
            'transition:opacity .3s', 'pointer-events:none', 'max-width:350px'
        ].join(';');
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 350);
        }, 3000);
    }

    _applyScreenProtectionUI(toggle, badge, group, indicator, enabled) {
        toggle.checked = enabled;

        if (badge) {
            badge.textContent  = enabled ? 'Active' : 'Off';
            badge.className    = 'screenshot-status-badge ' + (enabled ? 'screenshot-status-on' : 'screenshot-status-off');
        }
        if (group) {
            group.classList.toggle('protection-off', !enabled);
        }
        // Also update the top-bar protection indicator if present
        if (indicator) {
            indicator.style.opacity = enabled ? '1' : '0.3';
            indicator.title = enabled ? 'Screenshot Protection Active' : 'Screenshot Protection Disabled';
        }
    }

    showScreenProtectionToast(enabled) {
        // Remove any existing toast
        document.querySelectorAll('.sp-toast').forEach(t => t.remove());
        const toast = document.createElement('div');
        toast.className = 'sp-toast';
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '32px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '99999',
            background: enabled ? 'rgba(22,101,52,.95)' : 'rgba(127,29,29,.95)',
            border: '1px solid ' + (enabled ? 'rgba(34,197,94,.5)' : 'rgba(239,68,68,.5)'),
            borderRadius: '12px',
            padding: '10px 24px',
            color: enabled ? '#86efac' : '#fca5a5',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: '13px',
            fontWeight: '700',
            boxShadow: '0 8px 32px rgba(0,0,0,.6)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            whiteSpace: 'nowrap',
            animation: 'fadeInUp .3s ease',
        });
        toast.innerHTML = (enabled
            ? '<span>🛡️</span><span>Screenshot Protection <strong>Enabled</strong> — Screen is now protected</span>'
            : '<span>⚠️</span><span>Screenshot Protection <strong>Disabled</strong> — Screen sharing is visible</span>');
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.transition = 'opacity .4s ease';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 400);
        }, 3500);
    }

    adjustZoom(delta) {
        const range = document.getElementById('zoom-range');
        let currentZoom = parseInt(range.value);
        currentZoom = Math.max(50, Math.min(200, currentZoom + delta));
        range.value = currentZoom;
        document.getElementById('zoom-display').textContent = `${currentZoom}%`;
    }

    handleMenuAction(action) {
        switch (action) {
            case 'new-tab':
                this.createTab();
                break;
            case 'new-window':
                alert('New window feature coming soon!');
                break;
            case 'close-tab':
                if (this.activeTabId) {
                    this.closeTab(this.activeTabId);
                }
                break;
            case 'reload':
                this.reload();
                break;
            case 'history':
                window.historyManager.show();
                break;
            case 'downloads':
                toggleDownloads();
                break;
            case 'bookmarks':
                window.bookmarkManager.show();
                break;
            case 'zoom':
                window.zoomManager.show();
                break;
            case 'print':
                const tab = this.tabs.find(t => t.id === this.activeTabId);
                if (tab && tab.webview) {
                    tab.webview.print();
                }
                break;
            case 'settings':
                this.showSettings();
                break;
            case 'about':
                this.showSettings();
                // Switch to about section
                document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
                document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
                document.querySelector('[data-section="about"]').classList.add('active');
                document.getElementById('section-about').classList.add('active');
                break;
            case 'exit':
                if (confirm('Are you sure you want to exit INDUS Browser?')) {
                    window.close();
                }
                break;
        }
    }

    setupEmbedFeature() {
        if (!window.electronAPI) return;

        // Capture App button → open window picker
        const captureBtn = document.getElementById('capture-app-btn');
        if (captureBtn) captureBtn.addEventListener('click', () => this._openWindowPicker());

        // Window picker modal close
        const modal = document.getElementById('window-picker-modal');
        const closeBtn = document.getElementById('window-picker-close');
        if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.remove('open'));
        if (modal) {
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
        }

        // Escape key closes the picker
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal?.classList.contains('open')) modal.classList.remove('open');
        });

        // Embed toolbar buttons
        const detachBtn = document.getElementById('embed-detach-btn');
        const embedCloseBtn = document.getElementById('embed-close-btn');
        if (detachBtn) {
            detachBtn.addEventListener('click', () => {
                const tab = this.tabs.find(t => t.id === this.activeTabId);
                if (tab?.type === 'embed') this.closeTab(tab.id);
            });
        }
        if (embedCloseBtn) {
            embedCloseBtn.addEventListener('click', () => {
                const tab = this.tabs.find(t => t.id === this.activeTabId);
                if (tab?.type === 'embed') this.closeTab(tab.id);
            });
        }

        // Drag-drop .exe onto webview container
        const container = document.getElementById('webview-container');
        if (container) {
            container.addEventListener('dragover', (e) => {
                if ([...e.dataTransfer.items].some(i => i.kind === 'file')) {
                    e.preventDefault();
                    container.classList.add('drag-over');
                }
            });
            container.addEventListener('dragleave', () => container.classList.remove('drag-over'));
            container.addEventListener('drop', async (e) => {
                e.preventDefault();
                container.classList.remove('drag-over');
                const file = e.dataTransfer.files[0];
                if (!file || !file.name.toLowerCase().endsWith('.exe')) return;
                await this._launchAndEmbedExe(file.path, file.name.replace(/\.exe$/i, ''));
            });

            // ResizeObserver — reposition the active embedded window when container resizes
            new ResizeObserver(() => {
                const active = this.tabs.find(t => t.id === this.activeTabId);
                if (active?.type === 'embed' && active.embedHwnd && window.electronAPI?.moveEmbedWindow) {
                    window.electronAPI.moveEmbedWindow({ hwnd: active.embedHwnd, ...this._containerBounds() });
                }
            }).observe(container);
        }
    }

    async triggerPiP() {
        const tab = this.tabs.find(t => t.id === this.activeTabId);
        if (!tab || tab.type !== 'web') {
            this.showNotification('Picture in Picture', 'Switch to a web tab first.');
            return;
        }
        const webview = tab.webview;
        if (!webview) return;

        try {
            // Snapshot existing windows BEFORE opening PiP so we can detect the new one
            await window.electronAPI?.prePipSnapshot?.();

            const result = await webview.executeJavaScript(`(function(){
                var vids = Array.from(document.querySelectorAll('video'));
                if (!vids.length) return 'no-video';
                var playing = vids.find(function(v){ return !v.paused && !v.ended && v.readyState > 2 && v.duration > 0; });
                var target = playing || vids.reduce(function(b, v){ return (v.videoWidth * v.videoHeight) > ((b.videoWidth||0)*(b.videoHeight||0)) ? v : b; }, vids[0]);
                if (!document.pictureInPictureEnabled) return 'unsupported';
                if (document.pictureInPictureElement === target){ document.exitPictureInPicture(); return 'exit'; }
                target.requestPictureInPicture();
                return 'ok';
            })()`);

            const pipBtn = document.getElementById('pip-btn');
            if (result === 'ok') {
                if (pipBtn) pipBtn.classList.add('pip-active');
                // Fallback: protect any window that appeared since the snapshot
                window.electronAPI?.postPipProtect?.();
            } else if (result === 'exit') {
                if (pipBtn) pipBtn.classList.remove('pip-active');
            } else if (result === 'no-video') {
                this.showNotification('Picture in Picture', 'No video found on this page.');
            } else if (result === 'unsupported') {
                this.showNotification('Picture in Picture', 'PiP not supported on this page.');
            }
        } catch (e) {
            this.showNotification('Picture in Picture', 'Could not activate PiP.');
        }
    }

    _updateEmbedToolbar(tab) {
        const titleEl = document.getElementById('embed-toolbar-title');
        const iconEl  = document.getElementById('embed-toolbar-icon');
        if (titleEl) titleEl.textContent = tab.title || 'App';
        if (iconEl) {
            if (tab.embedIcon) { iconEl.src = tab.embedIcon; iconEl.style.display = ''; }
            else iconEl.style.display = 'none';
        }
    }

    _startEmbedHeartbeat(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab || tab.type !== 'embed' || !window.electronAPI?.isWindowValid) return;
        tab.heartbeatInterval = setInterval(async () => {
            const t = this.tabs.find(x => x.id === tabId);
            if (!t) { clearInterval(tab.heartbeatInterval); return; }
            try {
                const valid = await window.electronAPI.isWindowValid({ hwnd: t.embedHwnd });
                if (!valid) {
                    clearInterval(t.heartbeatInterval);
                    t.heartbeatInterval = null;
                    this.showNotification('App Closed', `"${t.title}" was closed and the tab was removed.`);
                    this.closeTab(tabId);
                }
            } catch (e) {}
        }, 5000);
    }

    async _openWindowPicker() {
        const modal = document.getElementById('window-picker-modal');
        const list  = document.getElementById('window-picker-list');
        if (!modal || !list) return;

        list.innerHTML = '<div class="window-picker-empty">Loading windows…</div>';
        modal.classList.add('open');

        // Reset and focus search
        const rawSearch = document.getElementById('window-picker-search-input');
        if (rawSearch) rawSearch.value = '';

        let windows = [];
        try { windows = await window.electronAPI.getWindowsList(); } catch (e) {}

        if (!windows.length) {
            list.innerHTML = '<div class="window-picker-empty">No open windows found.</div>';
            return;
        }

        list.innerHTML = '';
        for (const { hwnd, title, exePath } of windows) {
            const safe = title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeExe = (exePath || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const item = document.createElement('div');
            item.className = 'window-picker-item';
            item.dataset.title = title.toLowerCase();
            item.innerHTML = `
                <div class="window-picker-item-row">
                    <span class="window-picker-item-icon">⊞</span>
                    <span class="window-picker-item-title">${safe}</span>
                </div>
                ${safeExe ? `<div class="window-picker-item-exepath">${safeExe}</div>` : ''}
            `;
            // Load icon asynchronously
            if (exePath && window.electronAPI?.getWindowIcon) {
                window.electronAPI.getWindowIcon({ exePath }).then(dataUrl => {
                    if (!dataUrl) return;
                    const iconEl = item.querySelector('.window-picker-item-icon');
                    if (iconEl) iconEl.outerHTML = `<img class="window-picker-item-img" src="${dataUrl}" alt="">`;
                }).catch(() => {});
            }
            item.addEventListener('click', async () => {
                modal.classList.remove('open');
                const b = this._containerBounds();
                try {
                    await window.electronAPI.embedWindow({ hwnd, ...b });
                    this.createEmbedTab(hwnd, title.substring(0, 30), exePath || '');
                } catch (e) {
                    this.showNotification('Embed Failed', 'Could not embed that window. Try again.');
                }
            });
            list.appendChild(item);
        }

        // Wire search filter (replace node to clear old listeners)
        const searchInput = document.getElementById('window-picker-search-input');
        if (searchInput) {
            const fresh = searchInput.cloneNode(true);
            searchInput.parentNode.replaceChild(fresh, searchInput);
            fresh.focus();
            fresh.addEventListener('input', () => {
                const q = fresh.value.toLowerCase();
                list.querySelectorAll('.window-picker-item').forEach(el => {
                    el.classList.toggle('hidden', q.length > 0 && !el.dataset.title.includes(q));
                });
            });
        }
    }

    async _launchAndEmbedExe(exePath, title) {
        const loader    = document.getElementById('launch-loader');
        const loaderMsg = document.getElementById('launch-loader-msg');
        if (loader) loader.classList.add('open');
        if (loaderMsg) loaderMsg.textContent = `Launching ${title}…`;

        const msgTimer = loaderMsg ? setTimeout(() => {
            loaderMsg.textContent = 'Waiting for window to appear…';
        }, 2500) : null;

        const b = this._containerBounds();
        try {
            const result = await window.electronAPI.launchAndEmbed({ exePath, ...b });
            if (result.success) {
                this.createEmbedTab(result.hwnd, title.substring(0, 30), exePath);
            } else {
                this.showNotification('Launch Failed', result.error || 'Window did not appear in time.');
            }
        } catch (e) {
            this.showNotification('Launch Error', 'An unexpected error occurred while launching the app.');
        } finally {
            if (msgTimer) clearTimeout(msgTimer);
            if (loader) loader.classList.remove('open');
        }
    }
}

// Initialize tab manager when DOM is ready
// Window Controls
function setupWindowControls() {
    const minimizeBtn = document.getElementById('minimize-btn');
    const maximizeBtn = document.getElementById('maximize-btn');
    const closeBtn = document.getElementById('close-btn');

    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            if (window.electronAPI && window.electronAPI.minimizeWindow) {
                window.electronAPI.minimizeWindow();
            }
        });
    }

    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', async () => {
            if (window.electronAPI && window.electronAPI.maximizeWindow) {
                window.electronAPI.maximizeWindow();
                // Update icon based on state
                setTimeout(async () => {
                    const isMax = await window.electronAPI.isMaximized();
                    updateMaximizeIcon(isMax);
                }, 100);
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (window.electronAPI && window.electronAPI.closeWindow) {
                window.electronAPI.closeWindow();
            }
        });
    }

    // Update maximize icon
    updateMaximizeIcon(false);
}

function updateMaximizeIcon(isMaximized) {
    // The maximize control is now a traffic-light dot (styled purely via CSS),
    // so we only update its tooltip — never its innerHTML.
    const maximizeBtn = document.getElementById('maximize-btn');
    if (!maximizeBtn) return;
    maximizeBtn.title = isMaximized ? 'Restore Down' : 'Maximize';
}

// Feature Managers
class BookmarkManager {
    constructor() {
        this.bookmarks = this.loadBookmarks();
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.render();
    }

    setupEventListeners() {
        document.getElementById('add-bookmark-btn')?.addEventListener('click', () => this.addCurrentPage());
        document.getElementById('bookmarks-close')?.addEventListener('click', () => this.close());
    }

    loadBookmarks() {
        try {
            return JSON.parse(localStorage.getItem('proton_bookmarks') || '[]');
        } catch {
            return [];
        }
    }

    saveBookmarks() {
        localStorage.setItem('proton_bookmarks', JSON.stringify(this.bookmarks));
    }

    addCurrentPage() {
        const activeTab = window.tabManager.getActiveTab();
        if (!activeTab || !activeTab.url) return;

        const bookmark = {
            id: Date.now(),
            title: activeTab.title || 'Untitled',
            url: activeTab.url,
            timestamp: Date.now()
        };

        this.bookmarks.unshift(bookmark);
        this.saveBookmarks();
        this.render();
    }

    deleteBookmark(id) {
        this.bookmarks = this.bookmarks.filter(b => b.id !== id);
        this.saveBookmarks();
        this.render();
    }

    render() {
        const list = document.getElementById('bookmarks-list');
        if (!list) return;

        if (this.bookmarks.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⭐</div>
                    <p>No bookmarks yet</p>
                </div>
            `;
            return;
        }

        list.innerHTML = this.bookmarks.map(bookmark => `
            <div class="bookmark-item" data-url="${bookmark.url}">
                <div class="bookmark-icon">⭐</div>
                <div class="bookmark-info">
                    <div class="bookmark-title">${this.escapeHtml(bookmark.title)}</div>
                    <div class="bookmark-url">${this.escapeHtml(bookmark.url)}</div>
                </div>
                <div class="bookmark-actions">
                    <button class="bookmark-action delete" data-id="${bookmark.id}" title="Delete">🗑️</button>
                </div>
            </div>
        `).join('');

        // Add click handlers
        list.querySelectorAll('.bookmark-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.bookmark-action')) {
                    const url = item.getAttribute('data-url');
                    window.tabManager.navigate(url);
                    this.close();
                }
            });
        });

        list.querySelectorAll('.bookmark-action.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.getAttribute('data-id'));
                this.deleteBookmark(id);
            });
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    show() {
        document.getElementById('bookmarks-panel').style.display = 'flex';
    }

    close() {
        document.getElementById('bookmarks-panel').style.display = 'none';
    }
}

class HistoryManager {
    constructor() {
        this.history = this.loadHistory();
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('history-close')?.addEventListener('click', () => this.close());
        document.getElementById('clear-history-btn')?.addEventListener('click', () => this.clearAll());
    }

    loadHistory() {
        try {
            return JSON.parse(localStorage.getItem('proton_history') || '[]');
        } catch {
            return [];
        }
    }

    saveHistory() {
        // Keep only last 1000 items
        if (this.history.length > 1000) {
            this.history = this.history.slice(0, 1000);
        }
        localStorage.setItem('proton_history', JSON.stringify(this.history));
    }

    addEntry(url, title) {
        if (!url || url.startsWith('about:') || url.startsWith('chrome:')) return;

        const entry = {
            id: Date.now(),
            url: url,
            title: title || 'Untitled',
            timestamp: Date.now()
        };

        this.history.unshift(entry);
        this.saveHistory();
    }

    clearAll() {
        if (confirm('Clear all browsing history?')) {
            this.history = [];
            this.saveHistory();
            this.render();
        }
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }

    render() {
        const list = document.getElementById('history-list');
        if (!list) return;

        if (this.history.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📜</div>
                    <p>No history yet</p>
                </div>
            `;
            return;
        }

        list.innerHTML = this.history.map(entry => `
            <div class="history-item" data-url="${entry.url}">
                <div class="history-icon">🌐</div>
                <div class="history-info">
                    <div class="history-title">${this.escapeHtml(entry.title)}</div>
                    <div class="history-url">${this.escapeHtml(entry.url)}</div>
                    <div class="history-time">${this.formatTime(entry.timestamp)}</div>
                </div>
            </div>
        `).join('');

        list.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const url = item.getAttribute('data-url');
                window.tabManager.navigate(url);
                this.close();
            });
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    show() {
        this.render();
        document.getElementById('history-panel').style.display = 'flex';
    }

    close() {
        document.getElementById('history-panel').style.display = 'none';
    }
}

class FindInPageManager {
    constructor() {
        this.isActive = false;
        this.currentMatch = 0;
        this.totalMatches = 0;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        const input = document.getElementById('find-input');
        const prevBtn = document.getElementById('find-prev');
        const nextBtn = document.getElementById('find-next');
        const closeBtn = document.getElementById('find-close');

        input?.addEventListener('input', (e) => this.search(e.target.value));
        input?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.shiftKey ? this.findPrevious() : this.findNext();
            }
        });

        prevBtn?.addEventListener('click', () => this.findPrevious());
        nextBtn?.addEventListener('click', () => this.findNext());
        closeBtn?.addEventListener('click', () => this.close());
    }

    show() {
        const findBar = document.getElementById('find-bar');
        findBar.style.display = 'flex';
        document.getElementById('find-input').focus();
        this.isActive = true;
    }

    close() {
        const findBar = document.getElementById('find-bar');
        findBar.style.display = 'none';
        this.isActive = false;
        
        // Stop finding in active webview
        const activeTab = window.tabManager.getActiveTab();
        if (activeTab?.webview) {
            activeTab.webview.stopFindInPage('clearSelection');
        }
    }

    search(text) {
        if (!text) {
            this.updateResults(0, 0);
            return;
        }

        const activeTab = window.tabManager.getActiveTab();
        if (activeTab?.webview) {
            activeTab.webview.findInPage(text);
        }
    }

    findNext() {
        const activeTab = window.tabManager.getActiveTab();
        const text = document.getElementById('find-input').value;
        if (activeTab?.webview && text) {
            activeTab.webview.findInPage(text, { forward: true });
        }
    }

    findPrevious() {
        const activeTab = window.tabManager.getActiveTab();
        const text = document.getElementById('find-input').value;
        if (activeTab?.webview && text) {
            activeTab.webview.findInPage(text, { forward: false });
        }
    }

    updateResults(current, total) {
        this.currentMatch = current;
        this.totalMatches = total;
        document.getElementById('find-results').textContent = `${current}/${total}`;
    }
}

class ZoomManager {
    constructor() {
        this.currentZoom = 100;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('zoom-in')?.addEventListener('click', () => this.zoomIn());
        document.getElementById('zoom-out')?.addEventListener('click', () => this.zoomOut());
        document.getElementById('zoom-reset')?.addEventListener('click', () => this.resetZoom());
    }

    show() {
        document.getElementById('zoom-controls').style.display = 'flex';
        setTimeout(() => this.hide(), 2000);
    }

    hide() {
        document.getElementById('zoom-controls').style.display = 'none';
    }

    zoomIn() {
        this.setZoom(this.currentZoom + 10);
    }

    zoomOut() {
        this.setZoom(this.currentZoom - 10);
    }

    resetZoom() {
        this.setZoom(100);
    }

    setZoom(level) {
        this.currentZoom = Math.max(25, Math.min(500, level));
        
        const activeTab = window.tabManager.getActiveTab();
        if (activeTab?.webview) {
            activeTab.webview.setZoomFactor(this.currentZoom / 100);
        }

        document.getElementById('zoom-level').textContent = `${this.currentZoom}%`;
        document.getElementById('zoom-value').textContent = `${this.currentZoom}%`;
        
        this.show();
    }

    getCurrentZoom() {
        return this.currentZoom;
    }
}

class VPNManager {
    constructor() {
        this.connected = false;
        this.connecting = false;
        this.selectedServer = null;
        this.connectionStartTime = null;
        this.durationInterval = null;
        this.servers = this.getVPNServers();
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderServerList();
    }

    getVPNServers() {
        return [
            { id: 1, country: 'United States', city: 'New York', flag: '🇺🇸', latency: 45, load: 35, premium: false },
            { id: 2, country: 'United States', city: 'Los Angeles', flag: '🇺🇸', latency: 38, load: 42, premium: false },
            { id: 3, country: 'United Kingdom', city: 'London', flag: '🇬🇧', latency: 28, load: 55, premium: false },
            { id: 4, country: 'Germany', city: 'Berlin', flag: '🇩🇪', latency: 32, load: 28, premium: false },
            { id: 5, country: 'Germany', city: 'Frankfurt', flag: '🇩🇪', latency: 30, load: 38, premium: false },
            { id: 6, country: 'France', city: 'Paris', flag: '🇫🇷', latency: 35, load: 45, premium: false },
            { id: 7, country: 'Netherlands', city: 'Amsterdam', flag: '🇳🇱', latency: 25, load: 52, premium: true },
            { id: 8, country: 'Switzerland', city: 'Zurich', flag: '🇨🇭', latency: 33, load: 22, premium: true },
            { id: 9, country: 'Canada', city: 'Toronto', flag: '🇨🇦', latency: 50, load: 38, premium: false },
            { id: 10, country: 'Japan', city: 'Tokyo', flag: '🇯🇵', latency: 120, load: 48, premium: false },
            { id: 11, country: 'Singapore', city: 'Singapore', flag: '🇸🇬', latency: 145, load: 55, premium: false },
            { id: 12, country: 'Australia', city: 'Sydney', flag: '🇦🇺', latency: 185, load: 42, premium: false },
            { id: 13, country: 'India', city: 'Mumbai', flag: '🇮🇳', latency: 155, load: 65, premium: false },
            { id: 14, country: 'Brazil', city: 'São Paulo', flag: '🇧🇷', latency: 165, load: 58, premium: false },
            { id: 15, country: 'South Korea', city: 'Seoul', flag: '🇰🇷', latency: 135, load: 45, premium: true },
            { id: 16, country: 'Spain', city: 'Madrid', flag: '🇪🇸', latency: 40, load: 35, premium: false },
            { id: 17, country: 'Italy', city: 'Milan', flag: '🇮🇹', latency: 38, load: 40, premium: false },
            { id: 18, country: 'Sweden', city: 'Stockholm', flag: '🇸🇪', latency: 35, load: 30, premium: true },
            { id: 19, country: 'Norway', city: 'Oslo', flag: '🇳🇴', latency: 37, load: 25, premium: true },
            { id: 20, country: 'Denmark', city: 'Copenhagen', flag: '🇩🇰', latency: 30, load: 32, premium: false },
            { id: 21, country: 'Poland', city: 'Warsaw', flag: '🇵🇱', latency: 35, load: 38, premium: false },
            { id: 22, country: 'Austria', city: 'Vienna', flag: '🇦🇹', latency: 32, load: 28, premium: false },
            { id: 23, country: 'Belgium', city: 'Brussels', flag: '🇧🇪', latency: 28, load: 42, premium: false },
            { id: 24, country: 'Ireland', city: 'Dublin', flag: '🇮🇪', latency: 30, load: 48, premium: false }
        ];
    }

    setupEventListeners() {
        document.getElementById('vpn-btn')?.addEventListener('click', () => this.toggle());
        document.getElementById('vpn-close')?.addEventListener('click', () => this.close());
        document.getElementById('vpn-connect-btn')?.addEventListener('click', () => this.toggleConnection());
        document.getElementById('vpn-server-search')?.addEventListener('input', (e) => this.filterServers(e.target.value));
        document.getElementById('vpn-server-sort')?.addEventListener('change', (e) => this.sortServers(e.target.value));
    }

    renderServerList(filter = '', sort = 'country') {
        const list = document.getElementById('vpn-server-list');
        if (!list) return;

        let servers = [...this.servers];

        // Filter
        if (filter) {
            servers = servers.filter(s => 
                s.country.toLowerCase().includes(filter.toLowerCase()) ||
                s.city.toLowerCase().includes(filter.toLowerCase())
            );
        }

        // Sort
        servers.sort((a, b) => {
            if (sort === 'latency') return a.latency - b.latency;
            if (sort === 'load') return a.load - b.load;
            return a.country.localeCompare(b.country);
        });

        list.innerHTML = servers.map(server => {
            const latencyClass = server.latency < 50 ? '' : server.latency < 100 ? 'medium' : 'high';
            const loadClass = server.load < 40 ? '' : server.load < 70 ? 'medium' : 'high';
            const isActive = this.selectedServer?.id === server.id;

            return `
                <div class="vpn-server-item ${isActive ? 'active' : ''}" data-server-id="${server.id}">
                    <div class="server-item-flag">${server.flag}</div>
                    <div class="server-item-info">
                        <div class="server-item-name">${server.country}</div>
                        <div class="server-item-location">${server.city}</div>
                    </div>
                    <div class="server-item-stats">
                        <div class="server-latency ${latencyClass}">${server.latency} ms</div>
                        <div class="server-load">${server.load}% load</div>
                        <div class="load-bar">
                            <div class="load-bar-fill ${loadClass}" style="width: ${server.load}%"></div>
                        </div>
                    </div>
                    ${server.premium ? '<span class="server-premium">PRO</span>' : ''}
                </div>
            `;
        }).join('');

        // Add click listeners
        list.querySelectorAll('.vpn-server-item').forEach(item => {
            item.addEventListener('click', () => {
                const serverId = parseInt(item.getAttribute('data-server-id'));
                this.selectServer(serverId);
            });
        });
    }

    filterServers(query) {
        const sort = document.getElementById('vpn-server-sort')?.value || 'country';
        this.renderServerList(query, sort);
    }

    sortServers(sortBy) {
        const query = document.getElementById('vpn-server-search')?.value || '';
        this.renderServerList(query, sortBy);
    }

    selectServer(serverId) {
        this.selectedServer = this.servers.find(s => s.id === serverId);
        if (this.selectedServer) {
            const serverDisplay = document.getElementById('vpn-selected-server');
            if (serverDisplay) {
                serverDisplay.querySelector('.server-flag').textContent = this.selectedServer.flag;
                serverDisplay.querySelector('.server-name').textContent = this.selectedServer.country;
                serverDisplay.querySelector('.server-location').textContent = this.selectedServer.city;
            }
            this.renderServerList();
        }
    }

    async toggleConnection() {
        if (this.connected) {
            this.disconnect();
        } else {
            this.connect();
        }
    }

    async connect() {
        if (this.connecting) return;

        if (!this.selectedServer) {
            // Auto-select best server (lowest latency)
            this.selectedServer = this.servers.reduce((best, server) => 
                server.latency < best.latency ? server : best
            );
            this.selectServer(this.selectedServer.id);
        }

        this.connecting = true;
        this.updateUI('connecting');

        // Simulate connection process
        await this.delay(2000);

        this.connected = true;
        this.connecting = false;
        this.connectionStartTime = Date.now();
        this.updateUI('connected');

        // Start duration timer
        this.startDurationTimer();

        // Simulate stats updates
        this.startStatsUpdates();

        console.log(`✅ VPN Connected to ${this.selectedServer.country} - ${this.selectedServer.city}`);
    }

    disconnect() {
        this.connected = false;
        this.connectionStartTime = null;
        this.stopDurationTimer();
        this.updateUI('disconnected');

        console.log('❌ VPN Disconnected');
    }

    updateUI(state) {
        const connectBtn = document.getElementById('vpn-connect-btn');
        const statusIndicator = document.getElementById('vpn-status-indicator');
        const statusText = document.getElementById('vpn-status-text');
        const vpnBtn = document.getElementById('vpn-btn');
        const stats = document.getElementById('vpn-stats');

        if (state === 'connected') {
            connectBtn.classList.add('connected');
            connectBtn.innerHTML = '<span class="vpn-connect-icon">🔒</span><span class="vpn-connect-text">Disconnect</span>';
            statusIndicator.classList.add('connected');
            statusIndicator.classList.remove('connecting');
            statusText.textContent = `Connected to ${this.selectedServer.country}`;
            statusText.style.color = '#10b981';
            vpnBtn.classList.add('connected');
            stats.style.display = 'grid';
        } else if (state === 'connecting') {
            connectBtn.classList.add('connecting');
            connectBtn.innerHTML = '<span class="vpn-connect-icon">⏳</span><span class="vpn-connect-text">Connecting...</span>';
            statusIndicator.classList.add('connecting');
            statusText.textContent = 'Connecting...';
            statusText.style.color = '#fbbf24';
        } else {
            connectBtn.classList.remove('connected', 'connecting');
            connectBtn.innerHTML = '<span class="vpn-connect-icon">🚀</span><span class="vpn-connect-text">Quick Connect</span>';
            statusIndicator.classList.remove('connected', 'connecting');
            statusText.textContent = 'Disconnected';
            statusText.style.color = '#6b7280';
            vpnBtn.classList.remove('connected');
            stats.style.display = 'none';
        }
    }

    startDurationTimer() {
        this.durationInterval = setInterval(() => {
            if (!this.connectionStartTime) return;

            const elapsed = Date.now() - this.connectionStartTime;
            const hours = Math.floor(elapsed / 3600000);
            const minutes = Math.floor((elapsed % 3600000) / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);

            const durationElem = document.getElementById('vpn-duration');
            if (durationElem) {
                durationElem.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }

    stopDurationTimer() {
        if (this.durationInterval) {
            clearInterval(this.durationInterval);
            this.durationInterval = null;
        }
    }

    startStatsUpdates() {
        // Simulate network stats
        setInterval(() => {
            if (!this.connected) return;

            const upload = Math.floor(Math.random() * 500) + 50;
            const download = Math.floor(Math.random() * 2000) + 100;

            document.getElementById('vpn-upload').textContent = `${upload} KB/s`;
            document.getElementById('vpn-download').textContent = `${download} KB/s`;
            document.getElementById('vpn-latency').textContent = `${this.selectedServer.latency} ms`;
        }, 2000);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    toggle() {
        const panel = document.getElementById('vpn-panel');
        if (panel.style.display === 'flex') {
            this.close();
        } else {
            this.show();
        }
    }

    show() {
        document.getElementById('vpn-panel').style.display = 'flex';
    }

    close() {
        document.getElementById('vpn-panel').style.display = 'none';
    }
}

class DownloadManager {
    constructor() {
        this.downloads = [];
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupElectronHandlers();
    }

    setupEventListeners() {
        // YouTube download
        document.getElementById('youtube-download-btn')?.addEventListener('click', () => this.showYouTubeModal());
        document.getElementById('youtube-modal-close')?.addEventListener('click', () => this.closeYouTubeModal());
        document.getElementById('youtube-fetch-btn')?.addEventListener('click', () => this.fetchYouTubeInfo());
        document.getElementById('youtube-start-download-btn')?.addEventListener('click', () => this.startYouTubeDownload());

        // Torrent download
        document.getElementById('torrent-download-btn')?.addEventListener('click', () => this.showTorrentModal());
        document.getElementById('torrent-modal-close')?.addEventListener('click', () => this.closeTorrentModal());
        document.getElementById('torrent-start-download-btn')?.addEventListener('click', () => this.startTorrentDownload());

        // Open downloads folder
        document.getElementById('open-downloads-folder-btn')?.addEventListener('click', () => this.openDownloadsFolder());

        // Close downloads panel
        document.getElementById('downloads-close')?.addEventListener('click', () => this.close());

        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentFilter = e.target.getAttribute('data-filter');
                this.render();
            });
        });

        // Batch actions
        document.getElementById('clear-completed-btn')?.addEventListener('click', () => this.clearCompleted());
        
        this.currentFilter = 'all';
    }

    setupElectronHandlers() {
        if (window.electronAPI) {
            window.electronAPI.onDownloadStarted((data) => this.handleDownloadStarted(data));
            window.electronAPI.onDownloadProgress((data) => this.handleDownloadProgress(data));
            window.electronAPI.onDownloadComplete((data) => this.handleDownloadComplete(data));
        }
    }

    handleDownloadStarted(data) {
        const download = {
            id: data.id,
            fileName: data.fileName,
            totalBytes: data.totalBytes || 0,
            receivedBytes: 0,
            progress: 0,
            state: 'progressing',
            type: data.type || 'file',
            startTime: Date.now()
        };

        this.downloads.unshift(download);
        this.render();
        console.log(`⬇️ Download started: ${data.fileName}`);
    }

    handleDownloadProgress(data) {
        const download = this.downloads.find(d => d.id === data.id);
        if (download) {
            download.receivedBytes = data.receivedBytes;
            download.totalBytes = data.totalBytes;
            download.progress = data.progress;
            download.downloadSpeed = data.downloadSpeed;
            download.numPeers = data.numPeers;
            this.updateDownloadUI(download);
        }
    }

    handleDownloadComplete(data) {
        const download = this.downloads.find(d => d.id === data.id);
        if (download) {
            download.state = data.state;
            download.filePath = data.filePath;
            download.endTime = Date.now();
            this.updateDownloadUI(download);
            
            if (data.state === 'completed') {
                console.log(`✅ Download completed: ${data.fileName}`);
            }
        }
    }

    updateDownloadUI(download) {
        const elem = document.getElementById(`download-${download.id}`);
        if (elem) {
            const progressBar = elem.querySelector('.download-progress-bar');
            const statusText = elem.querySelector('.download-status');
            const speedText = elem.querySelector('.download-speed');

            if (progressBar) {
                progressBar.style.width = `${download.progress || 0}%`;
            }

            if (statusText) {
                if (download.state === 'completed') {
                    statusText.textContent = '✅ Completed';
                    statusText.style.color = '#10b981';
                } else if (download.state === 'failed' || download.state === 'interrupted') {
                    statusText.textContent = '❌ Failed';
                    statusText.style.color = '#ef4444';
                } else {
                    const percent = Math.round(download.progress || 0);
                    const received = this.formatBytes(download.receivedBytes || 0);
                    const total = this.formatBytes(download.totalBytes || 0);
                    statusText.textContent = `${percent}% • ${received} / ${total}`;
                }
            }

            if (speedText && download.downloadSpeed) {
                const speed = this.formatBytes(download.downloadSpeed);
                const peers = download.numPeers ? ` • ${download.numPeers} peers` : '';
                speedText.textContent = `⚡ ${speed}/s${peers}`;
            }
        }
    }

    render() {
        const list = document.getElementById('downloads-list');
        if (!list) return;

        // Filter downloads
        let filteredDownloads = this.downloads;
        if (this.currentFilter === 'downloading') {
            filteredDownloads = this.downloads.filter(d => d.state === 'progressing' || d.state === 'paused');
        } else if (this.currentFilter === 'completed') {
            filteredDownloads = this.downloads.filter(d => d.state === 'completed');
        } else if (this.currentFilter === 'failed') {
            filteredDownloads = this.downloads.filter(d => d.state === 'failed' || d.state === 'interrupted');
        }

        // Update stats
        const activeCount = this.downloads.filter(d => d.state === 'progressing').length;
        const totalSpeed = this.downloads
            .filter(d => d.state === 'progressing')
            .reduce((sum, d) => sum + (d.downloadSpeed || 0), 0);
        
        document.getElementById('download-count').textContent = `${activeCount} active`;
        document.getElementById('download-speed').textContent = this.formatBytes(totalSpeed) + '/s';

        if (filteredDownloads.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📥</div>
                    <p>No downloads ${this.currentFilter !== 'all' ? 'in this category' : 'yet'}</p>
                    <span class="empty-subtitle">Downloads will appear here automatically</span>
                </div>
            `;
            return;
        }

        list.innerHTML = filteredDownloads.map(download => {
            const fileIcon = this.getFileIcon(download.fileName);
            const typeBadge = download.type !== 'file' ? `<span class="download-type-badge">${download.type}</span>` : '';
            const stateBadge = this.getStateBadge(download.state);
            
            return `
                <div class="download-item" id="download-${download.id}">
                    <div class="download-item-header">
                        <span class="download-file-icon">${fileIcon}</span>
                        <div class="download-item-info">
                            <div class="download-name">
                                ${this.escapeHtml(download.fileName)}
                                ${typeBadge}
                                ${stateBadge}
                            </div>
                            <div class="download-meta">
                                <span>${this.formatBytes(download.totalBytes)}</span>
                                ${download.startTime ? `<span>•</span><span>${this.getTimeAgo(download.startTime)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="download-progress-container">
                        <div class="download-progress">
                            <div class="download-progress-bar" style="width: ${download.progress || 0}%"></div>
                        </div>
                        <div class="download-progress-text">
                            <div class="download-status-left">
                                <span>${Math.round(download.progress || 0)}%</span>
                                <span>•</span>
                                <span>${this.formatBytes(download.receivedBytes || 0)} / ${this.formatBytes(download.totalBytes || 0)}</span>
                                ${download.downloadSpeed ? `<span>•</span><span>⚡ ${this.formatBytes(download.downloadSpeed)}/s</span>` : ''}
                                ${download.numPeers ? `<span>•</span><span>🌐 ${download.numPeers} peers</span>` : ''}
                            </div>
                            ${download.endTime ? `<div class="download-status-right">${this.getDownloadTime(download)}</div>` : ''}
                        </div>
                    </div>
                    ${this.getControlButtons(download)}
                </div>
            `;
        }).join('');

        // Add event listeners for control buttons
        this.attachControlListeners();
    }

    attachControlListeners() {
        const list = document.getElementById('downloads-list');
        if (!list) return;

        list.querySelectorAll('.download-control-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.getAttribute('data-action');
                const id = e.currentTarget.getAttribute('data-id');
                const download = this.downloads.find(d => d.id === id);
                
                if (!download) return;

                switch (action) {
                    case 'open':
                        if (download.filePath) {
                            window.electronAPI.openPath(download.filePath);
                        }
                        break;
                    case 'show':
                        if (download.filePath) {
                            window.electronAPI.showItemInFolder(download.filePath);
                        }
                        break;
                    case 'retry':
                        this.retryDownload(download);
                        break;
                    case 'remove':
                        this.removeDownload(id);
                        break;
                }
            });
        });
    }

    getFileIcon(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        const iconMap = {
            'mp4': '🎬', 'avi': '🎬', 'mkv': '🎬', 'mov': '🎬',
            'mp3': '🎵', 'wav': '🎵', 'flac': '🎵',
            'pdf': '📄', 'doc': '📄', 'docx': '📄', 'txt': '📄',
            'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️',
            'zip': '📦', 'rar': '📦', '7z': '📦',
            'exe': '⚙️', 'msi': '⚙️',
            'torrent': '🧲'
        };
        return iconMap[ext] || '📥';
    }

    getStateBadge(state) {
        const badgeMap = {
            'progressing': '<span class="download-state-badge downloading">⬇️ Downloading</span>',
            'completed': '<span class="download-state-badge completed">✅ Complete</span>',
            'paused': '<span class="download-state-badge paused">⏸️ Paused</span>',
            'failed': '<span class="download-state-badge failed">❌ Failed</span>',
            'interrupted': '<span class="download-state-badge failed">❌ Interrupted</span>'
        };
        return badgeMap[state] || '';
    }

    getControlButtons(download) {
        const buttons = [];

        if (download.state === 'completed') {
            buttons.push(`<button class="download-control-btn open-btn" data-action="open" data-id="${download.id}">📂 Open File</button>`);
            buttons.push(`<button class="download-control-btn" data-action="show" data-id="${download.id}">📁 Show in Folder</button>`);
            buttons.push(`<button class="download-control-btn" data-action="remove" data-id="${download.id}">🗑️ Remove</button>`);
        } else if (download.state === 'failed' || download.state === 'interrupted') {
            buttons.push(`<button class="download-control-btn retry-btn" data-action="retry" data-id="${download.id}">↻ Retry</button>`);
            buttons.push(`<button class="download-control-btn" data-action="remove" data-id="${download.id}">🗑️ Remove</button>`);
        } else if (download.state === 'progressing') {
            buttons.push(`<button class="download-control-btn cancel-btn" data-action="remove" data-id="${download.id}">✕ Cancel</button>`);
        }

        return buttons.length > 0 ? `<div class="download-controls">${buttons.join('')}</div>` : '';
    }

    getTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    getDownloadTime(download) {
        if (!download.endTime || !download.startTime) return '';
        const duration = (download.endTime - download.startTime) / 1000;
        if (duration < 60) return `${Math.round(duration)}s`;
        if (duration < 3600) return `${Math.floor(duration / 60)}m ${Math.round(duration % 60)}s`;
        return `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`;
    }

    removeDownload(id) {
        this.downloads = this.downloads.filter(d => d.id !== id);
        this.render();
    }

    retryDownload(download) {
        alert('Retry functionality will be available with YouTube/Torrent packages installed.');
    }

    clearCompleted() {
        this.downloads = this.downloads.filter(d => d.state !== 'completed');
        this.render();
    }

    getStatusText(download) {
        if (download.state === 'completed') {
            return '✅ Completed';
        } else if (download.state === 'failed' || download.state === 'interrupted') {
            return '❌ Failed';
        } else {
            const percent = Math.round(download.progress || 0);
            const received = this.formatBytes(download.receivedBytes || 0);
            const total = this.formatBytes(download.totalBytes || 0);
            return `${percent}% • ${received} / ${total}`;
        }
    }

    // YouTube Functions
    showYouTubeModal() {
        document.getElementById('youtube-modal').style.display = 'flex';
        document.getElementById('youtube-info').style.display = 'none';
        document.getElementById('youtube-url-input').value = '';
    }

    closeYouTubeModal() {
        document.getElementById('youtube-modal').style.display = 'none';
    }

    async fetchYouTubeInfo() {
        const url = document.getElementById('youtube-url-input').value.trim();
        if (!url) {
            alert('Please enter a YouTube URL');
            return;
        }

        const btn = document.getElementById('youtube-fetch-btn');
        btn.textContent = 'Loading...';
        btn.disabled = true;

        try {
            const result = await window.electronAPI.getYouTubeInfo(url);
            
            if (result.success) {
                document.getElementById('youtube-thumbnail').src = result.thumbnail;
                document.getElementById('youtube-title').textContent = result.title;
                
                const select = document.getElementById('youtube-quality-select');
                select.innerHTML = result.formats.map(f => 
                    `<option value="${f.itag}">${f.quality} (${f.format}) - ${f.size}</option>`
                ).join('');
                
                document.getElementById('youtube-info').style.display = 'block';
            } else {
                alert(`Error: ${result.error}`);
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            btn.textContent = 'Get Video Info';
            btn.disabled = false;
        }
    }

    async startYouTubeDownload() {
        const url = document.getElementById('youtube-url-input').value.trim();
        const quality = document.getElementById('youtube-quality-select').value;

        if (!url || !quality) {
            alert('Please select a quality');
            return;
        }

        const btn = document.getElementById('youtube-start-download-btn');
        btn.textContent = 'Starting Download...';
        btn.disabled = true;

        try {
            await window.electronAPI.downloadYouTube(url, quality);
            this.closeYouTubeModal();
            alert('YouTube download started! Check downloads panel.');
        } catch (error) {
            alert(`Error: ${error.message || 'Download failed'}`);
        } finally {
            btn.textContent = '⬇️ Start Download';
            btn.disabled = false;
        }
    }

    // Torrent Functions
    showTorrentModal() {
        document.getElementById('torrent-modal').style.display = 'flex';
        document.getElementById('torrent-url-input').value = '';
    }

    closeTorrentModal() {
        document.getElementById('torrent-modal').style.display = 'none';
    }

    async startTorrentDownload() {
        const magnetOrUrl = document.getElementById('torrent-url-input').value.trim();
        
        if (!magnetOrUrl) {
            alert('Please enter a magnet link or torrent URL');
            return;
        }

        const btn = document.getElementById('torrent-start-download-btn');
        btn.textContent = 'Starting Torrent...';
        btn.disabled = true;

        try {
            const result = await window.electronAPI.downloadTorrent(magnetOrUrl);
            
            if (result.success) {
                this.closeTorrentModal();
                alert(`Torrent download started!\nName: ${result.name}\nSize: ${this.formatBytes(result.size)}\nFiles: ${result.files.length}`);
            } else {
                alert(`Error: ${result.error}`);
            }
        } catch (error) {
            alert(`Error: ${error.message || 'Torrent download failed'}`);
        } finally {
            btn.textContent = '⬇️ Start Torrent Download';
            btn.disabled = false;
        }
    }

    async openDownloadsFolder() {
        if (window.electronAPI) {
            await window.electronAPI.openDownloadsFolder();
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    show() {
        document.getElementById('downloads-panel').style.display = 'flex';
        this.render();
    }

    close() {
        document.getElementById('downloads-panel').style.display = 'none';
    }
}

// Keyboard Shortcuts Handler
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const alt = e.altKey;

        // Ctrl+T - New Tab
        if (ctrl && e.key === 't') {
            e.preventDefault();
            window.tabManager.createTab();
        }

        // Ctrl+W - Close Tab
        if (ctrl && e.key === 'w') {
            e.preventDefault();
            window.tabManager.closeTab(window.tabManager.activeTabId);
        }

        // Ctrl+Tab - Next Tab
        if (ctrl && e.key === 'Tab' && !shift) {
            e.preventDefault();
            window.tabManager.nextTab();
        }

        // Ctrl+Shift+Tab - Previous Tab
        if (ctrl && shift && e.key === 'Tab') {
            e.preventDefault();
            window.tabManager.previousTab();
        }

        // Ctrl+R or F5 - Reload
        if ((ctrl && e.key === 'r') || e.key === 'F5') {
            e.preventDefault();
            window.tabManager.reload();
        }

        // Ctrl+L - Focus Address Bar
        if (ctrl && e.key === 'l') {
            e.preventDefault();
            document.getElementById('address-bar').select();
        }

        // Ctrl+F - Find in Page
        if (ctrl && e.key === 'f') {
            e.preventDefault();
            window.findManager.show();
        }

        // Ctrl+H - History
        if (ctrl && e.key === 'h') {
            e.preventDefault();
            window.historyManager.show();
        }

        // Ctrl+B - Bookmarks
        if (ctrl && e.key === 'b') {
            e.preventDefault();
            window.bookmarkManager.show();
        }

        // Ctrl+J - Downloads
        if (ctrl && e.key === 'j') {
            e.preventDefault();
            toggleDownloads();
        }

        // Ctrl+P - Print
        if (ctrl && e.key === 'p') {
            e.preventDefault();
            printPage();
        }

        // Ctrl++ - Zoom In
        if (ctrl && (e.key === '+' || e.key === '=')) {
            e.preventDefault();
            window.zoomManager.zoomIn();
        }

        // Ctrl+- - Zoom Out
        if (ctrl && e.key === '-') {
            e.preventDefault();
            window.zoomManager.zoomOut();
        }

        // Ctrl+0 - Reset Zoom
        if (ctrl && e.key === '0') {
            e.preventDefault();
            window.zoomManager.resetZoom();
        }

        // F12 - Developer Tools
        if (e.key === 'F12') {
            e.preventDefault();
            openDevTools();
        }

        // Alt+Left - Back
        if (alt && e.key === 'ArrowLeft') {
            e.preventDefault();
            window.tabManager.goBack();
        }

        // Alt+Right - Forward
        if (alt && e.key === 'ArrowRight') {
            e.preventDefault();
            window.tabManager.goForward();
        }

        // Alt+P - Picture in Picture
        if (e.altKey && e.key === 'p') {
            e.preventDefault();
            if (window.tabManager) window.tabManager.triggerPiP();
            return;
        }

        // Ctrl+Shift+? - Show Shortcuts
        if (ctrl && shift && e.key === '?') {
            e.preventDefault();
            showShortcuts();
        }

        // Escape - Close panels
        if (e.key === 'Escape') {
            closeAllPanels();
        }
    });
}

// Helper Functions
function printPage() {
    const activeTab = window.tabManager.getActiveTab();
    if (activeTab?.webview) {
        activeTab.webview.print();
    }
}

function openDevTools() {
    const activeTab = window.tabManager.getActiveTab();
    if (activeTab?.webview) {
        activeTab.webview.openDevTools();
    }
}

function showShortcuts() {
    document.getElementById('shortcuts-panel').style.display = 'flex';
}

function closeAllPanels() {
    document.getElementById('bookmarks-panel').style.display = 'none';
    document.getElementById('downloads-panel').style.display = 'none';
    document.getElementById('history-panel').style.display = 'none';
    document.getElementById('find-bar').style.display = 'none';
    document.getElementById('shortcuts-panel').style.display = 'none';
    document.getElementById('settings-panel').style.display = 'none';
    document.getElementById('vpn-panel').style.display = 'none';
    const lanPanel = document.getElementById('lan-panel');
    if (lanPanel) lanPanel.style.display = 'none';
    if (window.lanManager) window.lanManager.isOpen = false;
}

// Close modal/panel overlays on click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeAllPanels();
    }
});

document.getElementById('shortcuts-close')?.addEventListener('click', () => {
    document.getElementById('shortcuts-panel').style.display = 'none';
});

// Enhanced Tab Manager Methods
TabManager.prototype.getActiveTab = function() {
    return this.tabs.find(tab => tab.id === this.activeTabId);
};

TabManager.prototype.nextTab = function() {
    const currentIndex = this.tabs.findIndex(tab => tab.id === this.activeTabId);
    const nextIndex = (currentIndex + 1) % this.tabs.length;
    this.switchTab(this.tabs[nextIndex].id);
};

TabManager.prototype.previousTab = function() {
    const currentIndex = this.tabs.findIndex(tab => tab.id === this.activeTabId);
    const prevIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
    this.switchTab(this.tabs[prevIndex].id);
};

// Update toggle downloads to use manager
function toggleDownloads() {
    window.downloadManager.show();
}

// Update Manager
class UpdateManager {
    constructor() {
        this.init();
    }
    
    init() {
        if (!window.electronAPI) return;
        
        // Listen for update events
        window.electronAPI.onUpdateAvailable?.((info) => {
            this.showUpdateNotification('Update Available', `Version ${info.version} is available!`, false, true);
        });
        
        window.electronAPI.onUpdateDownloadProgress?.((progress) => {
            this.updateProgress(progress.percent);
            const message = `Downloading update... ${Math.round(progress.percent)}%`;
            document.getElementById('update-message').textContent = message;
        });
        
        window.electronAPI.onUpdateDownloaded?.((info) => {
            this.showUpdateNotification('Update Ready', `Version ${info.version} is ready to install`, true);
        });
        
        window.electronAPI.onUpdateNotAvailable?.((info) => {
            console.log('App is up to date');
        });
        
        window.electronAPI.onUpdateError?.((error) => {
            // Only show to user if it looks like a real/configured update failure
            // Suppress all 404 / placeholder / network errors silently
            const msg = String(error || '');
            const isSilent =
                msg.includes('404') ||
                msg.includes('YOUR_GITHUB_USERNAME') ||
                msg.includes('ENOTFOUND') ||
                msg.includes('ECONNREFUSED') ||
                msg.includes('ETIMEDOUT') ||
                msg.includes('net::ERR') ||
                msg.includes('releases.atom');
            if (isSilent) {
                console.log('ℹ️  Auto-update check skipped (not configured).');
                return;
            }
            console.error('Update error:', error);
            this.showUpdateNotification('Update Error', error, false);
        });
        
        // Close button
        document.getElementById('update-close')?.addEventListener('click', () => {
            this.hideNotification();
        });
    }
    
    showUpdateNotification(title, message, showRestart = false, showDownload = false) {
        const notification = document.getElementById('update-notification');
        const titleEl = notification.querySelector('.update-title');
        const messageEl = notification.querySelector('.update-message');
        
        if (!notification || !titleEl || !messageEl) return;
        
        titleEl.textContent = title;
        messageEl.textContent = message;
        notification.classList.remove('hidden');
        
        // Remove existing buttons
        const existingBtns = notification.querySelectorAll('.update-restart-btn, .update-download-btn');
        existingBtns.forEach(btn => btn.remove());
        
        if (showDownload) {
            const downloadBtn = document.createElement('button');
            downloadBtn.textContent = 'Download Update';
            downloadBtn.className = 'update-download-btn';
            downloadBtn.onclick = async () => {
                downloadBtn.disabled = true;
                downloadBtn.textContent = 'Downloading...';
                try {
                    if (window.electronAPI && window.electronAPI.downloadUpdate) {
                        const result = await window.electronAPI.downloadUpdate();
                        if (!result || !result.success) {
                            downloadBtn.textContent = 'Download Failed';
                            setTimeout(() => downloadBtn.remove(), 3000);
                        }
                        // Progress will be shown via update-download-progress event
                    }
                } catch (err) {
                    console.error('Download error:', err);
                    downloadBtn.textContent = 'Download Failed';
                    setTimeout(() => downloadBtn.remove(), 3000);
                }
            };
            messageEl.parentElement.appendChild(downloadBtn);
        }
        
        if (showRestart) {
            const restartBtn = document.createElement('button');
            restartBtn.textContent = 'Restart Now';
            restartBtn.className = 'update-restart-btn';
            restartBtn.onclick = () => {
                if (window.electronAPI && window.electronAPI.quitAndInstall) {
                    window.electronAPI.quitAndInstall();
                }
            };
            messageEl.parentElement.appendChild(restartBtn);
        }
    }
    
    updateProgress(percent) {
        const progressBar = document.getElementById('update-progress-bar');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
    }
    
    hideNotification() {
        const notification = document.getElementById('update-notification');
        if (notification) {
            notification.classList.add('hidden');
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.tabManager = new TabManager();
    window.bookmarkManager = new BookmarkManager();
    window.historyManager = new HistoryManager();
    window.findManager = new FindInPageManager();
    window.zoomManager = new ZoomManager();
    window.downloadManager = new DownloadManager();
    window.vpnManager = new VPNManager();
    window.updateManager = new UpdateManager();
    window.lanManager = new LANManager();
    
    setupWindowControls();
    setupKeyboardShortcuts();
    
    // Show protection status
    console.log('%c⚡ QuantumX', 'color: #fbbf24; font-size: 20px; font-weight: bold;');
    console.log('%c🔒 Screenshot Protection Active', 'color: #10b981; font-size: 16px; font-weight: bold;');
    console.log('%c🛡️ Built-in VPN with 24 servers worldwide', 'color: #10b981; font-size: 14px;');
    console.log('%c⚡ Lightning-Fast Performance Mode Enabled', 'color: #fcd34d; font-size: 14px;');
    console.log('%c⌨️ Press Ctrl+Shift+? to see all keyboard shortcuts', 'color: #fbbf24; font-size: 12px;');
    console.log('%c📥 Download YouTube videos, torrents & more! (Ctrl+J)', 'color: #fbbf24; font-size: 12px;');
    console.log('Third-party apps cannot capture this browser window.');
});

// ── LAN Office Chat & File Sharing Manager ──────────────────────────────────
class LANManager {
    constructor() {
        this.isOpen = false;
        this.unreadMessages = 0;
        this.myIp = '127.0.0.1';
        this.myPort = 55055;
        this.myUsername = 'Colleague';
        this.activeTab = 'chat';
        this.init();
    }

    async init() {
        if (!window.electronAPI) return;

        this.setupEventListeners();
        await this.loadStatus();
        await this.loadHistory();
        this.listenForEvents();
    }

    setupEventListeners() {
        document.getElementById('lan-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        document.getElementById('lan-close')?.addEventListener('click', () => this.close());

        document.getElementById('lan-username-save-btn')?.addEventListener('click', () => this.saveUsername());
        document.getElementById('lan-username-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.saveUsername();
        });

        document.querySelectorAll('.lan-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.getAttribute('data-tab');
                this.switchTab(tab);
            });
        });

        document.getElementById('lan-send-btn')?.addEventListener('click', () => this.sendMessage());
        document.getElementById('lan-message-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendMessage();
            }
        });

        document.getElementById('lan-attach-btn')?.addEventListener('click', () => this.shareFile());

        document.getElementById('lan-manual-connect')?.addEventListener('click', () => this.addPeerManual());
        document.getElementById('lan-manual-ip')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPeerManual();
        });
        
        // Prevent closing panel when clicking inside it
        document.getElementById('lan-panel')?.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    async loadStatus() {
        try {
            const status = await window.electronAPI.lanGetStatus();
            this.myUsername = status.username;
            this.myIp = status.ip;
            this.myPort = status.port;

            const nameEl = document.getElementById('lan-status-username');
            if (nameEl) nameEl.textContent = this.myUsername;

            const ipEl = document.getElementById('lan-status-ip');
            if (ipEl) ipEl.textContent = `${this.myIp}:${this.myPort}`;

            const inputEl = document.getElementById('lan-username-input');
            if (inputEl) inputEl.value = this.myUsername;
        } catch (e) {
            console.error('[LAN] Error loading status:', e);
        }
    }

    async loadHistory() {
        try {
            const history = await window.electronAPI.lanGetHistory();
            const listEl = document.getElementById('lan-messages-list');
            if (!listEl) return;

            listEl.innerHTML = '';
            history.forEach(msg => this.appendMessage(msg));
            this.scrollToBottom();
            
            this.rebuildFilesList(history);
        } catch (e) {
            console.error('[LAN] Error loading history:', e);
        }
    }

    listenForEvents() {
        window.electronAPI.onLanMessage((msg) => {
            this.appendMessage(msg);
            
            if (this.activeTab === 'chat') {
                this.scrollToBottom();
            }

            if (!this.isOpen) {
                this.unreadMessages++;
                this.updateUnreadBadge();
                this.showNotification(`New message from ${msg.sender}`, msg.message || 'Shared a file');
            }

            if (msg.file) {
                this.addFileToList(msg);
            }
        });

        window.electronAPI.onLanPeersChanged((peers) => {
            this.updatePeersList(peers);
        });
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        closeAllPanels();
        
        document.getElementById('lan-panel').style.display = 'flex';
        this.isOpen = true;
        this.unreadMessages = 0;
        this.updateUnreadBadge();
        this.scrollToBottom();
        
        this.loadStatus();
        window.electronAPI.lanGetPeers().then(peers => this.updatePeersList(peers));
    }

    close() {
        document.getElementById('lan-panel').style.display = 'none';
        this.isOpen = false;
    }

    switchTab(tab) {
        this.activeTab = tab;
        
        document.querySelectorAll('.lan-tab-btn').forEach(btn => {
            if (btn.getAttribute('data-tab') === tab) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        if (tab === 'chat') {
            document.getElementById('lan-view-chat').style.display = 'flex';
            document.getElementById('lan-view-files').style.display = 'none';
            this.scrollToBottom();
        } else {
            document.getElementById('lan-view-chat').style.display = 'none';
            document.getElementById('lan-view-files').style.display = 'block';
        }
    }

    async saveUsername() {
        const input = document.getElementById('lan-username-input');
        if (!input) return;

        const name = input.value.trim();
        if (!name) return;

        try {
            const res = await window.electronAPI.lanSetUsername(name);
            if (res.success) {
                this.myUsername = res.username;
                document.getElementById('lan-status-username').textContent = this.myUsername;
                this.appendSystemMessage(`You changed display name to "${this.myUsername}"`);
                this.scrollToBottom();
            } else {
                alert(res.error || 'Failed to save username');
            }
        } catch (e) {
            console.error('[LAN] Error saving username:', e);
        }
    }

    async sendMessage() {
        const input = document.getElementById('lan-message-input');
        if (!input) return;

        const msg = input.value.trim();
        if (!msg) return;

        input.value = '';

        try {
            const res = await window.electronAPI.lanSendMessage(msg);
            if (!res.success) {
                console.error('[LAN] Error sending message:', res.error);
            }
        } catch (e) {
            console.error('[LAN] Error invoking send message:', e);
        }
    }

    async shareFile() {
        try {
            const res = await window.electronAPI.lanShareFile();
            if (res.success) {
                // Sent
            } else if (!res.canceled) {
                alert(res.error || 'Failed to share file');
            }
        } catch (e) {
            console.error('[LAN] Error sharing file:', e);
        }
    }

    async addPeerManual() {
        const input = document.getElementById('lan-manual-ip');
        if (!input) return;

        const ip = input.value.trim();
        if (!ip) return;

        input.value = '';

        try {
            const res = await window.electronAPI.lanAddPeerManual(ip);
            if (res.success) {
                this.appendSystemMessage(`Searching for peer at ${ip}...`);
                this.scrollToBottom();
            } else {
                alert(res.error || 'Failed to add peer');
            }
        } catch (e) {
            console.error('[LAN] Error adding manual peer:', e);
        }
    }

    appendMessage(msg) {
        const listEl = document.getElementById('lan-messages-list');
        if (!listEl) return;

        const isOutgoing = msg.senderIp === this.myIp;
        
        const msgEl = document.createElement('div');
        msgEl.className = `lan-message ${isOutgoing ? 'outgoing' : 'incoming'}`;
        
        let senderHtml = '';
        if (!isOutgoing) {
            senderHtml = `<div class="lan-message-sender">${this.escapeHtml(msg.sender)}</div>`;
        }

        let messageTextHtml = '';
        if (msg.message && !msg.file) {
            messageTextHtml = `<div>${this.escapeHtml(msg.message)}</div>`;
        }

        let fileAttachmentHtml = '';
        if (msg.file) {
            const sizeStr = this.formatBytes(msg.file.size);
            fileAttachmentHtml = `
                <div class="lan-file-attachment">
                    <span class="lan-file-icon">📁</span>
                    <div class="lan-file-info">
                        <span class="lan-file-name" title="${this.escapeHtml(msg.file.name)}">${this.escapeHtml(msg.file.name)}</span>
                        <span class="lan-file-size" style="color: rgba(255,255,255,0.7);">${sizeStr}</span>
                    </div>
                    <button class="lan-file-btn" onclick="window.lanManager.downloadFile('${msg.file.url}', '${this.escapeHtml(msg.file.name)}')">
                        Download
                    </button>
                </div>
            `;
        }

        const timeStr = this.formatTime(msg.timestamp);

        msgEl.innerHTML = `
            ${senderHtml}
            ${messageTextHtml}
            ${fileAttachmentHtml}
            <div class="lan-message-time">${timeStr}</div>
        `;

        listEl.appendChild(msgEl);
    }

    appendSystemMessage(text) {
        const listEl = document.getElementById('lan-messages-list');
        if (!listEl) return;

        const msgEl = document.createElement('div');
        msgEl.className = 'lan-message-system';
        msgEl.textContent = text;
        
        listEl.appendChild(msgEl);
    }

    downloadFile(url, filename) {
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        this.showNotification('Download Started', `Downloading ${filename} from LAN...`);
    }

    updateUnreadBadge() {
        const badge = document.getElementById('lan-unread-badge');
        if (!badge) return;

        if (this.unreadMessages > 0) {
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }

    updatePeersList(peers) {
        const listEl = document.getElementById('lan-peers-list');
        const countEl = document.getElementById('lan-peers-count');
        if (!listEl) return;

        if (countEl) countEl.textContent = peers.length;

        if (peers.length === 0) {
            listEl.innerHTML = `<div style="font-size: 11px; color: var(--text-secondary); font-style: italic;">No colleagues online. Open QuantumX on another computer to connect.</div>`;
            return;
        }

        listEl.innerHTML = '';
        peers.forEach(peer => {
            const card = document.createElement('div');
            card.className = 'lan-peer-card';
            
            const initials = peer.username.substring(0, 2).toUpperCase();
            
            card.innerHTML = `
                <div style="display: flex; align-items: center; flex: 1; overflow: hidden;">
                    <div class="lan-peer-avatar">${initials}</div>
                    <div class="lan-peer-name">
                        <div style="font-weight: 600; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${this.escapeHtml(peer.username)}</div>
                        <div class="lan-peer-ip">${peer.ip}:${peer.httpPort}</div>
                    </div>
                </div>
                <div class="lan-peer-status-dot"></div>
            `;
            listEl.appendChild(card);
        });
    }

    rebuildFilesList(history) {
        const listEl = document.getElementById('lan-files-list');
        if (!listEl) return;

        listEl.innerHTML = '';
        const fileMessages = history.filter(msg => msg.file);

        if (fileMessages.length === 0) {
            listEl.innerHTML = `<div style="font-size: 11px; color: var(--text-secondary); font-style: italic; text-align: center; padding: 20px;">No files shared yet. Share a file in the chatroom!</div>`;
            return;
        }

        const reversed = [...fileMessages].reverse();
        reversed.forEach(msg => {
            this.addFileToListView(msg, listEl);
        });
    }

    addFileToList(msg) {
        const listEl = document.getElementById('lan-files-list');
        if (!listEl) return;

        if (listEl.querySelector('div[style*="font-style: italic"]')) {
            listEl.innerHTML = '';
        }

        this.addFileToListView(msg, listEl, true);
    }

    addFileToListView(msg, container, prepend = false) {
        const sizeStr = this.formatBytes(msg.file.size);
        const card = document.createElement('div');
        card.className = 'lan-shared-file-card';
        
        card.innerHTML = `
            <span style="font-size: 24px;">📁</span>
            <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                <span style="font-weight: 600; font-size: 12px; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${this.escapeHtml(msg.file.name)}">${this.escapeHtml(msg.file.name)}</span>
                <span style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">Shared by ${this.escapeHtml(msg.sender)} • ${sizeStr}</span>
            </div>
            <button class="lan-file-btn" onclick="window.lanManager.downloadFile('${msg.file.url}', '${this.escapeHtml(msg.file.name)}')">
                Download
            </button>
        `;

        if (prepend && container.firstChild) {
            container.insertBefore(card, container.firstChild);
        } else {
            container.appendChild(card);
        }
    }

    scrollToBottom() {
        const listEl = document.getElementById('lan-messages-list');
        if (listEl) {
            setTimeout(() => {
                listEl.scrollTop = listEl.scrollHeight;
            }, 50);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    showNotification(title, message) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: linear-gradient(135deg, #1b1625 0%, #2e243a 100%);
            color: #fafaf9;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            z-index: 10000;
            border: 1px solid #a855f7;
            max-width: 320px;
            animation: slideIn 0.3s ease;
        `;
        
        notification.innerHTML = `
            <div style="font-weight: 700; margin-bottom: 4px; color: #a855f7;">${title}</div>
            <div style="font-size: 13px; color: #d6d3d1; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${message}</div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}


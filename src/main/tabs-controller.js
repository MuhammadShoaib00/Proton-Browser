// TabsController — owns every web tab as a main-process WebContentsView.
//
// Replaces the old renderer-side <webview> elements. The renderer keeps all the
// tab-strip UI and injection logic; it drives tabs through IPC (see src/main/index.js
// 'tab:*' handlers) and receives page events back via the 'tab:event' channel.
//
// Layering note: in this stage the chrome (index.html) still renders in the
// BrowserWindow's own webContents and tab views are added on top, positioned in
// the content area below the toolbar. Part C introduces the transparent overlay
// view so HTML overlays can float above the page.
import { WebContentsView } from 'electron';

class TabsController {
  /**
   * @param {Electron.BrowserWindow} win
   * @param {object} opts { session, userAgent, preloadPath }
   */
  constructor(win, opts) {
    this.win = win;
    this.session = opts.session;
    this.userAgent = opts.userAgent;
    this.preloadPath = opts.preloadPath;
    // How to reach the chrome renderer. index.html lives in a separate
    // chromeView (see Part C), so the BrowserWindow's own webContents is blank —
    // sending there silently drops every page event.
    this.sendToUI = opts.send;
    this.views = new Map();          // tabId -> WebContentsView
    this.activeId = null;
    this.bounds = { x: 0, y: 98, width: 800, height: 600 }; // content-area bounds (DIP)
  }

  _send(type, payload) {
    if (typeof this.sendToUI === 'function') {
      this.sendToUI('tab:event', { type, ...payload });
      return;
    }
    // Fallback for safety only — the window's webContents holds no UI.
    if (this.win && !this.win.isDestroyed() && this.win.webContents && !this.win.webContents.isDestroyed()) {
      this.win.webContents.send('tab:event', { type, ...payload });
    }
  }

  create({ id, url }) {
    if (this.views.has(id)) return;

    const prefs = {
      session: this.session,
      // contextIsolation MUST stay false so page-preload.js can override
      // navigator.userAgentData / window.chrome in the page's own world
      // (the fingerprint spoof) — same posture as the old <webview>.
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false
    };
    // preloadPath is null when bisecting with QX_NO_PRELOAD / QX_SAFE.
    if (this.preloadPath) prefs.preload = this.preloadPath;

    const view = new WebContentsView({ webPreferences: prefs });

    const wc = view.webContents;
    wc.setUserAgent(this.userAgent);
    // The renderer's 400ms executeJavaScript bridge poll makes Electron attach
    // short-lived internal listeners; the default cap of 10 trips a spurious
    // MaxListenersExceededWarning.
    try { wc.setMaxListeners(60); } catch (_) {}

    // Popups / target=_blank / window.open → open as a new tab in the chrome.
    wc.setWindowOpenHandler(({ url: openUrl }) => {
      this._send('open-url', { url: openUrl });
      return { action: 'deny' };
    });

    // Forward page lifecycle to the renderer, which updates the tab strip and
    // runs its injection routines (mirrors the old <webview> event listeners).
    wc.on('did-start-loading', () => this._send('did-start-loading', { id }));
    wc.on('did-stop-loading', () => this._send('did-stop-loading', { id }));
    wc.on('page-title-updated', (_e, title) => this._send('page-title-updated', { id, title }));
    wc.on('page-favicon-updated', (_e, favicons) => this._send('page-favicon-updated', { id, favicons }));
    wc.on('did-navigate', (_e, navUrl) => this._send('did-navigate', { id, url: navUrl }));
    wc.on('did-navigate-in-page', (_e, navUrl, isMainFrame) => {
      if (isMainFrame) this._send('did-navigate-in-page', { id, url: navUrl });
    });
    wc.on('dom-ready', () => this._send('dom-ready', { id }));
    // Find-in-page result counts (never wired under the old <webview>).
    wc.on('found-in-page', (_e, result) => this._send('found-in-page', { id, result }));


    this.views.set(id, view);
    // Attach to the window tree; keep hidden until activated.
    this.win.contentView.addChildView(view, 0);
    view.setVisible(false);
    view.setBounds(this.bounds);

    if (url) wc.loadURL(url);
  }

  activate(id) {
    if (!this.views.has(id)) return;
    this.activeId = id;
    for (const [tid, view] of this.views) {
      const isActive = tid === id;
      view.setVisible(isActive);
      if (isActive) {
        // Re-add so it sits on top of other (hidden) tab views.
        this.win.contentView.addChildView(view, 0);
        view.setBounds(this.bounds);
      }
    }
  }

  // Hide every tab view (used when an embed tab or a full-window overlay is active).
  hideAll() {
    for (const view of this.views.values()) view.setVisible(false);
  }

  showActive() {
    if (this.activeId && this.views.has(this.activeId)) {
      const view = this.views.get(this.activeId);
      view.setVisible(true);
      this.win.contentView.addChildView(view, 0);
      view.setBounds(this.bounds);
    }
  }

  setBounds(b) {
    this.bounds = {
      x: Math.round(b.x || 0),
      y: Math.round(b.y || 0),
      width: Math.round(b.width || 0),
      height: Math.round(b.height || 0)
    };
    const view = this.activeId && this.views.get(this.activeId);
    if (view && view.getVisible && view.getVisible()) view.setBounds(this.bounds);
    else if (view) view.setBounds(this.bounds);
  }

  close(id) {
    const view = this.views.get(id);
    if (!view) return;
    try { this.win.contentView.removeChildView(view); } catch (_) {}
    try { view.webContents.destroy(); } catch (_) {}
    this.views.delete(id);
    if (this.activeId === id) this.activeId = null;
  }

  _wc(id) {
    const view = this.views.get(id);
    return view ? view.webContents : null;
  }

  navigate(id, url) { const wc = this._wc(id); if (wc) wc.loadURL(url); }
  reload(id) { const wc = this._wc(id); if (wc) wc.reload(); }
  stop(id) { const wc = this._wc(id); if (wc) wc.stop(); }

  goBack(id) {
    const wc = this._wc(id);
    if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }
  goForward(id) {
    const wc = this._wc(id);
    if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  getURL(id) { const wc = this._wc(id); return wc ? wc.getURL() : ''; }

  // Generic page-script execution — the renderer's injection + sessionStorage
  // bridge all funnel through here (replaces webview.executeJavaScript).
  exec(id, code) {
    const wc = this._wc(id);
    if (!wc || wc.isDestroyed()) return Promise.resolve(null);
    try {
      return wc.executeJavaScript(code, true).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  setZoom(id, factor) { const wc = this._wc(id); if (wc) wc.setZoomFactor(factor); }
  findInPage(id, text, opts) { const wc = this._wc(id); if (wc && text) wc.findInPage(text, opts || {}); }
  stopFind(id) { const wc = this._wc(id); if (wc) wc.stopFindInPage('clearSelection'); }
  print(id) { const wc = this._wc(id); if (wc) wc.print(); }
  openDevTools(id) { const wc = this._wc(id); if (wc) wc.openDevTools({ mode: 'detach' }); }
}

export { TabsController };

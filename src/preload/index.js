const { contextBridge, ipcRenderer } = require('electron');

// Dev-only bisect flags passed via additionalArguments from the main process.
const QX_FLAGS = {
  noInject: process.argv.includes('--qx-no-inject')
};

contextBridge.exposeInMainWorld('electronAPI', {
  flags: QX_FLAGS,
  createTab: (url) => ipcRenderer.invoke('create-tab', url),
  closeTab: (tabId) => ipcRenderer.invoke('close-tab', tabId),
  navigate: (url) => ipcRenderer.invoke('navigate', url),
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  // Theme — makes web content (prefers-color-scheme) follow the browser theme
  setNativeTheme: (theme) => ipcRenderer.send('set-native-theme', theme),
  // Download functions
  getYouTubeInfo: (url) => ipcRenderer.invoke('get-youtube-info', url),
  downloadYouTube: (url, quality) => ipcRenderer.invoke('download-youtube', url, quality),
  downloadTorrent: (magnetOrUrl) => ipcRenderer.invoke('download-torrent', magnetOrUrl),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  // Download events
  onDownloadStarted: (callback) => ipcRenderer.on('download-started', (event, data) => callback(data)),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', (event, data) => callback(data)),
  // URL detection
  getCurrentUrl: () => ipcRenderer.invoke('get-current-url'),
  // Update functions
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  // Update events
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', (event, data) => callback(data)),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (event, data) => callback(data)),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, data) => callback(data)),
  // Grammar checker
  checkGrammar: (text, language) => ipcRenderer.invoke('check-grammar', text, language),
  // Screenshot protection
  setScreenProtection: (enable) => ipcRenderer.invoke('set-screen-protection', enable),
  getScreenProtection: () => ipcRenderer.invoke('get-screen-protection'),
  // App version
  getVersion: () => ipcRenderer.invoke('get-version'),
  // Stealth mode
  getStealthConfig: () => ipcRenderer.invoke('get-stealth-config'),
  setStealthMode: (enabled) => ipcRenderer.invoke('set-stealth-mode', enabled),
  setSecretCode: (code) => ipcRenderer.invoke('set-secret-code', code),
  showWindow: () => ipcRenderer.invoke('show-window'),
  getHotkey: () => ipcRenderer.invoke('get-hotkey'),
  setHotkey: (key) => ipcRenderer.invoke('set-hotkey', key),
  getUserAgent: () => ipcRenderer.invoke('get-user-agent'),
  getAdBlockScript: () => ipcRenderer.invoke('get-adblock-script'),
  // Monitoring detection
  checkMonitoringApps: () => ipcRenderer.invoke('check-monitoring-apps'),
  getMonitoringStatus: () => ipcRenderer.invoke('get-monitoring-status'),
  onMonitoringDetected: (cb) => ipcRenderer.on('monitoring-detected', (_, data) => cb(data)),
  // Window embedding
  getWindowsList: () => ipcRenderer.invoke('get-windows-list'),
  embedWindow: (opts) => ipcRenderer.invoke('embed-window', opts),
  launchAndEmbed: (opts) => ipcRenderer.invoke('launch-and-embed', opts),
  moveEmbedWindow: (opts) => ipcRenderer.invoke('move-embed-window', opts),
  showEmbedWindow: (opts) => ipcRenderer.invoke('show-embed-window', opts),
  releaseEmbedWindow: (opts) => ipcRenderer.invoke('release-embed-window', opts),
  isWindowValid: (opts) => ipcRenderer.invoke('is-window-valid', opts),
  getWindowIcon: (opts) => ipcRenderer.invoke('get-window-icon', opts),
  prePipSnapshot: () => ipcRenderer.invoke('pre-pip-snapshot'),
  postPipProtect: () => ipcRenderer.invoke('post-pip-protect'),
  // LAN APIs
  lanGetStatus: () => ipcRenderer.invoke('lan-get-status'),
  lanSetUsername: (name) => ipcRenderer.invoke('lan-set-username', name),
  lanGetPeers: () => ipcRenderer.invoke('lan-get-peers'),
  lanGetHistory: () => ipcRenderer.invoke('lan-get-history'),
  lanSendMessage: (msg) => ipcRenderer.invoke('lan-send-message', msg),
  lanShareFile: () => ipcRenderer.invoke('lan-share-file'),
  lanAddPeerManual: (ip) => ipcRenderer.invoke('lan-add-peer-manual', ip),
  onLanMessage: (callback) => ipcRenderer.on('lan-message-received', (event, data) => callback(data)),
  onLanPeersChanged: (callback) => ipcRenderer.on('lan-peers-changed', (event, data) => callback(data)),

  // ── Web tabs (main-process WebContentsView) ──────────────────────────────
  tab: {
    create: (id, url) => ipcRenderer.invoke('tab:create', { id, url }),
    activate: (id) => ipcRenderer.invoke('tab:activate', id),
    close: (id) => ipcRenderer.invoke('tab:close', id),
    navigate: (id, url) => ipcRenderer.invoke('tab:navigate', id, url),
    back: (id) => ipcRenderer.invoke('tab:back', id),
    forward: (id) => ipcRenderer.invoke('tab:forward', id),
    reload: (id) => ipcRenderer.invoke('tab:reload', id),
    stop: (id) => ipcRenderer.invoke('tab:stop', id),
    getURL: (id) => ipcRenderer.invoke('tab:get-url', id),
    exec: (id, code) => ipcRenderer.invoke('tab:exec', id, code),
    zoom: (id, factor) => ipcRenderer.invoke('tab:zoom', id, factor),
    find: (id, text, opts) => ipcRenderer.invoke('tab:find', id, text, opts),
    stopFind: (id) => ipcRenderer.invoke('tab:stop-find', id),
    print: (id) => ipcRenderer.invoke('tab:print', id),
    devtools: (id) => ipcRenderer.invoke('tab:devtools', id),
    setBounds: (b) => ipcRenderer.invoke('tab:set-bounds', b),
    hideAll: () => ipcRenderer.invoke('tab:hide-all'),
    showActive: () => ipcRenderer.invoke('tab:show-active'),
    onEvent: (cb) => ipcRenderer.on('tab:event', (_e, data) => cb(data))
  },

  // ── Chrome overlay layout (collapse/expand of the chrome view) ───────────
  ui: {
    layout: (opts) => ipcRenderer.invoke('ui:layout', opts),
    onContentBounds: (cb) => ipcRenderer.on('ui:content-bounds', (_e, d) => cb(d))
  }
});


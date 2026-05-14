const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  createTab: (url) => ipcRenderer.invoke('create-tab', url),
  closeTab: (tabId) => ipcRenderer.invoke('close-tab', tabId),
  navigate: (url) => ipcRenderer.invoke('navigate', url),
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  // Download functions
  getYouTubeInfo: (url) => ipcRenderer.invoke('get-youtube-info', url),
  downloadYouTube: (url, quality) => ipcRenderer.invoke('download-youtube', url, quality),
  downloadTorrent: (magnetOrUrl) => ipcRenderer.invoke('download-torrent', magnetOrUrl),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
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
  getWindowIcon: (opts) => ipcRenderer.invoke('get-window-icon', opts)
});


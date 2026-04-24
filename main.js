const { app, BrowserWindow, ipcMain, session, nativeImage, dialog, Tray, Menu, globalShortcut } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

let mainWindow;
let screenProtection;
let activeDownloads = new Map();
let YTDlpWrap, WebTorrent, axios;
let tray = null;
app.isQuitting = false;

// ── Chromium flags (must be set before app ready) ──────────────────────────
// Spoof as plain Chrome — removes the "Electron" token that WhatsApp / other
// sites detect and block.  Electron 34 ships Chromium 132.
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
app.userAgentFallback = CHROME_UA;

// GPU / hardware acceleration
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-oop-rasterization');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode');

// Enable all modern web platform features
app.commandLine.appendSwitch('enable-features', [
  'VaapiVideoDecoder',
  'VaapiVideoEncoder',
  'UseSkiaRenderer',
  'WebAssemblyBaseline',
  'WebAssemblyLazyCompilation',
  'WebAssemblySimd',
  'SharedArrayBuffer',
  'MediaCapabilities',
  'AudioServiceAudioStreams',
  'AudioServiceLaunchOnStartup',
  'PlatformHEVCDecoderSupport',
  'EnableDrDc',
  'CanvasOopRasterization',
  'ThrottleDisplayNoneAndVisibilityHiddenCrossOriginIframes',
].join(','));

// Disable features that hurt compatibility
app.commandLine.appendSwitch('disable-features', [
  'OutOfBlinkCors',
  'SameSiteByDefaultCookies',
  'CookiesWithoutSameSiteMustBeSecure',
].join(','));

// HTTP/3 + QUIC for faster connections
app.commandLine.appendSwitch('enable-quic');

// Better JS performance
app.commandLine.appendSwitch('js-flags', '--harmony --max-old-space-size=4096');

// Autoplay without user gesture (needed for WhatsApp calls, video, etc.)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Disable web security for cross-origin requests (power user feature)
// app.commandLine.appendSwitch('disable-web-security'); // uncomment only if needed

// ── Stealth / Tray config ──────────────────────────────────────────────────
let stealthConfig = { secretCode: 'protonbrowser', stealthMode: false, hotkey: 'Ctrl+Shift+Space' };

function configPath() {
  return path.join(app.getPath('userData'), 'proton-stealth.json');
}

function loadStealthConfig() {
  try {
    const p = configPath();
    if (fs.existsSync(p)) {
      stealthConfig = { ...stealthConfig, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
    }
  } catch (e) {}
}

function saveStealthConfig() {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(stealthConfig, null, 2));
  } catch (e) {}
}

// ── PowerShell stealth helpers ─────────────────────────────────────────────
function runPS(script, extraEnv = {}) {
  spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-ExecutionPolicy', 'Bypass', '-Command', script
  ], { stdio: 'ignore', env: { ...process.env, ...extraEnv } });
}

function hideFromWindowsSearch() {
  if (process.platform !== 'win32') return;
  runPS(`
    $appId = 'com.protonbrowser.app'

    # 1. Delete every Proton-named shortcut from all Start Menu and Desktop locations
    $locs = @(
      [Environment]::GetFolderPath('StartMenu'),
      [Environment]::GetFolderPath('CommonStartMenu'),
      [Environment]::GetFolderPath('Desktop'),
      [Environment]::GetFolderPath('CommonDesktopDirectory')
    )
    foreach ($loc in $locs) {
      if (Test-Path $loc) {
        Get-ChildItem -Path $loc -Recurse -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -like '*Proton*' } |
          Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
      }
    }

    # 2. Hide the Uninstall registry entry from Windows Search and Apps list
    $uninstPaths = @(
      "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$appId",
      "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$appId",
      "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$appId"
    )
    foreach ($p in $uninstPaths) {
      if (Test-Path $p) {
        Set-ItemProperty $p -Name SystemComponent -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
        Set-ItemProperty $p -Name NoDisplay       -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
      }
    }

    # 3. Remove App Paths (makes app undiscoverable via Run dialog and search)
    foreach ($p in @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Proton Browser.exe',
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Proton Browser.exe'
    )) { Remove-Item $p -Force -Recurse -ErrorAction SilentlyContinue }

    # 4. Remove HKCR Applications entry Windows auto-creates when app is launched
    foreach ($p in @(
      'Registry::HKEY_CLASSES_ROOT\\Applications\\Proton Browser.exe',
      'HKLM:\\SOFTWARE\\Classes\\Applications\\Proton Browser.exe',
      'HKCU:\\Software\\Classes\\Applications\\Proton Browser.exe'
    )) { Remove-Item $p -Force -Recurse -ErrorAction SilentlyContinue }

    # 5. Kill all search/start-menu cache processes — Windows restarts them clean
    foreach ($proc in @('StartMenuExperienceHost','SearchHost','SearchIndexer')) {
      Get-Process -Name $proc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }

    # 6. Notify Windows Shell that associations changed
    Start-Process ie4uinit.exe -ArgumentList '-show' -WindowStyle Hidden -ErrorAction SilentlyContinue
  `);
}

function showInWindowsSearch() {
  if (process.platform !== 'win32') return;
  runPS(`
    $appId   = 'com.protonbrowser.app'
    $exePath = $env:PS_EXE_PATH
    $exeDir  = Split-Path $exePath

    # 1. Restore Uninstall registry visibility
    foreach ($p in @(
      "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$appId",
      "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$appId",
      "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$appId"
    )) {
      if (Test-Path $p) {
        Remove-ItemProperty $p -Name SystemComponent -Force -ErrorAction SilentlyContinue
        Remove-ItemProperty $p -Name NoDisplay       -Force -ErrorAction SilentlyContinue
      }
    }

    # 2. Restore App Paths
    $appPathKey = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Proton Browser.exe'
    if (!(Test-Path $appPathKey)) { New-Item $appPathKey -Force | Out-Null }
    Set-ItemProperty $appPathKey -Name '(default)' -Value $exePath -Type String -Force
    Set-ItemProperty $appPathKey -Name 'Path'      -Value $exeDir  -Type String -Force

    # 3. Flush search cache
    foreach ($proc in @('StartMenuExperienceHost','SearchHost','SearchIndexer')) {
      Get-Process -Name $proc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Start-Process ie4uinit.exe -ArgumentList '-show' -WindowStyle Hidden -ErrorAction SilentlyContinue
  `, { PS_EXE_PATH: process.execPath });
}

function isValidCode(code) {
  return typeof code === 'string' && /^[a-zA-Z][a-zA-Z0-9]{2,19}$/.test(code);
}

function registerHotkey() {
  const key = stealthConfig.hotkey;
  if (!key) return;
  try {
    globalShortcut.register(key, () => {
      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.hide();
        if (!stealthConfig.stealthMode) createTray();
        else destroyTray();
      } else {
        showWindow();
        destroyTray();
      }
    });
  } catch (e) {
    console.error('Failed to register hotkey:', key, e.message);
  }
}

function unregisterHotkey() {
  try {
    if (stealthConfig.hotkey) globalShortcut.unregister(stealthConfig.hotkey);
  } catch (e) {}
}

function registerProtocol(code) {
  if (isValidCode(code)) {
    app.setAsDefaultProtocolClient(code);
  }
}

function unregisterProtocol(code) {
  if (isValidCode(code)) {
    try { app.removeAsDefaultProtocolClient(code); } catch (e) {}
  }
}

// ── Shortcut management ────────────────────────────────────────────────────
function deleteShortcuts() {
  if (process.platform !== 'win32') return;
  // Use PowerShell with GetFolderPath so we always hit the correct system paths
  // regardless of locale or Windows edition
  runPS(`
    $locs = @(
      [Environment]::GetFolderPath('StartMenu'),
      [Environment]::GetFolderPath('CommonStartMenu'),
      [Environment]::GetFolderPath('Desktop'),
      [Environment]::GetFolderPath('CommonDesktopDirectory')
    )
    foreach ($loc in $locs) {
      if (Test-Path $loc) {
        Get-ChildItem -Path $loc -Recurse -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -like '*Proton*' } |
          Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
      }
    }
  `);
}

function recreateShortcuts() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  runPS(`
    $exePath = $env:PS_EXE_PATH
    $WShell  = New-Object -ComObject WScript.Shell

    $smDir = Join-Path ([Environment]::GetFolderPath('CommonStartMenu')) 'Programs\\Proton Browser'
    if (!(Test-Path $smDir)) { New-Item $smDir -ItemType Directory -Force | Out-Null }
    $sc = $WShell.CreateShortcut((Join-Path $smDir 'Proton Browser.lnk'))
    $sc.TargetPath  = $exePath
    $sc.Description = 'Proton Browser'
    $sc.Save()

    $desktop = [Environment]::GetFolderPath('Desktop')
    $sc2 = $WShell.CreateShortcut((Join-Path $desktop 'Proton Browser.lnk'))
    $sc2.TargetPath  = $exePath
    $sc2.Description = 'Proton Browser'
    $sc2.Save()
  `, { PS_EXE_PATH: process.execPath });
}

function createTray() {
  if (tray) return;
  try {
    const iconPath = path.join(__dirname, 'assets', 'logo.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('Proton Browser — click to open');
    const menu = Menu.buildFromTemplate([
      { label: 'Open Proton Browser', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(menu);
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
  } catch (e) {
    console.error('Tray creation failed:', e);
  }
}

function destroyTray() {
  if (tray) { tray.destroy(); tray = null; }
}

function showWindow() {
  if (mainWindow) {
    mainWindow.setSkipTaskbar(true);
    mainWindow.show();
    mainWindow.focus();
  }
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
  if (stealthConfig.stealthMode) {
    destroyTray(); // complete stealth — no tray, no taskbar
  } else {
    createTray(); // hide to tray
  }
}

// ffmpeg-static provides a bundled ffmpeg binary (used by yt-dlp for merging)
let ffmpegPath = '';
try {
  ffmpegPath = require('ffmpeg-static');
  console.log('✅ ffmpeg-static loaded:', ffmpegPath);
} catch (e) {
  console.log('⚠️  ffmpeg-static not available — will download combined streams only');
}

// Lazy load heavy dependencies individually
try {
  const ytdlWrapModule = require('yt-dlp-wrap');
  // yt-dlp-wrap exports as ES module default
  YTDlpWrap = ytdlWrapModule.default || ytdlWrapModule;
  console.log('✅ yt-dlp-wrap loaded');
} catch (err) {
  console.log('⚠️  yt-dlp-wrap not available (npm install yt-dlp-wrap)');
}

try {
  WebTorrent = require('webtorrent');
  console.log('✅ Torrent downloader loaded');
} catch (err) {
  console.log('⚠️  Torrent downloader not available (npm install webtorrent)');
}

try {
  axios = require('axios');
} catch (err) {
  console.log('⚠️  Axios not available');
}

// Try to load the native screen protection module
try {
  screenProtection = require('./build/Release/screen-protection.node');
} catch (err) {
  console.log('Screen protection module not available. Please run: npm run rebuild');
}

// ── Screenshot Protection Helper ───────────────────────────────────────────
let screenProtectionEnabled = true; // tracks current state

function applyScreenProtection(enable) {
  if (!mainWindow) return;
  try {
    // 1. Electron built-in (works on all platforms)
    mainWindow.setContentProtection(enable);

    // 2. Windows native WDA_EXCLUDEFROMCAPTURE (stronger, Windows only)
    if (screenProtection) {
      const hwnd = mainWindow.getNativeWindowHandle();
      const hwndValue = hwnd.readInt32LE(0);
      screenProtection.setScreenProtection(hwndValue, enable);
    }

    screenProtectionEnabled = enable;
    console.log(`Screenshot protection ${enable ? 'ENABLED' : 'DISABLED'}`);
  } catch (err) {
    console.error('applyScreenProtection error:', err);
  }
}

function createWindow() {
  // Load icon - try PNG first, fallback to SVG
  let appIcon;
  const icoIconPath = path.join(__dirname, 'assets', 'logo.ico');
  const pngIconPath = path.join(__dirname, 'assets', 'logo.png');
  const svgIconPath = path.join(__dirname, 'assets', 'logo.svg');
  
  if (process.platform === 'win32' && fs.existsSync(icoIconPath)) {
    appIcon = nativeImage.createFromPath(icoIconPath);
    console.log('✅ Using ICO icon');
  } else if (fs.existsSync(pngIconPath)) {
    appIcon = nativeImage.createFromPath(pngIconPath);
    console.log('✅ Using PNG icon');
  } else if (fs.existsSync(svgIconPath)) {
    appIcon = nativeImage.createFromPath(svgIconPath);
    console.log('⚠️  Using SVG icon (create PNG for better results)');
  }
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      sandbox: false,
      // Performance optimizations
      enablePreferredSizeMode: true,
      spellcheck: false
    },
    title: 'Proton Browser',
    icon: appIcon,
    backgroundColor: '#202124',
    skipTaskbar: true,
    frame: false, // Custom frameless window
    transparent: false,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    // Better window effects
    vibrancy: 'dark',
    visualEffectState: 'active'
  });

  mainWindow.loadFile('index.html');

  // Apply screenshot protection after window is ready (ON by default)
  mainWindow.webContents.on('did-finish-load', () => {
    applyScreenProtection(true);
  });

  // Enable content protection (Electron built-in) — default ON
  mainWindow.setContentProtection(true);

  // Minimize → hide to tray instead of shrinking to taskbar
  mainWindow.on('minimize', () => {
    mainWindow.hide();
    if (!stealthConfig.stealthMode) createTray();
    else destroyTray();
  });

  // In stealth mode: hide instead of quit so secret-code can reopen.
  // In normal mode: let the close proceed — app will quit via window-all-closed.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting && stealthConfig.stealthMode) {
      event.preventDefault();
      mainWindow.hide();
      destroyTray();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Setup download handling
  setupDownloadHandler();
}

// Download Handler
function setupDownloadHandler() {
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const downloadId = Date.now().toString();
    const fileName = item.getFilename();
    const totalBytes = item.getTotalBytes();
    
    // Set default download path
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const filePath = path.join(downloadsPath, fileName);
    item.setSavePath(filePath);

    // Track download
    activeDownloads.set(downloadId, {
      id: downloadId,
      fileName: fileName,
      filePath: filePath,
      totalBytes: totalBytes,
      receivedBytes: 0,
      state: 'progressing',
      startTime: Date.now()
    });

    // Send initial download info
    mainWindow.webContents.send('download-started', {
      id: downloadId,
      fileName: fileName,
      totalBytes: totalBytes
    });

    // Progress updates
    item.on('updated', (event, state) => {
      if (state === 'progressing') {
        const download = activeDownloads.get(downloadId);
        if (download) {
          download.receivedBytes = item.getReceivedBytes();
          download.progress = totalBytes > 0 ? (item.getReceivedBytes() / totalBytes) * 100 : 0;
          
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            receivedBytes: item.getReceivedBytes(),
            totalBytes: totalBytes,
            progress: download.progress
          });
        }
      }
    });

    // Download completed
    item.once('done', (event, state) => {
      const download = activeDownloads.get(downloadId);
      if (download) {
        download.state = state;
        download.endTime = Date.now();
        
        mainWindow.webContents.send('download-complete', {
          id: downloadId,
          state: state,
          filePath: filePath,
          fileName: fileName
        });

        if (state === 'completed') {
          console.log(`✅ Download completed: ${fileName}`);
        } else {
          console.log(`❌ Download ${state}: ${fileName}`);
        }
      }
    });
  });
}

// Single-instance lock — needed so Win+R protocol launch reaches the running app
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    // Check if launched via our secret protocol (e.g. proton2024://)
    const url = argv.find(a => a.includes('://'));
    if (url) {
      const code = url.split('://')[0];
      if (code === stealthConfig.secretCode) {
        showWindow();
      }
    } else {
      showWindow();
    }
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('ready', () => {
  // Load stealth config and register the secret protocol
  loadStealthConfig();
  registerProtocol(stealthConfig.secretCode);
  registerHotkey();
  // Enforce shortcut + registry visibility based on saved stealth state
  if (stealthConfig.stealthMode) {
    deleteShortcuts();
    hideFromWindowsSearch();
  }

  // ── User-Agent: strip "Electron" so sites like WhatsApp see plain Chrome ──
  session.defaultSession.setUserAgent(CHROME_UA);

  // Also override the UA header on every outgoing request
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
    details.requestHeaders['User-Agent'] = CHROME_UA;
    callback({ requestHeaders: details.requestHeaders });
  });

  // ── Permissions: allow everything a real browser would grant ──────────────
  const ALLOW_ALL_PERMISSIONS = [
    'notifications', 'media', 'geolocation', 'mediaKeySystem',
    'midi', 'midiSysex', 'pointerLock', 'fullscreen',
    'openExternal', 'clipboard-sanitized-write', 'clipboard-read',
    'display-capture', 'idle-detection', 'payment', 'speaker-selection',
    'window-placement', 'local-fonts', 'ambient-light-sensor',
    'background-sync', 'background-fetch', 'persistent-storage',
    'periodic-background-sync', 'push',
  ];
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(true); // allow all — same as any real browser default
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return true; // pre-approve all permission checks
  });

  // ── Ad / tracker blocker (whitelists messaging & social services) ─────────
  const AD_DOMAINS = [
    'doubleclick.net', 'googlesyndication.com', 'adservice.google.com',
    'googleadservices.com', 'google-analytics.com', 'analytics.google.com',
    'adnxs.com', 'moatads.com', 'rubiconproject.com', 'pubmatic.com',
    'openx.net', 'advertising.com', 'taboola.com', 'outbrain.com',
  ];
  // Domains that must NEVER be blocked (messaging / auth / CDN)
  const WHITELIST_DOMAINS = [
    'whatsapp.com', 'whatsapp.net', 'fbcdn.net',
    'facebook.com', 'googleapis.com', 'gstatic.com',
    'telegram.org', 'discord.com', 'slack.com',
  ];
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const url = details.url;
    const whitelisted = WHITELIST_DOMAINS.some(d => url.includes(d));
    const blocked     = !whitelisted && AD_DOMAINS.some(d => url.includes(d));
    callback({ cancel: blocked });
  });

  createWindow();

  // If stealth was already enabled from a previous session, hide immediately
  if (stealthConfig.stealthMode && mainWindow) {
    mainWindow.hide();
    destroyTray();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC handlers for window controls
ipcMain.on('window-minimize', () => {
  if (!mainWindow) return;
  mainWindow.hide();
  if (!stealthConfig.stealthMode) createTray();
  else destroyTray();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (stealthConfig.stealthMode) {
    // Stealth mode: hide so secret-code can bring it back
    if (mainWindow) { mainWindow.hide(); destroyTray(); }
  } else {
    app.isQuitting = true;
    app.quit();
  }
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('get-user-agent', () => CHROME_UA);

// ── Screenshot protection toggle ───────────────────────────────────────────
ipcMain.handle('set-screen-protection', (event, enable) => {
  applyScreenProtection(Boolean(enable));
  return { success: true, enabled: screenProtectionEnabled };
});

ipcMain.handle('get-screen-protection', () => {
  return { enabled: screenProtectionEnabled };
});

// IPC handlers
ipcMain.handle('create-tab', async (event, url) => {
  return { success: true, url };
});

ipcMain.handle('close-tab', async (event, tabId) => {
  return { success: true };
});

ipcMain.handle('navigate', async (event, url) => {
  return { success: true };
});

// ─── yt-dlp helpers ────────────────────────────────────────────────────────
// We cache the ytDlp instance so the binary is downloaded once per session
let ytDlpInstance = null;
const ytDlpBinaryPath = path.join(app.getPath('userData'), 'yt-dlp.exe');

async function getYtDlp() {
  if (!YTDlpWrap) throw new Error('yt-dlp-wrap not installed. Run: npm install yt-dlp-wrap');
  if (ytDlpInstance) return ytDlpInstance;

  // Download the binary if it doesn't exist
  if (!fs.existsSync(ytDlpBinaryPath)) {
    console.log('⬇️  Downloading yt-dlp binary to:', ytDlpBinaryPath);
    if (mainWindow) mainWindow.webContents.send('yt-dlp-status', { status: 'downloading' });
    await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
    console.log('✅ yt-dlp binary downloaded');
    if (mainWindow) mainWindow.webContents.send('yt-dlp-status', { status: 'ready' });
  }
  ytDlpInstance = new YTDlpWrap(ytDlpBinaryPath);
  return ytDlpInstance;
}

// YouTube Download Handler
ipcMain.handle('get-youtube-info', async (event, url) => {
  try {
    const yt = await getYtDlp();

    // --dump-single-json gives us everything we need
    const raw = await yt.execPromise([
      url,
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
    ]);

    const info = JSON.parse(raw);

    // Build a quality list from all video formats (yt-dlp merges audio automatically)
    const seen = new Set();
    const allVideoFormats = (info.formats || [])
      .filter(f => f.vcodec && f.vcodec !== 'none' && f.height && f.height >= 144)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    const formats = [];

    // Add unique heights as quality options
    for (const f of allVideoFormats) {
      const key = `${f.height}p`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Estimate size: prefer filesize, then filesize_approx
      let size = 'Unknown size';
      if (f.filesize) size = `~${(f.filesize / (1024 * 1024)).toFixed(0)} MB`;
      else if (f.filesize_approx) size = `~${(f.filesize_approx / (1024 * 1024)).toFixed(0)} MB`;

      formats.push({
        quality: key,
        format: 'mp4',
        size,
        formatId: `${f.height}` // we use height as the selector key
      });
    }

    // Always include "Best" at the top
    formats.unshift({ quality: '🏆 Best Quality', format: 'mp4', size: 'Auto (highest)', formatId: 'best' });

    if (formats.length <= 1) {
      // Fallback if no formats parsed
      [2160, 1440, 1080, 720, 480, 360, 240].forEach(h => {
        formats.push({ quality: `${h}p`, format: 'mp4', size: 'Unknown', formatId: `${h}` });
      });
    }

    // Duration formatting
    const sec = Math.floor(info.duration || 0);
    const duration = sec > 0
      ? `${Math.floor(sec / 3600) > 0 ? Math.floor(sec / 3600) + ':' : ''}${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
      : 'Unknown';

    // Best thumbnail
    const thumbs = (info.thumbnails || []).sort((a, b) => (b.width || 0) - (a.width || 0));
    const thumbnail = thumbs[0]?.url || info.thumbnail || '';

    return {
      success: true,
      title: info.title || 'Unknown',
      thumbnail,
      duration,
      author: info.uploader || info.channel || '',
      viewCount: info.view_count ? parseInt(info.view_count).toLocaleString() : '',
      formats
    };
  } catch (error) {
    console.error('get-youtube-info error:', error.message);
    return { success: false, error: error.message || 'Failed to get video info' };
  }
});

ipcMain.handle('download-youtube', async (event, url, formatId) => {
  const downloadId = Date.now().toString();
  let fileName = 'video.mp4';
  let filePath = '';

  try {
    // Make sure binary is ready
    await getYtDlp();
    const downloadsPath = path.join(os.homedir(), 'Downloads');

    // Build format selector for yt-dlp (formatId = height number or "best")
    let fmtArg;
    const h = parseInt(formatId) || 0;
    if (!formatId || formatId === 'best') {
      fmtArg = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
    } else {
      fmtArg = `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`;
    }

    // Use output template so yt-dlp names the file from video title automatically
    const qualityLabel = h > 0 ? `[${h}p]` : '[best]';
    const outputTemplate = path.join(downloadsPath, `%(title)s ${qualityLabel}.%(ext)s`);

    // Notify UI that we've started
    mainWindow.webContents.send('download-started', {
      id: downloadId,
      fileName: 'Preparing download...',
      totalBytes: 0,
      type: 'youtube'
    });

    return new Promise((resolve) => {
      let totalBytes = 0;
      let downloadedBytes = 0;
      let lastSendTime = Date.now();
      let resolvedFilePath = '';

      // ── Progress line parser ──────────────────────────────────────────────
      // yt-dlp progress line format:
      // [download]  87.7% of   50.22MiB at    5.00MiB/s ETA 00:02
      const progressRegex = /\[download\]\s+([\d.]+)%\s+of\s+([\d.]+)(GiB|MiB|KiB|B)(?:\s+at\s+([\d.]+)(GiB|MiB|KiB|B)\/s)?(?:\s+ETA\s+([\d:]+))?/i;
      const destinationRegex = /\[download\] Destination:\s+(.+)/;
      const mergeRegex = /\[(?:ffmpeg|Merger)\].+Merging.+into "(.+)"/i;

      const parseBytes = (val, unit) => {
        const n = parseFloat(val);
        switch (unit.toLowerCase()) {
          case 'gib': return n * 1024 * 1024 * 1024;
          case 'mib': return n * 1024 * 1024;
          case 'kib': return n * 1024;
          default: return n;
        }
      };

      const handleOutput = (data) => {
        const text = data.toString();
        const lines = text.split(/\r|\n/g);

        for (const line of lines) {
          // Grab destination filename
          const destMatch = line.match(destinationRegex);
          if (destMatch && !resolvedFilePath) {
            resolvedFilePath = destMatch[1].trim();
            fileName = path.basename(resolvedFilePath);
            // Update UI with real filename
            mainWindow.webContents.send('download-started', {
              id: downloadId,
              fileName,
              totalBytes: 0,
              type: 'youtube'
            });
          }

          // Grab merge output filename
          const mergeMatch = line.match(mergeRegex);
          if (mergeMatch) {
            resolvedFilePath = mergeMatch[1].trim();
            fileName = path.basename(resolvedFilePath);
          }

          // Parse download progress
          const m = line.match(progressRegex);
          if (m) {
            const pct = parseFloat(m[1]);
            console.log(`📊 yt-dlp progress: ${pct}%`);
            const newTotal = parseBytes(m[2], m[3]);
            if (newTotal > totalBytes) totalBytes = newTotal;
            downloadedBytes = totalBytes * pct / 100;

            const now = Date.now();
            if (now - lastSendTime >= 250) {
              lastSendTime = now;
              const speedBytes = m[4] && m[5] ? parseBytes(m[4], m[5]) : 0;
              mainWindow.webContents.send('download-progress', {
                id: downloadId,
                receivedBytes: Math.round(downloadedBytes),
                totalBytes: Math.round(totalBytes),
                progress: Math.min(pct, 99),
                speed: speedBytes,
                eta: m[6] || ''
              });
            }
          }
        }
      };

      // Build yt-dlp argument list
      const ytArgs = [
        url,
        '-f', fmtArg,
        '--merge-output-format', 'mp4',
        '-o', outputTemplate,
        '--no-playlist',
        '--newline',                     // one progress line per line (no \r)
        '--progress',
        '--no-colors',
        '--no-part',                     // don't use .part temp files
        '--concurrent-fragments', '4',   // 4× parallel fragment download → faster
        '--buffer-size', '32K',          // larger socket buffer
        '--http-chunk-size', '10M',      // fewer HTTP requests per chunk
        '--retries', '10',
        '--fragment-retries', '10',
      ];

      // Use bundled ffmpeg if available
      if (ffmpegPath) {
        ytArgs.push('--ffmpeg-location', path.dirname(ffmpegPath));
      }

      // ── Spawn yt-dlp directly for full stdout/stderr control ─────────────
      console.log('🚀 Spawning yt-dlp:', ytDlpBinaryPath);
      console.log('📋 Args:', ytArgs.slice(0, 6).join(' '), '...');
      
      let stderrBuffer = '';
      const proc = spawn(ytDlpBinaryPath, ytArgs);

      // Listen to BOTH stdout and stderr — yt-dlp uses stderr for progress
      proc.stdout.on('data', handleOutput);
      proc.stderr.on('data', (data) => {
        stderrBuffer += data.toString();
        handleOutput(data);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log('✅ yt-dlp completed successfully');
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            receivedBytes: Math.max(totalBytes, 1),
            totalBytes: Math.max(totalBytes, 1),
            progress: 100,
            speed: 0,
            eta: '0:00'
          });
          mainWindow.webContents.send('download-complete', {
            id: downloadId,
            state: 'completed',
            filePath: resolvedFilePath || filePath,
            fileName
          });
          resolve({ success: true, filePath: resolvedFilePath || filePath, fileName });
        } else {
          const errMsg = stderrBuffer.includes('ERROR') 
            ? stderrBuffer.split('\n').find(l => l.includes('ERROR')) || `yt-dlp exited with code ${code}`
            : `yt-dlp exited with code ${code}`;
          console.error('❌ yt-dlp failed:', code, errMsg);
          console.error('stderr:', stderrBuffer.substring(0, 500));
          mainWindow.webContents.send('download-complete', { 
            id: downloadId, 
            state: 'failed', 
            fileName,
            error: errMsg
          });
          resolve({ success: false, error: errMsg });
        }
      });

      proc.on('error', (err) => {
        mainWindow.webContents.send('download-complete', { id: downloadId, state: 'failed', fileName });
        resolve({ success: false, error: err.message });
      });
    });

  } catch (error) {
    console.error('download-youtube error:', error.message);
    mainWindow.webContents.send('download-complete', { id: downloadId, state: 'failed', fileName });
    return { success: false, error: error.message };
  }
});

// Torrent Download Handler
let torrentClient;
ipcMain.handle('download-torrent', async (event, magnetOrTorrentUrl) => {
  if (!WebTorrent) {
    return { success: false, error: 'WebTorrent not installed' };
  }

  try {
    if (!torrentClient) {
      torrentClient = new WebTorrent();
    }

    const downloadsPath = path.join(os.homedir(), 'Downloads', 'Torrents');
    if (!fs.existsSync(downloadsPath)) {
      fs.mkdirSync(downloadsPath, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const torrent = torrentClient.add(magnetOrTorrentUrl, { path: downloadsPath });
      const downloadId = Date.now().toString();

      torrent.on('ready', () => {
        mainWindow.webContents.send('download-started', {
          id: downloadId,
          fileName: torrent.name,
          totalBytes: torrent.length,
          type: 'torrent',
          numPeers: torrent.numPeers
        });

        resolve({
          success: true,
          id: downloadId,
          name: torrent.name,
          size: torrent.length,
          files: torrent.files.map(f => f.name)
        });
      });

      // Progress updates
      const progressInterval = setInterval(() => {
        if (torrent.progress === 1) {
          clearInterval(progressInterval);
          mainWindow.webContents.send('download-complete', {
            id: downloadId,
            state: 'completed',
            filePath: downloadsPath,
            fileName: torrent.name
          });
        } else {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            receivedBytes: torrent.downloaded,
            totalBytes: torrent.length,
            progress: torrent.progress * 100,
            downloadSpeed: torrent.downloadSpeed,
            numPeers: torrent.numPeers
          });
        }
      }, 1000);

      torrent.on('error', (err) => {
        clearInterval(progressInterval);
        mainWindow.webContents.send('download-complete', {
          id: downloadId,
          state: 'failed',
          fileName: torrent.name
        });
        reject({ success: false, error: err.message });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Open downloads folder
ipcMain.handle('open-downloads-folder', async () => {
  const downloadsPath = path.join(os.homedir(), 'Downloads');
  require('electron').shell.openPath(downloadsPath);
  return { success: true };
});

// Get current page URL for YouTube detection
ipcMain.handle('get-current-url', async (event) => {
  const webContents = event.sender;
  return webContents.getURL();
});

// Grammar check via LanguageTool public API
ipcMain.handle('check-grammar', async (event, text, language = 'en-US') => {
  const content = String(text || '').trim();
  if (content.length < 3) return { success: true, matches: [] };

  // Keep requests bounded for reliability and API limits.
  const payloadText = content.slice(0, 15000);

  return await new Promise((resolve) => {
    const https = require('https');
    const params = new URLSearchParams();
    params.append('text', payloadText);
    params.append('language', language || 'en-US');
    params.append('enabledOnly', 'false');
    params.append('level', 'picky');
    params.append('disabledRules', 'WHITESPACE_RULE,CONSECUTIVE_SPACES');
    const postData = params.toString();

    const req = https.request({
      hostname: 'api.languagetool.org',
      port: 443,
      path: '/v2/check',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'application/json',
        'User-Agent': 'ProtonBrowser/1.0'
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return resolve({ success: false, matches: [], error: `HTTP ${res.statusCode}` });
        }
        try {
          const parsed = JSON.parse(data);
          const matches = (parsed.matches || []).map((m) => {
            const catId = String(m.rule?.category?.id || '').toUpperCase();
            const typeName = String(m.type?.typeName || '').toLowerCase();
            let category = 'grammar';
            if (catId.includes('SPELL') || catId.includes('TYPO') || typeName === 'unknownword') {
              category = 'spelling';
            } else if (catId.includes('STYLE') || catId.includes('COLLOQUIAL') || catId.includes('REDUNDANCY')) {
              category = 'style';
            } else if (catId.includes('PUNCTUATION')) {
              category = 'punctuation';
            }
            return {
              offset: m.offset,
              length: m.length,
              message: m.message,
              category,
              replacements: (m.replacements || []).slice(0, 5).map((r) => ({ value: r.value })),
              context: m.context || null
            };
          });
          resolve({ success: true, matches });
        } catch (e) {
          resolve({ success: false, matches: [], error: 'Parse error' });
        }
      });
    });

    req.on('error', (err) => resolve({ success: false, matches: [], error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, matches: [], error: 'Timeout' });
    });
    req.write(postData);
    req.end();
  });
});

// ==================== AUTO-UPDATER SETUP ====================

// ── Change these two values when you push to a real GitHub repo ──────────────
const UPDATER_GITHUB_OWNER = 'YOUR_GITHUB_USERNAME';
const UPDATER_GITHUB_REPO  = 'proton-browser';
// ─────────────────────────────────────────────────────────────────────────────

// Only run auto-updater when:
//   1. The app is packaged (not running from source)
//   2. The GitHub owner has been set (not the default placeholder)
const updaterConfigured =
  app.isPackaged &&
  UPDATER_GITHUB_OWNER !== 'YOUR_GITHUB_USERNAME' &&
  UPDATER_GITHUB_OWNER.trim() !== '';

if (updaterConfigured) {
  try {
    autoUpdater.autoDownload = false; // Ask user before downloading
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.setFeedURL({
      provider: 'github',
      owner: UPDATER_GITHUB_OWNER,
      repo:  UPDATER_GITHUB_REPO
    });

    // ── Events ───────────────────────────────────────────────────────────────
    autoUpdater.on('checking-for-update', () => {
      console.log('🔄 Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('✅ Update available:', info.version);
      if (mainWindow) {
        mainWindow.webContents.send('update-available', {
          version: info.version,
          releaseDate: info.releaseDate
        });
      }
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('✅ App is up to date');
      if (mainWindow) {
        mainWindow.webContents.send('update-not-available', info);
      }
    });

    // Errors are logged only — never shown to the user as a scary popup
    autoUpdater.on('error', (err) => {
      console.warn('⚠️  Auto-updater error (silent):', err.message || err);
      // Do NOT send 'update-error' to the renderer so no dialog appears
    });

    autoUpdater.on('download-progress', (progressObj) => {
      if (mainWindow) {
        mainWindow.webContents.send('update-download-progress', {
          percent:         Math.round(progressObj.percent),
          transferred:     progressObj.transferred,
          total:           progressObj.total,
          bytesPerSecond:  progressObj.bytesPerSecond
        });
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('✅ Update downloaded, ready to install');
      if (mainWindow) {
        mainWindow.webContents.send('update-downloaded', {
          version:     info.version,
          releaseDate: info.releaseDate
        });
      }
    });

    // Check on start (after 10 s) and every 4 hours
    app.whenReady().then(() => {
      setTimeout(() => {
        try { autoUpdater.checkForUpdates(); } catch (e) { /* silent */ }
      }, 10000);

      setInterval(() => {
        try { autoUpdater.checkForUpdates(); } catch (e) { /* silent */ }
      }, 4 * 60 * 60 * 1000);
    });

  } catch (e) {
    console.warn('⚠️  Auto-updater setup failed (silent):', e.message);
  }
} else {
  if (app.isPackaged) {
    console.log('ℹ️  Auto-updater skipped: GitHub repo not configured yet.');
  } else {
    console.log('ℹ️  Auto-updater disabled in development mode.');
  }
}

// IPC handlers for update controls
ipcMain.handle('check-for-updates', async () => {
  if (!updaterConfigured) {
    return { success: false, error: 'Auto-updates not configured yet.' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-update', async () => {
  if (!updaterConfigured) {
    return { success: false, error: 'Auto-updates not configured yet.' };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('quit-and-install', () => {
  if (updaterConfigured) {
    autoUpdater.quitAndInstall(false, true);
  }
});

ipcMain.handle('get-version', () => {
  return app.getVersion();
});

// ── Stealth mode IPC ──────────────────────────────────────────────────────
ipcMain.handle('get-stealth-config', () => {
  return stealthConfig;
});

ipcMain.handle('set-stealth-mode', (event, enabled) => {
  stealthConfig.stealthMode = Boolean(enabled);
  saveStealthConfig();
  if (enabled) {
    deleteShortcuts();
    hideFromWindowsSearch();   // remove from Windows Search + App Paths registry
    destroyTray();
    if (mainWindow) {
      mainWindow.setSkipTaskbar(true);
      mainWindow.hide();
    }
  } else {
    recreateShortcuts();
    showInWindowsSearch();     // restore registry so Windows Search finds it again
    if (mainWindow) {
      mainWindow.setSkipTaskbar(true);
      mainWindow.show();
      mainWindow.focus();
    }
    createTray();
  }
  return stealthConfig;
});

ipcMain.handle('set-secret-code', (event, code) => {
  if (!isValidCode(code)) {
    return { success: false, error: 'Code must be 3–20 letters/numbers, starting with a letter' };
  }
  unregisterProtocol(stealthConfig.secretCode);
  stealthConfig.secretCode = code;
  saveStealthConfig();
  registerProtocol(code);
  return { success: true, secretCode: code };
});

ipcMain.handle('show-window', () => {
  showWindow();
  return { success: true };
});

ipcMain.handle('get-hotkey', () => {
  return { hotkey: stealthConfig.hotkey };
});

ipcMain.handle('set-hotkey', (event, key) => {
  unregisterHotkey();
  stealthConfig.hotkey = key || '';
  saveStealthConfig();
  if (key) registerHotkey();
  return { success: true, hotkey: stealthConfig.hotkey };
});


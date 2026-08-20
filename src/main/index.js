const { app, BrowserWindow, WebContentsView, ipcMain, session, protocol, nativeImage, dialog, Tray, Menu, globalShortcut, nativeTheme, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
// ESM import so electron-vite/Rollup bundles this local module into out/main
// (relative require() is left unresolved by the SSR build).
import { TabsController } from './tabs-controller.js';

// ── Resource path helpers ───────────────────────────────────────────────────
// This file is bundled by electron-vite to <root>/out/main/index.js, so
// __dirname is out/main — NOT the project root. Disk assets are resolved
// through these helpers: in dev they sit at the project root; in a packaged
// build they ship via electron-builder (extraResources / asarUnpack).
const APP_ROOT    = path.join(__dirname, '..', '..');            // out/main -> <root>
const PRELOAD_DIR = path.join(__dirname, '..', 'preload');       // out/preload
const RES_DIR     = app.isPackaged ? path.join(process.resourcesPath, 'resources')
                                   : path.join(APP_ROOT, 'resources');
const ASSETS_DIR  = app.isPackaged ? path.join(process.resourcesPath, 'assets')
                                   : path.join(APP_ROOT, 'assets');
const NATIVE_DIR  = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release')
                                   : path.join(APP_ROOT, 'build', 'Release');
const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'index.html'); // prod build output

// Give the dev instance its own data directory so it never shares cache files
// with the installed AppRuntime.exe that may already be running in the tray.
// Shared cache = locked file handles = "Unable to move the cache" on every launch.
if (!app.isPackaged) {
  const _devData = path.join(app.getPath('appData'), 'quantumx-dev');
  app.setPath('userData', _devData);
  // Override Chromium's computed cache paths with explicit locations.
  // Without this the out-of-process network service tries to RENAME the default
  // Cache/ directory during initialisation and fails with ERROR_ACCESS_DENIED (0x5)
  // when a previous dev instance left file handles open (crash, tray residue, etc.).
  // Supplying an explicit path makes Chromium skip the rename/migrate step entirely.
  app.commandLine.appendSwitch('disk-cache-dir',  path.join(_devData, 'NetCache'));
  app.commandLine.appendSwitch('media-cache-dir', path.join(_devData, 'MediaCache'));
}

// ── Dev-only diagnostic switches (all default OFF; packaged builds unaffected) ──
// Used to bisect which subsystem breaks a page. Examples:
//   QX_SAFE=1 npm run dev          → disable everything below
//   QX_NO_PRELOAD=1 npm run dev    → tabs get no page preload
//   QX_NO_ADFILTER=1 npm run dev   → no network ad filtering / IMA redirect
//   QX_NO_INJECT=1 npm run dev     → renderer skips injections + bridge poll
const _qxSafe = process.env.QX_SAFE === '1';
const QX = {
  safe:        _qxSafe,
  noPreload:   _qxSafe || process.env.QX_NO_PRELOAD === '1',
  noAdFilter:  _qxSafe || process.env.QX_NO_ADFILTER === '1',
  noInject:    _qxSafe || process.env.QX_NO_INJECT === '1'
};
if (QX.safe || QX.noPreload || QX.noAdFilter || QX.noInject) {
  console.log('[QX-DEBUG] flags →', JSON.stringify(QX));
}

let mainWindow;
let chromeView = null;      // WebContentsView hosting index.html (the browser chrome)
let tabs = null;            // TabsController — owns WebContentsView web tabs
// contentTop = pixel offset where the page content begins (tab-strip + navbar,
// +embed toolbar). expanded = chrome view covers the whole window (an overlay is
// open) vs. collapsed to just the top strip so the page below is interactive.
let uiLayout = { contentTop: 98, expanded: true };
let screenProtection;

// Send an IPC message to the chrome renderer (index.html now lives in chromeView,
// not the window's own webContents).
function uiSend(channel, ...args) {
  try {
    if (chromeView && chromeView.webContents && !chromeView.webContents.isDestroyed()) {
      chromeView.webContents.send(channel, ...args);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  } catch (_) {}
}

// Position the chrome overlay view and the active tab view for the current layout.
function applyLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const cb = mainWindow.getContentBounds();
  const W = cb.width, H = cb.height;
  const top = uiLayout.contentTop || 98;
  if (chromeView) {
    chromeView.setBounds(uiLayout.expanded
      ? { x: 0, y: 0, width: W, height: H }
      : { x: 0, y: 0, width: W, height: top });
  }
  if (tabs) tabs.setBounds({ x: 0, y: top, width: W, height: Math.max(0, H - top) });
  // Push physical-pixel content-area bounds to the renderer for the native
  // window-embed feature (it can't measure the content area itself now that the
  // chrome view may be collapsed).
  try {
    const sf = screen.getDisplayMatching(cb).scaleFactor || 1;
    uiSend('ui:content-bounds', {
      x: 0, y: Math.round(top * sf),
      w: Math.round(W * sf), h: Math.round(Math.max(0, H - top) * sf)
    });
  } catch (_) {}
}
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
const UNIVERSAL_CODE = 'proton'; // built-in master code — always works
let stealthConfig = { secretCode: 'quantumx', stealthMode: false, hotkey: 'Ctrl+Shift+Space' };

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
    $appId = 'com.quantumx.app'

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
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\QuantumX.exe',
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\QuantumX.exe'
    )) { Remove-Item $p -Force -Recurse -ErrorAction SilentlyContinue }

    # 4. Remove HKCR Applications entry Windows auto-creates when app is launched
    foreach ($p in @(
      'Registry::HKEY_CLASSES_ROOT\\Applications\\QuantumX.exe',
      'HKLM:\\SOFTWARE\\Classes\\Applications\\QuantumX.exe',
      'HKCU:\\Software\\Classes\\Applications\\QuantumX.exe'
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
    $appId   = 'com.quantumx.app'
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
    $appPathKey = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\QuantumX.exe'
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

function isUnlockCode(code) {
  return code === UNIVERSAL_CODE || code === stealthConfig.secretCode;
}

function registerProtocol(code) {
  app.setAsDefaultProtocolClient(UNIVERSAL_CODE); // master code always registered
  if (isValidCode(code) && code !== UNIVERSAL_CODE) {
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

    $smDir = Join-Path ([Environment]::GetFolderPath('CommonStartMenu')) 'Programs\\QuantumX'
    if (!(Test-Path $smDir)) { New-Item $smDir -ItemType Directory -Force | Out-Null }
    $sc = $WShell.CreateShortcut((Join-Path $smDir 'QuantumX.lnk'))
    $sc.TargetPath  = $exePath
    $sc.Description = 'QuantumX'
    $sc.Save()

    $desktop = [Environment]::GetFolderPath('Desktop')
    $sc2 = $WShell.CreateShortcut((Join-Path $desktop 'QuantumX.lnk'))
    $sc2.TargetPath  = $exePath
    $sc2.Description = 'QuantumX'
    $sc2.Save()
  `, { PS_EXE_PATH: process.execPath });
}

function createTray() {
  if (tray) return;
  try {
    const iconPath = path.join(ASSETS_DIR, 'logo.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('QuantumX — click to open');
    const menu = Menu.buildFromTemplate([
      { label: 'Open QuantumX', click: showWindow },
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
    // Re-apply stealth style + title after every show()
    // (Windows can clear WS_EX_TOOLWINDOW on hidden→visible transitions)
    applyStealthWindowStyle();
    maskWindowTitle();
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
  screenProtection = require(path.join(NATIVE_DIR, 'screen-protection.node'));
} catch (err) {
  console.log('Screen protection module not available. Please run: npm run rebuild');
}

// ── Known monitoring / employee-surveillance process names ────────────────────
// When any of these are detected running, the app sends a warning to the UI
// so the user can take action.  Detection does NOT auto-hide — that would be
// too disruptive and may cause false positives.
const MONITORING_PROCESSES = new Set([
  // Time Doctor
  'timedoctor2.exe','td_agent.exe','td_idle.exe','td2client.exe',
  'timedoctor.exe','timedoctorhost.exe','td_dls.exe',
  // Hubstaff
  'hubstaff.exe','hubstaff_log.exe',
  // Teramind
  'tmclient.exe','teramind.exe','tmsvc.exe','tmdriver.exe',
  // ActivTrak
  'activtrak.exe','aaservice.exe','aatservice.exe',
  // Workstatus
  'workstatus.exe','workstatusagent.exe',
  // DeskTime
  'desktime.exe',
  // Insightful / Workpuls
  'insightful.exe','workpuls.exe','desktopagent.exe',
  // Veriato
  'veriato.exe','vrclient.exe','cirronet.exe',
  // StaffCop
  'staffcop.exe','sc_agent.exe','staffcopenterprise.exe',
  // SoftActivity
  'saservice.exe','softactivity.exe','saserver.exe',
  // iMonitor
  'imonitorsoft.exe','imonagent.exe',
  // WorkExaminer
  'weagent.exe','workexaminer.exe',
  // REFOG
  'kpf4ss.exe','refog.exe','kpf4gui.exe',
  // BambooHR monitoring
  'bamboomonitoring.exe',
  // InterGuard
  'agupdater.exe','interguard.exe',
  // Kick Idle
  'kickidle.exe',
  // Monitask
  'monitask.exe',
  // Empmonitor
  'empmonitor.exe',
  // CleverControl
  'clevercontrol.exe',
  // Teramind cloud agent (seen as generic name)
  'tmagent.exe',
]);

let _detectedMonitorApps = [];
let _monitorDetectionInterval = null;

async function detectMonitoringApps() {
  if (process.platform !== 'win32') return [];
  return new Promise((resolve) => {
    // tasklist /fo csv /nh gives: "name.exe","pid","session","#","mem usage"
    const { exec } = require('child_process');
    exec('tasklist /fo csv /nh 2>nul', { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve([]);
      const found = [];
      const lines = stdout.split('\n');
      for (const line of lines) {
        // First CSV field is the process name (quoted)
        const m = line.match(/^"([^"]+)"/);
        if (m) {
          const name = m[1].toLowerCase();
          if (MONITORING_PROCESSES.has(name)) found.push(m[1]);
        }
      }
      resolve(found);
    });
  });
}

function startMonitoringDetection() {
  if (_monitorDetectionInterval) return;
  const check = async () => {
    const found = await detectMonitoringApps();
    const changed = JSON.stringify(found) !== JSON.stringify(_detectedMonitorApps);
    _detectedMonitorApps = found;
    if (changed && mainWindow && !mainWindow.isDestroyed()) {
      uiSend('monitoring-detected', { apps: found });
    }
  };
  check(); // run immediately on startup
  _monitorDetectionInterval = setInterval(check, 30_000); // then every 30 s
}

// ── Stealth window style ───────────────────────────────────────────────────────
// Applies WS_EX_TOOLWINDOW which hides the window from EnumWindows — the main
// API that monitoring tools use to find and log the foreground window.
// Combined with our fake window title this means monitoring software cannot
// see the window at all via standard Windows enumeration APIs.
let _stealthStyleApplied = false;

function applyStealthWindowStyle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!screenProtection || !screenProtection.setStealthWindowStyle) return;
  try {
    const hwnd = mainWindow.getNativeWindowHandle();
    const hwndValue = hwnd.readUInt32LE(0);
    screenProtection.setStealthWindowStyle(hwndValue, true);
    _stealthStyleApplied = true;
  } catch (err) {
    console.error('applyStealthWindowStyle error:', err.message);
  }
}

// ── Window title masking ───────────────────────────────────────────────────────
// When monitoring software calls GetWindowText on the foreground window it reads
// this title.  We set a neutral value so it never logs "QuantumX" or the URL.
// The fake title is applied at native level via SetWindowText so it survives
// Electron's own page-title-updated mechanism.
const MASKED_TITLE = ''; // blank — shows as the exe name in most tools

function maskWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setTitle(MASKED_TITLE);
    if (screenProtection && screenProtection.setWindowTextNative) {
      const hwnd = mainWindow.getNativeWindowHandle();
      const hwndValue = hwnd.readUInt32LE(0);
      screenProtection.setWindowTextNative(hwndValue, MASKED_TITLE);
    }
  } catch (e) {}
}

// Prevent the HTML page-title from overwriting our masked title
function suppressPageTitleUpdates() {
  const wc = (chromeView && chromeView.webContents) || (mainWindow && mainWindow.webContents);
  if (!wc || wc.isDestroyed()) return;
  wc.on('page-title-updated', (event) => {
    event.preventDefault();
    maskWindowTitle();
  });
}

// ── Screenshot Protection Helper ───────────────────────────────────────────
let screenProtectionEnabled = true; // tracks current state

function applyScreenProtection(enable) {
  if (!mainWindow) return;
  try {
    if (screenProtection) {
      // Native WDA_EXCLUDEFROMCAPTURE — window is fully transparent/invisible in
      // any screen capture or screen share. Do NOT also call setContentProtection
      // here because that applies WDA_MONITOR (black rectangle) which overwrites
      // our transparent flag.
      const hwnd = mainWindow.getNativeWindowHandle();
      const hwndValue = hwnd.readUInt32LE(0); // HWND fits in 32 bits on Windows
      screenProtection.setScreenProtection(hwndValue, enable);
    } else {
      // Fallback for non-Windows or if native module didn't load: Electron built-in
      // uses WDA_MONITOR which shows a black rectangle — better than nothing.
      mainWindow.setContentProtection(enable);
    }
    screenProtectionEnabled = enable;
  } catch (err) {
    console.error('applyScreenProtection error:', err);
  }
}

function createWindow() {
  // Load icon - try PNG first, fallback to SVG
  let appIcon;
  const icoIconPath = path.join(ASSETS_DIR, 'logo.ico');
  const pngIconPath = path.join(ASSETS_DIR, 'logo.png');
  const svgIconPath = path.join(ASSETS_DIR, 'logo.svg');
  
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
      preload: path.join(PRELOAD_DIR, 'index.js'),
      webviewTag: true,
      sandbox: false,
      // Performance optimizations
      enablePreferredSizeMode: true,
      spellcheck: false
    },
    title: 'QuantumX',
    icon: appIcon,
    backgroundColor: '#06070b',
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

  // Chrome (index.html) renders in a transparent WebContentsView layered ON TOP
  // of the tab views, so overlays/menus/panels can float above the page. The
  // window's own webContents stays blank (a solid background behind everything).
  chromeView = new WebContentsView({
    webPreferences: {
      preload: path.join(PRELOAD_DIR, 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // Surface dev bisect flags to the renderer (read in src/preload/index.js).
      additionalArguments: QX.noInject ? ['--qx-no-inject'] : []
    }
  });
  try { chromeView.setBackgroundColor('#00000000'); } catch (_) {}
  mainWindow.contentView.addChildView(chromeView);

  // electron-vite serves the renderer from a dev server in development and from
  // the built HTML in production.
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    chromeView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    chromeView.webContents.loadFile(RENDERER_HTML);
  }

  // Own web tabs as main-process WebContentsViews (replaces renderer <webview>).
  // Constructed AFTER chromeView so tab views insert beneath it (see TabsController).
  // Uses the same persist:secure session the UA/permission/ad-filter wiring is
  // attached to, and the page preload that performs the fingerprint spoof + IMA stub.
  tabs = new TabsController(mainWindow, {
    session: session.fromPartition('persist:secure'),
    userAgent: CHROME_UA,
    // QX_NO_PRELOAD / QX_SAFE: run tabs with no page preload (disables the
    // fingerprint spoof, IMA stub and YouTube cosmetic layer) for bisecting.
    preloadPath: QX.noPreload ? null : path.join(PRELOAD_DIR, 'page-preload.js'),
    // Page events must go to the chrome renderer (chromeView), not the blank
    // window webContents.
    send: uiSend
  });

  // Initial layout, and keep views sized on window resize.
  applyLayout();
  mainWindow.on('resize', applyLayout);

  // Default web content to dark (matches the default chrome theme) until the
  // renderer restores the user's saved theme preference.
  try { nativeTheme.themeSource = 'dark'; } catch (_) {}

  // Suppress page-title-updated so the window title stays masked at OS level
  suppressPageTitleUpdates();

  // Apply all protections after the chrome finishes loading.
  chromeView.webContents.on('did-finish-load', () => {
    applyScreenProtection(true);
    applyStealthWindowStyle();
    maskWindowTitle();
  });

  // Re-apply after every show() — Windows clears both WDA_EXCLUDEFROMCAPTURE
  // and WS_EX_TOOLWINDOW when a window transitions from hidden to visible.
  mainWindow.on('show', () => {
    if (screenProtectionEnabled) applyScreenProtection(true);
    applyStealthWindowStyle();
    maskWindowTitle();
  });

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
    uiSend('download-started', {
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
          
          uiSend('download-progress', {
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
        
        uiSend('download-complete', {
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
      if (isUnlockCode(code)) {
        showWindow();
      }
    } else {
      showWindow();
    }
  });
}

// Register proton-stub: as a privileged scheme before app.ready so the IMA SDK
// redirect (imasdk.googleapis.com → proton-stub://ima3) works in webviews.
protocol.registerSchemesAsPrivileged([{
  scheme: 'proton-stub',
  privileges: { standard: true, secure: true, bypassCSP: true, corsEnabled: true, supportFetchAPI: true },
}]);

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// ── Secure every new OS window (PiP, OAuth popups, etc.) ─────────────────────
// Uses WDA_EXCLUDEFROMCAPTURE (fully invisible in screenshots, not black).
// Node.js runs on Chromium's browser-main thread in Electron, which is the same
// thread that creates ALL BrowserWindows — so SetWindowDisplayAffinity succeeds
// for every window in this process, including PiP overlays.
// IMPORTANT: Do NOT use win.setContentProtection() here — Electron's API applies
// WDA_MONITOR which shows a black rectangle.  Our native setScreenProtection uses
// WDA_EXCLUDEFROMCAPTURE which makes the window completely invisible, matching the
// main window's behaviour.
function _secureWin(win) {
  if (!win) return;
  const apply = () => {
    try {
      const hwnd = win.getNativeWindowHandle().readUInt32LE(0);
      if (!hwnd || !screenProtection) return;
      // WDA_EXCLUDEFROMCAPTURE → window is invisible to all capture tools
      if (screenProtection.setScreenProtection)   screenProtection.setScreenProtection(hwnd, true);
      // WS_EX_TOOLWINDOW → hidden from monitoring-tool EnumWindows scans
      if (screenProtection.setStealthWindowStyle) screenProtection.setStealthWindowStyle(hwnd, true);
    } catch (e) {}
  };
  apply();
  win.once('ready-to-show', apply);
  win.once('show', apply);
  win.on('restore', apply);
  setTimeout(apply, 300);
  setTimeout(apply, 800);
}

app.on('browser-window-created', (_event, win) => _secureWin(win));

// ── Polling fallback for PiP windows ─────────────────────────────────────────
// browser-window-created may not fire when Chromium manages PiP internally.
// BrowserWindow.getAllWindows() catches standard popup windows.
// screenProtection.enumOwnProcessWindows() catches Chromium-internal windows
// such as the PiP overlay that are owned by our process but NOT tracked as
// Electron BrowserWindows — this is the key gap the previous approach missed.
const _knownWinIds  = new Set();
const _knownOwnHwnds = new Set();

function _pollNewWindows() {
  // 1. Standard BrowserWindows (OAuth popups, etc.)
  BrowserWindow.getAllWindows().forEach(win => {
    if (_knownWinIds.has(win.id)) return;
    _knownWinIds.add(win.id);
    _secureWin(win);
  });

  // 2. Native own-process windows (Chromium PiP overlay, not a BrowserWindow)
  if (!screenProtection?.enumOwnProcessWindows) return;
  try {
    const mainHwnd = mainWindow ? mainWindow.getNativeWindowHandle().readUInt32LE(0) : 0;
    screenProtection.enumOwnProcessWindows().forEach(hwnd => {
      if (_knownOwnHwnds.has(hwnd)) return;
      _knownOwnHwnds.add(hwnd);
      if (hwnd === mainHwnd) return; // skip main window — already protected separately
      // SetWindowDisplayAffinity: works cross-thread within the same process.
      if (screenProtection.setScreenProtection)   screenProtection.setScreenProtection(hwnd, true);
      if (screenProtection.setStealthWindowStyle) screenProtection.setStealthWindowStyle(hwnd, true);
    });
  } catch (e) {}
}
// Start polling after app is ready (interval set up in app.whenReady block below)

// Delete the persist:secure partition HTTP cache before Chromium initialises it.
// This prevents the "Unable to move the cache: Access is denied" errors that
// occur when the previous run's process held file locks on Cache_Data/.
app.on('ready', () => {
  // Disguise the process-level app identity in Windows shell / taskbar grouping.
  // This is the identity Windows uses for Jump Lists and some monitoring-tool
  // process categorisation — setting it to a generic runtime ID makes the
  // process look like a host service rather than a named browser.
  app.setAppUserModelId('Windows.ApplicationHost.Runtime');

  // Optionally set it at native level too (shell32 call inside the addon)
  if (screenProtection && screenProtection.setProcessAppModelId) {
    try { screenProtection.setProcessAppModelId('Windows.ApplicationHost.Runtime'); } catch (e) {}
  }

  // Load stealth config and register the secret protocol
  loadStealthConfig();
  registerProtocol(stealthConfig.secretCode);
  registerHotkey();
  // Enforce shortcut + registry visibility based on saved stealth state
  if (stealthConfig.stealthMode) {
    deleteShortcuts();
    hideFromWindowsSearch();
  }

  // ── Sessions: apply UA, permissions, and ad filter to BOTH sessions ────────
  // Webviews use persist:secure; the shell uses defaultSession.
  // BOTH must be configured or login pages / permissions silently fail.
  const webviewSession = session.fromPartition('persist:secure');

  for (const sess of [session.defaultSession, webviewSession]) {
    sess.setUserAgent(CHROME_UA);

    // Override User-Agent header on every outgoing request
    sess.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      details.requestHeaders['User-Agent'] = CHROME_UA;
      // Remove Electron-specific headers that sites use to detect non-browser clients
      delete details.requestHeaders['X-Electron-Version'];
      callback({ requestHeaders: details.requestHeaders });
    });

    // Allow all permissions — same as a real browser (needed for Google/Facebook login)
    sess.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
    sess.setPermissionCheckHandler(() => true);
  }

  // ── Ad / tracker blocker ──────────────────────────────────────────────────
  // Pre-compiled regex: O(1) per request instead of O(n) array iteration.
  // Login/auth domains (accounts.google.com, facebook.com, etc.) are NOT in
  // either list so they always pass through unmodified.
  const _adRe  = /doubleclick\.net|googlesyndication\.com|adservice\.google\.com|googleadservices\.com|google-analytics\.com|analytics\.google\.com|adnxs\.com|moatads\.com|rubiconproject\.com|pubmatic\.com|openx\.net|advertising\.com|taboola\.com|outbrain\.com|pagead2\.googlevideo\.com|ads\.youtube\.com|googleads\.g\.doubleclick\.net|static\.doubleclick\.net|imasdk\.googleapis\.com|tpc\.googlesyndication\.com|ade\.googlesyndication\.com|fundingchoicesmessages\.google\.com/;
  const _fragRe = /\/api\/stats\/ads|\/pagead\/|\/pcs\/activeview|ad_tag_uri|\/youtubei\/v1\/log_event\?.*adformat|\/api\/stats\/qoe\?.*adformat/;
  // Never block: messaging, social auth, CDN — logins depend on these
  const _wlRe  = /whatsapp\.com|whatsapp\.net|fbcdn\.net|facebook\.com|gstatic\.com|googleapis\.com|telegram\.org|discord\.com|slack\.com|linkedin\.com|openai\.com|chatgpt\.com|accounts\.google|oauth|login|signin/;

  // Ad/anti-adblock SCRIPTS that must never hard-fail. YouTube treats a failed
  // load of these as "ad blocker detected" and then refuses to play the video
  // ("An error occurred. Please try again later."). Serving an empty 200 instead
  // of cancelling keeps the player happy while still delivering no ad code.
  const _emptyScriptRe = /static\.doubleclick\.net\/instream\/ad_status\.js|googletagservices\.com\/tag\/js\/gpt\.js|pagead2\.googlesyndication\.com\/pagead\/js/;

  // Serve ima-stub.js in place of the real IMA SDK; 'empty' → harmless no-op JS.
  const _imaStubHandler = (req) => {
    try {
      if (/empty/.test(req.url)) {
        return new Response('/* neutralized */', { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
      }
      const js = fs.readFileSync(path.join(RES_DIR, 'ima-stub.js'), 'utf8');
      return new Response(js, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
    } catch (e) {
      return new Response('', { status: 404 });
    }
  };
  protocol.handle('proton-stub', _imaStubHandler);

  function buildAdFilter(sess) {
    sess.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const url = details.url;
      // Redirect IMA SDK to our stub before any other check
      if (url.includes('imasdk.googleapis.com')) {
        return callback({ redirectURL: 'proton-stub://ima3' });
      }
      // Anti-adblock detection scripts: hand back empty JS (200) rather than a
      // network failure, otherwise YouTube refuses to play the video.
      if (_emptyScriptRe.test(url)) {
        return callback({ redirectURL: 'proton-stub://empty' });
      }
      if (_wlRe.test(url)) return callback({ cancel: false });
      callback({ cancel: _adRe.test(url) || _fragRe.test(url) });
    });
  }

  // QX_NO_ADFILTER / QX_SAFE: leave all network requests untouched for bisecting.
  if (!QX.noAdFilter) {
    buildAdFilter(session.defaultSession);
    buildAdFilter(webviewSession);
  } else {
    console.log('[QX-DEBUG] network ad filter DISABLED');
  }
  // Register IMA stub handler on the webview session too — the redirect target
  // must resolve in the session that made the request (persist:secure).
  webviewSession.protocol.handle('proton-stub', _imaStubHandler);

  createWindow();

  // Seed the known-window set with the main window, then start polling for new
  // windows every 500 ms.  This guarantees PiP windows are secured within 500 ms
  // of creation regardless of whether browser-window-created fires for them.
  _knownWinIds.add(mainWindow.id);
  setInterval(_pollNewWindows, 500);

  // Start periodic monitoring-app detection after window is ready
  startMonitoringDetection();

  // (Tabs are now WebContentsViews created by TabsController with the page
  // preload + contextIsolation:false set directly in webPreferences — the old
  // will-attach-webview hook for <webview> tags is no longer needed.)

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

// Make web pages (prefers-color-scheme) follow the browser theme toggle
ipcMain.on('set-native-theme', (event, theme) => {
  try { nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark'; } catch (_) {}
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

// ── Tab (WebContentsView) IPC ───────────────────────────────────────────────
// The renderer owns the tab-strip UI + injection logic and drives the actual
// page views through these handlers. Page events flow back on 'tab:event'.
ipcMain.handle('tab:create',     (_e, { id, url }) => { tabs && tabs.create({ id, url }); return { success: true }; });
ipcMain.handle('tab:activate',   (_e, id) => { tabs && tabs.activate(id); return { success: true }; });
ipcMain.handle('tab:close',      (_e, id) => { tabs && tabs.close(id); return { success: true }; });
ipcMain.handle('tab:navigate',   (_e, id, url) => { tabs && tabs.navigate(id, url); return { success: true }; });
ipcMain.handle('tab:back',       (_e, id) => { tabs && tabs.goBack(id); return { success: true }; });
ipcMain.handle('tab:forward',    (_e, id) => { tabs && tabs.goForward(id); return { success: true }; });
ipcMain.handle('tab:reload',     (_e, id) => { tabs && tabs.reload(id); return { success: true }; });
ipcMain.handle('tab:stop',       (_e, id) => { tabs && tabs.stop(id); return { success: true }; });
ipcMain.handle('tab:get-url',    (_e, id) => (tabs ? tabs.getURL(id) : ''));
ipcMain.handle('tab:exec',       (_e, id, code) => (tabs ? tabs.exec(id, code) : null));
ipcMain.handle('tab:zoom',       (_e, id, factor) => { tabs && tabs.setZoom(id, factor); return { success: true }; });
ipcMain.handle('tab:find',       (_e, id, text, opts) => { tabs && tabs.findInPage(id, text, opts); return { success: true }; });
ipcMain.handle('tab:stop-find',  (_e, id) => { tabs && tabs.stopFind(id); return { success: true }; });
ipcMain.handle('tab:print',      (_e, id) => { tabs && tabs.print(id); return { success: true }; });
ipcMain.handle('tab:devtools',   (_e, id) => { tabs && tabs.openDevTools(id); return { success: true }; });
ipcMain.handle('tab:set-bounds', (_e, b) => { tabs && tabs.setBounds(b); return { success: true }; });
ipcMain.handle('tab:hide-all',   () => { tabs && tabs.hideAll(); return { success: true }; });
ipcMain.handle('tab:show-active',() => { tabs && tabs.showActive(); return { success: true }; });

// Overlay layering: the renderer reports the content-top offset (tab-strip +
// navbar, +embed toolbar) and whether an overlay is open (expand the chrome view
// to full-window) or not (collapse it to the top strip so the page is interactive).
ipcMain.handle('ui:layout', (_e, layout) => {
  if (layout && typeof layout.contentTop === 'number') uiLayout.contentTop = layout.contentTop;
  if (layout && typeof layout.expanded === 'boolean') uiLayout.expanded = layout.expanded;
  applyLayout();
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
    if (mainWindow) uiSend('yt-dlp-status', { status: 'downloading' });
    await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
    console.log('✅ yt-dlp binary downloaded');
    if (mainWindow) uiSend('yt-dlp-status', { status: 'ready' });
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
    uiSend('download-started', {
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
            uiSend('download-started', {
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
              uiSend('download-progress', {
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
          uiSend('download-progress', {
            id: downloadId,
            receivedBytes: Math.max(totalBytes, 1),
            totalBytes: Math.max(totalBytes, 1),
            progress: 100,
            speed: 0,
            eta: '0:00'
          });
          uiSend('download-complete', {
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
          uiSend('download-complete', { 
            id: downloadId, 
            state: 'failed', 
            fileName,
            error: errMsg
          });
          resolve({ success: false, error: errMsg });
        }
      });

      proc.on('error', (err) => {
        uiSend('download-complete', { id: downloadId, state: 'failed', fileName });
        resolve({ success: false, error: err.message });
      });
    });

  } catch (error) {
    console.error('download-youtube error:', error.message);
    uiSend('download-complete', { id: downloadId, state: 'failed', fileName });
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
        uiSend('download-started', {
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
          uiSend('download-complete', {
            id: downloadId,
            state: 'completed',
            filePath: downloadsPath,
            fileName: torrent.name
          });
        } else {
          uiSend('download-progress', {
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
        uiSend('download-complete', {
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

// Open a file with its default app / reveal it in the file manager. The renderer
// can no longer require('electron') directly (contextIsolation), so it routes
// these through IPC.
ipcMain.handle('open-path', async (_e, filePath) => {
  if (filePath) await require('electron').shell.openPath(filePath);
  return { success: true };
});
ipcMain.handle('show-item-in-folder', async (_e, filePath) => {
  if (filePath) require('electron').shell.showItemInFolder(filePath);
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
        uiSend('update-available', {
          version: info.version,
          releaseDate: info.releaseDate
        });
      }
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('✅ App is up to date');
      if (mainWindow) {
        uiSend('update-not-available', info);
      }
    });

    // Errors are logged only — never shown to the user as a scary popup
    autoUpdater.on('error', (err) => {
      console.warn('⚠️  Auto-updater error (silent):', err.message || err);
      // Do NOT send 'update-error' to the renderer so no dialog appears
    });

    autoUpdater.on('download-progress', (progressObj) => {
      if (mainWindow) {
        uiSend('update-download-progress', {
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
        uiSend('update-downloaded', {
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

ipcMain.handle('get-adblock-script', () => {
  try { return fs.readFileSync(path.join(RES_DIR, 'yt-adblock.js'), 'utf8'); } catch (e) { return ''; }
});

// ── Monitoring detection IPC ───────────────────────────────────────────────
ipcMain.handle('check-monitoring-apps', async () => {
  const found = await detectMonitoringApps();
  _detectedMonitorApps = found;
  return { apps: found, detected: found.length > 0 };
});

ipcMain.handle('get-monitoring-status', () => {
  return { apps: _detectedMonitorApps, detected: _detectedMonitorApps.length > 0 };
});

// ── PiP protection IPC ────────────────────────────────────────────────────────
// The renderer calls pre-pip-snapshot before requestPictureInPicture() and
// post-pip-protect immediately after.  We diff our own-process window list
// (enumOwnProcessWindows — no title filter, includes the PiP overlay that
// enumVisibleWindows skips) to find the new HWND and secure it.
let _preSnapOwnHwnds = new Set();
ipcMain.handle('pre-pip-snapshot', () => {
  _preSnapOwnHwnds = new Set();
  if (!screenProtection) return;
  try {
    // Snapshot own-process HWNDs (includes the future PiP window)
    if (screenProtection.enumOwnProcessWindows) {
      screenProtection.enumOwnProcessWindows().forEach(h => _preSnapOwnHwnds.add(h));
    }
  } catch (e) {}
});
ipcMain.handle('post-pip-protect', () => {
  if (!screenProtection?.enumOwnProcessWindows) return;
  const mainHwnd = mainWindow ? mainWindow.getNativeWindowHandle().readUInt32LE(0) : 0;
  // Poll up to 2 s (every 200 ms) for the PiP window to appear
  let attempts = 0;
  const iv = setInterval(() => {
    attempts++;
    try {
      screenProtection.enumOwnProcessWindows().forEach(hwnd => {
        if (_preSnapOwnHwnds.has(hwnd)) return; // was there before PiP
        if (hwnd === mainHwnd) return;           // skip main window
        _preSnapOwnHwnds.add(hwnd);              // mark so we don't repeat
        _knownOwnHwnds.add(hwnd);               // keep polling loop in sync
        if (screenProtection.setScreenProtection)   screenProtection.setScreenProtection(hwnd, true);
        if (screenProtection.setStealthWindowStyle) screenProtection.setStealthWindowStyle(hwnd, true);
      });
    } catch (e) {}
    if (attempts >= 10) clearInterval(iv);
  }, 200);
});

ipcMain.handle('get-windows-list', () => {
  if (!screenProtection?.enumVisibleWindows) return [];
  try { return screenProtection.enumVisibleWindows(); } catch (e) { return []; }
});

ipcMain.handle('embed-window', (event, { hwnd, x, y, w, h }) => {
  if (!screenProtection?.embedWindow) return { success: false, error: 'Native module unavailable' };
  try {
    const mainHwnd = mainWindow.getNativeWindowHandle().readUInt32LE(0);
    screenProtection.embedWindow(mainHwnd, hwnd, x, y, w, h);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('launch-and-embed', async (event, { exePath, x, y, w, h }) => {
  if (!screenProtection?.launchAndGetWindow) return { success: false, error: 'Native module unavailable' };
  try {
    const res = screenProtection.launchAndGetWindow(exePath);
    if (!res.hwnd) return { success: false, error: 'Window not found after launch' };
    const mainHwnd = mainWindow.getNativeWindowHandle().readUInt32LE(0);
    screenProtection.embedWindow(mainHwnd, res.hwnd, x, y, w, h);
    return { success: true, hwnd: res.hwnd, pid: res.pid };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('move-embed-window', (event, { hwnd, x, y, w, h }) => {
  if (!screenProtection?.moveEmbedWindow) return { success: false };
  try { screenProtection.moveEmbedWindow(hwnd, x, y, w, h); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('show-embed-window', (event, { hwnd, show }) => {
  if (!screenProtection?.showHideEmbedWindow) return { success: false };
  try { screenProtection.showHideEmbedWindow(hwnd, show); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('release-embed-window', (event, { hwnd }) => {
  if (!screenProtection?.releaseWindow) return { success: false };
  try { screenProtection.releaseWindow(hwnd); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('is-window-valid', (event, { hwnd }) => {
  if (!screenProtection?.isWindowValid) return false;
  try { return screenProtection.isWindowValid(hwnd); } catch (e) { return false; }
});

ipcMain.handle('get-window-icon', async (event, { exePath }) => {
  if (!exePath) return null;
  try {
    const icon = await app.getFileIcon(exePath, { size: 'normal' });
    return icon.toDataURL();
  } catch (e) { return null; }
});

ipcMain.handle('get-stealth-config-full', () => {
  return { ...stealthConfig, universalCode: UNIVERSAL_CODE };
});

// ── Stealth mode IPC ──────────────────────────────────────────────────────
ipcMain.handle('get-stealth-config', () => {
  return { ...stealthConfig, universalCode: UNIVERSAL_CODE };
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

// ── LAN Office Chat & File Sharing ──────────────────────────────────────────
const dgram = require('dgram');
const http = require('http');

let lanHttpServer = null;
let lanUdpSocket = null;
let lanHttpPort = 55055;
const LAN_UDP_PORT = 55056;

let lanUsername = stealthConfig.lanUsername || os.hostname() || 'Colleague';
let lanPeers = new Map(); // ip -> { username, httpPort, ip, lastSeen }
let lanChatHistory = [];
const LAN_CHAT_HISTORY_FILE = path.join(app.getPath('userData'), 'proton-lan-chat.json');
let lanSharedFiles = new Map(); // fileId -> { path, name, size }

// Load history
function loadLanChatHistory() {
  try {
    if (fs.existsSync(LAN_CHAT_HISTORY_FILE)) {
      lanChatHistory = JSON.parse(fs.readFileSync(LAN_CHAT_HISTORY_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[LAN] Error loading chat history:', e);
    lanChatHistory = [];
  }
}

// Save history
function saveLanChatHistory() {
  try {
    // Keep last 200 messages
    if (lanChatHistory.length > 200) {
      lanChatHistory = lanChatHistory.slice(lanChatHistory.length - 200);
    }
    fs.writeFileSync(LAN_CHAT_HISTORY_FILE, JSON.stringify(lanChatHistory, null, 2));
  } catch (e) {
    console.error('[LAN] Error saving chat history:', e);
  }
}

// Helper to get local IP
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Broadcast UDP Discovery
function broadcastPresence(type = 'ping') {
  if (!lanUdpSocket) return;
  
  const localIp = getLocalIPAddress();
  const msg = JSON.stringify({
    type,
    username: lanUsername,
    httpPort: lanHttpPort,
    ip: localIp
  });
  
  try {
    const client = dgram.createSocket('udp4');
    client.bind(0, '0.0.0.0', () => {
      client.setBroadcast(true);
      client.send(msg, LAN_UDP_PORT, '255.255.255.255', (err) => {
        client.close();
        if (err) console.error('[LAN] Broadcast error:', err);
      });
    });
  } catch (e) {
    console.error('[LAN] Broadcast setup error:', e);
  }
}

// Start UDP socket to receive announcements
function startUdpDiscovery() {
  try {
    lanUdpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    
    lanUdpSocket.on('error', (err) => {
      console.error('[LAN] UDP error:', err);
      try { lanUdpSocket.close(); } catch(e){}
      lanUdpSocket = null;
    });

    lanUdpSocket.on('message', (msgStr, rinfo) => {
      try {
        const localIp = getLocalIPAddress();
        // Ignore own broadcasts
        if (rinfo.address === localIp) return;

        const data = JSON.parse(msgStr.toString());
        if (data.type === 'ping' || data.type === 'pong') {
          const peerKey = rinfo.address;
          const isNew = !lanPeers.has(peerKey);
          
          lanPeers.set(peerKey, {
            username: data.username || 'Colleague',
            httpPort: data.httpPort || 55055,
            ip: rinfo.address,
            lastSeen: Date.now()
          });

          if (isNew) {
            notifyPeersChanged();
            // If we got a ping, reply with pong directly so they discover us immediately
            if (data.type === 'ping') {
              sendDirectPong(rinfo.address);
            }
          } else {
            // Update lastSeen timestamp
            lanPeers.get(peerKey).lastSeen = Date.now();
          }
        }
      } catch (e) {
        console.error('[LAN] Error processing UDP packet:', e);
      }
    });

    lanUdpSocket.bind(LAN_UDP_PORT, '0.0.0.0', () => {
      try {
        lanUdpSocket.setBroadcast(true);
      } catch (e) {
        console.warn('[LAN] Failed to setBroadcast, discovery might be limited:', e);
      }
      console.log(`[LAN] UDP listening on port ${LAN_UDP_PORT}`);
    });
  } catch (e) {
    console.error('[LAN] Failed to bind UDP socket:', e);
  }
}

// Send direct pong via UDP to a specific peer
function sendDirectPong(peerIp) {
  try {
    const localIp = getLocalIPAddress();
    const msg = JSON.stringify({
      type: 'pong',
      username: lanUsername,
      httpPort: lanHttpPort,
      ip: localIp
    });
    
    const client = dgram.createSocket('udp4');
    client.send(msg, LAN_UDP_PORT, peerIp, (err) => {
      client.close();
      if (err) console.error('[LAN] Error sending direct pong:', err);
    });
  } catch (e) {
    console.error('[LAN] Error setting up direct pong:', e);
  }
}

// Cleanup inactive peers (every 5 seconds)
function startPeerCleanupTimer() {
  setInterval(() => {
    let changed = false;
    const now = Date.now();
    for (const [ip, peer] of lanPeers.entries()) {
      if (now - peer.lastSeen > 15000) { // 15 seconds timeout
        lanPeers.delete(ip);
        changed = true;
      }
    }
    if (changed) {
      notifyPeersChanged();
    }
    // Also broadcast our own presence periodically
    broadcastPresence('ping');
  }, 5000);
}

function notifyPeersChanged() {
  if (mainWindow) {
    uiSend('lan-peers-changed', Array.from(lanPeers.values()));
  }
}

// Start HTTP Server
function startHttpServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Parse URL manually to support simple paths
    const urlParts = req.url.split('?');
    const pathname = urlParts[0];

    // 1. Post new chat message
    if (pathname === '/api/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const messageData = JSON.parse(body);
          // Add to local history
          lanChatHistory.push(messageData);
          saveLanChatHistory();

          // Send to renderer
          if (mainWindow) {
            uiSend('lan-message-received', messageData);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Bad Request');
        }
      });
      return;
    }

    // 2. Download shared file
    if (pathname.startsWith('/api/download/') && req.method === 'GET') {
      const fileId = pathname.split('/').pop();
      const fileRecord = lanSharedFiles.get(fileId);

      if (!fileRecord || !fs.existsSync(fileRecord.path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File Not Found');
        return;
      }

      try {
        const stat = fs.statSync(fileRecord.path);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(fileRecord.name)}"`,
          'Content-Length': stat.size
        });
        const readStream = fs.createReadStream(fileRecord.path);
        readStream.pipe(res);
      } catch (e) {
        console.error('[LAN] File stream error:', e);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  function listen(port) {
    server.listen(port, '0.0.0.0', () => {
      lanHttpPort = port;
      lanHttpServer = server;
      console.log(`[LAN] HTTP server running on http://0.0.0.0:${lanHttpPort}`);
      
      startUdpDiscovery();
      broadcastPresence('ping');
      startPeerCleanupTimer();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[LAN] Port ${port} in use, trying ${port + 1}`);
        listen(port + 1);
      } else {
        console.error('[LAN] HTTP Server error:', err);
      }
    });
  }

  listen(55055);
}

// Send chat message to all peers
async function broadcastChatMessage(msgData) {
  const peers = Array.from(lanPeers.values());
  const localIp = getLocalIPAddress();
  
  const fullMsgData = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    sender: lanUsername,
    senderIp: localIp,
    message: msgData.message || '',
    file: msgData.file || null,
    timestamp: Date.now()
  };

  lanChatHistory.push(fullMsgData);
  saveLanChatHistory();

  if (mainWindow) {
    uiSend('lan-message-received', fullMsgData);
  }

  for (const peer of peers) {
    try {
      const data = JSON.stringify(fullMsgData);
      const reqOpts = {
        hostname: peer.ip,
        port: peer.httpPort,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 2000
      };

      const req = http.request(reqOpts, (res) => {
        res.on('data', () => {});
      });
      
      req.on('error', (err) => {
        console.error(`[LAN] Failed to send message to ${peer.username} (${peer.ip}):`, err.message);
      });

      req.write(data);
      req.end();
    } catch (err) {
      console.error('[LAN] HTTP Request error:', err);
    }
  }
}

// IPC Handlers
ipcMain.handle('lan-get-status', () => {
  return {
    username: lanUsername,
    ip: getLocalIPAddress(),
    port: lanHttpPort
  };
});

ipcMain.handle('lan-set-username', (event, name) => {
  if (name && name.trim()) {
    lanUsername = name.trim();
    stealthConfig.lanUsername = lanUsername;
    saveStealthConfig();
    broadcastPresence('ping');
    return { success: true, username: lanUsername };
  }
  return { success: false, error: 'Invalid username' };
});

ipcMain.handle('lan-get-peers', () => {
  return Array.from(lanPeers.values());
});

ipcMain.handle('lan-get-history', () => {
  return lanChatHistory;
});

ipcMain.handle('lan-send-message', async (event, msg) => {
  try {
    await broadcastChatMessage({ message: msg });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('lan-share-file', async () => {
  if (!mainWindow) return { success: false, error: 'No main window' };

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select File to Share on LAN',
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  const filePath = result.filePaths[0];
  const name = path.basename(filePath);
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch (e) {}

  const fileId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  lanSharedFiles.set(fileId, { path: filePath, name, size });

  const localIp = getLocalIPAddress();
  const fileUrl = `http://${localIp}:${lanHttpPort}/api/download/${fileId}`;

  const filePayload = {
    message: `Shared file: ${name}`,
    file: {
      id: fileId,
      name,
      size,
      url: fileUrl
    }
  };

  try {
    await broadcastChatMessage(filePayload);
    return { success: true, name };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('lan-add-peer-manual', (event, ip) => {
  if (!ip || !ip.trim()) return { success: false, error: 'Invalid IP' };
  
  const peerIp = ip.trim();
  sendDirectPong(peerIp);
  
  const peerKey = peerIp;
  lanPeers.set(peerKey, {
    username: 'Discovered (IP)',
    httpPort: 55055,
    ip: peerIp,
    lastSeen: Date.now()
  });
  notifyPeersChanged();
  
  return { success: true };
});

app.on('will-quit', () => {
  if (lanUdpSocket) {
    try { lanUdpSocket.close(); } catch(e){}
  }
  if (lanHttpServer) {
    try { lanHttpServer.close(); } catch(e){}
  }
});

// Start services
app.whenReady().then(() => {
  loadLanChatHistory();
  startHttpServer();
});


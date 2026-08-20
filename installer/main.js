const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

// Treat .asar files as plain files so the payload copy doesn't try to descend
// into app.asar as if it were a directory (Electron's fs is asar-aware by default).
process.noAsar = true;

// Safety net: never let a stray async error pop the native crash dialog.
process.on('uncaughtException', (e) => console.error('uncaught:', e));

// ── App identity (must match the packaged QuantumX app) ─────────────────────
const APP_NAME   = 'QuantumX';
const APP_EXE    = 'AppRuntime.exe';
const APP_ID     = 'com.quantumx.app';
const PUBLISHER  = 'Runtime Services';
const VERSION    = app.getVersion();

let win;

// ── Paths ───────────────────────────────────────────────────────────────────
function payloadDir() {
  // Packaged: extraResources copies dist/win-unpacked → resources/app-payload
  const packaged = path.join(process.resourcesPath, 'app-payload');
  if (fs.existsSync(packaged)) return packaged;
  // Dev fallback
  return path.join(__dirname, '..', 'dist', 'win-unpacked');
}

function defaultInstallDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'Programs', APP_NAME);
}

// ── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 680,
    frame: false,
    backgroundColor: '#0B0C11',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ── Window controls ─────────────────────────────────────────────────────────
ipcMain.on('win-minimize', () => win && win.minimize());
ipcMain.on('win-close', () => { app.quit(); });

// ── Info for the renderer ───────────────────────────────────────────────────
ipcMain.handle('get-info', () => ({
  version: VERSION,
  defaultPath: defaultInstallDir(),
  payloadReady: fs.existsSync(payloadDir())
}));

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose install location',
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths[0]) return null;
  // Ensure the folder ends with the app name, matching typical installer behaviour
  let p = r.filePaths[0];
  if (path.basename(p).toLowerCase() !== APP_NAME.toLowerCase()) {
    p = path.join(p, APP_NAME);
  }
  return p;
});

// ── Filesystem helpers ──────────────────────────────────────────────────────
function walk(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push({ full, rel: path.relative(base, full), size: st.size });
  }
  return out;
}

function runPS(script, env = {}) {
  return spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-ExecutionPolicy', 'Bypass', '-Command', script
  ], { env: { ...process.env, ...env }, encoding: 'utf8' });
}

function reg(...args) {
  return spawnSync('reg', args, { encoding: 'utf8' });
}

// ── Post-copy: shortcuts, registry, uninstaller ─────────────────────────────
function createShortcuts(installDir, desktop) {
  const target = path.join(installDir, APP_EXE);
  runPS(`
    $exe = $env:QX_TARGET
    $sh  = New-Object -ComObject WScript.Shell
    $sm  = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\\QuantumX'
    if (!(Test-Path $sm)) { New-Item $sm -ItemType Directory -Force | Out-Null }
    $s = $sh.CreateShortcut((Join-Path $sm 'QuantumX.lnk'))
    $s.TargetPath = $exe; $s.WorkingDirectory = (Split-Path $exe); $s.Description = 'QuantumX'; $s.Save()
    if ($env:QX_DESKTOP -eq '1') {
      $d = $sh.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'QuantumX.lnk'))
      $d.TargetPath = $exe; $d.WorkingDirectory = (Split-Path $exe); $d.Description = 'QuantumX'; $d.Save()
    }
  `, { QX_TARGET: target, QX_DESKTOP: desktop ? '1' : '0' });
}

function writeUninstaller(installDir, sizeKb) {
  const ps1 = path.join(installDir, 'uninstall.ps1');
  const script = `# QuantumX uninstaller
$ErrorActionPreference = 'SilentlyContinue'
$dir = '${installDir.replace(/\\/g, '\\\\')}'
Get-Process -Name 'AppRuntime' | Stop-Process -Force
Start-Sleep -Milliseconds 600
# Shortcuts
Remove-Item (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\\QuantumX') -Recurse -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'QuantumX.lnk') -Force
# Registry
Remove-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}' -Recurse -Force
Remove-Item 'HKCU:\\Software\\Classes\\quantumx' -Recurse -Force
Remove-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'QuantumX' -Force
# Files (schedule self-deleting removal of the folder)
$stamp = Join-Path $env:TEMP 'qx-uninstall.cmd'
"@echo off
timeout /t 1 /nobreak >nul
rmdir /s /q ""$dir""" | Out-File -Encoding ascii $stamp
Start-Process cmd.exe -ArgumentList '/c', $stamp -WindowStyle Hidden
`;
  fs.writeFileSync(ps1, script, 'utf8');

  const target = path.join(installDir, APP_EXE);
  const uninstCmd = `powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ps1}"`;
  const key = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}`;
  reg('add', key, '/v', 'DisplayName',     '/t', 'REG_SZ', '/d', APP_NAME, '/f');
  reg('add', key, '/v', 'DisplayVersion',  '/t', 'REG_SZ', '/d', VERSION, '/f');
  reg('add', key, '/v', 'Publisher',       '/t', 'REG_SZ', '/d', PUBLISHER, '/f');
  reg('add', key, '/v', 'DisplayIcon',     '/t', 'REG_SZ', '/d', target, '/f');
  reg('add', key, '/v', 'InstallLocation', '/t', 'REG_SZ', '/d', installDir, '/f');
  reg('add', key, '/v', 'UninstallString', '/t', 'REG_SZ', '/d', uninstCmd, '/f');
  reg('add', key, '/v', 'EstimatedSize',   '/t', 'REG_DWORD', '/d', String(sizeKb), '/f');
  reg('add', key, '/v', 'NoModify',        '/t', 'REG_DWORD', '/d', '1', '/f');
  reg('add', key, '/v', 'NoRepair',        '/t', 'REG_DWORD', '/d', '1', '/f');

  // quantumx:// protocol
  const proto = 'HKCU\\Software\\Classes\\quantumx';
  reg('add', proto, '/ve', '/t', 'REG_SZ', '/d', 'URL:QuantumX', '/f');
  reg('add', proto, '/v', 'URL Protocol', '/t', 'REG_SZ', '/d', '', '/f');
  reg('add', `${proto}\\shell\\open\\command`, '/ve', '/t', 'REG_SZ', '/d', `"${target}" "%1"`, '/f');
}

// Launch the installed app, requesting UAC elevation explicitly.
// AppRuntime.exe is built with requestedExecutionLevel: requireAdministrator, so:
//   - child_process.spawn() cannot elevate — Windows returns ERROR_ELEVATION_REQUIRED,
//     which Node surfaces as EACCES (this is what crashed the app earlier).
//   - shell.openPath() usually elevates fine, but it does NOT throw on failure — it
//     resolves with an error string that's easy to silently ignore, so a failure
//     looks like "the Finish button does nothing".
// Start-Process -Verb RunAs is the standard, reliable way to request elevation
// for a child process from a non-elevated one.
function launchApp(installDir) {
  const exe = path.join(installDir, APP_EXE);
  if (!fs.existsSync(exe)) return false;
  const esc = (s) => s.replace(/'/g, "''");
  // Spawn asynchronously (not spawnSync) so this returns instantly. Start-Process
  // hands the elevation request off to Windows and returns immediately — it does
  // NOT wait for AppRuntime.exe to finish loading — so there's nothing to block on.
  const { spawn } = require('child_process');
  const ps = spawn('powershell', [
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
    '-Command',
    `Start-Process -FilePath '${esc(exe)}' -WorkingDirectory '${esc(installDir)}' -Verb RunAs`
  ], { stdio: 'ignore', detached: true });
  ps.unref();
  return true;
}

function setStartup(installDir, enable) {
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  if (enable) reg('add', key, '/v', 'QuantumX', '/t', 'REG_SZ', '/d', `"${path.join(installDir, APP_EXE)}"`, '/f');
  else reg('delete', key, '/v', 'QuantumX', '/f');
}

// ── Install ─────────────────────────────────────────────────────────────────
ipcMain.handle('install', async (_e, opts) => {
  const installDir = opts.path || defaultInstallDir();
  const src = payloadDir();
  try {
    if (!fs.existsSync(src)) throw new Error('Installation payload not found. Build the app (dist/win-unpacked) first.');

    fs.mkdirSync(installDir, { recursive: true });
    const files = walk(src);
    const totalBytes = files.reduce((a, f) => a + f.size, 0) || 1;

    let done = 0;
    let lastEmit = 0;
    let lastBytes = 0;
    let lastTime = Date.now();
    let speedTxt = '';

    const emit = (rel, force) => {
      const now = Date.now();
      if (!force && now - lastEmit < 70) return;
      lastEmit = now;
      const dt = (now - lastTime) / 1000;
      if (dt >= 0.4) {
        const bps = (done - lastBytes) / dt;
        speedTxt = bps > 0 ? (bps / (1024 * 1024)).toFixed(1) + ' MB/s' : '';
        lastBytes = done; lastTime = now;
      }
      if (win && !win.isDestroyed()) {
        win.webContents.send('install-progress', {
          pct: Math.min(99, (done / totalBytes) * 100),
          file: rel.replace(/\\/g, '/'),
          speed: speedTxt
        });
      }
    };

    for (const f of files) {
      const dst = path.join(installDir, f.rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      await fs.promises.copyFile(f.full, dst);
      done += f.size;
      emit(f.rel);
    }

    if (win && !win.isDestroyed()) {
      win.webContents.send('install-progress', { pct: 100, file: 'Finalizing…', speed: '' });
    }

    createShortcuts(installDir, !!opts.shortcut);
    setStartup(installDir, !!opts.launch);
    writeUninstaller(installDir, Math.round(totalBytes / 1024));

    return { success: true, installDir };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Finish ──────────────────────────────────────────────────────────────────
ipcMain.handle('finish', async (_e, opts) => {
  try {
    if (opts && opts.launch && opts.installDir) {
      launchApp(opts.installDir);
      // Small buffer so the async spawn() above is fully handed off to the OS
      // before this process exits. spawn() (unlike the old spawnSync) returns
      // near-instantly, so this only needs to be short.
      await new Promise((r) => setTimeout(r, 180));
    }
  } catch (e) {
    console.error('launch failed:', e);
  }
  app.quit();
});

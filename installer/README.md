# QuantumX Setup — custom Electron installer

A pixel-perfect implementation of the "QuantumX Setup" design as a real, frameless
Electron installer that performs an actual install (copies the app, creates
shortcuts + registry entries, and writes an uninstaller). It replaces the native
NSIS installer UI, whose native Win32 chrome could not match the design.

## What it looks like

The exact mockup — dark `#07080C` window, gold `#D4B36A` accent, serif wordmark,
ambient particles, and a five-step flow: **Welcome → License → Destination &
Options → animated Progress → Success** (with confetti). The markup and styles are
the design's own (`index.html`), driven by `renderer.js`; Chromium 132 in Electron
34 renders the `color-mix()` / `oklab()` styles natively.

## What it actually does (`main.js`)

- **Copies** the packaged app payload into the chosen folder with live per-file
  progress + speed (real bytes, not a fake bar).
- **Shortcuts** — Start Menu (always) and Desktop (if the toggle is on) → `AppRuntime.exe`.
- **Registry** — an Add/Remove Programs uninstall entry under
  `HKCU\…\Uninstall\com.quantumx.app` (name, version, publisher, icon, size),
  the `quantumx://` URL protocol, and an optional startup `Run` entry.
- **Uninstaller** — writes `uninstall.ps1` into the install folder and points the
  `UninstallString` at it, so "Apps & features" removes files, shortcuts, and keys.
- **Finish** — optionally launches QuantumX.

Default install location: `%LOCALAPPDATA%\Programs\QuantumX`. It installs per-user
(`asInvoker`, no UAC prompt), so no admin rights are needed.

## Build

The installer bundles the app's `dist/win-unpacked` payload via `extraResources`,
so build the app first.

From the **repo root**:

```bash
npm run build:installer
```

That runs `electron-builder --win --dir` (produces `dist/win-unpacked`), then
`npm install` + `electron-builder --win` inside `installer/`.

Output: `installer/dist/QuantumX-Setup-2.0.0.exe` — a single portable executable.

### Manual / step-by-step

```bash
# 1) from repo root — build the app payload
npm run pack:app                 # -> dist/win-unpacked/AppRuntime.exe

# 2) build the installer
cd installer
npm install
npm run build                    # -> installer/dist/QuantumX-Setup-<version>.exe
```

### Preview the UI without building

```bash
cd installer
npm install
npm start                        # opens the installer window; install runs for real in dev
```

Opening `index.html` in a browser also works — with no Electron bridge present it
falls back to a **simulated** install so you can click through the whole flow.

## Notes

- Keep the installer `version` in `installer/package.json` in sync with the app's
  `version`; it drives the Add/Remove Programs entry and the output filename.
- Fonts fall back to `Georgia` (serif) / system sans. To match the mockup's
  Cormorant Garamond + Albert Sans exactly, drop their `.woff2` files in and add
  `@font-face` rules in `index.html`.

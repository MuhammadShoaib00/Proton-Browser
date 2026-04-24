/**
 * Generates BMP installer images for the NSIS installer.
 * Run automatically before build via the "prebuild:win" npm script.
 *
 * Outputs:
 *   assets/installer-sidebar.bmp  164×314 px  (Welcome / Finish pages)
 *   assets/installer-header.bmp   150×57 px   (all inner pages)
 */

const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');

// ── BMP writer ─────────────────────────────────────────────────────────────
// Converts sharp raw() RGB(A) buffer → 24-bit Windows BMP (bottom-up, BGR)
function rawToBMP(rawBuf, width, height, channels) {
  const rowSize      = Math.ceil(width * 3 / 4) * 4; // rows padded to 4 bytes
  const pixelDataSz  = rowSize * height;
  const buf          = Buffer.alloc(54 + pixelDataSz, 0);

  // File header
  buf[0] = 0x42; buf[1] = 0x4D;
  buf.writeUInt32LE(54 + pixelDataSz, 2);
  buf.writeUInt32LE(54, 10);

  // DIB header (BITMAPINFOHEADER)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width,  18);
  buf.writeInt32LE(height, 22);   // positive → bottom-up storage
  buf.writeUInt16LE(1,  26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelDataSz, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);

  // Pixels — bottom-to-top rows, BGR byte order
  for (let y = 0; y < height; y++) {
    const rowOff = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels;
      const dst = rowOff + x * 3;
      buf[dst]     = rawBuf[src + 2]; // B
      buf[dst + 1] = rawBuf[src + 1]; // G
      buf[dst + 2] = rawBuf[src + 0]; // R
    }
  }
  return buf;
}

async function svgToBMP(svgStr, w, h, bgColor) {
  const { data, info } = await sharp(Buffer.from(svgStr))
    .resize(w, h)
    .flatten({ background: bgColor })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return rawToBMP(data, w, h, info.channels);
}

// ── Sidebar 164×314 (Welcome + Finish pages) ──────────────────────────────
async function buildSidebar() {
  const W = 164, H = 314;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#04090f"/>
      <stop offset="100%" stop-color="#0b1e3d"/>
    </linearGradient>
    <radialGradient id="topGlow" cx="55%" cy="0%" r="60%">
      <stop offset="0%"   stop-color="#1d4ed8" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#04090f" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#3b82f6" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="accentBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#93c5fd"/>
      <stop offset="60%"  stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
    <linearGradient id="divider" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#3b82f6" stop-opacity="0"/>
      <stop offset="30%"  stop-color="#3b82f6" stop-opacity="0.7"/>
      <stop offset="70%"  stop-color="#3b82f6" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#topGlow)"/>

  <!-- Left accent bar -->
  <rect x="0" y="0" width="3" height="${H}" fill="url(#accentBar)"/>

  <!-- Orbital rings -->
  <ellipse cx="92" cy="112" rx="54" ry="21" fill="none" stroke="#3b82f6"  stroke-width="1.4" opacity="0.5"/>
  <ellipse cx="92" cy="112" rx="54" ry="21" fill="none" stroke="#60a5fa"  stroke-width="1"   opacity="0.32" transform="rotate(60 92 112)"/>
  <ellipse cx="92" cy="112" rx="54" ry="21" fill="none" stroke="#93c5fd"  stroke-width="0.8" opacity="0.2"  transform="rotate(120 92 112)"/>

  <!-- Core glow halo -->
  <circle cx="92" cy="112" r="40" fill="url(#coreGlow)"/>

  <!-- Core circles -->
  <circle cx="92" cy="112" r="32" fill="#07152b" stroke="#2563eb" stroke-width="2.2"/>
  <circle cx="92" cy="112" r="23" fill="#0e2a56"/>
  <circle cx="92" cy="112" r="14" fill="#173d78" opacity="0.85"/>

  <!-- Inner shine -->
  <circle cx="83" cy="103" r="4" fill="white" opacity="0.12"/>

  <!-- Letter P (centred in core) -->
  <text x="84"
        y="121"
        font-family="Georgia,'Times New Roman',serif"
        font-size="26"
        font-weight="bold"
        fill="#f0f8ff"
        opacity="0.97">P</text>

  <!-- Orbital particles -->
  <circle cx="146" cy="112" r="5"   fill="#60a5fa" opacity="0.85"/>
  <circle cx="40"  cy="112" r="3.5" fill="#93c5fd" opacity="0.65"/>
  <circle cx="92"  cy="81"  r="4"   fill="#60a5fa" opacity="0.7"/>
  <circle cx="92"  cy="143" r="3"   fill="#93c5fd" opacity="0.55"/>

  <!-- App name -->
  <text x="92" y="177"
        font-family="Arial,Helvetica,sans-serif"
        font-size="16"
        font-weight="bold"
        fill="#dbeafe"
        text-anchor="middle"
        letter-spacing="2">PROTON</text>

  <text x="92" y="195"
        font-family="Arial,Helvetica,sans-serif"
        font-size="10.5"
        fill="#60a5fa"
        text-anchor="middle"
        letter-spacing="4">BROWSER</text>

  <!-- Divider -->
  <rect x="30" y="205" width="124" height="1" fill="url(#divider)"/>

  <!-- Tagline -->
  <text x="92" y="221"
        font-family="Arial,Helvetica,sans-serif"
        font-size="8"
        fill="#6da4d4"
        text-anchor="middle">Secure  ·  Fast  ·  Private</text>

  <!-- Bottom feature dots -->
  <circle cx="67"  cy="275" r="2"   fill="#1d4ed8" opacity="0.55"/>
  <circle cx="78"  cy="275" r="2.5" fill="#3b82f6" opacity="0.7"/>
  <circle cx="92"  cy="275" r="3.5" fill="#60a5fa" opacity="0.85"/>
  <circle cx="106" cy="275" r="2.5" fill="#3b82f6" opacity="0.7"/>
  <circle cx="117" cy="275" r="2"   fill="#1d4ed8" opacity="0.55"/>

  <!-- Version -->
  <text x="92" y="299"
        font-family="Arial,Helvetica,sans-serif"
        font-size="7.5"
        fill="#2a4a6e"
        text-anchor="middle">v2.0.0</text>
</svg>`;

  return svgToBMP(svg, W, H, '#04090f');
}

// ── Header 150×57 (Directory / Progress / Components pages) ───────────────
async function buildHeader() {
  const W = 150, H = 57;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#04090f"/>
      <stop offset="100%" stop-color="#0b1e3d"/>
    </linearGradient>
    <linearGradient id="bottomLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#1d4ed8"/>
      <stop offset="50%"  stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
    <radialGradient id="rGlow" cx="80%" cy="50%" r="40%">
      <stop offset="0%"   stop-color="#1d4ed8" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#04090f" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#rGlow)"/>

  <!-- Bottom accent line -->
  <rect x="0" y="${H - 3}" width="${W}" height="3" fill="url(#bottomLine)"/>

  <!-- Logo circle (right side) -->
  <circle cx="124" cy="27" r="18"   fill="#07152b" stroke="#2563eb" stroke-width="1.8"/>
  <circle cx="124" cy="27" r="12"   fill="#0e2a56"/>
  <ellipse cx="124" cy="27" rx="18" ry="7" fill="none" stroke="#3b82f6" stroke-width="0.9" opacity="0.45"/>
  <circle  cx="142" cy="27" r="3.5" fill="#60a5fa" opacity="0.8"/>
  <circle  cx="106" cy="27" r="2.5" fill="#93c5fd" opacity="0.6"/>

  <!-- P letter -->
  <text x="118" y="33"
        font-family="Georgia,'Times New Roman',serif"
        font-size="17"
        font-weight="bold"
        fill="#f0f8ff"
        opacity="0.95">P</text>
</svg>`;

  return svgToBMP(svg, W, H, '#04090f');
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const assetsDir = path.join(__dirname, 'assets');

  process.stdout.write('Generating installer-sidebar.bmp … ');
  fs.writeFileSync(path.join(assetsDir, 'installer-sidebar.bmp'), await buildSidebar());
  console.log('done');

  process.stdout.write('Generating installer-header.bmp  … ');
  fs.writeFileSync(path.join(assetsDir, 'installer-header.bmp'), await buildHeader());
  console.log('done');
}

main().catch(e => { console.error(e); process.exit(1); });

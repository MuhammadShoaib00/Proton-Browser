/**
 * Generates BMP installer images for the NSIS installer.
 * Run automatically before build via the "build" / "build:win" npm scripts.
 *
 * Visual language mirrors the "QuantumX Setup" design:
 *   near-black background (#07080C / #0B0C11), gold accent (#D4B36A),
 *   a nested-diamond glyph with a glowing core, and a serif wordmark.
 *
 * Outputs:
 *   assets/installer-sidebar.bmp  164×314 px  (Welcome / Finish pages)
 *   assets/installer-header.bmp   150×57 px   (all inner pages)
 */

const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');

const VERSION = (() => {
  try { return require('./package.json').version || ''; } catch (_) { return ''; }
})();

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

// Shared defs (gradients + soft-glow filter) used by both bitmaps.
// Uses only plain hex/rgba — librsvg (via sharp) does not support color-mix/oklab.
const DEFS = `
  <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%"   stop-color="#FFF2D0"/>
    <stop offset="45%"  stop-color="#D4B36A"/>
    <stop offset="100%" stop-color="#7A5F2E"/>
  </linearGradient>
  <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
    <stop offset="0%"   stop-color="#FFF6DD"/>
    <stop offset="40%"  stop-color="#D4B36A" stop-opacity="0.8"/>
    <stop offset="100%" stop-color="#8A733F" stop-opacity="0"/>
  </radialGradient>
  <filter id="soft" x="-80%" y="-80%" width="260%" height="260%" color-interpolation-filters="sRGB">
    <feGaussianBlur stdDeviation="5"/>
  </filter>`;

// ── Sidebar 164×314 (Welcome + Finish pages) ──────────────────────────────
async function buildSidebar() {
  const W = 164, H = 314;
  const cx = 82, cy = 106; // glyph centre
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${DEFS}
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#0B0C11"/>
      <stop offset="100%" stop-color="#07080C"/>
    </linearGradient>
    <radialGradient id="topGlow" cx="50%" cy="0%" r="72%">
      <stop offset="0%"   stop-color="#D4B36A" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#07080C" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="accentBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#FFF2D0"/>
      <stop offset="55%"  stop-color="#D4B36A"/>
      <stop offset="100%" stop-color="#7A5F2E"/>
    </linearGradient>
    <linearGradient id="divider" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#D4B36A" stop-opacity="0"/>
      <stop offset="50%"  stop-color="#D4B36A" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="#D4B36A" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#topGlow)"/>

  <!-- Left accent bar -->
  <rect x="0" y="0" width="3" height="${H}" fill="url(#accentBar)"/>

  <!-- Faint particle field -->
  <g fill="#D4B36A" opacity="0.55">
    <circle cx="34"  cy="52"  r="1.2"/>
    <circle cx="132" cy="46"  r="1.0"/>
    <circle cx="140" cy="150" r="1.3"/>
    <circle cx="28"  cy="150" r="1.1"/>
  </g>

  <!-- Nested-diamond glyph -->
  <g transform="rotate(45 ${cx} ${cy})" fill="none">
    <rect x="${cx-37}" y="${cy-37}" width="74" height="74" rx="10" stroke="#D4B36A" stroke-width="8" opacity="0.16" filter="url(#soft)"/>
    <rect x="${cx-37}" y="${cy-37}" width="74" height="74" rx="10" stroke="url(#edge)" stroke-width="3.2"/>
    <rect x="${cx-25}" y="${cy-25}" width="50" height="50" rx="8"  stroke="#D4B36A" stroke-width="2.2" opacity="0.6"/>
    <rect x="${cx-14}" y="${cy-14}" width="28" height="28" rx="6"  stroke="#D4B36A" stroke-width="1.6" opacity="0.4"/>
  </g>

  <!-- Core -->
  <circle cx="${cx}" cy="${cy}" r="26" fill="url(#coreGlow)" filter="url(#soft)"/>
  <circle cx="${cx}" cy="${cy}" r="7.5" fill="#FFF6DD"/>
  <circle cx="${cx}" cy="${cy}" r="4.5" fill="#FFFFFF"/>

  <!-- Wordmark -->
  <text x="${cx}" y="182"
        font-family="Georgia,'Times New Roman',serif"
        font-size="27"
        fill="#F4EFE4"
        text-anchor="middle">QuantumX</text>

  <text x="${cx}" y="201"
        font-family="Arial,Helvetica,sans-serif"
        font-size="9.5"
        font-weight="600"
        fill="#D4B36A"
        text-anchor="middle"
        letter-spacing="6">SETUP</text>

  <!-- Divider -->
  <rect x="30" y="211" width="104" height="1" fill="url(#divider)"/>

  <!-- Tagline -->
  <text x="${cx}" y="227"
        font-family="Arial,Helvetica,sans-serif"
        font-size="8"
        fill="#9C8A63"
        text-anchor="middle"
        letter-spacing="1">Secure  ·  Private  ·  Fast</text>

  <!-- Bottom accent dots -->
  <circle cx="62"  cy="276" r="1.8" fill="#7A5F2E"/>
  <circle cx="74"  cy="276" r="2.4" fill="#D4B36A"/>
  <circle cx="82"  cy="276" r="3.2" fill="#FFF2D0"/>
  <circle cx="90"  cy="276" r="2.4" fill="#D4B36A"/>
  <circle cx="102" cy="276" r="1.8" fill="#7A5F2E"/>

  ${VERSION ? `<text x="${cx}" y="300"
        font-family="Arial,Helvetica,sans-serif"
        font-size="7.5"
        fill="#5A4E33"
        text-anchor="middle">v${VERSION}</text>` : ''}
</svg>`;

  return svgToBMP(svg, W, H, '#07080C');
}

// ── Header 150×57 (Directory / Progress / Components pages) ───────────────
async function buildHeader() {
  const W = 150, H = 57;
  const cx = 126, cy = 26;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${DEFS}
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#0B0C11"/>
      <stop offset="100%" stop-color="#07080C"/>
    </linearGradient>
    <radialGradient id="rGlow" cx="82%" cy="45%" r="45%">
      <stop offset="0%"   stop-color="#D4B36A" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#07080C" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bottomLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#7A5F2E"/>
      <stop offset="50%"  stop-color="#D4B36A"/>
      <stop offset="100%" stop-color="#7A5F2E"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#rGlow)"/>

  <!-- Bottom accent line -->
  <rect x="0" y="${H - 2.5}" width="${W}" height="2.5" fill="url(#bottomLine)"/>

  <!-- Diamond glyph (right side) -->
  <g transform="rotate(45 ${cx} ${cy})" fill="none">
    <rect x="${cx-15}" y="${cy-15}" width="30" height="30" rx="5" stroke="url(#edge)" stroke-width="2.4"/>
    <rect x="${cx-9}"  y="${cy-9}"  width="18" height="18" rx="4" stroke="#D4B36A" stroke-width="1.6" opacity="0.55"/>
  </g>
  <circle cx="${cx}" cy="${cy}" r="12" fill="url(#coreGlow)" filter="url(#soft)"/>
  <circle cx="${cx}" cy="${cy}" r="4" fill="#FFF6DD"/>

  <!-- Wordmark -->
  <text x="14" y="27"
        font-family="Georgia,'Times New Roman',serif"
        font-size="17"
        fill="#F4EFE4">QuantumX</text>
  <text x="15" y="40"
        font-family="Arial,Helvetica,sans-serif"
        font-size="7"
        font-weight="600"
        fill="#D4B36A"
        letter-spacing="4">SETUP</text>
</svg>`;

  return svgToBMP(svg, W, H, '#07080C');
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

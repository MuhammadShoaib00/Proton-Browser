# QuantumX YouTube Ad Blocker (Chrome Extension)

A standalone Chrome extension port of the YouTube ad-blocking feature from the
QuantumX browser. It blocks in-video ads, feed/sidebar/search ads, and dismisses
YouTube's "ad blocker detected" popup.

## How it works

| File | World / Timing | Job |
|------|----------------|-----|
| `ima-stub.js` | MAIN world, `document_start` | Replaces Google's IMA ads SDK with a stub that instantly reports "all ads completed" — so the player never loads a video ad. Must run **before** YouTube's scripts. |
| `adblock.js`  | MAIN world, `document_start` | Hides ad DOM via CSS, clicks skip buttons, fast-forwards any ad that slips through, and dismisses the anti-adblock popup. |

## Install (unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser: Edge, Brave…).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `chrome-extension` folder.
4. Open YouTube — ads should be gone. Reload any already-open YouTube tabs.

## Notes

- Requires Chrome 111+ (uses `"world": "MAIN"` content scripts).
- No permissions beyond running scripts on `youtube.com` — no network, storage, or
  background access.
- YouTube changes its ad markup often; if ads reappear, the CSS selectors and
  skip-button selectors in `adblock.js` are what need updating.
- The browser's other features (Electron fingerprint spoofing, native screenshot
  protection) are **not** portable to a Chrome extension and are intentionally
  omitted — the first is pointless in real Chrome, the second needs native OS access.

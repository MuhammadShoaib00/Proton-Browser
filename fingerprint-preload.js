// QuantumX — Chrome fingerprint preload
// Runs in the webview's page context BEFORE any page scripts execute.
// Removes the "Electron" brand from navigator.userAgentData so that
// Google, Facebook, LinkedIn and ChatGPT accept the browser as real Chrome.
(function () {
    'use strict';

    // ── User-Agent Client Hints (the main reason Google blocks Electron) ──────
    // Electron 34 adds { brand: "Electron", version: "34" } to the brands list.
    // Google reads navigator.userAgentData.brands on page load and rejects
    // any brand that isn't Chrome/Chromium/Edge/etc.
    var brands = [
        { brand: 'Not A Brand',   version: '99'  },
        { brand: 'Google Chrome', version: '132' },
        { brand: 'Chromium',      version: '132' }
    ];
    var fullBrands = [
        { brand: 'Not A Brand',   version: '99.0.0.0'         },
        { brand: 'Google Chrome', version: '132.0.6834.110'   },
        { brand: 'Chromium',      version: '132.0.6834.110'   }
    ];
    try {
        Object.defineProperty(navigator, 'userAgentData', {
            value: {
                brands:   brands,
                mobile:   false,
                platform: 'Windows',
                getHighEntropyValues: function () {
                    return Promise.resolve({
                        architecture:    'x86',
                        bitness:         '64',
                        brands:          brands,
                        fullVersionList: fullBrands,
                        mobile:          false,
                        model:           '',
                        platform:        'Windows',
                        platformVersion: '15.0.0',
                        uaFullVersion:   '132.0.6834.110',
                        wow64:           false
                    });
                },
                toJSON: function () {
                    return { brands: brands, mobile: false, platform: 'Windows' };
                }
            },
            configurable: true,
            writable:     false,
            enumerable:   true
        });
    } catch (e) {}

    // ── navigator.vendor — Chrome always reports "Google Inc." ────────────────
    try {
        Object.defineProperty(navigator, 'vendor', {
            get:          function () { return 'Google Inc.'; },
            configurable: true
        });
    } catch (e) {}

    // ── Hide Electron / Node.js fingerprints ──────────────────────────────────
    try { delete window.electron; } catch (e) {}
    try {
        Object.defineProperty(window, 'electron', {
            get:          function () { return undefined; },
            configurable: false,
            enumerable:   false
        });
    } catch (e) {}

    // process.versions.electron is readable from page context when contextIsolation
    // is off — mask it so fingerprint scanners can't detect Electron
    try {
        if (typeof process !== 'undefined' && process.versions) {
            Object.defineProperty(process.versions, 'electron', {
                get:          function () { return undefined; },
                configurable: true
            });
            Object.defineProperty(process.versions, 'node', {
                get:          function () { return undefined; },
                configurable: true
            });
        }
    } catch (e) {}

    // ── window.chrome — required by Google Sign-In and many OAuth flows ───────
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
        window.chrome.runtime = {
            id:         undefined,
            connect:    function () { return { onMessage: { addListener: function () {} }, postMessage: function () {}, disconnect: function () {} }; },
            sendMessage: function () {},
            onMessage:  { addListener: function () {}, removeListener: function () {}, hasListener: function () { return false; } },
            onConnect:  { addListener: function () {}, removeListener: function () {} }
        };
    }
    if (!window.chrome.loadTimes) {
        window.chrome.loadTimes = function () {
            return {
                requestTime: Date.now() / 1000, startLoadTime: Date.now() / 1000,
                commitLoadTime: Date.now() / 1000, finishDocumentLoadTime: 0,
                finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0,
                navigationType: 'Other', wasFetchedViaSpdy: false,
                wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2',
                wasAlternateProtocolAvailable: false, connectionInfo: 'h2'
            };
        };
    }
    if (!window.chrome.csi) {
        window.chrome.csi = function () {
            return { startE: Date.now(), onloadT: Date.now(), pageT: performance.now(), tran: 15 };
        };
    }
    if (!window.chrome.app) {
        window.chrome.app = {
            isInstalled:    false,
            getDetails:     function () { return null; },
            getIsInstalled: function () { return false; },
            runningState:   function () { return 'cannot_run'; },
            InstallState:   { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            RunningState:   { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
        };
    }
})();

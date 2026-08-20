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

    // ── YouTube IMA stub — must run before YouTube scripts initialize ─────────
    // Placed here (preload = runs before ALL page scripts) so google.ima is
    // already defined when YouTube's player code checks for the IMA SDK.
    if (/youtube\.com/.test(location.hostname)) {

        // (A player-response ad-stripper was tried here, but rewriting the
        // /youtubei/v1/player JSON broke video playback ("An error occurred").
        // Video ads are handled instead by the IMA stub (Layer 2 below) plus the
        // cosmetic auto-skip / fast-forward — neither touches the streaming
        // response, so playback is never at risk.

        // ── Layer 2: cosmetic hiding + skip / fast-forward + anti-adblock popup ──
        // Runs at document-start (observers + intervals), so it no longer depends
        // on the renderer's dom-ready injection. (Ported from resources/yt-adblock.js.)
        (function () {
            if (window.__qxYtCosmetic) return;
            window.__qxYtCosmetic = true;

            // Diagnostic kill switch: run this in the YouTube DevTools console and
            // reload to disable all YouTube ad-blocking for that profile:
            //   localStorage.setItem('qx_yt_block','off')
            // Re-enable with: localStorage.removeItem('qx_yt_block')
            try { if (localStorage.getItem('qx_yt_block') === 'off') return; } catch (e) {}

            function injectCSS() {
                if (document.getElementById('__qx_ab_css__')) return;
                var s = document.createElement('style');
                s.id = '__qx_ab_css__';
                s.textContent = [
                    '.ad-showing .ytp-ad-player-overlay{display:none!important}',
                    '.ad-interrupting .ytp-ad-player-overlay{display:none!important}',
                    '.ad-showing .ytp-ad-module{display:none!important}',
                    '.ytp-ad-overlay-container{display:none!important}',
                    '.ytp-ad-text-overlay{display:none!important}',
                    '.ytp-ad-progress-list{display:none!important}',
                    '.ytp-ad-player-overlay{display:none!important}',
                    '.ytp-ad-overlay-slot{display:none!important}',
                    '.ytp-ad-preview-container{display:none!important}',
                    '.ytp-ad-preview-text{display:none!important}',
                    '.ytp-ad-player-overlay-instream-info{display:none!important}',
                    '.ytp-ad-player-overlay-layout{display:none!important}',
                    '.ytp-ad-image-overlay{display:none!important}',
                    '.ytp-ad-text{display:none!important}',
                    'ytd-action-companion-ad-renderer,ytd-display-ad-renderer,' +
                    'ytd-promoted-sparkles-web-renderer,ytd-promoted-video-renderer,' +
                    'ytd-search-pyv-renderer,ytd-in-feed-ad-layout-renderer,' +
                    'ytd-ad-slot-renderer,ytd-statement-banner-renderer,' +
                    'ytd-banner-promo-renderer,ytd-promoted-sparkles-text-search-renderer,' +
                    'ytd-video-masthead-ad-v3a-renderer,ytd-shopping-companion-ad-renderer,' +
                    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer),' +
                    'yt-mealbar-promo-renderer,ytd-primetime-promo-renderer,' +
                    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],' +
                    '#masthead-ad,#root-ad-impressions{display:none!important}',
                    'ytd-enforcement-message-view-model{display:none!important}',
                    'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model){display:none!important}',
                    'tp-yt-iron-overlay-backdrop.opened{display:none!important}'
                ].join('\n');
                (document.head || document.documentElement).appendChild(s);
            }
            document.readyState === 'loading'
                ? document.addEventListener('DOMContentLoaded', injectCSS)
                : injectCSS();

            function dismissAntiAdblock() {
                document.querySelectorAll('ytd-enforcement-message-view-model').forEach(function (el) {
                    try {
                        var dialog = el.closest('tp-yt-paper-dialog,ytd-popup-container');
                        if (dialog) dialog.style.display = 'none';
                        else el.remove();
                    } catch (e) {}
                });
                document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(function (el) {
                    el.style.display = 'none';
                });
                document.querySelectorAll('ytd-popup-container button, tp-yt-paper-dialog button').forEach(function (btn) {
                    var t = (btn.textContent || '').trim().toLowerCase();
                    if (t === 'got it' || t === 'dismiss' || t === 'continue' || t === 'allow ads') {
                        try { btn.click(); } catch (e) {}
                    }
                });
            }

            // IMPORTANT: YouTube reuses the SAME <video> element for ads and the
            // real video. Seeking to duration whenever 'ad-showing' appears will
            // jump the actual video to its end and produce "An error occurred".
            // So fast-forwarding requires strong evidence that an ad is really
            // playing; otherwise we only ever click a visible Skip button.
            function isRealAdPlaying(player, video) {
                var cls = player.classList;
                if (!cls.contains('ad-showing') && !cls.contains('ad-interrupting')) return false;
                // Ad chrome must exist in the DOM (still present though our CSS hides it).
                var marker = player.querySelector(
                    '.ytp-ad-player-overlay,.ytp-ad-player-overlay-layout,' +
                    '.ytp-ad-badge,.ytp-ad-simple-ad-badge,.ytp-ad-duration-remaining,' +
                    '.ytp-ad-preview-container,.ytp-ad-skip-button-slot,.ytp-ad-module'
                );
                if (!marker) return false;
                // Ads are short. Never fast-forward long media — that would be the
                // user's actual video, not an ad.
                if (!video || !isFinite(video.duration) || video.duration <= 0) return false;
                if (video.duration > 90) return false;
                return true;
            }

            function skipAd() {
                var player = document.querySelector('#movie_player,.html5-video-player');
                if (!player) return;
                var cls = player.classList;
                if (!cls.contains('ad-showing') && !cls.contains('ad-interrupting')) return;

                // 1. Always safe: click a real, visible Skip button.
                var skip = player.querySelector(
                    '.ytp-ad-skip-button,.ytp-ad-skip-button-modern,' +
                    '.ytp-skip-ad-button,button[class*="ytp-ad-skip"],' +
                    '.ytp-ad-skip-button-slot button'
                );
                if (skip && skip.offsetParent !== null) { try { skip.click(); } catch (e) {} return; }

                // 2. Only fast-forward when we're confident it's an ad stream.
                var video = player.querySelector('video');
                if (!isRealAdPlaying(player, video)) return;
                try { video.currentTime = video.duration; } catch (e) {}
            }

            function attachObserver() {
                var player = document.querySelector('#movie_player,.html5-video-player');
                if (!player) { setTimeout(attachObserver, 800); return; }
                new MutationObserver(function () { skipAd(); })
                    .observe(player, { attributes: true, attributeFilter: ['class'] });
                if (document.body) {
                    new MutationObserver(function () { injectCSS(); dismissAntiAdblock(); })
                        .observe(document.body, { childList: true, subtree: false });
                }
            }
            document.readyState === 'loading'
                ? document.addEventListener('DOMContentLoaded', attachObserver)
                : attachObserver();

            setInterval(skipAd, 300);
            setInterval(dismissAntiAdblock, 2000);
        })();

        // ── Layer 3: IMA SDK stub (existing) ──
        (function () {
            function _noop() {}
            function _FakeAM() {
                var _ev = {};
                this.addEventListener    = function (t, h) { _ev[t] = h; };
                this.removeEventListener = function (t)    { delete _ev[t]; };
                this.init = _noop;
                this.start = function () {
                    var ev = _ev;
                    setTimeout(function () {
                        ['allAdsCompleted','contentResumeRequested'].forEach(function (t) {
                            if (ev[t]) try { ev[t]({ type: t }); } catch (e) {}
                        });
                    }, 1);
                };
                this.stop = _noop; this.pause = _noop; this.resume = _noop;
                this.skip = _noop; this.destroy = _noop; this.resize = _noop;
                this.getCuePoints = function () { return []; };
                this.getRemainingTime = function () { return 0; };
                this.getAdSkippableState = function () { return false; };
                this.discardAdBreak = _noop; this.setVolume = _noop;
                this.getVolume = function () { return 1; };
                this.collapse = _noop; this.expand = _noop;
                this.isCustomPlaybackUsed = function () { return false; };
            }
            function _FakeSettings() {}
            ['setAutoPlayAdBreaks','setDisableCustomPlaybackForIOS10Plus','setLocale',
             'setNumRedirects','setPlayerType','setPlayerVersion','setVpaidAllowed',
             'setVpaidMode','setCompanionBackfill'].forEach(function (m) {
                _FakeSettings.prototype[m] = _noop;
            });
            _FakeSettings.prototype.getCompanionBackfill = function () { return {}; };
            function _FakeAL() {
                var _ev = {};
                this.addEventListener    = function (t, h) { _ev[t] = h; };
                this.removeEventListener = function (t)    { delete _ev[t]; };
                this.contentComplete = _noop; this.destroy = _noop;
                this.getSettings = function () { return new _FakeSettings(); };
                this.requestAds  = function () {
                    var ev = _ev;
                    setTimeout(function () {
                        var h = ev['adsManagerLoaded'];
                        if (h) try {
                            h({ getAdsManager: function () { return new _FakeAM(); },
                                getUserRequestContext: function () { return null; } });
                        } catch (e) {}
                    }, 1);
                };
            }
            var _ADT = {
                CONTENT_PAUSE_REQUESTED:'contentPauseRequested',
                CONTENT_RESUME_REQUESTED:'contentResumeRequested',
                ALL_ADS_COMPLETED:'allAdsCompleted', COMPLETE:'complete', LOADED:'loaded',
                STARTED:'started', SKIPPED:'skipped', PAUSED:'paused', RESUMED:'resumed',
                IMPRESSION:'impression', FIRST_QUARTILE:'firstQuartile', MIDPOINT:'midpoint',
                THIRD_QUARTILE:'thirdQuartile', AD_BREAK_READY:'adBreakReady',
                SKIPPABLE_STATE_CHANGED:'skippableStateChanged', DURATION_CHANGE:'durationChange',
                LOG:'log', USER_CLOSE:'userClose', VOLUME_CHANGED:'volumeChanged',
            };
            function _FakeImaSdkSettings() {}
            _FakeImaSdkSettings.prototype = new _FakeSettings();
            _FakeImaSdkSettings.CompanionBackfillMode = { ALWAYS:'always', ON_MASTER_AD:'on_master_ad' };
            _FakeImaSdkSettings.VpaidMode = { DISABLED:0, ENABLED:1, INSECURE:2 };
            window.google = window.google || {};
            if (!window.google.ima) {
                window.google.ima = {
                    VERSION: '3.564.0',
                    AdDisplayContainer: function () { this.initialize = _noop; this.destroy = _noop; },
                    AdsLoader: _FakeAL, AdsRequest: function () {},
                    ImaSdkSettings: _FakeImaSdkSettings, AdEvent: { Type: _ADT },
                    AdErrorEvent: { Type: { AD_ERROR:'adError' } },
                    AdError: { ErrorCode:{}, Type:{} },
                    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED:'adsManagerLoaded' } },
                    UiElements: { AD_ATTRIBUTION:'adAttribution', COUNTDOWN:'countdown' },
                    ViewMode: { FULLSCREEN:'fullscreen', NORMAL:'normal' },
                };
            }
        })();
    }
})();

// QuantumX — YouTube ad UI remover
// IMA SDK replacement is handled at network level (ima-stub.js via proton-stub:// redirect).
// This script hides ad overlay elements, clicks skip buttons, and provides
// an IMA stub backup in case the network redirect lands after this script runs.
(function () {
    'use strict';
    if (!location.hostname.includes('youtube.com')) return;
    if (window.__qxAdSkip) return;
    window.__qxAdSkip = true;

    // ── IMA stub backup ───────────────────────────────────────────────────────
    function noop() {}
    function FakeAdsManager() {
        var _ev = {};
        this.addEventListener    = function (t, h) { _ev[t] = h; };
        this.removeEventListener = function (t)    { delete _ev[t]; };
        this.init    = noop;
        this.start   = function () {
            var ev = _ev;
            setTimeout(function () {
                ['allAdsCompleted', 'contentResumeRequested'].forEach(function (t) {
                    if (ev[t]) try { ev[t]({ type: t }); } catch (e) {}
                });
            }, 0);
        };
        this.stop = noop; this.pause = noop; this.resume = noop;
        this.skip = noop; this.destroy = noop; this.resize = noop;
        this.getCuePoints = function () { return []; };
        this.getRemainingTime = function () { return 0; };
        this.getAdSkippableState = function () { return false; };
        this.discardAdBreak = noop;
        this.setVolume = noop; this.getVolume = function () { return 1; };
        this.collapse = noop; this.expand = noop;
        this.isCustomPlaybackUsed = function () { return false; };
    }
    function FakeSettings() {}
    ['setAutoPlayAdBreaks','setDisableCustomPlaybackForIOS10Plus','setLocale',
     'setNumRedirects','setPlayerType','setPlayerVersion','setVpaidAllowed',
     'setVpaidMode','setCompanionBackfill'].forEach(function (m) {
        FakeSettings.prototype[m] = noop;
    });
    FakeSettings.prototype.getCompanionBackfill = function () { return {}; };
    function FakeAdsLoader() {
        var _ev = {};
        this.addEventListener    = function (t, h) { _ev[t] = h; };
        this.removeEventListener = function (t)    { delete _ev[t]; };
        this.contentComplete = noop; this.destroy = noop;
        this.getSettings = function () { return new FakeSettings(); };
        this.requestAds  = function () {
            var ev = _ev;
            setTimeout(function () {
                var h = ev['adsManagerLoaded'];
                if (h) try {
                    h({ getAdsManager: function () { return new FakeAdsManager(); },
                        getUserRequestContext: function () { return null; } });
                } catch (e) {}
            }, 0);
        };
    }
    var ADT = {
        CONTENT_PAUSE_REQUESTED: 'contentPauseRequested',
        CONTENT_RESUME_REQUESTED: 'contentResumeRequested',
        ALL_ADS_COMPLETED: 'allAdsCompleted', COMPLETE: 'complete',
        LOADED: 'loaded', STARTED: 'started', SKIPPED: 'skipped',
        PAUSED: 'paused', RESUMED: 'resumed', IMPRESSION: 'impression',
        FIRST_QUARTILE: 'firstQuartile', MIDPOINT: 'midpoint',
        THIRD_QUARTILE: 'thirdQuartile', AD_BREAK_READY: 'adBreakReady',
        SKIPPABLE_STATE_CHANGED: 'skippableStateChanged',
        DURATION_CHANGE: 'durationChange', LOG: 'log',
        USER_CLOSE: 'userClose', VOLUME_CHANGED: 'volumeChanged',
    };
    function FakeImaSdkSettings() {}
    FakeImaSdkSettings.prototype = new FakeSettings();
    FakeImaSdkSettings.CompanionBackfillMode = { ALWAYS: 'always', ON_MASTER_AD: 'on_master_ad' };
    FakeImaSdkSettings.VpaidMode = { DISABLED: 0, ENABLED: 1, INSECURE: 2 };

    window.google = window.google || {};
    if (!window.google.ima) {
        window.google.ima = {
            VERSION: '3.564.0',
            AdDisplayContainer: function () { this.initialize = noop; this.destroy = noop; },
            AdsLoader: FakeAdsLoader, AdsRequest: function () {},
            ImaSdkSettings: FakeImaSdkSettings,
            AdEvent: { Type: ADT },
            AdErrorEvent: { Type: { AD_ERROR: 'adError' } },
            AdError: { ErrorCode: {}, Type: {} },
            AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: 'adsManagerLoaded' } },
            UiElements: { AD_ATTRIBUTION: 'adAttribution', COUNTDOWN: 'countdown' },
            ViewMode: { FULLSCREEN: 'fullscreen', NORMAL: 'normal' },
        };
    }

    // ── CSS: hide ad overlay elements ─────────────────────────────────────────
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
            'ytd-action-companion-ad-renderer,ytd-display-ad-renderer,' +
            'ytd-promoted-sparkles-web-renderer,ytd-promoted-video-renderer,' +
            'ytd-search-pyv-renderer,ytd-in-feed-ad-layout-renderer,' +
            'ytd-ad-slot-renderer,ytd-statement-banner-renderer,' +
            'ytd-banner-promo-renderer,#masthead-ad{display:none!important}',
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    }
    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', injectCSS)
        : injectCSS();

    // ── Skip / fast-forward ───────────────────────────────────────────────────
    function skipAd() {
        var player = document.querySelector('#movie_player,.html5-video-player');
        if (!player) return;
        var cls = player.classList;
        if (!cls.contains('ad-showing') && !cls.contains('ad-interrupting')) return;
        var skip = player.querySelector(
            '.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button');
        if (skip) { skip.click(); return; }
        var video = player.querySelector('video');
        if (video && isFinite(video.duration) && video.duration > 0) {
            try { video.currentTime = video.duration; } catch (e) {}
        }
    }

    // MutationObserver fires instantly when ad-showing class is added
    function attachObserver() {
        var player = document.querySelector('#movie_player,.html5-video-player');
        if (!player) { setTimeout(attachObserver, 500); return; }
        new MutationObserver(function () { skipAd(); })
            .observe(player, { attributes: true, attributeFilter: ['class'] });
    }
    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', attachObserver)
        : attachObserver();

    setInterval(skipAd, 300);
})();

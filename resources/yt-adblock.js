// QuantumX — YouTube ad blocker (injected via executeJavaScript after dom-ready)
// Handles: CSS hiding, skip-button clicking, video fast-forward, anti-adblock popup dismissal.
// The IMA stub is in fingerprint-preload.js (runs before page scripts).
(function () {
    'use strict';
    if (!location.hostname.includes('youtube.com')) return;
    if (window.__qxAdSkip) return;
    window.__qxAdSkip = true;

    // ── IMA stub backup (in case preload ran before google.ima was read) ──────
    function noop() {}
    function FakeAdsManager() {
        var _ev = {};
        this.addEventListener    = function (t, h) { _ev[t] = h; };
        this.removeEventListener = function (t)    { delete _ev[t]; };
        this.init = noop;
        this.start = function () {
            var ev = _ev;
            setTimeout(function () {
                ['allAdsCompleted','contentResumeRequested'].forEach(function (t) {
                    if (ev[t]) try { ev[t]({ type: t }); } catch (e) {}
                });
            }, 1);
        };
        this.stop = noop; this.pause = noop; this.resume = noop;
        this.skip = noop; this.destroy = noop; this.resize = noop;
        this.getCuePoints          = function () { return []; };
        this.getRemainingTime      = function () { return 0; };
        this.getAdSkippableState   = function () { return false; };
        this.discardAdBreak = noop; this.setVolume = noop;
        this.getVolume             = function () { return 1; };
        this.collapse = noop; this.expand = noop;
        this.isCustomPlaybackUsed  = function () { return false; };
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
            }, 1);
        };
    }
    var ADT = {
        CONTENT_PAUSE_REQUESTED:'contentPauseRequested', CONTENT_RESUME_REQUESTED:'contentResumeRequested',
        ALL_ADS_COMPLETED:'allAdsCompleted', COMPLETE:'complete', LOADED:'loaded', STARTED:'started',
        SKIPPED:'skipped', PAUSED:'paused', RESUMED:'resumed', IMPRESSION:'impression',
        FIRST_QUARTILE:'firstQuartile', MIDPOINT:'midpoint', THIRD_QUARTILE:'thirdQuartile',
        AD_BREAK_READY:'adBreakReady', SKIPPABLE_STATE_CHANGED:'skippableStateChanged',
        DURATION_CHANGE:'durationChange', LOG:'log', USER_CLOSE:'userClose', VOLUME_CHANGED:'volumeChanged',
    };
    function FakeImaSdkSettings() {}
    FakeImaSdkSettings.prototype = new FakeSettings();
    FakeImaSdkSettings.CompanionBackfillMode = { ALWAYS:'always', ON_MASTER_AD:'on_master_ad' };
    FakeImaSdkSettings.VpaidMode = { DISABLED:0, ENABLED:1, INSECURE:2 };
    window.google = window.google || {};
    if (!window.google.ima) {
        window.google.ima = {
            VERSION:'3.564.0',
            AdDisplayContainer: function () { this.initialize = noop; this.destroy = noop; },
            AdsLoader: FakeAdsLoader, AdsRequest: function () {},
            ImaSdkSettings: FakeImaSdkSettings, AdEvent: { Type: ADT },
            AdErrorEvent: { Type: { AD_ERROR:'adError' } }, AdError: { ErrorCode:{}, Type:{} },
            AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED:'adsManagerLoaded' } },
            UiElements: { AD_ATTRIBUTION:'adAttribution', COUNTDOWN:'countdown' },
            ViewMode: { FULLSCREEN:'fullscreen', NORMAL:'normal' },
        };
    }

    // ── CSS: hide ALL known YouTube ad elements (2025) ────────────────────────
    function injectCSS() {
        if (document.getElementById('__qx_ab_css__')) return;
        var s = document.createElement('style');
        s.id = '__qx_ab_css__';
        s.textContent = [
            // In-video ad overlays
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
            // Feed / sidebar / search ads
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
            // Anti-adblock enforcement popup
            'ytd-enforcement-message-view-model{display:none!important}',
            'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model){display:none!important}',
            'tp-yt-iron-overlay-backdrop.opened{display:none!important}',
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    }
    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', injectCSS)
        : injectCSS();

    // ── Dismiss "Ad blocker detected" / "Before we continue" popup ────────────
    function dismissAntiAdblock() {
        // Remove enforcement model
        document.querySelectorAll('ytd-enforcement-message-view-model').forEach(function (el) {
            try { el.closest('tp-yt-paper-dialog,ytd-popup-container,#player-container')
                    ? el.closest('tp-yt-paper-dialog,ytd-popup-container') && (el.closest('tp-yt-paper-dialog,ytd-popup-container').style.display = 'none')
                    : el.remove(); } catch(e) {}
        });
        // Backdrop
        document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(function (el) {
            el.style.display = 'none';
        });
        // "Got it" / "Continue" / "Dismiss" buttons in any popup
        document.querySelectorAll('ytd-popup-container button, tp-yt-paper-dialog button').forEach(function (btn) {
            var t = (btn.textContent || '').trim().toLowerCase();
            if (t === 'got it' || t === 'dismiss' || t === 'continue' || t === 'allow ads') {
                try { btn.click(); } catch(e) {}
            }
        });
    }

    // ── Skip / fast-forward video ads ─────────────────────────────────────────
    function skipAd() {
        var player = document.querySelector('#movie_player,.html5-video-player');
        if (!player) return;
        var cls = player.classList;
        if (!cls.contains('ad-showing') && !cls.contains('ad-interrupting') &&
            !cls.contains('ad-loading')) return;

        // 1. Try skip button (multiple selectors for different YouTube versions)
        var skip = player.querySelector(
            '.ytp-ad-skip-button,.ytp-ad-skip-button-modern,' +
            '.ytp-skip-ad-button,button[class*="ytp-ad-skip"],' +
            '.ytp-ad-skip-button-slot button'
        );
        if (skip && skip.offsetParent !== null) { try { skip.click(); } catch(e) {} return; }

        // 2. Fast-forward ad video to end
        var video = player.querySelector('video');
        if (video && isFinite(video.duration) && video.duration > 0) {
            try { video.currentTime = video.duration; } catch(e) {}
        }
    }

    function attachObserver() {
        var player = document.querySelector('#movie_player,.html5-video-player');
        if (!player) { setTimeout(attachObserver, 800); return; }
        new MutationObserver(function () { skipAd(); })
            .observe(player, { attributes: true, attributeFilter: ['class'] });
        // Watch body for popup injection and new ad elements
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

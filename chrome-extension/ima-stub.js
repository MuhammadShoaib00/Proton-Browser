// QuantumX YouTube Ad Blocker — IMA SDK stub
// Runs in the page's MAIN world at document_start, BEFORE YouTube's scripts
// initialize. Replaces Google's IMA (Interactive Media Ads) SDK with a stub
// that immediately reports "all ads completed", so the player never plays an ad.
(function () {
    'use strict';
    if (!/youtube\.com/.test(location.hostname)) return;
    if (window.__qxImaStub) return;
    window.__qxImaStub = true;

    function noop() {}

    function FakeAdsManager() {
        var _ev = {};
        this.addEventListener    = function (t, h) { _ev[t] = h; };
        this.removeEventListener = function (t)    { delete _ev[t]; };
        this.init = noop;
        this.start = function () {
            var ev = _ev;
            setTimeout(function () {
                ['allAdsCompleted', 'contentResumeRequested'].forEach(function (t) {
                    if (ev[t]) try { ev[t]({ type: t }); } catch (e) {}
                });
            }, 1);
        };
        this.stop = noop; this.pause = noop; this.resume = noop;
        this.skip = noop; this.destroy = noop; this.resize = noop;
        this.getCuePoints        = function () { return []; };
        this.getRemainingTime    = function () { return 0; };
        this.getAdSkippableState = function () { return false; };
        this.discardAdBreak = noop; this.setVolume = noop;
        this.getVolume           = function () { return 1; };
        this.collapse = noop; this.expand = noop;
        this.isCustomPlaybackUsed = function () { return false; };
    }

    function FakeSettings() {}
    ['setAutoPlayAdBreaks', 'setDisableCustomPlaybackForIOS10Plus', 'setLocale',
     'setNumRedirects', 'setPlayerType', 'setPlayerVersion', 'setVpaidAllowed',
     'setVpaidMode', 'setCompanionBackfill'].forEach(function (m) {
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
        CONTENT_PAUSE_REQUESTED: 'contentPauseRequested', CONTENT_RESUME_REQUESTED: 'contentResumeRequested',
        ALL_ADS_COMPLETED: 'allAdsCompleted', COMPLETE: 'complete', LOADED: 'loaded', STARTED: 'started',
        SKIPPED: 'skipped', PAUSED: 'paused', RESUMED: 'resumed', IMPRESSION: 'impression',
        FIRST_QUARTILE: 'firstQuartile', MIDPOINT: 'midpoint', THIRD_QUARTILE: 'thirdQuartile',
        AD_BREAK_READY: 'adBreakReady', SKIPPABLE_STATE_CHANGED: 'skippableStateChanged',
        DURATION_CHANGE: 'durationChange', LOG: 'log', USER_CLOSE: 'userClose', VOLUME_CHANGED: 'volumeChanged',
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
            ImaSdkSettings: FakeImaSdkSettings, AdEvent: { Type: ADT },
            AdErrorEvent: { Type: { AD_ERROR: 'adError' } }, AdError: { ErrorCode: {}, Type: {} },
            AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: 'adsManagerLoaded' } },
            UiElements: { AD_ATTRIBUTION: 'adAttribution', COUNTDOWN: 'countdown' },
            ViewMode: { FULLSCREEN: 'fullscreen', NORMAL: 'normal' },
        };
    }
})();

// QuantumX YouTube Ad Blocker — DOM layer
// CSS hiding of ad elements, skip-button clicking, in-video ad fast-forward,
// and anti-adblock popup dismissal. The IMA SDK stub lives in ima-stub.js.
(function () {
    'use strict';
    if (!location.hostname.includes('youtube.com')) return;
    if (window.__qxAdSkip) return;
    window.__qxAdSkip = true;

    // ── CSS: hide ALL known YouTube ad elements ───────────────────────────────
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
        if (skip && skip.offsetParent !== null) { try { skip.click(); } catch (e) {} return; }

        // 2. Fast-forward ad video to end
        var video = player.querySelector('video');
        if (video && isFinite(video.duration) && video.duration > 0) {
            try { video.currentTime = video.duration; } catch (e) {}
        }
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

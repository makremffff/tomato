// ══════════════════════════════════════════════════════════
// monetag-sdk.js — Monetag SDK Loader
// النظام: _monetagShowAd() تعرض إعلانَين متتاليَين ثم تـresolve
// ══════════════════════════════════════════════════════════

(function () {
    'use strict';

    const ZONE_ID  = '10245709';
    const SHOW_FN  = `show_${ZONE_ID}`;
    const SDK_URL  = `https://partner.privatepush.com/sdk.js?zone=${ZONE_ID}&sdk=${SHOW_FN}`;

    window._monetagStatus = 'idle'; // idle | loading | loaded | failed
    window._monetagQueue  = [];

    // ─── تحميل الـ SDK ────────────────────────────────────
    function _loadSdk() {
        if (window._monetagStatus !== 'idle') return;
        window._monetagStatus = 'loading';

        const script        = document.createElement('script');
        script.src          = SDK_URL;
        script.async        = true;
        script.dataset.zone = ZONE_ID;
        script.dataset.sdk  = SHOW_FN;

        script.onload = () => {
            window._monetagStatus = 'loaded';
            window._monetagQueue.forEach(fn => fn());
            window._monetagQueue = [];
            console.log('[Monetag] SDK loaded ✓');
        };

        script.onerror = () => {
            window._monetagStatus = 'failed';
            window._monetagQueue.forEach(fn => fn(new Error('SDK load failed')));
            window._monetagQueue = [];
            console.warn('[Monetag] SDK failed to load');
        };

        document.head.appendChild(script);
    }

    // ─── انتظر حتى يكتمل التحميل ─────────────────────────
    function _whenReady(cb) {
        if (window._monetagStatus === 'loaded') { cb(); return; }
        if (window._monetagStatus === 'failed') { cb(new Error('SDK not loaded')); return; }
        window._monetagQueue.push(cb);
        if (window._monetagStatus === 'idle') _loadSdk();
    }

    // ─── عرض إعلان واحد (داخلي) ──────────────────────────
    function _showSingle(userId) {
        return new Promise((resolve, reject) => {
            _whenReady((err) => {
                if (err) return reject(err);
                const showFn = window[SHOW_FN];
                if (typeof showFn !== 'function') return reject(new Error('show fn missing'));
                showFn({ ymid: String(userId || '') }).then(resolve).catch(reject);
            });
        });
    }

    // ─── _monetagShowAd: إعلانَين متتاليَين ثم resolve ───
    window._monetagShowAd = async function (userId) {
        await _showSingle(userId); // إعلان 1
        await _showSingle(userId); // إعلان 2 — تلقائي
    };

    // ─── init ─────────────────────────────────────────────
    window._monetagInit = function () {
        if (window._monetagStatus === 'idle') _loadSdk();
    };

    console.log('[Monetag] monetag-sdk.js ready');
})();

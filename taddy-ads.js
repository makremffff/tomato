/* ══════════════════════════════════════════════════════
   taddy-ads.js — إعلانات Taddy التلقائية (خلفية صامتة)
   يعرض إعلان بيني (interstitial) كل 30 ثانية تلقائياً،
   بدون أي مكافأة للمستخدم وبدون أي إشعار/Toast.
   مستقل تماماً عن نظام Adsgram القائم على المهام في app.js.
══════════════════════════════════════════════════════ */

(function () {
  const TADDY_PUB_ID = '20728df5e1554d2c5ae58c8adc6d7305';
  const AUTO_AD_INTERVAL_MS = 30000; // 30 ثانية

  let _taddyReady = false;
  let _autoAdTimer = null;
  let _adInFlight = false;

  function initTaddy() {
    if (!window.Taddy) return false;
    try {
      window.Taddy.init(TADDY_PUB_ID);
      window.Taddy.ready();
      _taddyReady = true;
      return true;
    } catch (e) {
      console.warn('[taddy] init failed', e);
      return false;
    }
  }

  function showAutoInterstitial() {
    if (!_taddyReady || _adInFlight || !window.Taddy) return;
    _adInFlight = true;
    try {
      const ads = window.Taddy.ads();
      ads.interstitial({
        onClosed: () => { _adInFlight = false; },
        onViewThrough: () => { /* لا مكافأة، لا إشعار — تتبّع صامت فقط */ }
      });
    } catch (e) {
      console.warn('[taddy] interstitial failed', e);
      _adInFlight = false;
    }
  }

  function startAutoAdLoop() {
    if (_autoAdTimer) return;
    _autoAdTimer = setInterval(showAutoInterstitial, AUTO_AD_INTERVAL_MS);
  }

  function boot() {
    // السكربت الأساسي محمّل بـ <script src> عادي، فقد يحتاج لحظات ليجهز window.Taddy
    if (initTaddy()) {
      startAutoAdLoop();
      return;
    }
    let attempts = 0;
    const waitTimer = setInterval(() => {
      attempts++;
      if (initTaddy()) {
        clearInterval(waitTimer);
        startAutoAdLoop();
      } else if (attempts > 20) { // ~10 ثوان محاولة ثم توقف
        clearInterval(waitTimer);
        console.warn('[taddy] SDK لم يُحمّل — تم إلغاء حلقة الإعلانات التلقائية');
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

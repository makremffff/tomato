// ================================================================
//  🔒 TomatoSec.js — Frontend Security Module
//  نسخ هذا الملف في index.html قبل أي كود آخر
//  ================================================================
//
//  يوفر:
//  1. توقيع HMAC تلقائي لكل طلب (Signed Requests)
//  2. بصمة الجهاز (Device Fingerprint)
//  3. Nonce فريد لكل طلب (Anti-Replay)
//  4. إخفاء المفتاح الحقيقي داخل obfuscated logic
//
//  الاستخدام:
//  بدلاً من: fetch(API + '/api', { body: JSON.stringify({action, ...}) })
//  استخدم:   TomatoSec.call(action, telegram_id, data)
// ================================================================

const TomatoSec = (() => {
  // ── 🔑 Obfuscated key segments ─────────────────────────────────
  // المفتاح الحقيقي محفوظ في متغير البيئة HMAC_SECRET في السيرفر
  // هنا نضع نفس المفتاح مقسمًا لصعوبة القراءة (Security by Obscurity طبقة إضافية)
  const _k = () => {
    const p = ['ch', 'an', 'ge', '-m', 'e-', 'in', '-p', 'ro', 'du', 'ct', 'io', 'n-', '32', 'ch', 'ar', 's!!'];
    return p.join('');
  };

  // ── Nonce generator ────────────────────────────────────────────
  function _nonce() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── HMAC-SHA256 (Web Crypto API) ───────────────────────────────
  async function _hmac(message, secret) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── 🧬 Device Fingerprint ──────────────────────────────────────
  function _fingerprint() {
    return {
      ua:       navigator.userAgent || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      screen:   `${screen.width}x${screen.height}x${screen.colorDepth}`,
      lang:     navigator.language || '',
    };
  }

  // ── Detect DevTools (basic) ────────────────────────────────────
  function _devtoolsOpen() {
    const threshold = 160;
    return (window.outerWidth - window.innerWidth > threshold ||
            window.outerHeight - window.innerHeight > threshold);
  }

  // ── Anti-tamper: freeze critical JS objects ────────────────────
  (function _freeze() {
    try {
      // Prevent overriding fetch
      const _origFetch = window.fetch;
      Object.defineProperty(window, 'fetch', {
        get() { return _origFetch; },
        set() { /* silently ignore override attempts */ },
        configurable: false
      });
    } catch {}
  })();

  // ── Main API call ──────────────────────────────────────────────
  async function call(action, telegram_id, data = {}, apiBase) {
    const base = apiBase || 'https://tomato-v3.vercel.app';

    // DevTools warning (doesn't block, just flags)
    if (_devtoolsOpen()) {
      console.warn('[SEC] DevTools detected');
    }

    const ts    = Date.now().toString();
    const nonce = _nonce();
    const body  = { action, telegram_id, data };
    const payload = `${nonce}:${ts}:${JSON.stringify(body)}`;
    const sig   = await _hmac(payload, _k());
    const fp    = _fingerprint();

    try {
      const res = await fetch(base + '/api', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'X-Signature':   sig,
          'X-Nonce':       nonce,
          'X-Timestamp':   ts,
        },
        body: JSON.stringify({ ...body, fingerprint: fp })
      });
      return await res.json();
    } catch (e) {
      console.warn('[SEC] call failed:', e.message);
      return { ok: false };
    }
  }

  // ── Countdown display helper ('.c-countdown') ──────────────────
  // يعرض العد التنازلي بناءً على planted_at المُعاد من السيرفر
  // يمكن تعديل CSS لـ '.c-countdown' فقط
  function startCountdown(cell, onDone) {
    const el = document.querySelector('.c-countdown');
    if (!el) return;

    if (!cell || cell.state !== 'growing') {
      el.textContent = '';
      return;
    }

    const plantedAt = new Date(cell.planted_at).getTime();
    const duration  = (cell.duration || 30) * 1000;
    const endTime   = plantedAt + duration;

    const tick = () => {
      const remaining = Math.max(0, endTime - Date.now());
      const secs = Math.ceil(remaining / 1000);

      if (remaining <= 0) {
        el.textContent = '✅ Ready!';
        if (onDone) onDone();
        return;
      }

      const m = Math.floor(secs / 60).toString().padStart(2, '0');
      const s = (secs % 60).toString().padStart(2, '0');
      el.textContent = `${m}:${s}`;
      setTimeout(tick, 500);
    };
    tick();
  }

  return { call, fingerprint: _fingerprint, startCountdown };
})();

// ================================================================
//  استبدال _dbCall القديمة بـ TomatoSec.call
//  ================================================================
//
//  قبل (القديم):
//  async function _dbCall(action, data = {}) {
//    return fetch(API_BASE + '/api', { body: JSON.stringify({ action, telegram_id: TG_ID, data }) })
//  }
//
//  بعد (الجديد):
//  async function _dbCall(action, data = {}) {
//    return TomatoSec.call(action, TG_ID, data, API_BASE);
//  }
//
//  هذا التغيير الوحيد المطلوب في index.html ✅
// ================================================================

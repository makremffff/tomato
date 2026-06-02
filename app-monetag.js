// ══════════════════════════════════════════════════════════
// app-monetag.js — Monetag Rewarded Interstitial Controller
// ══════════════════════════════════════════════════════════
// مستقل تماماً عن app-ads.js — لا يعدّل أي ملف قديم
// الحد اليومي: 250 مشاهدة | المكافأة: 20 نقطة لكل إعلان
// نوع الإعلان: Rewarded Interstitial (أعلى CPM)
// ══════════════════════════════════════════════════════════

import {
    APP_STATE, APP_CONFIG,
    fetchApi, _dbCall,
} from './app-core.js';

import {
    showToast, animateBalance, updateBalanceUI,
} from './app-ui.js';

// ─── إعدادات Monetag ───────────────────────────────────
const MTG_DAILY_LIMIT  = 250;   // الحد اليومي للمشاهدات
const MTG_REWARD_PTS   = 20;    // نقاط لكل إعلان
const MTG_COOLDOWN_MS  = 5000;  // 5 ثوانٍ بين الإعلانات

// ─── حالة داخلية ───────────────────────────────────────
const _MT = {
    watched:      0,             // مشاهدات اليوم
    remaining:    MTG_DAILY_LIMIT,
    earnedToday:  0,
    isWatching:   false,
    isClaiming:   false,
    cooldownUntil: 0,
    _coolTimer:   null,
    preloaded:    false,
    userId:       null,
};

// ─── تحميل حالة المستخدم من السيرفر ─────────────────────
async function _mtgLoadState() {
    try {
        const res = await fetchApi({ type: 'get_monetag_state', data: {} });
        if (res?.monetag) {
            _MT.watched     = res.monetag.watched      ?? 0;
            _MT.remaining   = res.monetag.remaining    ?? MTG_DAILY_LIMIT;
            _MT.earnedToday = res.monetag.earned_today ?? 0;
        }
    } catch (_) {
        // السيرفر لم يُضف الـ endpoint بعد → نبدأ بصفر
    }
}

// ─── جلب userId من Telegram ──────────────────────────────
function _getUserId() {
    if (_MT.userId) return _MT.userId;
    const uid = window?.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    _MT.userId = uid ? String(uid) : 'anon';
    return _MT.userId;
}

// ─── تحديث واجهة Monetag ─────────────────────────────────
function _mtgUpdateUI() {
    const watched   = _MT.watched;
    const remaining = Math.max(0, MTG_DAILY_LIMIT - watched);

    // عداد المشاهدات
    const watchedEl   = document.getElementById('mtg-watched');
    const remainingEl = document.getElementById('mtg-remaining');
    const limitEl     = document.getElementById('mtg-daily-limit');
    if (watchedEl)   watchedEl.textContent   = watched;
    if (remainingEl) remainingEl.textContent = remaining;
    if (limitEl)     limitEl.textContent     = MTG_DAILY_LIMIT;

    // Ring SVG progress
    const ring = document.getElementById('mtg-mini-ring');
    if (ring) {
        const pct    = watched / MTG_DAILY_LIMIT;
        const circ   = 2 * Math.PI * 15; // r=15
        const offset = circ * (1 - Math.min(pct, 1));
        ring.style.strokeDashoffset = offset;
    }

    // رقم الـ ring
    const ringNum = document.getElementById('mtg-ring-num');
    if (ringNum) ringNum.textContent = remaining;

    // زر المشاهدة
    const btn = document.getElementById('mtg-watch-btn');
    if (!btn) return;

    const done      = remaining <= 0;
    const watching  = _MT.isWatching;
    const onCooldown = Date.now() < _MT.cooldownUntil;

    btn.disabled = done || watching || onCooldown;
    btn.classList.toggle('disabled', btn.disabled);

    if (watching) {
        btn.innerHTML = `<div class="earn-prov-btn-shimmer"></div>
            <img src="assets/loading.gif" style="width:14px;height:14px;object-fit:contain;" alt=""> جاري...`;
    } else if (onCooldown) {
        btn.innerHTML = `<div class="earn-prov-btn-shimmer"></div>انتظر`;
    } else if (done) {
        btn.innerHTML = `<div class="earn-prov-btn-shimmer"></div>✓ انتهى`;
    } else {
        btn.innerHTML = `<div class="earn-prov-btn-shimmer"></div>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="opacity:.8;">
              <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"/>
            </svg>شاهد`;
    }

    // done state
    const doneState = document.getElementById('mtg-done-state');
    if (doneState) doneState.style.display = done ? '' : 'none';

    const provRow = document.getElementById('mtg-prov-row');
    if (provRow) provRow.style.display = done ? 'none' : '';
}

// ─── Cooldown timer ───────────────────────────────────────
function _mtgStartCooldown() {
    _MT.cooldownUntil = Date.now() + MTG_COOLDOWN_MS;
    clearInterval(_MT._coolTimer);
    _mtgUpdateUI();

    _MT._coolTimer = setInterval(() => {
        if (Date.now() >= _MT.cooldownUntil) {
            clearInterval(_MT._coolTimer);
            _mtgUpdateUI();
            // preload التالي مباشرةً بعد الكولداون
            _mtgPreload();
        } else {
            _mtgUpdateUI();
        }
    }, 500);
}

// ─── Preload الإعلان التالي ───────────────────────────────
function _mtgPreload() {
    if (_MT.preloaded) return;
    if (_MT.remaining <= 0) return;
    if (typeof window._monetagPreload !== 'function') return;
    window._monetagPreload(_getUserId())
        .then(() => { _MT.preloaded = true; })
        .catch(() => { _MT.preloaded = false; });
}

// ─── منح المكافأة للمستخدم ───────────────────────────────
async function _mtgGrantReward() {
    if (_MT.isClaiming) return;
    _MT.isClaiming = true;
    try {
        // محاولة إخبار السيرفر (endpoint اختياري — يُضاف لاحقاً)
        let granted = MTG_REWARD_PTS;
        try {
            const res = await fetchApi({
                type: 'claim_monetag_reward',
                data: { provider: 'monetag', ad_type: 'rewarded_interstitial' }
            });
            if (res?.points) granted = res.points;
        } catch (_) {
            // السيرفر لم يُطبّق بعد → نمنح محلياً
        }

        // تحديث الحالة
        _MT.watched++;
        _MT.remaining   = Math.max(0, MTG_DAILY_LIMIT - _MT.watched);
        _MT.earnedToday += granted;

        // تحديث الـ balance في الـ state
        APP_STATE.balance = (APP_STATE.balance || 0) + granted;
        animateBalance(granted);
        updateBalanceUI();

        showToast(`+${granted} نقطة من Monetag 🎉`, 'success');
        _mtgUpdateUI();
        _mtgStartCooldown();

    } finally {
        _MT.isClaiming  = false;
        _MT.isWatching  = false;
        _MT.preloaded   = false;
    }
}

// ─── الدالة الرئيسية: مشاهدة إعلان Monetag ───────────────
window.watchMonetag = async function () {
    if (_MT.isWatching || _MT.isClaiming) return;
    if (_MT.remaining <= 0) {
        showToast('وصلت للحد اليومي ✓', 'info');
        return;
    }
    if (Date.now() < _MT.cooldownUntil) return;

    if (typeof window._monetagShowAd !== 'function') {
        showToast('جاري تحميل الإعلان...', 'info');
        // ابدأ تحميل الـ SDK وحاول مرة أخرى
        if (typeof window._monetagInit === 'function') window._monetagInit();
        setTimeout(() => window.watchMonetag?.(), 2000);
        return;
    }

    _MT.isWatching = true;
    _MT.preloaded  = false;
    _mtgUpdateUI();

    try {
        await window._monetagShowAd(_getUserId());
        // Promise حُلّ = المستخدم شاهد الإعلان كاملاً
        await _mtgGrantReward();
    } catch (err) {
        console.warn('[Monetag] Ad failed or skipped:', err);
        showToast('الإعلان لم يكتمل — لم تُمنح نقاط', 'warning');
    } finally {
        _MT.isWatching = false;
        _mtgUpdateUI();
    }
};

// ─── تهيئة عند تحميل الصفحة ──────────────────────────────
async function _mtgInit() {
    // تحميل حالة السيرفر
    await _mtgLoadState();

    // تحديث الواجهة
    _mtgUpdateUI();

    // ابدأ تحميل الـ SDK فوراً
    if (typeof window._monetagInit === 'function') window._monetagInit();

    // Preload بعد ثانيتين (نعطي الـ SDK وقت)
    setTimeout(_mtgPreload, 2000);

    console.log('[Monetag] Controller ready | remaining:', _MT.remaining);
}

// شغّل عند DOMContentLoaded أو مباشرةً
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _mtgInit);
} else {
    _mtgInit();
}

export { _mtgUpdateUI, _mtgInit };

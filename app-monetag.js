// ══════════════════════════════════════════════════════════
// app-monetag.js — Monetag Rewarded Interstitial Controller
// ══════════════════════════════════════════════════════════
// الـ SDK: //libtl.com/sdk.js (محمّل في index.html)
// يولّد تلقائياً: window.show_10245709()
// ضغطة واحدة → إعلان 1 → إعلان 2 مباشرة → جائزة
// ══════════════════════════════════════════════════════════

import {
    APP_STATE, APP_CONFIG,
    fetchApi, _dbCall,
} from './app-core.js';

import {
    showToast, animateBalance, updateBalanceUI,
} from './app-ui.js';

// ─── إعدادات Monetag ───────────────────────────────────
const MTG_DAILY_LIMIT  = 250;
const MTG_REWARD_PTS   = 20;
const MTG_COOLDOWN_MS  = 5000;
const MTG_SHOW_FN      = 'show_10245709'; // يولّده libtl SDK تلقائياً

// ─── حالة داخلية ───────────────────────────────────────
const _MT = {
    watched:       0,
    remaining:     MTG_DAILY_LIMIT,
    earnedToday:   0,
    isWatching:    false,
    isClaiming:    false,
    cooldownUntil: 0,
    _coolTimer:    null,
};

// ─── جلب userId من Telegram ──────────────────────────────
function _getUserId() {
    const uid = window?.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    return uid ? String(uid) : 'anon';
}

// ─── هل الـ SDK جاهز ─────────────────────────────────────
function _sdkReady() {
    return typeof window[MTG_SHOW_FN] === 'function';
}

// ─── تحميل حالة المستخدم من السيرفر ─────────────────────
async function _mtgLoadState() {
    try {
        const res = await fetchApi({ type: 'get_monetag_state', data: {} });
        if (res?.monetag) {
            _MT.watched     = res.monetag.watched      ?? 0;
            _MT.remaining   = res.monetag.remaining    ?? MTG_DAILY_LIMIT;
            _MT.earnedToday = res.monetag.earned_today ?? 0;
        }
    } catch (_) {}
}

// ─── تحديث واجهة Monetag ─────────────────────────────────
function _mtgUpdateUI() {
    const watched   = _MT.watched;
    const remaining = Math.max(0, MTG_DAILY_LIMIT - watched);

    const watchedEl   = document.getElementById('monetag-watched');
    const remainingEl = document.getElementById('monetag-remaining');
    const limitEl     = document.getElementById('monetag-daily-limit');
    if (watchedEl)   watchedEl.textContent   = watched;
    if (remainingEl) remainingEl.textContent = remaining;
    if (limitEl)     limitEl.textContent     = MTG_DAILY_LIMIT;

    // Ring SVG progress
    const ring = document.getElementById('monetag-mini-ring');
    if (ring) {
        const circ   = 2 * Math.PI * 15;
        const offset = circ * (1 - Math.min(watched / MTG_DAILY_LIMIT, 1));
        ring.style.strokeDashoffset = offset;
    }

    const btn = document.getElementById('monetag-watch-btn');
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

    const doneState = document.getElementById('monetag-done-state');
    if (doneState) doneState.style.display = done ? '' : 'none';

    const provRow = document.getElementById('monetag-prov-row');
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
        }
        _mtgUpdateUI();
    }, 500);
}

// ─── منح المكافأة للمستخدم ───────────────────────────────
async function _mtgGrantReward() {
    if (_MT.isClaiming) return;
    _MT.isClaiming = true;
    try {
        let granted = MTG_REWARD_PTS;
        try {
            const res = await fetchApi({
                type: 'claim_monetag_reward',
                data: { provider: 'monetag', ad_type: 'rewarded_interstitial' }
            });
            if (res?.points) granted = res.points;
        } catch (_) {}

        _MT.watched++;
        _MT.remaining   = Math.max(0, MTG_DAILY_LIMIT - _MT.watched);
        _MT.earnedToday += granted;

        APP_STATE.balance = (APP_STATE.balance || 0) + granted;
        animateBalance(granted);
        updateBalanceUI();

        showToast(`+${granted} نقطة من Monetag 🎉`, 'success');
        _mtgUpdateUI();
        _mtgStartCooldown();
    } finally {
        _MT.isClaiming = false;
        _MT.isWatching = false;
    }
}

// ─── الدالة الرئيسية: مشاهدة إعلانين ثم جائزة ────────────
window.watchMonetag = async function () {
    if (_MT.isWatching || _MT.isClaiming) return;
    if (_MT.remaining <= 0) {
        showToast('وصلت للحد اليومي ✓', 'info');
        return;
    }
    if (Date.now() < _MT.cooldownUntil) return;

    // SDK جاهز؟
    if (!_sdkReady()) {
        showToast('جاري تحميل الإعلان...', 'info');
        setTimeout(() => window.watchMonetag?.(), 2000);
        return;
    }

    _MT.isWatching = true;
    _mtgUpdateUI();

    try {
        // إعلان 1 — بنفس طريقة المشروع المرجعي
        await window[MTG_SHOW_FN]({ ymid: _getUserId() });
        // إعلان 2 — يبدأ فوراً بعد انتهاء الأول
        await window[MTG_SHOW_FN]({ ymid: _getUserId() });
        // كلاهما اكتمل → جائزة واحدة
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
    await _mtgLoadState();
    _mtgUpdateUI();
    console.log('[Monetag] ready | remaining:', _MT.remaining);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _mtgInit);
} else {
    _mtgInit();
}

export { _mtgUpdateUI, _mtgInit };

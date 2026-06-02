// ══════════════════════════════════════════════════════════
// app-monetag.js — Monetag Rewarded Interstitial Controller
// النظام: كل إعلانَين = جائزة واحدة + عداد +1
// الحد اليومي: 250 جائزة | المكافأة: 20 نقطة لكل جائزة
// ══════════════════════════════════════════════════════════

import {
    APP_STATE, APP_CONFIG,
    fetchApi,
} from './app-core.js';

import {
    showToast, animateBalance, updateBalanceUI,
} from './app-ui.js';

// ─── إعدادات ثابتة ─────────────────────────────────────
const MTG_DAILY_LIMIT   = 250;   // الحد اليومي للجوائز (كل جائزة = 2 إعلان)
const MTG_REWARD_PTS    = 20;    // نقاط لكل جائزة
const MTG_COOLDOWN_MS   = 5_000; // 5 ثوانٍ كولداون بعد كل جائزة
const MTG_ADS_PER_PRIZE = 2;     // عدد الإعلانات المطلوبة لجائزة واحدة

// ─── حالة داخلية ───────────────────────────────────────
const _MT = {
    prizes:        0,    // عدد الجوائز المكتسبة اليوم (= counter)
    adsThisRound:  0,    // إعلانات شُوهدت في الجولة الحالية (0 أو 1)
    earnedToday:   0,    // نقاط مكتسبة اليوم
    isWatching:    false,
    isClaiming:    false,
    cooldownUntil: 0,
    _coolTimer:    null,
    preloaded:     false,
    userId:        null,
};

// ─── جلب userId ─────────────────────────────────────────
function _getUserId() {
    if (_MT.userId) return _MT.userId;
    const uid = window?.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    _MT.userId = uid ? String(uid) : 'anon';
    return _MT.userId;
}

// ─── تحميل حالة السيرفر ──────────────────────────────
async function _mtgLoadState() {
    try {
        const res = await fetchApi({ type: 'get_monetag_state', data: {} });
        if (res?.monetag) {
            _MT.prizes      = res.monetag.watched      ?? 0;
            _MT.earnedToday = res.monetag.earned_today ?? 0;
        }
    } catch (_) {
        // السيرفر لم يضف الـ endpoint بعد → نبدأ بصفر
    }
}

// ─── تحديث الواجهة ───────────────────────────────────
function _mtgUpdateUI() {
    const remaining = Math.max(0, MTG_DAILY_LIMIT - _MT.prizes);

    // عداد الجوائز
    const watchedEl   = document.getElementById('mtg-watched');
    const remainingEl = document.getElementById('mtg-remaining');
    const limitEl     = document.getElementById('mtg-daily-limit');
    if (watchedEl)   watchedEl.textContent   = _MT.prizes;
    if (remainingEl) remainingEl.textContent = remaining;
    if (limitEl)     limitEl.textContent     = MTG_DAILY_LIMIT;

    // مؤشر تقدم الجولة الحالية (0/2 أو 1/2)
    const roundEl = document.getElementById('mtg-round-progress');
    if (roundEl) roundEl.textContent = `${_MT.adsThisRound}/${MTG_ADS_PER_PRIZE}`;

    // Ring SVG
    const ring = document.getElementById('mtg-mini-ring');
    if (ring) {
        const pct    = _MT.prizes / MTG_DAILY_LIMIT;
        const circ   = 2 * Math.PI * 15;
        ring.style.strokeDashoffset = circ * (1 - Math.min(pct, 1));
    }
    const ringNum = document.getElementById('mtg-ring-num');
    if (ringNum) ringNum.textContent = remaining;

    // زر المشاهدة
    const btn = document.getElementById('mtg-watch-btn');
    if (!btn) return;

    const done      = remaining <= 0;
    const onCooldown = Date.now() < _MT.cooldownUntil;

    btn.disabled = done || _MT.isWatching || onCooldown;
    btn.classList.toggle('disabled', btn.disabled);

    if (_MT.isWatching) {
        btn.innerHTML = `<div class="earn-prov-btn-shimmer"></div>
            <img src="assets/loading.gif" style="width:14px;height:14px;object-fit:contain;" alt=""> جاري...`;
    } else if (onCooldown) {
        btn.innerHTML = `<div class="earn-prov-btn-shimmer"></div>انتظر`;
    } else if (done) {
        btn.innerHTML = `<div class="earn-prov-btn-shimmer"></div>✓ انتهى`;
    } else {
        // يظهر كم إعلان تبقى في الجولة
        const adsLeft = MTG_ADS_PER_PRIZE - _MT.adsThisRound;
        const label   = _MT.adsThisRound > 0
            ? `شاهد (${adsLeft} تبقى للجائزة)`
            : `شاهد`;
        btn.innerHTML = `<div class="earn-prov-btn-shimmer"></div>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="opacity:.8;">
              <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"/>
            </svg>${label}`;
    }

    const doneState = document.getElementById('mtg-done-state');
    if (doneState) doneState.style.display = done ? '' : 'none';

    const provRow = document.getElementById('mtg-prov-row');
    if (provRow) provRow.style.display = done ? 'none' : '';
}

// ─── Cooldown timer ──────────────────────────────────
function _mtgStartCooldown() {
    _MT.cooldownUntil = Date.now() + MTG_COOLDOWN_MS;
    clearInterval(_MT._coolTimer);
    _mtgUpdateUI();

    _MT._coolTimer = setInterval(() => {
        if (Date.now() >= _MT.cooldownUntil) {
            clearInterval(_MT._coolTimer);
            _mtgUpdateUI();
            _mtgPreload();
        } else {
            _mtgUpdateUI();
        }
    }, 500);
}

// ─── Preload ─────────────────────────────────────────
function _mtgPreload() {
    if (_MT.preloaded) return;
    if (_MT.prizes >= MTG_DAILY_LIMIT) return;
    if (typeof window._monetagPreload !== 'function') return;
    window._monetagPreload(_getUserId())
        .then(() => { _MT.preloaded = true; })
        .catch(() => { _MT.preloaded = false; });
}

// ─── منح الجائزة (بعد الإعلان الثاني) ───────────────
async function _mtgGrantReward() {
    if (_MT.isClaiming) return;
    _MT.isClaiming = true;
    try {
        let granted = MTG_REWARD_PTS;
        try {
            const res = await fetchApi({
                type: 'monetag_reward',
                data: { provider: 'monetag', ad_type: 'rewarded_interstitial' },
            });
            if (res?.ok && res?.points_awarded) {
                granted             = res.points_awarded;
                _MT.prizes          = res.watched_today ?? (_MT.prizes + 1);
                _MT.earnedToday    += granted;
            } else if (!res?.ok) {
                // السيرفر رفض (daily limit, cooldown, etc.)
                const msg = res?.error === 'daily_limit_reached'
                    ? 'وصلت للحد اليومي ✓'
                    : 'خطأ في منح النقاط';
                showToast(msg, 'warning');
                return;
            }
        } catch (_) {
            // fallback محلي إذا السيرفر ما رد
            _MT.prizes++;
            _MT.earnedToday += granted;
        }

        // تحديث الـ balance
        APP_STATE.balance = (APP_STATE.balance || 0) + granted;
        animateBalance(granted);
        updateBalanceUI();

        showToast(`+${granted} نقطة من Monetag 🎉`, 'success');
        _mtgUpdateUI();
        _mtgStartCooldown();

    } finally {
        _MT.isClaiming = false;
        _MT.isWatching = false;
        _MT.preloaded  = false;
    }
}

// ─── مشاهدة إعلان واحد ──────────────────────────────
async function _mtgWatchOneAd() {
    if (typeof window._monetagShowAd !== 'function') {
        showToast('جاري تحميل الإعلان...', 'info');
        if (typeof window._monetagInit === 'function') window._monetagInit();
        setTimeout(() => window.watchMonetag?.(), 2000);
        return false; // فشل
    }

    try {
        await window._monetagShowAd(_getUserId());
        return true; // نجح
    } catch (err) {
        console.warn('[Monetag] Ad failed or skipped:', err);
        showToast('الإعلان لم يكتمل — حاول مرة أخرى', 'warning');
        return false;
    }
}

// ─── الدالة الرئيسية ─────────────────────────────────
window.watchMonetag = async function () {
    if (_MT.isWatching || _MT.isClaiming) return;

    if (_MT.prizes >= MTG_DAILY_LIMIT) {
        showToast('وصلت للحد اليومي ✓', 'info');
        return;
    }

    if (Date.now() < _MT.cooldownUntil) return;

    _MT.isWatching = true;
    _MT.preloaded  = false;
    _mtgUpdateUI();

    try {
        const ok = await _mtgWatchOneAd();
        if (!ok) return;

        _MT.adsThisRound++;
        _mtgUpdateUI();

        if (_MT.adsThisRound >= MTG_ADS_PER_PRIZE) {
            // اكتملت الجولة — احسب الجائزة
            _MT.adsThisRound = 0;
            await _mtgGrantReward();
        } else {
            // الإعلان الأول اكتمل، انتظر الثاني
            showToast(`إعلان 1/${MTG_ADS_PER_PRIZE} ✓ — شاهد إعلاناً آخر للجائزة`, 'info');
            _mtgUpdateUI();
        }

    } finally {
        _MT.isWatching = false;
        _mtgUpdateUI();
    }
};

// ─── تهيئة ───────────────────────────────────────────
async function _mtgInit() {
    await _mtgLoadState();
    _mtgUpdateUI();
    if (typeof window._monetagInit === 'function') window._monetagInit();
    setTimeout(_mtgPreload, 2000);
    console.log('[Monetag] Controller ready | prizes today:', _MT.prizes);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _mtgInit);
} else {
    _mtgInit();
}

export { _mtgUpdateUI, _mtgInit };

// ══════════════════════════════════════════════════════════
// app-monetag.js — Monetag Rewarded Interstitial Controller
// النظام: ضغطة وحدة ← إعلان 1 تلقائي ← إعلان 2 تلقائي ← جائزة + عداد +1
// SDK: libtl.com | دالة: show_10245709
// الحد اليومي: 250 جائزة | المكافأة: 20 نقطة
// ══════════════════════════════════════════════════════════

import {
    APP_STATE,
    fetchApi,
} from './app-core.js';

import {
    showToast, animateBalance, updateBalanceUI,
} from './app-ui.js';

// ─── إعدادات ────────────────────────────────────────────
const MTG_DAILY_LIMIT = 250;
const MTG_REWARD_PTS  = 20;
const MTG_COOLDOWN_MS = 5_000;
const MTG_SDK_FN      = 'show_10245709'; // دالة الـ SDK من libtl.com

// ─── حالة داخلية ────────────────────────────────────────
const _MT = {
    prizes:        0,   // عدد الجوائز اليوم (= العداد)
    earnedToday:   0,
    isWatching:    false,
    isClaiming:    false,
    cooldownUntil: 0,
    _coolTimer:    null,
};

// ─── تحميل حالة السيرفر ─────────────────────────────────
async function _mtgLoadState() {
    try {
        const res = await fetchApi({ type: 'get_monetag_state', data: {} });
        if (res?.monetag) {
            _MT.prizes      = res.monetag.watched      ?? 0;
            _MT.earnedToday = res.monetag.earned_today ?? 0;
        }
    } catch (_) {}
}

// ─── تحديث الواجهة ──────────────────────────────────────
function _mtgUpdateUI() {
    const remaining = Math.max(0, MTG_DAILY_LIMIT - _MT.prizes);

    const watchedEl   = document.getElementById('mtg-watched');
    const remainingEl = document.getElementById('mtg-remaining');
    const limitEl     = document.getElementById('mtg-daily-limit');
    if (watchedEl)   watchedEl.textContent   = _MT.prizes;
    if (remainingEl) remainingEl.textContent = remaining;
    if (limitEl)     limitEl.textContent     = MTG_DAILY_LIMIT;

    const ring = document.getElementById('mtg-mini-ring');
    if (ring) {
        const circ = 2 * Math.PI * 15;
        ring.style.strokeDashoffset = circ * (1 - Math.min(_MT.prizes / MTG_DAILY_LIMIT, 1));
    }
    const ringNum = document.getElementById('mtg-ring-num');
    if (ringNum) ringNum.textContent = remaining;

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
        btn.innerHTML = `<div class="earn-prov-btn-shimmer"></div>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="opacity:.8;">
              <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"/>
            </svg>شاهد`;
    }

    const doneState = document.getElementById('mtg-done-state');
    if (doneState) doneState.style.display = done ? '' : 'none';
    const provRow = document.getElementById('mtg-prov-row');
    if (provRow) provRow.style.display = done ? 'none' : '';
}

// ─── Cooldown ────────────────────────────────────────────
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

// ─── عرض إعلان واحد عبر libtl SDK ──────────────────────
function _showOneAd() {
    return new Promise((resolve, reject) => {
        const fn = window[MTG_SDK_FN];
        if (typeof fn !== 'function') {
            reject(new Error('sdk_not_ready'));
            return;
        }
        fn().then(resolve).catch(reject);
    });
}

// ─── منح الجائزة من السيرفر ─────────────────────────────
async function _mtgGrantReward() {
    _MT.isClaiming = true;
    try {
        let granted = MTG_REWARD_PTS;
        try {
            const res = await fetchApi({
                type: 'monetag_reward',
                data: { provider: 'monetag', ad_type: 'rewarded_interstitial' },
            });
            if (res?.ok) {
                granted         = res.points_awarded ?? MTG_REWARD_PTS;
                _MT.prizes      = res.watched_today  ?? (_MT.prizes + 1);
                _MT.earnedToday += granted;
            } else {
                const msg = res?.error === 'daily_limit_reached'
                    ? 'وصلت للحد اليومي ✓'
                    : 'خطأ في منح النقاط';
                showToast(msg, 'warning');
                return;
            }
        } catch (_) {
            // fallback محلي
            _MT.prizes++;
            _MT.earnedToday += granted;
        }

        APP_STATE.balance = (APP_STATE.balance || 0) + granted;
        animateBalance(granted);
        updateBalanceUI();
        showToast(`+${granted} نقطة من Monetag 🎉`, 'success');
        _mtgStartCooldown();
    } finally {
        _MT.isClaiming = false;
    }
}

// ─── الدالة الرئيسية ─────────────────────────────────────
window.watchMonetag = async function () {
    if (_MT.isWatching || _MT.isClaiming) return;
    if (_MT.prizes >= MTG_DAILY_LIMIT) {
        showToast('وصلت للحد اليومي ✓', 'info');
        return;
    }
    if (Date.now() < _MT.cooldownUntil) return;

    // تحقق أن الـ SDK محمل
    if (typeof window[MTG_SDK_FN] !== 'function') {
        showToast('جاري تحميل الإعلان...', 'info');
        setTimeout(() => window.watchMonetag?.(), 2000);
        return;
    }

    _MT.isWatching = true;
    _mtgUpdateUI();

    try {
        // إعلان 1
        await _showOneAd();

        // إعلان 2 — تلقائي بدون تدخل المستخدم
        await _showOneAd();

        // بعد الاثنين ← جائزة
        await _mtgGrantReward();

    } catch (err) {
        console.warn('[Monetag] Ad sequence failed:', err?.message);
        const msg = String(err).includes('cancel')
            ? 'أكمل الإعلان للحصول على النقاط'
            : 'الإعلان لم يكتمل — حاول مرة أخرى';
        showToast(msg, 'warning');
    } finally {
        _MT.isWatching = false;
        _mtgUpdateUI();
    }
};

// ─── تهيئة ───────────────────────────────────────────────
async function _mtgInit() {
    await _mtgLoadState();
    _mtgUpdateUI();
    console.log('[Monetag] ready | prizes today:', _MT.prizes);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _mtgInit);
} else {
    _mtgInit();
}

export { _mtgUpdateUI, _mtgInit };

// ══════════════════════════════════════════════════════════
// app-monetag.js — Monetag Rewarded Interstitial Controller
// النظام: ضغطة وحدة = إعلانَين متتاليَين → جائزة واحدة + عداد +1
// الحد اليومي: 250 جائزة | المكافأة: 20 نقطة لكل جائزة
// ══════════════════════════════════════════════════════════

import {
    APP_STATE,
    fetchApi,
} from './app-core.js';

import {
    showToast, animateBalance, updateBalanceUI,
} from './app-ui.js';

// ─── إعدادات ────────────────────────────────────────────
const MTG_DAILY_LIMIT   = 250;
const MTG_REWARD_PTS    = 20;
const MTG_COOLDOWN_MS   = 5_000;
const MTG_ADS_PER_PRIZE = 2;

// ─── حالة داخلية ────────────────────────────────────────
const _MT = {
    prizes:        0,
    earnedToday:   0,
    isWatching:    false,
    isClaiming:    false,
    cooldownUntil: 0,
    _coolTimer:    null,
    userId:        null,
};

// ─── userId ──────────────────────────────────────────────
function _getUserId() {
    if (_MT.userId) return _MT.userId;
    const uid = window?.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    _MT.userId = uid ? String(uid) : 'anon';
    return _MT.userId;
}

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
            _mtgUpdateUI();
        } else {
            _mtgUpdateUI();
        }
    }, 500);
}

// ─── عرض إعلان واحد — Promise ────────────────────────────
function _showAd() {
    return new Promise((resolve, reject) => {
        if (typeof window._monetagShowAd !== 'function') {
            reject(new Error('sdk_not_ready'));
            return;
        }
        window._monetagShowAd(_getUserId()).then(resolve).catch(reject);
    });
}

// ─── منح الجائزة ────────────────────────────────────────
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
                granted        = res.points_awarded ?? MTG_REWARD_PTS;
                _MT.prizes     = res.watched_today  ?? (_MT.prizes + 1);
                _MT.earnedToday += granted;
            } else {
                const msg = res?.error === 'daily_limit_reached'
                    ? 'وصلت للحد اليومي ✓'
                    : 'خطأ في منح النقاط';
                showToast(msg, 'warning');
                return;
            }
        } catch (_) {
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
    if (_MT.prizes >= MTG_DAILY_LIMIT) { showToast('وصلت للحد اليومي ✓', 'info'); return; }
    if (Date.now() < _MT.cooldownUntil) return;

    if (typeof window._monetagShowAd !== 'function') {
        showToast('جاري تحميل الإعلان...', 'info');
        if (typeof window._monetagInit === 'function') window._monetagInit();
        setTimeout(() => window.watchMonetag?.(), 2000);
        return;
    }

    _MT.isWatching = true;
    _mtgUpdateUI();

    try {
        // ── الإعلان الأول ──
        await _showAd();

        // ── الإعلان الثاني يتحمل مباشرة بدون تدخل المستخدم ──
        await _showAd();

        // ── الجائزة بعد الاثنين ──
        await _mtgGrantReward();

    } catch (err) {
        console.warn('[Monetag] Ad failed:', err?.message);
        showToast('الإعلان لم يكتمل — لم تُمنح نقاط', 'warning');
    } finally {
        _MT.isWatching = false;
        _mtgUpdateUI();
    }
};

// ─── تهيئة ───────────────────────────────────────────────
async function _mtgInit() {
    await _mtgLoadState();
    _mtgUpdateUI();
    if (typeof window._monetagInit === 'function') window._monetagInit();
    console.log('[Monetag] ready | prizes today:', _MT.prizes);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _mtgInit);
} else {
    _mtgInit();
}

export { _mtgUpdateUI, _mtgInit };

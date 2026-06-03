// ══════════════════════════════════════════════════════════
// app-monetag.js — Monetag Rewarded Interstitial Controller
// النظام: ضغطة وحدة ← show_10245709() مرتين ← 50 ticket + عداد +1
// ══════════════════════════════════════════════════════════

import { APP_STATE, fetchApi } from './app-core.js';
import { showToast, animateBalance, updateBalanceUI } from './app-ui.js';

const MTG_DAILY_LIMIT  = 250;
const MTG_TICKET_COUNT = 50;   // تذاكر مسابقة لكل إعلان
const MTG_COOLDOWN_MS  = 5_000;

const _MT = {
    prizes:        0,
    earnedToday:   0,
    isWatching:    false,
    isClaiming:    false,
    cooldownUntil: 0,
    _coolTimer:    null,
};

async function _mtgLoadState() {
    try {
        const res = await fetchApi({ type: 'get_monetag_state', data: {} });
        if (res?.monetag) {
            _MT.prizes      = res.monetag.watched      ?? 0;
            _MT.earnedToday = res.monetag.earned_today ?? 0;
        }
    } catch (_) {}
}

function _mtgUpdateUI() {
    const remaining = Math.max(0, MTG_DAILY_LIMIT - _MT.prizes);
    const el = id => document.getElementById(id);

    if (el('monetag-watched'))     el('monetag-watched').textContent     = _MT.prizes;
    if (el('monetag-remaining'))   el('monetag-remaining').textContent   = remaining;
    if (el('monetag-daily-limit')) el('monetag-daily-limit').textContent = MTG_DAILY_LIMIT;

    const ring = el('monetag-mini-ring');
    if (ring) {
        const circ = 2 * Math.PI * 15;
        ring.style.strokeDashoffset = circ * (1 - Math.min(_MT.prizes / MTG_DAILY_LIMIT, 1));
    }

    const btn = el('monetag-watch-btn');
    if (!btn) return;

    const done       = remaining <= 0;
    const onCooldown = Date.now() < _MT.cooldownUntil;

    btn.disabled = done || _MT.isWatching || onCooldown;
    btn.classList.toggle('disabled', btn.disabled);

    if (_MT.isWatching) {
        btn.innerHTML = `<div class="earn-prov-btn-shimmer"></div>
            <img src="asesst/loading.gif" style="width:14px;height:14px;object-fit:contain;" alt=""> جاري...`;
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

    if (el('monetag-done-state')) el('monetag-done-state').style.display = done ? '' : 'none';
    if (el('monetag-prov-row'))   el('monetag-prov-row').style.display   = done ? 'none' : '';
}

function _mtgStartCooldown() {
    _MT.cooldownUntil = Date.now() + MTG_COOLDOWN_MS;
    clearInterval(_MT._coolTimer);
    _mtgUpdateUI();
    _MT._coolTimer = setInterval(() => {
        if (Date.now() >= _MT.cooldownUntil) clearInterval(_MT._coolTimer);
        _mtgUpdateUI();
    }, 500);
}

async function _mtgGrantReward() {
    _MT.isClaiming = true;
    try {
        try {
            const res = await fetchApi({
                type: 'monetag_reward',
                data: { provider: 'monetag', ad_type: 'rewarded_interstitial' },
            });
            if (res?.ok) {
                _MT.prizes      = res.watched_today  ?? (_MT.prizes + 1);
                _MT.earnedToday += MTG_TICKET_COUNT;
            } else {
                const msg = res?.error === 'daily_limit_reached' ? 'وصلت للحد اليومي ✓' : 'خطأ في منح التذاكر';
                showToast('warning', 'Monetag', msg, 'orange', '!');
                return;
            }
        } catch (_) {
            _MT.prizes++;
            _MT.earnedToday += MTG_TICKET_COUNT;
        }

        // منح التذاكر للمسابقة
        try {
            await fetchApi({
                type: 'grant_competition_tickets',
                data: { count: MTG_TICKET_COUNT },
            });
        } catch (_) {}

        showToast('trophy', 'Monetag 🎟️', `+${MTG_TICKET_COUNT} تذكرة مسابقة`, 'green', `+${MTG_TICKET_COUNT}`);
        _mtgStartCooldown();
    } finally {
        _MT.isClaiming = false;
    }
}

window.watchMonetag = async function () {
    if (_MT.isWatching || _MT.isClaiming) return;
    if (_MT.prizes >= MTG_DAILY_LIMIT) {
        showToast('info', 'Monetag', 'وصلت للحد اليومي ✓', 'blue', '✓');
        return;
    }
    if (Date.now() < _MT.cooldownUntil) return;

    if (typeof show_10245709 !== 'function') {
        showToast('info', 'Monetag', 'جاري تحميل الإعلان...', 'blue', '...');
        setTimeout(() => window.watchMonetag?.(), 2000);
        return;
    }

    _MT.isWatching = true;
    _mtgUpdateUI();

    try {
        await show_10245709(); // إعلان 1
        await show_10245709(); // إعلان 2 — تلقائي
        await _mtgGrantReward();
    } catch (err) {
        console.warn('[Monetag] failed:', err?.message);
        const msg = String(err).toLowerCase().includes('cancel')
            ? 'أكمل الإعلان للحصول على التذاكر'
            : 'الإعلان لم يكتمل — حاول مرة أخرى';
        showToast('warning', 'Monetag', msg, 'orange', '!');
    } finally {
        _MT.isWatching = false;
        _mtgUpdateUI();
    }
};

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

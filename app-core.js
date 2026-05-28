// ══════════════════════════════════════════════════════════
// app-core.js — Config · State · Session · Nonce · API
// ══════════════════════════════════════════════════════════

export const API_BASE = '/api';

// ── Central APP_STATE ────────────────────────────────────
export const APP_STATE = {
    balance: 0,
    level:   1,
    usdt_balance: 0,
    first_withdraw_done: false,

    ads: {
        total:          10,
        watched:        0,
        remaining:      10,
        earned:         0,
        isWatching:     false,
        cooldownUntil:  0,
        _cooldownTimer: null,
    },

    tasks: {
        tgJoined:    false,
        tgVerified:  false,
        ads10Done:   false,
        ads25Done:   false,
        invite3Done: false,
    },

    dailyGift: {
        dayNumber: 1,
        claimed:   false,
        isOpening: false,
    },

    serverConfig: {
        pts_per_ton:      100000,
        pts_per_referral: 100,
        ads_daily_limit:  10,
    },

    withdrawHistory: [],
};

export const DAILY_GIFT_STATE = APP_STATE.dailyGift;
export const WITHDRAW_HISTORY = APP_STATE.withdrawHistory;
export const _SERVER_CONFIG   = APP_STATE.serverConfig;

// ── APP_CONFIG ──────────────────────────────────────────
export const APP_CONFIG = {
    withdraw:   { first_min: 3000, normal_min: 20000, normal_level: 5 },
    rewards:    { referral: 100, telegram_task: 200,
                  daily_ads_10: 200, daily_ads_25: 300, daily_referrals_3: 1000,
                  points_per_ad: 50 },
    telegram:   { channel_url: 'https://t.me/botbababab' },
    ads:        { daily_limit: 10, cooldown_ms: 30000, min_duration_ms: 14000 },
    daily_gift: { rewards: [], titles_ar: [], descs_ar: [] },
};

export function _applyConfigToUI() {
    document.querySelectorAll('[data-tg-channel]').forEach(el => {
        el.href = APP_CONFIG.telegram.channel_url;
    });
    document.querySelectorAll('.referral-reward-badge').forEach(el => {
        el.textContent = '+' + (APP_CONFIG.rewards.referral||100).toLocaleString('en-US');
    });
    document.querySelectorAll('.tg-task-reward-badge').forEach(el => {
        el.textContent = '+' + (APP_CONFIG.rewards.telegram_task||200).toLocaleString('en-US');
    });
    document.querySelectorAll('.daily-ads10-reward-badge').forEach(el => {
        el.textContent = '+' + (APP_CONFIG.rewards.daily_ads_10||200).toLocaleString('en-US');
    });
    document.querySelectorAll('.daily-ads25-reward-badge').forEach(el => {
        el.textContent = '+' + (APP_CONFIG.rewards.daily_ads_25||300).toLocaleString('en-US');
    });
    document.querySelectorAll('.daily-refs3-reward-badge').forEach(el => {
        el.textContent = '+' + (APP_CONFIG.rewards.daily_referrals_3||3000).toLocaleString('en-US');
    });
    document.querySelectorAll('.inv-referral-pts-badge').forEach(el => {
        const pts = APP_CONFIG.rewards.referral || 100;
        // الـ chip في صفحة earn يبدأ بـ + ، الـ pill في invite يحتوي على "نقطة"
        if (el.textContent.startsWith('+')) {
            el.textContent = '+' + pts.toLocaleString('en-US');
        } else {
            el.textContent = pts.toLocaleString('en-US') + ' نقطة';
        }
    });
    // ── قيم جوائز الإعلانات الديناميكية ──
    const adsgramPts = APP_CONFIG.rewards?.points_per_ad || 60;
    document.querySelectorAll('.earn-cta-rnum').forEach(el => { el.textContent = adsgramPts; });
    if (APP_CONFIG.taddy_ads?.points_per_ad) {
        const taddyPts = APP_CONFIG.taddy_ads.points_per_ad;
        const taddyBadge = document.getElementById('taddy-pts-val');
        if (taddyBadge) taddyBadge.textContent = taddyPts;
    }
    if (APP_CONFIG.taddy_ads) {
        if (APP_CONFIG.taddy_ads.daily_limit) {
            const tEl = document.getElementById('taddy-total');
            if (tEl) tEl.textContent = APP_CONFIG.taddy_ads.daily_limit;
        }
    }
}

// ══════════════════════════════════════════════════════════
// NONCE — يُطلب من السيرفر قبل كل ريكوست يحتاجه
// ══════════════════════════════════════════════════════════
export function _genNonce() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2,'0')).join('') + '_' + Date.now();
}

// طلب nonce من السيرفر (مسجّل في جدول nonces) بدلاً من توليده محلياً
async function _getServerNonce(action) {
    try {
        const fpStr    = await _buildFingerprint();
        const initData = window?.Telegram?.WebApp?.initData || '';
        const headers  = { 'Content-Type':'application/json', 'X-Fingerprint': fpStr };
        if (initData)   headers['X-Init-Data']  = initData;
        if (_sessionId) headers['X-Session-Id'] = _sessionId;
        const res  = await fetch(API_BASE, {
            method: 'POST', headers, credentials: 'include',
            body: JSON.stringify({ type: 'get_nonce', data: { action } }),
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json.ok ? json.nonce : null;
    } catch (e) {
        console.warn('[ZT] get_nonce failed:', e.message);
        return null;
    }
}

// هذه الـ actions لا تحتاج nonce (polling / session / tracking فقط)
const SKIP_NONCE = new Set([
    'create_session', 'get_state', 'load',
    'track_ad_event', 'get_channels', 'get_referrals', 'check_channel_membership',
    'start_adsgram_task', // السيرفر لا يتحقق من nonce لهذا الـ action
]);

// ══════════════════════════════════════════════════════════
// SECURITY WALL
// ══════════════════════════════════════════════════════════
function _genIncidentId() {
    const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = 'INC-';
    for (let i = 0; i < 12; i++) {
        if (i === 4 || i === 8) id += '-';
        id += ch[Math.floor(Math.random() * ch.length)];
    }
    return id;
}

export function showSecurityWall() {
    const lp = document.getElementById('loading-page');
    if (lp) lp.remove();
    document.body.style.pointerEvents = 'none';
    document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;
            background:radial-gradient(ellipse at 50% 30%,rgba(239,68,68,0.08) 0%,#0a0a1a 65%);
            flex-direction:column;gap:0;padding:32px 24px;text-align:center;font-family:'Tajawal',sans-serif;">
            <div style="margin-bottom:28px;">
                <img src="asesst/baned.gif" alt=""
                     style="width:140px;height:140px;object-fit:contain;filter:drop-shadow(0 0 32px rgba(239,68,68,0.4));"/>
            </div>
            <div style="color:#f87171;font-size:22px;font-weight:800;margin-bottom:10px;
                text-shadow:0 0 24px rgba(248,113,113,0.4);">تم حظر هذا الحساب</div>
            <div style="color:rgba(255,255,255,0.38);font-size:13px;line-height:1.6;max-width:260px;margin-bottom:28px;">
                تم رصد نشاط مخالف لسياسة الاستخدام.<br>لا يمكن المتابعة من هذا الحساب.
            </div>
            <div style="width:180px;height:1px;background:rgba(255,255,255,0.07);margin-bottom:20px;"></div>
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
                border-radius:10px;padding:10px 20px;display:inline-flex;flex-direction:column;gap:4px;">
                <span style="color:rgba(255,255,255,0.25);font-size:10px;letter-spacing:1px;text-transform:uppercase;">Incident ID</span>
                <span style="color:rgba(255,255,255,0.45);font-size:12px;font-family:monospace;letter-spacing:1px;">${_genIncidentId()}</span>
            </div>
            <div style="color:rgba(255,255,255,0.2);font-size:11px;margin-top:14px;">
                ${new Date().toISOString().replace('T',' ').slice(0,19)} UTC
            </div>
        </div>`;
}

// ══════════════════════════════════════════════════════════
// FINGERPRINT
// ══════════════════════════════════════════════════════════
let _fpCache = null;

export async function _buildFingerprint() {
    if (_fpCache) return _fpCache;

    let canvasHash = '';
    try {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        ctx.textBaseline = 'top'; ctx.font = '14px Arial';
        ctx.fillStyle = '#f60'; ctx.fillRect(125,1,62,20);
        ctx.fillStyle = '#069'; ctx.fillText('Cwm fjordbank glyphs vext quiz',2,15);
        ctx.fillStyle = 'rgba(102,204,0,0.7)'; ctx.fillText('Cwm fjordbank glyphs vext quiz',4,17);
        canvasHash = c.toDataURL().slice(-40);
    } catch (_) { canvasHash = 'canvas_blocked'; }

    let webglInfo = '';
    try {
        const gl = document.createElement('canvas').getContext('webgl');
        if (gl) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            webglInfo = ext
                ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)+'|'+gl.getParameter(ext.UNMASKED_VENDOR_WEBGL))
                : gl.getParameter(gl.RENDERER);
        }
    } catch (_) { webglInfo = 'webgl_blocked'; }

    let audioHash = '';
    try {
        const ac = new (window.AudioContext||window.webkitAudioContext)({ sampleRate:44100 });
        const osc = ac.createOscillator(); const an = ac.createAnalyser();
        const gain = ac.createGain(); gain.gain.value = 0;
        osc.connect(an); an.connect(gain); gain.connect(ac.destination);
        osc.start(0);
        const buf = new Float32Array(an.frequencyBinCount);
        an.getFloatFrequencyData(buf); osc.stop(); await ac.close();
        audioHash = buf.slice(0,8).reduce((s,v) => s+Math.abs(v).toFixed(2), '');
    } catch (_) { audioHash = 'audio_blocked'; }

    const hw       = [navigator.hardwareConcurrency||0, navigator.deviceMemory||0].join('x');
    const platform = [navigator.userAgent||'', navigator.language||'',
                      `${screen.width}x${screen.height}x${screen.colorDepth}`,
                      new Date().getTimezoneOffset(),
                      Intl.DateTimeFormat().resolvedOptions().timeZone||''].join('|');

    const raw = [canvasHash, webglInfo, audioHash, hw, platform].join('§');
    let h1 = 5381, h2 = 52711;
    for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        h1 = (Math.imul(h1,31)^c)>>>0;
        h2 = (Math.imul(h2,33)^c)>>>0;
    }
    const fpHash = (h1>>>0).toString(16).padStart(8,'0') + (h2>>>0).toString(16).padStart(8,'0');

    _fpCache = JSON.stringify({
        fp:         fpHash,
        user_agent: navigator.userAgent        || '',
        lang:       navigator.language         || '',
        screen:     `${screen.width}x${screen.height}`,
        tz_offset:  new Date().getTimezoneOffset(),
        hw_cores:   navigator.hardwareConcurrency || 0,
        hw_mem:     navigator.deviceMemory        || 0,
        touch_pts:  navigator.maxTouchPoints      || 0,
        tz_name:    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        canvas_sig: canvasHash,
        webgl_sig:  webglInfo.slice(0,60),
        audio_sig:  audioHash,
        dpr:        (window.devicePixelRatio||1).toFixed(2),
        color_depth: screen.colorDepth || 0,
    });
    return _fpCache;
}

// ══════════════════════════════════════════════════════════
// SESSION
// ══════════════════════════════════════════════════════════
let _sessionId      = null;
let _pendingSession = null;

export async function _createSession() {
    if (_pendingSession) return _pendingSession;
    _pendingSession = (async () => {
        const tg       = window?.Telegram?.WebApp;
        const initData = tg?.initData || '';
        try {
            const fpStr  = await _buildFingerprint();
            const headers = { 'Content-Type':'application/json', 'X-Fingerprint': fpStr };
            if (initData) headers['X-Init-Data'] = initData;
            const res    = await fetch(API_BASE, {
                method: 'POST', headers, credentials: 'include',
                body: JSON.stringify({ type:'create_session', data:{ initData, fp: JSON.parse(fpStr) } }),
            });
            const result = await res.json();
            if (result.is_banned) { showSecurityWall(); return false; }
            if (result.error === 'account_review') return false;
            if (result.ok && result._session_token) {
                _sessionId = result._session_token;
                if (result.user) {
                    const u = result.user;
                    if (u.points       !== undefined) APP_STATE.balance       = parseInt(u.points)           || 0;
                    if (u.level        !== undefined) APP_STATE.level         = parseInt(u.level)            || 1;
                    if (u.usdt_balance !== undefined) APP_STATE.usdt_balance  = parseFloat(u.usdt_balance)  || 0;
                    if (u.tg_verified  !== undefined) APP_STATE.tasks.tgVerified = !!u.tg_verified;
                    if (u.streak_day  !== undefined) APP_STATE.dailyGift.dayNumber = Math.max(1,(parseInt(u.streak_day)||0)+1);
                    const today = new Date().toISOString().slice(0,10);
                    if (u.last_gift_date === today) APP_STATE.dailyGift.claimed = true;
                }
                return true;
            }
            return false;
        } catch (e) {
            console.warn('[ZT] Session error:', e.message);
            return false;
        } finally {
            _pendingSession = null;
        }
    })();
    return _pendingSession;
}

// ══════════════════════════════════════════════════════════
// _dbCall — نونس جديد في كل ريكوست مرة وحدة
// ══════════════════════════════════════════════════════════
export async function _dbCall(action, data = {}, externalNonce = null) {
    if (!_sessionId && action !== 'create_session') {
        const ok = await _createSession();
        if (!ok) console.warn('[ZT] No session for:', action);
    }

    try {
        const fpStr    = await _buildFingerprint();
        const initData = window?.Telegram?.WebApp?.initData || '';
        const headers  = { 'Content-Type':'application/json', 'X-Fingerprint': fpStr };
        if (initData)   headers['X-Init-Data']  = initData;
        if (_sessionId) headers['X-Session-Id'] = _sessionId;

        // نونس: إما external (لـ reward_ad) أو مُصدَر من السيرفر لكل ريكوست يحتاجه
        const nonce = externalNonce || (!SKIP_NONCE.has(action) ? await _getServerNonce(action) : null);
        if (nonce) headers['X-Nonce'] = nonce;

        const res  = await fetch(API_BASE, {
            method: 'POST', headers, credentials: 'include',
            body: JSON.stringify({ type: action, data }),
        });

        if (res.status === 401) {
            _sessionId = null;
            const renewed = await _createSession();
            if (renewed) return _dbCall(action, data, externalNonce);
            return { ok:false, error:'auth_failed' };
        }

        const json = await res.json();
        if (json.is_banned === true) showSecurityWall();
        return json;
    } catch (e) {
        console.warn('[ZT]', action, 'failed:', e.message);
        return { ok: false };
    }
}

export async function fetchApi({ type, data = {}, _nonce = null }) {
    return _dbCall(type, data, _nonce);
}
export async function createSession() { return _createSession(); }

// ══════════════════════════════════════════════════════════
// TELEGRAM USER
// ══════════════════════════════════════════════════════════
export const BOT_USERNAME = 'SPINN_TON_Bot';
export const APP_NAME     = 'earn';
export let REFERRAL_LINK  = 'https://t.me/' + BOT_USERNAME + '/' + APP_NAME + '?startapp=ref_0000000000';

export function initTelegramUser() {
    const tg = window?.Telegram?.WebApp;
    if (!tg) { _applyFallbackUser(); applyI18n(); return; }
    tg.ready(); tg.expand();
    const user = tg?.initDataUnsafe?.user;
    if (!user) { _applyFallbackUser(); applyI18n(); return; }

    // ── Language detection ─────────────────────────────
    APP_LANG = _detectLang(user.language_code || '');
    applyI18n();

    const userId    = user.id          ?? null;
    const firstName = user.first_name  ?? '';
    const lastName  = user.last_name   ?? '';
    const username  = user.username    ?? '';
    const photoUrl  = user.photo_url   ?? '';

    const _fallbackName = APP_LANG === 'ru' ? '@пользователь' : (APP_LANG === 'en' ? '@user' : '@مستخدم');
    let displayName = _fallbackName;
    if (username)               displayName = '@' + username;
    else if (firstName||lastName) displayName = [firstName,lastName].filter(Boolean).join(' ');

    if (userId) {
        REFERRAL_LINK = 'https://t.me/' + BOT_USERNAME + '/' + APP_NAME + '?startapp=ref_' + userId;
    }
    _applyUserToUI(displayName, photoUrl, userId);
    _updateReferralLinkUI();
}

function _applyUserToUI(name, photoUrl, userId) {
    const nameEl  = document.getElementById('uc-user-name');
    const photoEl = document.getElementById('uc-user-photo');
    if (nameEl) nameEl.textContent = name || '@مستخدم';
    if (photoEl) {
        if (photoUrl) {
            photoEl.src = photoUrl;
            photoEl.onerror = function() { this.onerror=null; this.src=_fallbackAvatar(name,userId); };
        } else {
            photoEl.src = _fallbackAvatar(name, userId);
        }
    }
}

function _applyFallbackUser() {
    const nameEl  = document.getElementById('uc-user-name');
    const photoEl = document.getElementById('uc-user-photo');
    if (nameEl)  nameEl.textContent = '@مستخدم';
    if (photoEl) photoEl.src = _fallbackAvatar('user', null);
    REFERRAL_LINK = 'https://t.me/' + BOT_USERNAME + '/' + APP_NAME + '?startapp=ref_0000000000';
    _updateReferralLinkUI();
}

function _fallbackAvatar(name, userId) {
    const seed = userId ? String(userId) : (name||'user');
    return 'https://api.dicebear.com/7.x/initials/svg?seed='+encodeURIComponent(seed)
         + '&backgroundColor=1a1a2e,16213e,0f3460&textColor=fbbf24&fontSize=38&fontWeight=700';
}

export function _updateReferralLinkUI() {
    document.querySelectorAll('.referral-link-display').forEach(el => { el.textContent = REFERRAL_LINK; });
    const inp = document.getElementById('referral-link-input');
    if (inp) inp.value = REFERRAL_LINK;
}

window.showSecurityWall = showSecurityWall;

// ══════════════════════════════════════════════════════════
// i18n — نظام الترجمة (AR / EN / RU)
// ══════════════════════════════════════════════════════════

export let APP_LANG = 'ar'; // default

const _TRANSLATIONS = {
    // ── Home ────────────────────────────────────────────
    user_greeting:        { ar: 'مرحباً بعودتك',        en: 'Welcome Back',               ru: 'Добро пожаловать' },
    balance_label:        { ar: 'الرصيد الكلي',          en: 'Total Balance',              ru: 'Общий баланс' },
    pts:                  { ar: 'نقطة',                  en: 'pts',                        ru: 'очков' },
    friends_label:        { ar: 'صديق مدعو',             en: 'Friends Invited',            ru: 'Приглашённых друзей' },
    tasks_done_label:     { ar: 'مهمة منجزة',            en: 'Tasks Done',                 ru: 'Выполнено заданий' },

    // ── Earn ────────────────────────────────────────────
    earn_title:           { ar: 'ال<em>ربح</em>',        en: '<em>Earn</em>',              ru: '<em>Заработок</em>' },
    earn_more:            { ar: 'اكسب أكثر',             en: 'Earn More',                  ru: 'Зарабатывай больше' },
    today:                { ar: 'اليوم',                 en: 'today',                      ru: 'сегодня' },
    watch:                { ar: 'شاهد',                  en: 'Watch',                      ru: 'Смотреть' },
    taddy_done:           { ar: 'أنهيت إعلانات اليوم ✓', en: 'All ads watched today ✓',    ru: 'Все рекламы просмотрены ✓' },
    all_done_title:       { ar: 'أحسنت! انتهيت من كل الإعلانات', en: 'Great! All ads watched',  ru: 'Отлично! Все рекламы просмотрены' },
    all_done_sub:         { ar: 'عد غداً للحصول على إعلانات جديدة', en: 'Come back tomorrow for new ads', ru: 'Возвращайтесь завтра' },
    earned_today:         { ar: 'مكتسب اليوم',           en: 'Earned Today',               ru: 'Заработано сегодня' },
    ads_watched:          { ar: 'إعلان شوهد',            en: 'Ads Watched',                ru: 'Просмотрено реклам' },
    daily_limit:          { ar: 'الحد اليومي',           en: 'Daily Limit',                ru: 'Дневной лимит' },

    // ── Earn — cards ────────────────────────────────────
    invite_btn_title:     { ar: 'دعوة الأصدقاء',         en: 'Invite Friends',             ru: 'Пригласить друзей' },
    invite_btn_sub:       { ar: 'ادعُ واربح معاً',        en: 'Invite & Earn Together',     ru: 'Приглашай и зарабатывай' },
    gift_title:           { ar: 'مكافأة يومية',          en: 'Daily Reward',               ru: 'Ежедневная награда' },
    gift_sub:             { ar: 'استلم هديتك الآن',       en: 'Claim Your Gift Now',        ru: 'Получи подарок сейчас' },
    daily:                { ar: 'يومي',                  en: 'Daily',                      ru: 'Ежедневно' },
    coming_soon:          { ar: 'قريباً',                 en: 'Coming Soon',                ru: 'Скоро' },
    achievements:         { ar: 'الإنجازات',              en: 'Achievements',               ru: 'Достижения' },
    achievements_sub:     { ar: 'اكسب شارات خاصة',       en: 'Earn Special Badges',        ru: 'Получай значки' },
    soon:                 { ar: 'قريباً',                 en: 'Soon',                       ru: 'Скоро' },
    contests:             { ar: 'المسابقات',              en: 'Contests',                   ru: 'Конкурсы' },
    contests_sub:         { ar: 'تنافس على جوائز كبرى',  en: 'Compete for Big Prizes',     ru: 'Соревнуйся за призы' },

    // ── Tasks ────────────────────────────────────────────
    tasks_hero:           { ar: 'أكمل المهام واجمع مكافآتك اليومية', en: 'Complete tasks & collect your daily rewards', ru: 'Выполняй задания и получай ежедневные награды' },
    our_channel:          { ar: 'قناتنا الرسمية',         en: 'Our Official Channel',       ru: 'Наш официальный канал' },
    exclusive:            { ar: 'حصري',                  en: 'Exclusive',                  ru: 'Эксклюзив' },
    daily_tasks_label:    { ar: 'المهام اليومية',         en: 'Daily Tasks',                ru: 'Ежедневные задания' },
    watch_10_ads:         { ar: 'شاهد 10 إعلانات اليوم', en: 'Watch 10 Ads Today',         ru: 'Посмотри 10 реклам сегодня' },
    watch_25_ads:         { ar: 'شاهد 25 إعلاناً',       en: 'Watch 25 Ads',               ru: 'Посмотри 25 реклам' },

    // ── Invite ───────────────────────────────────────────
    invite_page_title:    { ar: 'دعوة الأصدقاء',         en: 'Invite Friends',             ru: 'Пригласить друзей' },
    invite_hero_title:    { ar: 'ادعُ أصدقاءك واربح',    en: 'Invite Friends & Earn',      ru: 'Приглашай и зарабатывай' },
    invite_hero_sub:      { ar: 'شارك رابطك الخاص واحصل على مكافآت فورية<br>لكل صديق ينضم عبرك',
                            en: 'Share your link & get instant rewards<br>for every friend who joins',
                            ru: 'Поделись ссылкой и получай мгновенные награды<br>за каждого приглашённого' },
    your_ref_link:        { ar: 'رابط الإحالة الخاص بك', en: 'Your Referral Link',         ru: 'Ваша реферальная ссылка' },
    total_referrals:      { ar: 'إجمالي الاحلات النشطه', en: 'Total Active Referrals',     ru: 'Всего активных рефералов' },
    earned_from_refs:     { ar: 'مكتسب من احلات +25% من ربحهم', en: 'Earned from refs +25% of their earnings', ru: 'Заработано с рефералов +25%' },

    // ── Withdraw ─────────────────────────────────────────
    balance_available:    { ar: 'رصيدك المتاح للسحب',    en: 'Available Balance',          ru: 'Доступный баланс' },
    withdraw_methods_title:{ ar: 'طرق السحب',             en: 'Withdrawal Methods',         ru: 'Способы вывода' },
    ton_wallet:           { ar: 'محفظة TON',              en: 'TON Wallet',                 ru: 'TON Кошелёк' },
    min_label:            { ar: 'الحد الأدنى',            en: 'Minimum',                    ru: 'Минимум' },
    available_badge:      { ar: 'متاح',                  en: 'Available',                  ru: 'Доступно' },
    paypal_name:          { ar: 'باي بال',               en: 'PayPal',                     ru: 'PayPal' },
    fawry_name:           { ar: 'فوري باي',              en: 'Fawry Pay',                  ru: 'Fawry Pay' },
    withdraw_history_title:{ ar: 'سجل السحوبات',          en: 'Withdrawal History',         ru: 'История выводов' },
    no_transactions:      { ar: 'لا توجد سحوبات سابقة',  en: 'No Previous Withdrawals',    ru: 'Нет предыдущих выводов' },

    // ── Nav ──────────────────────────────────────────────
    nav_home:             { ar: 'الرئيسية',              en: 'Home',                       ru: 'Главная' },
    nav_tasks:            { ar: 'المهام',                en: 'Tasks',                      ru: 'Задания' },
    nav_earn:             { ar: 'الربح',                 en: 'Earn',                       ru: 'Заработать' },
    nav_withdraw:         { ar: 'السحب',                 en: 'Withdraw',                   ru: 'Вывод' },

    // ── Gift overlay ──────────────────────────────────────
    gift_preparing:       { ar: 'جاري تحضير هديتك...',  en: 'Preparing your gift...',     ru: 'Подготовка подарка...' },
    gift_claim_btn:       { ar: 'استلم هديتك',           en: 'Claim Gift',                 ru: 'Получить' },
};

// ── Helper: get translated string ──────────────────────────
export function _T(key) {
    const map = _TRANSLATIONS[key];
    if (!map) return key;
    return map[APP_LANG] ?? map['ar'] ?? key;
}
// expose globally for JS-generated HTML
window._T = _T;

// ── Detect language from Telegram user ────────────────────
function _detectLang(langCode) {
    if (!langCode) return 'ar';
    const code = langCode.toLowerCase().split('-')[0]; // 'ar-SA' → 'ar'
    if (code === 'ar') return 'ar';
    if (code === 'ru') return 'ru';
    return 'en';
}

// ── Apply translations to all [data-i18n] elements ─────────
export function applyI18n() {
    const lang = APP_LANG;
    const isRTL = (lang === 'ar');

    // Update <html> dir and lang
    document.documentElement.lang = lang;
    document.documentElement.dir  = isRTL ? 'rtl' : 'ltr';

    // Apply body font for non-Arabic
    if (!isRTL) {
        document.body.style.fontFamily = "'Readex Pro', sans-serif";
    }

    // Translate all marked elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const map = _TRANSLATIONS[key];
        if (!map) return;
        const text = map[lang] ?? map['ar'] ?? '';
        // earn_title and invite_hero_sub use innerHTML (contain HTML tags)
        if (key === 'earn_title' || key === 'invite_hero_sub') {
            el.innerHTML = text;
        } else {
            el.textContent = text;
        }
    });
}

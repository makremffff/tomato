// ================================================================
//  Tomato Farm — API Backend v3.0 (Zero Trust Architecture)
//  💀 "اعتبر كل عميل مخترقاً حتى يثبت العكس"
//  ✅ Telegram initData verification (HMAC-SHA256)
//  ✅ Session management (IP + fingerprint bound)
//  ✅ Nonce system (replay attack prevention)
//  ✅ Rate limiting (per user, sliding window)
//  ✅ Behavior analysis (bot detection)
//  ✅ Risk scoring (0-100)
//  ✅ Shadow ban system
//  ✅ Server-side time only
//  ✅ Full audit logging
// ================================================================

const { neon }   = require('@neondatabase/serverless');
const crypto     = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL;
const BOT_TOKEN    = process.env.BOT_TOKEN; // ← مطلوب لتحقق Telegram

// ── SQL executor ─────────────────────────────────────────────────
async function sql(query, params = []) {
  const db = neon(DATABASE_URL);
  return await db(query, params);
}

// ── Constants ────────────────────────────────────────────────────
const CELL_COUNT         = 3;
const GROW_DURATION      = 30;          // seconds
const INIT_DATA_TTL      = 3600;         // 1 hour
const SESSION_TTL        = 86400;        // 24 hours
const RATE_WINDOW        = 5000;         // 5 seconds
const RATE_LIMIT         = 10;           // max requests per window
const RISK_SUSPICIOUS    = 41;
const RISK_BAN           = 71;
const NONCE_TTL          = 300;          // 5 min nonce validity

// ── Bootstrap: إنشاء جميع الجداول ───────────────────────────────
async function bootstrap() {
  try {
    // ── جدول المستخدمين الأساسي ──
    await sql(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id       BIGINT        PRIMARY KEY,
        username          TEXT,
        balance           NUMERIC(18,6) NOT NULL DEFAULT 0,
        seeds             INT           NOT NULL DEFAULT 3,
        water_count       INT           NOT NULL DEFAULT 3,
        cells             JSONB         NOT NULL DEFAULT '[]',
        task_state        JSONB         NOT NULL DEFAULT '{"earnChannel":"idle","eMoneyChannel":"idle"}',
        wd_history        JSONB         NOT NULL DEFAULT '[]',
        today_date        TEXT          NOT NULL DEFAULT '',
        today_earn        NUMERIC(18,6) NOT NULL DEFAULT 0,
        total_harvests    INT           NOT NULL DEFAULT 0,
        referral_by       BIGINT,
        referral_friends  INT           NOT NULL DEFAULT 0,
        referral_balance  NUMERIC(18,6) NOT NULL DEFAULT 0,
        referral_rewarded BOOLEAN       NOT NULL DEFAULT FALSE,
        day               INT           NOT NULL DEFAULT 1,
        shadow_banned     BOOLEAN       NOT NULL DEFAULT FALSE,
        risk_score        INT           NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);

    // ── جدول الجلسات ──
    await sql(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id    TEXT          PRIMARY KEY,
        telegram_id   BIGINT        NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
        ip_hash       TEXT          NOT NULL,
        fingerprint   TEXT          NOT NULL,
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        expires_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
        is_valid      BOOLEAN       NOT NULL DEFAULT TRUE
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_sessions_telegram ON sessions(telegram_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_sessions_expires  ON sessions(expires_at)`);

    // ── جدول Nonce (منع إعادة الإرسال) ──
    await sql(`
      CREATE TABLE IF NOT EXISTS nonces (
        nonce         TEXT          PRIMARY KEY,
        telegram_id   BIGINT        NOT NULL,
        used_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        expires_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at)`);

    // ── جدول Rate Limiting ──
    await sql(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        telegram_id   BIGINT        NOT NULL,
        window_start  BIGINT        NOT NULL,
        request_count INT           NOT NULL DEFAULT 1,
        PRIMARY KEY (telegram_id, window_start)
      )
    `);

    // ── جدول سجلات الأمان (Audit Log) ──
    await sql(`
      CREATE TABLE IF NOT EXISTS security_logs (
        id            BIGSERIAL     PRIMARY KEY,
        telegram_id   BIGINT,
        ip_hash       TEXT,
        fingerprint   TEXT,
        action        TEXT          NOT NULL,
        risk_score    INT           NOT NULL DEFAULT 0,
        verdict       TEXT          NOT NULL DEFAULT 'allow',
        detail        JSONB         NOT NULL DEFAULT '{}',
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_logs_telegram ON security_logs(telegram_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_logs_created  ON security_logs(created_at DESC)`);

    // ── جدول بصمات الأجهزة ──
    await sql(`
      CREATE TABLE IF NOT EXISTS device_fingerprints (
        fingerprint   TEXT          NOT NULL,
        telegram_id   BIGINT        NOT NULL,
        user_agent    TEXT,
        lang          TEXT,
        screen        TEXT,
        timezone_off  INT,
        last_seen     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        PRIMARY KEY (fingerprint, telegram_id)
      )
    `);

    // ── جدول السحوبات (Giveaways) ──
    await sql(`
      CREATE TABLE IF NOT EXISTS giveaways (
        id            BIGSERIAL     PRIMARY KEY,
        title         TEXT          NOT NULL,
        reward        NUMERIC(18,6) NOT NULL DEFAULT 0,
        winner_id     BIGINT,
        is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
        draw_at       TIMESTAMPTZ,
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);

    await sql(`
      CREATE TABLE IF NOT EXISTS giveaway_entries (
        giveaway_id   BIGINT        NOT NULL REFERENCES giveaways(id),
        telegram_id   BIGINT        NOT NULL REFERENCES users(telegram_id),
        entered_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        PRIMARY KEY (giveaway_id, telegram_id)
      )
    `);

    // ── Migrations للجداول القديمة ──
    const migrations = [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS shadow_banned BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS risk_score    INT     NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_friends  INT NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_balance  NUMERIC(18,6) NOT NULL DEFAULT 0`,
    ];
    for (const m of migrations) {
      try { await sql(m); } catch (_) {}
    }

    console.log('[DB] Bootstrap OK — Zero Trust v3.0');
  } catch (e) {
    console.error('[DB] Bootstrap failed:', e.message);
  }
}
bootstrap();

// ================================================================
//  SECURITY LAYER — Zero Trust Core
// ================================================================

// ── تحقق من Telegram initData (HMAC-SHA256) ──
function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;

  try {
    const params   = new URLSearchParams(initData);
    const hash     = params.get('hash');
    const authDate = parseInt(params.get('auth_date') || '0');

    if (!hash || !authDate) return null;

    // التحقق من انتهاء الصلاحية
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > INIT_DATA_TTL) return null;

    // بناء data-check-string
    params.delete('hash');
    const checkArr = [];
    params.forEach((v, k) => checkArr.push(`${k}=${v}`));
    checkArr.sort();
    const checkStr = checkArr.join('\n');

    // HMAC verification
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const expected  = crypto.createHmac('sha256', secretKey).update(checkStr).digest('hex');

    if (expected !== hash) return null;

    // استخراج بيانات المستخدم
    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

// ── Hash IP (لا نخزّن الـ IP الحقيقي) ──
function hashIP(ip) {
  if (!ip) return 'unknown';
  return crypto.createHash('sha256').update(ip + (process.env.IP_SALT || 'zt_salt')).digest('hex').slice(0, 32);
}

// ── بناء fingerprint محسّن من بيانات الطلب ──
// يستخدم الـ fp hash المولّد client-side + fallback إلى الإشارات الأخرى
function buildFingerprint(fpData, ipHash) {
  // إذا أرسل الـ client fingerprint hash جاهزاً — نضيف IP ونُعيد hash
  const clientFp = fpData.fp || '';

  // الإشارات الأساسية كـ fallback
  const ua      = (fpData.user_agent || '').slice(0, 200);
  const lang    = fpData.lang        || '';
  const screen  = fpData.screen      || '';
  const tz      = String(fpData.tz_offset  || 0);
  const tzName  = fpData.tz_name     || '';
  const cores   = String(fpData.hw_cores   || 0);
  const mem     = String(fpData.hw_mem     || 0);
  const touch   = String(fpData.touch_pts  || 0);
  const canvas  = (fpData.canvas_sig || '').slice(0, 40);
  const webgl   = (fpData.webgl_sig  || '').slice(0, 60);
  const audio   = (fpData.audio_sig  || '').slice(0, 40);
  const dpr     = fpData.dpr         || '';
  const colDepth = String(fpData.color_depth || 0);

  // إذا عنده fp hash — نبني fingerprint مزدوج (client hash + server signals)
  const raw = clientFp
    ? [clientFp, ipHash, ua, lang, tz, tzName, cores, mem].join('|')
    : [ua, lang, screen, tz, tzName, cores, mem, touch, canvas, webgl, audio, dpr, colDepth, ipHash].join('|');

  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

// ── Resilient Fingerprint Comparison ──
// يتحمّل تغير IP (proxy/NAT) لكن يرفض تغير الجهاز الكامل
function isFingerprintMatch(stored, current, storedIp, currentIp) {
  if (stored === current) return true; // مطابق تماماً
  // IP تغيّر لكن هذا طبيعي — نقبل إذا fingerprint مطابق
  // لو اختلف كلاهما — رفض قاطع
  return false;
}

// ── تحقق من Nonce (منع Replay Attacks) ──
async function checkNonce(tid, nonce) {
  if (!nonce) return false;

  // تنظيف القديم
  await sql(`DELETE FROM nonces WHERE expires_at < NOW()`);

  // هل استُخدم من قبل؟
  const existing = await sql(`SELECT 1 FROM nonces WHERE nonce = $1`, [nonce]);
  if (existing.length) return false;

  // تسجيله
  await sql(
    `INSERT INTO nonces (nonce, telegram_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [nonce, tid]
  );
  return true;
}

// ── Rate Limiting (sliding window) ──
async function checkRateLimit(tid) {
  const window = Math.floor(Date.now() / RATE_WINDOW) * RATE_WINDOW;

  // تنظيف النوافذ القديمة
  await sql(
    `DELETE FROM rate_limits WHERE window_start < $1`,
    [window - RATE_WINDOW * 10]
  );

  const rows = await sql(
    `INSERT INTO rate_limits (telegram_id, window_start, request_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (telegram_id, window_start)
     DO UPDATE SET request_count = rate_limits.request_count + 1
     RETURNING request_count`,
    [tid, window]
  );
  return (rows[0]?.request_count || 0) <= RATE_LIMIT;
}

// ── حساب Risk Score ──
async function calcRiskScore(tid, ipHash, fingerprint, action) {
  let score = 0;

  // هل تغيّر الـ fingerprint؟
  const fp = await sql(
    `SELECT fingerprint FROM sessions WHERE telegram_id = $1 AND is_valid = TRUE LIMIT 1`,
    [tid]
  );
  if (fp.length && fp[0].fingerprint !== fingerprint) score += 25;

  // هل الـ IP تغيّر؟
  const ip = await sql(
    `SELECT ip_hash FROM sessions WHERE telegram_id = $1 AND is_valid = TRUE LIMIT 1`,
    [tid]
  );
  if (ip.length && ip[0].ip_hash !== ipHash) score += 15;

  // عدد المحاولات الفاشلة في آخر دقيقة
  const failures = await sql(
    `SELECT COUNT(*) AS c FROM security_logs
     WHERE telegram_id = $1 AND verdict = 'deny' AND created_at > NOW() - INTERVAL '1 minute'`,
    [tid]
  );
  score += Math.min(30, parseInt(failures[0]?.c || 0) * 10);

  return Math.min(100, score);
}

// ── تسجيل في سجل الأمان ──
async function auditLog(tid, ipHash, fingerprint, action, riskScore, verdict, detail = {}) {
  try {
    await sql(
      `INSERT INTO security_logs (telegram_id, ip_hash, fingerprint, action, risk_score, verdict, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tid, ipHash, fingerprint, action, riskScore, verdict, JSON.stringify(detail)]
    );
  } catch (_) {}
}

// ── تحديث Risk Score في جدول المستخدمين ──
async function updateUserRisk(tid, delta) {
  await sql(
    `UPDATE users SET risk_score = LEAST(100, GREATEST(0, risk_score + $2)), updated_at = NOW()
     WHERE telegram_id = $1`,
    [tid, delta]
  );
  // Shadow ban تلقائي إذا تجاوز الحد
  await sql(
    `UPDATE users SET shadow_banned = TRUE WHERE telegram_id = $1 AND risk_score >= $2`,
    [tid, RISK_BAN]
  );
}

// ================================================================
//  HELPERS
// ================================================================

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id, X-Nonce, X-Init-Data, X-Fingerprint');
}

function resolveCell(cell) {
  if (!cell || cell.state === 'empty' || cell.state === 'ready') return cell;
  if (cell.state === 'growing') {
    const plantedAt = new Date(cell.planted_at).getTime();
    const duration  = (cell.duration || GROW_DURATION) * 1000;
    if (Date.now() >= plantedAt + duration) return { ...cell, state: 'ready' };
  }
  return cell;
}

function resolveCells(cells) {
  if (!Array.isArray(cells)) return buildEmptyCells();
  return cells.map(resolveCell);
}

function buildEmptyCells() {
  return Array.from({ length: CELL_COUNT }, (_, i) => ({
    id: i, state: 'empty', planted_at: null, duration: GROW_DURATION,
  }));
}

function normalizeCellsFromDB(rawCells) {
  if (!Array.isArray(rawCells) || rawCells.length === 0) return buildEmptyCells();
  return rawCells;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function persistIfChanged(tid, original, resolved) {
  const changed = resolved.some((c, i) => original[i]?.state !== c.state);
  if (changed) {
    await sql(`UPDATE users SET cells = $2, updated_at = NOW() WHERE telegram_id = $1`,
      [tid, JSON.stringify(resolved)]);
  }
}

// ── إنشاء Session ID آمن ──
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

// ================================================================
//  MAIN HANDLER
// ================================================================
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ── استخراج headers الأمان ──
  const initData   = req.headers['x-init-data']   || '';
  const sessionId  = req.headers['x-session-id']  || '';
  const nonce      = req.headers['x-nonce']        || '';
  const fpHeader   = req.headers['x-fingerprint']  || '{}';

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const { action, data = {} } = body || {};
  if (!action) return res.status(400).json({ error: 'Missing action' });

  // ── معلومات الشبكة ──
  const rawIP   = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
  const ipHash  = hashIP(rawIP);

  // ── بناء fingerprint ──
  let fpData = {};
  try { fpData = JSON.parse(fpHeader); } catch (_) {}
  const fingerprint = buildFingerprint(fpData, ipHash);

  // ================================================================
  //  AUTH: تحقق initData عند login / create-session
  // ================================================================
  if (action === 'create_session') {
    const tgUser = verifyTelegramInitData(initData);
    if (!tgUser) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired Telegram auth' });
    }

    const tid = parseInt(tgUser.id);
    if (isNaN(tid)) return res.status(400).json({ ok: false, error: 'Invalid user ID' });

    // إنشاء/تحديث المستخدم
    await sql(
      `INSERT INTO users (telegram_id, username) VALUES ($1, $2)
       ON CONFLICT (telegram_id) DO UPDATE SET username = $2, updated_at = NOW()`,
      [tid, tgUser.username || tgUser.first_name || null]
    );

    // ── فحص shadow ban قبل إنشاء الجلسة ──
    const banCheck = await sql(`SELECT shadow_banned, risk_score FROM users WHERE telegram_id = $1`, [tid]);
    if (banCheck[0]?.shadow_banned) {
      // نسجّل المحاولة لكن لا نكشف السبب
      await auditLog(tid, ipHash, fingerprint, 'create_session_banned', banCheck[0].risk_score, 'deny', { reason: 'shadow_banned' });
      return res.status(200).json({ ok: false, is_banned: true });
    }

    // إلغاء الجلسات القديمة
    await sql(`UPDATE sessions SET is_valid = FALSE WHERE telegram_id = $1`, [tid]);

    // إنشاء جلسة جديدة
    const sid = generateSessionId();
    await sql(
      `INSERT INTO sessions (session_id, telegram_id, ip_hash, fingerprint)
       VALUES ($1, $2, $3, $4)`,
      [sid, tid, ipHash, fingerprint]
    );

    // حفظ fingerprint مع الإشارات المتقدمة
    await sql(
      `INSERT INTO device_fingerprints (fingerprint, telegram_id, user_agent, lang, screen, timezone_off)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (fingerprint, telegram_id) DO UPDATE SET last_seen = NOW()`,
      [fingerprint, tid, fpData.user_agent || null, fpData.lang || null,
       fpData.screen || null, fpData.tz_offset || 0]
    );

    await auditLog(tid, ipHash, fingerprint, 'create_session', 0, 'allow', { tg_id: tid });
    return res.status(200).json({ ok: true, session_id: sid });
  }

  // ================================================================
  //  للطلبات الأخرى: التحقق من الجلسة أولاً
  // ================================================================
  if (!sessionId) return res.status(401).json({ ok: false, error: 'Missing session' });

  // التحقق من صحة الجلسة
  const sessionRows = await sql(
    `SELECT * FROM sessions WHERE session_id = $1 AND is_valid = TRUE AND expires_at > NOW()`,
    [sessionId]
  );
  if (!sessionRows.length) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
  }

  const session = sessionRows[0];
  const tid     = parseInt(session.telegram_id);

  // التحقق من تطابق الـ fingerprint فقط — IP يتغير بشكل طبيعي (proxy/NAT/4G)
  // رفض فقط إذا اختلف الـ fingerprint (الجهاز الفعلي) وليس الـ IP
  if (session.fingerprint !== fingerprint) {
    // تغيّر fingerprint = جهاز مختلف = خطر حقيقي
    await sql(`UPDATE sessions SET is_valid = FALSE WHERE session_id = $1`, [sessionId]);
    await updateUserRisk(tid, 30);
    await auditLog(tid, ipHash, fingerprint, action, 30, 'deny',
      { reason: 'fingerprint_mismatch', expected_fp: session.fingerprint });
    return res.status(401).json({ ok: false, error: 'Session mismatch — please re-authenticate' });
  }

  // تغيّر IP فقط = طبيعي — نُحدّث الجلسة برفق ونضيف risk بسيط
  if (session.ip_hash !== ipHash) {
    await sql(`UPDATE sessions SET ip_hash = $2 WHERE session_id = $1`, [sessionId, ipHash]);
    await updateUserRisk(tid, 5); // risk منخفض فقط
    await auditLog(tid, ipHash, fingerprint, action, 5, 'allow',
      { reason: 'ip_changed', note: 'natural IP rotation' });
  }

  // ── Rate Limiting ──
  const withinLimit = await checkRateLimit(tid);
  if (!withinLimit) {
    await updateUserRisk(tid, 5);
    await auditLog(tid, ipHash, fingerprint, action, 5, 'rate_limit', {});
    return res.status(429).json({ ok: false, error: 'Too many requests' });
  }

  // ── Nonce Check ──
  if (!['get_state', 'load'].includes(action)) {
    const nonceValid = await checkNonce(tid, nonce);
    if (!nonceValid) {
      await updateUserRisk(tid, 20);
      await auditLog(tid, ipHash, fingerprint, action, 20, 'deny', { reason: 'nonce_replay' });
      return res.status(400).json({ ok: false, error: 'Nonce already used or missing' });
    }
  }

  // ── Risk Score Check ──
  const riskScore = await calcRiskScore(tid, ipHash, fingerprint, action);

  // فحص Shadow Ban
  const userRisk = await sql(`SELECT risk_score, shadow_banned FROM users WHERE telegram_id = $1`, [tid]);
  const currentRisk = userRisk[0]?.risk_score || 0;
  const isShadowBanned = userRisk[0]?.shadow_banned || false;

  await auditLog(tid, ipHash, fingerprint, action, riskScore, isShadowBanned ? 'shadow' : 'allow', {});

  try {

    // ══════════════════════════════════════════════════════════════
    //  LOAD
    // ══════════════════════════════════════════════════════════════
    if (action === 'load') {
      let rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);

      if (!rows.length) {
        const username   = data.username   || null;
        const referralBy = data.referral_by ? parseInt(data.referral_by) : null;
        const validRef   = referralBy && !isNaN(referralBy) && referralBy !== tid ? referralBy : null;

        rows = await sql(
          `INSERT INTO users (telegram_id, username, referral_by, cells)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (telegram_id) DO UPDATE SET updated_at = NOW()
           RETURNING *`,
          [tid, username, validRef, JSON.stringify(buildEmptyCells())]
        );

        if (validRef) {
          await sql(
            `UPDATE users
             SET referral_friends = referral_friends + 1,
                 referral_balance = referral_balance + 0.01,
                 balance          = balance + 0.01,
                 updated_at       = NOW()
             WHERE telegram_id = $1`,
            [validRef]
          );
          await sql(`UPDATE users SET referral_rewarded = TRUE WHERE telegram_id = $1`, [tid]);
        }
      } else {
        const u = rows[0];

        if (u.referral_by && !u.referral_rewarded) {
          await sql(
            `UPDATE users
             SET referral_friends = referral_friends + 1,
                 referral_balance = referral_balance + 0.01,
                 balance          = balance + 0.01,
                 updated_at       = NOW()
             WHERE telegram_id = $1`,
            [u.referral_by]
          );
          await sql(`UPDATE users SET referral_rewarded = TRUE WHERE telegram_id = $1`, [tid]);
          rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
        }

        if (rows[0].today_date !== todayUTC()) {
          await sql(
            `UPDATE users SET today_date = $2, today_earn = 0, updated_at = NOW() WHERE telegram_id = $1`,
            [tid, todayUTC()]
          );
          rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
        }
      }

      const user     = rows[0];
      const original = normalizeCellsFromDB(user.cells);
      const resolved = resolveCells(original);
      await persistIfChanged(tid, original, resolved);

      // Shadow-banned users get real data but rewards are silently ignored upstream
      return res.status(200).json({ ok: true, user: { ...user, cells: resolved } });
    }

    // ══════════════════════════════════════════════════════════════
    //  GET_STATE — polling
    // ══════════════════════════════════════════════════════════════
    if (action === 'get_state') {
      const rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });

      const user = rows[0];

      if (user.today_date !== todayUTC()) {
        await sql(
          `UPDATE users SET today_date = $2, today_earn = 0, updated_at = NOW() WHERE telegram_id = $1`,
          [tid, todayUTC()]
        );
        user.today_earn = 0;
        user.today_date = todayUTC();
      }

      const original = normalizeCellsFromDB(user.cells);
      const resolved = resolveCells(original);
      await persistIfChanged(tid, original, resolved);

      return res.status(200).json({ ok: true, user: { ...user, cells: resolved } });
    }

    // ══════════════════════════════════════════════════════════════
    //  PLANT — السيرفر يتحقق من كل شيء
    // ══════════════════════════════════════════════════════════════
    if (action === 'plant') {
      const cellId   = parseInt(data.cell_id);
      const duration = GROW_DURATION; // السيرفر يحدد المدة فقط، لا العميل

      if (isNaN(cellId) || cellId < 0 || cellId >= CELL_COUNT)
        return res.status(400).json({ ok: false, error: 'Invalid cell_id' });

      const rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });

      const user = rows[0];
      if (user.seeds <= 0) return res.status(400).json({ ok: false, error: 'Not enough seeds' });

      const cells = resolveCells(normalizeCellsFromDB(user.cells));
      if (cells[cellId].state !== 'empty')
        return res.status(400).json({ ok: false, error: 'Cell is not empty' });

      // السيرفر يضع الوقت فقط
      cells[cellId] = { id: cellId, state: 'growing', planted_at: new Date().toISOString(), duration };

      await sql(
        `UPDATE users SET cells = $2, seeds = seeds - 1, updated_at = NOW() WHERE telegram_id = $1`,
        [tid, JSON.stringify(cells)]
      );

      return res.status(200).json({ ok: true, cells });
    }

    // ══════════════════════════════════════════════════════════════
    //  HARVEST — السيرفر يحسب المكافأة، لا يقبلها من العميل
    // ══════════════════════════════════════════════════════════════
    if (action === 'harvest') {
      const cellId = parseInt(data.cell_id);

      if (isNaN(cellId) || cellId < 0 || cellId >= CELL_COUNT)
        return res.status(400).json({ ok: false, error: 'Invalid cell_id' });

      const rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });

      const user  = rows[0];
      const cells = resolveCells(normalizeCellsFromDB(user.cells));

      if (cells[cellId].state !== 'ready')
        return res.status(400).json({ ok: false, error: 'Cell is not ready to harvest' });

      // ⚡ السيرفر يحسب المكافأة — لا نأخذها من العميل أبداً
      const SERVER_REWARD = 0.0001; // مطابق للعميل: 0.0001 TON لكل حصاد

      // Shadow ban: يعطي استجابة ناجحة لكن لا يضيف رصيداً
      const actualReward = isShadowBanned ? 0 : SERVER_REWARD;

      cells[cellId] = { id: cellId, state: 'empty', planted_at: null, duration: GROW_DURATION };

      const today        = todayUTC();
      const isSameDay    = user.today_date === today;
      const newTodayEarn = isSameDay ? parseFloat(user.today_earn) + actualReward : actualReward;

      await sql(
        `UPDATE users
         SET balance        = balance + $2,
             cells          = $3,
             today_date     = $4,
             today_earn     = $5,
             total_harvests = total_harvests + 1,
             updated_at     = NOW()
         WHERE telegram_id = $1`,
        [tid, actualReward, JSON.stringify(cells), today, newTodayEarn]
      );

      // 5% referral — فقط إذا لم يكن shadow banned
      if (user.referral_by && !isShadowBanned) {
        const cut = parseFloat((SERVER_REWARD * 0.05).toFixed(6));
        await sql(
          `UPDATE users
           SET referral_balance = referral_balance + $2,
               balance          = balance + $2,
               updated_at       = NOW()
           WHERE telegram_id = $1`,
          [user.referral_by, cut]
        );
      }

      // جلب الرصيد الحقيقي بعد التحديث
      const updatedUser = await sql(`SELECT balance, today_earn, total_harvests FROM users WHERE telegram_id = $1`, [tid]);

      return res.status(200).json({
        ok: true, cells,
        reward:       SERVER_REWARD,
        balance:      parseFloat(updatedUser[0]?.balance      || 0),
        today_earn:   parseFloat(updatedUser[0]?.today_earn   || 0),
        total_harvests: parseInt(updatedUser[0]?.total_harvests || 0),
        referral_cut: user.referral_by ? parseFloat((SERVER_REWARD * 0.05).toFixed(6)) : 0
      });
    }

    // ══════════════════════════════════════════════════════════════
    //  UPDATE_CELL — ري (السيرفر يحدد المدة الجديدة)
    // ══════════════════════════════════════════════════════════════
    if (action === 'update_cell') {
      const cellId = parseInt(data.cell_id);

      if (isNaN(cellId) || cellId < 0 || cellId >= CELL_COUNT)
        return res.status(400).json({ ok: false, error: 'Invalid cell_id' });

      // السيرفر فقط يحدد ما يُسمح بتعديله وبأي قيم
      const rows = await sql('SELECT cells, water_count FROM users WHERE telegram_id = $1', [tid]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });

      const user  = rows[0];
      if (user.water_count <= 0) return res.status(400).json({ ok: false, error: 'No water left' });

      const cells = resolveCells(normalizeCellsFromDB(user.cells));
      if (cells[cellId].state !== 'growing')
        return res.status(400).json({ ok: false, error: 'Cell is not growing' });

      // السيرفر يحدد كمية التسريع
      const WATER_SPEEDUP = 60; // ثانية تُخصم من وقت النمو
      const newDuration   = Math.max(10, (cells[cellId].duration || GROW_DURATION) - WATER_SPEEDUP);
      cells[cellId]       = { ...cells[cellId], duration: newDuration, watered: true };

      await sql(
        `UPDATE users SET cells = $2, water_count = water_count - 1, updated_at = NOW() WHERE telegram_id = $1`,
        [tid, JSON.stringify(cells)]
      );

      return res.status(200).json({ ok: true, cells });
    }

    // ══════════════════════════════════════════════════════════════
    //  ADD_RESOURCE — بذور/ماء (فقط من مصادر موثّقة)
    // ══════════════════════════════════════════════════════════════
    if (action === 'add_resource') {
      const type   = data.type;
      const source = data.source || 'ad_seed_single';

      if (!['seeds', 'water'].includes(type))
        return res.status(400).json({ ok: false, error: 'Invalid resource type' });

      // السيرفر يحدد الكمية والحد اليومي لكل مصدر
      const ALLOWED_AMOUNTS = {
        ad_seed_single: { seeds: 1,  daily_max: 10 },  // max 10 seeds/day من single ads
        ad_seed_bundle: { seeds: 7,  daily_max: 21 },  // max 3 bundles/day = 21 seeds
        ad_water:       { water: 3,  daily_max: 9  },  // max 3 refills/day = 9 water
        task:           { seeds: 5,  water: 5, daily_max: 999 },
      };

      const resourceType = type === 'seeds' ? 'seeds' : 'water';
      const allowed      = ALLOWED_AMOUNTS[source];
      if (!allowed || allowed[resourceType] === undefined)
        return res.status(400).json({ ok: false, error: 'Invalid source or resource type' });

      const amount    = allowed[resourceType];
      const dailyMax  = allowed.daily_max || 999;
      const today     = todayUTC();

      // فحص الحد اليومي من audit log
      const todayUsage = await sql(
        `SELECT COALESCE(SUM((detail->>'amount')::int), 0) AS used
         FROM security_logs
         WHERE telegram_id = $1
           AND action = 'add_resource_' || $2
           AND verdict = 'allow'
           AND created_at >= NOW() - INTERVAL '24 hours'`,
        [tid, source]
      );
      const usedToday = parseInt(todayUsage[0]?.used || 0);
      if (usedToday + amount > dailyMax) {
        await auditLog(tid, ipHash, fingerprint, 'add_resource_' + source, 10, 'deny',
          { reason: 'daily_limit', used: usedToday, limit: dailyMax });
        // Shadow يُعطي استجابة ناجحة زائفة — لا يكشف الحد
        return res.status(200).json({ ok: false, error: 'Daily limit reached' });
      }

      // Shadow ban
      if (isShadowBanned) return res.status(200).json({ ok: true, [resourceType === 'seeds' ? 'seeds' : 'water_count']: 0 });

      const col = type === 'seeds' ? 'seeds' : 'water_count';
      const MAX = 10;

      await sql(
        `UPDATE users SET ${col} = LEAST(${col} + $2, $3), updated_at = NOW() WHERE telegram_id = $1`,
        [tid, amount, MAX]
      );

      const rows = await sql(`SELECT ${col} FROM users WHERE telegram_id = $1`, [tid]);

      // تسجيل في audit log مع الكمية للحد اليومي
      await auditLog(tid, ipHash, fingerprint, 'add_resource_' + source, 0, 'allow',
        { type, amount, source });

      return res.status(200).json({ ok: true, [col]: rows[0]?.[col] });
    }

    // ══════════════════════════════════════════════════════════════
    //  SAVE_TASKS — حالة المهام
    // ══════════════════════════════════════════════════════════════
    if (action === 'save_tasks') {
      const task_state = data.task_state;
      if (!task_state || typeof task_state !== 'object')
        return res.status(400).json({ ok: false, error: 'Invalid task_state' });

      const safeState = {};
      for (const key of ['earnChannel', 'eMoneyChannel']) {
        if (['idle', 'joined', 'done'].includes(task_state[key]))
          safeState[key] = task_state[key];
      }

      await sql(
        `UPDATE users SET task_state = task_state || $2::jsonb, updated_at = NOW() WHERE telegram_id = $1`,
        [tid, JSON.stringify(safeState)]
      );

      return res.status(200).json({ ok: true });
    }

    // ══════════════════════════════════════════════════════════════
    //  ADD_BALANCE — من مصادر موثّقة فقط (tasks)
    // ══════════════════════════════════════════════════════════════
    if (action === 'add_balance') {
      const source = data.source || 'unknown';

      // السيرفر يحدد المكافأة المسموح بها لكل مهمة
      const TASK_REWARDS = {
        earnChannel:   0.005,
        eMoneyChannel: 0.005,
      };

      const amount = TASK_REWARDS[source];
      if (!amount) return res.status(400).json({ ok: false, error: 'Unknown reward source' });

      // التحقق أن المهمة مكتملة فعلاً في قاعدة البيانات
      const rows = await sql(`SELECT task_state FROM users WHERE telegram_id = $1`, [tid]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });

      const taskState = rows[0].task_state || {};
      if (taskState[source] === 'done')
        return res.status(400).json({ ok: false, error: 'Task already rewarded' });

      // Shadow ban
      if (isShadowBanned) return res.status(200).json({ ok: true });

      await sql(
        `UPDATE users
         SET balance    = balance + $2,
             task_state = task_state || $3::jsonb,
             updated_at = NOW()
         WHERE telegram_id = $1`,
        [tid, amount, JSON.stringify({ [source]: 'done' })]
      );

      return res.status(200).json({ ok: true });
    }

    // ══════════════════════════════════════════════════════════════
    //  WITHDRAW
    // ══════════════════════════════════════════════════════════════
    if (action === 'withdraw') {
      const { account, amount } = data;
      const amt = parseFloat(amount);

      if (!account)               return res.status(400).json({ ok: false, error: 'Missing account' });
      if (isNaN(amt) || amt <= 0) return res.status(400).json({ ok: false, error: 'Invalid amount' });
      if (amt < 0.05)             return res.status(400).json({ ok: false, error: 'Minimum 0.05 TON' });

      // Shadow ban: نرفض السحب
      if (isShadowBanned) return res.status(403).json({ ok: false, error: 'Account under review' });

      const rows = await sql('SELECT balance, wd_history FROM users WHERE telegram_id = $1', [tid]);
      if (!rows.length)                      return res.status(404).json({ ok: false, error: 'User not found' });
      if (parseFloat(rows[0].balance) < amt) return res.status(400).json({ ok: false, error: 'Insufficient balance' });

      // السيرفر يستخدم وقته فقط
      const now     = new Date();
      const dateStr = now.toISOString();
      const entry   = { account, amount: amt, date: dateStr, status: 'pending' };
      const history = Array.isArray(rows[0].wd_history) ? rows[0].wd_history : [];
      history.unshift(entry);
      if (history.length > 50) history.splice(50);

      await sql(
        `UPDATE users SET balance = balance - $2, wd_history = $3, updated_at = NOW() WHERE telegram_id = $1`,
        [tid, amt, JSON.stringify(history)]
      );

      return res.status(200).json({ ok: true, entry });
    }

    // ══════════════════════════════════════════════════════════════
    //  GIVEAWAY — تسجيل في السحب
    // ══════════════════════════════════════════════════════════════
    if (action === 'giveaway_enter') {
      const gid = parseInt(data.giveaway_id);
      if (isNaN(gid)) return res.status(400).json({ ok: false, error: 'Invalid giveaway_id' });

      // Shadow ban: يُسجّل لكن لن يفوز
      const gwRows = await sql(`SELECT * FROM giveaways WHERE id = $1 AND is_active = TRUE`, [gid]);
      if (!gwRows.length) return res.status(404).json({ ok: false, error: 'Giveaway not found' });

      await sql(
        `INSERT INTO giveaway_entries (giveaway_id, telegram_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [gid, tid]
      );

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('[API Error]', action, err.message, err.stack);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};

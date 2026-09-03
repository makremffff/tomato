// ══════════════════════════════════════════════════════════════════════════════
//  api/index.js  —  USDT Claim Page · Vercel Serverless Function
//  نفس بنية الأمان المستخدمة بمشروع RealCash/BigLeague: initData HMAC + Neon Postgres
//  + rate limiting بالـIP + تحديثات ذرية للرصيد تمنع أي سباق/تكرار
// ══════════════════════════════════════════════════════════════════════════════

const { neon } = require('@neondatabase/serverless');
const crypto   = require('crypto');

const DATABASE_URL    = process.env.DATABASE_URL;
const BOT_TOKEN       = process.env.BOT_TOKEN;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET; // ← أضفه بـ Vercel env vars (يحمي endpoints الأدمن)

if (!DATABASE_URL) {
  throw new Error('[FATAL] DATABASE_URL env var is not set');
}
if (!INTERNAL_SECRET) {
  throw new Error('[FATAL] INTERNAL_SECRET env var is not set — refusing to run with an insecure fallback key');
}

const _db = neon(DATABASE_URL);
async function sql(query, params = []) {
  return await _db(query, params);
}

// ══════════════════════════════════════════════════════════════════════════════
//  إعدادات التطبيق — نفس الأرقام المستخدمة بالفرونت (script.js) — السيرفر هو
//  مصدر الحقيقة الوحيد؛ الفرونت لا يُعتمد عليه لفرض أي حد
// ══════════════════════════════════════════════════════════════════════════════
const APP_CFG = {
  CLAIM_REWARD_USD:      0.00005, // مكافأة كل ضغطة كليم
  CLAIM_COOLDOWN_SEC:    12,      // أقل فاصل زمني بين كليمين
  DAILY_CLAIM_LIMIT_USD: 0.03,    // أقصى ما يقدر يجمعه المستخدم من الكليم باليوم الواحد
  WITHDRAW_MIN_USD:      0.001,   // أقل مبلغ مسموح للسحب
};

// ── Anti-abuse: rate limit بالـIP (نفس نمط RealCash) ──────────────────────────
const CFG = {
  IP_MAX_REQ_PER_MIN: 120,
  TS_DRIFT_SEC:       300,
};

// ══════════════════════════════════════════════════════════════════════════════
//  Schema — يُنشأ تلقائياً أول مرة، وأي تشغيل لاحق يتجاهله (IF NOT EXISTS)
// ══════════════════════════════════════════════════════════════════════════════
async function ensureSchema() {
  await sql(`CREATE TABLE IF NOT EXISTS users (
    id                 SERIAL PRIMARY KEY,
    telegram_id        BIGINT UNIQUE NOT NULL,
    username           TEXT,
    first_name         TEXT,
    balance_usd        NUMERIC(14,6) NOT NULL DEFAULT 0,
    daily_claimed_usd  NUMERIC(14,6) NOT NULL DEFAULT 0,
    last_claim_date    DATE,
    last_claim_at      TIMESTAMPTZ,
    cwallet_id         TEXT,
    banned             BOOLEAN NOT NULL DEFAULT FALSE,
    shadow_banned      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at       TIMESTAMPTZ
  )`);

  await sql(`CREATE TABLE IF NOT EXISTS withdrawals (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cwallet_id  TEXT NOT NULL,
    amount      NUMERIC(14,6) NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await sql(`CREATE TABLE IF NOT EXISTS transactions (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    TEXT NOT NULL,   -- claim | withdraw
    amount_usd  NUMERIC(14,6) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC)`);

  await sql(`CREATE TABLE IF NOT EXISTS ip_limits (
    ip           TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    count        INT NOT NULL DEFAULT 0,
    PRIMARY KEY (ip, window_start)
  )`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  Telegram initData verification (نفس منطق RealCash/BigLeague حرفياً)
// ══════════════════════════════════════════════════════════════════════════════
function verifyInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get('hash');
    if (!receivedHash) return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(receivedHash))) return null;
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (Date.now() / 1000 - authDate > 3600) return null;
    return JSON.parse(params.get('user') || '{}');
  } catch {
    return null;
  }
}

// 🛡️ يوحّد قيمة عمود DATE إلى نص "YYYY-MM-DD" — يمنع مقارنات فاشلة بصمت
function toDateStr(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// ══════════════════════════════════════════════════════════════════════════════
//  Helpers: IP · Rate limit · Users · Transactions
// ══════════════════════════════════════════════════════════════════════════════
function getClientIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

async function checkIPLimit(ip) {
  await sql(`DELETE FROM ip_limits WHERE window_start < NOW() - INTERVAL '2 minutes'`);
  const rows = await sql(
    `INSERT INTO ip_limits (ip, window_start, count)
     VALUES ($1, DATE_TRUNC('minute', NOW()), 1)
     ON CONFLICT (ip, window_start)
     DO UPDATE SET count = ip_limits.count + 1
     RETURNING count`,
    [ip]
  );
  return rows[0].count <= CFG.IP_MAX_REQ_PER_MIN;
}

async function upsertUser(tgUser) {
  const telegramId = tgUser.id;
  const rows = await sql(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name
     RETURNING *`,
    [telegramId, tgUser.username || null, tgUser.first_name || null]
  );
  return rows[0];
}

async function logTx(userId, category, amountUsd) {
  await sql(`INSERT INTO transactions (user_id, category, amount_usd) VALUES ($1, $2, $3)`,
    [userId, category, amountUsd]);
}

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) return { ok: false };
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: 'Markdown' }),
  });
  return await res.json();
}

// ══════════════════════════════════════════════════════════════════════════════
//  Handler
// ══════════════════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  // ── CORS — محدود لدومين Telegram WebApp ─────────────────────────────────────
  const allowedOrigins = ['https://web.telegram.org', 'https://webk.telegram.org', 'https://webz.telegram.org'];
  const origin = req.headers['origin'] || '';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    await ensureSchema();
  } catch (err) {
    console.error('[Schema error]', err.message);
    return res.status(500).json({ ok: false, error: 'DB schema error: ' + err.message });
  }

  const clientIP = getClientIP(req);
  try {
    const ipOk = await checkIPLimit(clientIP);
    if (!ipOk) return res.status(429).json({ ok: false, error: 'Too many requests' });
  } catch (err) {
    console.error('[IP limit error]', err.message);
  }

  const body               = req.body || {};
  const { type, data = {} } = body;
  const rawInitData        = body.initData || req.headers['x-telegram-init-data'] || '';

  // ── Auth ──────────────────────────────────────────────────────────────────
  const tgUser = verifyInitData(rawInitData);
  if (!tgUser) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  if (data.ts) {
    const drift = Math.abs(Date.now() / 1000 - parseInt(data.ts, 10));
    if (drift > CFG.TS_DRIFT_SEC) return res.status(400).json({ ok: false, error: 'Request expired' });
  }

  let dbUser;
  try {
    dbUser = await upsertUser(tgUser);
  } catch (err) {
    console.error('[upsertUser error]', err.message);
    return res.status(500).json({ ok: false, error: 'DB error: ' + err.message });
  }

  if (dbUser.banned) return res.status(403).json({ ok: false, error: 'banned' });

  sql(`UPDATE users SET last_seen_at = NOW() WHERE id = $1`, [dbUser.id])
    .catch(err => console.error('[last_seen_at update]', err.message));

  // ── Router ───────────────────────────────────────────────────────────────
  try {
    switch (type) {

      // ═══════════ تهيئة الصفحة عند الفتح ═══════════
      case 'init': {
        const today = toDateStr(new Date());
        const dailyClaimed = toDateStr(dbUser.last_claim_date) === today ? parseFloat(dbUser.daily_claimed_usd) : 0;
        const secsSinceLastClaim = dbUser.last_claim_at
          ? Math.floor((Date.now() - new Date(dbUser.last_claim_at).getTime()) / 1000)
          : APP_CFG.CLAIM_COOLDOWN_SEC;
        const cooldownRemaining = Math.max(0, APP_CFG.CLAIM_COOLDOWN_SEC - secsSinceLastClaim);

        return res.json({
          ok: true,
          balance_usd: parseFloat(dbUser.balance_usd),
          daily_claimed_usd: dailyClaimed,
          daily_limit_usd: APP_CFG.DAILY_CLAIM_LIMIT_USD,
          cooldown_remaining_sec: cooldownRemaining,
          claim_reward_usd: APP_CFG.CLAIM_REWARD_USD,
          withdraw_min_usd: APP_CFG.WITHDRAW_MIN_USD,
        });
      }

      // ═══════════ الكليم ═══════════
      case 'claim.tap': {
        if (dbUser.shadow_banned) {
          // رد وهمي بدون منح فعلي — يبقي الحساب يبدو طبيعياً للمستخدم المخالف
          return res.json({ ok: true, balance_usd: parseFloat(dbUser.balance_usd), daily_claimed_usd: parseFloat(dbUser.daily_claimed_usd) });
        }

        // 🛡️ تحقق الكولداون من وقت السيرفر فعلياً، وليس من عداد الواجهة
        if (dbUser.last_claim_at) {
          const secsSince = (Date.now() - new Date(dbUser.last_claim_at).getTime()) / 1000;
          if (secsSince < APP_CFG.CLAIM_COOLDOWN_SEC) {
            return res.status(429).json({ ok: false, error: 'cooldown', remaining: Math.ceil(APP_CFG.CLAIM_COOLDOWN_SEC - secsSince) });
          }
        }

        // 🛡️ الحد اليومي — يتصفّر تلقائياً بتغيّر التاريخ (last_claim_date != اليوم)
        const today = toDateStr(new Date());
        const alreadyToday = toDateStr(dbUser.last_claim_date) === today ? parseFloat(dbUser.daily_claimed_usd) : 0;
        if (alreadyToday + APP_CFG.CLAIM_REWARD_USD > APP_CFG.DAILY_CLAIM_LIMIT_USD) {
          return res.status(403).json({ ok: false, error: 'daily_limit', daily_claimed_usd: alreadyToday });
        }

        // 🛡️ تحديث ذري: يعيد ضبط daily_claimed_usd لو تغيّر اليوم، ويشترط WHERE على آخر وقت
        // كليم لمنع أي طلبين متزامنين من المرور معاً (سباق)
        const rows = await sql(
          `UPDATE users SET
             balance_usd = balance_usd + $1,
             daily_claimed_usd = CASE WHEN last_claim_date = $2 THEN daily_claimed_usd + $1 ELSE $1 END,
             last_claim_date = $2,
             last_claim_at = NOW()
           WHERE id = $3
             AND (last_claim_at IS NULL OR last_claim_at <= NOW() - INTERVAL '${APP_CFG.CLAIM_COOLDOWN_SEC} seconds')
           RETURNING balance_usd, daily_claimed_usd`,
          [APP_CFG.CLAIM_REWARD_USD, today, dbUser.id]
        );

        if (!rows.length) {
          return res.status(429).json({ ok: false, error: 'cooldown' });
        }

        await logTx(dbUser.id, 'claim', APP_CFG.CLAIM_REWARD_USD);

        return res.json({
          ok: true,
          balance_usd: parseFloat(rows[0].balance_usd),
          daily_claimed_usd: parseFloat(rows[0].daily_claimed_usd),
          cooldown_sec: APP_CFG.CLAIM_COOLDOWN_SEC,
        });
      }

      // ═══════════ السحب ═══════════
      case 'wallet.withdraw': {
        const cwalletId = String(data.cwalletId || '').trim();
        if (!cwalletId) return res.status(400).json({ ok: false, error: 'cwallet_required' });

        const amount = parseFloat(data.amount);
        if (isNaN(amount) || amount < APP_CFG.WITHDRAW_MIN_USD) {
          return res.status(400).json({ ok: false, error: 'min_withdraw', min: APP_CFG.WITHDRAW_MIN_USD });
        }
        if (parseFloat(dbUser.balance_usd) < amount) {
          return res.status(400).json({ ok: false, error: 'insufficient_balance' });
        }
        if (dbUser.shadow_banned) {
          return res.json({ ok: true, balance_usd: parseFloat(dbUser.balance_usd) }); // رد وهمي بدون خصم فعلي
        }

        // 🛡️ خصم ذري يمنع السحب المزدوج (WHERE balance_usd >= amount)
        const claimed = await sql(
          `UPDATE users SET balance_usd = balance_usd - $1, cwallet_id = $2
           WHERE id = $3 AND balance_usd >= $1
           RETURNING balance_usd`,
          [amount, cwalletId, dbUser.id]
        );
        if (!claimed.length) return res.status(400).json({ ok: false, error: 'insufficient_balance' });

        await sql(`INSERT INTO withdrawals (user_id, cwallet_id, amount) VALUES ($1, $2, $3)`,
          [dbUser.id, cwalletId, amount]);
        await logTx(dbUser.id, 'withdraw', -amount);

        sendTelegramMessage(
          Number(dbUser.telegram_id),
          `✅ *تم استلام طلب السحب*\n\n💰 *المبلغ:* ${amount.toFixed(5)} USDT\n👛 *Cwallet ID:* \`${cwalletId}\`\n\n🕒 جاري المعالجة...`
        ).catch(e => console.error('[withdraw notify]', e.message));

        return res.json({ ok: true, balance_usd: parseFloat(claimed[0].balance_usd) });
      }

      // ═══════════ أدمن (محمي بـ INTERNAL_SECRET) ═══════════
      case 'admin.banUser': {
        const providedSecret = req.headers['x-internal-secret'] || data.secret || '';
        if (providedSecret !== INTERNAL_SECRET) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const targetId = data.telegram_id;
        const unban = data.unban === true;
        if (!targetId) return res.status(400).json({ ok: false, error: 'telegram_id required' });
        const rows = await sql(`UPDATE users SET banned = $1 WHERE telegram_id = $2 RETURNING id`, [!unban, targetId]);
        if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });
        return res.json({ ok: true, banned: !unban });
      }

      default:
        return res.status(400).json({ ok: false, error: `Unknown type: "${type}"` });
    }
  } catch (err) {
    console.error('[Handler error]', type, err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

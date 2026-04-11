// ================================================================
//  Tomato Farm — API Backend
//  ✅ يستخدم @neondatabase/serverless
//  ✅ ضع DATABASE_URL في Environment Variables على Vercel
// ================================================================

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;

// FIXED: Constant for referral percentage — calculated server-side only
const REFERRAL_PCT = 0.05;

// ── دالة تنفيذ SQL ────────────────────────────────────────────
async function sql(query, params = []) {
  const db = neon(DATABASE_URL);
  const rows = await db(query, params);
  return rows;
}

// ── Bootstrap — أنشئ الجدول لو مو موجود ────────────────────────
async function bootstrap() {
  try {
    await sql(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id      BIGINT        PRIMARY KEY,
        username         TEXT,
        balance          FLOAT         NOT NULL DEFAULT 0,
        seeds            INT           NOT NULL DEFAULT 3,
        water_count      INT           NOT NULL DEFAULT 3,
        cells            JSONB         NOT NULL DEFAULT '[]',
        task_state       JSONB         NOT NULL DEFAULT '{"earnChannel":"idle","eMoneyChannel":"idle"}',
        wd_history       JSONB         NOT NULL DEFAULT '[]',
        today_date       TEXT          NOT NULL DEFAULT '',
        today_earn       FLOAT         NOT NULL DEFAULT 0,
        total_harvests   INT           NOT NULL DEFAULT 0,
        referral_by      BIGINT,
        referral_friends INT           NOT NULL DEFAULT 0,
        referral_balance FLOAT         NOT NULL DEFAULT 0,
        referral_rewarded BOOLEAN      NOT NULL DEFAULT FALSE,
        day              INT           NOT NULL DEFAULT 1,
        created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log('[DB] Bootstrap OK');
  } catch (e) {
    console.error('[DB] Bootstrap failed:', e.message);
  }
}
bootstrap();

// ── CORS ─────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── FIXED: Safe integer parser — returns defaultVal if value is null/undefined/NaN
//          Does NOT fall back to default for legitimate 0 values
function safeInt(value, defaultVal) {
  if (value === null || value === undefined) return defaultVal;
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultVal : parsed;
}

// ── FIXED: Safe float parser — same logic as safeInt but for floats
function safeFloat(value, defaultVal) {
  if (value === null || value === undefined) return defaultVal;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultVal : parsed;
}

// ── Main Handler ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const { action, telegram_id, data = {} } = body || {};

  if (!action)      return res.status(400).json({ error: 'Missing action' });
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  const tid = parseInt(telegram_id);
  if (isNaN(tid)) return res.status(400).json({ error: 'Invalid telegram_id' });

  try {

    // ════════════════════════════════════════
    //  LOAD — تحميل المستخدم أو إنشاؤه
    // ════════════════════════════════════════
    if (action === 'load') {
      let rows = await sql(
        'SELECT * FROM users WHERE telegram_id = $1',
        [tid]
      );

      if (!rows.length) {
        // مستخدم جديد — أنشئه
        const username   = data.username   || null;
        const referralBy = data.referral_by ? parseInt(data.referral_by) : null;

        rows = await sql(
          `INSERT INTO users (telegram_id, username, referral_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (telegram_id) DO UPDATE SET updated_at = NOW()
           RETURNING *`,
          [tid, username, referralBy]
        );

        // مكافأة المُحيل — مرة واحدة فقط عند أول دخول
        if (referralBy && !isNaN(referralBy) && referralBy !== tid) {
          await sql(
            `UPDATE users
             SET referral_friends = referral_friends + 1,
                 referral_balance = referral_balance + 0.01,
                 balance          = balance + 0.01,
                 updated_at       = NOW()
             WHERE telegram_id = $1`,
            [referralBy]
          );
          await sql(
            `UPDATE users SET referral_rewarded = TRUE WHERE telegram_id = $1`,
            [tid]
          );
        }
      } else {
        // مستخدم موجود — تحقق لو referral_by موجود لكن لم تُعطَ المكافأة بعد
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
          await sql(
            `UPDATE users SET referral_rewarded = TRUE WHERE telegram_id = $1`,
            [tid]
          );
          rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
        }
      }

      return res.status(200).json({ ok: true, user: rows[0] });
    }

    // ════════════════════════════════════════
    //  REFERRAL_REWARD — 5% من كل حصاد
    // ════════════════════════════════════════
    if (action === 'referral_reward') {
      const rawAmount = data.harvest_amount ?? data.amount;

      // FIXED: Validate the incoming harvest amount
      if (rawAmount === undefined || rawAmount === null) {
        return res.status(400).json({ ok: false, error: 'Missing harvest_amount' });
      }

      const harvestAmount = parseFloat(rawAmount);
      if (isNaN(harvestAmount) || harvestAmount <= 0) {
        return res.status(400).json({ ok: false, error: 'Invalid harvest_amount' });
      }

      // FIXED: Calculate 5% server-side — never trust the frontend amount directly
      const reward = Math.round(harvestAmount * REFERRAL_PCT * 1e8) / 1e8; // precision-safe

      await sql(
        `UPDATE users
         SET referral_balance = referral_balance + $2,
             balance          = balance + $2,
             updated_at       = NOW()
         WHERE telegram_id = $1`,
        [tid, reward]
      );

      return res.status(200).json({ ok: true, rewarded: reward });
    }

    // ════════════════════════════════════════
    //  SAVE — حفظ الحالة الكاملة
    //  FIXED: Load current DB row first, then only overwrite
    //         fields that were explicitly sent — prevents
    //         accidental reset of seeds, water, and cells
    // ════════════════════════════════════════
    if (action === 'save') {

      // FIXED: Fetch existing row so we can fall back to DB values
      //        for any field the frontend didn't send
      const existing = await sql(
        'SELECT * FROM users WHERE telegram_id = $1',
        [tid]
      );
      const cur = existing[0] || {};

      // FIXED: Use safeInt/safeFloat so 0 is preserved, not replaced with default
      const newBalance       = safeFloat(data.balance,         cur.balance          ?? 0);
      const newSeeds         = safeInt  (data.seeds,           cur.seeds            ?? 3); // FIXED: was || 3
      const newWaterCount    = safeInt  (data.water_count,     cur.water_count      ?? 3); // FIXED: was || 3
      const newTodayEarn     = safeFloat(data.today_earn,      cur.today_earn       ?? 0);
      const newTotalHarvests = safeInt  (data.total_harvests,  cur.total_harvests   ?? 0);
      const newRefBalance    = safeFloat(data.referral_balance,cur.referral_balance ?? 0);
      const newRefFriends    = safeInt  (data.referral_friends,cur.referral_friends ?? 0);
      const newDay           = safeInt  (data.day,             cur.day              ?? 1);
      const newTodayDate     = data.today_date  !== undefined ? data.today_date  : (cur.today_date  || '');

      // FIXED: cells — if frontend didn't send cells (or sent empty array),
      //        keep the existing DB value to prevent farm from disappearing on refresh
      let newCells;
      if (Array.isArray(data.cells) && data.cells.length > 0) {
        newCells = JSON.stringify(data.cells);                 // frontend sent real data → use it
      } else if (data.cells === null) {
        newCells = '[]';                                       // frontend explicitly cleared → allow
      } else {
        newCells = JSON.stringify(cur.cells ?? []);            // FIXED: not provided → keep DB value
      }

      // task_state — keep existing if not provided
      let newTaskState;
      if (data.task_state !== undefined) {
        newTaskState = JSON.stringify(data.task_state);
      } else {
        newTaskState = JSON.stringify(cur.task_state ?? { earnChannel: 'idle', eMoneyChannel: 'idle' });
      }

      // wd_history — keep existing if not provided
      let newWdHistory;
      if (Array.isArray(data.wd_history)) {
        newWdHistory = JSON.stringify(data.wd_history);
      } else {
        newWdHistory = JSON.stringify(cur.wd_history ?? []);
      }

      await sql(
        `INSERT INTO users
           (telegram_id, balance, seeds, water_count, cells, task_state,
            wd_history, today_date, today_earn, total_harvests,
            referral_balance, referral_friends, day, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
         ON CONFLICT (telegram_id) DO UPDATE SET
           balance          = EXCLUDED.balance,
           seeds            = EXCLUDED.seeds,
           water_count      = EXCLUDED.water_count,
           cells            = EXCLUDED.cells,
           task_state       = EXCLUDED.task_state,
           wd_history       = EXCLUDED.wd_history,
           today_date       = EXCLUDED.today_date,
           today_earn       = EXCLUDED.today_earn,
           total_harvests   = EXCLUDED.total_harvests,
           referral_balance = EXCLUDED.referral_balance,
           referral_friends = EXCLUDED.referral_friends,
           day              = EXCLUDED.day,
           updated_at       = NOW()`,
        [
          tid,
          newBalance,
          newSeeds,
          newWaterCount,
          newCells,
          newTaskState,
          newWdHistory,
          newTodayDate,
          newTodayEarn,
          newTotalHarvests,
          newRefBalance,
          newRefFriends,
          newDay
        ]
      );

      return res.status(200).json({ ok: true });
    }

    // ════════════════════════════════════════
    //  WITHDRAW — سحب
    // ════════════════════════════════════════
    if (action === 'withdraw') {
      const { account, amount } = data;
      if (!account)             return res.status(400).json({ ok: false, error: 'Missing account' });
      if (!amount || amount<=0) return res.status(400).json({ ok: false, error: 'Invalid amount' });
      if (amount < 0.05)        return res.status(400).json({ ok: false, error: 'Minimum 0.05 TON' });

      const rows = await sql('SELECT balance, wd_history FROM users WHERE telegram_id = $1', [tid]);
      if (!rows.length)             return res.status(404).json({ ok: false, error: 'User not found' });
      if (rows[0].balance < amount) return res.status(400).json({ ok: false, error: 'Insufficient balance' });

      const now = new Date();
      const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    + ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const entry = { account, amount: parseFloat(amount), date: dateStr, status: 'pending' };

      const history = Array.isArray(rows[0].wd_history) ? rows[0].wd_history : [];
      history.unshift(entry);

      await sql(
        `UPDATE users SET
           balance    = balance - $2,
           wd_history = $3,
           updated_at = NOW()
         WHERE telegram_id = $1`,
        [tid, parseFloat(amount), JSON.stringify(history)]
      );

      return res.status(200).json({ ok: true, entry });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('[API Error]', action, err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};

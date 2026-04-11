/// ================================================================
//  Tomato Farm — API Backend
//  ✅ يستخدم @neondatabase/serverless
//  ✅ ضع DATABASE_URL في Environment Variables على Vercel
// ================================================================

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;

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
    // أضف عمود referral_rewarded لو الجدول قديم
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
        // ✅ مستخدم جديد — أنشئه
        const username   = data.username   || null;
        const referralBy = data.referral_by ? parseInt(data.referral_by) : null;

        rows = await sql(
          `INSERT INTO users (telegram_id, username, referral_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (telegram_id) DO UPDATE SET updated_at = NOW()
           RETURNING *`,
          [tid, username, referralBy]
        );

        // ✅ مكافأة المُحيل — مرة واحدة فقط عند أول دخول
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
          // سجّل إن هذا المستخدم تمت مكافأة محيله
          await sql(
            `UPDATE users SET referral_rewarded = TRUE WHERE telegram_id = $1`,
            [tid]
          );
        }
      } else {
        // ✅ مستخدم موجود — تحقق لو referral_by موجود لكن لم تُعطَ المكافأة بعد
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
          // أعد تحميل بيانات المستخدم بعد التحديث
          rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
        }
      }

      return res.status(200).json({ ok: true, user: rows[0] });
    }

    // ════════════════════════════════════════
    //  REFERRAL_REWARD — 5% من كل حصاد
    // ════════════════════════════════════════
    if (action === 'referral_reward') {
      const { amount } = data;
      if (!amount || amount <= 0) return res.status(400).json({ ok: false });
      // المُحيل هو telegram_id الممرر — أضف له 5%
      await sql(
        `UPDATE users
         SET referral_balance = referral_balance + $2,
             balance          = balance + $2,
             updated_at       = NOW()
         WHERE telegram_id = $1`,
        [tid, parseFloat(amount)]
      );
      return res.status(200).json({ ok: true });
    }

    // ════════════════════════════════════════
    //  SAVE — حفظ الحالة الكاملة (UPSERT)
    //  ✅ يُنشئ المستخدم تلقائياً لو مو موجود
    // ════════════════════════════════════════
    if (action === 'save') {
      const {
        balance = 0, seeds, water_count,
        cells = [], task_state = {}, wd_history = [],
        today_date = '', today_earn = 0,
        total_harvests = 0, referral_balance = 0,
        referral_friends = 0, day = 1
      } = data;

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
          parseFloat(balance)          || 0,
          seeds     !== undefined && seeds     !== null ? parseInt(seeds)      : 3,
          water_count !== undefined && water_count !== null ? parseInt(water_count) : 3,
          JSON.stringify(cells),
          JSON.stringify(task_state),
          JSON.stringify(wd_history),
          today_date,
          parseFloat(today_earn)       || 0,
          parseInt(total_harvests)     || 0,
          parseFloat(referral_balance) || 0,
          parseInt(referral_friends)   || 0,
          parseInt(day)                || 1
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
      const entry = { account, amount, date: dateStr, status: 'pending' };

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

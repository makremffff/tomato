// ================================================================
//  Tomato Farm — API Backend v2
//  ✅ @neondatabase/serverless
//  ✅ جدول farm_cells مستقل لكل خلية
//  ✅ إصلاح seeds/water لا يرجع 3 عند الحفظ
//  ✅ إصلاح الإحالة: referral_by من DB لا start_param
// ================================================================

const { neon } = require('@neondatabase/serverless');
const DATABASE_URL = process.env.DATABASE_URL;

async function sql(query, params = []) {
  const db = neon(DATABASE_URL);
  return await db(query, params);
}

// ── Bootstrap ────────────────────────────────────────────────
async function bootstrap() {
  try {
    await sql(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id       BIGINT        PRIMARY KEY,
        username          TEXT,
        balance           FLOAT         NOT NULL DEFAULT 0,
        seeds             INT           NOT NULL DEFAULT 3,
        water_count       INT           NOT NULL DEFAULT 3,
        task_state        JSONB         NOT NULL DEFAULT '{"earnChannel":"idle","eMoneyChannel":"idle"}',
        wd_history        JSONB         NOT NULL DEFAULT '[]',
        today_date        TEXT          NOT NULL DEFAULT '',
        today_earn        FLOAT         NOT NULL DEFAULT 0,
        total_harvests    INT           NOT NULL DEFAULT 0,
        referral_by       BIGINT,
        referral_friends  INT           NOT NULL DEFAULT 0,
        referral_balance  FLOAT         NOT NULL DEFAULT 0,
        referral_rewarded BOOLEAN       NOT NULL DEFAULT FALSE,
        day               INT           NOT NULL DEFAULT 1,
        created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE`);

    // ✅ جدول الخلايا المستقل
    // planted_at: timestamp الزراعة الفعلي — يُحسب منه progress دون حفظ
    // watered_at: timestamp السقي — لحساب تأثير التسريع بدقة
    await sql(`
      CREATE TABLE IF NOT EXISTS farm_cells (
        telegram_id  BIGINT       NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
        cell_id      INT          NOT NULL CHECK (cell_id BETWEEN 0 AND 2),
        state        TEXT         NOT NULL DEFAULT 'empty',
        planted_at   TIMESTAMPTZ,
        watered      BOOLEAN      NOT NULL DEFAULT FALSE,
        watered_at   TIMESTAMPTZ,
        PRIMARY KEY (telegram_id, cell_id)
      )
    `);

    console.log('[DB] Bootstrap OK');
  } catch (e) {
    console.error('[DB] Bootstrap failed:', e.message);
  }
}
bootstrap();

// ── CORS ─────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── حساب progress من planted_at بدون قراءة progress من DB ────
function computeProgress(row, growTimeSec) {
  if (!row || row.state === 'empty') return { state: 'empty', progress: 0, watered: false };
  if (row.state === 'ready') return { state: 'ready', progress: growTimeSec, watered: row.watered };

  const now       = Date.now();
  const plantedAt = row.planted_at ? new Date(row.planted_at).getTime() : now;

  let elapsed;
  if (row.watered && row.watered_at) {
    const wateredAt   = new Date(row.watered_at).getTime();
    const beforeWater = Math.max(0, (wateredAt - plantedAt) / 1000);
    const afterWater  = Math.max(0, (now - wateredAt) / 1000) * 2; // 2× بعد السقي
    elapsed = beforeWater + afterWater;
  } else {
    elapsed = (now - plantedAt) / 1000;
  }

  const progress = Math.min(growTimeSec, Math.floor(elapsed));
  const state    = progress >= growTimeSec ? 'ready' : 'growing';
  return { state, progress, watered: row.watered, planted_at: row.planted_at };
}

// ── Main Handler ─────────────────────────────────────────────
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

  const GROW_TIME = data.grow_time ? parseInt(data.grow_time) : 30;

  try {

    // ════════════════════════════════════════
    //  LOAD
    // ════════════════════════════════════════
    if (action === 'load') {
      let rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);

      if (!rows.length) {
        const username   = data.username   || null;
        const referralBy = data.referral_by ? parseInt(data.referral_by) : null;

        rows = await sql(
          `INSERT INTO users (telegram_id, username, referral_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (telegram_id) DO UPDATE SET updated_at = NOW()
           RETURNING *`,
          [tid, username, referralBy]
        );

        // إنشاء 3 خلايا للمستخدم الجديد
        for (let i = 0; i < 3; i++) {
          await sql(
            `INSERT INTO farm_cells (telegram_id, cell_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [tid, i]
          );
        }

        // مكافأة المُحيل
        if (referralBy && !isNaN(referralBy) && referralBy !== tid) {
          await sql(
            `UPDATE users SET referral_friends = referral_friends + 1, updated_at = NOW() WHERE telegram_id = $1`,
            [referralBy]
          );
          await sql(`UPDATE users SET referral_rewarded = TRUE WHERE telegram_id = $1`, [tid]);
        }
      } else {
        const u = rows[0];
        // تأكد من وجود الخلايا (للمستخدمين القدامى)
        for (let i = 0; i < 3; i++) {
          await sql(
            `INSERT INTO farm_cells (telegram_id, cell_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [tid, i]
          );
        }
        if (u.referral_by && !u.referral_rewarded) {
          await sql(
            `UPDATE users SET referral_friends = referral_friends + 1, updated_at = NOW() WHERE telegram_id = $1`,
            [u.referral_by]
          );
          await sql(`UPDATE users SET referral_rewarded = TRUE WHERE telegram_id = $1`, [tid]);
          rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
        }
      }

      // جلب الخلايا وحساب progress الحالي
      const cellRows = await sql(
        `SELECT * FROM farm_cells WHERE telegram_id = $1 ORDER BY cell_id`,
        [tid]
      );

      const computedCells = [];
      for (const row of cellRows) {
        const computed = computeProgress(row, GROW_TIME);
        // لو اكتملت أثناء الغياب، حدّثها في DB
        if (row.state === 'growing' && computed.state === 'ready') {
          await sql(
            `UPDATE farm_cells SET state = 'ready' WHERE telegram_id = $1 AND cell_id = $2`,
            [tid, row.cell_id]
          );
        }
        computedCells.push({
          cell_id:    row.cell_id,
          state:      computed.state,
          progress:   computed.progress,
          watered:    row.watered,
          planted_at: row.planted_at
        });
      }

      return res.status(200).json({ ok: true, user: rows[0], cells: computedCells });
    }

    // ════════════════════════════════════════
    //  PLANT
    // ════════════════════════════════════════
    if (action === 'plant') {
      const { cell_id } = data;
      if (cell_id === undefined) return res.status(400).json({ ok: false, error: 'Missing cell_id' });

      const userRows = await sql('SELECT seeds FROM users WHERE telegram_id = $1', [tid]);
      if (!userRows.length) return res.status(404).json({ ok: false, error: 'User not found' });
      if (userRows[0].seeds <= 0) return res.status(400).json({ ok: false, error: 'No seeds' });

      const cellRows = await sql(
        `SELECT * FROM farm_cells WHERE telegram_id = $1 AND cell_id = $2`, [tid, cell_id]
      );
      if (!cellRows.length || cellRows[0].state !== 'empty') {
        return res.status(400).json({ ok: false, error: 'Cell not empty' });
      }

      await sql(
        `UPDATE farm_cells SET state = 'growing', planted_at = NOW(), watered = FALSE, watered_at = NULL
         WHERE telegram_id = $1 AND cell_id = $2`,
        [tid, cell_id]
      );
      await sql(
        `UPDATE users SET seeds = GREATEST(seeds - 1, 0), updated_at = NOW() WHERE telegram_id = $1`,
        [tid]
      );

      const updated = await sql('SELECT seeds, water_count FROM users WHERE telegram_id = $1', [tid]);
      return res.status(200).json({ ok: true, seeds: updated[0].seeds, water_count: updated[0].water_count });
    }

    // ════════════════════════════════════════
    //  WATER
    // ════════════════════════════════════════
    if (action === 'water') {
      const { cell_id } = data;
      if (cell_id === undefined) return res.status(400).json({ ok: false, error: 'Missing cell_id' });

      const userRows = await sql('SELECT water_count FROM users WHERE telegram_id = $1', [tid]);
      if (!userRows.length) return res.status(404).json({ ok: false, error: 'User not found' });
      if (userRows[0].water_count <= 0) return res.status(400).json({ ok: false, error: 'No water' });

      const cellRows = await sql(
        `SELECT * FROM farm_cells WHERE telegram_id = $1 AND cell_id = $2`, [tid, cell_id]
      );
      if (!cellRows.length || cellRows[0].state !== 'growing') {
        return res.status(400).json({ ok: false, error: 'Cell not growing' });
      }
      if (cellRows[0].watered) return res.status(400).json({ ok: false, error: 'Already watered' });

      await sql(
        `UPDATE farm_cells SET watered = TRUE, watered_at = NOW()
         WHERE telegram_id = $1 AND cell_id = $2`,
        [tid, cell_id]
      );
      await sql(
        `UPDATE users SET water_count = GREATEST(water_count - 1, 0), updated_at = NOW() WHERE telegram_id = $1`,
        [tid]
      );

      const updated = await sql('SELECT seeds, water_count FROM users WHERE telegram_id = $1', [tid]);
      return res.status(200).json({ ok: true, seeds: updated[0].seeds, water_count: updated[0].water_count });
    }

    // ════════════════════════════════════════
    //  HARVEST
    // ════════════════════════════════════════
    if (action === 'harvest') {
      const { cell_id, reward } = data;
      if (cell_id === undefined) return res.status(400).json({ ok: false, error: 'Missing cell_id' });

      const cellRows = await sql(
        `SELECT * FROM farm_cells WHERE telegram_id = $1 AND cell_id = $2`, [tid, cell_id]
      );
      if (!cellRows.length) return res.status(404).json({ ok: false, error: 'Cell not found' });

      const computed = computeProgress(cellRows[0], GROW_TIME);
      if (computed.state !== 'ready') {
        return res.status(400).json({ ok: false, error: 'Not ready yet', progress: computed.progress });
      }

      const harvestReward = parseFloat(reward) || 0.0001;
      const today = new Date().toISOString().slice(0, 10);

      // إعادة الخلية فارغة
      await sql(
        `UPDATE farm_cells SET state = 'empty', planted_at = NULL, watered = FALSE, watered_at = NULL
         WHERE telegram_id = $1 AND cell_id = $2`,
        [tid, cell_id]
      );

      // تحديث رصيد المستخدم
      await sql(
        `UPDATE users SET
           balance        = balance + $2,
           today_earn     = CASE WHEN today_date = $3 THEN today_earn + $2 ELSE $2 END,
           today_date     = $3,
           total_harvests = total_harvests + 1,
           updated_at     = NOW()
         WHERE telegram_id = $1`,
        [tid, harvestReward, today]
      );

      // ✅ الإحالة من قاعدة البيانات مباشرة (لا start_param)
      const userRows = await sql('SELECT referral_by, balance FROM users WHERE telegram_id = $1', [tid]);
      let referrerUpdate = null;
      if (userRows.length && userRows[0].referral_by) {
        const refId     = userRows[0].referral_by;
        const refReward = Math.round(harvestReward * 0.05 * 1e8) / 1e8;
        await sql(
          `UPDATE users SET referral_balance = referral_balance + $2, balance = balance + $2, updated_at = NOW()
           WHERE telegram_id = $1`,
          [refId, refReward]
        );
        referrerUpdate = { referrer_id: refId, added: refReward };
      }

      const updated = await sql(
        'SELECT balance, today_earn, total_harvests FROM users WHERE telegram_id = $1', [tid]
      );
      return res.status(200).json({
        ok: true,
        balance:        updated[0].balance,
        today_earn:     updated[0].today_earn,
        total_harvests: updated[0].total_harvests,
        referrer:       referrerUpdate
      });
    }

    // ════════════════════════════════════════
    //  ADD_RESOURCES — seeds أو water من إعلان
    // ════════════════════════════════════════
    if (action === 'add_resources') {
      const { seeds = 0, water = 0 } = data;
      await sql(
        `UPDATE users SET seeds = seeds + $2, water_count = water_count + $3, updated_at = NOW()
         WHERE telegram_id = $1`,
        [tid, parseInt(seeds) || 0, parseInt(water) || 0]
      );
      const updated = await sql('SELECT seeds, water_count FROM users WHERE telegram_id = $1', [tid]);
      return res.status(200).json({ ok: true, seeds: updated[0].seeds, water_count: updated[0].water_count });
    }

    // ════════════════════════════════════════
    //  SAVE — يحفظ فقط: task_state, wd_history, today_date, today_earn, day
    //  seeds/water/balance/cells تُدار عبر أكشناتها المستقلة
    // ════════════════════════════════════════
    if (action === 'save') {
      const { task_state = {}, wd_history = [], today_date = '', today_earn = 0, day = 1 } = data;
      await sql(
        `INSERT INTO users (telegram_id, task_state, wd_history, today_date, today_earn, day, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (telegram_id) DO UPDATE SET
           task_state = EXCLUDED.task_state,
           wd_history = EXCLUDED.wd_history,
           today_date = EXCLUDED.today_date,
           today_earn = EXCLUDED.today_earn,
           day        = EXCLUDED.day,
           updated_at = NOW()`,
        [tid, JSON.stringify(task_state), JSON.stringify(wd_history), today_date,
         parseFloat(today_earn) || 0, parseInt(day) || 1]
      );
      return res.status(200).json({ ok: true });
    }

    // ════════════════════════════════════════
    //  TASK_REWARD
    // ════════════════════════════════════════
    if (action === 'task_reward') {
      const { amount } = data;
      if (!amount || amount <= 0) return res.status(400).json({ ok: false });
      await sql(
        `UPDATE users SET balance = balance + $2, updated_at = NOW() WHERE telegram_id = $1`,
        [tid, parseFloat(amount)]
      );
      const updated = await sql('SELECT balance FROM users WHERE telegram_id = $1', [tid]);
      return res.status(200).json({ ok: true, balance: updated[0].balance });
    }

    // ════════════════════════════════════════
    //  WITHDRAW
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
      const dateStr = now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
                    + ' ' + now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
      const entry = { account, amount, date: dateStr, status: 'pending' };
      const history = Array.isArray(rows[0].wd_history) ? rows[0].wd_history : [];
      history.unshift(entry);

      await sql(
        `UPDATE users SET balance = balance - $2, wd_history = $3, updated_at = NOW() WHERE telegram_id = $1`,
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

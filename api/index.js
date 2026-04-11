// ================================================================
//  Tomato Farm — API Backend v2.0
//  ✅ Server is Single Source of Truth
//  ✅ Time-based farming calculated on server
//  ✅ Referral: 5% per harvest (not fixed)
//  ✅ No state resets on refresh
//  ✅ cells stored as JSONB with planted_at timestamps
// ================================================================

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;

// ── SQL executor ─────────────────────────────────────────────────
async function sql(query, params = []) {
  const db = neon(DATABASE_URL);
  return await db(query, params);
}

// ── Constants ────────────────────────────────────────────────────
const CELL_COUNT    = 3;
const GROW_DURATION = 300; // seconds

// ── Bootstrap ────────────────────────────────────────────────────
async function bootstrap() {
  try {
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
        created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);
    const migrations = [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_friends INT NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_balance NUMERIC(18,6) NOT NULL DEFAULT 0`,
    ];
    for (const m of migrations) {
      try { await sql(m); } catch (_) {}
    }
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

// ── Cell helpers ──────────────────────────────────────────────────
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

// ── Main Handler ──────────────────────────────────────────────────
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

        // Missed referral reward
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

        // Daily reset
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

      return res.status(200).json({ ok: true, user: { ...user, cells: resolved } });
    }

    // ══════════════════════════════════════════════════════════════
    //  GET_STATE — polling (every 3s from frontend)
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
    //  PLANT — data: { cell_id, duration? }
    // ══════════════════════════════════════════════════════════════
    if (action === 'plant') {
      const cellId   = parseInt(data.cell_id);
      const duration = parseInt(data.duration) || GROW_DURATION;

      if (isNaN(cellId) || cellId < 0 || cellId >= CELL_COUNT)
        return res.status(400).json({ ok: false, error: 'Invalid cell_id' });

      const rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });

      const user = rows[0];
      if (user.seeds <= 0) return res.status(400).json({ ok: false, error: 'Not enough seeds' });

      const cells = resolveCells(normalizeCellsFromDB(user.cells));
      if (cells[cellId].state !== 'empty')
        return res.status(400).json({ ok: false, error: 'Cell is not empty' });

      cells[cellId] = { id: cellId, state: 'growing', planted_at: new Date().toISOString(), duration };

      await sql(
        `UPDATE users SET cells = $2, seeds = seeds - 1, updated_at = NOW() WHERE telegram_id = $1`,
        [tid, JSON.stringify(cells)]
      );

      return res.status(200).json({ ok: true, cells });
    }

    // ══════════════════════════════════════════════════════════════
    //  HARVEST — data: { cell_id, reward }
    // ══════════════════════════════════════════════════════════════
    if (action === 'harvest') {
      const cellId = parseInt(data.cell_id);
      const reward = parseFloat(data.reward);

      if (isNaN(cellId) || cellId < 0 || cellId >= CELL_COUNT)
        return res.status(400).json({ ok: false, error: 'Invalid cell_id' });
      if (isNaN(reward) || reward <= 0)
        return res.status(400).json({ ok: false, error: 'Invalid reward amount' });

      const rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });

      const user  = rows[0];
      const cells = resolveCells(normalizeCellsFromDB(user.cells));

      if (cells[cellId].state !== 'ready')
        return res.status(400).json({ ok: false, error: 'Cell is not ready to harvest' });

      cells[cellId] = { id: cellId, state: 'empty', planted_at: null, duration: GROW_DURATION };

      const today        = todayUTC();
      const isSameDay    = user.today_date === today;
      const newTodayEarn = isSameDay ? parseFloat(user.today_earn) + reward : reward;

      await sql(
        `UPDATE users
         SET balance        = balance + $2,
             cells          = $3,
             today_date     = $4,
             today_earn     = $5,
             total_harvests = total_harvests + 1,
             updated_at     = NOW()
         WHERE telegram_id = $1`,
        [tid, reward, JSON.stringify(cells), today, newTodayEarn]
      );

      // ── 5% referral cut ──
      if (user.referral_by) {
        const cut = parseFloat((reward * 0.05).toFixed(6));
        await sql(
          `UPDATE users
           SET referral_balance = referral_balance + $2,
               balance          = balance + $2,
               updated_at       = NOW()
           WHERE telegram_id = $1`,
          [user.referral_by, cut]
        );
      }

      return res.status(200).json({
        ok: true, cells, reward,
        referral_cut: user.referral_by ? parseFloat((reward * 0.05).toFixed(6)) : 0
      });
    }

    // ══════════════════════════════════════════════════════════════
    //  UPDATE_CELL — data: { cell_id, patch: { duration?, watered? } }
    // ══════════════════════════════════════════════════════════════
    if (action === 'update_cell') {
      const cellId = parseInt(data.cell_id);
      const patch  = data.patch || {};

      if (isNaN(cellId) || cellId < 0 || cellId >= CELL_COUNT)
        return res.status(400).json({ ok: false, error: 'Invalid cell_id' });

      const ALLOWED   = ['duration', 'watered'];
      const safePatch = {};
      for (const k of ALLOWED) if (patch[k] !== undefined) safePatch[k] = patch[k];

      const rows = await sql('SELECT cells FROM users WHERE telegram_id = $1', [tid]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });

      const cells = resolveCells(normalizeCellsFromDB(rows[0].cells));
      cells[cellId] = { ...cells[cellId], ...safePatch };

      await sql(`UPDATE users SET cells = $2, updated_at = NOW() WHERE telegram_id = $1`,
        [tid, JSON.stringify(cells)]);

      return res.status(200).json({ ok: true, cells });
    }

    // ══════════════════════════════════════════════════════════════
    //  ADD_RESOURCE — data: { type: 'seeds'|'water', amount }
    // ══════════════════════════════════════════════════════════════
    if (action === 'add_resource') {
      const type   = data.type;
      const amount = parseInt(data.amount);

      if (!['seeds', 'water'].includes(type))
        return res.status(400).json({ ok: false, error: 'Invalid resource type' });
      if (isNaN(amount) || amount <= 0)
        return res.status(400).json({ ok: false, error: 'Invalid amount' });

      const col = type === 'seeds' ? 'seeds' : 'water_count';
      const MAX = 10;

      await sql(
        `UPDATE users SET ${col} = LEAST(${col} + $2, $3), updated_at = NOW() WHERE telegram_id = $1`,
        [tid, amount, MAX]
      );

      const rows = await sql(`SELECT ${col} FROM users WHERE telegram_id = $1`, [tid]);
      return res.status(200).json({ ok: true, [col]: rows[0]?.[col] });
    }

    // ══════════════════════════════════════════════════════════════
    //  SAVE_TASKS — data: { task_state }
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
    //  ADD_BALANCE — data: { amount, source? }
    // ══════════════════════════════════════════════════════════════
    if (action === 'add_balance') {
      const amount = parseFloat(data.amount);
      const source = data.source || 'unknown';

      if (isNaN(amount) || amount <= 0 || amount > 1)
        return res.status(400).json({ ok: false, error: 'Invalid amount' });

      await sql(
        `UPDATE users SET balance = balance + $2, updated_at = NOW() WHERE telegram_id = $1`,
        [tid, amount]
      );
      console.log(`[Balance] +${amount} → ${tid} (${source})`);
      return res.status(200).json({ ok: true });
    }

    // ══════════════════════════════════════════════════════════════
    //  WITHDRAW — data: { account, amount }
    // ══════════════════════════════════════════════════════════════
    if (action === 'withdraw') {
      const { account, amount } = data;
      const amt = parseFloat(amount);

      if (!account)               return res.status(400).json({ ok: false, error: 'Missing account' });
      if (isNaN(amt) || amt <= 0) return res.status(400).json({ ok: false, error: 'Invalid amount' });
      if (amt < 0.05)             return res.status(400).json({ ok: false, error: 'Minimum 0.05 TON' });

      const rows = await sql('SELECT balance, wd_history FROM users WHERE telegram_id = $1', [tid]);
      if (!rows.length)                      return res.status(404).json({ ok: false, error: 'User not found' });
      if (parseFloat(rows[0].balance) < amt) return res.status(400).json({ ok: false, error: 'Insufficient balance' });

      const now     = new Date();
      const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    + ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('[API Error]', action, err.message, err.stack);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};

// ================================================================
//  FRONTEND DB SYNC — ضع هذا الكود في index.html
//  (داخل <script> بدلاً من دوال save/load القديمة)
// ================================================================

/*

const API_BASE = 'https://tomato-v3.vercel.app'; // ← غيّر للرابط الخاص

async function _dbCall(action, data = {}, tid = null) {
  try {
    const res = await fetch(API_BASE + '/api', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action, telegram_id: tid || TG_ID || '0', data })
    });
    return await res.json();
  } catch (e) {
    console.warn('[DB]', action, 'failed:', e.message);
    return { ok: false };
  }
}

function _applyUser(u) {
  if (!u) return;
  balance         = parseFloat(u.balance)         || 0;
  seeds           = parseInt(u.seeds);             // ❌ لا تضع || 3
  waterCount      = parseInt(u.water_count);       // ❌ لا تضع || 3
  todayEarnings   = parseFloat(u.today_earn)       || 0;
  totalHarvests   = parseInt(u.total_harvests)     || 0;
  referralBalance = parseFloat(u.referral_balance) || 0;
  referralFriends = parseInt(u.referral_friends)   || 0;
  day             = parseInt(u.day)                || 1;
  cells = Array.isArray(u.cells) && u.cells.length === CELL_COUNT
    ? u.cells : buildEmptyCells();
  taskState.earnChannel   = u.task_state?.earnChannel   || 'idle';
  taskState.eMoneyChannel = u.task_state?.eMoneyChannel || 'idle';
  withdrawHistory.length  = 0;
  if (Array.isArray(u.wd_history)) withdrawHistory.push(...u.wd_history);
}

async function loadUser() {
  if (!TG_ID) return;
  const result = await _dbCall('load', {
    username:    TG_USERNAME || TG_FIRST || null,
    referral_by: (tg?.initDataUnsafe?.start_param || '').replace('ref_', '') || null
  });
  if (!result.ok || !result.user) return;
  _applyUser(result.user);
  renderFarm(); updateStats(); syncWithdrawPage(); syncInvitePage();
  _syncTaskUI('ec', taskState.earnChannel);
  _syncTaskUI('em', taskState.eMoneyChannel);
}

async function dbPlant(cellId, duration) {
  const result = await _dbCall('plant', { cell_id: cellId, duration: duration || TOMATO.growTime });
  if (!result.ok) { toast('❌ ' + (result.error || 'Plant failed')); return false; }
  cells = result.cells;
  updateStats(); renderFarm();
  return true;
}

async function dbHarvest(cellId, reward) {
  const result = await _dbCall('harvest', { cell_id: cellId, reward });
  if (!result.ok) { toast('❌ ' + (result.error || 'Harvest failed')); return false; }
  cells = result.cells;
  balance += reward; todayEarnings += reward; totalHarvests++;
  updateStats(); renderFarm();
  return true;
}

async function dbUpdateCell(cellId, patch) {
  const result = await _dbCall('update_cell', { cell_id: cellId, patch });
  if (result.ok) cells = result.cells;
}

async function dbAddResource(type, amount) {
  const result = await _dbCall('add_resource', { type, amount });
  if (!result.ok) return false;
  if (type === 'seeds') seeds      = result.seeds      ?? seeds;
  else                  waterCount = result.water_count ?? waterCount;
  updateStats();
  return true;
}

async function dbAddBalance(amount, source) {
  const result = await _dbCall('add_balance', { amount, source });
  if (!result.ok) return false;
  balance += amount; updateStats();
  return true;
}

async function dbSaveTasks() {
  await _dbCall('save_tasks', { task_state: taskState });
}

async function dbWithdraw(account, amount) {
  const result = await _dbCall('withdraw', { account, amount });
  if (!result.ok) { toast('❌ ' + (result.error || 'Withdrawal failed')); return { ok: false }; }
  balance -= amount;
  withdrawHistory.unshift(result.entry);
  updateStats(); syncWithdrawPage();
  return { ok: true };
}

let _pollActive = false;
setInterval(async () => {
  if (!TG_ID || _pollActive) return;
  _pollActive = true;
  try {
    const result = await _dbCall('get_state');
    if (!result.ok || !result.user) return;
    const u = result.user;
    balance         = parseFloat(u.balance)         || 0;
    referralBalance = parseFloat(u.referral_balance) || 0;
    referralFriends = parseInt(u.referral_friends)   || 0;
    const serverCells = Array.isArray(u.cells) ? u.cells : [];
    if (serverCells.length === CELL_COUNT) {
      serverCells.forEach((sc, i) => {
        if (cells[i] && cells[i].state !== sc.state) cells[i] = sc;
      });
    }
    updateStats(); syncWithdrawPage(); syncInvitePage(); renderFarm();
  } finally {
    _pollActive = false;
  }
}, 3000);

// ── Migration map ─────────────────────────────────────────────────
//  OLD                                    NEW
//  saveUser()                          →  dbPlant / dbHarvest / dbAddResource
//  balance += x; saveUser()            →  await dbAddBalance(x, 'task-name')
//  seeds += 3;   saveUser()            →  await dbAddResource('seeds', 3)
//  waterCount += 2; saveUser()         →  await dbAddResource('water', 2)
//  _dbCall('save', {...})              →  محذوف نهائياً
//  _dbCall('referral_reward', {...})   →  محذوف — السيرفر يحسبه في harvest
//
//  CELL FLOW:
//  زراعة  →  await dbPlant(i, TOMATO.growTime)
//  حصاد   →  await dbHarvest(i, rewardAmount)
//  ري     →  await dbUpdateCell(i, { watered: true, duration: fastDuration })

*/

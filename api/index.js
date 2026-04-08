/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           🍅 TOMATO FARM — /api/index.js                    ║
 * ║   Supabase REST API (fetch مباشرة — بدون supabase-js)       ║
 * ║   يتوافق مع fetchApi({ type, data }) من index.html          ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * ENV المطلوبة:
 *   NEXT_PUBLIC_SUPABASE_URL      = https://xxxx.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJ...
 *
 * جداول Supabase المطلوبة:
 *   users          (telegram_id, first_name, last_name, username, photo_url,
 *                   balance, seeds, water_count, total_harvests, today_earnings,
 *                   referral_friends, referral_balance, day, created_at)
 *   cells          (telegram_id, cell_index, state, progress, watered)
 *   withdraw_requests (telegram_id, account, amount, status, created_at)
 *   tasks          (telegram_id, task_key, state)   -- idle | joined | done
 */

'use strict';

// ══════════════════════════════════════════
// 1. إعداد Supabase REST
// ══════════════════════════════════════════
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('[API] Missing SUPABASE_URL or SUPABASE_ANON_KEY in env');
}

/** رؤوس مشتركة لكل طلب */
const HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Prefer':        'return=representation',
};

// ══════════════════════════════════════════
// 2. مساعدات REST المركزية
// ══════════════════════════════════════════

/**
 * بناء URL الجدول مع filters اختيارية
 * مثال: tableUrl('users', { telegram_id: 'eq.123' })
 */
function tableUrl(table, filters = {}) {
  const base   = `${SUPABASE_URL}/rest/v1/${table}`;
  const params = new URLSearchParams(filters);
  return params.toString() ? `${base}?${params}` : base;
}

/** SELECT — يرجع [] */
async function dbSelect(table, filters = {}, options = {}) {
  const url = tableUrl(table, filters);
  const headers = { ...HEADERS };
  if (options.single) headers['Accept'] = 'application/vnd.pgrst.object+json';
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) await throwDbError(res, `SELECT ${table}`);
  return res.json();
}

/** INSERT — يرجع الصف المُدرج */
async function dbInsert(table, body) {
  const res = await fetch(tableUrl(table), {
    method:  'POST',
    headers: HEADERS,
    body:    JSON.stringify(body),
  });
  if (!res.ok) await throwDbError(res, `INSERT ${table}`);
  return res.json();
}

/** UPSERT — يدرج أو يُحدِّث */
async function dbUpsert(table, body, onConflict = 'id') {
  const res = await fetch(tableUrl(table) + `?on_conflict=${onConflict}`, {
    method:  'POST',
    headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=representation' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) await throwDbError(res, `UPSERT ${table}`);
  return res.json();
}

/** UPDATE — يرجع الصف المُعدَّل */
async function dbUpdate(table, filters, body) {
  const res = await fetch(tableUrl(table, filters), {
    method:  'PATCH',
    headers: HEADERS,
    body:    JSON.stringify(body),
  });
  if (!res.ok) await throwDbError(res, `UPDATE ${table}`);
  return res.json();
}

/** رمي خطأ قاعدة بيانات مع تفاصيل */
async function throwDbError(res, label) {
  let detail = '';
  try { detail = JSON.stringify(await res.json()); } catch (_) {}
  throw new Error(`[DB] ${label} failed (${res.status}): ${detail}`);
}

// ══════════════════════════════════════════
// 3. مساعدات الأعمال (Business Helpers)
// ══════════════════════════════════════════

/** جلب مستخدم أو إنشاؤه إذا لم يكن موجوداً */
async function getOrCreateUser(tgUser) {
  const { telegram_id, first_name, last_name, username, photo_url } = tgUser;

  const rows = await dbSelect('users', { telegram_id: `eq.${telegram_id}` });

  if (rows.length > 0) {
    // تحديث بيانات الملف الشخصي من تيليغرام (قد تتغير)
    const [updated] = await dbUpdate(
      'users',
      { telegram_id: `eq.${telegram_id}` },
      { first_name, last_name, username, photo_url }
    );
    return updated;
  }

  // مستخدم جديد — القيم الافتراضية
  const [created] = await dbInsert('users', {
    telegram_id,
    first_name:        first_name || '',
    last_name:         last_name  || '',
    username:          username   || '',
    photo_url:         photo_url  || '',
    balance:           0,
    seeds:             3,
    water_count:       3,
    total_harvests:    0,
    today_earnings:    0,
    referral_friends:  0,
    referral_balance:  0,
    day:               1,
  });
  return created;
}

/** جلب خلايا المزرعة (3 خلايا) أو إنشاؤها */
async function getUserCells(telegram_id) {
  const rows = await dbSelect('cells', { telegram_id: `eq.${telegram_id}` });
  if (rows.length === 3) return rows;

  // إنشاء الخلايا الافتراضية
  const defaults = [0, 1, 2].map(i => ({
    telegram_id,
    cell_index: i,
    state:      'empty',
    progress:   0,
    watered:    false,
  }));
  return dbInsert('cells', defaults);
}

// ══════════════════════════════════════════
// 4. معالجات الأكشنات
//    كل دالة: handler(telegram_id, data) → { ok, ...payload }
// ══════════════════════════════════════════

/** ── getState: يرجع حالة اللعبة كاملة ── */
async function actionGetState(telegram_id) {
  const [user, cells] = await Promise.all([
    dbSelect('users', { telegram_id: `eq.${telegram_id}` }, { single: true }),
    getUserCells(telegram_id),
  ]);
  return { ok: true, user, cells };
}

/** ── plant: زرع بذرة في خلية ── */
async function actionPlant(telegram_id, { cellIndex }) {
  const [user, cells] = await Promise.all([
    dbSelect('users', { telegram_id: `eq.${telegram_id}` }, { single: true }),
    getUserCells(telegram_id),
  ]);

  const active = cells.filter(c => c.state !== 'empty').length;
  if (active >= 3)     return { ok: false, error: 'all_plots_busy' };
  if (user.seeds <= 0) return { ok: false, error: 'no_seeds' };

  await Promise.all([
    dbUpdate('users',  { telegram_id: `eq.${telegram_id}` }, { seeds: user.seeds - 1 }),
    dbUpdate('cells',  { telegram_id: `eq.${telegram_id}`, cell_index: `eq.${cellIndex}` },
             { state: 'growing', progress: 0, watered: false }),
  ]);

  return { ok: true, seeds: user.seeds - 1 };
}

/** ── water: سقي خلية ── */
async function actionWater(telegram_id, { cellIndex }) {
  const [user] = await dbSelect('users', { telegram_id: `eq.${telegram_id}` });
  const [cell] = await dbSelect('cells', {
    telegram_id: `eq.${telegram_id}`,
    cell_index:  `eq.${cellIndex}`,
  });

  if (!cell || cell.state !== 'growing') return { ok: false, error: 'cell_not_growing' };
  if (cell.watered)                       return { ok: false, error: 'already_watered' };
  if (user.water_count <= 0)              return { ok: false, error: 'no_water' };

  await Promise.all([
    dbUpdate('users', { telegram_id: `eq.${telegram_id}` }, { water_count: user.water_count - 1 }),
    dbUpdate('cells', { telegram_id: `eq.${telegram_id}`, cell_index: `eq.${cellIndex}` },
             { watered: true }),
  ]);

  return { ok: true, water_count: user.water_count - 1 };
}

/** ── harvest: حصاد خلية ── */
async function actionHarvest(telegram_id, { cellIndex }) {
  const REWARD = 0.0001;
  const REF_PCT = 0.05;

  const [user] = await dbSelect('users', { telegram_id: `eq.${telegram_id}` });
  const [cell] = await dbSelect('cells', {
    telegram_id: `eq.${telegram_id}`,
    cell_index:  `eq.${cellIndex}`,
  });

  if (!cell || cell.state !== 'ready') return { ok: false, error: 'cell_not_ready' };

  const refBonus = user.referral_friends > 0
    ? REWARD * REF_PCT * user.referral_friends : 0;

  await Promise.all([
    dbUpdate('users', { telegram_id: `eq.${telegram_id}` }, {
      balance:          user.balance         + REWARD,
      today_earnings:   user.today_earnings  + REWARD,
      total_harvests:   user.total_harvests  + 1,
      referral_balance: user.referral_balance + refBonus,
    }),
    dbUpdate('cells', { telegram_id: `eq.${telegram_id}`, cell_index: `eq.${cellIndex}` },
             { state: 'empty', progress: 0, watered: false }),
  ]);

  return { ok: true, reward: REWARD, balance: user.balance + REWARD };
}

/** ── harvestAll: حصاد كل الخلايا الجاهزة ── */
async function actionHarvestAll(telegram_id) {
  const cells = await getUserCells(telegram_id);
  const readyCells = cells.filter(c => c.state === 'ready');
  if (!readyCells.length) return { ok: false, error: 'no_ready_cells' };

  const results = await Promise.all(
    readyCells.map(c => actionHarvest(telegram_id, { cellIndex: c.cell_index }))
  );
  return { ok: true, harvested: results.filter(r => r.ok).length };
}

/** ── withdraw: طلب سحب ── */
async function actionWithdraw(telegram_id, { account, amount }) {
  if (!account)            return { ok: false, error: 'no_account' };
  if (!amount || amount<=0)return { ok: false, error: 'invalid_amount' };
  if (amount < 0.05)       return { ok: false, error: 'below_minimum' };

  const [user] = await dbSelect('users', { telegram_id: `eq.${telegram_id}` });
  if (amount > user.balance) return { ok: false, error: 'insufficient_balance' };

  await Promise.all([
    dbUpdate('users', { telegram_id: `eq.${telegram_id}` }, { balance: user.balance - amount }),
    dbInsert('withdraw_requests', {
      telegram_id,
      account,
      amount,
      status:     'pending',
      created_at: new Date().toISOString(),
    }),
  ]);

  return { ok: true, balance: user.balance - amount };
}

/** ── task: تاسكات القنوات ── */
async function actionTask(telegram_id, { taskKey }) {
  const REWARDS = {
    taskEarnChannel: 0.005,
    taskEMoney:      0.005,
  };

  const reward = REWARDS[taskKey];
  if (reward === undefined) return { ok: false, error: 'unknown_task' };

  // جلب حالة التاسك
  const rows = await dbSelect('tasks', {
    telegram_id: `eq.${telegram_id}`,
    task_key:    `eq.${taskKey}`,
  });

  const currentState = rows[0]?.state || 'idle';
  if (currentState === 'done') return { ok: false, error: 'task_already_done' };

  if (currentState === 'idle') {
    // الخطوة الأولى: سجّل "joined"
    await dbUpsert('tasks', {
      telegram_id,
      task_key: taskKey,
      state:    'joined',
    }, 'telegram_id,task_key');
    return { ok: true, state: 'joined' };
  }

  // currentState === 'joined' → أعطِ المكافأة
  const [user] = await dbSelect('users', { telegram_id: `eq.${telegram_id}` });

  await Promise.all([
    dbUpdate('users', { telegram_id: `eq.${telegram_id}` }, { balance: user.balance + reward }),
    dbUpsert('tasks', { telegram_id, task_key: taskKey, state: 'done' }, 'telegram_id,task_key'),
  ]);

  return { ok: true, state: 'done', reward, balance: user.balance + reward };
}

/** ── adReward: مكافأة الإعلانات (seeds / water) ── */
async function actionAdReward(telegram_id, { rewardType, count }) {
  const [user] = await dbSelect('users', { telegram_id: `eq.${telegram_id}` });

  if (rewardType === 'seeds') {
    const seedReward = count === 5 ? 7 : count;
    const newSeeds   = Math.min(99, user.seeds + seedReward);
    await dbUpdate('users', { telegram_id: `eq.${telegram_id}` }, { seeds: newSeeds });
    return { ok: true, seeds: newSeeds };
  }

  if (rewardType === 'water') {
    const newWater = Math.min(99, user.water_count + 3);
    await dbUpdate('users', { telegram_id: `eq.${telegram_id}` }, { water_count: newWater });
    return { ok: true, water_count: newWater };
  }

  return { ok: false, error: 'unknown_reward_type' };
}

/** ── tick: تحديث progress الخلايا (يُستدعى كل ثانية من العميل) ── */
async function actionTick(telegram_id) {
  const GROW_TIME = 30;
  const cells = await getUserCells(telegram_id);

  const updates = [];
  let anyReady  = false;

  for (const c of cells) {
    if (c.state !== 'growing') continue;
    const newProgress = Math.min(GROW_TIME, c.progress + (c.watered ? 3 : 1));
    const newState    = newProgress >= GROW_TIME ? 'ready' : 'growing';
    if (newState === 'ready') anyReady = true;
    updates.push(
      dbUpdate('cells', {
        telegram_id: `eq.${telegram_id}`,
        cell_index:  `eq.${c.cell_index}`,
      }, { progress: newProgress, state: newState })
    );
  }

  if (updates.length) await Promise.all(updates);
  return { ok: true, anyReady };
}

// ══════════════════════════════════════════
// 5. الـ Router الرئيسي
//    يستقبل { type, data, userId } ويوجّه للدالة المناسبة
// ══════════════════════════════════════════

const ACTION_MAP = {
  getState:         (id, data) => actionGetState(id),
  plant:            (id, data) => actionPlant(id, data),
  water:            (id, data) => actionWater(id, data),
  harvest:          (id, data) => actionHarvest(id, data),
  harvestAll:       (id, data) => actionHarvestAll(id),
  withdraw:         (id, data) => actionWithdraw(id, data),
  taskEarnChannel:  (id, data) => actionTask(id, { taskKey: 'taskEarnChannel' }),
  taskEMoney:       (id, data) => actionTask(id, { taskKey: 'taskEMoney' }),
  watchAdSeed:      (id, data) => actionAdReward(id, { rewardType: 'seeds',  count: data?.count || 1 }),
  watchAdWater:     (id, data) => actionAdReward(id, { rewardType: 'water' }),
  tick:             (id, data) => actionTick(id),
};

/**
 * Handler الرئيسي — يصلح لـ:
 *   Next.js API Route  → export default handler
 *   Vercel Serverless  → export default handler
 *   Express            → app.post('/api/action', handler)
 */
export default async function handler(req, res) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { type, data = {}, userId, tgUser } = req.body;

    // ── التحقق من المستخدم ──
    if (!userId && !tgUser?.id) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const telegram_id = userId || String(tgUser.id);

    // ── تسجيل / تحديث المستخدم إذا أُرسلت بيانات تيليغرام ──
    if (tgUser?.id) await getOrCreateUser({ telegram_id, ...tgUser });

    // ── توجيه الأكشن ──
    const fn = ACTION_MAP[type];
    if (!fn) {
      return res.status(400).json({ ok: false, error: `unknown action: ${type}` });
    }

    const result = await fn(telegram_id, data);
    return res.status(200).json(result);

  } catch (err) {
    console.error('[API] Unhandled error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

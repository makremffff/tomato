'use strict';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('[API] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in environment variables');
}

const HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Prefer':        'return=representation',
};

// ─────────────────────────────────────────────────────────────
// REST HELPERS
// ─────────────────────────────────────────────────────────────

function tableUrl(table, filters) {
  const base = `${SUPABASE_URL}/rest/v1/${table}`;
  if (!filters || Object.keys(filters).length === 0) return base;
  const params = new URLSearchParams(filters);
  return `${base}?${params.toString()}`;
}

async function throwDbError(res, label) {
  let detail = '';
  try {
    const body = await res.json();
    detail = JSON.stringify(body);
  } catch (_) {
    detail = res.statusText || 'unknown error';
  }
  throw new Error(`[DB] ${label} failed (${res.status}): ${detail}`);
}

async function dbSelect(table, filters, options) {
  const safeFilters  = filters  || {};
  const safeOptions  = options  || {};
  const url     = tableUrl(table, safeFilters);
  const headers = Object.assign({}, HEADERS);
  if (safeOptions.single) {
    headers['Accept'] = 'application/vnd.pgrst.object+json';
  }
  const res = await fetch(url, { method: 'GET', headers: headers });
  if (!res.ok) {
    await throwDbError(res, 'SELECT ' + table);
  }
  return res.json();
}

async function dbInsert(table, body) {
  const res = await fetch(tableUrl(table), {
    method:  'POST',
    headers: HEADERS,
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    await throwDbError(res, 'INSERT ' + table);
  }
  return res.json();
}

async function dbUpsert(table, body, onConflict) {
  const conflict = onConflict || 'id';
  const url = tableUrl(table) + '?on_conflict=' + conflict;
  const headers = Object.assign({}, HEADERS, {
    'Prefer': 'resolution=merge-duplicates,return=representation',
  });
  const res = await fetch(url, {
    method:  'POST',
    headers: headers,
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    await throwDbError(res, 'UPSERT ' + table);
  }
  return res.json();
}

async function dbUpdate(table, filters, body) {
  const res = await fetch(tableUrl(table, filters), {
    method:  'PATCH',
    headers: HEADERS,
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    await throwDbError(res, 'UPDATE ' + table);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// BUSINESS HELPERS
// ─────────────────────────────────────────────────────────────

async function getOrCreateUser(tgUser) {
  const telegram_id = tgUser.telegram_id;
  const first_name  = tgUser.first_name  || '';
  const last_name   = tgUser.last_name   || '';
  const username    = tgUser.username    || '';
  const photo_url   = tgUser.photo_url   || '';

  const rows = await dbSelect('users', { telegram_id: 'eq.' + telegram_id });

  if (rows.length > 0) {
    const updated = await dbUpdate(
      'users',
      { telegram_id: 'eq.' + telegram_id },
      { first_name: first_name, last_name: last_name, username: username, photo_url: photo_url }
    );
    return updated[0] || updated;
  }

  const created = await dbInsert('users', {
    telegram_id:      telegram_id,
    first_name:       first_name,
    last_name:        last_name,
    username:         username,
    photo_url:        photo_url,
    balance:          0,
    seeds:            3,
    water_count:      3,
    total_harvests:   0,
    today_earnings:   0,
    referral_friends: 0,
    referral_balance: 0,
    day:              1,
  });
  return Array.isArray(created) ? created[0] : created;
}

async function getUserCells(telegram_id) {
  const rows = await dbSelect('cells', { telegram_id: 'eq.' + telegram_id });
  if (rows.length === 3) return rows;

  const defaults = [0, 1, 2].map(function(i) {
    return {
      telegram_id: telegram_id,
      cell_index:  i,
      state:       'empty',
      progress:    0,
      watered:     false,
    };
  });
  const inserted = await dbInsert('cells', defaults);
  return Array.isArray(inserted) ? inserted : defaults;
}

async function getUser(telegram_id) {
  const rows = await dbSelect('users', { telegram_id: 'eq.' + telegram_id });
  if (!rows || rows.length === 0) {
    throw new Error('user_not_found');
  }
  return rows[0];
}

async function getCell(telegram_id, cellIndex) {
  const rows = await dbSelect('cells', {
    telegram_id: 'eq.' + telegram_id,
    cell_index:  'eq.' + cellIndex,
  });
  return rows && rows.length > 0 ? rows[0] : null;
}

// ─────────────────────────────────────────────────────────────
// ACTION HANDLERS
// ─────────────────────────────────────────────────────────────

async function actionGetState(telegram_id) {
  const rows = await dbSelect('users', { telegram_id: 'eq.' + telegram_id });
  if (!rows || rows.length === 0) {
    return { ok: false, error: 'user_not_found' };
  }
  const user  = rows[0];
  const cells = await getUserCells(telegram_id);
  return { ok: true, user: user, cells: cells };
}

async function actionPlant(telegram_id, data) {
  var cellIndex = data && data.cellIndex !== undefined ? data.cellIndex : null;
  if (cellIndex === null || cellIndex === undefined) {
    return { ok: false, error: 'missing_cellIndex' };
  }

  var results = await Promise.all([
    getUser(telegram_id),
    getUserCells(telegram_id),
  ]);
  var user  = results[0];
  var cells = results[1];

  var active = cells.filter(function(c) { return c.state !== 'empty'; }).length;
  if (active >= 3)      return { ok: false, error: 'all_plots_busy' };
  if (user.seeds <= 0)  return { ok: false, error: 'no_seeds' };

  await Promise.all([
    dbUpdate('users', { telegram_id: 'eq.' + telegram_id }, { seeds: user.seeds - 1 }),
    dbUpdate('cells', { telegram_id: 'eq.' + telegram_id, cell_index: 'eq.' + cellIndex },
      { state: 'growing', progress: 0, watered: false }),
  ]);

  return { ok: true, seeds: user.seeds - 1 };
}

async function actionWater(telegram_id, data) {
  var cellIndex = data && data.cellIndex !== undefined ? data.cellIndex : null;
  if (cellIndex === null || cellIndex === undefined) {
    return { ok: false, error: 'missing_cellIndex' };
  }

  var user = await getUser(telegram_id);
  var cell = await getCell(telegram_id, cellIndex);

  if (!cell)                         return { ok: false, error: 'cell_not_found' };
  if (cell.state !== 'growing')      return { ok: false, error: 'cell_not_growing' };
  if (cell.watered)                  return { ok: false, error: 'already_watered' };
  if (user.water_count <= 0)         return { ok: false, error: 'no_water' };

  await Promise.all([
    dbUpdate('users', { telegram_id: 'eq.' + telegram_id }, { water_count: user.water_count - 1 }),
    dbUpdate('cells', { telegram_id: 'eq.' + telegram_id, cell_index: 'eq.' + cellIndex },
      { watered: true }),
  ]);

  return { ok: true, water_count: user.water_count - 1 };
}

async function actionHarvest(telegram_id, data) {
  var REWARD  = 0.0001;
  var REF_PCT = 0.05;

  var cellIndex = data && data.cellIndex !== undefined ? data.cellIndex : null;
  if (cellIndex === null || cellIndex === undefined) {
    return { ok: false, error: 'missing_cellIndex' };
  }

  var user = await getUser(telegram_id);
  var cell = await getCell(telegram_id, cellIndex);

  if (!cell)                  return { ok: false, error: 'cell_not_found' };
  if (cell.state !== 'ready') return { ok: false, error: 'cell_not_ready' };

  var refBonus = user.referral_friends > 0
    ? REWARD * REF_PCT * user.referral_friends
    : 0;

  var newBalance          = parseFloat((user.balance          + REWARD   ).toFixed(6));
  var newTodayEarnings    = parseFloat((user.today_earnings   + REWARD   ).toFixed(6));
  var newTotalHarvests    = user.total_harvests + 1;
  var newReferralBalance  = parseFloat((user.referral_balance + refBonus ).toFixed(6));

  await Promise.all([
    dbUpdate('users', { telegram_id: 'eq.' + telegram_id }, {
      balance:          newBalance,
      today_earnings:   newTodayEarnings,
      total_harvests:   newTotalHarvests,
      referral_balance: newReferralBalance,
    }),
    dbUpdate('cells', { telegram_id: 'eq.' + telegram_id, cell_index: 'eq.' + cellIndex },
      { state: 'empty', progress: 0, watered: false }),
  ]);

  return { ok: true, reward: REWARD, balance: newBalance };
}

async function actionHarvestAll(telegram_id) {
  var cells      = await getUserCells(telegram_id);
  var readyCells = cells.filter(function(c) { return c.state === 'ready'; });
  if (!readyCells.length) return { ok: false, error: 'no_ready_cells' };

  var results = await Promise.all(
    readyCells.map(function(c) {
      return actionHarvest(telegram_id, { cellIndex: c.cell_index });
    })
  );

  var harvested = results.filter(function(r) { return r.ok; }).length;
  return { ok: true, harvested: harvested };
}

async function actionWithdraw(telegram_id, data) {
  var account = data && data.account ? String(data.account).trim() : '';
  var amount  = data && data.amount  ? parseFloat(data.amount)     : 0;

  if (!account)        return { ok: false, error: 'no_account' };
  if (!amount || amount <= 0) return { ok: false, error: 'invalid_amount' };
  if (amount < 0.05)   return { ok: false, error: 'below_minimum' };

  var user = await getUser(telegram_id);
  if (amount > user.balance) return { ok: false, error: 'insufficient_balance' };

  var newBalance = parseFloat((user.balance - amount).toFixed(6));

  await Promise.all([
    dbUpdate('users', { telegram_id: 'eq.' + telegram_id }, { balance: newBalance }),
    dbInsert('withdraw_requests', {
      telegram_id: telegram_id,
      account:     account,
      amount:      amount,
      status:      'pending',
      created_at:  new Date().toISOString(),
    }),
  ]);

  return { ok: true, balance: newBalance };
}

async function actionTask(telegram_id, taskKey) {
  var REWARDS = {
    taskEarnChannel: 0.005,
    taskEMoney:      0.005,
  };

  var reward = REWARDS[taskKey];
  if (reward === undefined) return { ok: false, error: 'unknown_task' };

  var rows         = await dbSelect('tasks', { telegram_id: 'eq.' + telegram_id, task_key: 'eq.' + taskKey });
  var currentState = rows && rows.length > 0 ? rows[0].state : 'idle';

  if (currentState === 'done') return { ok: false, error: 'task_already_done' };

  if (currentState === 'idle') {
    await dbUpsert('tasks', {
      telegram_id: telegram_id,
      task_key:    taskKey,
      state:       'joined',
    }, 'telegram_id,task_key');
    return { ok: true, state: 'joined' };
  }

  var user       = await getUser(telegram_id);
  var newBalance = parseFloat((user.balance + reward).toFixed(6));

  await Promise.all([
    dbUpdate('users', { telegram_id: 'eq.' + telegram_id }, { balance: newBalance }),
    dbUpsert('tasks', { telegram_id: telegram_id, task_key: taskKey, state: 'done' }, 'telegram_id,task_key'),
  ]);

  return { ok: true, state: 'done', reward: reward, balance: newBalance };
}

async function actionAdReward(telegram_id, rewardType, count) {
  var user = await getUser(telegram_id);

  if (rewardType === 'seeds') {
    var seedReward = count === 5 ? 7 : (count || 1);
    var newSeeds   = Math.min(99, user.seeds + seedReward);
    await dbUpdate('users', { telegram_id: 'eq.' + telegram_id }, { seeds: newSeeds });
    return { ok: true, seeds: newSeeds };
  }

  if (rewardType === 'water') {
    var newWater = Math.min(99, user.water_count + 3);
    await dbUpdate('users', { telegram_id: 'eq.' + telegram_id }, { water_count: newWater });
    return { ok: true, water_count: newWater };
  }

  return { ok: false, error: 'unknown_reward_type' };
}

async function actionTick(telegram_id) {
  var GROW_TIME = 30;
  var cells     = await getUserCells(telegram_id);

  var updates  = [];
  var anyReady = false;

  for (var i = 0; i < cells.length; i++) {
    var c = cells[i];
    if (c.state !== 'growing') continue;

    var newProgress = Math.min(GROW_TIME, c.progress + (c.watered ? 3 : 1));
    var newState    = newProgress >= GROW_TIME ? 'ready' : 'growing';
    if (newState === 'ready') anyReady = true;

    updates.push(
      dbUpdate('cells', {
        telegram_id: 'eq.' + telegram_id,
        cell_index:  'eq.' + c.cell_index,
      }, { progress: newProgress, state: newState })
    );
  }

  if (updates.length > 0) await Promise.all(updates);
  return { ok: true, anyReady: anyReady };
}

// ─────────────────────────────────────────────────────────────
// ACTION ROUTER
// ─────────────────────────────────────────────────────────────

async function routeAction(type, telegram_id, data) {
  switch (type) {
    case 'getState':
      return actionGetState(telegram_id);

    case 'plant':
      return actionPlant(telegram_id, data);

    case 'water':
      return actionWater(telegram_id, data);

    case 'harvest':
      return actionHarvest(telegram_id, data);

    case 'harvestAll':
      return actionHarvestAll(telegram_id);

    case 'withdraw':
      return actionWithdraw(telegram_id, data);

    case 'taskEarnChannel':
      return actionTask(telegram_id, 'taskEarnChannel');

    case 'taskEMoney':
      return actionTask(telegram_id, 'taskEMoney');

    case 'watchAdSeed':
      return actionAdReward(telegram_id, 'seeds', data && data.count ? data.count : 1);

    case 'watchAdWater':
      return actionAdReward(telegram_id, 'water', 0);

    case 'tick':
      return actionTick(telegram_id);

    default:
      return { ok: false, error: 'unknown action: ' + type };
  }
}

// ─────────────────────────────────────────────────────────────
// VERCEL / NEXT.JS HANDLER
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' });
  }

  var body = req.body;

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Request body must be JSON.' });
  }

  var type   = body.type   || null;
  var data   = body.data   || {};
  var userId = body.userId || null;
  var tgUser = body.tgUser || null;

  if (!type) {
    return res.status(400).json({ ok: false, error: 'Missing required field: type' });
  }

  var telegram_id = null;

  if (userId) {
    telegram_id = String(userId);
  } else if (tgUser && tgUser.id) {
    telegram_id = String(tgUser.id);
  }

  if (!telegram_id) {
    return res.status(401).json({ ok: false, error: 'unauthorized: missing userId or tgUser.id' });
  }

  try {
    if (tgUser && tgUser.id) {
      await getOrCreateUser({
        telegram_id: telegram_id,
        first_name:  tgUser.first_name  || '',
        last_name:   tgUser.last_name   || '',
        username:    tgUser.username    || '',
        photo_url:   tgUser.photo_url   || '',
      });
    }

    var result = await routeAction(type, telegram_id, data);
    return res.status(200).json(result);

  } catch (err) {
    console.error('[API] Error — type:', type, '| telegram_id:', telegram_id, '| error:', err.message);
    return res.status(500).json({ ok: false, error: err.message || 'internal_server_error' });
  }
}

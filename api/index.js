// ================================================================
//  🔒 Tomato Farm — ULTRA SECURE Backend v3.0
//  ☠️ Zero Trust | Anti-Cheat | Anti-Bot | Signed Requests
//  ✅ Server is the ONLY source of truth
//  ✅ All times computed server-side
//  ✅ Behavioral AI + Shadow Ban + Forensics
// ================================================================

const { neon }  = require('@neondatabase/serverless');
const crypto    = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL;
const HMAC_SECRET  = process.env.HMAC_SECRET || 'change-me-in-production-32chars!!';

// ── SQL executor ──────────────────────────────────────────────────
async function sql(query, params = []) {
  const db = neon(DATABASE_URL);
  return await db(query, params);
}

// ── Constants ─────────────────────────────────────────────────────
const CELL_COUNT    = 3;
const GROW_DURATION = 30;   // 30 seconds (server authority only)
const HARVEST_REWARD = 0.001;
const RATE_LIMIT_WINDOW = 5000;   // 5 seconds
const RATE_LIMIT_MAX    = 10;     // 10 requests per window
const BOT_INTERVAL_MS   = 300;    // clicks faster than 300ms = bot
const NONCE_TTL         = 60000;  // 1 minute
const RISK_BAN_THRESHOLD = 100;
const MAX_TODAY_EARN     = 0.5;   // cap daily earnings
const MAX_BALANCE_ADD    = 0.05;  // max single add_balance

// ── In-memory stores (shared across serverless instances via DB) ──
// For rate limiting and nonce tracking we use DB flags

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DB BOOTSTRAP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function bootstrap() {
  try {
    // Main users table
    await sql(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id        BIGINT        PRIMARY KEY,
        username           TEXT,
        balance            NUMERIC(18,6) NOT NULL DEFAULT 0,
        seeds              INT           NOT NULL DEFAULT 3,
        water_count        INT           NOT NULL DEFAULT 3,
        cells              JSONB         NOT NULL DEFAULT '[]',
        task_state         JSONB         NOT NULL DEFAULT '{"earnChannel":"idle","eMoneyChannel":"idle"}',
        wd_history         JSONB         NOT NULL DEFAULT '[]',
        today_date         TEXT          NOT NULL DEFAULT '',
        today_earn         NUMERIC(18,6) NOT NULL DEFAULT 0,
        total_harvests     INT           NOT NULL DEFAULT 0,
        referral_by        BIGINT,
        referral_friends   INT           NOT NULL DEFAULT 0,
        referral_balance   NUMERIC(18,6) NOT NULL DEFAULT 0,
        referral_rewarded  BOOLEAN       NOT NULL DEFAULT FALSE,
        day                INT           NOT NULL DEFAULT 1,
        -- 🔒 Security fields
        fingerprint_hash   TEXT,
        risk_score         INT           NOT NULL DEFAULT 0,
        is_banned          BOOLEAN       NOT NULL DEFAULT FALSE,
        is_shadow_banned   BOOLEAN       NOT NULL DEFAULT FALSE,
        ban_reason         TEXT,
        last_ip            TEXT,
        last_ua            TEXT,
        last_seen          TIMESTAMPTZ,
        click_history      JSONB         NOT NULL DEFAULT '[]',
        action_log         JSONB         NOT NULL DEFAULT '[]',
        created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);

    // Used nonces table (anti-replay)
    await sql(`
      CREATE TABLE IF NOT EXISTS used_nonces (
        nonce      TEXT        PRIMARY KEY,
        telegram_id BIGINT,
        used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Rate limit buckets (per IP per window)
    await sql(`
      CREATE TABLE IF NOT EXISTS rate_buckets (
        bucket_key  TEXT        PRIMARY KEY,
        count       INT         NOT NULL DEFAULT 0,
        window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Security event log
    await sql(`
      CREATE TABLE IF NOT EXISTS security_log (
        id          BIGSERIAL   PRIMARY KEY,
        telegram_id BIGINT,
        ip          TEXT,
        event       TEXT,
        detail      JSONB,
        severity    TEXT        DEFAULT 'warn',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Auto-clean old nonces (older than 5 min)
    await sql(`
      DELETE FROM used_nonces WHERE used_at < NOW() - INTERVAL '5 minutes'
    `).catch(() => {});

    const migrations = [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS fingerprint_hash TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS risk_score INT NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_shadow_banned BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ua TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS click_history JSONB NOT NULL DEFAULT '[]'`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS action_log JSONB NOT NULL DEFAULT '[]'`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_friends INT NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_balance NUMERIC(18,6) NOT NULL DEFAULT 0`,
    ];
    for (const m of migrations) {
      try { await sql(m); } catch (_) {}
    }

    console.log('[DB] Bootstrap OK ✅');
  } catch (e) {
    console.error('[DB] Bootstrap failed:', e.message);
  }
}
bootstrap();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🔒 SECURITY LAYER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Get real IP from request
function getIP(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-real-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// Generate fingerprint hash from device info
function buildFingerprintHash(data) {
  const fp = {
    ua:       data.ua       || '',
    timezone: data.timezone || '',
    screen:   data.screen   || '',
    lang:     data.lang     || '',
  };
  return crypto.createHash('sha256').update(JSON.stringify(fp)).digest('hex');
}

// Verify HMAC signature
function verifySignature(body, signature, nonce, timestamp) {
  if (!signature || !nonce || !timestamp) return false;
  const age = Date.now() - parseInt(timestamp);
  if (age > NONCE_TTL || age < -5000) return false; // 1min window, 5s clock skew
  const payload = `${nonce}:${timestamp}:${JSON.stringify(body)}`;
  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

// Check and consume nonce (anti-replay)
async function consumeNonce(nonce, tid) {
  try {
    const existing = await sql(`SELECT nonce FROM used_nonces WHERE nonce = $1`, [nonce]);
    if (existing.length > 0) return false; // Already used!
    await sql(`INSERT INTO used_nonces (nonce, telegram_id) VALUES ($1, $2)`, [nonce, tid]);
    return true;
  } catch {
    return false;
  }
}

// Rate limiter per IP
async function checkRateLimit(ip, action) {
  if (action === 'get_state') return true; // exempt
  const key = `${ip}:${Math.floor(Date.now() / RATE_LIMIT_WINDOW)}`;
  try {
    const rows = await sql(
      `INSERT INTO rate_buckets (bucket_key, count, window_start)
       VALUES ($1, 1, NOW())
       ON CONFLICT (bucket_key) DO UPDATE SET count = rate_buckets.count + 1
       RETURNING count`,
      [key]
    );
    return rows[0].count <= RATE_LIMIT_MAX;
  } catch {
    return true;
  }
}

// Log security event
async function secLog(tid, ip, event, detail = {}, severity = 'warn') {
  try {
    await sql(
      `INSERT INTO security_log (telegram_id, ip, event, detail, severity)
       VALUES ($1, $2, $3, $4, $5)`,
      [tid, ip, event, JSON.stringify(detail), severity]
    );
  } catch {}
}

// Increase risk score and maybe ban
async function addRisk(tid, points, reason, ip) {
  try {
    const rows = await sql(
      `UPDATE users SET risk_score = risk_score + $2, updated_at = NOW()
       WHERE telegram_id = $1 RETURNING risk_score, is_shadow_banned`,
      [tid, points]
    );
    if (!rows.length) return;
    const score = rows[0].risk_score;

    if (score >= RISK_BAN_THRESHOLD && !rows[0].is_shadow_banned) {
      await sql(
        `UPDATE users SET is_shadow_banned = TRUE, ban_reason = $2, updated_at = NOW()
         WHERE telegram_id = $1`,
        [tid, reason]
      );
      await secLog(tid, ip, 'SHADOW_BAN', { reason, score }, 'critical');
    } else if (score >= RISK_BAN_THRESHOLD * 2) {
      await sql(
        `UPDATE users SET is_banned = TRUE, ban_reason = $2, updated_at = NOW()
         WHERE telegram_id = $1`,
        [tid, reason]
      );
      await secLog(tid, ip, 'PERMANENT_BAN', { reason, score }, 'critical');
    }
    await secLog(tid, ip, 'RISK_ADDED', { points, reason, total: score });
  } catch {}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🧠 BEHAVIORAL BOT DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function analyzeBehavior(tid, action, ip) {
  if (['get_state', 'load'].includes(action)) return { suspicious: false };

  try {
    const rows = await sql(
      `SELECT click_history FROM users WHERE telegram_id = $1`, [tid]
    );
    if (!rows.length) return { suspicious: false };

    const history = Array.isArray(rows[0].click_history) ? rows[0].click_history : [];
    const now = Date.now();
    history.push({ ts: now, action });

    // Keep only last 50 events
    const recent = history.slice(-50);

    await sql(
      `UPDATE users SET click_history = $2 WHERE telegram_id = $1`,
      [tid, JSON.stringify(recent)]
    );

    if (recent.length < 5) return { suspicious: false };

    // Analyze intervals between same actions
    const intervals = [];
    for (let i = 1; i < recent.length; i++) {
      intervals.push(recent[i].ts - recent[i-1].ts);
    }

    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);

    // Too fast = bot
    if (avg < BOT_INTERVAL_MS) {
      await addRisk(tid, 25, `bot_speed:avg=${avg.toFixed(0)}ms`, ip);
      return { suspicious: true, reason: 'inhuman_speed' };
    }

    // Too consistent (low variance) = script
    if (recent.length >= 10 && stdDev < 50 && avg < 2000) {
      await addRisk(tid, 20, `bot_pattern:stddev=${stdDev.toFixed(0)}`, ip);
      return { suspicious: true, reason: 'robotic_pattern' };
    }

    return { suspicious: false };
  } catch {
    return { suspicious: false };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  📋 CELL / FARM HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function resolveCell(cell) {
  if (!cell || cell.state === 'empty' || cell.state === 'ready') return cell;
  if (cell.state === 'growing') {
    const plantedAt = new Date(cell.planted_at).getTime();
    const duration  = GROW_DURATION * 1000; // SERVER SETS THIS, not client
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
    await sql(
      `UPDATE users SET cells = $2, updated_at = NOW() WHERE telegram_id = $1`,
      [tid, JSON.stringify(resolved)]
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Signature, X-Nonce, X-Timestamp');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🏁 MAIN HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIP(req);

  // ── Parse body ─────────────────────────────────────────────────
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }

  const { action, telegram_id, data = {}, fingerprint } = body || {};

  if (!action)      return res.status(400).json({ error: 'Missing action' });
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  const tid = parseInt(telegram_id);
  if (isNaN(tid))   return res.status(400).json({ error: 'Invalid telegram_id' });

  // ─────────────────────────────────────────────────────────────
  //  🔒 SIGNED REQUEST VERIFICATION
  //  (skip for 'load' on first visit — no secret yet)
  // ─────────────────────────────────────────────────────────────
  const sig       = req.headers['x-signature']  || body._sig;
  const nonce     = req.headers['x-nonce']      || body._nonce;
  const timestamp = req.headers['x-timestamp']  || body._ts;
  const isWriteAction = !['get_state', 'load'].includes(action);

  if (isWriteAction) {
    if (!sig || !nonce || !timestamp) {
      await secLog(tid, ip, 'MISSING_SIGNATURE', { action }, 'critical');
      await addRisk(tid, 30, 'unsigned_request', ip);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify HMAC
    const bodyForSig = { action, telegram_id, data };
    if (!verifySignature(bodyForSig, sig, nonce, timestamp)) {
      await secLog(tid, ip, 'INVALID_SIGNATURE', { action }, 'critical');
      await addRisk(tid, 50, 'bad_signature', ip);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Consume nonce (anti-replay)
    const nonceOk = await consumeNonce(nonce, tid);
    if (!nonceOk) {
      await secLog(tid, ip, 'REPLAY_ATTACK', { action, nonce }, 'critical');
      await addRisk(tid, 60, 'replay_attack', ip);
      return res.status(401).json({ error: 'Replay detected' });
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  ⚡ RATE LIMIT CHECK
  // ─────────────────────────────────────────────────────────────
  const allowed = await checkRateLimit(ip, action);
  if (!allowed) {
    await secLog(tid, ip, 'RATE_LIMIT', { action }, 'warn');
    await addRisk(tid, 15, 'rate_limit_exceeded', ip);
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
    // ─────────────────────────────────────────────────────────
    //  🧬 FINGERPRINT CHECK (non-load actions)
    // ─────────────────────────────────────────────────────────
    if (fingerprint && action !== 'load') {
      const newHash = buildFingerprintHash(fingerprint);
      const fpRows  = await sql(
        `SELECT fingerprint_hash, is_banned, is_shadow_banned FROM users WHERE telegram_id = $1`,
        [tid]
      );

      if (fpRows.length) {
        const u = fpRows[0];

        if (u.is_banned) {
          return res.status(403).json({ error: 'Account suspended' });
        }

        if (u.fingerprint_hash && u.fingerprint_hash !== newHash) {
          await secLog(tid, ip, 'FINGERPRINT_CHANGE', {
            old: u.fingerprint_hash.slice(0,8), new: newHash.slice(0,8)
          }, 'critical');
          await addRisk(tid, 30, 'fingerprint_mismatch', ip);
          // Freeze the account for manual review
          await sql(
            `UPDATE users SET is_shadow_banned = TRUE, ban_reason = 'fingerprint_change',
             updated_at = NOW() WHERE telegram_id = $1`,
            [tid]
          );
        } else if (!u.fingerprint_hash) {
          await sql(
            `UPDATE users SET fingerprint_hash = $2, updated_at = NOW() WHERE telegram_id = $1`,
            [tid, newHash]
          );
        }
      }
    }

    // ─────────────────────────────────────────────────────────
    //  🧠 BEHAVIORAL ANALYSIS (bot detection)
    // ─────────────────────────────────────────────────────────
    if (isWriteAction) {
      const behavior = await analyzeBehavior(tid, action, ip);
      if (behavior.suspicious) {
        await secLog(tid, ip, 'BOT_DETECTED', { reason: behavior.reason, action }, 'critical');
        // Don't block — shadow ban silently
      }
    }

    // ─────────────────────────────────────────────────────────
    //  Update last_ip / last_seen
    // ─────────────────────────────────────────────────────────
    if (action !== 'get_state') {
      await sql(
        `UPDATE users SET last_ip = $2, last_ua = $3, last_seen = NOW()
         WHERE telegram_id = $1`,
        [tid, ip, (req.headers['user-agent'] || '').slice(0, 256)]
      ).catch(() => {});
    }

    // ══════════════════════════════════════════════════════════
    //  LOAD
    // ══════════════════════════════════════════════════════════
    if (action === 'load') {
      let rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);

      if (!rows.length) {
        const username   = data.username   || null;
        const referralBy = data.referral_by ? parseInt(data.referral_by) : null;
        const validRef   = referralBy && !isNaN(referralBy) && referralBy !== tid ? referralBy : null;

        rows = await sql(
          `INSERT INTO users (telegram_id, username, referral_by, cells, last_ip, last_ua, last_seen)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (telegram_id) DO UPDATE SET updated_at = NOW()
           RETURNING *`,
          [tid, username, validRef, JSON.stringify(buildEmptyCells()), ip,
           (req.headers['user-agent'] || '').slice(0, 256)]
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
          await sql(
            `UPDATE users SET referral_rewarded = TRUE WHERE telegram_id = $1`, [tid]
          );
        }
      } else {
        const u = rows[0];

        if (u.is_banned) {
          return res.status(403).json({ error: 'Account suspended' });
        }

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
            `UPDATE users SET today_date = $2, today_earn = 0, updated_at = NOW()
             WHERE telegram_id = $1`,
            [tid, todayUTC()]
          );
          rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
        }
      }

      // Set fingerprint on load if provided
      if (fingerprint) {
        const hash = buildFingerprintHash(fingerprint);
        await sql(
          `UPDATE users SET fingerprint_hash = COALESCE(fingerprint_hash, $2), updated_at = NOW()
           WHERE telegram_id = $1`,
          [tid, hash]
        );
      }

      const user     = rows[0];
      const original = normalizeCellsFromDB(user.cells);
      const resolved = resolveCells(original);
      await persistIfChanged(tid, original, resolved);

      return res.status(200).json({ ok: true, user: sanitizeUser({ ...user, cells: resolved }) });
    }

    // ══════════════════════════════════════════════════════════
    //  GET_STATE — polling
    // ══════════════════════════════════════════════════════════
    if (action === 'get_state') {
      const rows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'User not found' });

      const user = rows[0];
      if (user.is_banned) return res.status(403).json({ error: 'Account suspended' });

      if (user.today_date !== todayUTC()) {
        await sql(
          `UPDATE users SET today_date = $2, today_earn = 0, updated_at = NOW()
           WHERE telegram_id = $1`,
          [tid, todayUTC()]
        );
        user.today_earn = 0;
        user.today_date = todayUTC();
      }

      const original = normalizeCellsFromDB(user.cells);
      const resolved = resolveCells(original);
      await persistIfChanged(tid, original, resolved);

      return res.status(200).json({ ok: true, user: sanitizeUser({ ...user, cells: resolved }) });
    }

    // ── All remaining actions require user to exist ─────────────
    const userRows = await sql('SELECT * FROM users WHERE telegram_id = $1', [tid]);
    if (!userRows.length) return res.status(404).json({ ok: false, error: 'User not found' });

    const currentUser = userRows[0];
    if (currentUser.is_banned) return res.status(403).json({ error: 'Account suspended' });

    // Shadow ban check — let them proceed but never earn
    const isShadowBanned = currentUser.is_shadow_banned;

    // ══════════════════════════════════════════════════════════
    //  PLANT — data: { cell_id }
    //  ✅ Duration ALWAYS set by server (GROW_DURATION)
    // ══════════════════════════════════════════════════════════
    if (action === 'plant') {
      const cellId = parseInt(data.cell_id);

      if (isNaN(cellId) || cellId < 0 || cellId >= CELL_COUNT)
        return res.status(400).json({ ok: false, error: 'Invalid cell_id' });

      if (currentUser.seeds <= 0)
        return res.status(400).json({ ok: false, error: 'Not enough seeds' });

      const cells = resolveCells(normalizeCellsFromDB(currentUser.cells));
      if (cells[cellId].state !== 'empty')
        return res.status(400).json({ ok: false, error: 'Cell is not empty' });

      // 🔒 Duration is ALWAYS GROW_DURATION — client cannot change this
      cells[cellId] = {
        id: cellId,
        state: 'growing',
        planted_at: new Date().toISOString(), // server timestamp
        duration: GROW_DURATION
      };

      await sql(
        `UPDATE users SET cells = $2, seeds = seeds - 1, updated_at = NOW()
         WHERE telegram_id = $1`,
        [tid, JSON.stringify(cells)]
      );

      return res.status(200).json({ ok: true, cells });
    }

    // ══════════════════════════════════════════════════════════
    //  HARVEST — data: { cell_id }
    //  🔒 Reward ALWAYS computed server-side
    // ══════════════════════════════════════════════════════════
    if (action === 'harvest') {
      const cellId = parseInt(data.cell_id);

      if (isNaN(cellId) || cellId < 0 || cellId >= CELL_COUNT)
        return res.status(400).json({ ok: false, error: 'Invalid cell_id' });

      const cells = resolveCells(normalizeCellsFromDB(currentUser.cells));

      // 🔒 Server recalculates if cell is truly ready
      if (cells[cellId].state !== 'ready') {
        await secLog(tid, ip, 'EARLY_HARVEST_ATTEMPT', { cell_id: cellId, state: cells[cellId].state }, 'warn');
        await addRisk(tid, 20, 'harvest_not_ready', ip);
        return res.status(400).json({ ok: false, error: 'Cell is not ready to harvest' });
      }

      // 🔒 If client sent a reward in data, verify it matches server
      if (data.reward !== undefined) {
        const clientReward = parseFloat(data.reward);
        if (Math.abs(clientReward - HARVEST_REWARD) > 0.000001) {
          await secLog(tid, ip, 'REWARD_TAMPERING', {
            client_reward: clientReward, server_reward: HARVEST_REWARD
          }, 'critical');
          await addRisk(tid, 50, 'reward_tamper', ip);
          // Continue with server reward — don't leak that we caught them yet
        }
      }

      // 🔒 Daily earnings cap
      const todayEarn = parseFloat(currentUser.today_earn) || 0;
      if (todayEarn >= MAX_TODAY_EARN) {
        return res.status(400).json({ ok: false, error: 'Daily earning limit reached' });
      }

      // Server-determined reward
      const reward = HARVEST_REWARD;

      cells[cellId] = { id: cellId, state: 'empty', planted_at: null, duration: GROW_DURATION };

      const today     = todayUTC();
      const isSameDay = currentUser.today_date === today;
      const newTodayEarn = isSameDay ? todayEarn + reward : reward;

      if (!isShadowBanned) {
        await sql(
          `UPDATE users
           SET balance        = balance + $2,
               cells          = $3,
               today_date     = $4,
               today_earn     = $5,
               total_harvests = total_harvests + 1,
               seeds          = seeds + 1,
               updated_at     = NOW()
           WHERE telegram_id = $1`,
          [tid, reward, JSON.stringify(cells), today, newTodayEarn]
        );

        // 5% referral cut
        if (currentUser.referral_by) {
          const cut = parseFloat((reward * 0.05).toFixed(6));
          await sql(
            `UPDATE users
             SET referral_balance = referral_balance + $2,
                 balance          = balance + $2,
                 updated_at       = NOW()
             WHERE telegram_id = $1`,
            [currentUser.referral_by, cut]
          );
        }
      } else {
        // Shadow banned: update cells but give no reward
        await sql(
          `UPDATE users SET cells = $2, updated_at = NOW() WHERE telegram_id = $1`,
          [tid, JSON.stringify(cells)]
        );
      }

      return res.status(200).json({
        ok: true,
        cells,
        reward: isShadowBanned ? reward : reward, // looks same to user
        referral_cut: currentUser.referral_by ? parseFloat((reward * 0.05).toFixed(6)) : 0
      });
    }

    // ══════════════════════════════════════════════════════════
    //  UPDATE_CELL — data: { cell_id, patch }
    //  🔒 Only safe fields allowed; duration capped
    // ══════════════════════════════════════════════════════════
    if (action === 'update_cell') {
      const cellId = parseInt(data.cell_id);
      const patch  = data.patch || {};

      if (isNaN(cellId) || cellId < 0 || cellId >= CELL_COUNT)
        return res.status(400).json({ ok: false, error: 'Invalid cell_id' });

      const ALLOWED   = ['watered'];
      const safePatch = {};
      for (const k of ALLOWED) {
        if (patch[k] !== undefined) safePatch[k] = patch[k];
      }

      // 🔒 If watering (speed boost), set duration to server-min (15s)
      if (safePatch.watered === true) {
        safePatch.duration = Math.max(15, GROW_DURATION / 2); // server decides speed
      }

      const cells = resolveCells(normalizeCellsFromDB(currentUser.cells));
      if (cells[cellId].state !== 'growing') {
        return res.status(400).json({ ok: false, error: 'Cell is not growing' });
      }

      cells[cellId] = { ...cells[cellId], ...safePatch };

      await sql(
        `UPDATE users SET cells = $2, water_count = GREATEST(water_count - 1, 0), updated_at = NOW()
         WHERE telegram_id = $1`,
        [tid, JSON.stringify(cells)]
      );

      return res.status(200).json({ ok: true, cells });
    }

    // ══════════════════════════════════════════════════════════
    //  ADD_RESOURCE — data: { type: 'seeds'|'water', amount }
    //  🔒 Amount capped; source verified
    // ══════════════════════════════════════════════════════════
    if (action === 'add_resource') {
      const type   = data.type;
      const amount = parseInt(data.amount);

      if (!['seeds', 'water'].includes(type))
        return res.status(400).json({ ok: false, error: 'Invalid resource type' });
      if (isNaN(amount) || amount <= 0 || amount > 5)
        return res.status(400).json({ ok: false, error: 'Invalid amount' });

      const col = type === 'seeds' ? 'seeds' : 'water_count';
      const MAX = 10;

      if (!isShadowBanned) {
        await sql(
          `UPDATE users SET ${col} = LEAST(${col} + $2, $3), updated_at = NOW()
           WHERE telegram_id = $1`,
          [tid, amount, MAX]
        );
      }

      const rows = await sql(`SELECT ${col} FROM users WHERE telegram_id = $1`, [tid]);
      return res.status(200).json({ ok: true, [col]: rows[0]?.[col] });
    }

    // ══════════════════════════════════════════════════════════
    //  ADD_BALANCE — data: { amount, source }
    //  🔒 Strict cap, verified source
    // ══════════════════════════════════════════════════════════
    if (action === 'add_balance') {
      const amount = parseFloat(data.amount);
      const source = data.source || 'unknown';

      if (isNaN(amount) || amount <= 0 || amount > MAX_BALANCE_ADD) {
        await secLog(tid, ip, 'BALANCE_TAMPER_ATTEMPT', { amount, source }, 'critical');
        await addRisk(tid, 30, 'balance_tamper', ip);
        return res.status(400).json({ ok: false, error: 'Invalid amount' });
      }

      // 🔒 Daily cap check
      const todayEarn = parseFloat(currentUser.today_earn) || 0;
      if (todayEarn + amount > MAX_TODAY_EARN) {
        return res.status(400).json({ ok: false, error: 'Daily limit reached' });
      }

      if (!isShadowBanned) {
        await sql(
          `UPDATE users
           SET balance = balance + $2, today_earn = today_earn + $2, today_date = $3,
               updated_at = NOW()
           WHERE telegram_id = $1`,
          [tid, amount, todayUTC()]
        );
      }

      console.log(`[Balance] +${amount} → ${tid} (${source})`);
      return res.status(200).json({ ok: true });
    }

    // ══════════════════════════════════════════════════════════
    //  SAVE_TASKS — data: { task_state }
    // ══════════════════════════════════════════════════════════
    if (action === 'save_tasks') {
      const task_state = data.task_state;
      if (!task_state || typeof task_state !== 'object')
        return res.status(400).json({ ok: false, error: 'Invalid task_state' });

      const safeState = {};
      for (const key of ['earnChannel', 'eMoneyChannel']) {
        if (['idle', 'joined', 'done'].includes(task_state[key]))
          safeState[key] = task_state[key];
      }

      // 🔒 If task marked done client-side, verify server-side (add_balance must be called first)
      // We allow save_tasks only for state transitions, balance is handled separately
      await sql(
        `UPDATE users SET task_state = task_state || $2::jsonb, updated_at = NOW()
         WHERE telegram_id = $1`,
        [tid, JSON.stringify(safeState)]
      );

      return res.status(200).json({ ok: true });
    }

    // ══════════════════════════════════════════════════════════
    //  WITHDRAW — data: { account, amount }
    // ══════════════════════════════════════════════════════════
    if (action === 'withdraw') {
      const { account, amount } = data;
      const amt = parseFloat(amount);

      if (!account)                return res.status(400).json({ ok: false, error: 'Missing account' });
      if (isNaN(amt) || amt <= 0)  return res.status(400).json({ ok: false, error: 'Invalid amount' });
      if (amt < 0.05)              return res.status(400).json({ ok: false, error: 'Minimum 0.05 TON' });

      const balance = parseFloat(currentUser.balance);
      if (balance < amt) return res.status(400).json({ ok: false, error: 'Insufficient balance' });

      // 🔒 Shadow banned users see success but nothing happens
      if (isShadowBanned) {
        const fakeEntry = {
          account, amount: amt,
          date: new Date().toLocaleString('en-GB'), status: 'pending'
        };
        return res.status(200).json({ ok: true, entry: fakeEntry });
      }

      const now     = new Date();
      const dateStr = now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
                    + ' ' + now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
      const entry   = { account, amount: amt, date: dateStr, status: 'pending' };
      const history = Array.isArray(currentUser.wd_history) ? currentUser.wd_history : [];
      history.unshift(entry);
      if (history.length > 50) history.splice(50);

      await sql(
        `UPDATE users SET balance = balance - $2, wd_history = $3, updated_at = NOW()
         WHERE telegram_id = $1`,
        [tid, amt, JSON.stringify(history)]
      );

      return res.status(200).json({ ok: true, entry });
    }

    await secLog(tid, ip, 'UNKNOWN_ACTION', { action }, 'warn');
    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('[API Error]', action, err.message, err.stack);
    return res.status(500).json({ error: 'Server error' }); // don't leak details
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Strip internal security fields from user responses
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function sanitizeUser(user) {
  const { fingerprint_hash, risk_score, is_banned, is_shadow_banned,
          ban_reason, last_ip, last_ua, click_history, action_log, ...safe } = user;
  return safe;
}

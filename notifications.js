// ================================================================
//  Tomato Farm — Notification System
//  sendNotification | broadcast | checkAndNotifyUsers
// ================================================================

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
const BOT_TOKEN    = process.env.BOT_TOKEN;

// ── SQL executor ─────────────────────────────────────────────────
async function sql(query, params = []) {
  const db = neon(DATABASE_URL);
  return await db(query, params);
}

// ── Config ───────────────────────────────────────────────────────
const NOTIFY_COOLDOWN_MS  = 10 * 60 * 1000; // 10 min between same-type notifications
const BATCH_SIZE          = 20;              // users per batch
const BATCH_DELAY_MS      = 700;             // ~28 req/sec (safe under 30)
const CHECK_INTERVAL_MS   = 30 * 1000;       // check every 30 seconds

// ── Notification types ───────────────────────────────────────────
const NOTIFY_TYPES = {
  ready  : 'ready',
  reward : 'reward',
  system : 'system',
};

// ── Migration: add last_notified column if missing ───────────────
async function migrateNotifyColumn() {
  try {
    await sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_notified JSONB NOT NULL DEFAULT '{}'`);
    console.log('[Notify] Migration OK — last_notified column ready');
  } catch (e) {
    console.error('[Notify] Migration failed:', e.message);
  }
}

// ================================================================
//  sendNotification(userId, message, type)
//  Sends a Telegram message to a single user.
//  Handles: blocked users, invalid chat, rate limit errors.
//  Returns: { ok: true } or { ok: false, reason }
// ================================================================
async function sendNotification(userId, message, type = NOTIFY_TYPES.system) {
  if (!BOT_TOKEN) {
    console.error('[Notify] BOT_TOKEN missing');
    return { ok: false, reason: 'no_token' };
  }

  // ── Check cooldown ───────────────────────────────────────────
  try {
    const rows = await sql(
      `SELECT last_notified, shadow_banned, is_hard_banned FROM users WHERE telegram_id = $1`,
      [userId]
    );

    if (!rows.length) return { ok: false, reason: 'user_not_found' };

    const user = rows[0];

    // Skip banned users silently
    if (user.shadow_banned || user.is_hard_banned) {
      return { ok: false, reason: 'banned' };
    }

    // Check per-type cooldown
    const lastNotified = user.last_notified || {};
    const lastTime     = lastNotified[type] ? new Date(lastNotified[type]).getTime() : 0;
    const now          = Date.now();

    if (now - lastTime < NOTIFY_COOLDOWN_MS) {
      const remainSec = Math.ceil((NOTIFY_COOLDOWN_MS - (now - lastTime)) / 1000);
      return { ok: false, reason: 'cooldown', remainSec };
    }
  } catch (dbErr) {
    console.error(`[Notify] DB check error for ${userId}:`, dbErr.message);
    return { ok: false, reason: 'db_error' };
  }

  // ── Send via Telegram Bot API ────────────────────────────────
  try {
    const url  = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const body = {
      chat_id    : userId,
      text       : message,
      parse_mode : 'HTML',
    };

    const res  = await fetch(url, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify(body),
    });

    const data = await res.json();

    if (!data.ok) {
      const errCode = data.error_code;
      // 403 = user blocked the bot | 400 = chat not found
      if (errCode === 403 || errCode === 400) {
        console.warn(`[Notify] User ${userId} blocked/invalid — skipping`);
        return { ok: false, reason: 'blocked' };
      }
      // 429 = rate limited by Telegram
      if (errCode === 429) {
        const retryAfter = data.parameters?.retry_after || 5;
        console.warn(`[Notify] Rate limited — retry after ${retryAfter}s`);
        return { ok: false, reason: 'rate_limit', retryAfter };
      }
      console.error(`[Notify] Telegram error for ${userId}:`, data.description);
      return { ok: false, reason: 'telegram_error', detail: data.description };
    }

    // ── Update last_notified timestamp ───────────────────────
    await sql(
      `UPDATE users
       SET last_notified = last_notified || $2::jsonb, updated_at = NOW()
       WHERE telegram_id = $1`,
      [userId, JSON.stringify({ [type]: new Date().toISOString() })]
    );

    console.log(`[Notify] ✅ Sent [${type}] to ${userId}`);
    return { ok: true };

  } catch (e) {
    console.error(`[Notify] Fetch error for ${userId}:`, e.message);
    return { ok: false, reason: 'fetch_error' };
  }
}

// ================================================================
//  broadcast(message, type)
//  Sends a message to ALL users in batches of BATCH_SIZE.
//  Rate: ~28 req/sec — safe under Telegram's 30/sec limit.
//  Returns: { sent, failed, skipped }
// ================================================================
async function broadcast(message, type = NOTIFY_TYPES.system) {
  console.log(`[Broadcast] Starting broadcast [${type}] ...`);

  let users;
  try {
    users = await sql(
      `SELECT telegram_id FROM users
       WHERE shadow_banned = FALSE AND is_hard_banned = FALSE
       ORDER BY created_at ASC`
    );
  } catch (e) {
    console.error('[Broadcast] Failed to fetch users:', e.message);
    return { ok: false, reason: 'db_error' };
  }

  const stats = { sent: 0, failed: 0, skipped: 0 };
  const total  = users.length;
  console.log(`[Broadcast] ${total} users to notify`);

  // ── Process in batches ───────────────────────────────────────
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (u) => {
        const result = await sendNotification(u.telegram_id, message, type);
        if (result.ok)                           stats.sent++;
        else if (result.reason === 'cooldown' ||
                 result.reason === 'banned')      stats.skipped++;
        else                                      stats.failed++;
      })
    );

    const processed = Math.min(i + BATCH_SIZE, total);
    console.log(`[Broadcast] Progress: ${processed}/${total}`);

    // Delay between batches to respect rate limit
    if (i + BATCH_SIZE < total) {
      await delay(BATCH_DELAY_MS);
    }
  }

  console.log(`[Broadcast] Done — sent:${stats.sent} failed:${stats.failed} skipped:${stats.skipped}`);
  return { ok: true, ...stats };
}

// ================================================================
//  checkAndNotifyUsers()
//  Scans all cells for status='ready' and sends harvest reminder.
//  Called by setInterval every CHECK_INTERVAL_MS seconds.
//  Guarantees one notification per growth cycle using last_notified.
// ================================================================
async function checkAndNotifyUsers() {
  try {
    // Fetch users who have at least one ready cell
    // We check: any cell in the cells array has status='ready'
    const users = await sql(`
      SELECT telegram_id, cells, last_notified, shadow_banned, is_hard_banned
      FROM users
      WHERE shadow_banned   = FALSE
        AND is_hard_banned  = FALSE
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(cells) AS cell
          WHERE cell->>'status' = 'ready'
        )
    `);

    if (!users.length) return;

    console.log(`[CheckNotify] ${users.length} users have ready crops`);

    for (const user of users) {
      const lastNotified = user.last_notified || {};
      const lastReadyAt  = lastNotified['ready']
        ? new Date(lastNotified['ready']).getTime()
        : 0;
      const now = Date.now();

      // Skip if already notified within cooldown window
      if (now - lastReadyAt < NOTIFY_COOLDOWN_MS) continue;

      const readyCells = (user.cells || []).filter(c => c.status === 'ready');
      const count      = readyCells.length;
      const plural     = count > 1 ? 's' : '';

      const message =
        `🍅 <b>Your crop${plural} ${count > 1 ? 'are' : 'is'} ready!</b>\n\n` +
        `You have <b>${count}</b> plot${plural} ready to harvest.\n` +
        `Open Tomato Farm and collect your TON now! 🌱`;

      await sendNotification(user.telegram_id, message, NOTIFY_TYPES.ready);

      // Small delay between users to avoid burst
      await delay(50);
    }
  } catch (e) {
    console.error('[CheckNotify] Error:', e.message);
  }
}

// ================================================================
//  startNotificationScheduler()
//  Call once at bot startup. Runs checkAndNotifyUsers on interval.
// ================================================================
function startNotificationScheduler() {
  console.log(`[Notify] Scheduler started — checking every ${CHECK_INTERVAL_MS / 1000}s`);
  setInterval(checkAndNotifyUsers, CHECK_INTERVAL_MS);
  // Run immediately on start too
  checkAndNotifyUsers();
}

// ── Utility ──────────────────────────────────────────────────────
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Exports ──────────────────────────────────────────────────────
module.exports = {
  sendNotification,
  broadcast,
  checkAndNotifyUsers,
  startNotificationScheduler,
  migrateNotifyColumn,
  NOTIFY_TYPES,
};

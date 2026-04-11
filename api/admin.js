// ================================================================
//  🛡️ Security Admin API — /api/admin
//  للاستخدام الداخلي فقط — تحتاج ADMIN_KEY في البيئة
// ================================================================

const { neon } = require('@neondatabase/serverless');

const ADMIN_KEY    = process.env.ADMIN_KEY || 'replace-with-strong-secret';
const DATABASE_URL = process.env.DATABASE_URL;

async function sql(query, params = []) {
  const db = neon(DATABASE_URL);
  return await db(query, params);
}

module.exports = async function adminHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://tomato-v3.vercel.app');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).end();

  const { key, action, telegram_id } = req.body || {};
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });

  const tid = telegram_id ? parseInt(telegram_id) : null;

  try {
    // ── List top risky users ──────────────────────────────────
    if (action === 'top_risks') {
      const rows = await sql(`
        SELECT telegram_id, username, risk_score, is_banned, is_shadow_banned,
               ban_reason, last_ip, last_seen, balance
        FROM users
        ORDER BY risk_score DESC
        LIMIT 50
      `);
      return res.status(200).json({ ok: true, users: rows });
    }

    // ── Recent security events ────────────────────────────────
    if (action === 'recent_events') {
      const rows = await sql(`
        SELECT * FROM security_log
        ORDER BY created_at DESC
        LIMIT 200
      `);
      return res.status(200).json({ ok: true, events: rows });
    }

    // ── Events for a specific user ────────────────────────────
    if (action === 'user_events' && tid) {
      const rows = await sql(`
        SELECT * FROM security_log WHERE telegram_id = $1
        ORDER BY created_at DESC LIMIT 100
      `, [tid]);
      return res.status(200).json({ ok: true, events: rows });
    }

    // ── Ban user ──────────────────────────────────────────────
    if (action === 'ban' && tid) {
      await sql(
        `UPDATE users SET is_banned = TRUE, ban_reason = 'admin_ban', updated_at = NOW()
         WHERE telegram_id = $1`,
        [tid]
      );
      return res.status(200).json({ ok: true });
    }

    // ── Unban user ────────────────────────────────────────────
    if (action === 'unban' && tid) {
      await sql(
        `UPDATE users SET is_banned = FALSE, is_shadow_banned = FALSE,
         ban_reason = NULL, risk_score = 0, updated_at = NOW()
         WHERE telegram_id = $1`,
        [tid]
      );
      return res.status(200).json({ ok: true });
    }

    // ── Shadow ban ────────────────────────────────────────────
    if (action === 'shadow_ban' && tid) {
      await sql(
        `UPDATE users SET is_shadow_banned = TRUE, ban_reason = 'admin_shadow',
         updated_at = NOW() WHERE telegram_id = $1`,
        [tid]
      );
      return res.status(200).json({ ok: true });
    }

    // ── Reset risk score ──────────────────────────────────────
    if (action === 'reset_risk' && tid) {
      await sql(
        `UPDATE users SET risk_score = 0, updated_at = NOW() WHERE telegram_id = $1`,
        [tid]
      );
      return res.status(200).json({ ok: true });
    }

    // ── Stats overview ────────────────────────────────────────
    if (action === 'stats') {
      const [users]   = await sql(`SELECT COUNT(*) AS total FROM users`);
      const [banned]  = await sql(`SELECT COUNT(*) AS total FROM users WHERE is_banned = TRUE`);
      const [shadow]  = await sql(`SELECT COUNT(*) AS total FROM users WHERE is_shadow_banned = TRUE`);
      const [risky]   = await sql(`SELECT COUNT(*) AS total FROM users WHERE risk_score > 20`);
      const [events]  = await sql(`SELECT COUNT(*) AS total FROM security_log`);
      const [nonces]  = await sql(`SELECT COUNT(*) AS total FROM used_nonces`);
      return res.status(200).json({
        ok: true,
        stats: {
          total_users:         parseInt(users.total),
          banned_users:        parseInt(banned.total),
          shadow_banned_users: parseInt(shadow.total),
          high_risk_users:     parseInt(risky.total),
          security_events:     parseInt(events.total),
          used_nonces:         parseInt(nonces.total),
        }
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[Admin Error]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

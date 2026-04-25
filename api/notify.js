// ================================================================
//  api/notify.js — Vercel Serverless (cron trigger)
//  Only needs BOT_TOKEN + DATABASE_URL
// ================================================================

const { checkAndNotifyUsers } = require('../notifications');

module.exports = async (req, res) => {
  try {
    await checkAndNotifyUsers();
    return res.status(200).json({ ok: true, ts: new Date().toISOString() });
  } catch (e) {
    console.error('[api/notify] Error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

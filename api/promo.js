const { neon } = require('@neondatabase/serverless');

async function sql(query, params = []) {
  const db = neon(process.env.DATABASE_URL);
  return await db(query, params);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // ── Migration (run once) ─────────────────────────────────────────
  await sql(`
    CREATE TABLE IF NOT EXISTS promo (
      code           TEXT PRIMARY KEY,
      reward_balance NUMERIC DEFAULT 0,
      reward_seeds   INT     DEFAULT 0,
      reward_water   INT     DEFAULT 0,
      max_uses       INT     DEFAULT 100,
      used_count     INT     DEFAULT 0,
      expires_at     TIMESTAMP,
      is_active      BOOLEAN DEFAULT true
    )
  `);

  await sql(`
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      user_id     BIGINT,
      code        TEXT,
      redeemed_at TIMESTAMP DEFAULT now(),
      PRIMARY KEY (user_id, code)
    )
  `);

  // ── Route: POST /promo/redeem ────────────────────────────────────
  const { user_id, code } = req.body || {};

  if (!user_id || !code) {
    return res.status(400).json({ success: false, error: 'Missing user_id or code' });
  }

  // 1. هل استخدم المستخدم الكود مسبقًا؟
  const already = await sql(
    `SELECT 1 FROM promo_redemptions WHERE user_id = $1 AND code = $2`,
    [user_id, code]
  );

  if (already.length > 0) {
    return res.status(200).json({ success: false, error: 'Already redeemed' });
  }

  // 2. جلب بيانات الكود
  const rows = await sql(`SELECT * FROM promo WHERE code = $1`, [code]);
  const promo = rows[0];

  // 3. التحقق من الصلاحية
  const now = new Date();
  const valid =
    promo &&
    promo.is_active === true &&
    promo.used_count < promo.max_uses &&
    (promo.expires_at === null || new Date(promo.expires_at) > now);

  if (!valid) {
    return res.status(200).json({ success: false, error: 'Invalid or expired code' });
  }

  // 4. تسجيل الاستخدام + تحديث العداد
  await sql(
    `INSERT INTO promo_redemptions (user_id, code) VALUES ($1, $2)`,
    [user_id, code]
  );

  await sql(
    `UPDATE promo SET used_count = used_count + 1 WHERE code = $1`,
    [code]
  );

  // 5. إرجاع المكافأة
  return res.status(200).json({
    success: true,
    balance: promo.reward_balance,
    seeds:   promo.reward_seeds,
    water:   promo.reward_water,
  });
};

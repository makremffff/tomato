const { neon } = require('@neondatabase/serverless');

// ── Config ──────────────────────────────────────────────────────────
const BOT_TOKEN  = process.env.BOT_TOKEN;
const TG_API     = `https://api.telegram.org/bot${BOT_TOKEN}`;
const APP_URL    = 'https://t.me/tamatoFarm_bot/earn';

// file_id لصورة file.png — سيتم تعيينه تلقائياً في أول إرسال
// بعد أول /start ستظهر في اللوج: "photo file_id: XXXXXXX"
// انسخ الـ file_id وضعه هنا لتجنب رفع الصورة في كل مرة
let FARM_PHOTO_FILE_ID = process.env.FARM_PHOTO_FILE_ID || null;

// ── Helper: إرسال رسالة نصية ────────────────────────────────────────
async function sendMessage(chat_id, text, extra = {}) {
  const body = {
    chat_id,
    text,
    parse_mode: 'HTML',
    ...extra,
  };
  const res = await fetch(`${TG_API}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

// ── Helper: إرسال صورة مع caption ────────────────────────────────────
async function sendPhoto(chat_id, photo, caption, extra = {}) {
  const body = {
    chat_id,
    photo,           // يقبل file_id أو URL
    caption,
    parse_mode: 'HTML',
    ...extra,
  };
  const res = await fetch(`${TG_API}/sendPhoto`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const result = await res.json();

  // ✅ استخرج file_id من أول إرسال ناجح واحفظه للمرات القادمة
  if (result.ok && !FARM_PHOTO_FILE_ID) {
    const sizes = result.result?.photo;
    if (Array.isArray(sizes) && sizes.length > 0) {
      FARM_PHOTO_FILE_ID = sizes[sizes.length - 1].file_id;
      console.log('✅ photo file_id cached:', FARM_PHOTO_FILE_ID);
    }
  }

  return result;
}

// ── Helper: زر Open Farm ──────────────────────────────────────────────
function openFarmButton(label = '🍅 Open Tomato Farm') {
  return {
    inline_keyboard: [[
      { text: label, web_app: { url: APP_URL } },
    ]],
  };
}

// ── DB: حفظ المستخدم ─────────────────────────────────────────────────
async function saveUser(user) {
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql(`
      INSERT INTO users (telegram_id, username, first_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (telegram_id) DO UPDATE
        SET username   = EXCLUDED.username,
            first_name = EXCLUDED.first_name,
            updated_at = now()
    `, [
      user.id,
      user.username  || null,
      user.first_name || null,
    ]);
  } catch (e) {
    // لو عمود first_name غير موجود، جرّب بدونه
    try {
      const sql = neon(process.env.DATABASE_URL);
      await sql(`
        INSERT INTO users (telegram_id, username)
        VALUES ($1, $2)
        ON CONFLICT (telegram_id) DO UPDATE
          SET username   = EXCLUDED.username,
              updated_at = now()
      `, [user.id, user.username || null]);
    } catch (_) {}
  }
}

// ── Handler: /start ───────────────────────────────────────────────────
async function handleStart(msg) {
  const user      = msg.from;
  const chat_id   = msg.chat.id;
  const firstName = user?.first_name || 'Farmer';

  // حفظ المستخدم في قاعدة البيانات
  await saveUser(user);

  const caption = `
🍅 <b>Welcome to Tomato Farm, ${firstName}!</b>

🌱 <b>Plant · Water · Harvest · Earn TON</b>

Here's how to play:
• 🌱 Tap an empty plot to plant a seed
• 💧 Water it to grow <b>3× faster</b>
• 🚜 Harvest when ready and earn <b>real TON</b>

💡 <b>Tips:</b>
• Watch ads in the Store for free seeds & water
• Invite friends → earn <b>25% commission</b> on every harvest they make
• Use promo codes for instant bonus rewards

👇 Tap below to open your farm and start earning!
  `.trim();

  // استخدم file_id المحفوظ إن وُجد، وإلا ارفع الصورة من URL
  const photoSource = FARM_PHOTO_FILE_ID
    ? FARM_PHOTO_FILE_ID
    : `${process.env.APP_BASE_URL || 'https://your-app.vercel.app'}/file.png`;

  await sendPhoto(chat_id, photoSource, caption, {
    reply_markup: openFarmButton(),
  });
}

// ── Handler: /help ────────────────────────────────────────────────────
async function handleHelp(chat_id) {
  await sendMessage(chat_id, `
🍅 <b>Tomato Farm — Help</b>

<b>Commands:</b>
/start   — Open the farm & see welcome
/help    — Show this message

<b>How to earn TON:</b>
1️⃣ Plant tomato seeds on your plots
2️⃣ Water them to speed up growth
3️⃣ Harvest when ready
4️⃣ Withdraw to FaucetPay or TON wallet

<b>Need support?</b>
Contact us: @tomato_support
  `.trim(), {
    reply_markup: openFarmButton('🍅 Open Farm'),
  });
}

// ── Main Webhook Handler ──────────────────────────────────────────────
module.exports = async (req, res) => {
  // Telegram يرسل فقط POST
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    const update = req.body;

    // ── Message updates ──
    const msg = update?.message;
    if (msg) {
      const text = msg.text || '';

      if (text.startsWith('/start')) {
        await handleStart(msg);
        return res.status(200).json({ ok: true });
      }

      if (text === '/help') {
        await handleHelp(msg.chat.id);
        return res.status(200).json({ ok: true });
      }

      // رد افتراضي على أي رسالة أخرى
      await sendMessage(msg.chat.id,
        `🍅 Use /start to open Tomato Farm or /help for commands.`
      );
      return res.status(200).json({ ok: true });
    }

    // ── Callback queries (زر داخل رسالة) ──
    const cb = update?.callback_query;
    if (cb) {
      await fetch(`${TG_API}/answerCallbackQuery`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ callback_query_id: cb.id }),
      });
      return res.status(200).json({ ok: true });
    }

  } catch (err) {
    console.error('[BOT] Error:', err.message);
  }

  return res.status(200).json({ ok: true });
};

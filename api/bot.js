'use strict';

// ══════════════════════════════════════════════════════════════════════
//  api/bot.js  —  Telegram Bot Webhook Handler
//  Deploy on Vercel · استدعاء عبر Telegram Webhook
//
//  Environment Variables المطلوبة في Vercel:
//    BOT_TOKEN          = توكن البوت من BotFather
//    FARM_PHOTO_FILE_ID = (فارغ في البداية، يُحفظ تلقائياً بعد أول إرسال)
// ══════════════════════════════════════════════════════════════════════

const BOT_TOKEN = process.env.BOT_TOKEN;
const TG_API    = `https://api.telegram.org/bot${BOT_TOKEN}`;
const APP_URL   = 'https://t.me/tamatoFarm_bot/earn';

// file_id لصورة file.png — يُحفظ تلقائياً من أول إرسال ناجح
// بعد أول /start انسخ الـ file_id من Vercel Logs
// وضعه في Environment Variable: FARM_PHOTO_FILE_ID
let _cachedPhotoId = process.env.FARM_PHOTO_FILE_ID || null;

// رسائل الإشعار اليومي (7 رسائل، واحدة لكل يوم)
const DAILY_MESSAGES = [
  '🍅 Your tomatoes are waiting! Come harvest them and earn TON 💰',
  '💧 Water your tomatoes today — they grow <b>3× faster</b> when watered! 🌱',
  '🚜 Time to harvest! Your Tomato Farm is ready. Collect your TON now!',
  '🌱 Plant · Water · Harvest — your daily TON earnings are waiting!',
  '⏰ Daily reminder: Visit your Tomato Farm and keep earning TON! 🍅',
  '💰 Your tomato plots need attention! Come farm some TON today 🌿',
  '🎯 New day, new harvest! Open your farm and earn more TON 🍅',
];

// ── زر Open Farm ────────────────────────────────────────────────────
const openFarmKeyboard = (label = '🍅 Open Tomato Farm') => ({
  inline_keyboard: [[
    { text: label, web_app: { url: APP_URL } },
  ]],
});

// ── إرسال طلب لـ Telegram API ───────────────────────────────────────
async function tgRequest(method, body) {
  const res = await fetch(`${TG_API}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

// ── إرسال رسالة نصية ────────────────────────────────────────────────
async function sendMessage(chat_id, text, extra = {}) {
  return tgRequest('sendMessage', {
    chat_id,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

// ── إرسال صورة مع caption ───────────────────────────────────────────
async function sendPhoto(chat_id, caption, extra = {}) {
  const photo = _cachedPhotoId
    || 'https://tomato-v3.vercel.app/file.png';

  const result = await tgRequest('sendPhoto', {
    chat_id,
    photo,
    caption,
    parse_mode: 'HTML',
    ...extra,
  });

  // ✅ احفظ file_id من أول إرسال ناجح
  if (result.ok && !_cachedPhotoId) {
    const sizes = result.result?.photo;
    if (Array.isArray(sizes) && sizes.length > 0) {
      _cachedPhotoId = sizes[sizes.length - 1].file_id;
      console.log('[BOT] ✅ Photo file_id cached:', _cachedPhotoId);
      console.log('[BOT] 👆 Copy this to FARM_PHOTO_FILE_ID env variable!');
    }
  }

  return result;
}

// ══════════════════════════════════════════════════════════════════════
//  HANDLERS
// ══════════════════════════════════════════════════════════════════════

// ── /start ───────────────────────────────────────────────────────────
async function handleStart(msg) {
  const user      = msg.from;
  const chat_id   = msg.chat.id;
  const firstName = user?.first_name || 'Farmer';

  const caption = [
    `🍅 <b>Welcome to Tomato Farm, ${firstName}!</b>`,
    '',
    '🌱 <b>Plant · Water · Harvest · Earn TON</b>',
    '',
    "Here's how to play:",
    '• 🌱 Tap an empty plot to plant a seed',
    '• 💧 Water it to grow <b>3× faster</b>',
    '• 🚜 Harvest when ready and earn <b>real TON</b>',
    '',
    '💡 <b>Tips:</b>',
    '• Watch ads in the Store for free seeds & water',
    '• Invite friends → earn <b>25% commission</b> on every harvest',
    '• Use promo codes for instant bonus rewards!',
    '',
    '👇 Tap below to open your farm and start earning!',
  ].join('\n');

  await sendPhoto(chat_id, caption, {
    reply_markup: openFarmKeyboard(),
  });
}

// ── /help ────────────────────────────────────────────────────────────
async function handleHelp(chat_id) {
  const text = [
    '🍅 <b>Tomato Farm — Help</b>',
    '',
    '<b>Commands:</b>',
    '/start — Open the farm & welcome message',
    '/help  — Show this message',
    '',
    '<b>How to earn TON:</b>',
    '1️⃣ Plant tomato seeds on your plots',
    '2️⃣ Water them to speed up growth',
    '3️⃣ Harvest when ready',
    '4️⃣ Withdraw to FaucetPay or TON wallet',
    '',
    'Need support? @tomato_support',
  ].join('\n');

  await sendMessage(chat_id, text, {
    reply_markup: openFarmKeyboard('🍅 Open Farm'),
  });
}

// ── إشعار يومي — يُستدعى من api/notify.js ────────────────────────────
async function sendDailyNotification(chat_id) {
  const dayIndex = new Date().getDay(); // 0=Sun .. 6=Sat
  const text     = DAILY_MESSAGES[dayIndex % DAILY_MESSAGES.length];

  return tgRequest('sendMessage', {
    chat_id,
    text,
    parse_mode: 'HTML',
    reply_markup: openFarmKeyboard('🍅 Open Farm'),
  });
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN WEBHOOK HANDLER
// ══════════════════════════════════════════════════════════════════════
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    const update = req.body;

    // ── Message ──
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

      // رد افتراضي
      await sendMessage(
        msg.chat.id,
        '🍅 Use /start to open Tomato Farm or /help for commands.'
      );
      return res.status(200).json({ ok: true });
    }

    // ── Callback Query ──
    const cb = update?.callback_query;
    if (cb) {
      await tgRequest('answerCallbackQuery', { callback_query_id: cb.id });
      return res.status(200).json({ ok: true });
    }

  } catch (err) {
    console.error('[BOT] Error:', err.message);
  }

  return res.status(200).json({ ok: true });
};

module.exports.sendDailyNotification = sendDailyNotification;

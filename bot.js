'use strict';

require('dotenv').config(); // لو تستخدم .env محلياً

const TelegramBot = require('node-telegram-bot-api');
const path        = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL   = 'https://t.me/tamatoFarm_bot/earn';

// الصورة مباشرة من root المشروع
const PHOTO = path.join(__dirname, 'file.png');

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is not set in environment variables!');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🍅 Tomato Farm Bot is running...');

// ── رسائل الإشعار اليومي ─────────────────────────────────────────────
const DAILY_MESSAGES = [
  '🍅 Your tomatoes are waiting! Come harvest them and earn TON 💰',
  '💧 Water your tomatoes today — they grow <b>3× faster</b> when watered! 🌱',
  '🚜 Time to harvest! Your Tomato Farm is ready. Collect your TON now!',
  '🌱 Plant · Water · Harvest — your daily TON earnings are waiting!',
  '⏰ Daily reminder: Visit your Tomato Farm and keep earning TON! 🍅',
  '💰 Your tomato plots need attention! Come farm some TON today 🌿',
  '🎯 New day, new harvest! Open your farm and earn more TON 🍅',
];

// ── زر Open Farm ─────────────────────────────────────────────────────
const openFarmKeyboard = (label = '🍅 Open Tomato Farm') => ({
  inline_keyboard: [[
    { text: label, web_app: { url: APP_URL } },
  ]],
});

// ── قائمة المستخدمين للإشعارات اليومية ──────────────────────────────
const userIds = new Set();

// ══════════════════════════════════════════════════════════════════════
//  /start
// ══════════════════════════════════════════════════════════════════════
bot.onText(/\/start/, async (msg) => {
  const chat_id   = msg.chat.id;
  const firstName = msg.from?.first_name || 'Farmer';

  userIds.add(chat_id);

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

  try {
    await bot.sendPhoto(chat_id, PHOTO, {
      caption,
      parse_mode:   'HTML',
      reply_markup: openFarmKeyboard(),
    });
  } catch (err) {
    console.error('[/start] Error:', err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  /help
// ══════════════════════════════════════════════════════════════════════
bot.onText(/\/help/, async (msg) => {
  const chat_id = msg.chat.id;

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

  try {
    await bot.sendMessage(chat_id, text, {
      parse_mode:   'HTML',
      reply_markup: openFarmKeyboard('🍅 Open Farm'),
    });
  } catch (err) {
    console.error('[/help] Error:', err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  إشعار يومي — كل يوم الساعة 9 صباحاً
// ══════════════════════════════════════════════════════════════════════
async function sendDailyToAll() {
  const dayIndex = new Date().getDay();
  const text     = DAILY_MESSAGES[dayIndex % DAILY_MESSAGES.length];

  console.log(`📢 Sending daily notification to ${userIds.size} users...`);

  for (const chat_id of userIds) {
    try {
      await bot.sendMessage(chat_id, text, {
        parse_mode:   'HTML',
        reply_markup: openFarmKeyboard('🍅 Open Farm'),
      });
      await new Promise(r => setTimeout(r, 50));
    } catch (err) {
      if (err.response?.body?.error_code === 403) {
        console.log(`[NOTIFY] ${chat_id} blocked the bot — removed`);
        userIds.delete(chat_id);
      } else {
        console.error(`[NOTIFY] Failed ${chat_id}:`, err.message);
      }
    }
  }

  console.log('✅ Daily notification done');
}

function scheduleDailyNotification() {
  const now    = new Date();
  const target = new Date();
  target.setHours(9, 0, 0, 0);

  if (target <= now) target.setDate(target.getDate() + 1);

  const ms = target - now;
  console.log(`⏰ Next daily notification in ${Math.round(ms / 60000)} minutes`);

  setTimeout(() => {
    sendDailyToAll();
    setInterval(sendDailyToAll, 24 * 60 * 60 * 1000);
  }, ms);
}

scheduleDailyNotification();

// ── Polling errors ────────────────────────────────────────────────────
bot.on('polling_error', (err) => {
  console.error('[POLLING]', err.message);
});

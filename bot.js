// ================================================================
//  Tomato Farm — Telegram Bot
// ================================================================

const TelegramBot = require('node-telegram-bot-api');
const { neon }    = require('@neondatabase/serverless');

const {
  startNotificationScheduler,
  migrateNotifyColumn,
} = require('./notifications');

const BOT_TOKEN    = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN)    throw new Error('BOT_TOKEN is required');
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

async function sql(query, params = []) {
  const db = neon(DATABASE_URL);
  return await db(query, params);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('[Bot] Polling started...');

migrateNotifyColumn();
startNotificationScheduler();

// ── /start ───────────────────────────────────────────────────────
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId     = msg.chat.id;
  const username   = msg.from?.username || null;
  const firstName  = msg.from?.first_name || 'Farmer';
  const refParam   = (match[1] || '').trim();
  const referrerId = refParam ? parseInt(refParam) : null;

  try {
    await sql(`
      INSERT INTO users (telegram_id, username)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) DO UPDATE
        SET username = EXCLUDED.username, updated_at = NOW()
    `, [chatId, username]);

    if (referrerId && referrerId !== chatId) {
      await sql(`
        UPDATE users SET referral_friends = referral_friends + 1
        WHERE telegram_id = $1
      `, [referrerId]);

      await sql(`
        UPDATE users SET referral_by = $2
        WHERE telegram_id = $1 AND referral_by IS NULL
      `, [chatId, referrerId]);
    }

    await bot.sendMessage(chatId,
      `🍅 <b>Welcome to Tomato Farm, ${firstName}!</b>\n\n` +
      `Plant 🌱 → Water 💧 → Harvest 🍅 → Earn <b>TON</b> 💎`,
      { parse_mode: 'HTML' }
    );

  } catch (e) {
    console.error('[Bot] /start error:', e.message);
  }
});

// ── Register any new user who messages the bot ───────────────────
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  const chatId   = msg.chat.id;
  const username = msg.from?.username || null;
  try {
    await sql(`
      INSERT INTO users (telegram_id, username)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) DO NOTHING
    `, [chatId, username]);
  } catch (e) {
    console.error('[Bot] message upsert error:', e.message);
  }
});

bot.on('polling_error', (err) => console.error('[Bot] Polling error:', err.message));
bot.on('error',         (err) => console.error('[Bot] Error:',         err.message));

console.log('[Bot] Tomato Farm bot is running ✅');

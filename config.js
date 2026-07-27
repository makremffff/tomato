/* ══════════════════════════════════════════════════════
   config.js — ثوابت التطبيق + تهيئة Telegram WebApp
   غيّر القيم أدناه (روابط الدعم، Adsgram Block ID...) بحرية
══════════════════════════════════════════════════════ */

  /* =========================================================
     RealCash — live wiring against api/index.js (نمط طلب واحد
     بحقل "type"، مطابق تماماً لبنية BigLeague). كل نداء يرسل
     initData + type + data إلى نفس الـ endpoint.
     ========================================================= */

  const API_ENDPOINT = '/api'; // يشير لـ api/index.js على Vercel
  const TON_MANIFEST_URL = location.origin + '/tonconnect-manifest.json';
  const HELP_CHANNEL_LINK = 'https://t.me/YOUR_HELP_CHANNEL'; // TODO: استبدله بقناة الدعم
  const SUPPORT_USERNAME  = 'YOUR_SUPPORT_USERNAME';          // TODO: بدون @
  const ADSGRAM_BLOCK_ID  = '35167';                          // نفس Block ID المستخدم في BigLeague

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) { try { tg.ready(); tg.expand(); } catch(e){} }
  const initData = tg ? tg.initData : '';

  // 🔗 يلتقط start_param (ref_<telegram_id>) من رابط الدعوة عند أول فتح للتطبيق
  const startParam = tg?.initDataUnsafe?.start_param || null;

  let appState = null; // آخر رد كامل من init — تُبنى عليه كل الصفحات

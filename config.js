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
  const HELP_CHANNEL_LINK = 'https://t.me/+QmHr-Ny5Ow4wNzA8'; // TODO: استبدله بقناة الدعم
  const SUPPORT_USERNAME  = 'ReaalCashS';          // TODO: بدون @
  const ADSGRAM_BLOCK_ID  = '40439';                          // نفس Block ID المستخدم في BigLeague
  const ADSGRAM_TASK_BLOCK_ID = 'task-40539';                  // Block ID لإعلانات Task (نوعه Task في partner.adsgram.ai) — دائمًا بصيغة task-xxx

  // 🚧 "تصفح واربح" قيد التطوير — ظاهرة بس للأدمن (آيدي تليجرام تحت) لحد ما تخليها false
  const SURF_UNDER_DEVELOPMENT = true;
  const SURF_ADMIN_TELEGRAM_ID = '7741750541';

  // 🔗 رابط الإحالة الرسمي — Mini App deep link عبر startapp (وليس start العادي)
  // الصيغة: https://t.me/<bot_username>/<mini_app_short_name>?startapp=<referral_code>
  const REFERRAL_LINK_BASE = 'https://t.me/tamatoFarm_bot/earn?startapp=';

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    try { tg.ready(); tg.expand(); } catch(e){}
    // 🖥️ فتح التطبيق بوضع ملء الشاشة تلقائياً عند بدء التشغيل (Bot API 8.0+)
    try { if (typeof tg.requestFullscreen === 'function' && !tg.isFullscreen) tg.requestFullscreen(); } catch(e){}
    // امنع السحب العمودي من إغلاق التطبيق بالخطأ أثناء وضع ملء الشاشة
    try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch(e){}
    try { tg.lockOrientation && tg.lockOrientation(); } catch(e){}
  }
  const initData = tg ? tg.initData : '';

  // 🚧 يتحقق إذا كان المستخدم الحالي هو الأدمن المسموح له يشوف "تصفح واربح" وهي قيد التطوير
  function isSurfAdmin(){
    const uid = tg?.initDataUnsafe?.user?.id;
    return uid != null && String(uid) === SURF_ADMIN_TELEGRAM_ID;
  }

  // 🔗 يلتقط start_param (ref_<telegram_id>) من رابط الدعوة عند أول فتح للتطبيق
  const startParam = tg?.initDataUnsafe?.start_param || null;

  let appState = null; // آخر رد كامل من init — تُبنى عليه كل الصفحات

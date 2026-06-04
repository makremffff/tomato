/**
 * app-i18n.js — نظام الترجمة التلقائية
 * يقرأ tg_language_code من رد السيرفر ويترجم كل الصفحات فوراً
 * الاستخدام: applyLanguage(langCode) بعد load.ok في app-ads.js
 */

// ═══════════════════════════════════════════════════════
// قاموس الترجمات
// ═══════════════════════════════════════════════════════
const TRANSLATIONS = {

  ar: {
    user_greeting:        'مرحباً بعودتك',
    balance_label:        'الرصيد الكلي',
    pts:                  'نقطة',
    friends_label:        'صديق مدعو',
    tasks_done_label:     'مهمة منجزة',
    earn_title:           'الربح',
    all_done_title:       'أحسنت! انتهيت من كل الإعلانات',
    all_done_sub:         'عد غداً للحصول على إعلانات جديدة',
    earned_today:         'مكتسب اليوم',
    ads_watched:          'إعلان شوهد',
    daily_limit:          'الحد اليومي',
    invite_btn_title:     'دعوة الأصدقاء',
    invite_btn_sub:       'ادعُ واربح معاً',
    contests:             'المسابقة الأسبوعية',
    contests_sub:         'تنافس على جوائز كبرى',
    gift_title:           'مكافأة يومية',
    gift_sub:             'استلم هديتك الآن',
    gift_claim_btn:       'استلم',
    gift_preparing:       'جاري التحضير...',
    daily:                'يومي',
    coming_soon:          'قريباً',
    achievements:         'الإنجازات',
    achievements_sub:     'اكسب شارات خاصة',
    soon:                 'قريباً',
    invite_page_title:    'دعوة الأصدقاء',
    invite_hero_title:    'ادعُ أصدقاءك واربح',
    invite_hero_sub:      'كل صديق تدعوه = 25% من أرباحه لك',
    your_ref_link:        'رابط الإحالة الخاص بك',
    total_referrals:      'إجمالي الاحالات النشطة',
    earned_from_refs:     'مكتسب من احالات +25% من ربحهم',
    balance_available:    'رصيدك المتاح للسحب',
    withdraw_methods_title:'طرق السحب',
    ton_wallet:           'محفظة TON',
    min_label:            'الحد الأدنى',
    available_badge:      'متاح',
    paypal_name:          'باي بال',
    fawry_name:           'فوري باي',
    withdraw_history_title:'سجل السحوبات',
    no_transactions:      'لا توجد سحوبات سابقة',
    nav_home:             'الرئيسية',
    nav_tasks:            'المهام',
    nav_earn:             'الربح',
    nav_withdraw:         'السحب',
    no_tasks_sub:         'لا توجد مهام حالياً',
  },

  en: {
    user_greeting:        'Welcome back',
    balance_label:        'Total Balance',
    pts:                  'pts',
    friends_label:        'Friends invited',
    tasks_done_label:     'Tasks completed',
    earn_title:           'Earn',
    all_done_title:       'Great job! All ads watched',
    all_done_sub:         'Come back tomorrow for new ads',
    earned_today:         'Earned today',
    ads_watched:          'Ads watched',
    daily_limit:          'Daily limit',
    invite_btn_title:     'Invite Friends',
    invite_btn_sub:       'Invite & earn together',
    contests:             'Weekly Contest',
    contests_sub:         'Compete for big prizes',
    gift_title:           'Daily Reward',
    gift_sub:             'Claim your gift now',
    gift_claim_btn:       'Claim',
    gift_preparing:       'Preparing...',
    daily:                'Daily',
    coming_soon:          'Coming Soon',
    achievements:         'Achievements',
    achievements_sub:     'Earn special badges',
    soon:                 'Soon',
    invite_page_title:    'Invite Friends',
    invite_hero_title:    'Invite & Earn',
    invite_hero_sub:      'Every friend you invite = 25% of their earnings',
    your_ref_link:        'Your referral link',
    total_referrals:      'Total active referrals',
    earned_from_refs:     'Earned from referrals +25% of their earnings',
    balance_available:    'Available balance for withdrawal',
    withdraw_methods_title:'Withdrawal Methods',
    ton_wallet:           'TON Wallet',
    min_label:            'Minimum',
    available_badge:      'Available',
    paypal_name:          'PayPal',
    fawry_name:           'Fawry Pay',
    withdraw_history_title:'Withdrawal History',
    no_transactions:      'No previous withdrawals',
    nav_home:             'Home',
    nav_tasks:            'Tasks',
    nav_earn:             'Earn',
    nav_withdraw:         'Withdraw',
    no_tasks_sub:         'No tasks available yet',
  },

  fr: {
    user_greeting:        'Bon retour',
    balance_label:        'Solde total',
    pts:                  'pts',
    friends_label:        'Amis invités',
    tasks_done_label:     'Tâches accomplies',
    earn_title:           'Gagner',
    all_done_title:       'Bravo ! Toutes les pubs vues',
    all_done_sub:         'Revenez demain pour de nouvelles pubs',
    earned_today:         "Gagné aujourd'hui",
    ads_watched:          'Pubs vues',
    daily_limit:          'Limite quotidienne',
    invite_btn_title:     'Inviter des amis',
    invite_btn_sub:       'Invitez et gagnez ensemble',
    contests:             'Concours hebdomadaire',
    contests_sub:         'Concourez pour de grands prix',
    gift_title:           'Récompense quotidienne',
    gift_sub:             'Réclamez votre cadeau maintenant',
    gift_claim_btn:       'Réclamer',
    gift_preparing:       'Préparation...',
    daily:                'Quotidien',
    coming_soon:          'Bientôt',
    achievements:         'Succès',
    achievements_sub:     'Gagnez des badges spéciaux',
    soon:                 'Bientôt',
    invite_page_title:    'Inviter des amis',
    invite_hero_title:    'Invitez et Gagnez',
    invite_hero_sub:      'Chaque ami invité = 25% de ses gains pour vous',
    your_ref_link:        'Votre lien de parrainage',
    total_referrals:      'Total des parrainages actifs',
    earned_from_refs:     'Gagné via parrainages +25% de leurs gains',
    balance_available:    'Solde disponible pour retrait',
    withdraw_methods_title:'Méthodes de retrait',
    ton_wallet:           'Portefeuille TON',
    min_label:            'Minimum',
    available_badge:      'Disponible',
    paypal_name:          'PayPal',
    fawry_name:           'Fawry Pay',
    withdraw_history_title:'Historique des retraits',
    no_transactions:      'Aucun retrait précédent',
    nav_home:             'Accueil',
    nav_tasks:            'Tâches',
    nav_earn:             'Gagner',
    nav_withdraw:         'Retirer',
    no_tasks_sub:         'Aucune tâche disponible',
  },

  ru: {
    user_greeting:        'С возвращением',
    balance_label:        'Общий баланс',
    pts:                  'очков',
    friends_label:        'Приглашено друзей',
    tasks_done_label:     'Задач выполнено',
    earn_title:           'Заработать',
    all_done_title:       'Отлично! Все рекламы просмотрены',
    all_done_sub:         'Возвращайтесь завтра за новой рекламой',
    earned_today:         'Заработано сегодня',
    ads_watched:          'Реклам просмотрено',
    daily_limit:          'Дневной лимит',
    invite_btn_title:     'Пригласить друзей',
    invite_btn_sub:       'Приглашайте и зарабатывайте вместе',
    contests:             'Еженедельный конкурс',
    contests_sub:         'Соревнуйтесь за большие призы',
    gift_title:           'Ежедневная награда',
    gift_sub:             'Получите свой подарок сейчас',
    gift_claim_btn:       'Получить',
    gift_preparing:       'Подготовка...',
    daily:                'Ежедневно',
    coming_soon:          'Скоро',
    achievements:         'Достижения',
    achievements_sub:     'Зарабатывайте специальные значки',
    soon:                 'Скоро',
    invite_page_title:    'Пригласить друзей',
    invite_hero_title:    'Приглашайте и зарабатывайте',
    invite_hero_sub:      'Каждый приглашённый = 25% его заработка вам',
    your_ref_link:        'Ваша реферальная ссылка',
    total_referrals:      'Всего активных рефералов',
    earned_from_refs:     'Заработано с рефералов +25% их дохода',
    balance_available:    'Доступный баланс для вывода',
    withdraw_methods_title:'Методы вывода',
    ton_wallet:           'TON кошелёк',
    min_label:            'Минимум',
    available_badge:      'Доступно',
    paypal_name:          'PayPal',
    fawry_name:           'Fawry Pay',
    withdraw_history_title:'История выводов',
    no_transactions:      'Нет предыдущих выводов',
    nav_home:             'Главная',
    nav_tasks:            'Задачи',
    nav_earn:             'Заработать',
    nav_withdraw:         'Вывод',
    no_tasks_sub:         'Нет доступных задач',
  },

  tr: {
    user_greeting:        'Tekrar hoş geldiniz',
    balance_label:        'Toplam Bakiye',
    pts:                  'puan',
    friends_label:        'Davet edilen arkadaş',
    tasks_done_label:     'Tamamlanan görev',
    earn_title:           'Kazan',
    all_done_title:       'Harika! Tüm reklamlar izlendi',
    all_done_sub:         'Yeni reklamlar için yarın geri gelin',
    earned_today:         'Bugün kazanıldı',
    ads_watched:          'İzlenen reklam',
    daily_limit:          'Günlük limit',
    invite_btn_title:     'Arkadaş davet et',
    invite_btn_sub:       'Davet et ve birlikte kazan',
    contests:             'Haftalık Yarışma',
    contests_sub:         'Büyük ödüller için yarışın',
    gift_title:           'Günlük Ödül',
    gift_sub:             'Hediyeni şimdi al',
    gift_claim_btn:       'Al',
    gift_preparing:       'Hazırlanıyor...',
    daily:                'Günlük',
    coming_soon:          'Yakında',
    achievements:         'Başarımlar',
    achievements_sub:     'Özel rozetler kazan',
    soon:                 'Yakında',
    invite_page_title:    'Arkadaş Davet Et',
    invite_hero_title:    'Davet Et ve Kazan',
    invite_hero_sub:      'Davet ettiğin her arkadaş = kazancının %25\'i sana',
    your_ref_link:        'Referans linkiniz',
    total_referrals:      'Toplam aktif referanslar',
    earned_from_refs:     'Referanslardan kazanılan +%25',
    balance_available:    'Çekilebilir bakiye',
    withdraw_methods_title:'Çekim Yöntemleri',
    ton_wallet:           'TON Cüzdanı',
    min_label:            'Minimum',
    available_badge:      'Mevcut',
    paypal_name:          'PayPal',
    fawry_name:           'Fawry Pay',
    withdraw_history_title:'Çekim Geçmişi',
    no_transactions:      'Önceki çekim yok',
    nav_home:             'Ana Sayfa',
    nav_tasks:            'Görevler',
    nav_earn:             'Kazan',
    nav_withdraw:         'Çek',
    no_tasks_sub:         'Henüz görev yok',
  },

  id: {
    user_greeting:        'Selamat datang kembali',
    balance_label:        'Total Saldo',
    pts:                  'poin',
    friends_label:        'Teman diundang',
    tasks_done_label:     'Tugas selesai',
    earn_title:           'Penghasilan',
    all_done_title:       'Hebat! Semua iklan sudah ditonton',
    all_done_sub:         'Kembali besok untuk iklan baru',
    earned_today:         'Diperoleh hari ini',
    ads_watched:          'Iklan ditonton',
    daily_limit:          'Batas harian',
    invite_btn_title:     'Undang Teman',
    invite_btn_sub:       'Undang & hasilkan bersama',
    contests:             'Kontes Mingguan',
    contests_sub:         'Bersaing untuk hadiah besar',
    gift_title:           'Hadiah Harian',
    gift_sub:             'Klaim hadiah Anda sekarang',
    gift_claim_btn:       'Klaim',
    gift_preparing:       'Mempersiapkan...',
    daily:                'Harian',
    coming_soon:          'Segera',
    achievements:         'Pencapaian',
    achievements_sub:     'Dapatkan lencana khusus',
    soon:                 'Segera',
    invite_page_title:    'Undang Teman',
    invite_hero_title:    'Undang & Hasilkan',
    invite_hero_sub:      'Setiap teman = 25% penghasilannya untukmu',
    your_ref_link:        'Link referral Anda',
    total_referrals:      'Total referral aktif',
    earned_from_refs:     'Diperoleh dari referral +25%',
    balance_available:    'Saldo tersedia untuk penarikan',
    withdraw_methods_title:'Metode Penarikan',
    ton_wallet:           'Dompet TON',
    min_label:            'Minimum',
    available_badge:      'Tersedia',
    paypal_name:          'PayPal',
    fawry_name:           'Fawry Pay',
    withdraw_history_title:'Riwayat Penarikan',
    no_transactions:      'Tidak ada penarikan sebelumnya',
    nav_home:             'Beranda',
    nav_tasks:            'Tugas',
    nav_earn:             'Penghasilan',
    nav_withdraw:         'Tarik',
    no_tasks_sub:         'Belum ada tugas tersedia',
  },

};

// اللغات التي تُكتب من اليمين لليسار
const RTL_LANGS = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ku']);

// اللغة الحالية المُطبّقة
let _currentLang = 'ar';

/**
 * الدالة الرئيسية — استدعِها مرة واحدة بعد load.ok
 * @param {string} langCode — مثال: 'en', 'ar', 'ru', 'tr', 'fr', 'id'
 */
export function applyLanguage(langCode) {
  const code = _resolveCode(langCode);
  _currentLang = code;

  const dict = TRANSLATIONS[code] || TRANSLATIONS['ar'];
  const isRtl = RTL_LANGS.has(code);

  // 1. اتجاه الصفحة
  document.documentElement.lang = code;
  document.documentElement.dir  = isRtl ? 'rtl' : 'ltr';
  document.body.dir              = isRtl ? 'rtl' : 'ltr';

  // 2. ترجمة كل العناصر data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key] !== undefined) {
      // محافظة على العناصر الداخلية (مثل <em>) إن وُجدت
      if (el.children.length === 0) {
        el.textContent = dict[key];
      } else {
        // استبدل النص فقط مع الحفاظ على child elements
        _updateTextNode(el, dict[key]);
      }
    }
  });

  // 3. ضبط CSS الخاص بالاتجاه (اختياري — إن احتجت تعديل padding/margin)
  _applyDirectionCSS(isRtl);

  console.log(`[i18n] Applied language: ${code} (${isRtl ? 'RTL' : 'LTR'})`);
}

/**
 * ترجمة نص واحد بالمفتاح — للاستخدام في JS الديناميكي
 * مثال: t('earn_title') → 'Earn'
 */
export function t(key) {
  const dict = TRANSLATIONS[_currentLang] || TRANSLATIONS['ar'];
  return dict[key] ?? key;
}

// ════════════════════════════════════════════════════
// دوال داخلية
// ════════════════════════════════════════════════════

function _resolveCode(code) {
  if (!code) return 'ar';
  const c = String(code).toLowerCase().slice(0, 2);
  // إذا اللغة مش موجودة في القاموس — ارجع للإنجليزية fallback
  return TRANSLATIONS[c] ? c : (TRANSLATIONS[code] ? code : 'en');
}

function _updateTextNode(el, text) {
  // ابحث عن أول text node مباشر وعدّله
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      node.textContent = text + ' ';
      return;
    }
  }
  // إذا مفيش text node — أضف واحد في البداية
  el.insertBefore(document.createTextNode(text), el.firstChild);
}

function _applyDirectionCSS(isRtl) {
  let styleEl = document.getElementById('_i18n_dir_style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = '_i18n_dir_style';
    document.head.appendChild(styleEl);
  }
  if (isRtl) {
    styleEl.textContent = '';  // RTL هو الافتراضي في style.css
  } else {
    // LTR overrides — اقلب الـ padding/margin اللي اتبنت للـ RTL
    styleEl.textContent = `
      [dir=ltr] .hm-greeting,
      [dir=ltr] .uc-greeting { text-align: left; }
      [dir=ltr] .nav-label { letter-spacing: 0.02em; }
      [dir=ltr] .sheet { direction: ltr; text-align: left; }
      [dir=ltr] .tasks-e { direction: ltr; }
    `;
  }
}

// تصدير اللغة الحالية للاستخدام من ملفات أخرى
export function getCurrentLang() { return _currentLang; }
export function isRTL() { return RTL_LANGS.has(_currentLang); }

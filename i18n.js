/* ══════════════════════════════════════════════════════
   i18n.js — نظام اللغتين (عربي / إنجليزي)
   - شاشة اختيار اللغة أول مرة يفتح فيها المستخدم التطبيق
   - يطبّق dir/lang + خط "Inter" للإنجليزي على كل الواجهة
   - يترجم كل النصوص الثابتة (data-i18n) والنصوص الديناميكية
     التي يولّدها app.js عبر الدالة t()
══════════════════════════════════════════════════════ */

const RC_LANG_KEY = 'rc_lang';

const RC_STRINGS = {
  ar: {
    'nav.home': 'الرئيسية',
    'nav.tasks': 'المهام',
    'nav.rewards': 'المكافآت',
    'nav.referral': 'الإحالات',
    'nav.contest': 'المسابقة',
    'nav.wallet': 'المحفظة',
    'nav.history': 'السجل',
    'nav.settings': 'الإعدادات',

    'common.user': 'مستخدم',
    'common.member': 'عضو',
    'common.eliteMember': 'عضو نخبة ⭐',
    'common.loading': 'تحميل...',
    'common.point': 'نقطة',
    'common.cancel': 'إلغاء',
    'common.confirm': 'تأكيد',
    'common.you': ' (أنت)',
    'common.unknown': '؟',

    'home.subtitle': 'إليك ملخص أرباحك اليوم',
    'home.currentBalance': 'الرصيد الحالي',
    'home.rank': 'ترتيب',
    'home.withdrawBtn': 'سحب الرصيد',
    'home.statTodayEarn': 'أرباح اليوم',
    'home.statReferrals': 'إحالة',
    'home.statTasks': 'مهام',
    'home.quickActions': 'إجراءات سريعة',
    'home.quickWatchAd': 'مشاهدة إعلان',
    'home.quickDoTask': 'إنجاز مهمة',
    'home.quickInvite': 'دعوة صديق',
    'home.quickWithdraw': 'سحب',
    'home.greeting': 'مرحباً، {name} 👋',
    'home.todayEarn': '+{amount}$ اليوم',

    'tasks.eyebrow': 'مهامك اليوم',
    'tasks.title': 'أنجز مهام واربح',
    'tasks.watchAds': 'شاهد إعلانات',
    'tasks.joinChannel': 'انضم لقناة تيليجرام',
    'tasks.instantReward': 'مكافأة فورية',
    'tasks.invite3': 'ادعُ 3 أصدقاء',
    'tasks.dailyLogin': 'تسجيل دخول يومي',
    'tasks.dailyLoginDesc': '7 أيام متتالية = مكافأة كبرى',
    'tasks.completed': 'مكتملة',
    'tasks.start': 'ابدأ',
    'tasks.check': 'تحقق',
    'tasks.invite': 'دعوة',
    'tasks.claim': 'استلام',
    'tasks.done': 'مكتمل',
    'tasks.watch': 'شاهد',
    'tasks.watchProgress': 'أكمل الإعلانات اليومية للحصول على {amount}$ ({progress}/{required})',
    'tasks.joinProgress': 'انضم واحصل على {amount}$ فوراً',
    'tasks.inviteProgress': 'تقدم اليوم: {progress} من {required} — احصل على {amount}$',
    'tasks.dailyProgress': 'سلسلة {streak}/{required} يوم — احصل على {amount}$ اليوم',
    'tasks.oneTime': 'مهمة دائمة — لا تتجدد يوميًا',
    'tasks.taskAds': 'مهام سريعة',
    'tasks.taskAdProgress': 'أنجز مهام قصيرة واربح {amount}$ لكل مهمة ({progress}/{required} اليوم)',
    'tasks.taskAdRewardTag': '+0.001$',
    'tasks.go': 'اذهب',
    'tasks.claimTask': 'استلام',
    'tasks.noTaskAvailable': 'لا توجد مهام متاحة الآن — حاول بعد قليل',
    'tasks.dailyLimitReached': 'اكتمل الحد اليومي — عد غدًا',

    'rewards.eyebrow': 'رصيدك من النقاط',
    'rewards.cost': 'يكلف {cost} نقطة',
    'rewards.redeem': 'استبدال',
    'rewards.redeemTitle': 'استبدال: {title}',
    'rewards.redeemSub': 'سيتم خصم {cost} نقطة من رصيدك. هل تريد المتابعة؟',
    'rewards.redeemConfirm': 'تأكيد الاستبدال',
    'rewards.redeemSuccess': 'تم الاستبدال بنجاح 🎉',

    'referral.heading': 'ادعُ أصدقاءك واربح معًا',
    'referral.desc': 'احصل على 500 نقطة مسابقة فور تفعيل حساب صديقك، بالإضافة إلى 10% من أرباحه مدى الحياة',
    'referral.shareBtn': 'مشاركة الرابط',
    'referral.activeCount': 'إحالات نشطة',
    'referral.pendingCount': 'بانتظار التفعيل',
    'referral.historyTitle': 'سجل الإحالات',
    'referral.empty': 'لا يوجد إحالات بعد',
    'referral.active': 'نشط — تكسب 10% من أرباحه',
    'referral.pending': 'بانتظار التفعيل ({watched}/{required} إعلانات)',
    'referral.copySuccess': 'تم نسخ الرابط',
    'referral.copyFail': 'تعذر النسخ — انسخه يدويًا',
    'referral.shareText': 'انضم لـ ريل كاش واربح معي 💰',

    'contest.weeklyDefault': 'المسابقة الأسبوعية',
    'contest.title': 'سباق الصدارة',
    'contest.days': 'أيام',
    'contest.hours': 'ساعات',
    'contest.minutes': 'دقيقة',
    'contest.fullRanking': 'الترتيب الكامل',
    'contest.prize': 'جائزة {amount}$',

    'wallet.totalBalance': 'إجمالي الرصيد',
    'wallet.withdrawToTon': 'سحب إلى TON',
    'wallet.recentTx': 'آخر العمليات',
    'wallet.noTx': 'لا توجد عمليات بعد',

    'history.all': 'الكل',
    'history.earn': 'أرباح',
    'history.withdraw': 'سحوبات',

    'settings.account': 'الحساب',
    'settings.tonAddress': 'عنوان محفظة TON',
    'settings.notConnected': 'غير متصلة',
    'settings.language': 'اللغة',
    'settings.notifications': 'التنبيهات',
    'settings.notifyTasks': 'إشعارات المهام',
    'settings.notifyEarnings': 'تنبيهات الأرباح',
    'settings.notifyContest': 'تحديثات المسابقة',
    'settings.support': 'الدعم',
    'settings.helpCenter': 'مركز المساعدة',
    'settings.contactUs': 'تواصل معنا',
    'settings.faq': 'الأسئلة الشائعة',

    'withdraw.available': 'الرصيد المتاح:',
    'withdraw.minNote': 'الحد الأدنى للسحب:',
    'withdraw.amount': 'المبلغ (USD)',
    'withdraw.note': 'لازم تربط محفظة TON أولًا قبل السحب',
    'withdraw.confirm': 'تأكيد السحب',
    'withdraw.enterValidAmount': 'أدخل مبلغ صحيح',
    'withdraw.belowMin': 'الحد الأدنى للسحب {min}$',
    'withdraw.connectFirst': 'اربط محفظة TON أولًا',
    'withdraw.connectFromSettings': 'اربط محفظة TON أولًا من الإعدادات',
    'withdraw.success': 'تم إرسال طلب السحب بنجاح',

    'wallet_conn.loading': 'جاري تحميل TonConnect...',
    'wallet_conn.disconnected': 'تم فصل المحفظة',

    'faq.subtitle': 'كل اللي بدك تعرفه عن ريل كاش',
    'faq.q1': 'من نحن؟',
    'faq.a1': 'ريل كاش منصة داخل تيليجرام بتخليك تربح مال حقيقي أو نقاط من خلال مشاهدة الإعلانات، إنجاز المهام، ودعوة أصدقائك. أرباحك بتتجمع برصيدك وتقدر تسحبها لمحفظة TON.',
    'faq.q2': 'كيف أربح رصيد؟',
    'faq.a2': 'من صفحة "المهام" — شاهد إعلانات، أنجز مهام يومية، أو ادعُ أصدقاء عبر رابط الإحالة الخاص فيك من صفحة "الإحالات". كل مهمة موضح جنبها المبلغ اللي بتربحه.',
    'faq.q3': 'كيف أسحب رصيدي؟',
    'faq.a3': 'اربط محفظة TON من صفحة "الإعدادات"، بعدها روح لصفحة "المحفظة" واضغط "سحب إلى TON"، حدد المبلغ وأكّد. الطلب بينعالج ويوصلك إشعار لما ينرسل.',
    'faq.q4': 'هل بياناتي وأموالي آمنة؟',
    'faq.a4': 'نعم — التطبيق بيتحقق من هويتك عبر بيانات تيليجرام الرسمية، وكل عمليات السحب بتنربط بمحفظة TON اللي تربطها إنت بنفسك. ما منطلب أي معلومات حساسة زي كلمات مرور المحفظة.',
    'faq.q5': 'عندي سؤال ثاني، كيف أتواصل معكم؟',
    'faq.a5': 'تقدر تتواصل معنا مباشرة من زر "تواصل معنا" بصفحة الإعدادات، أو تنضم لقناة "مركز المساعدة" لآخر التحديثات والدعم.',

    'toast.confirming': 'جاري التأكيد...',
    'toast.adWatched': 'تم رصد المشاهدة +{amount}$',
    'toast.batchBonus': ' + مكافأة الدفعة',
    'toast.adProgress': '👏 أحسنت! تقدمت للأمام — شاهدت {progress} من {required} إعلان، تبقى لك {remaining} إعلان للوصول للمكافأة',
    'toast.adWatchedPlain': '✅ تم تسجيل المشاهدة بنجاح',
    'toast.batchComplete': '🎉 لقد أكملت جميع الإعلانات! حصلت على مكافأة +{amount}$',
    'toast.adLibraryError': 'تعذر تحميل مكتبة الإعلانات',
    'toast.noAdsAvailable': 'لا توجد إعلانات متاحة الآن — حاول بعد قليل',
    'toast.watchFully': 'يجب مشاهدة الإعلان كاملاً للحصول على المكافأة',
    'toast.notJoinedYet': 'لسه ما انضميت للقناة — انضم وحاول تاني',
    'toast.alreadyDone': 'المهمة مكتملة بالفعل',
    'toast.joinRecorded': 'تم رصد الانضمام +{amount}$',
    'toast.comeBackTomorrow': 'رجع بكرة تاخد مكافأة تسجيل الدخول',
    'toast.dailyClaimed': 'تم استلام مكافأة اليوم +{amount}$',
    'toast.streakComplete': ' 🎉 سلسلة كاملة!',
    'toast.taskAdReward': 'تم استلام المهمة +{amount}$',
    'toast.sessionTooLong': 'الجلسة طويلة جدًا — أعد فتح التطبيق للحصول على مهام جديدة',

    'errors.daily_limit_reached': 'وصلت للحد الأقصى من الإعلانات اليوم',
    'errors.cooldown': 'استنى شوي قبل الإعلان التالي',
    'errors.insufficient_points': 'نقاطك غير كافية',
    'errors.insufficient_balance': 'رصيدك غير كافٍ',
    'errors.wallet_not_connected': 'اربط محفظة TON أولًا',
    'errors.min_withdraw': 'المبلغ أقل من الحد الأدنى للسحب',
    'errors.not_member': 'لازم تنضم للقناة أولًا',
    'errors.referrals_required': 'تحتاج عدد إحالات نشطة أكبر قبل السحب',
    'errors.Unauthorized': 'تعذر التحقق من الحساب — أعد فتح التطبيق من تيليجرام',
    'errors.banned': 'حسابك محظور من استخدام التطبيق',
    'errors.watched_too_fast': 'لازم تشاهد الإعلان كاملاً للحصول على المكافأة',
    'errors.token_expired': 'انتهت صلاحية الجلسة — حاول مشاهدة الإعلان من جديد',
    'errors.token_already_used': 'تم احتساب هذا الإعلان مسبقاً',
    'errors.invalid_token': 'حدث خطأ ما — حاول مشاهدة الإعلان من جديد',
    'errors.pending_confirmation': 'جاري التأكيد — أعد المحاولة خلال لحظات',
    'errors.not_configured': 'هذه الميزة غير مفعّلة حالياً',
    'errors.default': 'تعذر الاتصال بالخادم',

    'time.now': 'الآن',
    'time.minutesAgo': 'منذ {n} دقيقة',
    'time.hoursAgo': 'منذ {n} ساعة',
    'time.yesterday': 'أمس',
    'time.daysAgo': 'منذ {n} أيام',

    'tx.newReferral': 'إحالة جديدة — {name}',
    'tx.inviteMilestone': 'مكافأة: دعوة 3 أصدقاء اليوم',
    'tx.referralCommission': 'حصة من ربح صديقك {name}',
    'tx.contestPrize': 'جائزة المسابقة — المركز {rank}',
    'tx.watchAd': 'مشاهدة إعلان',
    'tx.adBatchBonus': 'مكافأة: إكمال 5 إعلانات',
    'tx.joinChannel': 'انضمام لقناة تيليجرام',
    'tx.dailyLoginMilestone': 'مكافأة تسجيل الدخول — {streak} أيام متتالية 🎉',
    'tx.dailyLogin': 'تسجيل دخول يومي',
    'tx.redeem': 'استبدال: {title}',
    'tx.withdrawTon': 'سحب TON',
    'tx.taskAd': 'إنجاز مهمة سريعة',
  },

  en: {
    'nav.home': 'Home',
    'nav.tasks': 'Tasks',
    'nav.rewards': 'Rewards',
    'nav.referral': 'Referrals',
    'nav.contest': 'Contest',
    'nav.wallet': 'Wallet',
    'nav.history': 'History',
    'nav.settings': 'Settings',

    'common.user': 'User',
    'common.member': 'Member',
    'common.eliteMember': 'Elite Member ⭐',
    'common.loading': 'Loading...',
    'common.point': 'points',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.you': ' (You)',
    'common.unknown': '?',

    'home.subtitle': "Here's your earnings summary for today",
    'home.currentBalance': 'Current Balance',
    'home.rank': 'Rank',
    'home.withdrawBtn': 'Withdraw',
    'home.statTodayEarn': "Today's Earnings",
    'home.statReferrals': 'Referrals',
    'home.statTasks': 'Tasks',
    'home.quickActions': 'Quick Actions',
    'home.quickWatchAd': 'Watch an Ad',
    'home.quickDoTask': 'Complete a Task',
    'home.quickInvite': 'Invite a Friend',
    'home.quickWithdraw': 'Withdraw',
    'home.greeting': 'Welcome, {name} 👋',
    'home.todayEarn': '+${amount} today',

    'tasks.eyebrow': "Today's Tasks",
    'tasks.title': 'Complete Tasks & Earn',
    'tasks.watchAds': 'Watch Ads',
    'tasks.joinChannel': 'Join Telegram Channel',
    'tasks.instantReward': 'Instant reward',
    'tasks.invite3': 'Invite 3 Friends',
    'tasks.dailyLogin': 'Daily Check-in',
    'tasks.dailyLoginDesc': '7 days in a row = big bonus',
    'tasks.completed': 'Completed',
    'tasks.start': 'Start',
    'tasks.check': 'Verify',
    'tasks.invite': 'Invite',
    'tasks.claim': 'Claim',
    'tasks.done': 'Done',
    'tasks.watch': 'Watch',
    'tasks.watchProgress': 'Finish today\'s ads to get ${amount} ({progress}/{required})',
    'tasks.joinProgress': 'Join and get ${amount} instantly',
    'tasks.inviteProgress': "Today's progress: {progress} of {required} — get ${amount}",
    'tasks.dailyProgress': 'Streak {streak}/{required} days — get ${amount} today',
    'tasks.oneTime': "One-time task — doesn't reset daily",
    'tasks.taskAds': 'Quick Tasks',
    'tasks.taskAdProgress': 'short tasks ${amount} each ({progress}/{required} today)',
    'tasks.taskAdRewardTag': '+$0.001',
    'tasks.go': 'Go',
    'tasks.claimTask': 'Claim',
    'tasks.noTaskAvailable': 'No tasks available right now — try again shortly',
    'tasks.dailyLimitReached': "Daily limit reached — come back tomorrow",

    'rewards.eyebrow': 'Your Points Balance',
    'rewards.cost': 'Costs {cost} points',
    'rewards.redeem': 'Redeem',
    'rewards.redeemTitle': 'Redeem: {title}',
    'rewards.redeemSub': '{cost} points will be deducted from your balance. Continue?',
    'rewards.redeemConfirm': 'Confirm Redeem',
    'rewards.redeemSuccess': 'Redeemed successfully 🎉',

    'referral.heading': 'Invite Friends & Earn Together',
    'referral.desc': "Get 500 contest points as soon as your friend's account is activated, plus 10% of their earnings for life",
    'referral.shareBtn': 'Share Link',
    'referral.activeCount': 'Active Referrals',
    'referral.pendingCount': 'Pending Activation',
    'referral.historyTitle': 'Referral History',
    'referral.empty': 'No referrals yet',
    'referral.active': "Active — you earn 10% of their earnings",
    'referral.pending': 'Pending activation ({watched}/{required} ads)',
    'referral.copySuccess': 'Link copied',
    'referral.copyFail': "Couldn't copy — copy it manually",
    'referral.shareText': 'Join RealCash and earn with me 💰',

    'contest.weeklyDefault': 'Weekly Contest',
    'contest.title': 'Leaderboard Race',
    'contest.days': 'Days',
    'contest.hours': 'Hours',
    'contest.minutes': 'Min',
    'contest.fullRanking': 'Full Ranking',
    'contest.prize': 'Prize ${amount}',

    'wallet.totalBalance': 'Total Balance',
    'wallet.withdrawToTon': 'Withdraw to TON',
    'wallet.recentTx': 'Recent Transactions',
    'wallet.noTx': 'No transactions yet',

    'history.all': 'All',
    'history.earn': 'Earnings',
    'history.withdraw': 'Withdrawals',

    'settings.account': 'Account',
    'settings.tonAddress': 'TON Wallet Address',
    'settings.notConnected': 'Not connected',
    'settings.language': 'Language',
    'settings.notifications': 'Notifications',
    'settings.notifyTasks': 'Task Notifications',
    'settings.notifyEarnings': 'Earnings Alerts',
    'settings.notifyContest': 'Contest Updates',
    'settings.support': 'Support',
    'settings.helpCenter': 'Help Center',
    'settings.contactUs': 'Contact Us',
    'settings.faq': 'FAQ',

    'withdraw.available': 'Available balance:',
    'withdraw.minNote': 'Minimum withdrawal:',
    'withdraw.amount': 'Amount (USD)',
    'withdraw.note': 'You need to connect a TON wallet before withdrawing',
    'withdraw.confirm': 'Confirm Withdrawal',
    'withdraw.enterValidAmount': 'Enter a valid amount',
    'withdraw.belowMin': 'Minimum withdrawal is ${min}',
    'withdraw.connectFirst': 'Connect a TON wallet first',
    'withdraw.connectFromSettings': 'Connect a TON wallet from Settings first',
    'withdraw.success': 'Withdrawal request sent successfully',

    'wallet_conn.loading': 'Loading TonConnect...',
    'wallet_conn.disconnected': 'Wallet disconnected',

    'faq.subtitle': 'Everything you need to know about RealCash',
    'faq.q1': 'Who are we?',
    'faq.a1': 'RealCash is a Telegram-based platform that lets you earn real money or points by watching ads, completing tasks, and inviting friends. Your earnings accumulate in your balance and can be withdrawn to a TON wallet.',
    'faq.q2': 'How do I earn balance?',
    'faq.a2': 'From the "Tasks" page — watch ads, complete daily tasks, or invite friends via your referral link from the "Referrals" page. Each task shows the amount you\'ll earn next to it.',
    'faq.q3': 'How do I withdraw my balance?',
    'faq.a3': 'Connect a TON wallet from the "Settings" page, then go to the "Wallet" page and tap "Withdraw to TON", set the amount and confirm. The request is processed and you\'ll get a notification once it\'s sent.',
    'faq.q4': 'Is my data and money safe?',
    'faq.a4': "Yes — the app verifies your identity through official Telegram data, and all withdrawals go to the TON wallet you connect yourself. We never ask for sensitive information like wallet passwords.",
    'faq.q5': 'I have another question, how do I contact you?',
    'faq.a5': 'You can reach us directly from the "Contact Us" button on the Settings page, or join the "Help Center" channel for the latest updates and support.',

    'toast.confirming': 'Confirming...',
    'toast.adWatched': 'Watch recorded +${amount}',
    'toast.batchBonus': ' + batch bonus',
    'toast.adProgress': '👏 Nice progress! You\'ve watched {progress} of {required} ads — {remaining} more to reach your reward',
    'toast.adWatchedPlain': '✅ Watch recorded successfully',
    'toast.batchComplete': '🎉 You finished all the ads! You earned +${amount}',
    'toast.adLibraryError': 'Failed to load ads library',
    'toast.noAdsAvailable': 'No ads available right now — try again shortly',
    'toast.watchFully': 'You must watch the full ad to get the reward',
    'toast.notJoinedYet': "You haven't joined the channel yet — join and try again",
    'toast.alreadyDone': 'Task already completed',
    'toast.joinRecorded': 'Join recorded +${amount}',
    'toast.comeBackTomorrow': 'Come back tomorrow for the check-in reward',
    'toast.dailyClaimed': "Today's reward claimed +${amount}",
    'toast.streakComplete': ' 🎉 Full streak!',
    'toast.taskAdReward': 'Task claimed +${amount}',
    'toast.sessionTooLong': 'Session too long — reopen the app to get new tasks',

    'errors.daily_limit_reached': "You've reached today's ad limit",
    'errors.cooldown': 'Please wait a bit before the next ad',
    'errors.insufficient_points': 'Not enough points',
    'errors.insufficient_balance': 'Insufficient balance',
    'errors.wallet_not_connected': 'Connect a TON wallet first',
    'errors.min_withdraw': 'Amount is below the minimum withdrawal',
    'errors.not_member': 'You need to join the channel first',
    'errors.referrals_required': 'You need more active referrals before withdrawing',
    'errors.Unauthorized': 'Could not verify your account — reopen the app from Telegram',
    'errors.banned': 'Your account is banned from using the app',
    'errors.watched_too_fast': 'You must watch the full ad to get the reward',
    'errors.token_expired': 'Session expired — try watching the ad again',
    'errors.token_already_used': 'This ad has already been counted',
    'errors.invalid_token': 'Something went wrong — try watching the ad again',
    'errors.pending_confirmation': 'Confirming — try again in a moment',
    'errors.not_configured': 'This feature is not enabled right now',
    'errors.default': 'Could not reach the server',

    'time.now': 'now',
    'time.minutesAgo': '{n}m ago',
    'time.hoursAgo': '{n}h ago',
    'time.yesterday': 'Yesterday',
    'time.daysAgo': '{n}d ago',

    'tx.newReferral': 'New referral — {name}',
    'tx.inviteMilestone': 'Bonus: invited 3 friends today',
    'tx.referralCommission': "Share of {name}'s earnings",
    'tx.contestPrize': 'Contest prize — rank {rank}',
    'tx.watchAd': 'Watched an ad',
    'tx.adBatchBonus': 'Bonus: completed 5 ads',
    'tx.joinChannel': 'Joined Telegram channel',
    'tx.dailyLoginMilestone': 'Check-in bonus — {streak} days in a row 🎉',
    'tx.dailyLogin': 'Daily check-in',
    'tx.redeem': 'Redeemed: {title}',
    'tx.withdrawTon': 'TON withdrawal',
    'tx.taskAd': 'Completed a quick task',
  },
};

/* ===== Core helpers ===== */
function rcCurrentLang(){
  return document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ar';
}

function t(key, vars){
  const lang = rcCurrentLang();
  let str = (RC_STRINGS[lang] && RC_STRINGS[lang][key]) || RC_STRINGS.ar[key] || key;
  if (vars){
    Object.keys(vars).forEach(k => { str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
  }
  return str;
}

function applyStaticTranslations(){
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
}

/* Promise other scripts (app.js) await before calling bootstrap(),
   so we never render the app before the language is known. */
let _resolveLangReady;
window.RC_LANG_READY = new Promise(resolve => { _resolveLangReady = resolve; });

function applyLanguage(lang, opts){
  opts = opts || {};
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
  applyStaticTranslations();
  const sub = document.getElementById('languageSettingSub');
  if (sub) sub.textContent = lang === 'en' ? 'English' : 'العربية';
  try{ localStorage.setItem(RC_LANG_KEY, lang); } catch(e){}
  // إعادة رسم الصفحات الديناميكية إذا كانت البيانات محمّلة مسبقاً (تبديل لاحق من الإعدادات)
  if (opts.rerender && typeof appState !== 'undefined' && appState){
    renderHome(); renderTasks(); renderReferral(); renderContest(); renderWallet(); renderSettings(); renderRewards();
    loadWalletTx(); loadHistory('all');
  }
}

function selectLanguage(lang){
  applyLanguage(lang);
  const screen = document.getElementById('langSelectScreen');
  if (screen) screen.classList.add('hide');
  _resolveLangReady();
}

function toggleLanguage(){
  const next = rcCurrentLang() === 'ar' ? 'en' : 'ar';
  applyLanguage(next, { rerender: true });
}

(function initLanguage(){
  let saved = null;
  try{ saved = localStorage.getItem(RC_LANG_KEY); } catch(e){}
  if (saved === 'ar' || saved === 'en'){
    applyLanguage(saved);
    const screen = document.getElementById('langSelectScreen');
    if (screen) screen.classList.add('hide');
    _resolveLangReady();
  }
  // وإلا: تبقى شاشة اختيار اللغة ظاهرة، وينتظر RC_LANG_READY لحين اختيار المستخدم
})();

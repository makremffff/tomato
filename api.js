/* ══════════════════════════════════════════════════════
   api.js — بوابة موحّدة للتواصل مع api/index.js
   كل نداء: apiCall(type, data) → POST /api { type, data, initData }
══════════════════════════════════════════════════════ */

  async function apiCall(type, data){
    data = data || {};
    if (startParam && type === 'init') data.startParam = startParam;
    data.ts = Math.floor(Date.now() / 1000);
    try{
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data, initData })
      });
      let json = null;
      try { json = await res.json(); } catch(e){}
      if (!res.ok) throw new Error((json && json.error) || ('Request failed: ' + res.status));
      return json || { ok: true };
    } catch(err){
      throw err;
    }
  }

  function friendlyError(err){
    const map = {
      daily_limit_reached: 'وصلت للحد الأقصى من الإعلانات اليوم',
      cooldown: 'استنى شوي قبل الإعلان التالي',
      insufficient_points: 'نقاطك غير كافية',
      insufficient_balance: 'رصيدك غير كافٍ',
      wallet_not_connected: 'اربط محفظة TON أولًا',
      min_withdraw: 'المبلغ أقل من الحد الأدنى للسحب',
      not_member: 'لازم تنضم للقناة أولًا',
      referrals_required: 'تحتاج عدد إحالات نشطة أكبر قبل السحب',
      Unauthorized: 'تعذر التحقق من الحساب — أعد فتح التطبيق من تيليجرام',
      banned: 'حسابك محظور من استخدام التطبيق',
      watched_too_fast: 'لازم تشاهد الإعلان كاملاً للحصول على المكافأة',
      token_expired: 'انتهت صلاحية الجلسة — حاول مشاهدة الإعلان من جديد',
      token_already_used: 'تم احتساب هذا الإعلان مسبقاً',
      invalid_token: 'حدث خطأ ما — حاول مشاهدة الإعلان من جديد',
      pending_confirmation: 'جاري التأكيد — أعد المحاولة خلال لحظات',
    };
    const code = err && err.message;
    return map[code] || code || 'تعذر الاتصال بالخادم';
  }

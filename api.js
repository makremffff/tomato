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
      if (!res.ok) {
        const err = new Error((json && json.error) || ('Request failed: ' + res.status));
        if (json && json.retryAfterSec != null) err.retryAfterSec = json.retryAfterSec;
        throw err;
      }
      return json || { ok: true };
    } catch(err){
      throw err;
    }
  }

  function friendlyError(err){
    const code = err && err.message;
    const key = 'errors.' + code;
    const translated = typeof t === 'function' ? t(key) : null;
    // t() ترجع نفس المفتاح إذا ما لقت ترجمة — نتحقق من ذلك قبل الاعتماد عليها
    if (translated && translated !== key) return translated;
    return code || (typeof t === 'function' ? t('errors.default') : 'تعذر الاتصال بالخادم');
  }

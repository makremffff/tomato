/**
 * app-i18n.js
 * ترجمة تلقائية بالكامل عبر MyMemory API (مجاني، بدون key)
 * - يجيب لغة المستخدم من السيرفر (load.lang)
 * - يترجم كل عناصر data-i18n في الصفحة
 * - cache في الذاكرة لتجنب requests متكررة
 * - لو الترجمة فشلت، النص العربي الأصلي يظل كما هو
 */

const _CACHE = {};          // { 'ar|en|نص': 'translated' }
const _QUEUE = new Map();   // pending promises لتجنب طلبات مكررة

// اللغات RTL
const RTL = new Set(['ar','fa','he','ur','ps','ku','ug','yi','dv','sd']);

let _currentLang = 'ar';

// ─────────────────────────────────────────────
// الدالة الرئيسية — استدعِها بعد load.ok
// ─────────────────────────────────────────────
export async function applyLanguage(lang) {
    if (!lang) lang = 'ar';
    lang = lang.slice(0, 2).toLowerCase();
    _currentLang = lang;

    // ضبط اتجاه الصفحة
    const isRtl = RTL.has(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir  = isRtl ? 'rtl' : 'ltr';
    document.body.dir              = isRtl ? 'rtl' : 'ltr';

    // لو عربي — مفيش ترجمة، النصوص الأصلية عربية
    if (lang === 'ar') return;

    // جمّع كل النصوص المطلوب ترجمتها (بدون تكرار)
    const elements = [...document.querySelectorAll('[data-i18n]')];
    const texts    = [...new Set(
        elements
            .map(el => _getDirectText(el).trim())
            .filter(t => t.length > 0)
    )];

    if (!texts.length) return;

    // ترجم كل النصوص (مع cache)
    await _translateBatch(texts, 'ar', lang);

    // طبّق الترجمات على العناصر
    for (const el of elements) {
        const original = _getDirectText(el).trim();
        if (!original) continue;
        const key = `ar|${lang}|${original}`;
        if (_CACHE[key]) {
            _setDirectText(el, _CACHE[key]);
        }
    }
}

// ترجمة نص واحد (للاستخدام من JS ديناميكي)
export async function translateText(text, targetLang) {
    if (!targetLang || targetLang === 'ar') return text;
    targetLang = targetLang.slice(0, 2).toLowerCase();
    return await _translate(text, 'ar', targetLang) || text;
}

export function getCurrentLang() { return _currentLang; }
export function isRTL() { return RTL.has(_currentLang); }

// ─────────────────────────────────────────────
// MyMemory API — ترجمة دفعة من النصوص
// ─────────────────────────────────────────────
async function _translateBatch(texts, from, to) {
    const uncached = texts.filter(t => !_CACHE[`${from}|${to}|${t}`]);
    if (!uncached.length) return;

    // MyMemory: طلب واحد في كل مرة (لا يدعم batch رسمياً)
    // نرسلهم بالتوازي مع تجنب الـ duplicate
    const promises = uncached.map(t => _translate(t, from, to));
    await Promise.allSettled(promises);
}

async function _translate(text, from, to) {
    const cacheKey = `${from}|${to}|${text}`;
    if (_CACHE[cacheKey]) return _CACHE[cacheKey];

    // لو في طلب جاري لنفس النص، انتظره بدل ما نكرر
    if (_QUEUE.has(cacheKey)) return _QUEUE.get(cacheKey);

    const promise = _fetchTranslation(text, from, to).then(result => {
        _CACHE[cacheKey] = result || text;
        _QUEUE.delete(cacheKey);
        return _CACHE[cacheKey];
    }).catch(() => {
        _QUEUE.delete(cacheKey);
        return text; // fallback للنص الأصلي
    });

    _QUEUE.set(cacheKey, promise);
    return promise;
}

async function _fetchTranslation(text, from, to) {
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
        const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.responseStatus === 200) {
            return data.responseData?.translatedText || null;
        }
        return null;
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────
// helpers — قراءة/كتابة النص المباشر للعنصر
// (مع تجاهل العناصر الابن مثل <em>)
// ─────────────────────────────────────────────
function _getDirectText(el) {
    let text = '';
    for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
        }
    }
    return text;
}

function _setDirectText(el, newText) {
    for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            node.textContent = newText;
            return;
        }
    }
    // مفيش text node — أضف واحد
    el.insertBefore(document.createTextNode(newText), el.firstChild);
}

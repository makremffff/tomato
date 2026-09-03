# USDT Claim — Backend Setup

## بنية المشروع
```
index.html      ← الصفحة
style.css       ← التنسيق
assets.js       ← الصور (base64)
script.js       ← منطق الواجهة (متصل بالباك اند)
api/index.js    ← Vercel Serverless Function (الباك اند)
package.json    ← Dependency: @neondatabase/serverless
.env.example    ← متغيرات البيئة المطلوبة
```

## خطوات الربط

1. ارفع المجلد كامل (بما فيه `api/`) لمشروع Vercel جديد أو موجود.
2. أنشئ قاعدة بيانات على [Neon](https://neon.tech) وخذ الـ `DATABASE_URL`.
3. بـ Vercel → Settings → Environment Variables ضيف:
   - `DATABASE_URL`
   - `BOT_TOKEN` (من BotFather)
   - `INTERNAL_SECRET` (سلسلة عشوائية طويلة من عندك)
4. Deploy. الباك اند بيصير متاح على `/api` بنفس الدومين.
5. الفرونت (`script.js`) فيه:
   ```js
   const API_URL = '/api';
   ```
   يشتغل تلقائي بدون تعديل طالما الفرونت والباك اند بنفس مشروع Vercel.
   لو الفرونت مستضاف بمكان ثاني، غيّرها للرابط الكامل:
   ```js
   const API_URL = 'https://your-project.vercel.app/api';
   ```

## ملاحظات مهمة

- الصفحة تشتغل فقط جوه تيليجرام (تعتمد على `Telegram.WebApp.initData` للتحقق من هوية المستخدم).
  لو فتحتها بمتصفح عادي بدون تيليجرام، بترجع تلقائياً لوضع محلي (بدون سيرفر) للتجربة فقط —
  البيانات ما بتنحفظ بقاعدة البيانات بهذا الوضع.
- كل الحدود (مكافأة الكليم، الكولداون، الحد اليومي 0.03$، أقل سحب) مضبوطة بالسيرفر
  (`APP_CFG` بأعلى `api/index.js`) — الفرونت لا يُعتمد عليه لفرض أي حد، تقدر تغيّرها من مكان واحد فقط.
- جدول `users` و`withdrawals` و`transactions` تتنشئ تلقائياً أول تشغيل (`ensureSchema`).

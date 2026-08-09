/* ══════════════════════════════════════════════════════
   app.js — منطق التطبيق: محفظة TON، المهام، المكافآت،
   الإحالات، الإعدادات، الرسم على الصفحات، وتشغيل التطبيق
══════════════════════════════════════════════════════ */

  /* ===== TON Connect wallet ===== */
  let tonConnectUI = null;
  let connectedWallet = null;

  function initTonConnect(){
    if (!window.TON_CONNECT_UI) return;
    tonConnectUI = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl: TON_MANIFEST_URL });
    tonConnectUI.onStatusChange(async (wallet) => {
      if (wallet){
        const toFriendly = window.TON_CONNECT_UI.toUserFriendlyAddress;
        connectedWallet = toFriendly ? toFriendly(wallet.account.address) : wallet.account.address;
        renderWalletConnected(connectedWallet);
        try{ await apiCall('wallet.connect', { walletAddress: connectedWallet }); }
        catch(err){ showToast(friendlyError(err), 'error'); }
      } else {
        connectedWallet = null;
        renderWalletDisconnected();
      }
    });
  }

  function renderWalletConnected(address){
    document.getElementById('walletSettingSub').textContent = address;
    const chip = document.getElementById('walletChipWallet');
    chip.style.display = 'flex';
    document.getElementById('walletAddrWallet').textContent = address;
    const addrInput = document.getElementById('withdrawAddress');
    if (addrInput) addrInput.value = address;
  }
  function renderWalletDisconnected(){
    document.getElementById('walletSettingSub').textContent = t('settings.notConnected');
    document.getElementById('walletChipWallet').style.display = 'none';
    const addrInput = document.getElementById('withdrawAddress');
    if (addrInput) addrInput.value = '';
  }

  function onWalletRowClick(){
    if (!tonConnectUI){ showToast(t('wallet_conn.loading'), 'info'); return; }
    if (connectedWallet){
      tonConnectUI.disconnect();
      apiCall('wallet.disconnect', {}).catch(()=>{});
      showToast(t('wallet_conn.disconnected'), 'info');
    } else {
      tonConnectUI.openModal();
    }
  }

  /* ===== Withdraw flow ===== */
  async function openWithdrawModal(){
    if (!connectedWallet){
      showToast(t('withdraw.connectFromSettings'), 'error');
      goTo('settings');
      return;
    }
    await loadHome(); // تحديث فوري لرصيد وبيانات المستخدم قبل عرض نافذة السحب
    const min = appState?.config?.withdraw_min_usd ?? 0;
    document.getElementById('withdrawAmount').value = '';
    document.getElementById('withdrawAmount').min = min;
    document.getElementById('withdrawAvailable').textContent = (appState?.user.balance_usd ?? 0).toFixed(3) + '$';
    document.getElementById('withdrawMinNote').textContent = min.toFixed(3) + '$';
    openModal('withdrawModalOverlay');
  }

  async function submitWithdraw(){
    const amountInput = document.getElementById('withdrawAmount');
    const amount = parseFloat(amountInput.value);
    const min = appState?.config?.withdraw_min_usd ?? 0;
    if (!amount || amount <= 0){ showToast(t('withdraw.enterValidAmount'), 'error'); return; }
    if (amount < min){ showToast(t('withdraw.belowMin', { min: min.toFixed(3) }), 'error'); return; }
    if (!connectedWallet){ showToast(t('withdraw.connectFirst'), 'error'); return; }

    const btn = document.getElementById('withdrawConfirmBtn');
    setBtnLoading(btn, true);
    try{
      const res = await apiCall('wallet.withdraw', { amount });
      showToast(t('withdraw.success'), 'success');
      closeModal('withdrawModalOverlay');
      if (typeof res.newBalance === 'number') updateBalanceDisplay(res.newBalance);
      loadHome(); // لتحديث السجل والإحصائيات
    } catch(err){
      showToast(friendlyError(err), 'error');
    } finally {
      setBtnLoading(btn, false, t('withdraw.confirm'));
    }
  }

  function updateBalanceDisplay(newBalance){
    if (appState) appState.user.balance_usd = newBalance;
    document.querySelectorAll('#homeBalance, #walletBalance').forEach(el => {
      el.textContent = newBalance.toFixed(3);
      animateCountUp(el, 700);
    });
  }

  /* ===== Tasks: Adsgram Task block (مهام سريعة — حصة منفصلة تمامًا عن حصة إعلانات الفيديو أعلاه) =====
     العنصر <adsgram-task> يدير عرض المهمة وزر go/claim بنفسه، ويطلق حدث 'reward' فقط بعد
     أن يتأكد هو من إتمام المهمة فعليًا — نحن فقط نستجيب لهذا الحدث بمطالبة السيرفر بالمكافأة،
     والسيرفر بدوره لا يمنحها إلا بعد وصول تأكيد server-to-server حقيقي من Adsgram (راجع claimTaskAd). */
  let _taskAdClaiming = false;

  function initAdsgramTaskWidget(){
    const widget = document.getElementById('adsgramTaskWidget');
    if (!widget) return;

    widget.addEventListener('reward', () => { handleTaskAdReward(); });

    widget.addEventListener('onError', (event) => {
      console.warn('[adsgram-task] load/render error', event?.detail);
    });

    widget.addEventListener('onBannerNotFound', () => {
      const el = document.getElementById('taskAdProgress');
      if (el) el.textContent = t('tasks.noTaskAvailable');
    });

    widget.addEventListener('onTooLongSession', () => {
      showToast(t('toast.sessionTooLong'), 'info');
    });
  }

  async function handleTaskAdReward(){
    if (_taskAdClaiming) return; // 🛡️ يمنع استدعاءات مكررة لو أطلق العنصر الحدث أكثر من مرة
    _taskAdClaiming = true;
    try{
      let claim = await apiCall('tasks.claimTaskAd', {});
      let retries = 0;
      while (claim?.error === 'pending_confirmation' && retries < 5){
        if (retries === 0) showToast(t('toast.confirming'), 'info');
        await new Promise(r => setTimeout(r, claim.retryAfterMs || 1500));
        claim = await apiCall('tasks.claimTaskAd', {}).catch(e => ({ error: e.message }));
        retries++;
      }
      if (claim?.error) throw new Error(claim.error);

      showToast(t('toast.taskAdReward', { amount: claim.reward.toFixed(3) }), 'success');
      if (typeof claim.newBalance === 'number') updateBalanceDisplay(claim.newBalance);

      if (appState?.tasks?.task_ad){
        appState.tasks.task_ad.progress = claim.dailyTaskAdsProgress;
        appState.tasks.task_ad.done = claim.dailyTaskAdsProgress >= claim.dailyTaskAdsMax;
        renderTasks();
      }
      loadWalletTx();
      loadHistory('all');
    } catch(err){
      showToast(friendlyError(err), 'error');
    } finally {
      _taskAdClaiming = false;
    }
  }

  /* ===== Tasks: ads (Adsgram — نفس تدفق BigLeague: startAd → عرض حقيقي → claimAd) ===== */
  let _adsgramController = null;
  function getAdsgramController(){
    if (!_adsgramController && window.Adsgram){
      _adsgramController = window.Adsgram.init({ blockId: ADSGRAM_BLOCK_ID });
    }
    return _adsgramController;
  }

  // ⏱️ يعرض عداد ثواني حي على الزر أثناء فترة الانتظار (cooldown) بين مشاهدتين، ويرجعه طبيعي تلقائياً
  function startBtnCooldown(btn, seconds, idleLabel){
    if (btn._cooldownTimer) clearInterval(btn._cooldownTimer);
    let remaining = Math.max(1, Math.ceil(seconds));
    btn.disabled = true;
    btn.classList.add('is-cooldown');
    btn.textContent = `${remaining}s`;
    btn._cooldownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0){
        clearInterval(btn._cooldownTimer);
        btn._cooldownTimer = null;
        btn.classList.remove('is-cooldown');
        btn.disabled = false;
        btn.textContent = idleLabel;
      } else {
        btn.textContent = `${remaining}s`;
      }
    }, 1000);
  }

  async function handleAdTask(btn){
    setBtnLoading(btn, true);

    // الخطوة 1: احجز token من السيرفر (مدة المشاهدة الحقيقية محسومة من هنا، لا يتحكم بها العميل)
    let start;
    try{
      start = await apiCall('tasks.startAd', { adType: 'adsgram' });
    } catch(err){
      if (err.message === 'cooldown' && err.retryAfterSec){
        btn.innerHTML = '';
        startBtnCooldown(btn, err.retryAfterSec, t('tasks.start'));
      } else {
        showToast(friendlyError(err), 'error');
        setBtnLoading(btn, false, t('tasks.start'));
      }
      return;
    }

    // الخطوة 2: شغّل الإعلان الحقيقي عبر Adsgram SDK
    const adController = getAdsgramController();
    if (!adController){
      showToast(t('toast.adLibraryError'), 'error');
      setBtnLoading(btn, false, t('tasks.start'));
      return;
    }

    try{
      await adController.show();
    } catch(err){
      // 🛡️ كشف "no fill" (لا يوجد إعلان متاح الآن) — لا نعاقب المستخدم بأي cooldown في هذه الحالة
      const desc = (err?.description || err?.message || err?.code || '').toString().toLowerCase();
      const isNoFill = (err?.error === true && err?.done === false) ||
        ['no_fill','no fill','nofill','no ad','noads'].some(s => desc.includes(s));
      showToast(isNoFill ? t('toast.noAdsAvailable') : t('toast.watchFully'), 'error');
      setBtnLoading(btn, false, t('tasks.start'));
      return;
    }

    // الخطوة 3: طالب المكافأة — قد يحتاج السيرفر بضع ثوان لاستقبال تأكيد Adsgram (server-to-server)
    try{
      let claim = await apiCall('tasks.claimAd', { token: start.token });
      let retries = 0;
      while (claim?.error === 'pending_confirmation' && retries < 5){
        if (retries === 0) showToast(t('toast.confirming'), 'info');
        await new Promise(r => setTimeout(r, claim.retryAfterMs || 1500));
        claim = await apiCall('tasks.claimAd', { token: start.token }).catch(e => ({ error: e.message }));
        retries++;
      }
      if (claim?.error) throw new Error(claim.error);

      // 📢 إشعار تقدّم بدل عرض "+0.000$" على كل إعلان — المكافأة الفعلية تُمنح فقط عند إكمال الدفعة كاملة
      const required = claim.batchRequired ?? appState?.tasks?.watch_ads_5?.required ?? claim.dailyAdsProgress;
      const progress = claim.dailyAdsProgress ?? 0;
      const remaining = Math.max(0, required - progress);

      if (claim.batchBonus > 0) {
        showToast(t('toast.batchComplete', { amount: claim.batchBonus.toFixed(3) }), 'success');
      } else if (remaining <= 0) {
        showToast(t('toast.adWatchedPlain'), 'success');
      } else {
        showToast(t('toast.adProgress', { progress, required, remaining }), 'info');
      }

      if (typeof claim.newBalance === 'number') updateBalanceDisplay(claim.newBalance);
      loadHome();
      loadWalletTx();
      loadHistory('all');
    } catch(err){
      // 🛡️ جلسة إعلان أقل من الحد الأدنى المطلوب (35 ثانية) — نافذة تنبيه مخصصة بدل التوست العادي
      if (err.message === 'ad_incomplete') {
        openModal('adIncompleteOverlay');
      } else {
        showToast(friendlyError(err), 'error');
      }
    } finally {
      setBtnLoading(btn, false, t('tasks.start'));
    }
  }

  async function handleJoinChannel(btn){
    setBtnLoading(btn, true);
    try{
      const res = await apiCall('tasks.checkChannel', {});
      if (!res.ok){
        showToast(res.error === 'task_locked' ? t('toast.channelTaskLocked') : t('toast.notJoinedYet'), 'error');
        if (res.channel && tg?.openTelegramLink) tg.openTelegramLink('https://t.me/' + res.channel);
        return;
      }
      showToast(res.alreadyDone ? t('toast.alreadyDone') : t('toast.joinRecorded', { amount: (res.reward || 0).toFixed(3) }), 'success');
      if (typeof res.newBalance === 'number') updateBalanceDisplay(res.newBalance);
      loadHome();
      loadWalletTx();
      loadHistory('all');
    } catch(err){
      showToast(friendlyError(err), 'error');
    } finally {
      setBtnLoading(btn, false, t('tasks.check'));
    }
  }

  async function handleDailyLogin(btn){
    setBtnLoading(btn, true);
    try{
      const res = await apiCall('tasks.dailyLogin', {});
      if (res.alreadyDone){
        showToast(t('toast.comeBackTomorrow'), 'info');
      } else {
        showToast(t('toast.dailyClaimed', { amount: res.reward.toFixed(3) }) + (res.milestone ? t('toast.streakComplete') : ''), 'success');
        updateBalanceDisplay(res.newBalance);
      }
      loadHome();
      loadWalletTx();
      loadHistory('all');
    } catch(err){
      showToast(friendlyError(err), 'error');
    } finally {
      setBtnLoading(btn, false, t('tasks.claim'));
    }
  }

  /* ===== Rewards redeem ===== */
  function redeemReward(rewardId, cost, title){
    document.getElementById('confirmModalTitle').textContent = t('rewards.redeemTitle', { title });
    document.getElementById('confirmModalSub').textContent = t('rewards.redeemSub', { cost });
    const confirmBtn = document.getElementById('confirmModalBtn');
    confirmBtn.textContent = t('rewards.redeemConfirm');
    confirmBtn.onclick = async () => {
      setBtnLoading(confirmBtn, true);
      try{
        const res = await apiCall('rewards.redeem', { rewardId });
        showToast(t('rewards.redeemSuccess'), 'success');
        closeModal('confirmModalOverlay');
        document.getElementById('pointsBalance').textContent = res.newPointsBalance.toLocaleString('en-US');
        if (typeof res.newBalance === 'number') updateBalanceDisplay(res.newBalance);
      } catch(err){
        showToast(friendlyError(err), 'error');
      } finally {
        setBtnLoading(confirmBtn, false, t('rewards.redeemConfirm'));
      }
    };
    openModal('confirmModalOverlay');
  }

  /* ===== Rewards: Taddy watch-to-earn card =====
     زر واحد يشغّل إعلانين Taddy (interstitial) ورا بعض مباشرة عبر نفس Taddy SDK
     المُهيَّأ أصلاً في taddy-ads.js، ثم يطالب السيرفر بنقاط tasks.taddyReward
     فقط لو الاثنين انشاهدوا كاملين (onViewThrough) — إغلاق مبكر لا يُحتسب. */
  const TADDY_LOAD_TIMEOUT_MS = 10000; // ⏱️ لو تأخر تحميل الإعلان أكثر من 10 ثواني نلغي العملية بدل التعليق للأبد

  function playTaddyAd(){
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve('timeout');
      }, TADDY_LOAD_TIMEOUT_MS);

      // 🛡️ الاعتماد الأساسي على الـ Promise الراجع من interstitial() نفسه (success: boolean)
      // بدل onViewThrough فقط — حسب توثيق Taddy الرسمي هاد هو المصدر الموثوق لتأكيد أن
      // الإعلان انعرض فعلاً كاملاً. onViewThrough أحياناً ما ينادى بشكل موثوق/بوقته فيعلّق المكافأة.
      try{
        const result = window.Taddy.ads().interstitial({
          onClosed: () => {},
          onViewThrough: () => {}
        });
        Promise.resolve(result).then((success) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(!!success);
        }).catch((e) => {
          console.warn('[taddy] interstitial promise rejected', e);
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(false);
        });
      } catch(e){
        console.warn('[taddy] interstitial failed', e);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }
    });
  }

  async function watchTaddyReward(btn){
    if (!window.Taddy || typeof window.Taddy.ads !== 'function'){
      showToast(t('rewards.taddyUnavailable'), 'error');
      return;
    }
    setBtnLoading(btn, true);
    try{
      const v1 = await playTaddyAd();
      if (v1 === 'timeout') throw new Error('taddy_timeout');
      if (!v1) throw new Error('taddy_incomplete');
      const v2 = await playTaddyAd();
      if (v2 === 'timeout') throw new Error('taddy_timeout');
      if (!v2) throw new Error('taddy_incomplete');

      const res = await apiCall('tasks.taddyReward', {});
      document.getElementById('pointsBalance').textContent = Number(res.newPointsBalance).toLocaleString('en-US');
      showToast(t('rewards.taddySuccess', { points: res.reward }), 'success');
    } catch(err){
      if (err && err.message === 'taddy_timeout') showToast(t('toast.noAdsAvailable'), 'error');
      else if (err && err.message === 'taddy_incomplete') showToast(t('rewards.taddyIncomplete'), 'error');
      else showToast(friendlyError(err), 'error');
    } finally {
      setBtnLoading(btn, false, t('rewards.taddyWatch'));
    }
  }

  /* ===== Rewards: Adsterra Smart Link card =====
     زر بيفتح الرابط الذكي بتاب/متصفح خارجي، وبعدها انتظار 10 ثواني حقيقية (يتحقق منها
     السيرفر من started_at، مش من عداد الواجهة)، وبعدين يقدر يستلم النقاط. */
  let smartlinkState = null; // { nonce, timer, remaining }

  function openExternalLink(url){
    if (tg && tg.openLink) tg.openLink(url);
    else window.open(url, '_blank');
  }

  async function startSmartlinkTask(btn){
    if (smartlinkState) return; // مهمة شغالة أصلاً
    setBtnLoading(btn, true);
    try{
      const res = await apiCall('tasks.smartlinkStart', {});
      smartlinkState = { nonce: res.nonce, timer: null, remaining: res.waitSeconds };
      openExternalLink(res.url);

      setBtnLoading(btn, false);
      btn.disabled = true;
      btn.textContent = t('rewards.smartlinkWaiting', { sec: smartlinkState.remaining });

      smartlinkState.timer = setInterval(() => {
        smartlinkState.remaining -= 1;
        if (smartlinkState.remaining <= 0){
          clearInterval(smartlinkState.timer);
          btn.disabled = false;
          btn.textContent = t('rewards.smartlinkClaim');
          btn.onclick = () => claimSmartlinkTask(btn);
        } else {
          btn.textContent = t('rewards.smartlinkWaiting', { sec: smartlinkState.remaining });
        }
      }, 1000);
    } catch(err){
      smartlinkState = null;
      if (err && err.message === 'daily_limit_reached') showToast(t('rewards.smartlinkDailyLimit'), 'error');
      else showToast(friendlyError(err), 'error');
      setBtnLoading(btn, false, t('rewards.smartlinkStart'));
    }
  }

  async function claimSmartlinkTask(btn){
    if (!smartlinkState) return;
    setBtnLoading(btn, true);
    try{
      const res = await apiCall('tasks.smartlinkClaim', { nonce: smartlinkState.nonce });
      document.getElementById('pointsBalance').textContent = Number(res.newPointsBalance).toLocaleString('en-US');
      showToast(t('rewards.smartlinkSuccess', { points: res.reward }), 'success');
    } catch(err){
      showToast(friendlyError(err), 'error');
    } finally {
      smartlinkState = null;
      setBtnLoading(btn, false, t('rewards.smartlinkStart'));
      btn.onclick = () => startSmartlinkTask(btn);
    }
  }

  /* ===== "تصفح واربح" — صفحة كاملة مستقلة، دفعات كل 5 ثواني (التحقق الفعلي من الوقت من السيرفر) =====
     🛡️ وحدات إعلان Adsterra ما تتحقن نهائياً بأي مكان تاني بالتطبيق — تتحقن فقط هون، ولحظة موافقة
     المستخدم فعلياً، وتتشال من الصفحة تماماً أول ما يخرج المستخدم (زر الخروج أو انتهاء الجلسة).
     كل وحدة بتتحط جوا iframe معزول (srcdoc) — سكربتات Adsterra بتستخدم document.write، ولو
     حقناها مباشرة بصفحة التطبيق بعد ما الصفحة خلصت تحميل، document.write هتمسح صفحة التطبيق
     كلها. الـ iframe بيعزل الـ document.write جوا صفحته الخاصة بس. */
  let surfState = null; // { nonce, tick, totalTicks, tickSeconds, timer, displayTimer, remainingSeconds, earned }
  let surfPreviousPageId = 'rewards';
  const SURF_CONSENT_KEY = 'surfConsentAcknowledged';

  // Native Banner (يتمدد مع عرض الحاوية)
  const ADSTERRA_NATIVE_HTML = '<html><body style="margin:0;padding:0;background:transparent;">' +
    '<div id="container-f2de86b0d8774fcfe15876af7dedef3a"></div>' +
    '<script async data-cfasync="false" src="https://pl30769265.effectivecpmnetwork.com/f2de86b0d8774fcfe15876af7dedef3a/invoke.js"></script>' +
    '</body></html>';

  // Banner 160×300
  const ADSTERRA_BANNER_HTML = '<html><body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;">' +
    '<script>atOptions={key:"c3b0b1cc8721647603856fec45b52ff5",format:"iframe",height:300,width:160,params:{}};</script>' +
    '<script src="https://www.highperformanceformat.com/c3b0b1cc8721647603856fec45b52ff5/invoke.js"></script>' +
    '</body></html>';

  // Social Bar (إعلان عائم فوق الصفحة كلها — بيحقن نفسه بمكانه بشكل تلقائي)
  // ملاحظة: وحدتين Social Bar من Adsterra سوا بنفس الـ iframe — ما بيتعارضوا، كل وحدة بتحقن نفسها لحالها
  const ADSTERRA_SOCIALBAR_HTML = '<html><body style="margin:0;padding:0;background:transparent;">' +
    '<script src="https://pl30769264.effectivecpmnetwork.com/96/90/da/9690da690d344e2579dffa12d4e2ac24.js"></script>' +
    '<script src="https://pl29189522.effectivecpmnetwork.com/df/c2/ac/dfc2ac46938fa3284515588bf2f9203c.js"></script>' +
    '</body></html>';

  let surfAdFrames = [];
  let surfSocialBarFrame = null;
  let surfAdRefreshTimer = null;
  const SURF_AD_REFRESH_MS = 10000; // ⏱️ تحديث الإعلانات كل 10 ثواني

  function makeAdIframe(srcdocHtml, width, height){
    const f = document.createElement('iframe');
    f.srcdoc = srcdocHtml;
    f.style.border = '0';
    f.style.width = width;
    f.style.height = height;
    f.style.maxWidth = '100%';
    f.scrolling = 'no';
    return f;
  }

  // 🔄 يعيد إنشاء كل الـ iframes من الصفر (Native + Banner + Social Bar) — استدعاء الإعلان
  // من جديد بيولّد impression جديدة، وده اللي بيخلي الإعلانات "تتجدد"
  function renderAdsterraAds(){
    const container = document.getElementById('surfAdContainer');
    if (!container) return;

    container.innerHTML = '';
    const nativeFrame = makeAdIframe(ADSTERRA_NATIVE_HTML, '100%', '300px');
    const bannerFrame = makeAdIframe(ADSTERRA_BANNER_HTML, '160px', '300px');
    container.appendChild(nativeFrame);
    container.appendChild(bannerFrame);
    surfAdFrames = [nativeFrame, bannerFrame];

    // 🛡️ Social Bar بيغطي الصفحة كلها عشان يقدر يحط نفسه بأي زاوية — بس z-index أوطى
    // من زر الخروج (99999) عشان الزر يضل فوقه دايماً وقابل للنقر
    if (surfSocialBarFrame && surfSocialBarFrame.parentNode){
      surfSocialBarFrame.parentNode.removeChild(surfSocialBarFrame);
    }
    surfSocialBarFrame = makeAdIframe(ADSTERRA_SOCIALBAR_HTML, '100%', '100%');
    surfSocialBarFrame.style.position = 'fixed';
    surfSocialBarFrame.style.inset = '0';
    surfSocialBarFrame.style.zIndex = '9000';
    document.getElementById('page-surf').appendChild(surfSocialBarFrame);
  }

  function loadAdsterraAds(){
    if (surfAdFrames.length || surfAdRefreshTimer) return; // محمّلة أصلاً
    renderAdsterraAds();
    // ⏱️ كل الوحدات الأربعة تتجدد سوا كل 10 ثواني طول ما الجلسة شغالة
    surfAdRefreshTimer = setInterval(renderAdsterraAds, SURF_AD_REFRESH_MS);
  }

  function unloadAdsterraAds(){
    if (surfAdRefreshTimer){ clearInterval(surfAdRefreshTimer); surfAdRefreshTimer = null; }
    const container = document.getElementById('surfAdContainer');
    if (container) container.innerHTML = '';
    surfAdFrames = [];
    if (surfSocialBarFrame && surfSocialBarFrame.parentNode){
      surfSocialBarFrame.parentNode.removeChild(surfSocialBarFrame);
    }
    surfSocialBarFrame = null;
  }

  function openSurfPage(){
    // 🚧 شبكة أمان إضافية غير عرض/إخفاء الزر — حتى لو اتنادت الدالة مباشرة (كونسول مثلاً)
    if (SURF_UNDER_DEVELOPMENT && !isSurfAdmin()){
      showToast(t('surf.underDevelopment'), 'error');
      return;
    }
    // نتذكر الصفحة الحالية عشان نرجع لها عند الإلغاء/الانتهاء
    const activePage = document.querySelector('.page.active');
    surfPreviousPageId = activePage ? activePage.id.replace('page-', '') : 'rewards';

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById('page-surf');
    pageEl.classList.add('active');
    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    revealPage(pageEl);

    // إعادة ضبط الواجهة لأي جلسة سابقة
    document.getElementById('surfProgressBar').style.width = '0%';
    document.getElementById('surfEarnedSoFar').textContent = '+0.0000$';
    document.getElementById('surfCountdownDisplay').textContent = '60';

    // 🛡️ التحميل ما يبلش أبداً إلا بعد موافقة المستخدم — لو سبق ووافق وحدد "لا تذكرني"،
    // منتخطى الشاشة المنبثقة، وإلا لازم يوافق أول
    if (localStorage.getItem(SURF_CONSENT_KEY) === '1'){
      beginSurfSession();
    } else {
      document.getElementById('surfConsentOverlay').style.display = 'flex';
    }
  }

  function agreeSurfConsent(){
    if (document.getElementById('surfDontRemindCheckbox').checked){
      localStorage.setItem(SURF_CONSENT_KEY, '1');
    }
    document.getElementById('surfConsentOverlay').style.display = 'none';
    beginSurfSession();
  }

  async function beginSurfSession(){
    if (surfState) return; // جلسة شغالة أصلاً
    try{
      const res = await apiCall('ads.surfStart', {});
      const totalSeconds = res.totalTicks * res.tickSeconds;
      surfState = {
        nonce: res.nonce,
        tick: 0,
        totalTicks: res.totalTicks,
        tickSeconds: res.tickSeconds,
        rewardPerTick: res.rewardPerTick,
        earned: 0,
        timer: null,
        displayTimer: null,
        remainingSeconds: totalSeconds,
      };
      document.getElementById('surfCountdownDisplay').textContent = totalSeconds;
      loadAdsterraAds(); // 🛡️ التحميل يبلش هون بالضبط — بعد الموافقة وبدء الجلسة، وبهاي الصفحة فقط
      // ⏱️ عداد ثانية-بثانية على الواجهة (منفصل عن مواعيد التحقق من السيرفر كل 5 ثواني)
      // حتى يبان العداد فعلياً بينقص أول بأول، وما يضل واقف بين كل تحقق والثاني
      surfState.displayTimer = setInterval(surfTickDisplay, 1000);
      surfState.timer = setInterval(surfClaimNextTick, surfState.tickSeconds * 1000);
    } catch(err){
      if (err && err.message === 'daily_limit_reached') showToast(t('surf.dailyLimitReached'), 'error');
      else showToast(friendlyError(err), 'error');
      exitSurfPage();
    }
  }

  function surfTickDisplay(){
    if (!surfState) return;
    surfState.remainingSeconds = Math.max(0, surfState.remainingSeconds - 1);
    document.getElementById('surfCountdownDisplay').textContent = surfState.remainingSeconds;
  }

  async function surfClaimNextTick(){
    if (!surfState) return;
    const nextTick = surfState.tick + 1;
    try{
      const res = await apiCall('ads.surfClaim', { nonce: surfState.nonce, tick: nextTick });
      surfState.tick = res.tick;
      surfState.earned += res.reward;

      const pct = Math.round((surfState.tick / surfState.totalTicks) * 100);
      document.getElementById('surfProgressBar').style.width = pct + '%';
      // 🔄 مزامنة العداد المرئي مع الحقيقة القادمة من السيرفر — يصحح أي انزياح بسيط
      surfState.remainingSeconds = (surfState.totalTicks - surfState.tick) * surfState.tickSeconds;
      document.getElementById('surfCountdownDisplay').textContent = surfState.remainingSeconds;
      document.getElementById('surfEarnedSoFar').textContent = '+' + surfState.earned.toFixed(4) + '$';
      if (typeof res.newBalance === 'number') updateBalanceDisplay(res.newBalance);

      if (res.completed){
        clearInterval(surfState.timer);
        clearInterval(surfState.displayTimer);
        showToast(t('surf.completed'), 'success');
        setTimeout(() => { exitSurfPage(); loadHome(); }, 1200);
      }
    } catch(err){
      // ⏳ لو انسحب الطلب مبكر شوي (تفاوت شبكة بسيط)، منجرب مرة ثانية بنفس الـ tick
      // بدل ما نوقف الجلسة كلها لخطأ عابر
      console.warn('[surf] claim error', err);
    }
  }

  // 🛡️ ينهي الجلسة ويشيل سكربت الإعلان بس بدون تنقّل — تستخدم من زر الخروج، ومن أي مكان
  // تاني بيقدر المستخدم يطلع من الصفحة منه (تنقّل لصفحة تانية، تصغير التطبيق، تبديل تبويب)
  function endSurfSession(){
    if (surfState && surfState.timer) clearInterval(surfState.timer);
    if (surfState && surfState.displayTimer) clearInterval(surfState.displayTimer);
    surfState = null;
    document.getElementById('surfConsentOverlay').style.display = 'none';
    unloadAdsterraAds(); // 🛡️ نشيل وحدات إعلان Adsterra تماماً أول ما تنتهي الجلسة
  }

  function exitSurfPage(){
    endSurfSession();
    goTo(surfPreviousPageId || 'rewards');
  }

  // 🛡️ لو المستخدم صغّر التطبيق أو بدّل تبويب/تطبيق ثاني وهو بصفحة "تصفح واربح"،
  // منعتبرها خروج فوري: تنتهي الجلسة ويتشال سكربت الإعلان فوراً (ما منستنى رجوعه)
  // 🛡️ ملاحظة: تم تعمّد عدم إنهاء الجلسة عند visibilitychange — لأنه بيتفعّل كمان لما
  // المستخدم يضغط رابط خارجي جوا الإعلان (تليجرام بيفتحه بمتصفح خارجي/داخلي فيختفي
  // الـ WebView لحظياً)، وده كان يقفل الجلسة ويجمّد العداد بالغلط رغم إن المستخدم لسه
  // بنفس الصفحة. الإنهاء الفعلي بيصير بس لما المستخدم يتنقّل فعلياً جوا التطبيق (goTo)
  // أو يسكر/يهجر الصفحة فعلياً (pagehide).
  window.addEventListener('pagehide', function(){
    if (surfState) endSurfSession();
  });

  function renderRewards(){
    const s = appState;
    // 🚧 "تصفح واربح" قيد التطوير — تبان بس للأدمن لحد ما SURF_UNDER_DEVELOPMENT تصير false
    const surfCard = document.getElementById('surfRewardCard');
    if (surfCard) surfCard.style.display = (SURF_UNDER_DEVELOPMENT && !isSurfAdmin()) ? 'none' : '';
    document.getElementById('pointsBalance').textContent = Number(s.user.points).toLocaleString('en-US');
    const taddyPoints = s?.config?.taddy_reward_points;
    const taddyDescEl = document.getElementById('taddyRewardDesc');
    if (taddyDescEl && taddyPoints != null) taddyDescEl.textContent = t('rewards.taddyDesc', { points: taddyPoints });
    const catalog = s?.config?.rewards_catalog || {};
    const list = document.getElementById('rewardsList');
    list.innerHTML = Object.entries(catalog).map(([id, r]) => {
      // 🌐 عنوان الجائزة يترجم حسب اللغة الحالية لو متوفر مفتاح له في i18n.js (rewards.item.<id>)،
      // وإلا يرجع للعنوان الخام القادم من السيرفر (احتياطي لأي عنصر جديد بدون ترجمة بعد)
      const titleKey = 'rewards.item.' + id;
      const title = (RC_STRINGS[rcCurrentLang()] && RC_STRINGS[rcCurrentLang()][titleKey]) || r.title;
      return `
      <div class="task-card">
        <div class="task-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/></svg></div>
        <div class="task-mid">
          <div class="tn">${title}</div>
          <div class="td">${t('rewards.cost', { cost: r.cost.toLocaleString('en-US') })}</div>
        </div>
        <button class="task-btn" onclick="redeemReward('${id}', ${r.cost}, '${title.replace(/'/g, "\\'")}')">${t('rewards.redeem')}</button>
      </div>
    `;
    }).join('');
  }

  /* ===== Referral ===== */
  function copyReferralLink(){
    const text = document.getElementById('refLinkText').textContent.trim();
    navigator.clipboard.writeText(text).then(()=>{
      showToast(t('referral.copySuccess'), 'success');
      apiCall('referral.logCopy', {}).catch(()=>{});
    }).catch(()=> showToast(t('referral.copyFail'), 'error'));
  }

  function shareReferralLink(){
    const text = document.getElementById('refLinkText').textContent.trim();
    const shareText = t('referral.shareText');
    apiCall('referral.logShare', { platform: 'telegram' }).catch(()=>{});
    if (tg && tg.openTelegramLink){
      tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(text) + '&text=' + encodeURIComponent(shareText));
    } else if (navigator.share){
      navigator.share({ title: 'RealCash', text: shareText, url: text }).catch(()=>{});
    } else {
      copyReferralLink();
    }
  }

  /* ===== Support ===== */
  function openHelpChannel(){
    if (tg && tg.openTelegramLink) tg.openTelegramLink(HELP_CHANNEL_LINK);
    else window.open(HELP_CHANNEL_LINK, '_blank');
  }
  function openSupportChat(){
    const link = 'https://t.me/' + SUPPORT_USERNAME;
    if (tg && tg.openTelegramLink) tg.openTelegramLink(link);
    else window.open(link, '_blank');
  }

  function toggleFaq(qEl){
    const item = qEl.closest('.faq-item');
    const wasOpen = item.classList.contains('open');
    item.parentElement.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  }

  /* ===== Settings toggles ===== */
  async function saveSetting(key, toggleEl){
    const willBeOn = !toggleEl.classList.contains('on');
    toggleEl.classList.toggle('on');
    try{ await apiCall('settings.update', { key, value: willBeOn }); }
    catch(err){
      toggleEl.classList.toggle('on');
      showToast(friendlyError(err), 'error');
    }
  }

  /* ===== Rendering helpers ===== */
  function categoryIcon(cat){
    const icons = {
      earn:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
      referral: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>',
      task:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l2.5 2.5L16 9"/></svg>',
      reward:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M8.5 13L6 21l6-3 6 3-2.5-8"/></svg>',
      withdraw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
      penalty:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12.01" y2="16.5"/></svg>',
    };
    return icons[cat] || icons.earn;
  }
  function timeAgo(iso){
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return t('time.now');
    if (mins < 60) return t('time.minutesAgo', { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('time.hoursAgo', { n: hrs });
    const days = Math.floor(hrs / 24);
    if (days === 1) return t('time.yesterday');
    return t('time.daysAgo', { n: days });
  }
  function initials(name){
    return (name || t('common.unknown')).trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('');
  }
  function escapeAttr(str){
    return String(str ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function avatarHtml(name, photoUrl){
    const init = initials(name);
    if (!photoUrl) return init;
    return `<img src="${escapeAttr(photoUrl)}" alt="" data-fallback="${escapeAttr(init)}" onerror="avatarFallback(this)">`;
  }
  function avatarFallback(img){
    const span = document.createElement('span');
    span.textContent = img.dataset.fallback || t('common.unknown');
    img.replaceWith(span);
  }

  function renderHome(){
    const s = appState;
    document.getElementById('greetingText').textContent = t('home.greeting', { name: s.user.name });
    document.getElementById('homeBalance').textContent = s.user.balance_usd.toFixed(3);
    document.getElementById('userRankBadge').textContent = s.user.rank ?? '-';
    document.getElementById('todayEarnText').textContent = t('home.todayEarn', { amount: s.stats.today_earn_usd.toFixed(3) });
    document.getElementById('statTodayEarn').textContent = s.stats.today_earn_usd.toFixed(3) + '$';
    document.getElementById('statReferrals').textContent = s.stats.referrals_count;
    document.getElementById('statTasks').textContent = `${s.stats.tasks_done_today}/${s.stats.tasks_total}`;
    document.getElementById('sbUserName').textContent = s.user.name;
    document.getElementById('sbUserMeta').textContent = s.user.is_elite ? t('common.eliteMember') : t('common.member');
  }

  function renderTasks(){
    const s = appState;
    const w = s.tasks.watch_ads_5;
    document.getElementById('watchAdsProgress').textContent = t('tasks.watchProgress', { amount: s.config.ad_batch_bonus_usd.toFixed(3), progress: w.progress, required: w.required });
    const watchBtn = document.getElementById('taskBtn-watch_ads_5');
    if (w.done){ watchBtn.textContent = t('tasks.done'); watchBtn.classList.add('done'); watchBtn.disabled = true; }
    else { watchBtn.textContent = t('tasks.watch'); watchBtn.classList.remove('done'); watchBtn.disabled = false; }

    const channelCard = document.getElementById('taskCard-join_channel');
    if (s.tasks.join_channel.enabled){
      channelCard.style.display = 'flex';
      document.getElementById('joinChannelProgress').textContent = t('tasks.joinProgress', { amount: s.config.join_channel_reward_usd.toFixed(3) });
      const jBtn = document.getElementById('taskBtn-join_channel');
      const jStatus = document.getElementById('joinChannelStatus');
      if (s.tasks.join_channel.done){ jBtn.style.display='none'; jStatus.style.display='flex'; }
      else { jBtn.style.display='inline-flex'; jStatus.style.display='none'; }
    } else { channelCard.style.display = 'none'; }

    const inv = s.tasks.invite_3_friends;
    document.getElementById('inviteFriendsProgress').textContent = t('tasks.inviteProgress', { progress: inv.progress, required: inv.required, amount: (s.config.invite_milestone_reward_usd ?? 0.007).toFixed(3) });
    const invBtn = document.getElementById('taskBtn-invite_3_friends');
    const invStatus = document.getElementById('inviteFriendsStatus');
    if (inv.done){ invBtn.style.display='none'; invStatus.style.display='flex'; } else { invBtn.style.display='inline-flex'; invStatus.style.display='none'; }

    const dl = s.tasks.daily_login;
    const dlBtn = document.getElementById('taskBtn-daily_login');
    const dlStatus = document.getElementById('dailyLoginStatus');
    document.getElementById('dailyLoginProgress').textContent = t('tasks.dailyProgress', { streak: dl.streak, required: dl.required, amount: s.config.daily_login_reward_usd.toFixed(3) });
    if (dl.done){ dlBtn.style.display='none'; dlStatus.style.display='flex'; } else { dlBtn.style.display='inline-flex'; dlStatus.style.display='none'; }

    const ta = s.tasks.task_ad;
    const taWidget = document.getElementById('adsgramTaskWidget');
    const taStatus = document.getElementById('taskAdLimitStatus');
    const taProgressEl = document.getElementById('taskAdProgress');
    if (ta && ta.enabled){
      if (taProgressEl) taProgressEl.textContent = t('tasks.taskAdProgress', { amount: s.config.task_ad_reward_usd.toFixed(3), progress: ta.progress, required: ta.required });
      if (ta.done){
        if (taWidget) taWidget.style.display = 'none';
        if (taProgressEl) taProgressEl.style.display = 'none';
        if (taStatus) taStatus.style.display = 'flex';
      } else {
        if (taWidget) taWidget.style.display = 'block';
        if (taProgressEl) taProgressEl.style.display = 'block';
        if (taStatus) taStatus.style.display = 'none';
      }
    } else {
      // ADSGRAM_REWARD_SECRET غير مضبوط على السيرفر بعد — أخفِ القسم كاملاً بدل عرض ميزة معطّلة
      if (taWidget) taWidget.style.display = 'none';
      if (taProgressEl) taProgressEl.style.display = 'none';
      if (taStatus) taStatus.style.display = 'none';
    }
  }

  function renderReferral(){
    const s = appState;
    document.getElementById('refLinkText').textContent = `${REFERRAL_LINK_BASE}${s.user.referral_code}`;
    document.getElementById('refActiveCount').textContent = s.referral.active;
    document.getElementById('refPendingCount').textContent = s.referral.pending;

    const list = s.referral.list || [];
    const container = document.getElementById('refHistoryList');
    if (!list.length){
      container.innerHTML = `<div style="padding:16px 4px; color:var(--text-3); font-size:12.5px; text-align:center;">${t('referral.empty')}</div>`;
      return;
    }
    const ICON_CHECK = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.3l2.4 2.4L15.8 9.6"/></svg>`;
    const ICON_CLOCK = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 3.2"/></svg>`;
    container.innerHTML = list.map(f => {
      const statusText = f.activated
        ? t('referral.active')
        : t('referral.pending', { watched: f.ads_watched, required: f.activation_required });
      return `<div class="ref-list-item">
        <div class="ref-avatar">${avatarHtml(f.name, f.photo_url)}</div>
        <div class="ri"><div class="rn">${f.name}</div><div class="rd">${statusText}</div></div>
        <div class="rv" style="display:flex; align-items:center; gap:4px; color:${f.activated ? 'var(--mint)' : 'var(--text-3)'}">${f.activated ? ICON_CHECK : ICON_CLOCK}</div>
      </div>`;
    }).join('');
  }

  function renderContest(){
    const s = appState;
    document.getElementById('contestName').textContent = s.contest?.name || t('contest.weeklyDefault');
    if (s.contest?.end_at){
      const end = new Date(s.contest.end_at).getTime();
      const diff = Math.max(0, end - Date.now());
      document.getElementById('ctDays').textContent = String(Math.floor(diff / 86400000)).padStart(2,'0');
      document.getElementById('ctHours').textContent = String(Math.floor(diff % 86400000 / 3600000)).padStart(2,'0');
      document.getElementById('ctMinutes').textContent = String(Math.floor(diff % 3600000 / 60000)).padStart(2,'0');
    }
    const lb = s.leaderboard || [];
    const prizes = s.config?.contest_prizes_usd || {};
    const podiumOrder = [lb[1], lb[0], lb[2]]; // فضي - ذهبي - برونزي بصرياً
    const cls = ['silver', 'gold', 'bronze'];
    document.getElementById('contestPodium').innerHTML = podiumOrder.map((p, i) => {
      if (!p) return '';
      const crown = cls[i] === 'gold' ? '<svg class="crown" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18l-1.5-9-4.5 4-3-6-3 6-4.5-4z"/></svg>' : '';
      const prize = p.score > 0 ? prizes[p.rank] : null;
      return `<div class="pod-item ${cls[i]}">
        ${crown}
        <div class="pod-avatar">${avatarHtml(p.name, p.photo_url)}</div>
        <div class="pod-name">${p.name}</div>
        <div class="pod-score anim-num">${p.score} ${t('common.point')}</div>
        ${prize ? `<div class="pod-prize">${t('contest.prize', { amount: prize.toFixed(2) })}</div>` : ''}
        <div class="pod-bar">${p.rank}</div>
      </div>`;
    }).join('');
    document.getElementById('contestLeaderboard').innerHTML = lb.slice(3).map(p => `
      <div class="lb-row">
        <div class="lb-rank">${p.rank}</div>
        <div class="ref-avatar">${avatarHtml(p.name, p.photo_url)}</div>
        <div class="lb-info"><div class="ln">${p.name}${p.telegram_id === s.user.telegram_id ? t('common.you') : ''}</div><div class="ld">${p.score} ${t('common.point')}</div></div>
        <div class="lb-score anim-num">${p.score}</div>
      </div>
    `).join('');
  }

  function renderWallet(){
    const s = appState;
    document.getElementById('walletBalance').textContent = s.user.balance_usd.toFixed(3);
    if (s.user.wallet_address) renderWalletConnected(s.user.wallet_address); else renderWalletDisconnected();
  }

  function renderSettings(){
    const s = appState;
    document.getElementById('settingsName').textContent = s.user.name;
    document.getElementById('settingsHandle').textContent = '@' + s.user.telegram_id;
    document.getElementById('settingsAvatarInitial').innerHTML = avatarHtml(s.user.name, s.user.photo_url);
    ['notify_tasks','notify_earnings','notify_contest'].forEach(k=>{
      document.getElementById('toggle-'+k).classList.toggle('on', !!s.user[k]);
    });
  }

  function renderTransactionsInto(container, txs, emptyMsg){
    if (!txs.length){
      container.innerHTML = `<div style="padding:16px 4px; color:var(--text-3); font-size:12.5px; text-align:center;">${emptyMsg}</div>`;
      return;
    }
    container.innerHTML = txs.map(tx => {
      const up = tx.amount_usd >= 0;
      const displayTitle = tx.title_key ? t(tx.title_key, tx.title_params || {}) : tx.title;
      return `<div class="tx-row">
        <div class="tx-ic"><img src="asesst/ic-history.png" alt=""></div>
        <div class="tx-info"><div class="tn">${displayTitle}</div><div class="td">${timeAgo(tx.created_at)}</div></div>
        <div class="tx-v anim-num" style="color:${up ? 'var(--mint)' : 'var(--danger)'}">${up ? '+' : ''}${tx.amount_usd.toFixed(3)}$</div>
      </div>`;
    }).join('');
  }

  async function loadWalletTx(){
    try{
      const res = await apiCall('history.list', { limit: 6 });
      renderTransactionsInto(document.getElementById('walletTxList'), res.transactions, t('wallet.noTx'));
    } catch(err){ console.error(err); }
  }

  async function loadHistory(filter){
    try{
      const res = await apiCall('history.list', { filter: filter === 'all' ? undefined : filter, limit: 6 });
      const container = document.getElementById('historyTimeline');
      renderTransactionsInto(container, res.transactions, t('wallet.noTx'));
      // العناصر الجديدة تحتاج فئة timeline بدل tx-row لتنسيق مطابق للتصميم الأصلي
      container.querySelectorAll('.tx-row').forEach(el => el.classList.add('t-item'));
    } catch(err){ console.error(err); }
  }

  document.querySelectorAll('#historyFilterTabs .f-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#historyFilterTabs .f-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadHistory(tab.dataset.filter);
    });
  });

  /* ===== Init flow ===== */
  async function loadHome(){
    try{
      appState = await apiCall('init', {});
      renderHome(); renderTasks(); renderReferral(); renderContest(); renderWallet(); renderSettings(); renderRewards();
    } catch(err){
      showToast(friendlyError(err), 'error');
    }
  }

  async function bootstrap(){
    initTonConnect();
    initAdsgramTaskWidget();
    await loadHome();
    loadWalletTx();
    loadHistory('all');
    revealPage(document.querySelector('.page.active'));
    animateNumbersIn(document.querySelector('.page.active'));
  }

  // ننتظر اختيار اللغة (أو استرجاعها من الجلسة السابقة) قبل تحميل التطبيق
  window.RC_LANG_READY.then(bootstrap);

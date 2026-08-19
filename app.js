/* ══════════════════════════════════════════════════════
   app.js — منطق التطبيق: محفظة TON، المهام، المكافآت،
   الإحالات، الإعدادات، الرسم على الصفحات، وتشغيل التطبيق
══════════════════════════════════════════════════════ */

  /* ═══════════ حماية AdBlock / VPN — تحمي صفحة "تصفح واربح" وروابط المهام (Task Ads / Smart Link) ═══════════
     كشف مجاني best-effort (بدون API مدفوع):
     - AdBlock: عنصر طُعم بأسماء كلاسات إعلانية معروفة + طلب لمورد إعلاني معروف — لو انحجب/انحظر نعتبره مفعّل
     - VPN: تقريبي فقط عبر مقارنة منطقة IP العام (ipapi.co) بمنطقة جهاز المستخدم الزمنية + كلمات مفتاحية
       شائعة بحقل "org" (استضافة/VPN معروفة) — مو كشف دقيق 100%، ممكن يستبدل لاحقاً بخدمة مدفوعة أدق */
  let _lastAdblockState = false;
  let _lastVpnState = false;
  let _blockCheckInFlight = null;
  let _blockGuardRetry = null;

  function detectAdBlock(){
    return new Promise((resolve) => {
      const bait = document.createElement('div');
      bait.className = 'adsbox ad-banner adsbygoogle ad-placement pub_300x250 textads banner_ads ads';
      bait.style.cssText = 'position:absolute; left:-9999px; top:-9999px; width:1px; height:1px;';
      document.body.appendChild(bait);
      setTimeout(() => {
        const cssBlocked = bait.offsetParent === null || bait.offsetHeight === 0 || bait.clientHeight === 0
          || getComputedStyle(bait).display === 'none' || getComputedStyle(bait).visibility === 'hidden';
        bait.remove();
        fetch('https://pagead2.googlesyndication.com/pagead/id', { mode: 'no-cors', cache: 'no-store' })
          .then(() => resolve(cssBlocked))
          .catch(() => resolve(true));
      }, 120);
    });
  }

  async function detectVpn(){
    try{
      const res = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
      if (!res.ok) return false;
      const info = await res.json();
      const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const ipTz = info.timezone || '';
      const tzMismatch = !!(deviceTz && ipTz && deviceTz !== ipTz);
      const org = String(info.org || '').toLowerCase();
      const vpnKeywords = ['vpn','proxy','hosting','cloud','datacenter','data center','digitalocean','ovh','m247','choopa','leaseweb','amazon','linode','vultr','g-core','nordvpn','expressvpn','surfshark','private internet access','psiphon'];
      const orgLooksLikeVpn = vpnKeywords.some(k => org.includes(k));
      return !!(tzMismatch || orgLooksLikeVpn);
    } catch(err){
      return false; // فشل الفحص (شبكة/حظر) ما يُعتبر VPN — تجنّب حجب مستخدمين شرعيين بالغلط
    }
  }

  async function checkAdblockAndVpn(){
    if (_blockCheckInFlight) return _blockCheckInFlight;
    _blockCheckInFlight = Promise.all([detectAdBlock(), detectVpn()])
      .then(([adblock, vpn]) => {
        _lastAdblockState = adblock;
        _lastVpnState = vpn;
        return { adblock, vpn };
      })
      .finally(() => { _blockCheckInFlight = null; });
    return _blockCheckInFlight;
  }

  // 🔄 فحص خلفي (بدون حجب الواجهة) — يحدّث الحالة المحفوظة اللي يعتمد عليها معترض ضغطة Task Ad
  function refreshBlockStateCache(){
    checkAdblockAndVpn().catch(() => {});
  }

  // يُستخدم قبل أي إجراء نتحكم فيه بالكامل (بدء جلسة تصفح، فتح رابط سريع) — فحص فوري
  // (مو من الكاش) قبل السماح بالمتابعة، ويعرض شاشة الحظر ويحفظ دالة إعادة المحاولة لو انحظر
  async function guardAgainstAdblockVpn(retryCallback){
    const { adblock, vpn } = await checkAdblockAndVpn();
    if (adblock || vpn){
      showAdblockVpnBlock(adblock, vpn, retryCallback);
      return false;
    }
    return true;
  }

  function showAdblockVpnBlock(adblock, vpn, retryCallback){
    _blockGuardRetry = retryCallback || null;
    const overlay = document.getElementById('adblockVpnOverlay');
    const msgEl = document.getElementById('adblockVpnMsg');
    if (!overlay || !msgEl) return;
    msgEl.textContent = (adblock && vpn) ? t('block.bothMsg') : adblock ? t('block.adblockMsg') : t('block.vpnMsg');
    overlay.style.display = 'flex';
  }

  async function recheckAdblockVpn(){
    const retryBtn = document.getElementById('adblockVpnRetryBtn');
    setBtnLoading(retryBtn, true);
    const { adblock, vpn } = await checkAdblockAndVpn();
    setBtnLoading(retryBtn, false, t('block.recheck'));
    if (!adblock && !vpn){
      document.getElementById('adblockVpnOverlay').style.display = 'none';
      const cb = _blockGuardRetry;
      _blockGuardRetry = null;
      if (cb) cb();
    } else {
      showToast(t('block.stillBlocked'), 'error');
      showAdblockVpnBlock(adblock, vpn, _blockGuardRetry);
    }
  }

  function closeAdblockVpnOverlay(){
    const overlay = document.getElementById('adblockVpnOverlay');
    if (overlay) overlay.style.display = 'none';
    _blockGuardRetry = null;
  }

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

    // 🛡️ ممنوع فتح رابط مهمة Task Ad ومانع الإعلانات أو VPN مفعّل — نعترض الضغطة بمرحلة الـ capture
    // قبل ما توصل لمعالج العنصر الداخلي (best-effort، العنصر مكون خارجي مغلق فما نقدر نضمنها 100%).
    // القرار يعتمد على آخر فحص محفوظ بالذاكرة (refreshBlockStateCache) لأن الضغطة نفسها متزامنة
    // وما نقدر ننتظر فيها نتيجة فحص شبكي جديد قبل ما يتصرف العنصر الداخلي.
    widget.addEventListener('click', function(e){
      if (_lastAdblockState || _lastVpnState){
        e.preventDefault();
        e.stopPropagation();
        showAdblockVpnBlock(_lastAdblockState, _lastVpnState, null);
      }
    }, true);

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
    // 🛡️ شبكة أمان أخيرة قبل صرف المكافأة — لو تبين إن مانع إعلانات أو VPN مفعّل ما نصرفها
    if (_lastAdblockState || _lastVpnState){
      showAdblockVpnBlock(_lastAdblockState, _lastVpnState, null);
      return;
    }
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

  /* ===== Rewards: كرت المكافأة اليومية (Daily Bonus) =====
     زر بيفتح الرابط بتاب/متصفح خارجي، وبعدها انتظار 10 ثواني حقيقية (يتحقق منها
     السيرفر من started_at، مش من عداد الواجهة)، وبعدين يقدر يستلم المكافأة.
     3 مرات كل 24 ساعة (نافذة متجددة من أول استلام)، إجمالي 0.01$ مقسومة على 3 مرات. */
  let dailyBonusState = null; // { nonce, timer, remaining }

  function openExternalLink(url){
    if (tg && tg.openLink) tg.openLink(url);
    else window.open(url, '_blank');
  }

  function renderDailyBonusCard(){
    const s = appState;
    const btn = document.getElementById('dailyBonusBtn');
    const desc = document.getElementById('dailyBonusProgress');
    if (!btn || !desc || !s || !s.tasks || !s.tasks.daily_bonus) return;
    if (dailyBonusState) return; // مهمة شغالة أصلاً — لا تلمس الزر أثناء العد التنازلي
    const { progress, required } = s.tasks.daily_bonus;
    if (progress >= required){
      desc.textContent = t('tasks.dailyBonusEnded');
      btn.disabled = true;
      btn.textContent = t('tasks.dailyBonusDone');
    } else {
      desc.textContent = t('tasks.dailyBonusDesc', { progress, required });
      btn.disabled = false;
      btn.textContent = t('tasks.dailyBonusStart');
      btn.onclick = () => startDailyBonus(btn);
    }
  }

  async function startDailyBonus(btn){
    if (dailyBonusState) return; // مهمة شغالة أصلاً
    // 🛡️ ممنوع فتح رابط المهمة ومانع الإعلانات أو VPN مفعّل
    const passed = await guardAgainstAdblockVpn(() => startDailyBonus(btn));
    if (!passed) return;
    setBtnLoading(btn, true);
    try{
      const res = await apiCall('tasks.dailyBonusStart', {});
      dailyBonusState = { nonce: res.nonce, timer: null, remaining: res.waitSeconds };
      openExternalLink(res.url);

      setBtnLoading(btn, false);
      btn.disabled = true;
      btn.textContent = t('tasks.dailyBonusWaiting', { sec: dailyBonusState.remaining });

      dailyBonusState.timer = setInterval(() => {
        dailyBonusState.remaining -= 1;
        if (dailyBonusState.remaining <= 0){
          clearInterval(dailyBonusState.timer);
          btn.disabled = false;
          btn.textContent = t('tasks.dailyBonusClaim');
          btn.onclick = () => claimDailyBonus(btn);
        } else {
          btn.textContent = t('tasks.dailyBonusWaiting', { sec: dailyBonusState.remaining });
        }
      }, 1000);
    } catch(err){
      dailyBonusState = null;
      if (err && err.message === 'daily_limit_reached') showToast(t('tasks.dailyBonusLimit'), 'error');
      else showToast(friendlyError(err), 'error');
      setBtnLoading(btn, false, t('tasks.dailyBonusStart'));
    }
  }

  async function claimDailyBonus(btn){
    if (!dailyBonusState) return;
    setBtnLoading(btn, true);
    try{
      const res = await apiCall('tasks.dailyBonusClaim', { nonce: dailyBonusState.nonce });
      showToast(t('tasks.dailyBonusSuccess', { amount: Number(res.reward).toFixed(4) }), 'success');
      if (typeof res.newBalance === 'number') updateBalanceDisplay(res.newBalance);
      loadHome();
      loadWalletTx();
      loadHistory('all');
    } catch(err){
      showToast(friendlyError(err), 'error');
    } finally {
      dailyBonusState = null;
      setBtnLoading(btn, false, t('tasks.dailyBonusStart'));
      renderDailyBonusCard();
    }
  }

  /* ===== "تصفح واربح" — صفحة كاملة مستقلة، دفعات كل 5 ثواني (التحقق الفعلي من الوقت من السيرفر) =====
     🛡️ وحدات إعلان Adsterra ما تتحقن نهائياً بأي مكان تاني بالتطبيق — تتحقن فقط هون، ولحظة موافقة
     المستخدم فعلياً، وتتشال من الصفحة تماماً أول ما يخرج المستخدم (زر الخروج أو انتهاء الجلسة).
     كل وحدة بتتحط جوا iframe معزول (srcdoc) — سكربتات Adsterra بتستخدم document.write، ولو
     حقناها مباشرة بصفحة التطبيق بعد ما الصفحة خلصت تحميل، document.write هتمسح صفحة التطبيق
     كلها. الـ iframe بيعزل الـ document.write جوا صفحته الخاصة بس. */
  // Native Banner (يتمدد مع عرض الحاوية)
  const ADSTERRA_NATIVE_HTML = '<html><body style="margin:0;padding:0;background:transparent;">' +
    '<div id="container-30e20b615096518ccd4af02a8de2c86e"></div>' +
    '<script async data-cfasync="false" src="https://interventioncopiedloitering.com/30e20b615096518ccd4af02a8de2c86e/invoke.js"></script>' +
    '</body></html>';

  // Banner 320×50
  const ADSTERRA_BANNER_MOBILE_HTML = '<html><body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;">' +
    '<script>atOptions={key:"04bcf6532017b6790ab2ddac95a5621d",format:"iframe",height:50,width:320,params:{}};</script>' +
    '<script src="https://interventioncopiedloitering.com/04bcf6532017b6790ab2ddac95a5621d/invoke.js"></script>' +
    '</body></html>';

  // Banner 728×90
  const ADSTERRA_LEADERBOARD_HTML = '<html><body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;">' +
    '<script>atOptions={key:"6591d8cb13042eb0d24df990ae424042",format:"iframe",height:90,width:728,params:{}};</script>' +
    '<script src="https://interventioncopiedloitering.com/6591d8cb13042eb0d24df990ae424042/invoke.js"></script>' +
    '</body></html>';

  // Banner 160×600
  const ADSTERRA_BANNER_HTML = '<html><body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;">' +
    '<script>atOptions={key:"832c2ab019ed7e5b767d47265f24fd72",format:"iframe",height:600,width:160,params:{}};</script>' +
    '<script src="https://interventioncopiedloitering.com/832c2ab019ed7e5b767d47265f24fd72/invoke.js"></script>' +
    '</body></html>';

  // Social Bar (إعلان عائم فوق الصفحة كلها — بيحقن نفسه بمكانه بشكل تلقائي)
  const ADSTERRA_SOCIALBAR_HTML = '<html><body style="margin:0;padding:0;background:transparent;">' +
    '<script src="https://interventioncopiedloitering.com/d0/f6/b3/d0f6b318f29b5787025697029ae72f23.js"></script>' +
    '</body></html>';

  // === وحدات إضافية (مفاتيح مختلفة) — تظهر بنفس وقت الوحدات اللي فوق ===

  // Native Banner إضافي
  const ADSTERRA_NATIVE2_HTML = '<html><body style="margin:0;padding:0;background:transparent;">' +
    '<div id="container-edcc6b64c6bd0828f216780427110f9e"></div>' +
    '<script async data-cfasync="false" src="https://interventioncopiedloitering.com/edcc6b64c6bd0828f216780427110f9e/invoke.js"></script>' +
    '</body></html>';

  // Banner 160×300
  const ADSTERRA_BANNER_160x300_HTML = '<html><body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;">' +
    '<script>atOptions={key:"07ba49d9751a7850eaada0ec92f2b9ab",format:"iframe",height:300,width:160,params:{}};</script>' +
    '<script src="https://interventioncopiedloitering.com/07ba49d9751a7850eaada0ec92f2b9ab/invoke.js"></script>' +
    '</body></html>';

  // Banner 320×50 إضافي
  const ADSTERRA_BANNER_MOBILE2_HTML = '<html><body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;">' +
    '<script>atOptions={key:"b895987c82805b8778a34f54911e8de0",format:"iframe",height:50,width:320,params:{}};</script>' +
    '<script src="https://interventioncopiedloitering.com/b895987c82805b8778a34f54911e8de0/invoke.js"></script>' +
    '</body></html>';

  // Banner 728×90 إضافي
  const ADSTERRA_LEADERBOARD2_HTML = '<html><body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;">' +
    '<script>atOptions={key:"52387ebcd1498aa0c9c53e6965993fdc",format:"iframe",height:90,width:728,params:{}};</script>' +
    '<script src="https://interventioncopiedloitering.com/52387ebcd1498aa0c9c53e6965993fdc/invoke.js"></script>' +
    '</body></html>';

  // Banner 160×600 إضافي
  const ADSTERRA_BANNER2_HTML = '<html><body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;">' +
    '<script>atOptions={key:"e5adfc0f5e5225f4680755acfd93fbc0",format:"iframe",height:600,width:160,params:{}};</script>' +
    '<script src="https://interventioncopiedloitering.com/e5adfc0f5e5225f4680755acfd93fbc0/invoke.js"></script>' +
    '</body></html>';

  // Banner 468×60
  const ADSTERRA_BANNER_468x60_HTML = '<html><body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;">' +
    '<script>atOptions={key:"1749e30af32d97f3e94a600bf0581123",format:"iframe",height:60,width:468,params:{}};</script>' +
    '<script src="https://interventioncopiedloitering.com/1749e30af32d97f3e94a600bf0581123/invoke.js"></script>' +
    '</body></html>';

  // Banner 300×250
  const ADSTERRA_BANNER_300x250_HTML = '<html><body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;">' +
    '<script>atOptions={key:"f54816edb76c2de5faa09943209d794d",format:"iframe",height:250,width:300,params:{}};</script>' +
    '<script src="https://interventioncopiedloitering.com/f54816edb76c2de5faa09943209d794d/invoke.js"></script>' +
    '</body></html>';

  // سكربتات عائمة إضافية (نفس نمط Social Bar بدون atOptions)
  const ADSTERRA_FLOAT1_HTML = '<html><body style="margin:0;padding:0;background:transparent;">' +
    '<script src="https://interventioncopiedloitering.com/0d/51/8d/0d518d9629f90a733d63c6cdff05cac6.js"></script>' +
    '</body></html>';

  const ADSTERRA_FLOAT2_HTML = '<html><body style="margin:0;padding:0;background:transparent;">' +
    '<script src="https://interventioncopiedloitering.com/5d/77/0f/5d770ff402768d79ddda9c1cd67e9819.js"></script>' +
    '</body></html>';

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

  /* ==================================================================================
     🌐 نظام إعلانات عام (Global Ad Stack) — بفترات راحة للمستخدم
     الفكرة: يظهر عدد قليل من الوحدات (1-2) لمدة 4 ثواني بس، وبعدين تختفي كلها تماماً،
     وتدخل الشاشة في "فترة راحة/تهدئة" عشوائية بين 20 و30 ثانية بدون أي إعلان خالص —
     حتى يقدر المستخدم يتابع محتوى البوت من غير ما يتزعج. بعد الراحة، يظهر اختيار عشوائي
     جديد من الوحدات لـ4 ثواني تانية، وهكذا.
     ================================================================================== */
  const GLOBAL_AD_UNITS = [
    { html: ADSTERRA_NATIVE_HTML,          width: 300, height: 300 },
    { html: ADSTERRA_BANNER_MOBILE_HTML,   width: 320, height: 50  },
    { html: ADSTERRA_LEADERBOARD_HTML,     width: 728, height: 90  },
    { html: ADSTERRA_BANNER_HTML,          width: 160, height: 600 },
    { html: ADSTERRA_NATIVE2_HTML,         width: 300, height: 300 },
    { html: ADSTERRA_BANNER_160x300_HTML,  width: 160, height: 300 },
    { html: ADSTERRA_BANNER_MOBILE2_HTML,  width: 320, height: 50  },
    { html: ADSTERRA_LEADERBOARD2_HTML,    width: 728, height: 90  },
    { html: ADSTERRA_BANNER2_HTML,         width: 160, height: 600 },
    { html: ADSTERRA_BANNER_468x60_HTML,   width: 468, height: 60  },
    { html: ADSTERRA_BANNER_300x250_HTML,  width: 300, height: 250 },
  ];
  const GLOBAL_FLOAT_UNITS = [ADSTERRA_SOCIALBAR_HTML, ADSTERRA_FLOAT1_HTML, ADSTERRA_FLOAT2_HTML];

  // كل الوحدات (بانرات + عائمة) في مصفوفة واحدة يتم الاختيار العشوائي منها كل دورة
  const ALL_AD_ENTRIES = [
    ...GLOBAL_AD_UNITS.map(u => ({ type: 'banner', width: u.width, height: u.height, html: u.html })),
    ...GLOBAL_FLOAT_UNITS.map(html => ({ type: 'float', html }))
  ];

  const AD_VISIBLE_MS = 4000;                       // ⏱️ مدة الظهور: 4 ثواني بالضبط لكل إعلان
  const AD_REST_MS_CHOICES = [20000, 25000, 30000]; // 😌 فترة الراحة: 20/25/30 ثانية بدون أي إعلان
  const AD_MAX_CONCURRENT = 1;                       // إعلان واحد بس في كل مرة — بعدها يتوقف تماماً

  let globalAdStackEl = null;
  let globalAdSchedulerTimer = null;
  let globalAdCurrentFrames = [];
  let globalAdStackStarted = false;

  function ensureGlobalAdStack(){
    if (globalAdStackEl) return globalAdStackEl;
    const el = document.createElement('div');
    el.id = 'globalAdStack';
    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.right = '0';
    el.style.bottom = '0';
    el.style.zIndex = '7000';
    el.style.pointerEvents = 'none'; // كل إعلان بيفعّل النقر على نفسه بس
    document.body.appendChild(el);
    globalAdStackEl = el;
    return el;
  }

  // وحدة إعلان بمقاس ثابت — بتتحط أسفل الشاشة بإزاحة عشوائية بسيطة حتى تبان متكدسة
  // فوق بعض بشكل غير منتظم لو ظهر أكتر من وحدة بنفس اللحظة
  function spawnStackedAd(unit, layerIndex){
    const stack = ensureGlobalAdStack();
    const frame = makeAdIframe(unit.html, unit.width + 'px', unit.height + 'px');
    frame.style.position = 'absolute';
    const offsetX = Math.floor(Math.random() * 40) - 20;
    const offsetY = Math.floor(Math.random() * 24) - 12;
    frame.style.left = 'calc(50% - ' + (unit.width / 2) + 'px + ' + offsetX + 'px)';
    frame.style.bottom = Math.max(6, 10 + offsetY) + 'px';
    frame.style.zIndex = String(7000 + layerIndex);
    frame.style.pointerEvents = 'auto';
    frame.style.borderRadius = '10px';
    frame.style.boxShadow = '0 6px 24px rgba(0,0,0,.35)';
    frame.style.maxWidth = '92vw';
    stack.appendChild(frame);
    return frame;
  }

  // وحدة عائمة بتغطي الشاشة كلها (Social Bar وشبيهاتها) — بتحقن نفسها بمكانها تلقائياً
  function spawnFloatAd(html, layerIndex){
    const stack = ensureGlobalAdStack();
    const frame = makeAdIframe(html, '100%', '100%');
    frame.style.position = 'fixed';
    frame.style.inset = '0';
    frame.style.zIndex = String(7500 + layerIndex);
    frame.style.pointerEvents = 'none';
    stack.appendChild(frame);
    return frame;
  }

  function clearCurrentAds(){
    globalAdCurrentFrames.forEach(f => { if (f && f.parentNode) f.parentNode.removeChild(f); });
    globalAdCurrentFrames = [];
  }

  // 🔁 دورة واحدة: اختيار عدد قليل من الوحدات عشوائياً → تظهر 4 ثواني → تختفي بالكامل
  // → فترة راحة عشوائية 20-30 ثانية بدون أي إعلان → دورة جديدة
  function runAdCycle(){
    clearCurrentAds();

    const count = AD_MAX_CONCURRENT;
    const pool = [...ALL_AD_ENTRIES];
    for (let i = 0; i < count && pool.length; i++){
      const idx = Math.floor(Math.random() * pool.length);
      const entry = pool.splice(idx, 1)[0];
      const frame = entry.type === 'banner'
        ? spawnStackedAd(entry, i)
        : spawnFloatAd(entry.html, i);
      globalAdCurrentFrames.push(frame);
    }

    // بعد 4 ثواني: تختفي الإعلانات كلها وتبلش فترة الراحة
    globalAdSchedulerTimer = setTimeout(() => {
      clearCurrentAds();
      const restMs = AD_REST_MS_CHOICES[Math.floor(Math.random() * AD_REST_MS_CHOICES.length)];
      globalAdSchedulerTimer = setTimeout(runAdCycle, restMs);
    }, AD_VISIBLE_MS);
  }

  // 🌐 يشتغل مرة وحدة مع تحميل التطبيق، ويفضل شغال على كل الصفحات طول عمر الجلسة —
  // مفيش ربط بجوائز أو نقاط أو مودال موافقة، الإعلانات دلوقتي جزء عام من التطبيق بس
  function initGlobalAdStack(){
    if (globalAdStackStarted) return;
    globalAdStackStarted = true;
    // بداية أولى بعد تأخير بسيط عشوائي (0-5 ثواني) عشان ما يبانش الإعلان لحظة فتح التطبيق فوراً
    globalAdSchedulerTimer = setTimeout(runAdCycle, Math.floor(Math.random() * 5000));
  }

  initGlobalAdStack();

  function renderRewards(){
    const s = appState;
    document.getElementById('pointsBalance').textContent = Number(s.user.points).toLocaleString('en-US');
    const catalog = s?.config?.rewards_catalog || {};
    const list = document.getElementById('rewardsList');
    list.innerHTML = Object.entries(catalog).map(([id, r]) => {
      // 🌐 عنوان الجائزة يترجم حسب اللغة الحالية لو متوفر مفتاح له في i18n.js (rewards.item.<id>)،
      // وإلا يرجع للعنوان الخام القادم من السيرفر (احتياطي لأي عنصر جديد بدون ترجمة بعد)
      const titleKey = 'rewards.item.' + id;
      const title = (RC_STRINGS[rcCurrentLang()] && RC_STRINGS[rcCurrentLang()][titleKey]) || r.title;
      return `
      <div class="task-card">
        <div class="task-ic"><img src="asesst/ic-redeem.png" alt=""></div>
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
    // 🔄 نحدّث حالة AdBlock/VPN المحفوظة كل ما تترسم صفحة المهام — عشان معترض ضغطة Task Ad يكون محدّث
    refreshBlockStateCache();
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

    const br = s.tasks.browse_100;
    if (br){
      const brBtn = document.getElementById('taskBtn-browse_100');
      const brStatus = document.getElementById('browseTaskStatus');
      const brProgressEl = document.getElementById('browseTaskProgress');
      if (brProgressEl && s.config) brProgressEl.textContent = t('tasks.browseProgress', { amount: s.config.browse_task_reward_usd.toFixed(3), progress: br.progress, required: br.required });
      if (br.done){ if (brBtn) brBtn.style.display='none'; if (brStatus) brStatus.style.display='flex'; }
      else { if (brBtn) brBtn.style.display='inline-flex'; if (brStatus) brStatus.style.display='none'; }
    }

    renderDailyBonusCard();
  }

  // 🎯 مهمة "تصفح 100 مرة" — الزر ينقل مباشرة لصفحة المكافآت اللي فيها كرت "تصفح واربح"
  function goToBrowseTask(){
    goTo('rewards');
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

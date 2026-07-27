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
    document.getElementById('walletSettingSub').textContent = 'غير متصلة';
    document.getElementById('walletChipWallet').style.display = 'none';
    const addrInput = document.getElementById('withdrawAddress');
    if (addrInput) addrInput.value = '';
  }

  function onWalletRowClick(){
    if (!tonConnectUI){ showToast('جاري تحميل TonConnect...', 'info'); return; }
    if (connectedWallet){
      tonConnectUI.disconnect();
      apiCall('wallet.disconnect', {}).catch(()=>{});
      showToast('تم فصل المحفظة', 'info');
    } else {
      tonConnectUI.openModal();
    }
  }

  /* ===== Withdraw flow ===== */
  async function openWithdrawModal(){
    if (!connectedWallet){
      showToast('اربط محفظة TON أولًا من الإعدادات', 'error');
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
    if (!amount || amount <= 0){ showToast('أدخل مبلغ صحيح', 'error'); return; }
    if (amount < min){ showToast('الحد الأدنى للسحب ' + min.toFixed(3) + '$', 'error'); return; }
    if (!connectedWallet){ showToast('اربط محفظة TON أولًا', 'error'); return; }

    const btn = document.getElementById('withdrawConfirmBtn');
    setBtnLoading(btn, true);
    try{
      const res = await apiCall('wallet.withdraw', { amount });
      showToast('تم إرسال طلب السحب بنجاح', 'success');
      closeModal('withdrawModalOverlay');
      if (typeof res.newBalance === 'number') updateBalanceDisplay(res.newBalance);
      loadHome(); // لتحديث السجل والإحصائيات
    } catch(err){
      showToast(friendlyError(err), 'error');
    } finally {
      setBtnLoading(btn, false, 'تأكيد السحب');
    }
  }

  function updateBalanceDisplay(newBalance){
    if (appState) appState.user.balance_usd = newBalance;
    document.querySelectorAll('#homeBalance, #walletBalance').forEach(el => {
      el.textContent = newBalance.toFixed(3);
      animateCountUp(el, 700);
    });
  }

  /* ===== Tasks: ads (Adsgram — نفس تدفق BigLeague: startAd → عرض حقيقي → claimAd) ===== */
  let _adsgramController = null;
  function getAdsgramController(){
    if (!_adsgramController && window.Adsgram){
      _adsgramController = window.Adsgram.init({ blockId: ADSGRAM_BLOCK_ID });
    }
    return _adsgramController;
  }

  async function handleAdTask(btn){
    setBtnLoading(btn, true);

    // الخطوة 1: احجز token من السيرفر (مدة المشاهدة الحقيقية محسومة من هنا، لا يتحكم بها العميل)
    let start;
    try{
      start = await apiCall('tasks.startAd', { adType: 'adsgram' });
    } catch(err){
      showToast(friendlyError(err), 'error');
      setBtnLoading(btn, false, 'ابدأ');
      return;
    }

    // الخطوة 2: شغّل الإعلان الحقيقي عبر Adsgram SDK
    const adController = getAdsgramController();
    if (!adController){
      showToast('تعذر تحميل مكتبة الإعلانات', 'error');
      setBtnLoading(btn, false, 'ابدأ');
      return;
    }

    try{
      await adController.show();
    } catch(err){
      // 🛡️ كشف "no fill" (لا يوجد إعلان متاح الآن) — لا نعاقب المستخدم بأي cooldown في هذه الحالة
      const desc = (err?.description || err?.message || err?.code || '').toString().toLowerCase();
      const isNoFill = (err?.error === true && err?.done === false) ||
        ['no_fill','no fill','nofill','no ad','noads'].some(s => desc.includes(s));
      showToast(isNoFill ? 'لا توجد إعلانات متاحة الآن — حاول بعد قليل' : 'يجب مشاهدة الإعلان كاملاً للحصول على المكافأة', 'error');
      setBtnLoading(btn, false, 'ابدأ');
      return;
    }

    // الخطوة 3: طالب المكافأة — قد يحتاج السيرفر بضع ثوان لاستقبال تأكيد Adsgram (server-to-server)
    try{
      let claim = await apiCall('tasks.claimAd', { token: start.token });
      let retries = 0;
      while (claim?.error === 'pending_confirmation' && retries < 5){
        if (retries === 0) showToast('جاري التأكيد...', 'info');
        await new Promise(r => setTimeout(r, claim.retryAfterMs || 1500));
        claim = await apiCall('tasks.claimAd', { token: start.token }).catch(e => ({ error: e.message }));
        retries++;
      }
      if (claim?.error) throw new Error(claim.error);

      showToast('تم رصد المشاهدة +' + claim.reward.toFixed(3) + '$' + (claim.batchBonus ? ' + مكافأة الدفعة' : ''), 'success');
      updateBalanceDisplay(claim.newBalance);
      loadHome();
    } catch(err){
      showToast(friendlyError(err), 'error');
    } finally {
      setBtnLoading(btn, false, 'ابدأ');
    }
  }

  async function handleJoinChannel(btn){
    setBtnLoading(btn, true);
    try{
      const res = await apiCall('tasks.checkChannel', {});
      if (!res.ok){
        showToast('لسه ما انضميت للقناة — انضم وحاول تاني', 'error');
        if (res.channel && tg?.openTelegramLink) tg.openTelegramLink('https://t.me/' + res.channel);
        return;
      }
      showToast(res.alreadyDone ? 'المهمة مكتملة بالفعل' : 'تم رصد الانضمام +' + (res.reward || 0).toFixed(3) + '$', 'success');
      if (typeof res.newBalance === 'number') updateBalanceDisplay(res.newBalance);
      loadHome();
    } catch(err){
      showToast(friendlyError(err), 'error');
    } finally {
      setBtnLoading(btn, false, 'تحقق');
    }
  }

  async function handleDailyLogin(btn){
    setBtnLoading(btn, true);
    try{
      const res = await apiCall('tasks.dailyLogin', {});
      if (res.alreadyDone){
        showToast('رجع بكرة تاخد مكافأة تسجيل الدخول', 'info');
      } else {
        showToast('تم استلام مكافأة اليوم +' + res.reward.toFixed(3) + '$' + (res.milestone ? ' 🎉 سلسلة كاملة!' : ''), 'success');
        updateBalanceDisplay(res.newBalance);
      }
      loadHome();
    } catch(err){
      showToast(friendlyError(err), 'error');
    } finally {
      setBtnLoading(btn, false, 'استلام');
    }
  }

  /* ===== Rewards redeem ===== */
  function redeemReward(rewardId, cost, title){
    document.getElementById('confirmModalTitle').textContent = 'استبدال: ' + title;
    document.getElementById('confirmModalSub').textContent = 'سيتم خصم ' + cost + ' نقطة من رصيدك. هل تريد المتابعة؟';
    const confirmBtn = document.getElementById('confirmModalBtn');
    confirmBtn.textContent = 'تأكيد الاستبدال';
    confirmBtn.onclick = async () => {
      setBtnLoading(confirmBtn, true);
      try{
        const res = await apiCall('rewards.redeem', { rewardId });
        showToast('تم الاستبدال بنجاح 🎉', 'success');
        closeModal('confirmModalOverlay');
        document.getElementById('pointsBalance').textContent = res.newPointsBalance.toLocaleString('en-US');
        if (typeof res.newBalance === 'number') updateBalanceDisplay(res.newBalance);
      } catch(err){
        showToast(friendlyError(err), 'error');
      } finally {
        setBtnLoading(confirmBtn, false, 'تأكيد الاستبدال');
      }
    };
    openModal('confirmModalOverlay');
  }

  function renderRewards(){
    const catalog = appState?.config?.rewards_catalog || {};
    const list = document.getElementById('rewardsList');
    list.innerHTML = Object.entries(catalog).map(([id, r]) => `
      <div class="task-card">
        <div class="task-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/></svg></div>
        <div class="task-mid">
          <div class="tn">${r.title}</div>
          <div class="td">يكلف ${r.cost.toLocaleString('en-US')} نقطة</div>
        </div>
        <button class="task-btn" onclick="redeemReward('${id}', ${r.cost}, '${r.title}')">استبدال</button>
      </div>
    `).join('');
  }

  /* ===== Referral ===== */
  function copyReferralLink(){
    const text = document.getElementById('refLinkText').textContent.trim();
    navigator.clipboard.writeText(text).then(()=>{
      showToast('تم نسخ الرابط', 'success');
      apiCall('referral.logCopy', {}).catch(()=>{});
    }).catch(()=> showToast('تعذر النسخ — انسخه يدويًا', 'error'));
  }

  function shareReferralLink(){
    const text = document.getElementById('refLinkText').textContent.trim();
    const shareText = 'انضم لـ ريل كاش واربح معي 💰';
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
    };
    return icons[cat] || icons.earn;
  }
  function timeAgo(iso){
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'الآن';
    if (mins < 60) return `منذ ${mins} دقيقة`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `منذ ${hrs} ساعة`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'أمس';
    return `منذ ${days} أيام`;
  }
  function initials(name){
    return (name || '؟').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('');
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
    span.textContent = img.dataset.fallback || '؟';
    img.replaceWith(span);
  }

  function renderHome(){
    const s = appState;
    document.getElementById('greetingText').textContent = `مرحباً، ${s.user.name} 👋`;
    document.getElementById('homeBalance').textContent = s.user.balance_usd.toFixed(3);
    document.getElementById('userRankBadge').textContent = s.user.rank ?? '-';
    document.getElementById('todayEarnText').textContent = `+${s.stats.today_earn_usd.toFixed(3)}$ اليوم`;
    document.getElementById('statTodayEarn').textContent = s.stats.today_earn_usd.toFixed(3) + '$';
    document.getElementById('statReferrals').textContent = s.stats.referrals_count;
    document.getElementById('statTasks').textContent = `${s.stats.tasks_done_today}/${s.stats.tasks_total}`;
    document.getElementById('sbUserName').textContent = s.user.name;
    document.getElementById('sbUserMeta').textContent = s.user.is_elite ? 'عضو نخبة ⭐' : 'عضو';
  }

  function renderTasks(){
    const s = appState;
    const w = s.tasks.watch_ads_5;
    document.getElementById('watchAdsProgress').textContent = `أكمل الإعلانات اليومية للحصول على ${s.config.ad_batch_bonus_usd.toFixed(3)}$ (${w.progress}/${w.required})`;
    const watchBtn = document.getElementById('taskBtn-watch_ads_5');
    if (w.done){ watchBtn.textContent = 'مكتمل'; watchBtn.classList.add('done'); watchBtn.disabled = true; }
    else { watchBtn.textContent = 'شاهد'; watchBtn.classList.remove('done'); watchBtn.disabled = false; }

    const channelCard = document.getElementById('taskCard-join_channel');
    if (s.tasks.join_channel.enabled){
      channelCard.style.display = 'flex';
      document.getElementById('joinChannelProgress').textContent = `انضم واحصل على ${s.config.join_channel_reward_usd.toFixed(3)}$ فوراً`;
      const jBtn = document.getElementById('taskBtn-join_channel');
      const jStatus = document.getElementById('joinChannelStatus');
      if (s.tasks.join_channel.done){ jBtn.style.display='none'; jStatus.style.display='flex'; }
      else { jBtn.style.display='inline-flex'; jStatus.style.display='none'; }
    } else { channelCard.style.display = 'none'; }

    const inv = s.tasks.invite_3_friends;
    document.getElementById('inviteFriendsProgress').textContent = `تقدمك: ${inv.progress} من ${inv.required}`;
    const invBtn = document.getElementById('taskBtn-invite_3_friends');
    const invStatus = document.getElementById('inviteFriendsStatus');
    if (inv.done){ invBtn.style.display='none'; invStatus.style.display='flex'; } else { invBtn.style.display='inline-flex'; invStatus.style.display='none'; }

    const dl = s.tasks.daily_login;
    const dlBtn = document.getElementById('taskBtn-daily_login');
    const dlStatus = document.getElementById('dailyLoginStatus');
    document.getElementById('dailyLoginProgress').textContent = `سلسلة ${dl.streak}/${dl.required} يوم — احصل على ${s.config.daily_login_reward_usd.toFixed(3)}$ اليوم`;
    if (dl.done){ dlBtn.style.display='none'; dlStatus.style.display='flex'; } else { dlBtn.style.display='inline-flex'; dlStatus.style.display='none'; }
  }

  function renderReferral(){
    const s = appState;
    document.getElementById('refLinkText').textContent = `${REFERRAL_LINK_BASE}${s.user.referral_code}`;
    document.getElementById('refActiveCount').textContent = s.referral.active;
    document.getElementById('refPendingCount').textContent = s.referral.pending;
  }

  function renderContest(){
    const s = appState;
    document.getElementById('contestName').textContent = s.contest?.name || 'المسابقة الأسبوعية';
    if (s.contest?.end_at){
      const end = new Date(s.contest.end_at).getTime();
      const diff = Math.max(0, end - Date.now());
      document.getElementById('ctDays').textContent = String(Math.floor(diff / 86400000)).padStart(2,'0');
      document.getElementById('ctHours').textContent = String(Math.floor(diff % 86400000 / 3600000)).padStart(2,'0');
      document.getElementById('ctMinutes').textContent = String(Math.floor(diff % 3600000 / 60000)).padStart(2,'0');
    }
    const lb = s.leaderboard || [];
    const podiumOrder = [lb[1], lb[0], lb[2]]; // فضي - ذهبي - برونزي بصرياً
    const cls = ['silver', 'gold', 'bronze'];
    document.getElementById('contestPodium').innerHTML = podiumOrder.map((p, i) => {
      if (!p) return '';
      const crown = cls[i] === 'gold' ? '<svg class="crown" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18l-1.5-9-4.5 4-3-6-3 6-4.5-4z"/></svg>' : '';
      return `<div class="pod-item ${cls[i]}">
        ${crown}
        <div class="pod-avatar">${avatarHtml(p.name, p.photo_url)}</div>
        <div class="pod-name">${p.name}</div>
        <div class="pod-score anim-num">${p.score} نقطة</div>
        <div class="pod-bar">${p.rank}</div>
      </div>`;
    }).join('');
    document.getElementById('contestLeaderboard').innerHTML = lb.slice(3).map(p => `
      <div class="lb-row">
        <div class="lb-rank">${p.rank}</div>
        <div class="ref-avatar">${avatarHtml(p.name, p.photo_url)}</div>
        <div class="lb-info"><div class="ln">${p.name}${p.telegram_id === s.user.telegram_id ? ' (أنت)' : ''}</div><div class="ld">${p.score} نقطة</div></div>
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
      return `<div class="tx-row">
        <div class="tx-ic"><svg viewBox="0 0 24 24" fill="none" stroke="${up ? 'var(--mint)' : 'var(--danger)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${up ? '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>' : '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'}</svg></div>
        <div class="tx-info"><div class="tn">${tx.title}</div><div class="td">${timeAgo(tx.created_at)}</div></div>
        <div class="tx-v anim-num" style="color:${up ? 'var(--mint)' : 'var(--danger)'}">${up ? '+' : ''}${tx.amount_usd.toFixed(3)}$</div>
      </div>`;
    }).join('');
  }

  async function loadWalletTx(){
    try{
      const res = await apiCall('history.list', { limit: 6 });
      renderTransactionsInto(document.getElementById('walletTxList'), res.transactions, 'لا توجد عمليات بعد');
    } catch(err){ console.error(err); }
  }

  async function loadHistory(filter){
    try{
      const res = await apiCall('history.list', { filter: filter === 'all' ? undefined : filter, limit: 50 });
      const container = document.getElementById('historyTimeline');
      renderTransactionsInto(container, res.transactions, 'لا توجد عمليات بعد');
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
    await loadHome();
    loadWalletTx();
    loadHistory('all');
    revealPage(document.querySelector('.page.active'));
    animateNumbersIn(document.querySelector('.page.active'));
  }

  bootstrap();

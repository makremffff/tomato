/* ══════════════════════════════════════════════════════
   ui.js — تنقّل بين الصفحات، الشريط الجانبي، الرسوم المتحركة،
   التوست، المودالات — أدوات واجهة عامة يستخدمها app.js
══════════════════════════════════════════════════════ */

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');

  function openSidebar(){
    sidebar.classList.add('open');
    overlay.classList.add('show');
  }
  function closeSidebar(){
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  }

  function goTo(pageId){
    // 🛡️ لو المستخدم كان بصفحة "تصفح واربح" وطلع منها لأي صفحة تانية (رابط بالسايدبار،
    // زر quick-item، ...إلخ) لازم تنتهي جلسة السيرفينج ويتشال سكربت الإعلان فوراً
    if (pageId !== 'surf' && document.getElementById('page-surf').classList.contains('active') && typeof endSurfSession === 'function'){
      endSurfSession();
    }
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    const pageEl = document.getElementById('page-'+pageId);
    pageEl.classList.add('active');
    document.querySelectorAll('.sb-link').forEach(l=>l.classList.remove('active'));
    document.querySelector('.sb-link[data-page="'+pageId+'"]').classList.add('active');
    closeSidebar();
    window.scrollTo({top:0, behavior:'smooth'});
    revealPage(pageEl);
    animateNumbersIn(pageEl);
  }

  /* Two-tier cascading entrance: sections reveal first, then the cards/rows
     nested inside each section cascade in shortly after. Delays are assigned
     dynamically so it scales to any list length (works with the history
     filter too, since re-filtering doesn't change the DOM order). */
  function revealPage(pageEl){
    const sections = Array.from(pageEl.children);
    sections.forEach((el, i) => {
      el.classList.add('reveal-item');
      el.style.setProperty('--reveal-delay', (i * 0.07) + 's');
    });
    const nestedSelectors = '.task-card, .tx-row, .t-item, .ref-list-item, .lb-row, .stat-chip, .quick-item, .pod-item, .f-tab, .set-row';
    Array.from(pageEl.querySelectorAll(nestedSelectors)).forEach((el, i) => {
      el.classList.add('reveal-item');
      el.style.setProperty('--reveal-delay', (0.12 + i * 0.045) + 's');
    });
  }

  document.querySelectorAll('.sb-link').forEach(link=>{
    link.addEventListener('click', ()=> goTo(link.dataset.page));
  });

  /* ===== Toasts ===== */
  function showToast(message, type){
    type = type || 'info';
    const stack = document.getElementById('toastStack');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    const icon = type === 'success'
      ? '<svg class="t-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
      : type === 'error'
      ? '<svg class="t-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      : '<svg class="t-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    el.innerHTML = icon + '<span>' + message + '</span>';
    stack.appendChild(el);
    setTimeout(()=>{
      el.classList.add('out');
      setTimeout(()=> el.remove(), 250);
    }, 3200);
  }

  /* ===== Modals ===== */
  function openModal(id){ document.getElementById(id).classList.add('show'); }
  function closeModal(id){ document.getElementById(id).classList.remove('show'); }

  function setBtnLoading(btn, loading, originalHTML){
    if (loading){
      btn.dataset.originalHtml = btn.innerHTML;
      btn.innerHTML = '<span class="spin"></span>';
      btn.disabled = true;
    } else {
      btn.innerHTML = originalHTML !== undefined ? originalHTML : (btn.dataset.originalHtml || btn.innerHTML);
      btn.disabled = false;
    }
  }

  /* ===== Number count-up animation ===== */
  function parseNumericParts(text){
    const match = text.match(/^([+\-]?)\s*([\d,]+(?:\.\d+)?)/);
    if (!match) return null;
    const sign = match[1] || '';
    const numStr = match[2];
    const suffix = text.slice(match[0].length);
    const hasComma = numStr.includes(',');
    const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0;
    const value = parseFloat(numStr.replace(/,/g, ''));
    if (isNaN(value)) return null;
    return { sign, value, suffix, decimals, hasComma };
  }

  function animateCountUp(el, duration){
    duration = duration || 900;
    const parsed = parseNumericParts(el.textContent.trim());
    if (!parsed) return;
    const start = performance.now();
    function frame(now){
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = parsed.value * eased;
      let numStr = parsed.decimals ? current.toFixed(parsed.decimals) : Math.round(current).toString();
      if (parsed.hasComma){
        numStr = Number(numStr).toLocaleString('en-US', { minimumFractionDigits: parsed.decimals, maximumFractionDigits: parsed.decimals });
      }
      el.textContent = parsed.sign + numStr + parsed.suffix;
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function animateNumbersIn(pageEl){
    pageEl.querySelectorAll('.anim-num').forEach(el => animateCountUp(el, 900));
  }

// Assign large base64 image assets to their placeholders (kept out of index.html)
document.getElementById('balanceCardImg').src = ASSETS.balanceCard;
document.getElementById('walletFabImg').src = ASSETS.wallet;
document.getElementById('claimBtnImg').src = ASSETS.claim;
document.getElementById('withdrawCardImg').src = ASSETS.withdrawCard;

// ══════════════════════════════════════════════════════════════════════════
//  Backend connection — same api/index.js used across the RealCash/BigLeague
//  family of projects. '/api' works out of the box when this frontend is
//  deployed on the SAME Vercel project as the backend (api/index.js).
//  If the frontend is hosted elsewhere, replace this with the full URL, e.g.:
//  const API_URL = 'https://your-project.vercel.app/api';
// ══════════════════════════════════════════════════════════════════════════
const API_URL = '/api';

const tg = window.Telegram?.WebApp || null;
if (tg) { tg.ready(); tg.expand(); }

async function apiCall(type, data = {}) {
  const initData = tg?.initData || '';
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, data: { ...data, ts: Math.floor(Date.now() / 1000) }, initData }),
  });
  const json = await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
  if (!res.ok && !json.error) json.error = `http_${res.status}`;
  return json;
}

// Backend is only reachable once api/index.js is deployed with real env vars
// (DATABASE_URL / BOT_TOKEN / INTERNAL_SECRET) and this page runs inside
// Telegram (so tg.initData is populated). Outside of that — e.g. while
// previewing this file directly in a browser — BACKEND_ENABLED flips to
// false and the page quietly falls back to the local-only simulation below,
// so the UI keeps working during development.
let BACKEND_ENABLED = !!tg;

let balance = 0;
    const REWARD = 0.00005;
    const COOLDOWN = 12;
    const DAILY_LIMIT = 0.03;

    function getDailyClaimed() {
      const stored = JSON.parse(localStorage.getItem('dailyClaim') || 'null');
      const today = new Date().toDateString();
      if (!stored || stored.date !== today) return 0;
      return stored.amount;
    }

    function addDailyClaimed(amount) {
      const today = new Date().toDateString();
      const current = getDailyClaimed();
      localStorage.setItem('dailyClaim', JSON.stringify({ date: today, amount: current + amount }));
    }
    const claimBtn = document.getElementById('claimBtn');
    const cooldownHint = document.getElementById('cooldownHint');
    let cooldownTimer = null;

    // --- Gold numeral rendering (used everywhere a number appears) ---
    const DIGIT_URIS = ASSETS.digits;

    function renderRichText(el, text, digitHeightCss, dotSizeCss) {
      el.innerHTML = '';
      let buffer = '';
      const flush = () => {
        if (buffer) {
          el.appendChild(document.createTextNode(buffer));
          buffer = '';
        }
      };
      for (const ch of text) {
        if (ch >= '0' && ch <= '9') {
          flush();
          const img = document.createElement('img');
          img.className = 'rich-digit';
          img.src = DIGIT_URIS[ch];
          img.alt = ch;
          img.style.height = digitHeightCss;
          el.appendChild(img);
        } else if (ch === '.') {
          flush();
          const dot = document.createElement('span');
          dot.className = 'rich-dot';
          dot.style.width = dotSizeCss;
          dot.style.height = dotSizeCss;
          el.appendChild(dot);
        } else {
          buffer += ch;
        }
      }
      flush();
    }

    // --- Toast notifications ---
    const toastContainer = document.getElementById('toastContainer');
    const TOAST_ICONS = {
      success: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12.5L10 17.5L19 7" stroke="#0a1a12" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 8v5.5M12 16.2v.1" stroke="#2a0a0a" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="#2a0a0a" stroke-width="1.8"/></svg>',
      default: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l2.4 7.2H22l-6 4.4 2.3 7.2L12 16.4l-6.3 4.4L8 13.6l-6-4.4h7.6L12 2z" fill="#241705"/></svg>'
    };
    function showToast(message, type = '', duration = 2600) {
      const el = document.createElement('div');
      el.className = 'toast' + (type ? ' ' + type : '');
      el.innerHTML =
        '<span class="toast-icon">' + (TOAST_ICONS[type] || TOAST_ICONS.default) + '</span>' +
        '<span class="toast-text"></span>';
      renderRichText(el.querySelector('.toast-text'), message, '12px', '3.2px');
      toastContainer.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
      setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 450);
      }, duration);
    }

    const balanceSlotEl = document.getElementById('balanceSlot');

    function renderGoldBalance(el, valueStr) {
      el.innerHTML = '';
      for (const ch of valueStr) {
        if (ch === '.') {
          const dot = document.createElement('span');
          dot.className = 'gold-dot';
          el.appendChild(dot);
        } else if (DIGIT_URIS[ch]) {
          const img = document.createElement('img');
          img.className = 'digit-glyph';
          img.src = DIGIT_URIS[ch];
          img.alt = ch;
          el.appendChild(img);
        }
      }
    }

    const withdrawBalanceNumEl = document.getElementById('withdrawBalanceNum');

    function updateBalanceDisplay() {
      renderGoldBalance(balanceSlotEl, balance.toFixed(5));
      if (withdrawBalanceNumEl) renderRichText(withdrawBalanceNumEl, balance.toFixed(5), '5cqw', '1.1cqw');
    }

    const MIN_WITHDRAW = 0.001;
    const withdrawOverlay = document.getElementById('withdrawOverlay');

    function openWithdraw() {
      updateBalanceDisplay();
      withdrawOverlay.classList.add('show');
    }

    function closeWithdraw() {
      withdrawOverlay.classList.remove('show');
    }

    async function submitWithdraw() {
      const cwalletId = document.getElementById('cwalletId').value.trim();

      if (!cwalletId) {
        showToast('Please enter your Cwallet ID', 'error');
        return;
      }

      if (balance < MIN_WITHDRAW) {
        showToast(`Minimum withdrawal is ${MIN_WITHDRAW} USDT`, 'error');
        return;
      }

      if (BACKEND_ENABLED) {
        const result = await apiCall('wallet.withdraw', { cwalletId, amount: balance }).catch(() => null);
        if (!result) {
          showToast('Network error, please try again', 'error');
          return;
        }
        if (!result.ok) {
          if (result.error === 'min_withdraw') showToast(`Minimum withdrawal is ${result.min} USDT`, 'error');
          else if (result.error === 'insufficient_balance') showToast('Insufficient balance', 'error');
          else showToast('Withdrawal failed, please try again', 'error');
          return;
        }
        balance = result.balance_usd;
      }

      updateBalanceDisplay();
      showToast('Withdrawal request submitted successfully', 'success');
      closeWithdraw();
    }

    async function handleClaim() {
      if (claimBtn.disabled) return;

      if (BACKEND_ENABLED) {
        const result = await apiCall('claim.tap').catch(() => null);
        if (!result) {
          showToast('Network error, please try again', 'error');
          return;
        }
        if (!result.ok) {
          // Daily limit reached: stay silent per product decision — just lock the button.
          if (result.error === 'daily_limit') { claimBtn.disabled = true; return; }
          if (result.error === 'cooldown') { startCooldown(result.remaining || COOLDOWN); return; }
          showToast('Something went wrong, please try again', 'error');
          return;
        }
        balance = result.balance_usd;
        updateBalanceDisplay();
        launchConfetti();
        showToast(`+${REWARD.toFixed(5)} USDT claimed`, 'success');
        startCooldown(result.cooldown_sec || COOLDOWN);
        return;
      }

      // ── Local-only fallback (no backend / running outside Telegram) ──
      if (getDailyClaimed() + REWARD > DAILY_LIMIT) {
        claimBtn.disabled = true;
        return;
      }
      balance += REWARD;
      addDailyClaimed(REWARD);
      updateBalanceDisplay();
      launchConfetti();
      showToast(`+${REWARD.toFixed(5)} USDT claimed`, 'success');
      startCooldown();
    }

    function startCooldown(seconds) {
      let remaining = seconds || COOLDOWN;
      claimBtn.disabled = true;
      renderRichText(cooldownHint, `Wait ${remaining}s`, '16px', '4px');

      clearInterval(cooldownTimer);
      cooldownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(cooldownTimer);
          claimBtn.disabled = false;
          cooldownHint.innerHTML = '';
        } else {
          renderRichText(cooldownHint, `Wait ${remaining}s`, '16px', '4px');
        }
      }, 1000);
    }

    // --- Confetti animation ---
    const canvas = document.getElementById('confettiCanvas');
    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const colors = ['#FFD966', '#FFE066', '#D4A017', '#ffffff', '#FFB300'];
    let particles = [];
    let animId = null;

    function launchConfetti() {
      const rect = claimBtn.getBoundingClientRect();
      const originX = rect.left + rect.width / 2;
      const originY = rect.top + rect.height / 2;

      for (let i = 0; i < 60; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 6;
        particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          size: 4 + Math.random() * 4,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotation: Math.random() * 360,
          rotSpeed: (Math.random() - 0.5) * 12,
          life: 60 + Math.random() * 30
        });
      }

      if (!animId) animate();
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15;
        p.rotation += p.rotSpeed;
        p.life -= 1;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });

      particles = particles.filter(p => p.life > 0);

      if (particles.length > 0) {
        animId = requestAnimationFrame(animate);
      } else {
        animId = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    async function initPage() {
      if (BACKEND_ENABLED) {
        const result = await apiCall('init').catch(() => null);
        if (result && result.ok) {
          balance = result.balance_usd;
          updateBalanceDisplay();
          if (result.daily_claimed_usd + result.claim_reward_usd > result.daily_limit_usd) {
            claimBtn.disabled = true;
          } else if (result.cooldown_remaining_sec > 0) {
            startCooldown(result.cooldown_remaining_sec);
          }
          return;
        }
        // init call failed (e.g. backend not deployed yet) — fall back silently
        BACKEND_ENABLED = false;
      }

      // ── Local-only fallback ──
      updateBalanceDisplay();
      if (getDailyClaimed() + REWARD > DAILY_LIMIT) {
        claimBtn.disabled = true;
      }
    }
    initPage();

    // --- Bottom card: 6 ads per cycle, rotating through the full ad pool ---
    const bottomCard = document.getElementById('bottomCard');
    const adStage = document.getElementById('adStage');
    const allAdSlots = Array.from(adStage.querySelectorAll('.ad-slot'));
    const BATCH_SIZE = 6;
    const CARD_SHOW_MS = 5000;
    const CARD_REST_MS = 7000;

    const batches = [];
    for (let i = 0; i < allAdSlots.length; i += BATCH_SIZE) {
      batches.push(allAdSlots.slice(i, i + BATCH_SIZE));
    }
    let batchIndex = -1;

    function fitAdSlot(slot) {
      const w = parseInt(slot.dataset.w, 10);
      const h = parseInt(slot.dataset.h, 10);
      const native = slot.querySelector('.ad-native');
      if (!w || !h || !native) return; // native/responsive units fill their own cell via CSS

      const cellW = slot.clientWidth || 100;
      const cellH = slot.clientHeight || 55;
      const scaleX = cellW / w;
      const scaleY = cellH / h;
      native.style.width = w + 'px';
      native.style.height = h + 'px';
      native.style.transform = `scale(${scaleX}, ${scaleY})`;
    }

    function showBatch(index) {
      allAdSlots.forEach(slot => slot.classList.remove('active'));
      const batch = batches[index];
      batch.forEach(slot => {
        slot.classList.add('active');
        fitAdSlot(slot);
      });
    }

    function cycleBottomCard() {
      batchIndex = (batchIndex + 1) % batches.length;
      showBatch(batchIndex);
      bottomCard.classList.add('show');
      setTimeout(() => {
        bottomCard.classList.remove('show');
        setTimeout(cycleBottomCard, CARD_REST_MS);
      }, CARD_SHOW_MS);
    }

    window.addEventListener('resize', () => { if (batchIndex >= 0) showBatch(batchIndex); });
    cycleBottomCard();

// --- Capped popunder ad loader ---
(function loadCappedPopunders() {
      var CAP_KEY = 'popunderLastShown';
      var CAP_MS = 24 * 60 * 60 * 1000; // once per day
      var last = Number(localStorage.getItem(CAP_KEY) || 0);
      if (Date.now() - last < CAP_MS) return; // already shown recently, skip

      var units = [
        'https://interventioncopiedloitering.com/9e/8a/e0/9e8ae0f7e4f470bb951d31947e85bd19.js',
        'https://interventioncopiedloitering.com/d0/f6/b3/d0f6b318f29b5787025697029ae72f23.js'
      ];
      units.forEach(function (src) {
        var s = document.createElement('script');
        s.src = src;
        s.async = true;
        document.body.appendChild(s);
      });
      localStorage.setItem(CAP_KEY, String(Date.now()));
    })();

/* Slot Machine — Flow + Configurable Odds + Modal Claim
   ─────────────────────────────────────────────────────
   EDIT TAGS:
   - BACKEND_CONFIG:*           → odds, symbols, paylines, payouts, session limits, endpoints
   - BACKEND_HOOK:*             → wire your backend calls (fetch stubs included)

   Requires:
   - index.html contains #reels with three .reel columns, #spinBtn, #resetBtn, #betInput,
     #message, #payout, #credits
   - Modal scaffold present:
     <div id="modal" ...><div class="backdrop"></div><div class="modal__panel"><button id="modalClose">✕</button><div id="modalContent"></div></div></div>
*/

(() => {
  // =========================
  // ====== CONFIG TAG =======
  // =========================
  const CONFIG = {
    /* BACKEND_CONFIG:SESSION_LIMITS */
    oneSpinPerTurn: true,                 // lock spin after one play until claim form submitted
    persistAfterClaim: true,              // after successful claim, disable spins (localStorage flag)
    startingCredits: 100,
    minBet: 1,
    maxBet: 1000,

    /* BACKEND_CONFIG:SYMBOLS */
    symbols: [
      { name: "SEVEN",  display: "7",   weight: 1,  payout: 100 },
      { name: "BAR",    display: "BAR", weight: 2,  payout: 40 },
      { name: "BELL",   display: "🔔",  weight: 3,  payout: 25 },
      { name: "CHERRY", display: "🍒",  weight: 5,  payout: 15 },
      { name: "LEMON",  display: "🍋",  weight: 6,  payout: 10 },
      { name: "GRAPE",  display: "🍇",  weight: 6,  payout: 10 },
      { name: "STAR",   display: "⭐",  weight: 4,  payout: 20 },
    ],

    /* BACKEND_CONFIG:REELS_WEIGHTS (per-reel overrides; falls back to symbol.weight) */
    reelWeights: [
      { SEVEN: 1, BAR: 2, BELL: 3, CHERRY: 6, LEMON: 7, GRAPE: 7, STAR: 5 },
      { SEVEN: 1, BAR: 3, BELL: 3, CHERRY: 5, LEMON: 6, GRAPE: 6, STAR: 5 },
      { SEVEN: 1, BAR: 2, BELL: 4, CHERRY: 5, LEMON: 6, GRAPE: 6, STAR: 5 },
    ],

    /* BACKEND_CONFIG:LAYOUT */
    reelsCount: 3,
    rowsVisible: 3,

    /* BACKEND_CONFIG:PAYLINES */
    paylines: [
      [0,0,0], // top
      [1,1,1], // middle
      [2,2,2], // bottom
      [0,1,2], // diag down
      [2,1,0], // diag up
    ],

    /* BACKEND_CONFIG:PAYTABLE (extendable rules) */
    payRules: [
      {
        id: "THREE_OF_A_KIND",
        test: (lineSymbols) => lineSymbols[0] === lineSymbols[1] && lineSymbols[1] === lineSymbols[2],
        payout: (symbolInfo, bet) => symbolInfo.payout * bet,
      },
      // Example extra rule:
      // { id:"ANY_THREE_STARS", test:(s)=>s.every(n=>n==="STAR"), payout:(_,bet)=>50*bet },
    ],

    /* BACKEND_CONFIG:ANIMATION */
    spinTimeMs: [1400, 1700, 2000],      // per reel spin duration
    reelFps: 60,

    /* BACKEND_CONFIG:BACKEND_ENDPOINTS */
    endpoints: {
      submitClaim: "/api/claim",         // POST {email,phone,consent,result,winAmount}
      auditSpin: "/api/audit",           // POST {grid,bet,total}
    },
  };

  // ======= DOM =======
  const els = {
    reels: document.getElementById("reels"),
    spinBtn: document.getElementById("spinBtn"),
    resetBtn: document.getElementById("resetBtn"),
    betInput: document.getElementById("betInput"),
    msg: document.getElementById("message"),
    payout: document.getElementById("payout"),
    credits: document.getElementById("credits"),
    modal: document.getElementById("modal"),
    modalContent: document.getElementById("modalContent"),
    modalClose: document.getElementById("modalClose"),
  };

  // ======= State =======
  const state = {
    spinning: false,
    resultGrid: null,    // 3x3 names
    lastWin: 0,
    credits: CONFIG.startingCredits,
    hasSpun: false,
    claimed: false,
  };

  // Persisted lock after claim
  const LS_KEY = "slot.claimed";
  if (CONFIG.persistAfterClaim && localStorage.getItem(LS_KEY) === "1") {
    state.claimed = true;
    state.hasSpun = true;
  }

  // ======= Weighted Odds =======
  const byName = (n) => CONFIG.symbols.find((s) => s.name === n);
  function buildWeightedTable(reelIndex){
    const rw = CONFIG.reelWeights[reelIndex] || {};
    const table = [];
    for (const s of CONFIG.symbols){
      const w = rw[s.name] ?? s.weight ?? 1;
      for (let i=0;i<w;i++) table.push(s.name);
    }
    return table;
  }
  const weightedTables = Array.from({length: CONFIG.reelsCount}, (_,i)=>buildWeightedTable(i));

  function rngSymbol(reelIndex){
    const t = weightedTables[reelIndex];
    return t[(Math.random()*t.length)|0];
  }

  // ======= UI Helpers =======
  function setMessage(text, tone="muted"){
    els.msg.textContent = text;
    els.msg.style.color = tone === "win" ? "#34d399" : tone === "lose" ? "#fb7185" : "#6a7a90";
  }
  function setPayout(text){ els.payout.textContent = text || ""; }
  function updateCredits(delta){ state.credits = Math.max(0, state.credits + delta); els.credits.textContent = state.credits; }
  function validateBet(){
    let v = parseInt(els.betInput.value,10);
    if (isNaN(v)) v = CONFIG.minBet;
    v = Math.max(CONFIG.minBet, Math.min(CONFIG.maxBet, v));
    els.betInput.value = v;
    return v;
  }
  function canSpin(){
    if (state.spinning) return false;
    if (CONFIG.persistAfterClaim && state.claimed) return false;
    if (CONFIG.oneSpinPerTurn && state.hasSpun) return false;
    return state.credits >= validateBet();
  }

  // ======= Reels Rendering =======
  function makeReelColumn(){
    const frag = document.createDocumentFragment();
    const pool = CONFIG.symbols.map(s=>s.name);
    for (let i=0;i<9;i++){
      const name = pool[i % pool.length];
      const el = document.createElement("div");
      el.className = "symbol";
      el.dataset.name = name;
      el.textContent = byName(name).display;
      frag.appendChild(el);
    }
    return frag;
  }
  function populateReels(){
    els.reels.querySelectorAll(".reel").forEach(reel=>{
      reel.innerHTML = "";
      reel.style.transform = "";
      reel.appendChild(makeReelColumn());
    });
  }

  // ======= Outcome & Payout =======
  function computeSpinOutcome(){
    // Build 3x3 grid: for each reel, assemble a virtual strip (weighted) and pick a stop
    const grid = Array.from({length: CONFIG.rowsVisible}, ()=>Array(CONFIG.reelsCount).fill(null));
    for (let rI = 0; rI < CONFIG.reelsCount; rI++){
      const t = weightedTables[rI];
      const stripLen = Math.max(32, t.length * 2);
      const strip = Array.from({length: stripLen}, ()=> t[(Math.random()*t.length)|0]);
      const stop = (Math.random()*stripLen)|0;
      const center = strip[stop];
      const above  = strip[(stop - 1 + stripLen) % stripLen];
      const below  = strip[(stop + 1) % stripLen];
      grid[0][rI] = above;
      grid[1][rI] = center;
      grid[2][rI] = below;
    }
    return grid;
  }

  function evaluateWin(grid, bet){
    let total = 0;
    const wins = [];
    for (const line of CONFIG.paylines){
      const names = line.map((rowIdx, reelIdx)=> grid[rowIdx][reelIdx]);
      for (const rule of CONFIG.payRules){
        if (rule.test(names)){
          const symInfo = byName(names[0]);
          const amt = rule.payout(symInfo, bet);
          total += amt;
          wins.push({ line, rule: rule.id, symbol: names[0], amount: amt });
        }
      }
    }
    return { total, wins };
  }

  // ======= Modal (Popover) =======
  function openModal(html){
    els.modalContent.innerHTML = html;
    els.modal.classList.remove("hidden");
    els.modal.setAttribute("aria-hidden","false");
    const firstInput = els.modalContent.querySelector("input,button,select,textarea");
    if (firstInput) firstInput.focus({ preventScroll:true });
    trapFocus(true);
  }
  function closeModal(){
    els.modal.classList.add("hidden");
    els.modal.setAttribute("aria-hidden","true");
    els.modalContent.innerHTML = "";
    trapFocus(false);
  }
  function trapFocus(enable){
    function handler(e){
      if (!enable) return;
      if (e.key !== "Tab") return;
      const focusables = els.modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const list = Array.from(focusables).filter(el => !el.disabled && el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0], last = list[list.length-1];
      if (e.shiftKey && document.activeElement === first){ last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last){ first.focus(); e.preventDefault(); }
    }
    if (enable){
      document.addEventListener("keydown", handler);
      els.modalClose.disabled = true;
      els.modalClose.classList.remove("enabled");
      els.modalClose.onclick = null; // cannot close until success
    } else {
      document.removeEventListener("keydown", handler);
      els.modalClose.disabled = false;
      els.modalClose.classList.add("enabled");
    }
  }

  function claimFormHTML(winAmount){
    return `
      <h2 style="margin:0 0 6px;">Claim Your Reward</h2>
      <p class="message">Complete the form to proceed${winAmount>0?` and receive <strong>${winAmount}</strong>`:""}.</p>
      <form id="claimForm" novalidate>
        <div class="field">
          <label for="email">Email ID</label>
          <input type="email" id="email" required placeholder="you@example.com" inputmode="email" />
        </div>
        <div class="field">
          <label for="phone">Phone Number</label>
          <input type="tel" id="phone" required placeholder="+91 90000 00000" inputmode="tel" />
        </div>
        <div class="field checkbox">
          <input type="checkbox" id="consent" />
          <label for="consent">I agree to receive communications</label>
        </div>
        <button type="submit" id="claimBtn" class="btn success" disabled>Submit &amp; Claim</button>
      </form>
      <small class="disclaimer">Submitting details is mandatory to claim rewards.</small>
    `;
  }

  function thankYouHTML(){
    return `
      <h2 style="margin:0 0 6px;">Thank you for submitting 🎉</h2>
      <p class="message">You will receive your details over email.</p>
      <button id="okBtn" class="btn primary">OK</button>
    `;
  }

  function validateEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }
  function validatePhone(v){ return /^\+?\d[\d\s-]{7,15}$/.test(v.trim()); }

  function wireClaimForm(){
    const form = document.getElementById("claimForm");
    const email = document.getElementById("email");
    const phone = document.getElementById("phone");
    const consent = document.getElementById("consent");
    const btn = document.getElementById("claimBtn");

    const validate = ()=>{
      const ok = validateEmail(email.value) && validatePhone(phone.value) && consent.checked;
      btn.disabled = !ok;
      return ok;
    };
    email.addEventListener("input", validate);
    phone.addEventListener("input", validate);
    consent.addEventListener("change", validate);
    setTimeout(validate, 50); // autofill check

    form.addEventListener("submit", async (e)=>{
      e.preventDefault();
      if (!validate()) return;

      // BACKEND_HOOK:SUBMIT_PLAYER_DETAILS
      const payload = {
        email: email.value.trim(),
        phone: phone.value.trim(),
        consent: !!consent.checked,
        result: state.resultGrid,
        winAmount: state.lastWin,
        credits: state.credits,
      };
      try {
        // await fetch(CONFIG.endpoints.submitClaim, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
        await new Promise(r=>setTimeout(r, 250));
      } catch(_) { /* ignore demo errors */ }

      // Persist & lock
      state.claimed = true;
      if (CONFIG.persistAfterClaim) localStorage.setItem(LS_KEY, "1");

      // Show thank-you view; allow closing
      els.modalContent.innerHTML = thankYouHTML();
      const okBtn = document.getElementById("okBtn");
      okBtn.addEventListener("click", ()=>{
        closeModal();
        setMessage("Reward claimed. Check your email.", "win");
      });
      els.modalClose.disabled = false;
      els.modalClose.classList.add("enabled");
      els.modalClose.onclick = closeModal;
    });
  }

  // ======= Spin Engine =======
  async function spin(){
    if (!canSpin()){
      setMessage(CONFIG.persistAfterClaim && state.claimed ? "Already claimed. Spins disabled." : "Not allowed to spin now.");
      return;
    }

    const bet = validateBet();
    updateCredits(-bet);
    setPayout("");
    setMessage("Spinning...");
    state.spinning = true;
    state.hasSpun = true;
    els.spinBtn.disabled = true;
    els.resetBtn.disabled = true;
    els.betInput.disabled = true;

    // Precompute outcome
    const outcome = computeSpinOutcome();
    state.resultGrid = outcome;

    // Animate reels
    const reels = [...els.reels.querySelectorAll(".reel")];
    const symHeight = 72; // match CSS .symbol height
    const durations = CONFIG.spinTimeMs;
    const start = performance.now();

    const anims = reels.map((reel, i) => new Promise((res)=>{
      const dur = durations[i] || durations[durations.length-1];
      const loop = (t)=>{
        const e = Math.min(1, (t - start) / dur);
        const ease = 1 - Math.pow(1 - e, 3);
        const offset = (1 - ease) * 20 * symHeight + (e * 4 * symHeight);
        reel.style.transform = `translateY(${-(offset % (symHeight*3))}px)`;
        if (e < 1) requestAnimationFrame(loop);
        else {
          // Snap to outcome symbols
          reel.innerHTML = "";
          const names = [ outcome[0][i], outcome[1][i], outcome[2][i] ];
          const order = [names[0], ...names, names[2], names[1], names[2], names[0], names[0]];
          for (const n of order){
            const d = document.createElement("div");
            d.className = "symbol"; d.dataset.name = n; d.textContent = byName(n).display;
            reel.appendChild(d);
          }
          reel.style.transform = `translateY(${-symHeight}px)`; // show middle row in view
          res();
        }
      };
      requestAnimationFrame(loop);
    }));

    await Promise.all(anims);

    // Evaluate
    const { total, wins } = evaluateWin(outcome, bet);
    state.lastWin = total;
    if (total > 0){
      setMessage(`You win ${total}!`, "win");
      setPayout(wins.map(w=>`Line [${w.line.join(",")}] ${w.rule} ${w.symbol} → +${w.amount}`).join(" | "));
      updateCredits(total);
    } else {
      setMessage("No win this time.", "lose");
      setPayout("");
    }

    // BACKEND_HOOK:AUDIT_SPIN
    try {
      // await fetch(CONFIG.endpoints.auditSpin, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ grid: outcome, bet, total }) });
    } catch(_){}

    state.spinning = false;

    // Flow: open claim modal immediately; spin remains disabled until success/reset
    openModal(claimFormHTML(total));
    wireClaimForm();
    els.spinBtn.disabled = true;
    els.resetBtn.disabled = false;
  }

  // ======= Controls =======
  els.spinBtn.addEventListener("click", spin);

  els.resetBtn.addEventListener("click", ()=>{
    state.spinning = false;
    state.resultGrid = null;
    state.lastWin = 0;
    state.hasSpun = false;
    if (CONFIG.persistAfterClaim){ localStorage.removeItem(LS_KEY); state.claimed = false; }
    setMessage("Press SPIN");
    setPayout("");
    els.betInput.disabled = false;
    els.spinBtn.disabled = false;
    populateReels();
    closeModal();
  });

  // ======= Bootstrap =======
  function init(){
    els.betInput.min = CONFIG.minBet;
    els.betInput.max = CONFIG.maxBet;
    populateReels();
    updateCredits(0);
    if (CONFIG.persistAfterClaim && state.claimed){
      setMessage("Reward already claimed.", "win");
      els.spinBtn.disabled = true;
      els.betInput.disabled = true;
      // Optionally show thank-you immediately:
      // openModal(thankYouHTML()); els.modalClose.disabled=false; els.modalClose.onclick=closeModal;
    }
  }
  init();

  // Mobile: prevent iOS zoom on double-tap
  let lastTouch = 0;
  document.addEventListener("touchend", (e)=>{
    const now = Date.now();
    if (now - lastTouch <= 350) e.preventDefault();
    lastTouch = now;
  }, { passive:false });

})();

/* Slot Machine — Configurable Odds, One Chance Per Turn
   ─────────────────────────────────────────────────────
   BACKEND_CONFIG: You can safely edit the CONFIG object below to control odds, symbols, paylines, paytable,
   spin constraints, and backend endpoints. Tagged hooks for integration included.
*/

(() => {
  // =========================
  // ====== CONFIG TAG =======
  // =========================
  const CONFIG = {
    /* BACKEND_CONFIG:SESSION_LIMITS */
    oneSpinPerTurn: true,                 // Enforce single spin until claim details are submitted
    persistAfterClaim: true,              // Prevent any more spins after successful claim (localStorage flag)
    startingCredits: 10,
    minBet: 1,
    maxBet: 10,

    /* BACKEND_CONFIG:SYMBOLS
       Define the symbol set and per-reel weights for odds control.
       weights: higher => more likely. Omit to use 'weight' fallback across all reels.
    */
    symbols: [
      { name: "SEVEN",  display: "7",   weight: 1,  payout: 10 },
      { name: "BAR",    display: "BAR", weight: 2,  payout: 4 },
      { name: "BELL",   display: "🔔",  weight: 3,  payout: 2 },
      { name: "CHERRY", display: "🍒",  weight: 5,  payout: 1 },
      { name: "LEMON",  display: "🍋",  weight: 6,  payout: 1 },
      { name: "GRAPE",  display: "🍇",  weight: 6,  payout: 1 },
      { name: "STAR",   display: "⭐",  weight: 4,  payout: 2 },
    ],

    /* BACKEND_CONFIG:REELS_WEIGHTS
       Optional per-reel overrides (index 0..2). If omitted for a symbol, uses symbol.weight
       Example: { SEVEN: 1, BAR: 3, ... }
    */
    reelWeights: [
      { SEVEN: 1, BAR: 2, BELL: 3, CHERRY: 6, LEMON: 7, GRAPE: 7, STAR: 5 },
      { SEVEN: 1, BAR: 3, BELL: 3, CHERRY: 5, LEMON: 6, GRAPE: 6, STAR: 5 },
      { SEVEN: 1, BAR: 2, BELL: 4, CHERRY: 5, LEMON: 6, GRAPE: 6, STAR: 5 },
    ],

    /* BACKEND_CONFIG:LAYOUT */
    reelsCount: 3,
    rowsVisible: 3,

    /* BACKEND_CONFIG:PAYLINES
       Each payline is an array of row indices (0..rowsVisible-1) for each reel.
       Classic 5 lines: 3 horizontals + 2 diagonals.
    */
    paylines: [
      [0,0,0], // top
      [1,1,1], // middle
      [2,2,2], // bottom
      [0,1,2], // diag down
      [2,1,0], // diag up
    ],

    /* BACKEND_CONFIG:PAYTABLE
       For now: 3 of a kind on any payline wins (multiplied by symbol.payout * bet).
       You can extend with mixed combinations here.
       Example extensible rule format is provided.
    */
    payRules: [
      {
        id: "THREE_OF_A_KIND",
        test: (lineSymbols) => lineSymbols[0] === lineSymbols[1] && lineSymbols[1] === lineSymbols[2],
        payout: (symbolInfo, bet) => symbolInfo.payout * bet,
      },
      // Add more rules (e.g., ANY_CHERRIES_2, MIXED_BAR) as needed.
    ],

    /* BACKEND_CONFIG:ANIMATION */
    spinTimeMs: [1400, 1700, 2000],      // per reel spin duration
    reelFps: 60,
    idleScrollSpeed: 0,                  // 0 = no idle scroll

    /* BACKEND_CONFIG:BACKEND_ENDPOINTS (stubs for integration) */
    endpoints: {
      submitClaim: "/api/claim",         // POST details {email,phone,consent,result,winAmount}
      auditSpin: "/api/audit",           // POST spin result for logs
    },
  };

  // ======= State =======
  const els = {
    reels: document.getElementById("reels"),
    spinBtn: document.getElementById("spinBtn"),
    resetBtn: document.getElementById("resetBtn"),
    betInput: document.getElementById("betInput"),
    msg: document.getElementById("message"),
    payout: document.getElementById("payout"),
    credits: document.getElementById("credits"),
    claimSection: document.getElementById("claimSection"),
    claimForm: document.getElementById("claimForm"),
    email: document.getElementById("email"),
    phone: document.getElementById("phone"),
    consent: document.getElementById("consent"),
    claimBtn: document.getElementById("claimBtn"),
  };

  const state = {
    spinning: false,
    resultGrid: null,    // 3x3 names
    lastWin: 0,
    credits: CONFIG.startingCredits,
    hasSpun: false,
    claimed: false,
  };

  // Persisted flag after claim (enforce no more spins)
  const LS_KEY = "slot.claimed";
  if (CONFIG.persistAfterClaim && localStorage.getItem(LS_KEY) === "1") {
    state.claimed = true;
    state.hasSpun = true;
  }

  // ======= Utilities =======
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

  function validateBet(){
    let v = parseInt(els.betInput.value,10);
    if (isNaN(v)) v = CONFIG.minBet;
    v = Math.max(CONFIG.minBet, Math.min(CONFIG.maxBet, v));
    els.betInput.value = v;
    return v;
  }

  function setMessage(text, tone="muted"){
    els.msg.textContent = text;
    els.msg.style.color = tone === "win" ? "#34d399" : tone === "lose" ? "#fb7185" : "#6a7a90";
  }

  function setPayout(text){
    els.payout.textContent = text || "";
  }

  function updateCredits(delta){
    state.credits = Math.max(0, state.credits + delta);
    els.credits.textContent = state.credits;
  }

  function canSpin(){
    if (state.spinning) return false;
    if (CONFIG.persistAfterClaim && state.claimed) return false;
    if (CONFIG.oneSpinPerTurn && state.hasSpun) return false;
    const bet = validateBet();
    return state.credits >= bet;
  }

  // ======= Rendering =======
  function makeReelColumn(){
    const col = document.createDocumentFragment();
    // We render more than visible for smooth loop illusion
    const pool = [...CONFIG.symbols.map(s=>s.name)];
    // 9 items (3 visible + 6 buffer)
    for (let i=0;i<9;i++){
      const name = pool[i % pool.length];
      const sym = document.createElement("div");
      sym.className = "symbol";
      sym.dataset.name = name;
      sym.textContent = byName(name).display;
      col.appendChild(sym);
    }
    return col;
  }

  function populateReels(){
    els.reels.querySelectorAll(".reel").forEach(reel=>{
      reel.innerHTML = "";
      reel.appendChild(makeReelColumn());
    });
  }

  // ======= Spin Engine =======
  function computeSpinOutcome(){
    // Build 3x3 by random per reel; for realism we select center symbol then neighbors
    const grid = Array.from({length: CONFIG.rowsVisible}, ()=>Array(CONFIG.reelsCount).fill(null));

    for (let rI = 0; rI < CONFIG.reelsCount; rI++){
      // pick center
      const reelStrip = [];
      // Build a virtual reel strip from weighted table preserving symbol runs
      const t = weightedTables[rI];
      const stripLen = Math.max(32, t.length * 2);
      for (let i=0;i<stripLen;i++) reelStrip.push(t[(Math.random()*t.length)|0]);

      const stop = (Math.random()*stripLen)|0;
      const center = reelStrip[stop];
      const above = reelStrip[(stop - 1 + stripLen) % stripLen];
      const below = reelStrip[(stop + 1) % stripLen];

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

  // Smooth reel animation by translating Y over time, then snapping to outcome
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

    // Animate each reel
    const reels = [...els.reels.querySelectorAll(".reel")];
    const symHeight = 72; // keep in sync with CSS
    const durations = CONFIG.spinTimeMs;

    // Start time
    const start = performance.now();
    const anims = reels.map((reel, i) => new Promise((res)=>{
      const dur = durations[i] || durations[durations.length-1];
      const fps = CONFIG.reelFps;
      let raf;
      const loop = (t) => {
        const elapsed = t - start;
        const e = Math.min(1, elapsed / dur);
        // ease-out cubic
        const ease = 1 - Math.pow(1 - e, 3);
        const offset = (1 - ease) * 20 * symHeight + (e * 4 * symHeight); // fast then slow
        reel.style.transform = `translateY(${-(offset % (symHeight*3))}px)`;
        if (e < 1) raf = requestAnimationFrame(loop);
        else {
          // Snap to show the outcome for that reel
          // Replace reel DOM with outcome symbols (above,center,below + buffers)
          reel.innerHTML = "";
          const frag = document.createDocumentFragment();
          const names = [ outcome[0][i], outcome[1][i], outcome[2][i] ];
          const bufferTop = names[0];
          const bufferBottom = names[2];
          const order = [bufferTop, ...names, bufferBottom, names[1], names[2], names[0], bufferTop]; // extra buffers
          for (const n of order){
            const d = document.createElement("div");
            d.className = "symbol";
            d.dataset.name = n;
            d.textContent = byName(n).display;
            frag.appendChild(d);
          }
          reel.appendChild(frag);
          reel.style.transform = `translateY(${-symHeight}px)`; // ensure middle row is visible
          res();
        }
      };
      raf = requestAnimationFrame(loop);
    }));

    await Promise.all(anims);

    // Evaluate outcome
    const { total, wins } = evaluateWin(outcome, bet);
    state.lastWin = total;
    if (total > 0){
      setMessage(`You win ${total}!`, "win");
      setPayout(wins.map(w=>`Line ${fmtLine(w.line)} ${w.rule} ${w.symbol} → +${w.amount}`).join(" | "));
      updateCredits(total);
    } else {
      setMessage("No win. Better luck next time!", "lose");
      setPayout("");
    }

    // BACKEND_HOOK:AUDIT_SPIN (stub)
    try {
      // await fetch(CONFIG.endpoints.auditSpin, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ grid: outcome, bet, total }) });
    } catch(e){ /* swallow for demo */ }

    state.spinning = false;

    // Enforce one chance per turn: show claim form after first spin
    if (CONFIG.oneSpinPerTurn){
      showClaimForm(true);
      els.spinBtn.disabled = true;
    } else {
      els.spinBtn.disabled = false;
    }
    els.resetBtn.disabled = false;
    els.betInput.disabled = true; // lock bet after playing; reset to change
  }

  function fmtLine(line){ return `[${line.join(",")}]`; }

  // ======= Claim Form =======
  function showClaimForm(show){
    els.claimSection.classList.toggle("hidden", !show);
    validateClaim();
  }

  function validateEmail(v){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }
  function validatePhone(v){
    // Simple international-ish; adjust in backend
    return /^\+?\d[\d\s-]{7,15}$/.test(v.trim());
  }

  function validateClaim(){
    const ok = validateEmail(els.email.value) &&
               validatePhone(els.phone.value) &&
               els.consent.checked;
    els.claimBtn.disabled = !ok;
    return ok;
  }

  els.email.addEventListener("input", validateClaim);
  els.phone.addEventListener("input", validateClaim);
  els.consent.addEventListener("change", validateClaim);

  els.claimForm.addEventListener("submit", async (e)=>{
    e.preventDefault();
    if (!validateClaim()) return;

    // BACKEND_HOOK:SUBMIT_PLAYER_DETAILS (stub)
    const payload = {
      email: els.email.value.trim(),
      phone: els.phone.value.trim(),
      consent: !!els.consent.checked,
      result: state.resultGrid,
      winAmount: state.lastWin,
      credits: state.credits,
    };
    try {
      // await fetch(CONFIG.endpoints.submitClaim, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      // Simulate ok:
      await new Promise(r=>setTimeout(r, 300));
      setMessage("Details submitted. Reward claimed.", "win");
      showClaimForm(false);
      state.claimed = true;
      if (CONFIG.persistAfterClaim) localStorage.setItem(LS_KEY, "1");
    } catch (err){
      setMessage("Submission failed. Try again.", "lose");
      return;
    }

    // After claim, keep spin disabled (enforced), allow reset to clear session
    els.spinBtn.disabled = true;
  });

  // ======= Controls =======
  els.spinBtn.addEventListener("click", spin);

  els.resetBtn.addEventListener("click", ()=>{
    // BACKEND_CONFIG:RESET_BEHAVIOR
    state.spinning = false;
    state.resultGrid = null;
    state.lastWin = 0;
    state.hasSpun = false;
    if (CONFIG.persistAfterClaim){
      localStorage.removeItem(LS_KEY);
      state.claimed = false;
    }
    setMessage("Press SPIN");
    setPayout("");
    els.betInput.disabled = false;
    els.spinBtn.disabled = false;
    els.email.value = "";
    els.phone.value = "";
    els.consent.checked = false;
    showClaimForm(false);
    populateReels();
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
    }
  }
  init();

  // Idle validation loop for claim button (in case of browser autofill)
  const iv = setInterval(validateClaim, 400);
  window.addEventListener("beforeunload", ()=> clearInterval(iv));
})();

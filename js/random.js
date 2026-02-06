(() => {
  const HINTS_URL = "/assets/support_hints.json";
  const UMA_URL   = "/assets/uma_data.json";

  const qs = (sel, el=document) => el.querySelector(sel);
  const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  const els = {
    fSSR: qs("#fSSR"), fSR: qs("#fSR"), fR: qs("#fR"),
    rollBtn: qs("#rollBtn"),
    excludeInput: qs("#excludeInput"),
    addExBtn: qs("#addExBtn"),
    excludeChips: qs("#excludeChips"),
    clearExBtn: qs("#clearExBtn"),
    deckResults: qs("#deckResults"),
    supportList: qs("#supportList"),
    pickUmaBtn: qs("#pickUmaBtn"),
    umaResult: qs("#umaResult"),
    speed2x: qs("#speed2x"),
    speed2xUma: qs("#speed2xUma")
  };

  function setLoading(target, message) {
    if (!target) return;
    target.innerHTML = `<div class="loading-indicator">${message}</div>`;
  }

  const store = {
    getExclusions() {
      try { return JSON.parse(localStorage.getItem("exclude_support_slugs") || "[]"); }
      catch { return []; }
    },
    setExclusions(arr) { localStorage.setItem("exclude_support_slugs", JSON.stringify(arr)); }
  };

  const renderBadge = (rarity) =>
    window.RarityBadge
      ? RarityBadge.render(rarity)
      : `<span class="badge badge-${rarity}">${rarity}</span>`;
  const applyBadge = (el, rarity) => {
    if (!el) return;
    if (window.RarityBadge) {
      RarityBadge.apply(el, rarity);
      return;
    }
    el.className = `badge badge-${rarity}`;
    el.textContent = rarity || '';
  };

// Speed control: default is slower for drama; 2× toggle makes it faster
function getSpeedFactorDeck(){ return (els.speed2x && els.speed2x.checked) ? 0.5 : 1.0; }
function getSpeedFactorUma(){ return (els.speed2xUma && els.speed2xUma.checked) ? 0.5 : 1.0; }

  function initialsOf(title){
    const cleaned = String(title || "")
      .replace(/\(.*?\)/g, "")
      .replace(/Support\s*Card/i, "")
      .trim();
    const tokens = cleaned.split(/\s+/).map(t => t.replace(/[^A-Za-z]/g, "")).filter(Boolean);
    if (tokens.length >= 2) return (tokens[0][0] + tokens[1][0]).toUpperCase();
    if (tokens.length === 1) {
      const t = tokens[0]; return (t.slice(0,2) || t[0] || "?").toUpperCase();
    }
    return "?";
  }

  function umaInitialsOf(name){
    const parts = String(name || "?")
      .replace(/\(.*?\)/g, "")
      .trim()
      .split(/\s+/)
      .map(t => t.replace(/[^A-Za-z]/g, ""))
      .filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1) return (parts[0].slice(0,2) || parts[0][0] || "?").toUpperCase();
    return "?";
  }

  function renderUmaThumb(u){
    if (u?.img) {
      const alt = u?.name ? `${u.name} portrait` : "Uma Musume portrait";
      return `<img src="${u.img}" alt="${alt}" loading="lazy" decoding="async" fetchpriority="low">`;
    }
    const init = umaInitialsOf(u?.name || "?");
    return `
      <span class="uma-initials">${init}</span>
      <span class="uma-emoji" aria-hidden="true">ðŸŽ</span>
    `;
  }

  function renderUmaWinnerCard(u, extraClass = "") {
    const nick = u?.nick ? ` <span class="subtle">(${u.nick})</span>` : "";
    const hasImg = !!u?.img;
    return `
      <div class="card reveal uma-winner ${extraClass}">
        <div class="uma-winner-thumb${hasImg ? " has-img" : ""}" aria-hidden="true">
          ${renderUmaThumb(u)}
        </div>
        <div class="uma-winner-copy">
          <h3>${u?.name || "Unknown"}${nick}</h3>
          <div class="subtle">Press "Pick Random Uma" to roll again.</div>
        </div>
      </div>
    `;
  }

  function cleanCardName(full){
    return String(full || "")
      .replace(/\s*\((?:SSR|SR|R)\)\s*/i, " ")
      .replace(/Support\s*Card/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function fetchJSON(url, fallbackUrl){
    try{
      // Use default caching - Vercel headers control TTL
      const r = await fetch(url, { cache: "force-cache" });
      if (!r.ok) throw new Error(r.statusText);
      return await r.json();
    }catch(e){
      if (fallbackUrl){
        const r2 = await fetch(fallbackUrl, { cache: "force-cache" });
        if (!r2.ok) throw new Error(r2.statusText);
        return await r2.json();
      }
      throw e;
    }
  }

  let supports = [];
  let umaList  = [];

  function mapSupports(data){
    return (data ?? []).map(c => {
      const rawName = c?.SupportName ?? "";
      const name = cleanCardName(rawName);
      const rarity = (c?.SupportRarity || (/\((SSR|SR|R)\)/i.exec(rawName)?.[1]) || "UNKNOWN").toUpperCase();
      const img  = c?.SupportImage || c?.SupportImageLocal || c?.Image || c?.Thumb || null;
      const slug = c?.SupportSlug || c?.slug || null;
      const id   = c?.SupportId ?? null;
      return { name, rawName, rarity, img, slug, id };
    }).filter(s => s.slug); // require slug for uniqueness
  }

  function mapUmas(data){
    return (data ?? []).map(u => ({
      name: u?.UmaName || "",
      nick: u?.UmaNickname || "",
      slug: u?.UmaSlug || null,
      img: u?.UmaImage || u?.UmaImageLocal || u?.UmaThumb || u?.Thumb || null
    })).filter(u => u.name);
  }

  function buildDatalist(){
    const opts = supports
      .sort((a,b) => a.name.localeCompare(b.name))
      .map(s => `<option value="${s.name} (${s.rarity}) [${s.slug}]"></option>`)
      .join("");
    els.supportList.innerHTML = opts;
  }

  function parseSlugFromOption(val){
    const m = /\[([^\]]+)\]\s*$/.exec(val);
    if (m) return m[1];
    const m2 = /^(.+?)\s*\((SSR|SR|R)\)\s*$/.exec(val);
    if (m2){
      const [_, n, r] = m2;
      const hit = supports.find(s => s.name.toLowerCase() === n.toLowerCase() && s.rarity === r.toUpperCase());
      if (hit) return hit.slug;
    }
    const hit2 = supports.find(s => s.name.toLowerCase() === val.toLowerCase());
    return hit2?.slug || null;
  }

  function renderExclusions(){
    const ex = store.getExclusions();
    const chips = ex.map(slug => {
      const s = supports.find(x => x.slug === slug);
      const label = s ? `${s.name} (${s.rarity})` : slug;
      return `<span class="chip">${label}<button data-slug="${slug}" aria-label="Remove ${label}">×</button></span>`;
    }).join("");
    els.excludeChips.innerHTML = chips;
    qsa("button[data-slug]", els.excludeChips).forEach(btn => {
      btn.addEventListener("click", () => {
        const next = store.getExclusions().filter(x => x !== btn.dataset.slug);
        store.setExclusions(next);
        renderExclusions();
      });
    });
  }

  function pickNRandom(arr, n){
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  }

  // ------- Static render (deck) -------
  function renderDeckStatic(){
    const ex = new Set(store.getExclusions());
    const allowedR = new Set([
      els.fSSR?.checked ? "SSR" : null,
      els.fSR?.checked  ? "SR"  : null,
      els.fR?.checked   ? "R"   : null,
    ].filter(Boolean));

    const pool = supports.filter(s => allowedR.has(s.rarity) && !ex.has(s.slug));
    const pick = pickNRandom(pool, Math.min(5, pool.length));

    els.deckResults.innerHTML = pick.length ? pick.map(cardMarkup).join("") :
      `<div class="inline-note">No cards available. Adjust filters or exclusions.</div>`;
  }

  function cardMarkup(s, extraClass=""){
    const img = s.img
      ? `<img src="${s.img}" alt="${s.name}" loading="lazy" decoding="async" fetchpriority="low">`
      : `<span>${initialsOf(s.name)}</span>`;
    return `
      <div class="card card-support ${extraClass}">
        <div class="card-thumb">${img}</div>
        <div class="card-title">
          <h3>${s.name}</h3>
          ${renderBadge(s.rarity)}
        </div>
      </div>
    `;
  }

  // ------- Deck animated roll -------
  let rolling = false;
  let settleTimers = [];

  function slotSkeleton(i){
    return `
      <div class="card card-support slot" data-slot="${i}">
        <div class="card-thumb spinning"></div>
        <div class="card-title">
          <h3 class="skeleton-text">Rolling…</h3>
          <span class="badge">…</span>
        </div>
      </div>
    `;
  }

  function startDeckRoll(){
    if (rolling) return;

    const ex = new Set(store.getExclusions());
    const allowedR = new Set([
      els.fSSR?.checked ? "SSR" : null,
      els.fSR?.checked  ? "SR"  : null,
      els.fR?.checked   ? "R"   : null,
    ].filter(Boolean));

    const pool = supports.filter(s => allowedR.has(s.rarity) && !ex.has(s.slug));
    const N = Math.min(5, pool.length);
    if (!N) {
      els.deckResults.innerHTML = `<div class="inline-note">No cards available. Adjust filters or exclusions.</div>`;
      return;
    }

    const finalPick = pickNRandom(pool, N);
    const reduceMotion = false;
    if (reduceMotion) {
      els.deckResults.innerHTML = finalPick.map((s) => cardMarkup(s, "reveal")).join("");
      return;
    }

    els.deckResults.innerHTML = Array.from({length: N}, (_,i)=> slotSkeleton(i)).join("");
    document.body.classList.add("deck-rolling");
    els.rollBtn.disabled = true;
    rolling = true;

    const SPIN_MS_BASE = 140;   // slower default spin (was 90)
const BASE_SETTLE_BASE = 1600; // slower default settle (was 900)
const STAGGER_BASE = 300;   // slower default stagger (was 150)

    const cycles = [];

    const speedFactor = getSpeedFactorDeck();
const SPIN_MS = Math.max(30, Math.round(SPIN_MS_BASE * speedFactor));
const BASE_SETTLE = Math.round(BASE_SETTLE_BASE * speedFactor);
const STAGGER = Math.round(STAGGER_BASE * speedFactor);
for (let i = 0; i < N; i++){
      const slot = qs(`[data-slot="${i}"]`, els.deckResults);
      const titleEl = qs("h3", slot);
      const badgeEl = qs(".badge", slot);
      const thumbEl = qs(".card-thumb", slot);

      const cycle = setInterval(() => {
        const s = pool[Math.floor(Math.random() * pool.length)];
        titleEl.textContent = s.name;
        applyBadge(badgeEl, s.rarity);
        const live = s.img ? `<img src="${s.img}" alt="${s.name}" loading="lazy" decoding="async" fetchpriority="low">` : `<span>${initialsOf(s.name)}</span>`;
        thumbEl.innerHTML = live;
      }, SPIN_MS);
      cycles.push(cycle);

      const settleAt = BASE_SETTLE + i * STAGGER + Math.floor(Math.random() * 120);
      const t = setTimeout(() => {
        clearInterval(cycle);
        const s = finalPick[i];
        slot.outerHTML = cardMarkup(s, "reveal");
      }, settleAt);
      settleTimers.push(t);
    }

    const doneAt = BASE_SETTLE + (N-1) * STAGGER + 200;
    const doneTimer = setTimeout(() => {
      cycles.forEach(clearInterval);
      settleTimers.forEach(clearTimeout);
      settleTimers = [];
      document.body.classList.remove("deck-rolling");
      els.rollBtn.disabled = false;
      rolling = false;
    }, doneAt);
    settleTimers.push(doneTimer);
  }

  // ------- UMA "CS:GO case" style roll (placeholder thumbs) -------
  let umaRolling = false;
  function umaItemMarkup(u, isWinner = false){
    const nick = u.nick ? ` <span class="subtle">(${u.nick})</span>` : "";
    const hasImg = !!u.img;
    return `
        <div class="case-item${isWinner ? " winner" : ""}"
            data-umaslug="${u.slug || ""}" data-win="${isWinner ? 1 : 0}"
            title="${u.name}">
        <div class="uma-thumb${hasImg ? " has-img" : ""}" aria-hidden="true">
            ${renderUmaThumb(u)}
        </div>
        <div class="uma-title">${u.name}${nick}</div>
        </div>
    `;
  }

  function startUmaCaseRoll(){
    if (!umaList.length){
        els.umaResult.innerHTML = `<div class="inline-note">No Uma data available.</div>`;
        return;
    }
    if (umaRolling) return;
    umaRolling = true;
    els.pickUmaBtn.disabled = true;
    document.body.classList.add("uma-rolling");

    // Build viewport & strip
    els.umaResult.innerHTML = `
        <div class="case-viewport" id="caseViewport" role="region" aria-label="Uma case roll">
        <div class="case-strip" id="caseStrip"></div>
        <div class="case-pointer" aria-hidden="true"></div>
        </div>
    `;
    const strip = document.getElementById("caseStrip");
    const viewport = document.getElementById("caseViewport");

    // Sequence: random items + guaranteed WINNER + TWO placeholders AFTER the winner
    const preCount = 18;
    const postCount = 6;
    const placeholdersCount = 2;   // ← add one extra item after the winner
    const filler = umaList.slice().sort(()=>Math.random()-0.5).slice(0, Math.min(preCount, umaList.length));
    const tail   = umaList.slice().sort(()=>Math.random()-0.5).slice(0, Math.min(postCount, umaList.length));
    const winner = umaList[Math.floor(Math.random() * umaList.length)];

    // pick 2 placeholders, try to avoid duplicating the winner
    const placeholders = [];
    for (let i = 0; i < placeholdersCount; i++){
        let p = umaList[Math.floor(Math.random() * umaList.length)];
        if (umaList.length > 1){
        let guard = 0;
        while (p.slug === winner.slug && guard++ < 8){
            p = umaList[Math.floor(Math.random() * umaList.length)];
        }
        }
        placeholders.push(p);
    }

    const sequence = [...filler, ...tail, winner, ...placeholders];

    const reduceMotion = false;

    // render and explicitly mark the WINNER (index is before the placeholders)
    const winnerIndex = sequence.length - placeholdersCount - 1;
    strip.innerHTML = sequence.map((u, idx) => umaItemMarkup(u, idx === winnerIndex)).join("");

    if (reduceMotion) {
      els.umaResult.innerHTML = renderUmaWinnerCard(winner);
      els.pickUmaBtn.disabled = false;
      umaRolling = false;
      document.body.classList.remove("uma-rolling");
      return;
    }

    const runCaseAnimation = () => {
    // Measure and animate to center the WINNER with a tiny random jitter
    requestAnimationFrame(() => {
        const items = Array.from(strip.querySelectorAll(".case-item"));
        if (!items.length){ umaRolling = false; els.pickUmaBtn.disabled = false; return; }

        // Reset transform before measuring
        strip.style.transform = "translate3d(0,0,0)";
        strip.style.transition = "none";

        const vpRect     = viewport.getBoundingClientRect();
        const firstRect  = items[0].getBoundingClientRect();
        const winEl      = strip.querySelector('.case-item[data-win="1"]') || items[winnerIndex];
        const winRect    = winEl.getBoundingClientRect();

        // base offset to center winner
        const deltaLeft      = winRect.left - firstRect.left; // distance from first to winner
        const winCenter      = deltaLeft + winRect.width / 2;
        const vpCenter       = vpRect.width / 2;
        const baseOffset     = Math.max(0, winCenter - vpCenter);

        // jitter: vary where the needle “lands” by a few pixels
        const jitterRangePx  = 10; // tweak to taste (±10px)
        const jitter         = Math.floor(Math.random() * (2 * jitterRangePx + 1)) - jitterRangePx; // [-10, +10]

        // clamp to content bounds so we never overshoot the strip
        const maxOffset      = Math.max(0, strip.scrollWidth - vpRect.width);
        const targetOffset   = Math.max(0, Math.min(baseOffset + jitter, maxOffset));

        // small nudge so motion is visible from the start
        const overshoot = 40;
        strip.style.transform  = `translate3d(${overshoot}px,0,0)`;

        const durationBase = 2800 + Math.floor(Math.random() * 400); // 2.8–3.2s
const duration = Math.max(600, Math.round(durationBase * getSpeedFactorUma()));
        requestAnimationFrame(() => {
        strip.style.transition = `transform ${duration}ms cubic-bezier(.08,.7,.12,1)`;
        strip.style.transform  = `translate3d(${-targetOffset}px,0,0)`;
        });

        const end = () => {
        strip.removeEventListener("transitionend", end);
        els.umaResult.insertAdjacentHTML("beforeend", renderUmaWinnerCard(winner, "uma-winner-after-roll"));
        els.pickUmaBtn.disabled = false;
        umaRolling = false;
        document.body.classList.remove("uma-rolling");
        };
        strip.addEventListener("transitionend", end, { once: true });
    });
    };

    const preRollDuration = 600;
    const preRollInterval = setInterval(() => {
      const items = Array.from(strip.querySelectorAll(".case-item"));
      items.forEach(item => {
        if (item.dataset.win === "1") return;
        const u = umaList[Math.floor(Math.random() * umaList.length)];
        const title = item.querySelector(".uma-title");
        const thumb = item.querySelector(".uma-thumb");
        if (title) title.textContent = u.name || "?";
        if (thumb) {
          thumb.classList.toggle("has-img", !!u.img);
          thumb.innerHTML = renderUmaThumb(u);
        }
      });
    }, 120);

    setTimeout(() => {
      clearInterval(preRollInterval);
      runCaseAnimation();
    }, preRollDuration);
    }

  // ------- Events (this was missing) -------
  function wireEvents(){
    // Filters & deck
    [els.fSSR, els.fSR, els.fR].forEach(cb => cb?.addEventListener("change", renderDeckStatic));
    els.rollBtn?.addEventListener("click", startDeckRoll);

    // Exclusions
    els.addExBtn?.addEventListener("click", () => {
      const val = (els.excludeInput.value || "").trim();
      if (!val) return;
      const slug = parseSlugFromOption(val);
      if (!slug) { alert("Couldn't find that support. Please pick one from the list."); return; }
      const ex = new Set(store.getExclusions());
      ex.add(slug);
      store.setExclusions(Array.from(ex));
      els.excludeInput.value = "";
      renderExclusions();
    });

    els.clearExBtn?.addEventListener("click", () => {
      store.setExclusions([]);
      renderExclusions();
    });

    // UMA reel
    els.pickUmaBtn?.addEventListener("click", startUmaCaseRoll);
  }

  // Init
  (async () => {
    try{
      setLoading(els.deckResults, "Loading support data\u2026");
      setLoading(els.umaResult, "Loading Uma data\u2026");
      const [hints, umas] = await Promise.all([
        fetchJSON(HINTS_URL, "/support_hints.json"),
        fetchJSON(UMA_URL, "/uma_data.json")
      ]);
      supports = mapSupports(hints);
      umaList = mapUmas(umas);
      buildDatalist();
      renderExclusions();
      renderDeckStatic();  // initial deck render
      wireEvents();        // <-- attach all listeners
      // Uma area starts idle until user rolls
      els.umaResult.innerHTML = `<div class="inline-note">Click "Pick Random Uma" to roll.</div>`;
    }catch(e){
      console.error(e);
      els.deckResults.innerHTML = `<div class="inline-note">Failed to load data.</div>`;
      els.umaResult.innerHTML = `<div class="inline-note">Failed to load data.</div>`;
    }
  })();
})();

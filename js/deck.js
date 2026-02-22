(async function () {
  'use strict';

  const CHAR_URL = '/assets/uma_data.json';
  const SUPPORT_URL = '/assets/support_hints.json';
  const MAX_SUPPORTS = 6;
  const STORAGE_KEY = 'umatools-deck';
  const SAVED_DECKS_KEY = 'umatools-saved-decks';
  const SERVER_PREF_KEY = 'umatoolsServer';
  const SUPPORT_TYPES = ['Speed', 'Stamina', 'Power', 'Guts', 'Wit', 'Friend', 'Group'];
  const RARITY_ORDER = ['SSR', 'SR', 'R'];

  // Limit break labels (5 stops)
  const LB_LABELS = ['LB0', 'LB1', 'LB2', 'LB3', 'MLB'];

  // Map LB stop (0-4) → index in the 11-value effects array, per rarity
  // Breakpoints are at Lv1,5,10,15,20,25,30,35,40,45,50 (indices 0-10)
  // SSR: LB0=Lv30(6), LB1=Lv35(7), LB2=Lv40(8), LB3=Lv45(9), MLB=Lv50(10)
  // SR:  LB0=Lv25(5), LB1=Lv30(6), LB2=Lv35(7), LB3=Lv40(8), MLB=Lv45(9)
  // R:   LB0=Lv20(4), LB1=Lv25(5), LB2=Lv30(6), LB3=Lv35(7), MLB=Lv40(8)
  const LB_INDICES = { SSR: [6, 7, 8, 9, 10], SR: [5, 6, 7, 8, 9], R: [4, 5, 6, 7, 8] };

  function lbToEffectIndex(lbStop, rarity) {
    return (LB_INDICES[rarity] || LB_INDICES.SSR)[lbStop] ?? 10;
  }

  const STAR_LEVELS = [3, 4, 5];

  // Elements
  const charDisplay = document.getElementById('charDisplay');
  const supportSlots = document.getElementById('supportSlots');
  const supportCount = document.getElementById('supportCount');
  const summarySection = document.getElementById('summarySection');
  const summaryContent = document.getElementById('summaryContent');
  const shareLinkBtn = document.getElementById('shareLinkBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const statusMsg = document.getElementById('statusMsg');

  // Modal elements
  const supportModal = document.getElementById('supportModal');
  const supportSearch = document.getElementById('supportSearch');
  const supportModalList = document.getElementById('supportModalList');
  const typeFiltersEl = document.getElementById('typeFilters');
  const rarityFiltersEl = document.getElementById('rarityFilters');

  // Effects panel elements
  const effectsPanel = document.getElementById('effectsPanel');
  const effectsPanelTitle = document.getElementById('effectsPanelTitle');
  const effectsLevelSlider = document.getElementById('effectsLevelSlider');
  const effectsLevelLabel = document.getElementById('effectsLevelLabel');
  const effectsPanelBody = document.getElementById('effectsPanelBody');

  // Breakpoint levels (index in the 11-value effects array) for each LB stop
  // Lv1,5,10,15,20,25,30,35,40,45,50 → indices 0-10
  const LB_UNLOCK_INDEX = { 0: 0, 1: 0, 5: 1, 10: 2, 15: 3, 20: 4, 25: 5, 30: 6, 35: 7, 40: 8, 45: 9, 50: 10 };

  function uniqueActiveAtLb(card, lbStop) {
    if (!card.SupportUnique) return false;
    const rarity = card.SupportRarity || 'SSR';
    const cardIdx = lbToEffectIndex(lbStop, rarity);
    const unlockLv = card.SupportUnique.level || 0;
    const unlockIdx = LB_UNLOCK_INDEX[unlockLv] ?? 0;
    return cardIdx >= unlockIdx;
  }

  // Character modal elements
  const charModal = document.getElementById('charModal');
  const charSearchInput = document.getElementById('charSearch');
  const charModalList = document.getElementById('charModalList');

  // State
  let characters = [];
  let supports = [];
  let selectedChar = null;
  let charStarLevel = 5;
  let selectedSupports = []; // card objects
  let supportLbStops = [];   // per-card LB stop (0-4), parallel to selectedSupports
  let currentServer = 'en';

  // Character modal filter state
  let charFilterSearch = '';

  // Modal filter state
  let filterType = null;
  let filterRarity = null;
  let filterSearch = '';

  // Effects panel state
  let effectsCard = null;
  let effectsLbStop = 4; // 0=LB0 .. 4=MLB

  // Support swap state: index of slot being replaced, or -1 for "add new"
  let pendingReplaceIdx = -1;

  // --- Data loading ---
  function showStatus(msg) {
    if (statusMsg) statusMsg.textContent = msg;
  }

  showStatus(t('deck.loadingData'));

  try {
    const [charRes, supRes] = await Promise.all([fetch(CHAR_URL), fetch(SUPPORT_URL)]);
    if (!charRes.ok) throw new Error(t('deck.failedCharData'));
    if (!supRes.ok) throw new Error(t('deck.failedSupportData'));
    characters = await charRes.json();
    supports = await supRes.json();
    showStatus('');
  } catch (err) {
    showStatus(t('deck.failedLoadData'));
    console.error(err);
    return;
  }

  // --- Helpers ---
  function cleanCardName(full) {
    return String(full || '')
      .replace(/\s*\((?:SSR|SR|R)\)\s*/i, ' ')
      .replace(/Support\s*Card/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function initialsOf(name) {
    const cleaned = String(name || '')
      .replace(/\(.*?\)/g, '')
      .replace(/Support\s*Card/i, '')
      .trim();
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return '?';
    if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
    return (tokens[0][0] + tokens[1][0]).toUpperCase();
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function readServerPref() {
    try {
      const v = localStorage.getItem(SERVER_PREF_KEY);
      return v === 'jp' ? 'jp' : 'en';
    } catch {
      return 'en';
    }
  }

  function matchesServer(item) {
    if (currentServer === 'jp') return true; // JP shows all
    const server = item.UmaServer || item.SupportServer || '';
    return server === 'global';
  }

  function findCharBySlug(slug) {
    return characters.find((c) => c.UmaSlug === slug || c.UmaId === slug) || null;
  }

  function findSupportBySlug(slug) {
    return supports.find((s) => s.SupportSlug === slug || s.SupportId === slug) || null;
  }

  // --- Render character ---
  function renderCharacter() {
    if (!selectedChar) {
      charDisplay.innerHTML = `
        <div class="deck-support-slot" data-action="open-char-picker">
          <div class="slot-placeholder">+</div>
          <div class="slot-placeholder-text">${t('deck.selectChar')}</div>
        </div>`;
      return;
    }
    const c = selectedChar;

    const starKey = `${charStarLevel}\u2605`;
    const stats = c.UmaBaseStats?.[starKey] || c.UmaBaseStats?.['5\u2605'] || {};
    const bonuses = c.UmaStatBonuses || {};
    const statNames = ['Speed', 'Stamina', 'Power', 'Guts', 'Wit'];
    const statLabel = { Speed: t('common.speed'), Stamina: t('common.stamina'), Power: t('common.power'), Guts: t('common.guts'), Wit: t('common.wisdom') };

    let statsHtml = '<div class="deck-stats-grid">';
    for (const s of statNames) {
      const val = stats[s] ?? '-';
      const bonus = bonuses[s];
      const bonusStr = bonus ? `+${bonus}%` : '';
      statsHtml += `
        <div class="deck-stat">
          <div class="stat-label">${escHtml(statLabel[s] || s)}</div>
          <div class="stat-value">${escHtml(String(val))}</div>
          ${bonusStr ? `<div class="stat-bonus">${escHtml(bonusStr)}</div>` : ''}
        </div>`;
    }
    statsHtml += '</div>';

    let aptHtml = '';
    const apt = c.UmaAptitudes;
    if (apt && Object.keys(apt).length) {
      aptHtml = '<div class="deck-aptitudes">';
      for (const [group, entries] of Object.entries(apt)) {
        aptHtml += `<div class="apt-group"><span class="apt-group-label">${escHtml(group)}</span>`;
        for (const [name, grade] of Object.entries(entries || {})) {
          aptHtml += `<span class="apt-badge"><span class="apt-name">${escHtml(name)}</span> <span class="apt-grade" data-grade="${escHtml(String(grade))}">${escHtml(String(grade))}</span></span>`;
        }
        aptHtml += '</div>';
      }
      aptHtml += '</div>';
    }

    const charImgSrc = c.UmaImage || '';
    const charImgHtml = charImgSrc
      ? `<img class="char-thumb" src="${escHtml(charImgSrc)}" alt="${escHtml(c.UmaName)}" loading="lazy">`
      : '';

    let starBtnsHtml = '<div class="slot-star-row">';
    for (const lv of STAR_LEVELS) {
      const cls = lv === charStarLevel ? 'star-btn active' : 'star-btn';
      starBtnsHtml += `<button class="${cls}" data-star="${lv}">${lv}\u2605</button>`;
    }
    starBtnsHtml += '</div>';

    charDisplay.innerHTML = `
      <div class="deck-character-card">
        ${charImgHtml}
        <div class="char-info">
          <div class="char-name">${escHtml(c.UmaName)}</div>
          ${c.UmaNickname ? `<div class="char-nickname">${escHtml(c.UmaNickname)}</div>` : ''}
          ${starBtnsHtml}
          ${statsHtml}
          ${aptHtml}
        </div>
        <button class="remove-btn" title="${t('deck.removeChar')}" data-action="remove-char">&times;</button>
      </div>`;
  }

  // --- Render support slots ---
  function renderSupportSlots() {
    supportCount.textContent = String(selectedSupports.length);
    let html = '';

    for (let i = 0; i < MAX_SUPPORTS; i++) {
      const s = selectedSupports[i];
      if (s) {
        const name = cleanCardName(s.SupportName);
        const imgSrc = s.SupportImage || '';
        const imgHtml = imgSrc
          ? `<img class="support-thumb" src="${escHtml(imgSrc)}" alt="${escHtml(name)}" loading="lazy">`
          : `<div class="support-initials">${escHtml(initialsOf(name))}</div>`;

        const typeStr = s.SupportType || '';
        const typeBadge = typeStr
          ? `<span class="support-type-badge" data-type="${escHtml(typeStr)}">${escHtml(typeStr)}</span>`
          : '';

        const lb = supportLbStops[i] ?? 4;
        let lbHtml = '<div class="slot-lb-row">';
        for (let j = 0; j < LB_LABELS.length; j++) {
          const cls = j === lb ? 'lb-btn active' : 'lb-btn';
          lbHtml += `<button class="${cls}" data-idx="${i}" data-lb="${j}">${LB_LABELS[j]}</button>`;
        }
        lbHtml += '</div>';

        html += `
          <div class="deck-support-slot filled" data-idx="${i}">
            <button class="slot-swap" title="${t('deck.swapCard')}" data-idx="${i}">&#x21C4;</button>
            <button class="slot-remove" title="${t('common.remove')}" data-idx="${i}">&times;</button>
            ${imgHtml}
            <div class="support-name">${escHtml(name)}</div>
            ${typeBadge}
            ${lbHtml}
          </div>`;
      } else {
        html += `
          <div class="deck-support-slot" data-action="open-picker">
            <div class="slot-placeholder">+</div>
            <div class="slot-placeholder-text">${t('deck.addCard')}</div>
          </div>`;
      }
    }

    supportSlots.innerHTML = html;
  }

  // --- Render combined summary ---

  // Only these effects are shown in the deck breakdown
  const DECK_EFFECT_NAMES = [
    'Race Bonus',
    'Fan Bonus',
    'Initial Speed',
    'Initial Stamina',
    'Initial Power',
    'Initial Guts',
    'Initial Wit',
  ];
  const DECK_EFFECT_SET = new Set(DECK_EFFECT_NAMES);

  function buildDeckEffects() {
    const totals = {};
    const symbols = {};
    for (let i = 0; i < selectedSupports.length; i++) {
      const card = selectedSupports[i];
      const rarity = card.SupportRarity || 'SSR';
      const lb = supportLbStops[i] ?? 4;
      const idx = lbToEffectIndex(lb, rarity);

      // Regular effects
      for (const eff of card.SupportEffects || []) {
        if (!DECK_EFFECT_SET.has(eff.name)) continue;
        const val = eff.values?.[idx] ?? 0;
        if (val === 0) continue;
        totals[eff.name] = (totals[eff.name] || 0) + val;
        symbols[eff.name] = eff.symbol;
      }

      // Unique effects (if unlocked at this LB)
      if (uniqueActiveAtLb(card, lb)) {
        for (const u of card.SupportUnique.effects) {
          if (!DECK_EFFECT_SET.has(u.name)) continue;
          totals[u.name] = (totals[u.name] || 0) + u.value;
          symbols[u.name] = u.symbol;
        }
      }
    }
    return { totals, symbols };
  }

  function renderSummary() {
    if (!selectedChar && selectedSupports.length === 0) {
      summarySection.style.display = 'none';
      return;
    }
    summarySection.style.display = '';

    let html = '';

    // Character stat bonuses
    if (selectedChar) {
      const bonuses = selectedChar.UmaStatBonuses || {};
      const statNames = ['Speed', 'Stamina', 'Power', 'Guts', 'Wit'];
      const statLabel = { Speed: t('common.speed'), Stamina: t('common.stamina'), Power: t('common.power'), Guts: t('common.guts'), Wit: t('common.wisdom') };
      const bonusParts = statNames.filter((s) => bonuses[s]).map((s) => `${(statLabel[s] || s)} +${bonuses[s]}%`);
      if (bonusParts.length) {
        html += `
          <div class="deck-summary-row">
            <span class="deck-summary-label">Stat Bonuses:</span>
            <span class="deck-summary-value">${escHtml(bonusParts.join(', '))}</span>
          </div>`;
      }
    }

    // Deck effect breakdown
    if (selectedSupports.length > 0) {
      const { totals, symbols } = buildDeckEffects();
      const effectRows = DECK_EFFECT_NAMES.filter((n) => totals[n]).map((n) => {
        const sym = symbols[n] === 'percent' ? '%' : '';
        return `<div class="effect-row">
          <span class="effect-name">${escHtml(n)}</span>
          <span class="effect-value">${totals[n]}${sym}</span>
        </div>`;
      });

      if (effectRows.length) {
        html += `
          <div class="deck-summary-sub">
            <div class="deck-summary-label">Combined Effects</div>
            <div class="deck-effects-grid">${effectRows.join('')}</div>
          </div>`;
      }

      // Combined hints (skip non-skill entries like "Initial X bonus")
      const hintCounts = new Map();
      for (const s of selectedSupports) {
        for (const h of s.SupportHints || []) {
          const name = h.Name || '';
          if (!name || !h.SkillId) continue;
          hintCounts.set(name, (hintCounts.get(name) || 0) + 1);
        }
      }

      const allHints = Array.from(hintCounts.entries()).sort((a, b) =>
        a[0].localeCompare(b[0], 'en'),
      );
      const unique = allHints.length;
      const shared = allHints.filter(([, c]) => c > 1).length;

      html += `
        <div class="deck-summary-row">
          <span class="deck-summary-label">Skill Hints:</span>
          <span class="deck-summary-value">${unique} unique${shared ? `, ${shared} shared` : ''}</span>
        </div>`;

      if (allHints.length) {
        html += '<div class="deck-hints">';
        for (const [name, count] of allHints) {
          const cls = count > 1 ? 'hint-pill shared' : 'hint-pill';
          const label = count > 1 ? `${name} (${count})` : name;
          html += `<span class="${cls}">${escHtml(label)}</span>`;
        }
        html += '</div>';
      }
    }

    if (!html) {
      html =
        `<div class="deck-empty">${t('deck.emptySummary')}</div>`;
    }

    summaryContent.innerHTML = html;
  }

  // --- Full render ---
  function render() {
    renderCharacter();
    renderSupportSlots();
    renderSummary();
  }

  // --- Persistence ---
  function saveDeck() {
    const data = {
      char: selectedChar?.UmaSlug || null,
      stars: charStarLevel,
      supports: selectedSupports.map((s) => s.SupportSlug),
      lbs: supportLbStops.slice(0, selectedSupports.length),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }

  function loadDeck() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.char) {
        selectedChar = findCharBySlug(data.char);
      }
      if (data.stars && STAR_LEVELS.includes(data.stars)) {
        charStarLevel = data.stars;
      }
      if (Array.isArray(data.supports)) {
        selectedSupports = data.supports
          .map((slug) => findSupportBySlug(slug))
          .filter(Boolean)
          .slice(0, MAX_SUPPORTS);
        supportLbStops = (data.lbs || []).slice(0, selectedSupports.length);
        // Fill any missing LB stops with MLB (4)
        while (supportLbStops.length < selectedSupports.length) supportLbStops.push(4);
      }
    } catch {}
  }

  function loadFromUrl() {
    const params = new URLSearchParams(location.search);
    const c = params.get('c');
    const s = params.get('s');
    let loaded = false;
    if (c) {
      const found = findCharBySlug(c);
      if (found) {
        selectedChar = found;
        loaded = true;
      }
    }
    const starsParam = parseInt(params.get('st'), 10);
    if (starsParam && STAR_LEVELS.includes(starsParam)) {
      charStarLevel = starsParam;
    }
    if (s) {
      const slugs = s.split(',').filter(Boolean);
      const found = slugs.map((sl) => findSupportBySlug(sl)).filter(Boolean);
      if (found.length) {
        selectedSupports = found.slice(0, MAX_SUPPORTS);
        // Parse LB stops from URL, default to MLB
        const lbParam = params.get('lb');
        if (lbParam) {
          supportLbStops = lbParam.split(',').map((v) => {
            const n = parseInt(v, 10);
            return n >= 0 && n <= 4 ? n : 4;
          }).slice(0, selectedSupports.length);
        } else {
          supportLbStops = selectedSupports.map(() => 4);
        }
        while (supportLbStops.length < selectedSupports.length) supportLbStops.push(4);
        loaded = true;
      }
    }
    return loaded;
  }

  // =====================================================================
  // Saved Decks
  // =====================================================================

  const savedDecksModal = document.getElementById('savedDecksModal');
  const savedDecksList = document.getElementById('savedDecksList');
  const saveDeckBtn = document.getElementById('saveDeckBtn');
  const saveDeckName = document.getElementById('saveDeckName');
  const openSavedBtn = document.getElementById('openSavedBtn');

  function getSavedDecks() {
    try {
      const raw = localStorage.getItem(SAVED_DECKS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function writeSavedDecks(decks) {
    try {
      localStorage.setItem(SAVED_DECKS_KEY, JSON.stringify(decks));
    } catch {}
  }

  function saveCurrentDeck() {
    if (!selectedChar && selectedSupports.length === 0) {
      showStatus('Nothing to save.');
      setTimeout(() => showStatus(''), 2000);
      return;
    }

    const name = saveDeckName.value.trim();
    if (!name) {
      saveDeckName.focus();
      return;
    }

    const deck = {
      name,
      char: selectedChar?.UmaSlug || null,
      stars: charStarLevel,
      supports: selectedSupports.map((s) => s.SupportSlug),
      lbs: supportLbStops.slice(0, selectedSupports.length),
      ts: Date.now(),
    };

    const decks = getSavedDecks();
    decks.unshift(deck);
    writeSavedDecks(decks);
    saveDeckName.value = '';
    renderSavedDecks();
  }

  function loadSavedDeck(index) {
    const decks = getSavedDecks();
    const deck = decks[index];
    if (!deck) return;

    selectedChar = deck.char ? findCharBySlug(deck.char) : null;
    charStarLevel = (deck.stars && STAR_LEVELS.includes(deck.stars)) ? deck.stars : 5;
    selectedSupports = (deck.supports || [])
      .map((slug) => findSupportBySlug(slug))
      .filter(Boolean)
      .slice(0, MAX_SUPPORTS);
    supportLbStops = (deck.lbs || []).slice(0, selectedSupports.length);
    while (supportLbStops.length < selectedSupports.length) supportLbStops.push(4);

    saveDeck();
    render();
    showStatus(`Loaded "${deck.name}"`);
    setTimeout(() => showStatus(''), 2000);
  }

  function deleteSavedDeck(index) {
    const decks = getSavedDecks();
    if (index < 0 || index >= decks.length) return;
    decks.splice(index, 1);
    writeSavedDecks(decks);
    renderSavedDecks();
  }

  function renderSavedDecks() {
    const decks = getSavedDecks();
    if (decks.length === 0) {
      savedDecksList.innerHTML = `<div class="modal-card-empty">${t('deck.noSavedDecks')}</div>`;
      return;
    }

    let html = '';
    for (let i = 0; i < decks.length; i++) {
      const d = decks[i];
      const charName = d.char
        ? (findCharBySlug(d.char)?.UmaName || d.char)
        : t('deck.noCharacter');
      const supCount = (d.supports || []).length;

      html += `<div class="saved-deck-item" data-idx="${i}">
        <div class="saved-deck-info">
          <div class="saved-deck-name">${escHtml(d.name)}</div>
          <div class="saved-deck-meta">${escHtml(charName)} + ${supCount} support${supCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="saved-deck-actions">
          <button class="saved-deck-load" data-idx="${i}" title="Load">Load</button>
          <button class="saved-deck-delete" data-idx="${i}" title="Delete">&times;</button>
        </div>
      </div>`;
    }
    savedDecksList.innerHTML = html;
  }

  function openSavedDecksModal() {
    saveDeckName.value = selectedChar ? selectedChar.UmaName : '';
    renderSavedDecks();
    savedDecksModal.hidden = false;
  }

  function closeSavedDecksModal() {
    savedDecksModal.hidden = true;
  }

  openSavedBtn.addEventListener('click', openSavedDecksModal);
  savedDecksModal.querySelector('.support-modal-backdrop').addEventListener('click', closeSavedDecksModal);
  savedDecksModal.querySelector('.support-modal-close').addEventListener('click', closeSavedDecksModal);

  saveDeckBtn.addEventListener('click', saveCurrentDeck);
  saveDeckName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCurrentDeck();
    }
  });

  savedDecksList.addEventListener('click', (e) => {
    const loadBtn = e.target.closest('.saved-deck-load');
    if (loadBtn) {
      loadSavedDeck(parseInt(loadBtn.dataset.idx, 10));
      closeSavedDecksModal();
      return;
    }
    const delBtn = e.target.closest('.saved-deck-delete');
    if (delBtn) {
      deleteSavedDeck(parseInt(delBtn.dataset.idx, 10));
    }
  });

  // =====================================================================
  // Support Card Picker Modal
  // =====================================================================

  function initFilterButtons() {
    typeFiltersEl.innerHTML = '';
    for (const t of SUPPORT_TYPES) {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.textContent = t;
      btn.dataset.type = t;
      btn.addEventListener('click', () => {
        filterType = filterType === t ? null : t;
        updateFilterButtons();
        renderModalList();
      });
      typeFiltersEl.appendChild(btn);
    }

    rarityFiltersEl.innerHTML = '';
    for (const r of RARITY_ORDER) {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.textContent = r;
      btn.dataset.rarity = r;
      btn.addEventListener('click', () => {
        filterRarity = filterRarity === r ? null : r;
        updateFilterButtons();
        renderModalList();
      });
      rarityFiltersEl.appendChild(btn);
    }
  }

  function updateFilterButtons() {
    for (const btn of typeFiltersEl.querySelectorAll('.filter-btn')) {
      btn.classList.toggle('active', btn.dataset.type === filterType);
    }
    for (const btn of rarityFiltersEl.querySelectorAll('.filter-btn')) {
      btn.classList.toggle('active', btn.dataset.rarity === filterRarity);
    }
  }

  function getFilteredSupports() {
    const search = filterSearch.toLowerCase();
    const selectedSlugs = new Set(selectedSupports.map((s) => s.SupportSlug));

    return supports
      .filter((s) => {
        if (!matchesServer(s)) return false;
        if (filterType && s.SupportType !== filterType) return false;
        if (filterRarity && s.SupportRarity !== filterRarity) return false;
        if (search && !cleanCardName(s.SupportName).toLowerCase().includes(search)) return false;
        return true;
      })
      .map((s) => ({ ...s, _selected: selectedSlugs.has(s.SupportSlug) }));
  }

  function renderModalList() {
    const filtered = getFilteredSupports();

    if (filtered.length === 0) {
      supportModalList.innerHTML = `<div class="modal-card-empty">${t('deck.noCardsMatch')}</div>`;
      return;
    }

    let html = '';
    for (const s of filtered) {
      const name = cleanCardName(s.SupportName);
      const cls = s._selected ? 'modal-card-item disabled' : 'modal-card-item';
      const typeStr = s.SupportType || '';
      const typeBadge = typeStr
        ? `<span class="support-type-badge" data-type="${escHtml(typeStr)}">${escHtml(typeStr)}</span>`
        : '';
      const imgSrc = s.SupportImage || '';
      const imgHtml = imgSrc
        ? `<img class="modal-card-thumb" src="${escHtml(imgSrc)}" alt="" loading="lazy">`
        : `<span class="modal-card-initials">${escHtml(initialsOf(name))}</span>`;

      html += `<div class="${cls}" data-slug="${escHtml(s.SupportSlug)}">
        ${imgHtml}
        <span class="modal-card-name">${escHtml(name)}</span>
        ${typeBadge}
        <span class="modal-card-rarity">${escHtml(s.SupportRarity || '')}</span>
      </div>`;
    }
    supportModalList.innerHTML = html;
  }

  function openPickerModal(replaceIdx) {
    pendingReplaceIdx = typeof replaceIdx === 'number' ? replaceIdx : -1;
    if (pendingReplaceIdx === -1 && selectedSupports.length >= MAX_SUPPORTS) {
      showStatus(t('deck.maxSupports'));
      return;
    }
    filterSearch = '';
    supportSearch.value = '';
    renderModalList();
    updateFilterButtons();
    supportModal.hidden = false;
    supportSearch.focus();
  }

  function closePickerModal() {
    supportModal.hidden = true;
    pendingReplaceIdx = -1;
  }

  function selectFromModal(slug) {
    const card = findSupportBySlug(slug);
    if (!card) return;
    if (selectedSupports.some((s) => s.SupportSlug === card.SupportSlug)) return;

    if (pendingReplaceIdx >= 0 && pendingReplaceIdx < selectedSupports.length) {
      // Swap mode: replace the card at that index, keep same LB
      selectedSupports[pendingReplaceIdx] = card;
    } else {
      if (selectedSupports.length >= MAX_SUPPORTS) return;
      selectedSupports.push(card);
      supportLbStops.push(4); // default MLB
    }

    showStatus('');
    pendingReplaceIdx = -1;
    saveDeck();
    render();
    closePickerModal();
  }

  // Modal event listeners
  supportModal.querySelector('.support-modal-backdrop').addEventListener('click', closePickerModal);
  supportModal.querySelector('.support-modal-close').addEventListener('click', closePickerModal);

  supportSearch.addEventListener('input', () => {
    filterSearch = supportSearch.value;
    renderModalList();
  });

  supportModalList.addEventListener('click', (e) => {
    const item = e.target.closest('.modal-card-item');
    if (!item || item.classList.contains('disabled')) return;
    selectFromModal(item.dataset.slug);
  });

  initFilterButtons();

  // =====================================================================
  // Effects Panel
  // =====================================================================

  function openEffectsPanel(card, lbStop) {
    if (!card) return;
    effectsCard = card;
    effectsLbStop = lbStop ?? 4;
    effectsLevelSlider.max = 4;
    effectsLevelSlider.value = effectsLbStop;
    effectsPanelTitle.textContent = cleanCardName(card.SupportName);
    renderEffects();
    effectsPanel.hidden = false;
  }

  function closeEffectsPanel() {
    effectsPanel.hidden = true;
    effectsCard = null;
  }

  function renderEffects() {
    if (!effectsCard) return;
    effectsLevelLabel.textContent = LB_LABELS[effectsLbStop] || 'MLB';
    const rarity = effectsCard.SupportRarity || 'SSR';
    const idx = lbToEffectIndex(effectsLbStop, rarity);

    const effects = effectsCard.SupportEffects || [];
    if (effects.length === 0) {
      effectsPanelBody.innerHTML = `<div class="modal-card-empty">${t('deck.noEffectData')}</div>`;
      return;
    }

    let html = '';
    for (const eff of effects) {
      const val = eff.values?.[idx] ?? 0;
      const symbol = eff.symbol === 'percent' ? '%' : '';
      const cls = val === 0 ? 'effect-value zero' : 'effect-value';
      html += `<div class="effect-row">
        <span class="effect-name">${escHtml(eff.name)}</span>
        <span class="${cls}">${val}${symbol}</span>
      </div>`;
    }
    effectsPanelBody.innerHTML = html;
  }

  effectsPanel
    .querySelector('.effects-panel-backdrop')
    .addEventListener('click', closeEffectsPanel);
  effectsPanel.querySelector('.effects-panel-close').addEventListener('click', closeEffectsPanel);

  effectsLevelSlider.addEventListener('input', () => {
    effectsLbStop = parseInt(effectsLevelSlider.value, 10);
    renderEffects();
  });

  // =====================================================================
  // Character Picker Modal
  // =====================================================================

  function getFilteredCharacters() {
    const search = charFilterSearch.toLowerCase();
    return characters.filter((c) => {
      if (!matchesServer(c)) return false;
      if (search) {
        const name = (c.UmaName || '').toLowerCase();
        const nick = (c.UmaNickname || '').toLowerCase();
        if (!name.includes(search) && !nick.includes(search)) return false;
      }
      return true;
    });
  }

  function renderCharModalList() {
    const filtered = getFilteredCharacters();
    if (filtered.length === 0) {
      charModalList.innerHTML = `<div class="modal-card-empty">${t('deck.noCharsMatch')}</div>`;
      return;
    }

    let html = '';
    for (const c of filtered) {
      const name = c.UmaName || '';
      const nick = c.UmaNickname || '';
      const isSelected = selectedChar && selectedChar.UmaSlug === c.UmaSlug;
      const cls = isSelected ? 'modal-card-item disabled' : 'modal-card-item';
      const imgSrc = c.UmaImage || '';
      const imgHtml = imgSrc
        ? `<img class="modal-card-thumb" src="${escHtml(imgSrc)}" alt="" loading="lazy">`
        : `<span class="modal-card-initials">${escHtml(initialsOf(name))}</span>`;
      const stars = c.UmaBaseStars ? '\u2605'.repeat(Math.min(c.UmaBaseStars, 5)) : '';

      html += `<div class="${cls}" data-slug="${escHtml(c.UmaSlug)}">
        ${imgHtml}
        <span class="modal-card-name">${escHtml(name)}${nick ? ` <span class="modal-card-nick">(${escHtml(nick)})</span>` : ''}</span>
        <span class="modal-card-rarity char-stars">${stars}</span>
      </div>`;
    }
    charModalList.innerHTML = html;
  }

  function openCharModal() {
    charFilterSearch = '';
    charSearchInput.value = '';
    renderCharModalList();
    charModal.hidden = false;
    charSearchInput.focus();
  }

  function closeCharModal() {
    charModal.hidden = true;
  }

  charModal.querySelector('.support-modal-backdrop').addEventListener('click', closeCharModal);
  charModal.querySelector('.support-modal-close').addEventListener('click', closeCharModal);

  charSearchInput.addEventListener('input', () => {
    charFilterSearch = charSearchInput.value;
    renderCharModalList();
  });

  charModalList.addEventListener('click', (e) => {
    const item = e.target.closest('.modal-card-item');
    if (!item || item.classList.contains('disabled')) return;
    const found = findCharBySlug(item.dataset.slug);
    if (found) {
      selectedChar = found;
      charStarLevel = Math.max(found.UmaBaseStars || 3, 3);
      saveDeck();
      render();
      closeCharModal();
    }
  });

  // =====================================================================
  // Event handlers
  // =====================================================================

  charDisplay.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="remove-char"]')) {
      selectedChar = null;
      saveDeck();
      render();
      return;
    }
    const starBtn = e.target.closest('.star-btn');
    if (starBtn) {
      const lv = parseInt(starBtn.dataset.star, 10);
      if (STAR_LEVELS.includes(lv)) {
        charStarLevel = lv;
        saveDeck();
        render();
      }
      return;
    }
    // Click anywhere on the character card or empty slot opens picker
    if (e.target.closest('.deck-character-card') || e.target.closest('[data-action="open-char-picker"]')) {
      openCharModal();
    }
  });

  supportSlots.addEventListener('click', (e) => {
    // Remove button
    const removeBtn = e.target.closest('.slot-remove');
    if (removeBtn) {
      const idx = parseInt(removeBtn.dataset.idx, 10);
      if (idx >= 0 && idx < selectedSupports.length) {
        selectedSupports.splice(idx, 1);
        supportLbStops.splice(idx, 1);
        saveDeck();
        render();
      }
      return;
    }

    // Swap button -> open picker in replace mode
    const swapBtn = e.target.closest('.slot-swap');
    if (swapBtn) {
      const idx = parseInt(swapBtn.dataset.idx, 10);
      if (idx >= 0 && idx < selectedSupports.length) {
        openPickerModal(idx);
      }
      return;
    }

    // LB button click
    const lbBtn = e.target.closest('.lb-btn');
    if (lbBtn) {
      const idx = parseInt(lbBtn.dataset.idx, 10);
      const lb = parseInt(lbBtn.dataset.lb, 10);
      if (idx >= 0 && idx < selectedSupports.length && lb >= 0 && lb <= 4) {
        supportLbStops[idx] = lb;
        saveDeck();
        render();
      }
      return;
    }

    // Click on filled slot -> open effects panel
    const filledSlot = e.target.closest('.deck-support-slot.filled');
    if (filledSlot) {
      const idx = parseInt(filledSlot.dataset.idx, 10);
      const card = selectedSupports[idx];
      if (card) openEffectsPanel(card, supportLbStops[idx] ?? 4);
      return;
    }

    // Click on empty slot -> open picker
    const emptySlot = e.target.closest('[data-action="open-picker"]');
    if (emptySlot) {
      openPickerModal();
    }
  });

  shareLinkBtn.addEventListener('click', () => {
    const params = new URLSearchParams();
    if (selectedChar) {
      // Use ID if shorter than slug, otherwise slug
      const id = selectedChar.UmaId || '';
      const slug = selectedChar.UmaSlug || '';
      params.set('c', id && id.length < slug.length ? id : slug);
      if (charStarLevel !== 5) params.set('st', String(charStarLevel));
    }
    if (selectedSupports.length) {
      // Use IDs if shorter than slugs
      const ids = selectedSupports.map((s) => s.SupportId || s.SupportSlug);
      const slugs = selectedSupports.map((s) => s.SupportSlug);
      const idsStr = ids.join(',');
      const slugsStr = slugs.join(',');
      params.set('s', idsStr.length < slugsStr.length ? idsStr : slugsStr);
      // Only include LBs if any differ from MLB
      const lbs = supportLbStops.slice(0, selectedSupports.length);
      if (lbs.some((lb) => lb !== 4)) {
        params.set('lb', lbs.join(','));
      }
    }
    const url = `${location.origin}${location.pathname}?${params.toString()}`;
    navigator.clipboard.writeText(url).then(
      () => showStatus(t('common.copied')),
      () => showStatus(t('deck.copyLinkFailed')),
    );
    setTimeout(() => showStatus(''), 2000);
  });

  clearAllBtn.addEventListener('click', () => {
    selectedChar = null;
    charStarLevel = 5;
    selectedSupports = [];
    supportLbStops = [];
    saveDeck();
    render();
    showStatus('');
    if (location.search) {
      history.replaceState(null, '', location.pathname);
    }
  });

  // Close modals on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!effectsPanel.hidden) closeEffectsPanel();
      else if (!savedDecksModal.hidden) closeSavedDecksModal();
      else if (!supportModal.hidden) closePickerModal();
      else if (!charModal.hidden) closeCharModal();
    }
  });

  // =====================================================================
  // Server change listener
  // =====================================================================

  window.addEventListener('umatools:server-change', (e) => {
    const next = e?.detail?.server === 'jp' ? 'jp' : 'en';
    if (next === currentServer) return;
    currentServer = next;
    render();
    if (!supportModal.hidden) renderModalList();
    if (!charModal.hidden) renderCharModalList();
  });

  // --- Init ---
  currentServer = readServerPref();
  const loadedFromUrl = loadFromUrl();
  if (!loadedFromUrl) {
    loadDeck();
  }
  render();
})();

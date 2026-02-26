(function (global) {
  'use strict';

  // ── Constants ──
  var SKILLS_URLS = ['/assets/skills_all.json', './assets/skills_all.json'];
  var HINTS_URLS = ['/assets/support_hints.json', './assets/support_hints.json'];

  var EFFECT_LABELS = {
    1: 'Speed',
    2: 'Stamina',
    3: 'Power',
    4: 'Guts',
    5: 'Wisdom',
    6: 'Running Style',
    8: 'Field of View',
    9: 'Stamina Recovery',
    10: 'Lane Change Speed',
    13: 'Position Awareness',
    14: 'Pace Control',
    21: 'Target Speed',
    22: 'Target Speed',
    27: 'Target Speed',
    28: 'Acceleration',
    29: 'Deceleration Block',
    31: 'Acceleration',
    32: 'Special',
    35: 'Special',
    37: 'Special',
    38: 'Special',
    41: 'Special',
    42: 'Special',
    501: 'Stat Boost',
    502: 'Stat Boost',
    503: 'Stat Boost',
  };

  // Effect types where value represents HP (not divided by 10000)
  var HP_EFFECT_TYPES = { 9: true };

  var RARITY_LABELS = {
    1: 'Normal',
    2: 'Rare',
    3: 'SR',
    4: 'SSR',
    5: 'Unique / Gold',
    6: 'Common',
  };

  var UMA_URLS = ['/assets/uma_data.json', './assets/uma_data.json'];

  // ── State ──
  var skillsById = null;
  var skillsByName = null;
  var cardById = null; // Map<string_id, {name, rarity, image, server, type}>
  var umaById = null; // Map<string_id, {name, nickname, server}>
  var loadPromise = null;
  var popupEl = null;
  var backdropEl = null;
  var isOpen = false;

  // ── Helpers ──
  function normalize(str) {
    return (str || '').toString().trim().toLowerCase();
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function getLanguage() {
    try {
      return (localStorage.getItem('umatoolsServer') || '').trim().toLowerCase() === 'jp'
        ? 'jp'
        : 'en';
    } catch (e) {
      return 'en';
    }
  }

  function t(key) {
    return typeof global.t === 'function' ? global.t(key) : key;
  }

  // ── Data Loading ──
  function fetchFirst(urls, opts) {
    var i = 0;
    function tryNext() {
      if (i >= urls.length) return Promise.reject(new Error('all URLs failed'));
      var url = urls[i++];
      return fetch(url, opts)
        .then(function (res) {
          if (!res.ok) return tryNext();
          return res.json();
        })
        .catch(function () {
          return tryNext();
        });
    }
    return tryNext();
  }

  function loadData() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([loadSkills(), loadHints(), loadUma()]).then(function () {
      // If skills failed to load, allow retry on next attempt
      if (!skillsById) loadPromise = null;
    });
    return loadPromise;
  }

  function loadSkills() {
    if (global.__skillsAllData) {
      buildSkillMaps(global.__skillsAllData);
      return Promise.resolve();
    }
    return fetchFirst(SKILLS_URLS, { cache: 'force-cache' })
      .then(function (data) {
        if (!Array.isArray(data)) return;
        global.__skillsAllData = data;
        buildSkillMaps(data);
      })
      .catch(function () {
        /* silent */
      });
  }

  function buildSkillMaps(data) {
    skillsById = new Map();
    skillsByName = new Map();

    data.forEach(function (skill) {
      if (skill.id != null) {
        skillsById.set(String(skill.id), skill);
      }

      // Index by all name variants
      indexName(skill.name_en, skill);
      indexName(skill.enname, skill);
      indexName(skill.jpname, skill);
      indexName(skill.name_ko, skill);
      indexName(skill.name_tw, skill);

      // Index gene_version too
      if (skill.gene_version) {
        var gv = skill.gene_version;
        if (gv.id != null) skillsById.set(String(gv.id), gv);
        indexName(gv.name_en, gv);
        indexName(gv.enname, gv);
        indexName(gv.jpname, gv);
        indexName(gv.name_ko, gv);
        indexName(gv.name_tw, gv);
      }
    });
  }

  function indexName(name, skill) {
    var key = normalize(name);
    if (key && !skillsByName.has(key)) {
      skillsByName.set(key, skill);
    }
  }

  function loadHints() {
    return fetchFirst(HINTS_URLS, { cache: 'force-cache' })
      .then(function (cards) {
        if (!Array.isArray(cards)) return;
        cardById = new Map();
        cards.forEach(function (card) {
          if (!card.SupportId) return;
          cardById.set(String(card.SupportId), {
            name: card.SupportName || '',
            rarity: card.SupportRarity || '',
            image: card.SupportImage || '',
            server: card.SupportServer || '',
            type: card.SupportType || '',
          });
        });
      })
      .catch(function () {
        /* silent */
      });
  }

  function loadUma() {
    return fetchFirst(UMA_URLS, { cache: 'force-cache' })
      .then(function (chars) {
        if (!Array.isArray(chars)) return;
        umaById = new Map();
        chars.forEach(function (u) {
          if (!u.UmaId) return;
          umaById.set(String(u.UmaId), {
            name: u.UmaName || '',
            nickname: u.UmaNickname || '',
            server: u.UmaServer || '',
            image: u.UmaImage || '',
          });
        });
      })
      .catch(function () {
        /* silent */
      });
  }

  // Resolve card IDs from skill's sup_hint/sup_e arrays into card objects
  function getCardsForSkill(skill, serverPref) {
    if (!cardById) return { hintCards: [], eventCards: [] };
    var hintIds = flattenIdArrays(skill.sup_hint);
    var eventIds = flattenIdArrays(skill.sup_e);
    return {
      hintCards: resolveCards(hintIds, serverPref),
      eventCards: resolveCards(eventIds, serverPref),
    };
  }

  function flattenIdArrays(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [];
    arr.forEach(function (sub) {
      if (Array.isArray(sub)) {
        sub.forEach(function (id) {
          out.push(String(id));
        });
      }
    });
    return out;
  }

  function resolveCards(ids, serverPref) {
    var seen = new Set();
    var result = [];
    ids.forEach(function (id) {
      if (seen.has(id)) return;
      seen.add(id);
      var card = cardById.get(id);
      if (!card) return;
      // Filter by server: EN shows only global; JP shows all
      if (serverPref !== 'jp' && card.server && card.server !== 'global') return;
      result.push(card);
    });
    return result;
  }

  function resolveCharacters(charIds, serverPref) {
    if (!umaById || !Array.isArray(charIds)) return [];
    var seen = new Set();
    var result = [];
    charIds.forEach(function (id) {
      var key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
      var uma = umaById.get(key);
      if (!uma) return;
      if (serverPref !== 'jp' && uma.server && uma.server !== 'global') return;
      result.push(uma);
    });
    return result;
  }

  // ── Skill Lookup ──
  function findSkill(nameOrId) {
    if (!skillsById || !skillsByName) return null;
    // Try by ID first
    var byId = skillsById.get(String(nameOrId));
    if (byId) return byId;
    // Try by normalized name
    var key = normalize(nameOrId);
    // Direct match
    var found = skillsByName.get(key);
    if (found) return found;
    // Try stripping circle symbols for lookup
    var stripped = key.replace(/[\u25ce\u25cb\u25a0\u25a1\u25c9\u25ef]/g, '').trim();
    if (stripped !== key) return skillsByName.get(stripped) || null;
    return null;
  }

  // ── Popup Content ──
  // Strip trailing rarity tag like " (SSR)" from card name if rarity is shown separately
  var RARITY_SUFFIX_RE = /\s*\((SSR|SR|R)\)\s*$/i;

  function renderCardRow(c) {
    var row = '<div class="sp-card-row">';
    if (c.image) {
      row += '<img class="sp-card-thumb" src="' + escapeHtml(c.image) + '" alt="" loading="lazy">';
    }
    var displayName = c.rarity ? c.name.replace(RARITY_SUFFIX_RE, '') : c.name;
    row += '<span class="sp-card-name">' + escapeHtml(displayName) + '</span>';
    if (c.rarity) {
      row += '<span class="sp-card-rarity">' + escapeHtml(c.rarity) + '</span>';
    }
    row += '</div>';
    return row;
  }

  function renderCharRow(u) {
    var row = '<div class="sp-card-row">';
    if (u.image) {
      row += '<img class="sp-card-thumb" src="' + escapeHtml(u.image) + '" alt="" loading="lazy">';
    }
    var label = u.nickname ? u.name + ' (' + u.nickname + ')' : u.name;
    row += '<span class="sp-card-name">' + escapeHtml(label) + '</span>';
    row += '</div>';
    return row;
  }

  function buildPopupHTML(skill, rawName) {
    var lang = getLanguage();

    // Name resolution
    var displayName =
      lang === 'jp'
        ? skill.jpname || skill.name_en || skill.enname || rawName
        : skill.name_en || skill.enname || skill.jpname || rawName;
    var altName = lang === 'jp' ? skill.name_en || skill.enname || '' : skill.jpname || '';

    // Description
    var desc =
      lang === 'jp'
        ? skill.jpdesc || skill.desc_en || skill.endesc || ''
        : skill.desc_en || skill.endesc || skill.jpdesc || '';

    var rarity = skill.rarity;
    var cost = typeof skill.cost === 'number' ? skill.cost : null;
    var skillId = skill.id != null ? String(skill.id) : null;

    var html = '';

    // ── Header ──
    html += '<div class="sp-header">';
    html += '<span class="sp-title">' + escapeHtml(displayName) + '</span>';
    html +=
      '<button class="sp-close" aria-label="' +
      escapeHtml(t('common.close')) +
      '">&times;</button>';
    html += '</div>';

    html += '<div class="sp-body">';

    // ── Alt name ──
    if (altName && normalize(altName) !== normalize(displayName)) {
      html +=
        '<div class="sp-section"><div class="sp-label">' +
        escapeHtml(lang === 'jp' ? t('skillPopup.english') : t('skillPopup.japanese')) +
        '</div><div class="sp-desc">' +
        escapeHtml(altName) +
        '</div></div>';
    }

    // ── Meta (rarity + cost) ──
    if (rarity != null || cost != null) {
      html += '<div class="sp-section"><div class="sp-meta">';
      if (rarity != null) {
        html +=
          '<span class="sp-meta-item">' +
          escapeHtml(RARITY_LABELS[rarity] || 'Rarity ' + rarity) +
          '</span>';
      }
      if (cost != null) {
        html +=
          '<span class="sp-meta-item">' +
          escapeHtml(t('skillPopup.cost')) +
          ': ' +
          cost +
          ' SP</span>';
      }
      html += '</div></div>';
    }

    // ── Description ──
    if (desc) {
      html +=
        '<div class="sp-section"><div class="sp-label">' +
        escapeHtml(t('skillPopup.description')) +
        '</div>';
      html += '<div class="sp-desc">' + escapeHtml(desc) + '</div></div>';
    }

    // ── Effects / activation conditions ──
    var condGroups = skill.condition_groups || [];
    if (condGroups.length) {
      var effectItems = [];
      condGroups.forEach(function (cg) {
        (cg.effects || []).forEach(function (eff) {
          var label = EFFECT_LABELS[eff.type] || 'Effect ' + eff.type;
          var val = '';
          if (eff.value != null && eff.value !== 0) {
            if (HP_EFFECT_TYPES[eff.type]) {
              val = ' (' + eff.value + ')';
            } else {
              var scaled = eff.value / 10000;
              val = ' (' + (scaled >= 0 ? '+' : '') + scaled + ')';
            }
          }
          effectItems.push(escapeHtml(label + val));
        });
      });
      if (effectItems.length) {
        html +=
          '<div class="sp-section"><div class="sp-label">' +
          escapeHtml(t('skillPopup.effects')) +
          '</div>';
        html += '<ul class="sp-effects-list">';
        effectItems.forEach(function (item) {
          html += '<li>' + item + '</li>';
        });
        html += '</ul></div>';
      }

      // Duration
      var baseTime = condGroups[0].base_time;
      if (baseTime > 0) {
        var secs = (baseTime / 10000).toFixed(1);
        html += '<div class="sp-section"><div class="sp-meta">';
        html +=
          '<span class="sp-meta-item">' +
          escapeHtml(t('skillPopup.duration')) +
          ': ' +
          secs +
          's</span>';
        html += '</div></div>';
      }
    }

    // ── Support cards (hints + events) ──
    if (cardById) {
      var serverPref = getLanguage() === 'jp' ? 'jp' : 'global';
      var resolved = getCardsForSkill(skill, serverPref);
      var totalCards = resolved.hintCards.length + resolved.eventCards.length;

      if (totalCards) {
        html +=
          '<div class="sp-section"><div class="sp-label">' +
          escapeHtml(t('skillPopup.availableFrom')) +
          ' (' +
          totalCards +
          ')</div>';
        html += '<div class="sp-cards-list">';
        if (resolved.hintCards.length) {
          html +=
            '<div class="sp-card-group-label">' + escapeHtml(t('skillPopup.hints')) + '</div>';
          resolved.hintCards.forEach(function (c) {
            html += renderCardRow(c);
          });
        }
        if (resolved.eventCards.length) {
          html +=
            '<div class="sp-card-group-label">' + escapeHtml(t('skillPopup.events')) + '</div>';
          resolved.eventCards.forEach(function (c) {
            html += renderCardRow(c);
          });
        }
        html += '</div></div>';
      } else {
        html +=
          '<div class="sp-section"><div class="sp-label">' +
          escapeHtml(t('skillPopup.availableFrom')) +
          '</div>';
        html += '<div class="sp-empty">' + escapeHtml(t('skillPopup.noCards')) + '</div></div>';
      }
    }

    // ── Characters ──
    if (umaById) {
      var serverPref2 = getLanguage() === 'jp' ? 'jp' : 'global';
      var potentialChars = resolveCharacters(skill.char, serverPref2);
      var eventChars = resolveCharacters(skill.char_e, serverPref2);
      var totalChars = potentialChars.length + eventChars.length;

      if (totalChars) {
        html +=
          '<div class="sp-section"><div class="sp-label">' +
          escapeHtml(t('skillPopup.characters')) +
          ' (' +
          totalChars +
          ')</div>';
        html += '<div class="sp-chars-list">';
        if (potentialChars.length) {
          html +=
            '<div class="sp-card-group-label">' + escapeHtml(t('skillPopup.potential')) + '</div>';
          potentialChars.forEach(function (u) {
            html += renderCharRow(u);
          });
        }
        if (eventChars.length) {
          html +=
            '<div class="sp-card-group-label">' + escapeHtml(t('skillPopup.charEvents')) + '</div>';
          eventChars.forEach(function (u) {
            html += renderCharRow(u);
          });
        }
        html += '</div></div>';
      }
    }

    html += '</div>'; // .sp-body
    return html;
  }

  // ── Positioning ──
  function positionPopup(popup, anchor) {
    var rect = anchor.getBoundingClientRect();
    var scrollX = global.pageXOffset || document.documentElement.scrollLeft;
    var scrollY = global.pageYOffset || document.documentElement.scrollTop;
    var vpW = global.innerWidth;
    var vpH = global.innerHeight;

    // Mobile: CSS handles fixed bottom-sheet
    if (vpW <= 480) {
      popup.style.position = 'fixed';
      popup.style.left = '0';
      popup.style.right = '0';
      popup.style.bottom = '0';
      popup.style.top = 'auto';
      return;
    }

    popup.style.position = 'absolute';

    // Default: below the anchor, left-aligned
    var top = rect.bottom + scrollY + 6;
    var left = rect.left + scrollX;

    // Measure popup after render
    var pw = popup.offsetWidth;
    var ph = popup.offsetHeight;

    // Flip up if not enough space below
    if (rect.bottom + ph + 12 > vpH) {
      top = rect.top + scrollY - ph - 6;
    }

    // Shift left if overflowing right
    if (left + pw > vpW + scrollX - 12) {
      left = vpW + scrollX - pw - 12;
    }

    // Clamp left
    if (left < scrollX + 4) left = scrollX + 4;

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
  }

  // ── Open / Close ──
  function openPopup(skillName, anchorEl) {
    closePopup();

    loadData().then(function () {
      var skill = findSkill(skillName);
      if (!skill) return;

      // Create backdrop
      backdropEl = document.createElement('div');
      backdropEl.className = 'skill-popup-backdrop';
      backdropEl.addEventListener('click', closePopup);

      // Create popup
      popupEl = document.createElement('div');
      popupEl.className = 'skill-popup';
      popupEl.setAttribute('role', 'dialog');
      popupEl.setAttribute('aria-modal', 'false');
      popupEl.setAttribute('aria-label', skillName + ' details');
      popupEl.innerHTML = buildPopupHTML(skill, skillName);

      document.body.appendChild(backdropEl);
      document.body.appendChild(popupEl);

      // Close button handler
      var closeBtn = popupEl.querySelector('.sp-close');
      if (closeBtn) closeBtn.addEventListener('click', closePopup);

      // Position
      positionPopup(popupEl, anchorEl);

      isOpen = true;

      // Focus for keyboard users
      popupEl.setAttribute('tabindex', '-1');
      popupEl.focus({ preventScroll: true });
    });
  }

  function closePopup() {
    if (popupEl && popupEl.parentNode) popupEl.parentNode.removeChild(popupEl);
    if (backdropEl && backdropEl.parentNode) backdropEl.parentNode.removeChild(backdropEl);
    popupEl = null;
    backdropEl = null;
    isOpen = false;
  }

  // ── Event Delegation ──
  function handleClick(e) {
    var target = e.target.closest('[data-skill-name]');
    if (!target) return;

    // Don't interfere with other interactive elements
    if (e.target.closest('input, button, th[data-sort], .ocr-skill-checkbox, .ocr-edit-icon'))
      return;

    e.preventDefault();
    e.stopPropagation();

    var skillName = target.getAttribute('data-skill-name');
    if (skillName) openPopup(skillName, target);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && isOpen) {
      closePopup();
      return;
    }
    if (
      (e.key === 'Enter' || e.key === ' ') &&
      e.target &&
      e.target.hasAttribute &&
      e.target.hasAttribute('data-skill-name')
    ) {
      e.preventDefault();
      var skillName = e.target.getAttribute('data-skill-name');
      if (skillName) openPopup(skillName, e.target);
    }
  }

  // ── Init ──
  function init() {
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeydown);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Public API
  global.SkillPopup = {
    open: openPopup,
    close: closePopup,
    findSkill: function (name) {
      return loadData().then(function () {
        return findSkill(name);
      });
    },
    preload: loadData,
  };
})(window);

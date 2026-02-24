(function () {
  'use strict';

  var SERVER_PREF_KEY = 'umatoolsServer';
  var PREFERRED_ORDER = ['golden', 'yellow', 'blue', 'green', 'red', 'purple', 'evo', 'ius'];
  var CATEGORY_LABELS = {
    golden: 'Gold', gold: 'Gold', yellow: 'Yellow', blue: 'Blue',
    green: 'Green', red: 'Red', purple: 'Purple', evo: 'Evo',
    ius: 'Unique', orange: 'Unique',
  };
  var CATEGORY_CSS = {
    golden: 'cat-golden', gold: 'cat-gold', yellow: 'cat-yellow',
    blue: 'cat-blue', green: 'cat-green', red: 'cat-red',
    purple: 'cat-purple', evo: 'cat-evo', ius: 'cat-ius', orange: 'cat-orange',
  };

  // ── State ──
  var allSkills = [];
  var filteredSkills = [];
  var categories = [];
  var activeCategory = 'all';
  var searchQuery = '';
  var sortCol = 'efficiency';
  var sortDir = 'desc';
  var costMap = new Map();           // normalized name -> cost
  var officialEnglishNameSet = new Set();
  var officialSkillIds = new Set();  // IDs of skills with name_en (officially translated)
  var jpNameToId = new Map();        // normalized jpname -> skill ID string
  var skillCostById = new Map();     // skill ID string -> cost
  var skillLowerIdById = new Map();  // skill ID string -> lower skill ID string (versions[0])
  var skillMetaByName = new Map();   // normalized name -> { cost, id, lowerId }

  // ── DOM refs ──
  var searchInput = null;
  var filtersEl = null;
  var countEl = null;
  var tableWrap = null;
  var loadingEl = null;

  // ── Helpers ──
  function normalize(str) {
    return (str || '').toString().trim().toLowerCase();
  }

  function normalizeCostKey(str) {
    return normalize(str).replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  function t(key, vars) {
    return typeof window.t === 'function' ? window.t(key, vars) : key;
  }

  function getSkillLanguage() {
    try {
      return (localStorage.getItem(SERVER_PREF_KEY) || '').trim().toLowerCase() === 'jp' ? 'jp' : 'en';
    } catch (_) {
      return 'en';
    }
  }

  function debounce(fn, ms) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  // ── CSV Parser (same as optimizer.js) ──
  function parseCSV(text) {
    var rows = [];
    var i = 0, field = '', row = [], inQuotes = false;
    while (i < text.length) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\r') { /* skip */ }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
      }
      i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function normalizeOfficialName(name) {
    return normalize(name).replace(/\s+/g, ' ');
  }

  // ── Load JSON cost data + build official EN name set ──
  async function loadCostJSON() {
    var urls = ['/assets/skills_all.json', './assets/skills_all.json'];
    for (var u = 0; u < urls.length; u++) {
      try {
        var res = await fetch(urls[u], { cache: 'force-cache' });
        if (!res.ok) continue;
        var list = await res.json();
        if (!Array.isArray(list) || !list.length) continue;
        var nextOfficialNames = new Set();
        var nextOfficialIds = new Set();
        var nextJpNameToId = new Map();
        list.forEach(function (entry) {
          // Collect official EN names and IDs for filtering
          var officialName = (entry && entry.name_en || '').trim();
          var geneOfficialName = (entry && entry.gene_version && entry.gene_version.name_en || '').trim();
          if (officialName) nextOfficialNames.add(normalizeOfficialName(officialName));
          if (geneOfficialName) nextOfficialNames.add(normalizeOfficialName(geneOfficialName));

          var id = entry && entry.id;
          // Track official skill IDs
          if (officialName && id != null) nextOfficialIds.add(String(id));
          if (geneOfficialName && entry.gene_version && entry.gene_version.id != null)
            nextOfficialIds.add(String(entry.gene_version.id));

          // Map JP names to skill IDs for accurate identification
          var jpName = (entry && entry.jpname || '').trim();
          if (jpName && id != null) nextJpNameToId.set(normalize(jpName), String(id));
          if (entry && entry.gene_version) {
            var geneJpName = (entry.gene_version.jpname || '').trim();
            var geneId = entry.gene_version.id;
            if (geneJpName && geneId != null) nextJpNameToId.set(normalize(geneJpName), String(geneId));
          }

          var cost = null;
          if (entry && entry.gene_version && typeof entry.gene_version.cost === 'number')
            cost = entry.gene_version.cost;
          else if (entry && typeof entry.cost === 'number')
            cost = entry.cost;

          var versions = entry && Array.isArray(entry.versions) ? entry.versions : [];
          var lowerId = versions.length ? String(versions[0]) : null;

          // Build ID-based lookups for gold->lower cost linking
          if (id != null && cost !== null) {
            skillCostById.set(String(id), cost);
          }
          if (id != null && lowerId) {
            skillLowerIdById.set(String(id), lowerId);
          }

          if (cost === null) return;
          var names = [];
          [entry.name_en, entry.enname, entry.jpname, entry.name].forEach(function (v) {
            var trimmed = (v || '').trim();
            if (trimmed && names.indexOf(trimmed) === -1) names.push(trimmed);
          });
          if (entry.gene_version) {
            [entry.gene_version.name_en, entry.gene_version.enname, entry.gene_version.jpname, entry.gene_version.name].forEach(function (v) {
              var trimmed = (v || '').trim();
              if (trimmed && names.indexOf(trimmed) === -1) names.push(trimmed);
            });
          }
          var meta = { cost: cost, id: id != null ? String(id) : null, lowerId: lowerId };
          names.forEach(function (n) {
            var exact = normalize(n);
            var loose = normalizeCostKey(n);
            if (exact && !costMap.has(exact)) costMap.set(exact, cost);
            if (loose && !costMap.has(loose)) costMap.set(loose, cost);
            if (exact && !skillMetaByName.has(exact)) skillMetaByName.set(exact, meta);
            if (loose && !skillMetaByName.has(loose)) skillMetaByName.set(loose, meta);
          });
        });
        officialEnglishNameSet = nextOfficialNames;
        officialSkillIds = nextOfficialIds;
        jpNameToId = nextJpNameToId;
        return true;
      } catch (_) { /* try next */ }
    }
    return false;
  }

  // ── Load CSV skills ──
  async function loadSkillsCSV() {
    var lang = getSkillLanguage();
    var candidates = lang === 'jp'
      ? ['/assets/uma_skills_jp.csv', './assets/uma_skills_jp.csv', '/assets/uma_skills.csv']
      : ['/assets/uma_skills_en.csv', './assets/uma_skills_en.csv', '/assets/uma_skills.csv', './assets/uma_skills.csv'];
    for (var c = 0; c < candidates.length; c++) {
      try {
        var res = await fetch(candidates[c], { cache: 'force-cache' });
        if (!res.ok) continue;
        var text = await res.text();
        if (loadFromCSV(text)) return true;
      } catch (_) { /* try next */ }
    }
    return false;
  }

  // Look up skill meta using name, alias, and localized_name from CSV
  function resolveSkillMeta(name, cols, idx) {
    var meta = skillMetaByName.get(normalize(name)) || skillMetaByName.get(normalizeCostKey(name));
    if (!meta && idx.alias !== -1) {
      var aliases = (cols[idx.alias] || '').split('|');
      for (var a = 0; a < aliases.length && !meta; a++) {
        var al = aliases[a].trim();
        if (al) meta = skillMetaByName.get(normalize(al)) || skillMetaByName.get(normalizeCostKey(al));
      }
    }
    if (!meta && idx.localized !== -1) {
      var loc = (cols[idx.localized] || '').trim();
      if (loc) meta = skillMetaByName.get(normalize(loc)) || skillMetaByName.get(normalizeCostKey(loc));
    }
    return meta || null;
  }

  function loadFromCSV(csvText) {
    var rows = parseCSV(csvText);
    if (!rows.length) return false;
    var header = rows[0].map(function (h) { return (h || '').toString().trim().toLowerCase(); });
    var idx = {
      type: header.indexOf('skill_type'),
      name: header.indexOf('name'),
      alias: header.indexOf('alias_name'),
      localized: header.indexOf('localized_name'),
      base: header.indexOf('base_value'),
      baseCost: header.indexOf('base'),
      sa: header.indexOf('s_a'),
      apt1: header.indexOf('apt_1'),
      check: header.indexOf('affinity_role'),
    };
    if (idx.name === -1) return false;

    // When server is EN, filter to official English names only
    var filterByOfficialEN = getSkillLanguage() === 'en' && officialEnglishNameSet.size > 0;

    var skills = [];
    var catSet = new Set();

    for (var r = 1; r < rows.length; r++) {
      var cols = rows[r];
      if (!cols || !cols.length) continue;
      var name = (cols[idx.name] || '').trim();
      if (!name) continue;

      // Filter to officially translated skills when server=EN
      if (filterByOfficialEN) {
        var jpAlias = idx.alias !== -1 ? (cols[idx.alias] || '').trim() : '';
        if (jpAlias) {
          // Use JP name to identify the exact skill and check if it's officially translated
          var resolvedId = jpNameToId.get(normalize(jpAlias));
          if (!resolvedId || !officialSkillIds.has(resolvedId)) continue;
        } else {
          // No JP alias available, fall back to name-based check
          if (!officialEnglishNameSet.has(normalizeOfficialName(name))) continue;
        }
      }

      var type = idx.type !== -1 ? (cols[idx.type] || '').trim().toLowerCase() : 'misc';
      var baseCostCSV = idx.baseCost !== -1 ? parseInt(cols[idx.baseCost] || '', 10) : NaN;
      var baseValue = idx.base !== -1 ? parseInt(cols[idx.base] || '', 10) : NaN;
      var sa = idx.sa !== -1 ? parseInt(cols[idx.sa] || '', 10) : NaN;
      var apt1 = idx.apt1 !== -1 ? parseInt(cols[idx.apt1] || '', 10) : NaN;

      // Resolve score: prefer S_A (best affinity), fallback to base_value, then apt_1
      var baseBucket = !isNaN(baseValue) ? baseValue : !isNaN(baseCostCSV) ? baseCostCSV : NaN;
      var score = !isNaN(sa) ? sa : !isNaN(apt1) ? apt1 : baseBucket;
      if (isNaN(score)) score = 0;

      var isUnique = type === 'ius' || type.indexOf('ius') !== -1;
      var isGold = type === 'golden' || type === 'gold';

      // Unique skills always cost 180
      var cost;
      if (isUnique) {
        cost = 180;
      } else {
        // Resolve cost: JSON lookup first, then CSV base column
        var costFromJSON = costMap.get(normalize(name)) || costMap.get(normalizeCostKey(name));
        if (!costFromJSON && idx.alias !== -1) {
          var aliases = (cols[idx.alias] || '').split('|');
          for (var a = 0; a < aliases.length && !costFromJSON; a++) {
            var al = aliases[a].trim();
            if (al) costFromJSON = costMap.get(normalize(al)) || costMap.get(normalizeCostKey(al));
          }
        }
        if (!costFromJSON && idx.localized !== -1) {
          var loc = (cols[idx.localized] || '').trim();
          if (loc) costFromJSON = costMap.get(normalize(loc)) || costMap.get(normalizeCostKey(loc));
        }
        cost = costFromJSON || (!isNaN(baseCostCSV) ? baseCostCSV : undefined);
      }

      // Gold skills: add prerequisite lower skill cost for true total cost
      if (isGold && cost != null) {
        var goldMeta = resolveSkillMeta(name, cols, idx);
        if (goldMeta && goldMeta.lowerId) {
          var lc = skillCostById.get(goldMeta.lowerId);
          if (typeof lc === 'number') cost += lc;
        }
      }

      // Circle ◎ skills: add ○ base skill cost for true total cost
      var isCircleUpgrade = name.indexOf(' \u25ce') !== -1 || name.indexOf('\u25ce') !== -1;
      if (isCircleUpgrade && cost != null) {
        var circleMeta = resolveSkillMeta(name, cols, idx);
        if (circleMeta && circleMeta.lowerId) {
          var clc = skillCostById.get(circleMeta.lowerId);
          if (typeof clc === 'number') cost += clc;
        }
      }

      var checkType = idx.check !== -1 ? (cols[idx.check] || '').trim() : '';

      catSet.add(type);
      skills.push({
        name: name,
        category: type,
        cost: cost,
        score: score,
        efficiency: cost && cost > 0 ? score / cost : 0,
        checkType: checkType,
      });
    }

    allSkills = skills;
    categories = Array.from(catSet).sort(function (a, b) {
      var ia = PREFERRED_ORDER.indexOf(a), ib = PREFERRED_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.localeCompare(b);
    });
    return true;
  }

  // ── Filter & Sort ──
  function applyFilterAndSort() {
    var query = normalize(searchQuery);
    filteredSkills = allSkills.filter(function (s) {
      if (activeCategory !== 'all' && s.category !== activeCategory) return false;
      if (query && normalize(s.name).indexOf(query) === -1) return false;
      return true;
    });
    filteredSkills.sort(function (a, b) {
      var va, vb;
      switch (sortCol) {
        case 'name': va = a.name.toLowerCase(); vb = b.name.toLowerCase();
          return sortDir === 'asc' ? (va < vb ? -1 : va > vb ? 1 : 0) : (vb < va ? -1 : vb > va ? 1 : 0);
        case 'type': va = a.category; vb = b.category;
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'cost': va = a.cost || 0; vb = b.cost || 0;
          return sortDir === 'asc' ? va - vb : vb - va;
        case 'score': va = a.score; vb = b.score;
          return sortDir === 'asc' ? va - vb : vb - va;
        case 'efficiency': va = a.efficiency; vb = b.efficiency;
          return sortDir === 'asc' ? va - vb : vb - va;
        default: return 0;
      }
    });
  }

  // ── Render ──
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderFilters() {
    if (!filtersEl) return;
    var html = '<button class="skills-filter-btn' + (activeCategory === 'all' ? ' active' : '') +
      '" data-cat="all">' + t('skills.allTypes') + '</button>';
    categories.forEach(function (cat) {
      var label = CATEGORY_LABELS[cat] || cat;
      html += '<button class="skills-filter-btn' + (activeCategory === cat ? ' active' : '') +
        '" data-cat="' + cat + '">' + escapeHtml(label) + '</button>';
    });
    filtersEl.innerHTML = html;
  }

  function renderTable() {
    if (!tableWrap) return;
    if (loadingEl) loadingEl.style.display = 'none';

    var cols = [
      { key: 'name', label: t('skills.name'), cls: 'col-name' },
      { key: 'type', label: t('skills.type'), cls: 'col-type' },
      { key: 'cost', label: t('skills.cost'), cls: 'col-cost' },
      { key: 'score', label: t('skills.score'), cls: 'col-score' },
      { key: 'efficiency', label: t('skills.efficiency'), cls: 'col-eff' },
    ];

    if (!filteredSkills.length) {
      tableWrap.innerHTML = '<div class="skills-empty">' + t('skills.noResults') + '</div>';
      if (countEl) countEl.textContent = t('skills.skillCount', { count: 0 });
      return;
    }

    var html = '<table class="skills-table"><thead><tr>';
    cols.forEach(function (col) {
      var sortCls = '';
      if (sortCol === col.key) sortCls = sortDir === 'asc' ? ' sorted-asc' : ' sorted-desc';
      html += '<th class="' + col.cls + sortCls + '" data-sort="' + col.key + '">' + escapeHtml(col.label) + '</th>';
    });
    html += '</tr></thead><tbody>';

    filteredSkills.forEach(function (skill) {
      var catCls = CATEGORY_CSS[skill.category] || '';
      var catLabel = CATEGORY_LABELS[skill.category] || skill.category;
      var costStr = skill.cost != null ? String(skill.cost) : '\u2014';
      var effStr = skill.efficiency > 0 ? skill.efficiency.toFixed(2) : '\u2014';
      var effCls = skill.efficiency >= 2 ? 'eff-high' : skill.efficiency >= 1 ? 'eff-mid' : 'eff-low';

      html += '<tr>' +
        '<td class="col-name">' + escapeHtml(skill.name) + '</td>' +
        '<td class="col-type"><span class="skill-cat-pill ' + catCls + '">' + escapeHtml(catLabel) + '</span></td>' +
        '<td class="col-cost">' + costStr + '</td>' +
        '<td class="col-score">' + skill.score + '</td>' +
        '<td class="col-eff ' + effCls + '">' + effStr + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    tableWrap.innerHTML = html;

    if (countEl) countEl.textContent = t('skills.skillCount', { count: filteredSkills.length });
  }

  function refresh() {
    applyFilterAndSort();
    renderTable();
  }

  // ── Event Handlers ──
  function onSearch() {
    searchQuery = searchInput ? searchInput.value : '';
    refresh();
  }

  function onFilterClick(e) {
    var btn = e.target.closest('.skills-filter-btn');
    if (!btn) return;
    activeCategory = btn.getAttribute('data-cat') || 'all';
    renderFilters();
    refresh();
  }

  function onHeaderClick(e) {
    var th = e.target.closest('th[data-sort]');
    if (!th) return;
    var col = th.getAttribute('data-sort');
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = col === 'name' || col === 'type' ? 'asc' : 'desc';
    }
    refresh();
  }

  // ── Init ──
  async function init() {
    searchInput = document.getElementById('skillSearch');
    filtersEl = document.getElementById('skillFilters');
    countEl = document.getElementById('skillCount');
    tableWrap = document.getElementById('skillTableWrap');
    loadingEl = document.getElementById('skillLoading');

    if (searchInput) {
      searchInput.addEventListener('input', debounce(onSearch, 150));
    }
    if (filtersEl) {
      filtersEl.addEventListener('click', onFilterClick);
    }
    if (tableWrap) {
      tableWrap.addEventListener('click', onHeaderClick);
    }

    // Load data
    await loadCostJSON();
    await loadSkillsCSV();

    renderFilters();
    sortCol = 'efficiency';
    sortDir = 'desc';
    refresh();

    // React to server changes
    window.addEventListener('umatools:server-change', async function () {
      costMap.clear();
      skillCostById.clear();
      skillLowerIdById.clear();
      skillMetaByName.clear();
      jpNameToId.clear();
      officialEnglishNameSet = new Set();
      officialSkillIds = new Set();
      allSkills = [];
      categories = [];
      if (loadingEl) { loadingEl.style.display = ''; tableWrap.innerHTML = ''; tableWrap.appendChild(loadingEl); }
      await loadCostJSON();
      await loadSkillsCSV();
      renderFilters();
      refresh();
    });

    // React to language changes (re-render labels)
    window.addEventListener('i18n:changed', function () {
      renderFilters();
      refresh();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

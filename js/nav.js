(function () {
  const DEFAULT_ROUTES = [
    {
      label: 'Rating',
      i18nKey: 'nav.rating',
      children: [
        { label: 'Optimizer', i18nKey: 'nav.optimizer', path: '/optimizer', file: '/optimizer.html' },
        { label: 'Calculator', i18nKey: 'nav.calculator', path: '/calculator', file: '/calculator.html' },
        { label: 'Stamina Check', i18nKey: 'nav.staminaCheck', path: '/stamina', file: '/stamina.html' },
      ],
    },
    {
      label: 'Tools',
      i18nKey: 'nav.tools',
      children: [
        { label: 'Event OCR', i18nKey: 'nav.eventOCR', path: '/events', file: '/events.html' },
        { label: 'Support Hints', i18nKey: 'nav.supportHints', path: '/hints', file: '/hints.html' },
        { label: 'Deck Builder', i18nKey: 'nav.deckBuilder', path: '/deck', file: '/deck.html' },
      ],
    },
    {
      label: 'Fun',
      i18nKey: 'nav.fun',
      children: [
        { label: 'Randomizer', i18nKey: 'nav.randomizer', path: '/random', file: '/random.html' },
        { label: 'Umadle', i18nKey: 'nav.umadle', path: '/umadle', file: '/umadle.html' },
      ],
    },
  ];
  const ROUTES =
    Array.isArray(window.NAV_ROUTES) && window.NAV_ROUTES.length
      ? window.NAV_ROUTES
      : DEFAULT_ROUTES;
  const SERVER_PREF_KEY = 'umatoolsServer';
  const SITE_LANG_PREF_KEY = 'umatoolsSiteLanguage';

  function normalizeServer(value) {
    return (value || '').toString().trim().toLowerCase() === 'jp' ? 'jp' : 'en';
  }

  function normalizeSiteLanguage(value) {
    return (value || '').toString().trim().toLowerCase() === 'jp' ? 'jp' : 'en';
  }

  function readPref(key, normalizeFn, fallback) {
    try {
      return normalizeFn(localStorage.getItem(key));
    } catch {
      return fallback;
    }
  }

  function writePref(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }

  function applySiteLanguage(lang) {
    const normalized = normalizeSiteLanguage(lang);
    document.documentElement.lang = normalized === 'jp' ? 'ja' : 'en';
    document.documentElement.dataset.siteLanguage = normalized;
  }

  // Footer links: override per-page with window.FOOTER_LINKS if you want
  const DEFAULT_FOOTER = [
    {
      label: 'GitHub',
      href: 'https://github.com/daftuyda/UmaTools',
    },
    { label: 'YouTube', href: 'https://youtube.com/@MaybeVoid' },
  ];
  const FOOTER =
    Array.isArray(window.FOOTER_LINKS) && window.FOOTER_LINKS.length
      ? window.FOOTER_LINKS
      : DEFAULT_FOOTER;

  // Build navbar element (not in DOM yet)
  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  var _t = function (key) { return typeof window.t === 'function' ? window.t(key) : key; };
  nav.setAttribute('aria-label', _t('nav.primary'));
  nav.innerHTML = `
    <div class="nav-inner">
      <div class="nav-left">
        <a class="brand" href="/" data-i18n-aria="nav.home" aria-label="${_t('nav.home')}">
          <span class="brand-text">UmaTools</span>
        </a>
        <button class="menu-btn" data-i18n-aria="nav.menu" aria-label="${_t('nav.menu')}" aria-expanded="false">
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"
              fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
        <div class="nav-links" role="navigation" data-i18n-aria="nav.primary" aria-label="${_t('nav.primary')}"></div>
      </div>
      <div class="nav-right">
        <div class="nav-settings">
          <button
            type="button"
            class="settings-btn"
            id="nav-settings-toggle"
            aria-expanded="false"
            aria-controls="nav-settings-panel"
            aria-haspopup="true"
            data-i18n="nav.settings"
          >
            ${_t('nav.settings')}
          </button>
          <div
            class="nav-settings-panel"
            id="nav-settings-panel"
            role="group"
            data-i18n-aria="nav.globalSettings"
            aria-label="${_t('nav.globalSettings')}"
            hidden
          >
            <div class="nav-settings-title" data-i18n="nav.globalSettings">${_t('nav.globalSettings')}</div>
            <label class="nav-control">
              <span data-i18n="nav.server">${_t('nav.server')}</span>
              <select id="nav-server-select" aria-label="Game server">
                <option value="en">EN</option>
                <option value="jp">JP</option>
              </select>
            </label>
            <label class="nav-control">
              <span data-i18n="nav.siteLanguage">${_t('nav.siteLanguage')}</span>
              <select id="nav-site-lang-select" aria-label="Site language">
                <option value="en">EN</option>
                <option value="jp">JP</option>
              </select>
            </label>
          </div>
        </div>
        <div id="navModeToggleSlot"></div>
      </div>
    </div>
  `;

  const navEl = nav;
  const linksWrap = nav.querySelector('.nav-links');
  const menuBtn = nav.querySelector('.menu-btn');
  const settingsToggleBtn = nav.querySelector('#nav-settings-toggle');
  const settingsPanel = nav.querySelector('#nav-settings-panel');
  let settingsOpen = false;

  function setSettingsOpen(open) {
    if (!settingsToggleBtn || !settingsPanel) return;
    settingsOpen = !!open;
    settingsToggleBtn.setAttribute('aria-expanded', String(settingsOpen));
    settingsPanel.hidden = !settingsOpen;
  }

  function closeAllDropdowns() {
    for (const dd of navEl.querySelectorAll('.nav-group.open')) {
      dd.classList.remove('open');
      const btn = dd.querySelector('.nav-group-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  }

  // Toggle hamburger on mobile
  menuBtn.addEventListener('click', () => {
    setSettingsOpen(false);
    closeAllDropdowns();
    const open = navEl.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  // Close menu when a link is chosen
  linksWrap.addEventListener('click', (e) => {
    if (e.target.closest('.nav-link')) {
      setSettingsOpen(false);
      closeAllDropdowns();
      navEl.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  if (settingsToggleBtn && settingsPanel) {
    settingsToggleBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeAllDropdowns();
      setSettingsOpen(!settingsOpen);
    });
    settingsPanel.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', (event) => {
      if (!settingsOpen) return;
      const target = event.target;
      if (target instanceof Element && target.closest('.nav-settings')) return;
      setSettingsOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        closeAllDropdowns();
      }
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('.nav-group')) return;
    closeAllDropdowns();
  });

  // Collect all leaf links for clean-URL fallback and active marking
  function collectLeaves(routes) {
    const leaves = [];
    for (const r of routes) {
      if (r.children) {
        for (const child of r.children) leaves.push(child);
      } else {
        leaves.push(r);
      }
    }
    return leaves;
  }

  // Inject everything after DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    // Put navbar at top
    const skipLink = document.querySelector('.skip-link');
    if (skipLink && skipLink.parentNode) {
      skipLink.insertAdjacentElement('afterend', nav);
    } else {
      document.body.prepend(nav);
    }

    const here = location.pathname.replace(/\/+$/, '') || '/';
    const norm = (s) => (s || '').replace(/\/+$/, '') || '/';
    const allLinks = [];

    // Build links — supports both flat and grouped routes
    for (const route of ROUTES) {
      if (route.children) {
        // Dropdown group
        const group = document.createElement('div');
        group.className = 'nav-group';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-group-btn';
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-haspopup', 'true');
        const groupLabel = route.i18nKey ? _t(route.i18nKey) : route.label;
        btn.innerHTML =
          '<span' + (route.i18nKey ? ' data-i18n="' + route.i18nKey + '"' : '') + '>' +
          groupLabel +
          '</span><svg class="nav-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">' +
          '<path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>';

        const menu = document.createElement('div');
        menu.className = 'nav-group-menu';
        menu.setAttribute('role', 'menu');

        let hasActive = false;
        for (const child of route.children) {
          const a = document.createElement('a');
          a.className = 'nav-link';
          a.textContent = child.i18nKey ? _t(child.i18nKey) : child.label;
          if (child.i18nKey) a.setAttribute('data-i18n', child.i18nKey);
          a.href = child.path || child.file || '#';
          a.setAttribute('role', 'menuitem');
          if (child.file) a.dataset.file = child.file;
          if (child.path) a.dataset.clean = child.path;
          if (here === norm(child.path) || here === norm(child.file)) {
            a.classList.add('active');
            hasActive = true;
          }
          menu.appendChild(a);
          allLinks.push(a);
        }
        if (hasActive) group.classList.add('has-active');

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          setSettingsOpen(false);
          const wasOpen = group.classList.contains('open');
          closeAllDropdowns();
          if (!wasOpen) {
            group.classList.add('open');
            btn.setAttribute('aria-expanded', 'true');
          }
        });

        group.appendChild(btn);
        group.appendChild(menu);
        linksWrap.appendChild(group);
      } else {
        // Flat link (backward compat)
        const a = document.createElement('a');
        a.className = 'nav-link';
        a.textContent = route.i18nKey ? _t(route.i18nKey) : route.label;
        if (route.i18nKey) a.setAttribute('data-i18n', route.i18nKey);
        a.href = route.path || route.file || '#';
        if (route.file) a.dataset.file = route.file;
        if (route.path) a.dataset.clean = route.path;
        if (here === norm(route.path) || here === norm(route.file)) {
          a.classList.add('active');
        }
        linksWrap.appendChild(a);
        allLinks.push(a);
      }
    }

    // Prefer clean URLs, fall back to .html if needed
    const leaves = collectLeaves(ROUTES);
    const test = leaves.find((r) => r.path && r.file && r.path !== '/');
    if (test) {
      fetch(test.path, { method: 'HEAD' })
        .then((res) => {
          if (!res.ok) throw 0;
        })
        .catch(() => {
          allLinks.forEach((a) => {
            if (a.dataset.file) a.href = a.dataset.file;
          });
        });
    }

    // Move existing dark-mode toggle into navbar (if present)
    const slot = nav.querySelector('#navModeToggleSlot');
    const toggle = document.getElementById('modeToggleBtn');
    if (toggle && slot) {
      slot.appendChild(toggle);
      toggle.classList.add('in-nav');
    }
    const serverSelect = nav.querySelector('#nav-server-select');
    const siteLangSelect = nav.querySelector('#nav-site-lang-select');
    if (serverSelect) {
      serverSelect.value = readPref(SERVER_PREF_KEY, normalizeServer, 'en');
      serverSelect.addEventListener('change', () => {
        const next = normalizeServer(serverSelect.value);
        serverSelect.value = next;
        writePref(SERVER_PREF_KEY, next);
        window.dispatchEvent(
          new CustomEvent('umatools:server-change', {
            detail: { server: next, source: 'nav' },
          })
        );
      });
      window.addEventListener('umatools:server-change', (event) => {
        const next = normalizeServer(event?.detail?.server);
        if (serverSelect.value !== next) serverSelect.value = next;
      });
      window.dispatchEvent(
        new CustomEvent('umatools:server-change', {
          detail: { server: serverSelect.value, source: 'nav-init' },
        })
      );
    }
    if (siteLangSelect) {
      siteLangSelect.value = readPref(SITE_LANG_PREF_KEY, normalizeSiteLanguage, 'en');
      applySiteLanguage(siteLangSelect.value);
      siteLangSelect.addEventListener('change', () => {
        const next = normalizeSiteLanguage(siteLangSelect.value);
        siteLangSelect.value = next;
        writePref(SITE_LANG_PREF_KEY, next);
        applySiteLanguage(next);
        window.dispatchEvent(
          new CustomEvent('umatools:site-language-change', {
            detail: { language: next, source: 'nav' },
          })
        );
      });
      window.addEventListener('umatools:site-language-change', (event) => {
        const next = normalizeSiteLanguage(event?.detail?.language);
        if (siteLangSelect.value !== next) siteLangSelect.value = next;
        applySiteLanguage(next);
      });
      window.dispatchEvent(
        new CustomEvent('umatools:site-language-change', {
          detail: { language: siteLangSelect.value, source: 'nav-init' },
        })
      );
    }

    // Footer at bottom
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `
      <span><span data-i18n="nav.madeWith">${_t('nav.madeWith')}</span> <span aria-label="love">&#10084;&#65039;</span></span>
      ${FOOTER.map(
        (l) => `<a href="${l.href}" target="_blank" rel="noopener noreferrer">${l.label}</a>`
      ).join('')}
    `;
    document.body.appendChild(footer);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    }

    // Re-apply i18n to nav elements when language changes
    window.addEventListener('i18n:changed', () => {
      if (typeof window.applyI18n === 'function') {
        window.applyI18n(navEl);
        window.applyI18n(footer);
      }
    });

    // Signal that nav is ready so loaders can safely release.
    window.dispatchEvent(new Event('nav:ready'));
  });

  // Close menu/dropdowns if switching to desktop width
  window.addEventListener('resize', () => {
    if (window.innerWidth > 640 && navEl.classList.contains('open')) {
      navEl.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
      closeAllDropdowns();
    }
    if (window.innerWidth <= 640 && settingsOpen) {
      setSettingsOpen(false);
    }
  });
})();

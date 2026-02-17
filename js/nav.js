(function () {
  const DEFAULT_ROUTES = [
    { label: 'Optimizer', path: '/optimizer', file: '/optimizer.html' },
    { label: 'Calculator', path: '/calculator', file: '/calculator.html' },
    { label: 'Stamina Check', path: '/stamina', file: '/stamina.html' },
    { label: 'Event OCR', path: '/events', file: '/events.html' },
    { label: 'Support Hints', path: '/hints', file: '/hints.html' },
    { label: 'Randomizer', path: '/random', file: '/random.html' },
    { label: 'Umadle', path: '/umadle', file: '/umadle.html' },
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
  nav.setAttribute('aria-label', 'Primary');
  nav.innerHTML = `
    <div class="nav-inner">
      <div class="nav-left">
        <a class="brand" href="/" aria-label="Uma Tools Home">
          <span class="brand-text">UmaTools</span>
        </a>
        <button class="menu-btn" aria-label="Menu" aria-expanded="false">
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"
              fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
        <div class="nav-links" role="navigation" aria-label="Primary"></div>
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
          >
            Settings
          </button>
          <div
            class="nav-settings-panel"
            id="nav-settings-panel"
            role="group"
            aria-label="Global Settings"
            hidden
          >
            <div class="nav-settings-title">Global Settings</div>
            <label class="nav-control">
              <span>Server</span>
              <select id="nav-server-select" aria-label="Game server">
                <option value="en">EN</option>
                <option value="jp">JP</option>
              </select>
            </label>
            <label class="nav-control">
              <span>Site Language</span>
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

  // Safe to reference the element we just created
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

  // Toggle dropdown on mobile
  menuBtn.addEventListener('click', () => {
    setSettingsOpen(false);
    const open = navEl.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  // Close menu when a link is chosen
  linksWrap.addEventListener('click', (e) => {
    if (e.target.closest('.nav-link')) {
      setSettingsOpen(false);
      navEl.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  if (settingsToggleBtn && settingsPanel) {
    settingsToggleBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
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
      if (event.key === 'Escape') setSettingsOpen(false);
    });
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

    // Build links
    const links = ROUTES.map((route) => {
      const a = document.createElement('a');
      a.className = 'nav-link';
      a.textContent = route.label;
      a.href = route.path || route.file || '#';
      if (route.file) a.dataset.file = route.file;
      if (route.path) a.dataset.clean = route.path;
      linksWrap.appendChild(a);
      return a;
    });

    // Mark active route
    const here = location.pathname.replace(/\/+$/, '') || '/';
    const norm = (s) => (s || '').replace(/\/+$/, '') || '/';
    ROUTES.forEach((r, i) => {
      if (here === norm(r.path) || here === norm(r.file)) links[i].classList.add('active');
    });

    // Prefer clean URLs, fall back to .html if needed
    const test = ROUTES.find((r) => r.path && r.file && r.path !== '/');
    if (test) {
      fetch(test.path, { method: 'HEAD' })
        .then((res) => {
          if (!res.ok) throw 0;
        })
        .catch(() => {
          links.forEach((a) => {
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
      <span>Made with ❤️</span>
      ${FOOTER.map(
        (l) => `<a href="${l.href}" target="_blank" rel="noopener noreferrer">${l.label}</a>`
      ).join('')}
    `;
    document.body.appendChild(footer);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    }

    // Signal that nav is ready so loaders can safely release.
    window.dispatchEvent(new Event('nav:ready'));
  });

  // Close menu if switching to desktop width
  window.addEventListener('resize', () => {
    if (window.innerWidth > 640 && navEl.classList.contains('open')) {
      navEl.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
    if (window.innerWidth <= 640 && settingsOpen) {
      setSettingsOpen(false);
    }
  });
})();

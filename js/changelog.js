(function () {
  'use strict';

  var STORAGE_KEY = 'umatools.changelog.dismissed';

  function readDismissed() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function writeDismissed(version) {
    try {
      localStorage.setItem(STORAGE_KEY, version);
    } catch (e) {}
  }

  function getLang() {
    if (window.I18n && typeof window.I18n.getLang === 'function') {
      var lang = window.I18n.getLang();
      return lang === 'ja' ? 'ja' : 'en';
    }
    return 'en';
  }

  function renderEntries(ul, entries) {
    var lang = getLang();
    ul.innerHTML = '';
    for (var i = 0; i < entries.length; i++) {
      var li = document.createElement('li');
      li.textContent = entries[i][lang] || entries[i].en;
      ul.appendChild(li);
    }
  }

  function mount(data) {
    var version = data.version;
    var entries = data.entries;
    if (!version || !entries || !entries.length) return;
    if (readDismissed() === version) return;

    var banner = document.createElement('div');
    banner.className = 'changelog-banner';
    banner.setAttribute('role', 'status');

    var inner = document.createElement('div');
    inner.className = 'changelog-inner';

    var title = document.createElement('strong');
    title.setAttribute('data-i18n', 'changelog.whatsNew');
    title.textContent = (typeof window.t === 'function') ? window.t('changelog.whatsNew') : "What's New";

    var ul = document.createElement('ul');
    ul.className = 'changelog-list';
    renderEntries(ul, entries);

    var btn = document.createElement('button');
    btn.className = 'changelog-dismiss';
    btn.setAttribute('aria-label', (typeof window.t === 'function') ? window.t('changelog.dismiss') : 'Dismiss');
    btn.setAttribute('data-i18n-aria', 'changelog.dismiss');
    btn.innerHTML = '&times;';

    btn.addEventListener('click', function () {
      writeDismissed(version);
      banner.classList.add('changelog-hiding');
      banner.addEventListener('animationend', function () {
        banner.remove();
      });
    });

    inner.appendChild(title);
    inner.appendChild(ul);
    inner.appendChild(btn);
    banner.appendChild(inner);

    // Insert after nav, before main content
    var nav = document.querySelector('.site-nav');
    if (nav && nav.nextSibling) {
      nav.parentNode.insertBefore(banner, nav.nextSibling);
    } else {
      var main = document.getElementById('main');
      if (main) {
        main.parentNode.insertBefore(banner, main);
      } else {
        document.body.prepend(banner);
      }
    }

    // Re-apply i18n if available
    if (typeof window.applyI18n === 'function') {
      window.applyI18n(banner);
    }

    // Update entries when language changes
    window.addEventListener('i18n:changed', function () {
      renderEntries(ul, entries);
      if (typeof window.applyI18n === 'function') {
        window.applyI18n(banner);
      }
    });
  }

  function init() {
    fetch('/assets/changelog.json')
      .then(function (res) {
        if (!res.ok) throw new Error(res.status);
        return res.json();
      })
      .then(mount)
      .catch(function () {
        // Silently fail — changelog is non-critical
      });
  }

  // Wait for nav to be ready so we can insert after it
  var navReady = false;
  var domReady = false;

  function tryInit() {
    if (navReady && domReady) init();
  }

  window.addEventListener('nav:ready', function () {
    navReady = true;
    tryInit();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      domReady = true;
      tryInit();
    });
  } else {
    domReady = true;
    tryInit();
  }

  // Fallback in case nav:ready never fires
  setTimeout(function () {
    navReady = true;
    tryInit();
  }, 3000);
})();

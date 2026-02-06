// Shared rarity badge helper (SSR / SR / R)
(function (global) {
  'use strict';

  const VALID = new Set(['SSR', 'SR', 'R']);

  function normalize(rarity) {
    return (rarity || '').toString().trim().toUpperCase();
  }

  function className(rarity) {
    const r = normalize(rarity);
    return VALID.has(r) ? `badge-${r}` : '';
  }

  function render(rarity, labelOverride) {
    const r = normalize(rarity);
    const label = labelOverride || r || '';
    const cls = className(r);
    return `<span class="badge${cls ? ` ${cls}` : ''}">${label}</span>`;
  }

  function apply(el, rarity, labelOverride) {
    if (!el) return;
    const r = normalize(rarity);
    const cls = className(r);
    el.className = `badge${cls ? ` ${cls}` : ''}`;
    el.textContent = labelOverride || r || '';
  }

  global.RarityBadge = { normalize, className, render, apply };
})(window);

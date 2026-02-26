# Contributing Translations

This guide explains how to add or update site language translations for Uma Event Helper Web.

---

## Table of Contents

1. [How It Works](#1-how-it-works)
2. [File Structure](#2-file-structure)
3. [Translation Keys](#3-translation-keys)
4. [Adding a New Language](#4-adding-a-new-language)
5. [Updating Existing Translations](#5-updating-existing-translations)
6. [HTML Attributes](#6-html-attributes)
7. [Variable Interpolation](#7-variable-interpolation)
8. [Testing](#8-testing)
9. [Key Sections Reference](#9-key-sections-reference)

---

## 1. How It Works

All translations live in a single file: **`js/i18n.js`**.

The file contains a `TRANSLATIONS` object with one sub-object per language (`en`, `ja`). Each sub-object maps **dot-separated keys** to translated strings. English (`en`) is the fallback — if a key is missing in another language, the English value is shown.

```text
User selects language → stored in localStorage → i18n.js reads it on page load
                                                → t('key') returns the right string
                                                → applyI18n() updates all HTML elements
```

The site currently supports **English** and **Japanese** with ~520 keys each.

---

## 2. File Structure

Everything is in one file:

```
js/i18n.js
├── TRANSLATIONS.en   (English — the canonical/fallback language)
├── TRANSLATIONS.ja   (Japanese)
├── t(key, vars)      (lookup function)
└── applyI18n(root)   (DOM updater)
```

Each language block is organized into sections separated by comments:

```js
// ── Common ──
// ── Nav ──
// ── Home ──
// ── Calculator ──
// ── Optimizer ──
// ... etc
```

---

## 3. Translation Keys

Keys use a `section.camelCase` naming convention:

| Pattern          | Example                 | Used for                  |
| ---------------- | ----------------------- | ------------------------- |
| `common.*`       | `common.speed`          | Shared terms across pages |
| `nav.*`          | `nav.optimizer`         | Navigation menu           |
| `home.*`         | `home.title`            | Landing page              |
| `calculator.*`   | `calculator.addSkill`   | Rating Calculator page    |
| `optimizer.*`    | `optimizer.buildLoaded` | Skill Optimizer page      |
| `stamina.*`      | `stamina.title`         | Stamina Check page        |
| `events.*`       | `events.title`          | Event OCR page            |
| `hints.*`        | `hints.title`           | Support Hints page        |
| `deck.*`         | `deck.title`            | Deck Builder page         |
| `random.*`       | `random.title`          | Randomizer page           |
| `umadle.*`       | `umadle.title`          | Umadle page               |
| `tutorial.*`     | `tutorial.next`         | Tutorial overlay          |
| `skillLib.*`     | `skillLib.title`        | Skill Library page        |
| `skillPopup.*`   | `skillPopup.name`       | Skill description popup   |
| `ratingShared.*` | `ratingShared.badge`    | Shared rating components  |

---

## 4. Adding a New Language

1. **Add a new block** in `TRANSLATIONS` inside `js/i18n.js`, after the `ja` block:

```js
var TRANSLATIONS = {
  en: {
    /* ... */
  },
  ja: {
    /* ... */
  },
  ko: {
    // ── Common ──
    'common.speed': '스피드',
    'common.stamina': '스태미나',
    // ... copy all keys from en and translate
  },
};
```

2. **Update `setLang()`** to recognize the new language code:

```js
function setLang(lang) {
  // Add your language code to the check
  if (lang === 'ko') currentLang = 'ko';
  else if (lang === 'jp' || lang === 'ja') currentLang = 'ja';
  else currentLang = 'en';
}
```

3. **Add the language option** in the settings panel. In `js/nav.js`, find the site language dropdown and add an option:

```html
<option value="ko">한국어</option>
```

4. **You don't need to translate every key right away.** Any missing key falls back to the English value automatically. Start with high-visibility sections like `common`, `nav`, and `home`, then work through page-specific sections.

---

## 5. Updating Existing Translations

To fix or improve an existing translation, find the key in the appropriate language block and edit the value:

```js
// Before
'optimizer.title': '旧い翻訳',

// After
'optimizer.title': '新しい翻訳',
```

Keep the key name identical across all languages. Only the value changes.

---

## 6. HTML Attributes

Static text in HTML is translated via `data-i18n*` attributes. The `applyI18n()` function runs on page load and replaces content automatically.

| Attribute               | What it sets  | Example                                                        |
| ----------------------- | ------------- | -------------------------------------------------------------- |
| `data-i18n`             | `textContent` | `<h1 data-i18n="hints.title">Support Hint Finder</h1>`         |
| `data-i18n-html`        | `innerHTML`   | `<p data-i18n-html="home.desc">Text with <b>HTML</b></p>`      |
| `data-i18n-placeholder` | `placeholder` | `<input data-i18n-placeholder="common.searchByName" />`        |
| `data-i18n-aria`        | `aria-label`  | `<button data-i18n-aria="common.close">×</button>`             |
| `data-i18n-title`       | `title`       | `<button data-i18n-title="common.toggleDarkLight">🌙</button>` |

The English text in the HTML serves as the default before JS runs. Always keep it in sync with the `en` translation value.

---

## 7. Variable Interpolation

Some strings contain `{placeholders}` that are filled at runtime:

```js
// Definition
'stamina.needMore': 'Need about {amount} more stamina.',

// Usage in JS
t('stamina.needMore', { amount: 150 })
// → "Need about 150 more stamina."
```

When translating these strings, keep the `{placeholder}` names exactly as-is — only translate the surrounding text:

```js
// English
'stamina.needMore': 'Need about {amount} more stamina.',

// Japanese
'stamina.needMore': 'あと約{amount}のスタミナが必要です。',
```

Common variables you'll encounter:

| Variable                         | Type   | Used in                        |
| -------------------------------- | ------ | ------------------------------ |
| `{amount}`                       | Number | Stamina calculations           |
| `{count}`                        | Number | List counts                    |
| `{name}`                         | String | Build names                    |
| `{score}`                        | Number | Scores                         |
| `{current}`, `{total}`           | Number | Progress (e.g., "Step 3 of 5") |
| `{lvl}`, `{pct}`                 | Number | Hint level/discount            |
| `{chosen}`, `{used}`, `{budget}` | Number | Optimizer results              |

---

## 8. Testing

1. Open any page locally
2. Open the hamburger menu → **Settings** → change **Site Language**
3. All static text should update immediately (no page reload needed)
4. Navigate between pages to verify translations persist
5. Check dynamic text too — interact with tools to trigger `t()` calls in JS

To verify coverage, open the browser console and run:

```js
// Find keys in EN that are missing from JA
Object.keys(I18n.TRANSLATIONS.en).filter((k) => !(k in I18n.TRANSLATIONS.ja));
```

An empty array `[]` means full coverage.

---

## 9. Key Sections Reference

| Section       | Key count | Scope                                 |
| ------------- | --------- | ------------------------------------- |
| Common        | ~43       | Shared labels (stats, buttons, terms) |
| Nav           | ~22       | Navigation menu and settings          |
| Home          | ~20       | Landing page cards                    |
| Calculator    | ~27       | Rating Calculator page                |
| Optimizer     | ~96       | Skill Optimizer (largest section)     |
| Stamina       | ~46       | Stamina Check page                    |
| Events/OCR    | ~23       | Event OCR page                        |
| Hints         | ~12       | Support Hints page                    |
| Deck          | ~55       | Deck Builder page                     |
| Random        | ~16       | Randomizer page                       |
| Umadle        | ~14       | Umadle page                           |
| Tutorial      | ~19       | Tutorial overlay                      |
| Skill Library | ~13       | Skill Library page                    |
| Skill Popup   | ~12       | Skill description popup               |
| Rating Shared | ~5        | Shared rating components              |

Total: **~520 keys** per language.

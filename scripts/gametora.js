#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BASE_URL = "https://gametora.com";
const DEFAULT_OUTPUT_DIR = path.join(__dirname, "..", "assets");
const DEFAULT_CACHE_DIR = path.join(__dirname, "..", ".cache_gametora");
const DEFAULT_METADATA_PATH = path.join(DEFAULT_CACHE_DIR, "gametora_metadata.json");
const SKILLS_ALL_PATH = path.join(__dirname, "..", "assets", "skills_all.json");

const USER_AGENT = "Mozilla/5.0 (compatible; gametora-codex-scraper/2.0)";

// GameTora image URL templates
const GT_SUPPORT_IMG = (id) => `${DEFAULT_BASE_URL}/images/umamusume/supports/support_card_s_${id}.png`;
const GT_CHAR_IMG = (charId, cardId) => `${DEFAULT_BASE_URL}/images/umamusume/characters/thumb/chara_stand_${charId}_${cardId}.png`;

const STAT_NAMES = ["Speed", "Stamina", "Power", "Guts", "Wit"];

// evrew stat-key → display name
const EVREW_KEY_MAP = Object.freeze({
  sp: "Speed", st: "Stamina", po: "Power", gu: "Guts",
  in: "Wit", wi: "Wit", sk: "Skill Pts", pt: "Skill Pts",
  bo: "Bond", bo_ch: "Bond", bo_l: "Bond", bo_r: "Bond",
  vi: "Energy", en: "Energy", hp: "Energy",
  mo: "Motivation", fa: "Fans",
  me: "Max Energy", he: "Motivation",
});

const RARITY_MAP = { 1: "R", 2: "SR", 3: "SSR" };

const GRADE_MAP = {
  100: "G1", 200: "G2", 300: "G3", 400: "OP", 500: "Pre-OP",
  700: "Debut", 800: "Ungraded", 900: "Debut",
};
const TERRAIN_MAP = { 1: "Turf", 2: "Dirt" };
const SEASON_MAP = { 0: "Winter", 1: "Spring", 2: "Summer", 3: "Autumn", 4: "Winter", 5: "Spring" };
const DISTANCE_MAP = { 1: "Short", 2: "Mile", 3: "Medium", 4: "Long" };

// GameTora XOR cipher offsets/keys (reverse-engineered from frontend JS)
const GT_NAME_OFFSET = 86;
const GT_NAME_KEY = 106;
const GT_REWARD_OFFSET = 36;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    what: "all",
    server: "global",
    outUma: path.join(DEFAULT_OUTPUT_DIR, "uma_data.json"),
    outSupports: path.join(DEFAULT_OUTPUT_DIR, "support_card.json"),
    outSupportHints: path.join(DEFAULT_OUTPUT_DIR, "support_hints.json"),
    outRaces: path.join(DEFAULT_OUTPUT_DIR, "races.json"),
    outSkills: SKILLS_ALL_PATH,
    charThumbDir: path.join(DEFAULT_OUTPUT_DIR, "character_thumbs"),
    supportThumbDir: path.join(DEFAULT_OUTPUT_DIR, "support_thumbs"),
    metadata: DEFAULT_METADATA_PATH,
    noFetch: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--what") opts.what = argv[++i];
    else if (arg === "--server") opts.server = argv[++i];
    else if (arg === "--out-uma") opts.outUma = argv[++i];
    else if (arg === "--out-supports") opts.outSupports = argv[++i];
    else if (arg === "--out-support-hints") opts.outSupportHints = argv[++i];
    else if (arg === "--out-races") opts.outRaces = argv[++i];
    else if (arg === "--out-skills") opts.outSkills = argv[++i];
    else if (arg === "--char-thumb-dir") opts.charThumbDir = argv[++i];
    else if (arg === "--support-thumb-dir") opts.supportThumbDir = argv[++i];
    else if (arg === "--metadata") opts.metadata = argv[++i];
    else if (arg === "--no-fetch") opts.noFetch = true;
    else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
    else { console.error(`Unknown argument: ${arg}`); printHelp(); process.exit(1); }
  }
  return opts;
}

function printHelp() {
  console.log([
    "Usage: node scripts/gametora.js [options]",
    "",
    "Options:",
    "  --what <skills|uma|supports|races|all>  What to scrape (default: all)",
    "  --server <global|japan>                  Server (default: global)",
    "  --out-uma <path>          Output for character data",
    "  --out-supports <path>     Output for support events",
    "  --out-support-hints <path> Output for support hints",
    "  --out-races <path>        Output for races",
    "  --out-skills <path>       Output for skills metadata",
    "  --char-thumb-dir <path>   Where to save character thumbnails",
    "  --support-thumb-dir <path> Where to save support thumbnails",
    "  --metadata <path>         Metadata JSON output",
    "  --no-fetch                Use cached JSON only",
  ].join("\n"));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Decrypt a GameTora XOR-encoded string.
 * Encoding: base64(plaintext XOR repeat("k"+key))
 */
function gtDecrypt(encoded, key) {
  if (!encoded || typeof encoded !== "string") return "";
  const bytes = Buffer.from(encoded, "base64");
  const keyBytes = Buffer.from(`k${key}`, "utf8");
  const result = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return result.toString("utf8");
}

function writeJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// JSON fetching with cache (mirrors gamewith_skills.js pattern)
// ---------------------------------------------------------------------------

function jsonCachePath(url) {
  const slug = url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .slice(0, 200);
  // Avoid double .json extension if URL already ends in .json
  const ext = slug.endsWith(".json") ? "" : ".json";
  return path.join(DEFAULT_CACHE_DIR, `${slug}${ext}`);
}

async function fetchJsonCached(url, noFetch = false) {
  const cached = jsonCachePath(url);

  if (noFetch) {
    if (!fs.existsSync(cached)) {
      throw new Error(`--no-fetch: cache miss for ${url}`);
    }
    return JSON.parse(fs.readFileSync(cached, "utf8"));
  }

  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    ensureDir(DEFAULT_CACHE_DIR);
    fs.writeFileSync(cached, JSON.stringify(data), "utf8");
    return data;
  } catch (err) {
    if (fs.existsSync(cached)) {
      console.log(`  [cache-fallback] ${url}: ${err.message}`);
      return JSON.parse(fs.readFileSync(cached, "utf8"));
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Image downloading
// ---------------------------------------------------------------------------

/**
 * Download an image from `url` to `destPath` if it doesn't already exist.
 * Returns true if downloaded, false if skipped (already exists).
 */
async function downloadImage(url, destPath) {
  if (fs.existsSync(destPath)) return false;
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return true;
}

/**
 * Download thumbnails for a list of items in parallel (concurrency-limited).
 * @param {Array} items - objects with `slug` and `remoteUrl` keys
 * @param {string} destDir - directory to save into
 * @param {boolean} noFetch - skip downloads
 * @returns {{ downloaded: number, skipped: number, failed: number }}
 */
async function downloadThumbs(items, destDir, noFetch) {
  ensureDir(destDir);
  if (noFetch) return { downloaded: 0, skipped: items.length, failed: 0 };

  const CONCURRENCY = 8;
  let downloaded = 0, skipped = 0, failed = 0;
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      const { slug, remoteUrl } = items[i];
      const dest = path.join(destDir, `${slug}.png`);
      try {
        const did = await downloadImage(remoteUrl, dest);
        if (did) downloaded++;
        else skipped++;
      } catch (err) {
        failed++;
        if (failed <= 5) console.log(`  [thumb] Failed: ${slug} — ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return { downloaded, skipped, failed };
}

// ---------------------------------------------------------------------------
// Manifest loader
// ---------------------------------------------------------------------------

async function loadManifest(noFetch) {
  const url = `${DEFAULT_BASE_URL}/data/manifests/umamusume.json`;
  return fetchJsonCached(url, noFetch);
}

function manifestUrl(manifest, key) {
  const hash = manifest[key];
  if (!hash) return null;
  return `${DEFAULT_BASE_URL}/data/umamusume/${key}.${hash}.json`;
}

async function loadManifestData(manifest, key, noFetch) {
  const url = manifestUrl(manifest, key);
  if (!url) {
    console.log(`  [manifest] No hash for "${key}"`);
    return null;
  }
  return fetchJsonCached(url, noFetch);
}

// ---------------------------------------------------------------------------
// Skill name map (for hint lookups)
// ---------------------------------------------------------------------------

let _skillNameMap = null;

function loadSkillNameMap() {
  if (_skillNameMap) return _skillNameMap;
  _skillNameMap = {};
  if (!fs.existsSync(SKILLS_ALL_PATH)) return _skillNameMap;
  try {
    const all = JSON.parse(fs.readFileSync(SKILLS_ALL_PATH, "utf8"));
    for (const item of all) {
      if (!item || typeof item !== "object") continue;
      const sid = item.id || item.skill_id || item.skillId;
      if (sid == null) continue;
      const name = item.name_en || item.enname || item.name || item.jpname || "";
      if (name) _skillNameMap[String(sid)] = name;
    }
  } catch {}
  return _skillNameMap;
}

// ---------------------------------------------------------------------------
// evrew (event reward) decoder
// ---------------------------------------------------------------------------

function formatEvrew(rewardIds, evrew, skillMap) {
  const parts = [];
  for (const rid of rewardIds) {
    const entry = evrew[rid - GT_REWARD_OFFSET];
    if (!entry) continue;
    const [key, val, extra] = entry;
    if (val == null) continue; // skip special markers (e.g. "se" scenario events)
    const label = EVREW_KEY_MAP[key] || key;

    if (key === "sk") {
      // Skill hint: ["sk", "+1", skillId]
      const skillName = extra ? (skillMap[String(extra)] || `Skill#${extra}`) : "Unknown Skill";
      parts.push(`${skillName} hint ${val}`);
    } else if (key === "bo" && extra) {
      // Bond: ["bo", "+5", charId] — just show as "Bond +5"
      parts.push(`${label} ${val}`);
    } else {
      parts.push(`${label} ${val}`);
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// 1. Sync skills metadata
// ---------------------------------------------------------------------------

async function syncSkillsAll(outPath, noFetch) {
  const manifest = await loadManifest(noFetch);
  const url = manifestUrl(manifest, "skills");
  if (!url) {
    console.error("[skills] No skills hash in manifest");
    return null;
  }

  const skills = await fetchJsonCached(url, noFetch);
  const arr = Array.isArray(skills) ? skills : (skills?.skills || skills?.items || []);
  if (!arr.length) {
    console.error("[skills] Empty skills payload");
    return null;
  }

  writeJsonFile(outPath, arr);
  const officialCount = arr.filter((r) => r && String(r.name_en || "").trim()).length;
  console.log(`[skills] Wrote ${arr.length} skills (${officialCount} official EN names)`);
  return { count: arr.length, officialCount, source: url };
}

// ---------------------------------------------------------------------------
// 2. Build character data from manifest
// ---------------------------------------------------------------------------

async function buildCharacters(outPath, manifest, noFetch, thumbDir) {
  console.log("[character] Loading manifest data...");
  const [charCards, profiles, objectives] = await Promise.all([
    loadManifestData(manifest, "character-cards", noFetch),
    loadManifestData(manifest, "char_profiles", noFetch),
    loadManifestData(manifest, "ura-objectives", noFetch),
  ]);

  if (!charCards || !charCards.length) {
    console.error("[character] No character-cards data");
    return { count: 0 };
  }

  // Build lookup maps
  const profileMap = {};
  if (Array.isArray(profiles)) {
    for (const p of profiles) {
      if (p && p.char_id) profileMap[p.char_id] = p;
    }
  }

  const objectiveMap = {};
  if (Array.isArray(objectives)) {
    for (const o of objectives) {
      if (o && o.obj_id) objectiveMap[o.obj_id] = o;
    }
  }

  // Load training events for characters (using encrypted te_names)
  let eventsByCardId = {};
  try {
    const [charCardEvts, teNamesEn, teNamesJa, evrew] = await Promise.all([
      loadManifestData(manifest, "training_events/char_card", noFetch),
      loadManifestData(manifest, "dict/te_names_en", noFetch),
      loadManifestData(manifest, "dict/te_names_ja", noFetch),
      loadManifestData(manifest, "dict/evrew", noFetch),
    ]);
    if (charCardEvts && evrew) {
      const skillMap = loadSkillNameMap();
      eventsByCardId = parseTrainingEventsByEntity(charCardEvts, teNamesEn, teNamesJa, evrew, skillMap);
    }
  } catch (err) {
    console.log(`[character] Warning: could not load training events: ${err.message}`);
  }

  const result = [];

  for (const card of charCards) {
    const cardId = card.card_id;
    const name = card.name_en || "";
    if (!name) continue;

    // Title/nickname
    let nickname = card.title_en_gl || card.title || "";
    // Clean bracket prefix e.g. "[Special Dreamer]" → "Special Dreamer"
    nickname = nickname.replace(/^\[(.+)\]$/, "$1").trim();

    const slug = card.url_name || `${cardId}-${slugify(name)}`;

    // Stats
    const baseStats = {};
    if (card.base_stats?.length >= 5) {
      baseStats[`${card.rarity || 1}\u2605`] = arrayToStats(card.base_stats);
    }
    if (card.five_star_stats?.length >= 5) {
      baseStats["5\u2605"] = arrayToStats(card.five_star_stats);
    }
    if (card.four_star_stats?.length >= 5) {
      baseStats["4\u2605"] = arrayToStats(card.four_star_stats);
    }

    // Stat bonuses
    const statBonuses = card.stat_bonus?.length >= 5
      ? arrayToStats(card.stat_bonus)
      : {};

    // Aptitudes
    const apt = {};
    if (card.aptitude?.length >= 10) {
      const a = card.aptitude;
      apt.Surface = { Turf: a[0], Dirt: a[1] };
      apt.Distance = { Short: a[2], Mile: a[3], Medium: a[4], Long: a[5] };
      apt.Strategy = { Front: a[6], Pace: a[7], Late: a[8], End: a[9] };
    }

    // Profile data
    const profile = profileMap[card.char_id];
    const enProfile = profile?.en || {};
    const heightCm = enProfile.shoes
      ? parseHeight(enProfile.shoes)
      : null;
    const threeSizes = parseThreeSizes(enProfile);

    // Objectives
    const objData = objectiveMap[cardId] || objectiveMap[card.char_id];
    const parsedObjectives = objData ? buildObjectives(objData) : [];

    // Events
    const events = eventsByCardId[cardId] || [];

    result.push({
      UmaKey: nickname ? `${name} :: ${nickname}` : `${name} :: ${slug}`,
      UmaName: name,
      UmaNickname: nickname || null,
      UmaSlug: slug,
      UmaId: String(cardId),
      UmaServer: card.release_en ? "global" : "jp",
      UmaBaseStars: card.rarity || null,
      UmaBaseStats: baseStats,
      UmaStatBonuses: statBonuses,
      UmaAptitudes: apt,
      UmaHeightCm: heightCm,
      UmaThreeSizes: threeSizes,
      UmaObjectives: parsedObjectives,
      UmaEvents: events,
      UmaImage: `/assets/character_thumbs/${slug}.png`,
    });
  }

  writeJsonFile(outPath, result);
  const globalCount = result.filter((r) => r.UmaServer === "global").length;
  console.log(`[character] Done: ${result.length} character cards (${globalCount} global)`);

  // Download thumbnails
  if (thumbDir) {
    const thumbItems = charCards
      .filter((c) => c.name_en)
      .map((c) => ({
        slug: c.url_name || `${c.card_id}-${slugify(c.name_en)}`,
        remoteUrl: GT_CHAR_IMG(c.char_id, c.card_id),
      }));
    console.log(`[character] Downloading ${thumbItems.length} thumbnails...`);
    const stats = await downloadThumbs(thumbItems, thumbDir, noFetch);
    console.log(`[character] Thumbs: ${stats.downloaded} new, ${stats.skipped} cached, ${stats.failed} failed`);
  }

  return { count: result.length };
}

function arrayToStats(arr) {
  const out = {};
  for (let i = 0; i < Math.min(STAT_NAMES.length, arr.length); i++) {
    out[STAT_NAMES[i]] = arr[i];
  }
  return out;
}

function slugify(name) {
  return (name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function parseHeight(shoesStr) {
  if (!shoesStr) return null;
  // "Left: 23.5cm Right: 23.0cm" — not actual height. Return null.
  return null;
}

function parseThreeSizes(enProfile) {
  // Profile doesn't directly have B/W/H; return empty
  return {};
}

function buildObjectives(objData) {
  const objectives = [];
  for (const obj of (objData.objectives || [])) {
    const races = obj.races || [];
    const raceNames = races.map((r) => r.name_en || "").filter(Boolean);
    const name = raceNames.length ? raceNames.join(", ") : `Objective ${obj.order ?? "?"}`;
    const turn = obj.turn || 0;
    let year = "Senior Year";
    if (turn <= 24) year = "Junior Year";
    else if (turn <= 48) year = "Classic Year";
    objectives.push({
      ObjectiveName: name,
      Turn: String(turn),
      Time: year,
      ObjectiveCondition: "",
    });
  }
  return objectives;
}

// ---------------------------------------------------------------------------
// Training event name decoder — decrypts te_names with XOR cipher
// ---------------------------------------------------------------------------

/**
 * Decode an event name index using te_names arrays.
 * Prefers EN; falls back to JA if EN is missing or identical to JA (untranslated).
 */
function decodeEventName(nameIdx, teNamesEn, teNamesJa) {
  const adjustedIdx = nameIdx - GT_NAME_OFFSET;
  const encodedEn = teNamesEn?.[adjustedIdx];
  const encodedJa = teNamesJa?.[adjustedIdx];

  const nameEn = encodedEn ? gtDecrypt(encodedEn, GT_NAME_KEY) : "";
  const nameJa = encodedJa ? gtDecrypt(encodedJa, GT_NAME_KEY) : "";

  // Prefer EN name, fall back to JA
  return nameEn || nameJa || `Event #${nameIdx}`;
}

// ---------------------------------------------------------------------------
// Training events parser with per-entity grouping
// ---------------------------------------------------------------------------

function parseTrainingEventsByEntity(rawEntries, teNamesEn, teNamesJa, evrew, skillMap) {
  const result = {};

  for (const entry of rawEntries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const entityId = entry[0];
    const events = entry[1];
    if (!Array.isArray(events)) continue;

    const entityEvents = [];

    for (let ei = 0; ei < events.length; ei++) {
      const evt = events[ei];
      if (!Array.isArray(evt) || evt.length < 2) continue;

      const nameIdx = evt[0];
      const eventName = decodeEventName(nameIdx, teNamesEn, teNamesJa);
      const choiceData = evt[1];
      if (!Array.isArray(choiceData)) continue;

      const choices = choiceData.filter(
        (c) => Array.isArray(c) && Array.isArray(c[1]),
      );

      if (choices.length === 0) {
        entityEvents.push({ EventName: eventName, EventOptions: { "": "See details" } });
        continue;
      }

      const options = {};
      if (choices.length === 1) {
        const rewards = formatEvrew(choices[0][1] || [], evrew, skillMap);
        options[""] = rewards || "See details";
      } else {
        for (let ci = 0; ci < choices.length; ci++) {
          const label = ci === 0 ? "Top Option" : ci === 1 ? "Bottom Option" : `Option ${ci + 1}`;
          const rewards = formatEvrew(choices[ci][1] || [], evrew, skillMap);
          options[label] = rewards || "See details";
        }
      }

      entityEvents.push({ EventName: eventName, EventOptions: options });
    }

    result[entityId] = entityEvents;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Support card effect parser
// ---------------------------------------------------------------------------

/**
 * Parse a card's effects array into readable format with level breakpoints.
 * Each effect entry: [type_id, val_lv1, val_lv2, ..., val_lv11]
 * -1 means "same as previous non-(-1) value" — fill forward.
 */
function parseCardEffects(effectsArr, effectTypeLookup) {
  if (!Array.isArray(effectsArr) || !effectsArr.length) return [];

  const result = [];
  for (const row of effectsArr) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const typeId = row[0];
    const rawValues = row.slice(1); // up to 11 level values

    // Fill forward -1 values
    const values = [];
    let lastVal = 0;
    for (const v of rawValues) {
      if (v === -1) {
        values.push(lastVal);
      } else {
        values.push(v);
        lastVal = v;
      }
    }

    const info = effectTypeLookup[typeId] || { name: `Effect #${typeId}`, symbol: "" };
    result.push({
      id: typeId,
      name: info.name,
      symbol: info.symbol,
      values,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. Build support data from manifest
// ---------------------------------------------------------------------------

async function buildSupports(outEventsPath, outHintsPath, manifest, noFetch, thumbDir) {
  console.log("[support] Loading manifest data...");
  const [supportCards, teNamesEn, teNamesJa, evrew, supportEffectsDef] = await Promise.all([
    loadManifestData(manifest, "support-cards", noFetch),
    loadManifestData(manifest, "dict/te_names_en", noFetch),
    loadManifestData(manifest, "dict/te_names_ja", noFetch),
    loadManifestData(manifest, "dict/evrew", noFetch),
    loadManifestData(manifest, "support_effects", noFetch),
  ]);

  if (!supportCards || !supportCards.length) {
    console.error("[support] No support-cards data");
    return { cards: 0, hints: 0, events: 0 };
  }

  // Build support effect type lookup: id → { name, symbol }
  const effectTypeLookup = {};
  if (Array.isArray(supportEffectsDef)) {
    for (const eff of supportEffectsDef) {
      if (eff && eff.id != null) {
        effectTypeLookup[eff.id] = {
          name: eff.name_en || eff.name || `Effect #${eff.id}`,
          symbol: eff.symbol || "",
        };
      }
    }
  }
  console.log(`[support] Loaded ${Object.keys(effectTypeLookup).length} effect type definitions`);

  const skillMap = loadSkillNameMap();

  // Load training events for SSR + SR supports (with JA fallback)
  let eventsBySupport = {};
  try {
    const [ssrEvts, srEvts] = await Promise.all([
      loadManifestData(manifest, "training_events/ssr", noFetch),
      loadManifestData(manifest, "training_events/sr", noFetch),
    ]);
    const allEvts = [...(ssrEvts || []), ...(srEvts || [])];
    if (allEvts.length && evrew) {
      eventsBySupport = parseTrainingEventsByEntity(allEvts, teNamesEn, teNamesJa, evrew, skillMap);
    }
  } catch (err) {
    console.log(`[support] Warning: could not load training events: ${err.message}`);
  }

  // Build hints and events
  const hints = [];
  const allEvents = [];
  const eventSet = new Set();

  for (const card of supportCards) {
    const supId = card.support_id;
    const charName = card.char_name || "";
    const rarity = RARITY_MAP[card.rarity] || "UNKNOWN";
    const slug = card.url_name || `${supId}-${slugify(charName)}`;
    const displayName = charName
      ? `${charName} (${rarity})`
      : `Support #${supId} (${rarity})`;

    // Hints
    const hintSkills = card.hints?.hint_skills || [];
    const hintOthers = card.hints?.hint_others || [];
    const parsedHints = [];

    for (const sid of hintSkills) {
      const skillName = skillMap[String(sid)] || "";
      parsedHints.push({ SkillId: String(sid), Name: skillName, HintLevel: null });
    }
    for (const other of hintOthers) {
      if (other && typeof other === "object") {
        // hint_others entries: {hint_type, hint_value}
        // These are non-skill hints (stat bonuses, training effects, etc.)
        // We'll include them with descriptive names
        const hintType = other.hint_type;
        const hintValue = other.hint_value;
        const name = describeHintOther(hintType, hintValue);
        if (name) parsedHints.push({ SkillId: "", Name: name, HintLevel: null });
      }
    }

    // Support type (speed/stamina/power/guts/intelligence/friend/group → display name)
    const typeRaw = card.type || "";
    const SUPPORT_TYPE_MAP = {
      speed: "Speed", stamina: "Stamina", power: "Power",
      guts: "Guts", intelligence: "Wit",
      friend: "Friend", group: "Group",
    };
    const supportType = SUPPORT_TYPE_MAP[typeRaw] || typeRaw || "Unknown";

    // Parse card effects with level breakpoints
    const parsedEffects = parseCardEffects(card.effects, effectTypeLookup);

    // Parse unique effect
    let parsedUnique = null;
    if (card.unique && Array.isArray(card.unique.effects) && card.unique.effects.length) {
      parsedUnique = {
        level: card.unique.level || 0,
        effects: card.unique.effects.map((u) => {
          const info = effectTypeLookup[u.type] || { name: `Effect #${u.type}`, symbol: "" };
          return { id: u.type, name: info.name, symbol: info.symbol, value: u.value };
        }),
      };
    }

    hints.push({
      SupportSlug: slug,
      SupportId: String(supId),
      SupportName: displayName,
      SupportRarity: rarity,
      SupportServer: card.release_en ? "global" : "jp",
      SupportType: supportType,
      SupportEffects: parsedEffects,
      SupportUnique: parsedUnique,
      SupportImage: `/assets/support_thumbs/${slug}.png`,
      SupportHints: parsedHints,
    });

    // Events for this support
    const events = eventsBySupport[supId] || [];
    for (const evt of events) {
      const key = `${evt.EventName}|${JSON.stringify(evt.EventOptions)}`;
      if (!eventSet.has(key)) {
        eventSet.add(key);
        allEvents.push(evt);
      }
    }
  }

  writeJsonFile(outHintsPath, hints);
  writeJsonFile(outEventsPath, allEvents);

  const totalHints = hints.reduce((sum, h) => sum + h.SupportHints.length, 0);
  console.log(`[support] Done: ${hints.length} cards, ${totalHints} hints, ${allEvents.length} events`);

  // Download thumbnails
  if (thumbDir) {
    const thumbItems = supportCards.map((c) => ({
      slug: c.url_name || `${c.support_id}-${slugify(c.char_name)}`,
      remoteUrl: GT_SUPPORT_IMG(c.support_id),
    }));
    console.log(`[support] Downloading ${thumbItems.length} thumbnails...`);
    const stats = await downloadThumbs(thumbItems, thumbDir, noFetch);
    console.log(`[support] Thumbs: ${stats.downloaded} new, ${stats.skipped} cached, ${stats.failed} failed`);
  }

  return { cards: hints.length, hints: totalHints, events: allEvents.length };
}

function describeHintOther(type, value) {
  // hint_type values observed in the data — map to descriptive names
  // These are non-skill bonuses provided by support cards
  const descriptions = {
    1: "Initial Speed bonus",
    2: "Initial Stamina bonus",
    3: "Initial Power bonus",
    4: "Initial Guts bonus",
    5: "Initial Wit bonus",
    6: "Speed training bonus",
    7: "Stamina training bonus",
    8: "Power training bonus",
    9: "Guts training bonus",
    10: "Wit training bonus",
  };
  return descriptions[type] || null;
}

// ---------------------------------------------------------------------------
// 4. Build race data from manifest
// ---------------------------------------------------------------------------

async function buildRaces(outPath, manifest, noFetch) {
  console.log("[races] Loading manifest data...");
  const races = await loadManifestData(manifest, "races", noFetch);

  if (!races || !races.length) {
    console.error("[races] No race data");
    return { count: 0 };
  }

  const result = [];
  for (const r of races) {
    if (!r || !r.name_en) continue;
    result.push({
      RaceName: r.name_en,
      Grade: GRADE_MAP[r.grade] || String(r.grade || "Unknown"),
      Terrain: TERRAIN_MAP[r.terrain] || String(r.terrain || "Unknown"),
      DistanceType: DISTANCE_MAP[r.distance >= 2500 ? 4 : r.distance >= 1800 ? 3 : r.distance >= 1400 ? 2 : 1] || "Unknown",
      DistanceMeter: r.distance ? `${r.distance}m` : "Unknown",
      Season: SEASON_MAP[r.season] || String(r.season || "Unknown"),
      Direction: r.direction === 1 ? "Right" : r.direction === 2 ? "Left" : "Straight",
      Entries: r.entries || 0,
      UrlName: r.url_name || "",
    });
  }

  writeJsonFile(outPath, result);
  console.log(`[races] Done: ${result.length} races`);
  return { count: result.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const validWhat = ["skills", "uma", "supports", "races", "all"];
  if (!validWhat.includes(opts.what)) {
    console.error(`Invalid --what value: ${opts.what}. Must be one of: ${validWhat.join(", ")}`);
    process.exit(1);
  }

  ensureDir(path.dirname(opts.metadata));

  const metadata = {
    scraped_at_utc: new Date().toISOString(),
    server: opts.server,
    what: opts.what,
    results: {},
  };

  try {
    // Always load manifest first (except for skills-only, which loads its own)
    let manifest = null;
    if (opts.what !== "skills") {
      console.log("Loading manifest...");
      manifest = await loadManifest(opts.noFetch);
      console.log(`Manifest loaded (${Object.keys(manifest).length} entries)`);
    }

    if (opts.what === "skills" || opts.what === "all") {
      console.log("\n=== Skills Metadata ===");
      metadata.results.skills = await syncSkillsAll(opts.outSkills, opts.noFetch);
    }

    if (opts.what === "uma" || opts.what === "all") {
      console.log("\n=== Characters ===");
      metadata.results.characters = await buildCharacters(opts.outUma, manifest, opts.noFetch, opts.charThumbDir);
    }

    if (opts.what === "supports" || opts.what === "all") {
      console.log("\n=== Support Cards ===");
      metadata.results.supports = await buildSupports(
        opts.outSupports, opts.outSupportHints, manifest, opts.noFetch, opts.supportThumbDir,
      );
    }

    if (opts.what === "races" || opts.what === "all") {
      console.log("\n=== Races ===");
      metadata.results.races = await buildRaces(opts.outRaces, manifest, opts.noFetch);
    }
  } catch (err) {
    console.error(`[fatal] ${err.message}`);
    process.exit(2);
  }

  writeJsonFile(opts.metadata, metadata);
  console.log(`\nMetadata written to ${opts.metadata}`);
}

main().catch((err) => {
  console.error("Failed to run GameTora scraper.");
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});

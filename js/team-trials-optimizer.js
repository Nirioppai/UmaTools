// Team Trials optimizer core (browser + Node)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TeamTrialsOptimizer = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CORE_MASK_ACCEL = 1;
  var CORE_MASK_SPEED = 2;
  var DEFAULT_WEIGHTS = {
    consistency: 0.68,
    tier: 0.32,
    efficiency: 0.58,
    rating: 0.42,
    coreAccelBonus: 0.28,
    coreSpeedBonus: 0.2,
    consistentGoldMinConsistency: 0.58,
    consistentGoldConsistencyBonus: 0.06,
    consistentGoldExpectedBonus: 0.14,
    greenSkillConsistencyPenalty: 0.18,
    greenSkillExpectedPenalty: 0.12,
    volatileRaceConditionConsistencyPenalty: 0.22,
    volatileRaceConditionExpectedPenalty: 0.2,
    tierCorePenaltyReduction: 0.5,
  };
  var DISTANCE_VALUE_TO_KEY = { 1: 'sprint', 2: 'mile', 3: 'medium', 4: 'long' };
  var GROUND_VALUE_TO_KEY = { 1: 'turf', 2: 'dirt' };
  var STYLE_VALUE_TO_KEY = { 1: 'front', 2: 'pace', 3: 'late', 4: 'end' };
  var TYPE_DISTANCE_TAG_TO_KEY = { sho: 'sprint', mil: 'mile', med: 'medium', lng: 'long' };
  var TYPE_GROUND_TAG_TO_KEY = { tur: 'turf', dir: 'dirt' };
  var TYPE_STYLE_TAG_TO_KEY = { run: 'front', ldr: 'pace', btw: 'late', cha: 'end' };
  var GRADE_RANK = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1, G: 0 };

  function num(v, f) {
    var n = Number(v);
    return Number.isFinite(n) ? n : f;
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function lower(v) {
    return (v == null ? '' : String(v)).trim().toLowerCase();
  }
  function nName(v) {
    return lower(v)
      .replace(/[\u25ce\u25cb\u00d7]/g, '')
      .replace(/[\[\]\(\)!'".,:;+*/\\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function uniqStr(list) {
    var out = [];
    var seen = new Set();
    (Array.isArray(list) ? list : []).forEach(function (v) {
      if (v == null) return;
      var s = String(v);
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    });
    return out;
  }
  function csvParse(text) {
    var s = String(text || ''),
      rows = [],
      row = [],
      field = '',
      q = false;
    for (var i = 0; i < s.length; i += 1) {
      var c = s[i];
      if (q) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i += 1;
          } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c !== '\r') field += c;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function normalizeSkill(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var en = raw.loc && raw.loc.en && typeof raw.loc.en === 'object' ? raw.loc.en : null;
    var gene = raw.gene_version && typeof raw.gene_version === 'object' ? raw.gene_version : null;
    var groups =
      en && Array.isArray(en.condition_groups) && en.condition_groups.length
        ? en.condition_groups
        : Array.isArray(raw.condition_groups)
          ? raw.condition_groups
          : gene && Array.isArray(gene.condition_groups)
            ? gene.condition_groups
            : [];
    var typeTags =
      en && Array.isArray(en.type) && en.type.length
        ? en.type
        : Array.isArray(raw.type)
          ? raw.type
          : [];
    var name = (en && en.name_en) || raw.name_en || raw.enname || (gene && gene.name_en) || '';
    var desc = (en && en.desc_en) || raw.desc_en || raw.endesc || (gene && gene.desc_en) || '';
    var parents = uniqStr(
      [].concat((gene && gene.parent_skills) || []).concat(raw.parent_skills || [])
    );
    var id = raw.id != null ? String(raw.id) : '';
    return {
      id: id,
      name: String(name || ''),
      normalizedName: nName(name),
      desc: String(desc || ''),
      rarity: num(raw.rarity, 0),
      typeTags: (Array.isArray(typeTags) ? typeTags : []).map(String),
      conditionGroups: Array.isArray(groups) ? groups : [],
      parentSkillIds: parents,
      versionSkillIds: uniqStr([id].concat(raw.versions || []).concat(parents)),
      cost: Number.isFinite(raw.cost)
        ? raw.cost
        : gene && Number.isFinite(gene.cost)
          ? gene.cost
          : null,
      raw: raw,
    };
  }

  function buildEnglishSkillIndex(rawSkills) {
    var byId = new Map(),
      byName = new Map();
    (Array.isArray(rawSkills) ? rawSkills : []).forEach(function (raw) {
      var s = normalizeSkill(raw);
      if (!s) return;
      if (s.id && !byId.has(s.id)) byId.set(s.id, s);
      if (s.normalizedName && !byName.has(s.normalizedName)) byName.set(s.normalizedName, s);
      [
        raw && raw.name_en,
        raw && raw.enname,
        raw && raw.gene_version && raw.gene_version.name_en,
      ].forEach(function (alias) {
        var k = nName(alias);
        if (k && !byName.has(k)) byName.set(k, s);
      });
    });
    return { byId: byId, byName: byName };
  }

  function condText(g) {
    if (!g || typeof g !== 'object') return '';
    var c = typeof g.condition === 'string' ? g.condition : '';
    var p = typeof g.precondition === 'string' ? g.precondition : '';
    return [c, p].filter(Boolean).join(' & ');
  }
  function cmpCount(t) {
    var m = String(t || '').match(/==|>=|<=|>|</g);
    return m ? m.length : 0;
  }
  function rangeCov(t, key, maxVal) {
    var s = String(t || '');
    if (!s) return null;
    var min = 1,
      max = maxVal,
      ok = false;
    var eq = s.match(new RegExp(key + '\\s*==\\s*(-?\\d+)', 'i'));
    if (eq) {
      var e = parseInt(eq[1], 10);
      if (!Number.isFinite(e)) return null;
      min = e;
      max = e;
      ok = true;
    }
    var ge = s.match(new RegExp(key + '\\s*>=\\s*(-?\\d+)', 'i'));
    if (ge) {
      min = Math.max(min, parseInt(ge[1], 10));
      ok = true;
    }
    var gt = s.match(new RegExp(key + '\\s*>\\s*(-?\\d+)', 'i'));
    if (gt) {
      min = Math.max(min, parseInt(gt[1], 10) + 1);
      ok = true;
    }
    var le = s.match(new RegExp(key + '\\s*<=\\s*(-?\\d+)', 'i'));
    if (le) {
      max = Math.min(max, parseInt(le[1], 10));
      ok = true;
    }
    var lt = s.match(new RegExp(key + '\\s*<\\s*(-?\\d+)', 'i'));
    if (lt) {
      max = Math.min(max, parseInt(lt[1], 10) - 1);
      ok = true;
    }
    if (!ok) return null;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return 0;
    return clamp((max - min + 1) / maxVal, 0, 1);
  }
  function timingScore(t) {
    t = lower(t);
    if (!t) return 0.62;
    if (/always\s*==\s*1/.test(t)) return 0.98;
    if (/is_lastspurt|is_finalcorner|is_last_straight/.test(t))
      return /_random/.test(t) ? 0.76 : 0.88;
    if (
      /phase_random|phase_[a-z_]*random|corner_random|straight_random|distance_rate_after_random/.test(
        t
      )
    )
      return 0.62;
    if (/phase\s*==\s*[1234]/.test(t)) return 0.76;
    if (/distance_rate/.test(t)) {
      var cov = rangeCov(t, 'distance_rate', 100);
      return cov != null && cov <= 0.2 ? 0.82 : 0.72;
    }
    if (/corner/.test(t)) return 0.75;
    return 0.68;
  }
  function breadthScore(t) {
    t = lower(t);
    if (!t) return 0.65;
    var p = [];
    [
      rangeCov(t, 'order', 18),
      rangeCov(t, 'order_rate', 100),
      rangeCov(t, 'distance_rate', 100),
    ].forEach(function (v) {
      if (v != null) p.push(v);
    });
    var near = t.match(/near_count\s*>=\s*(\d+)/);
    if (near) p.push(clamp((10 - parseInt(near[1], 10) + 1) / 10, 0.1, 1));
    var b = p.length
      ? p.reduce(function (s, v) {
          return s + v;
        }, 0) / p.length
      : /always\s*==\s*1/.test(t)
        ? 0.96
        : 0.72;
    if (/order\s*==\s*1/.test(t)) b = Math.min(b, 0.18);
    if (/order\s*<=\s*5/.test(t)) b = Math.max(b, 0.52);
    var c = cmpCount(t);
    if (c >= 4) b -= Math.min(0.2, (c - 3) * 0.05);
    return clamp(b, 0.05, 1);
  }
  function scenarioScore(t) {
    t = lower(t);
    if (!t) return 0.7;
    var s = 0.95;
    if (/blocked_side_continuetime|blocked_front_continuetime|blocked_front/.test(t)) s -= 0.22;
    if (/is_overtake/.test(t)) s -= 0.18;
    if (/change_order_onetime|change_order_up_end_after|change_order_up_middle/.test(t)) s -= 0.14;
    if (/is_move_lane/.test(t)) s -= 0.1;
    if (/is_surrounded|temptation_count|is_temptation/.test(t)) s -= 0.2;
    if (/popularity|post_number/.test(t)) s -= 0.12;
    if (/is_activate_other_skill_detail|is_activate_any_skill|activate_count_/.test(t)) s -= 0.09;
    if (/order\s*==\s*1/.test(t)) s -= 0.16;
    if (/near_count\s*>=\s*[34]/.test(t)) s -= 0.09;
    if (/always\s*==\s*1/.test(t)) s += 0.04;
    return clamp(s, 0.05, 1);
  }
  function hasVolatileRaceCondition(t) {
    t = lower(t);
    return /(track_id|ground_condition|weather|season|rotation)\s*(==|!=|>=|<=|>|<)/.test(t);
  }
  function fixedSetupDeterministic(t) {
    t = lower(t);
    var det = /(distance_type|ground_type|running_style)\s*(==|!=|>=|<=|>|<)/.test(t);
    var hasVolatileRaceReq = hasVolatileRaceCondition(t);
    var situational =
      /_random|blocked_|is_overtake|change_order|temptation|popularity|post_number/.test(t);
    return det && !hasVolatileRaceReq && !situational;
  }
  function effectBuckets(skill) {
    var d = lower(skill && skill.desc),
      types = new Set();
    (Array.isArray(skill && skill.conditionGroups) ? skill.conditionGroups : []).forEach(
      function (g) {
        (Array.isArray(g && g.effects) ? g.effects : []).forEach(function (e) {
          if (e && e.type != null) types.add(String(e.type));
        });
      }
    );
    return {
      accel: /accelerat/.test(d) || types.has('31') || types.has('28') || types.has('8'),
      speed:
        /\bspeed\b|target speed/.test(d) ||
        types.has('27') ||
        types.has('22') ||
        types.has('21') ||
        types.has('1') ||
        types.has('3'),
      recovery:
        /recover|recovery|stamina/.test(d) ||
        types.has('9') ||
        types.has('2') ||
        types.has('5') ||
        types.has('4'),
    };
  }
  function isLateWindow(skill) {
    var gs = Array.isArray(skill && skill.conditionGroups) ? skill.conditionGroups : [];
    for (var i = 0; i < gs.length; i += 1) {
      var t = condText(gs[i]);
      if (!t) continue;
      if (/is_lastspurt|is_finalcorner|is_last_straight/.test(t)) return true;
      var ge = t.match(/distance_rate\s*>=\s*(\d+)/);
      if (ge && parseInt(ge[1], 10) >= 65) return true;
      if (/phase_laterhalf_random/.test(t) && /distance_rate\s*>=\s*60/.test(t)) return true;
    }
    return false;
  }

  function scoreSkillConsistency(skill, raceConfig, tier) {
    var gs = Array.isArray(skill && skill.conditionGroups) ? skill.conditionGroups : [];
    var gScores = [],
      reasons = [],
      tAvg = 0,
      bAvg = 0,
      sAvg = 0,
      volatileRaceDependent = false;
    if (!gs.length) {
      gScores.push(0.58);
      reasons.push(window.t('teamTrials.noTriggerGroups'));
    }
    gs.forEach(function (g) {
      var t = condText(g);
      if (!t) return;
      var ts = timingScore(t),
        bs = breadthScore(t),
        ss = scenarioScore(t);
      var strict = 0;
      if (/order\s*==\s*1/.test(t)) strict += 2;
      if (/blocked_|is_overtake|change_order_onetime/.test(t)) strict += 2;
      if (/phase_random|corner_random|straight_random/.test(t)) strict += 1;
      if (cmpCount(t) >= 5) strict += 1;
      var pen = Math.min(0.24, strict * 0.04);
      var gs0 = clamp(ts * 0.45 + bs * 0.3 + ss * 0.25 - pen, 0.05, 0.99);
      gScores.push(gs0);
      tAvg += ts;
      bAvg += bs;
      sAvg += ss;
      if (fixedSetupDeterministic(t)) {
        gScores.push(Math.max(0.72, gs0));
        reasons.push(window.t('teamTrials.fixedSetup'));
      }
      if (hasVolatileRaceCondition(t)) {
        volatileRaceDependent = true;
        reasons.push(window.t('teamTrials.raceConditionVaries'));
      }
      if (/always\s*==\s*1/.test(t)) reasons.push(window.t('teamTrials.alwaysOn'));
      if (/is_finalcorner|is_lastspurt|is_last_straight/.test(t))
        reasons.push(window.t('teamTrials.lateRace'));
      if (/phase_random|corner_random|straight_random/.test(t))
        reasons.push(window.t('teamTrials.randomTiming'));
      if (/order\s*==\s*1/.test(t)) reasons.push(window.t('teamTrials.strictPlacement'));
      if (/blocked_|is_overtake|change_order_onetime/.test(t))
        reasons.push(window.t('teamTrials.situationalTrigger'));
    });
    var miss = 1;
    gScores.forEach(function (v) {
      miss *= 1 - Math.min(0.97, v * 0.9);
    });
    var c = gScores.length ? 1 - miss : 0.58;
    if (gs.length > 1) {
      c += Math.min(0.08, (gs.length - 1) * 0.03);
      reasons.push(window.t('teamTrials.multipleGroups'));
    }
    c = clamp(c, 0.05, 0.99);
    var tierBonus = 0.5,
      tierTags = [],
      tierNote = '';
    if (tier) {
      tierBonus = clamp(num(tier.tierBonus, 0.5), 0, 1);
      tierTags = Array.isArray(tier.tags) ? tier.tags.slice() : [];
      tierNote = tier.note || '';
      c += num(tier.consistencyAdjustment, 0);
      if (tierTags.indexOf('inconsistent') !== -1) {
        c = Math.min(c, 0.45);
        reasons.push(window.t('teamTrials.inconsistent'));
      } else if (tierTags.indexOf('team_trials') !== -1 || tierTags.indexOf('core') !== -1) {
        c = Math.max(c, 0.65);
        reasons.push(window.t('teamTrials.core'));
      }
    }
    c = clamp(c, 0.05, 0.99);
    var eff = effectBuckets(skill || {}),
      late = isLateWindow(skill);
    return {
      score: Number(c.toFixed(4)),
      breakdown: {
        timing: Number((tAvg / Math.max(1, gScores.length)).toFixed(4)),
        breadth: Number((bAvg / Math.max(1, gScores.length)).toFixed(4)),
        scenario: Number((sAvg / Math.max(1, gScores.length)).toFixed(4)),
      },
      reasons: Array.from(new Set(reasons)).slice(0, 5),
      tierBonus: Number(tierBonus.toFixed(4)),
      tierTags: tierTags,
      tierNote: tierNote,
      hasAccel: !!eff.accel,
      hasSpeed: !!eff.speed,
      hasRecovery: !!eff.recovery,
      isLateWindow: !!late,
      reliableLateAccel: !!(eff.accel && late && c >= 0.58),
      reliableLateSpeed: !!(eff.speed && late && c >= 0.58),
      hasVolatileRaceCondition: volatileRaceDependent,
      isRisky: c < 0.42,
    };
  }

  function lookup(table, key) {
    if (!table || key == null) return null;
    if (typeof table.get === 'function') return table.get(String(key)) || null;
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
  }
  function resolveSkillMeta(item, input) {
    if (item && item.skillMeta) return item.skillMeta;
    var id = item && item.skillId != null ? String(item.skillId) : '';
    if (id) {
      var hit = lookup(input && input.skillMetaById, id);
      if (hit) return hit;
    }
    return lookup(input && input.skillMetaByName, nName(item && item.name));
  }
  function resolveTier(item, skill, input) {
    var id = item && item.skillId != null ? String(item.skillId) : '';
    if (id) {
      var byId = lookup(input && input.tierById, id);
      if (byId) return byId;
    }
    var byNameA = lookup(input && input.tierByName, nName(item && item.name));
    if (byNameA) return byNameA;
    return lookup(input && input.tierByName, nName(skill && skill.name));
  }
  function perSp(rating, cost) {
    var r = Math.max(0, num(rating, 0)),
      c = Math.max(0, Math.floor(num(cost, 0)));
    return c <= 0 ? r : r / c;
  }
  function isGreen(cat) {
    cat = lower(cat);
    return cat === 'green' || cat.indexOf('green') !== -1;
  }
  function hasKeyComparator(text, key) {
    return new RegExp('(?:^|[^a-z0-9_])' + key + '\\s*(==|!=|>=|<=|>|<)', 'i').test(
      String(text || '')
    );
  }
  function parseComparators(segment, key) {
    var src = String(segment || '');
    var comps = [];
    var re = new RegExp('(?:^|[^a-z0-9_])' + key + '\\s*(==|!=|>=|<=|>|<)\\s*(-?\\d+)', 'ig');
    var m;
    while ((m = re.exec(src))) {
      comps.push({ op: m[1], value: parseInt(m[2], 10) });
    }
    return comps;
  }
  function valueMatchesComparators(value, comps) {
    for (var i = 0; i < comps.length; i += 1) {
      var c = comps[i];
      if (c.op === '==' && !(value === c.value)) return false;
      if (c.op === '!=' && !(value !== c.value)) return false;
      if (c.op === '>=' && !(value >= c.value)) return false;
      if (c.op === '<=' && !(value <= c.value)) return false;
      if (c.op === '>' && !(value > c.value)) return false;
      if (c.op === '<' && !(value < c.value)) return false;
    }
    return true;
  }
  function keyAllowsAnyAllowed(text, key, valueMap, allowedSet) {
    if (!allowedSet || !allowedSet.size) return true;
    var src = String(text || '');
    if (!hasKeyComparator(src, key)) return true;
    var segments = src.split(/\|{1,2}/g);
    for (var s = 0; s < segments.length; s += 1) {
      var comps = parseComparators(segments[s], key);
      if (!comps.length) continue;
      for (var raw in valueMap) {
        if (!Object.prototype.hasOwnProperty.call(valueMap, raw)) continue;
        var val = parseInt(raw, 10);
        var mapped = valueMap[raw];
        if (!allowedSet.has(mapped)) continue;
        if (valueMatchesComparators(val, comps)) return true;
      }
    }
    return false;
  }
  function selectFromAptitudes(raceConfig, keys) {
    var cfg = raceConfig || {};
    var ranked = keys.map(function (k) {
      var grade = String(cfg[k] || '').toUpperCase();
      return {
        key: k,
        rank: Object.prototype.hasOwnProperty.call(GRADE_RANK, grade) ? GRADE_RANK[grade] : -1,
      };
    });
    var strong = ranked.filter(function (r) {
      return r.rank >= 5;
    });
    if (strong.length)
      return new Set(
        strong.map(function (r) {
          return r.key;
        })
      );
    var maxRank = ranked.reduce(function (m, r) {
      return Math.max(m, r.rank);
    }, -1);
    if (maxRank < 0) return new Set();
    return new Set(
      ranked
        .filter(function (r) {
          return r.rank === maxRank;
        })
        .map(function (r) {
          return r.key;
        })
    );
  }
  function extractTargets(autoTargets, allowedValues) {
    var values = new Set(allowedValues);
    var out = new Set();
    (Array.isArray(autoTargets) ? autoTargets : []).forEach(function (t) {
      var key = lower(t);
      if (values.has(key)) out.add(key);
    });
    return out;
  }
  function mergeTargetAndAptitude(targetSet, aptitudeSet) {
    var t = targetSet && targetSet.size ? targetSet : null;
    var a = aptitudeSet && aptitudeSet.size ? aptitudeSet : null;
    if (t && a) {
      var inter = new Set();
      t.forEach(function (v) {
        if (a.has(v)) inter.add(v);
      });
      return inter.size ? inter : new Set(t);
    }
    if (t) return new Set(t);
    if (a) return new Set(a);
    return new Set();
  }
  function deriveAllowedContext(input) {
    var cfg = input && input.raceConfig ? input.raceConfig : {};
    var targets = Array.isArray(input && input.autoTargets) ? input.autoTargets : [];
    var targetTrack = extractTargets(targets, ['turf', 'dirt']);
    var targetDistance = extractTargets(targets, ['sprint', 'mile', 'medium', 'long']);
    var targetStyle = extractTargets(targets, ['front', 'pace', 'late', 'end']);
    var aptitudeTrack = selectFromAptitudes(cfg, ['turf', 'dirt']);
    var aptitudeDistance = selectFromAptitudes(cfg, ['sprint', 'mile', 'medium', 'long']);
    var aptitudeStyle = selectFromAptitudes(cfg, ['front', 'pace', 'late', 'end']);
    return {
      track: mergeTargetAndAptitude(targetTrack, aptitudeTrack),
      distance: mergeTargetAndAptitude(targetDistance, aptitudeDistance),
      style: mergeTargetAndAptitude(targetStyle, aptitudeStyle),
    };
  }
  function tagSet(tags) {
    var s = new Set();
    (Array.isArray(tags) ? tags : []).forEach(function (t) {
      s.add(lower(t));
    });
    return s;
  }
  function typeTagRestrictionPasses(skill, allowed) {
    var tags = tagSet(skill && skill.typeTags);
    var distTags = Object.keys(TYPE_DISTANCE_TAG_TO_KEY).filter(function (tag) {
      return tags.has(tag);
    });
    if (distTags.length && allowed.distance && allowed.distance.size) {
      var distOk = distTags.some(function (tag) {
        return allowed.distance.has(TYPE_DISTANCE_TAG_TO_KEY[tag]);
      });
      if (!distOk) return false;
    }
    var groundTags = Object.keys(TYPE_GROUND_TAG_TO_KEY).filter(function (tag) {
      return tags.has(tag);
    });
    if (groundTags.length && allowed.track && allowed.track.size) {
      var groundOk = groundTags.some(function (tag) {
        return allowed.track.has(TYPE_GROUND_TAG_TO_KEY[tag]);
      });
      if (!groundOk) return false;
    }
    var styleTags = Object.keys(TYPE_STYLE_TAG_TO_KEY).filter(function (tag) {
      return tags.has(tag);
    });
    if (styleTags.length && allowed.style && allowed.style.size) {
      var styleOk = styleTags.some(function (tag) {
        return allowed.style.has(TYPE_STYLE_TAG_TO_KEY[tag]);
      });
      if (!styleOk) return false;
    }
    return true;
  }
  function skillIsApplicableToContext(skill, allowed) {
    if (!skill || typeof skill !== 'object') return true;
    var groups = Array.isArray(skill.conditionGroups) ? skill.conditionGroups : [];
    if (!groups.length) return typeTagRestrictionPasses(skill, allowed);
    var sawRestriction = false;
    for (var i = 0; i < groups.length; i += 1) {
      var text = condText(groups[i]);
      var restricted =
        hasKeyComparator(text, 'distance_type') ||
        hasKeyComparator(text, 'ground_type') ||
        hasKeyComparator(text, 'running_style');
      if (restricted) sawRestriction = true;
      var ok =
        keyAllowsAnyAllowed(text, 'distance_type', DISTANCE_VALUE_TO_KEY, allowed.distance) &&
        keyAllowsAnyAllowed(text, 'ground_type', GROUND_VALUE_TO_KEY, allowed.track) &&
        keyAllowsAnyAllowed(text, 'running_style', STYLE_VALUE_TO_KEY, allowed.style);
      if (ok) return true;
    }
    if (sawRestriction) return false;
    return typeTagRestrictionPasses(skill, allowed);
  }
  function applyTeamMetrics(items, input, weights) {
    var maxRating = 1;
    items.forEach(function (it) {
      maxRating = Math.max(maxRating, num(it.ratingScore, 0));
    });
    var missMeta = 0;
    var out = items.map(function (it) {
      var skill = resolveSkillMeta(it, input);
      if (!skill) missMeta += 1;
      var tier = resolveTier(it, skill, input);
      var c = scoreSkillConsistency(
        skill || { conditionGroups: [], desc: '', name: it.name || '' },
        input && input.raceConfig,
        tier
      );
      var rating = Math.max(0, Math.floor(num(it.ratingScore, 0)));
      var cost = Math.max(0, Math.floor(num(it.cost, 0)));
      var ratio = perSp(rating, cost);
      var rNorm = clamp(rating / maxRating, 0, 1);
      var extraPen = 0;
      var expectedMul = 1;
      var scoreReasons = Array.isArray(c.reasons) ? c.reasons.slice() : [];
      var tierTags = Array.isArray(c.tierTags) ? c.tierTags : [];
      if (isGreen(it.category)) {
        extraPen += num(weights.greenSkillConsistencyPenalty, 0);
        expectedMul *= 1 - clamp(num(weights.greenSkillExpectedPenalty, 0), 0, 0.8);
        scoreReasons.unshift(window.t('teamTrials.greenDownweighted'));
      }
      if (c.hasVolatileRaceCondition) {
        extraPen += num(weights.volatileRaceConditionConsistencyPenalty, 0);
        expectedMul *= 1 - clamp(num(weights.volatileRaceConditionExpectedPenalty, 0), 0, 0.8);
      }
      if (
        extraPen > 0 &&
        (tierTags.indexOf('team_trials') !== -1 || tierTags.indexOf('core') !== -1)
      ) {
        extraPen *= clamp(num(weights.tierCorePenaltyReduction, 0.5), 0, 1);
      }
      var consistencyScore = clamp(c.score - extraPen, 0.05, 0.99);
      var goldConsistencyThreshold = clamp(num(weights.consistentGoldMinConsistency, 0.58), 0, 1);
      var getsGoldPriority =
        isGold(it.category) &&
        !c.hasVolatileRaceCondition &&
        consistencyScore >= goldConsistencyThreshold;
      if (getsGoldPriority) {
        consistencyScore = clamp(
          consistencyScore + num(weights.consistentGoldConsistencyBonus, 0),
          0.05,
          0.99
        );
        scoreReasons.unshift(window.t('teamTrials.consistentGoldPrioritized'));
      }
      var expected =
        (weights.consistency * consistencyScore + weights.tier * c.tierBonus) *
        (weights.efficiency * ratio + weights.rating * rNorm);
      expected *= clamp(expectedMul, 0.2, 1);
      if (getsGoldPriority) expected += Math.max(0, num(weights.consistentGoldExpectedBonus, 0));
      if (c.reliableLateAccel) expected += weights.coreAccelBonus;
      if (c.reliableLateSpeed) expected += weights.coreSpeedBonus;
      var coreMask = 0;
      if (c.reliableLateAccel) coreMask |= CORE_MASK_ACCEL;
      if (c.reliableLateSpeed) coreMask |= CORE_MASK_SPEED;
      return Object.assign({}, it, {
        consistencyScore: consistencyScore,
        consistencyReasons: Array.from(new Set(scoreReasons)),
        consistencyBreakdown: c.breakdown,
        tierBonus: c.tierBonus,
        tierNote: c.tierNote || '',
        tierTags: tierTags,
        scorePerSP: ratio,
        expectedValue: expected,
        expectedValueInt: Math.round(expected * 10000),
        consistencyInt: Math.round(consistencyScore * 1000),
        consistentGoldPriority: !!getsGoldPriority,
        consistentGoldInt: getsGoldPriority ? 1 : 0,
        coreMask: coreMask,
        isRisky: !!c.isRisky || consistencyScore < 0.42,
        normalizedSkill: skill || null,
        hasAccel: !!c.hasAccel,
        hasSpeed: !!c.hasSpeed,
      });
    });
    return { items: out, missingMeta: missMeta };
  }

  function isGold(cat) {
    cat = lower(cat);
    return cat === 'gold' || cat === 'golden' || cat.indexOf('gold') !== -1;
  }

  function buildGroups(items) {
    var idToIdx = new Map(
      items.map(function (it, idx) {
        return [it.id, idx];
      })
    );
    var used = new Array(items.length).fill(false),
      groups = [];
    function findIdxBySkillId(skillId, preferredRowId) {
      if (skillId == null || skillId === '') return null;
      var sid = String(skillId);
      if (preferredRowId && idToIdx.has(preferredRowId)) {
        var pidx = idToIdx.get(preferredRowId);
        if (
          pidx != null &&
          !used[pidx] &&
          String((items[pidx] && items[pidx].skillId) || '') === sid
        )
          return pidx;
      }
      for (var k = 0; k < items.length; k += 1) {
        if (used[k]) continue;
        if (String((items[k] && items[k].skillId) || '') === sid) return k;
      }
      return null;
    }
    var processOrder = items
      .map(function (it, idx) {
        var hasParent = Array.isArray(it.parentSkillIds) && it.parentSkillIds.length;
        var hasLower = !!it.lowerSkillId;
        var hasCircleLink = !!it.circleRowId;
        var goldWithLinkedLower = !!(
          isGold(it.category) &&
          it.lowerRowId &&
          idToIdx.has(it.lowerRowId)
        );
        var priority = goldWithLinkedLower || hasCircleLink || hasParent || hasLower ? 0 : 1;
        return { idx: idx, priority: priority };
      })
      .sort(function (a, b) {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.idx - b.idx;
      });
    for (var oi = 0; oi < processOrder.length; oi += 1) {
      var i = processOrder[oi].idx;
      if (used[i]) continue;
      var it = items[i],
        handled = false;
      if (isGold(it.category) && it.lowerRowId && idToIdx.has(it.lowerRowId)) {
        var linkedLowerIdx = idToIdx.get(it.lowerRowId);
        if (linkedLowerIdx != null && !used[linkedLowerIdx]) {
          var linkedLower = items[linkedLowerIdx];
          groups.push([
            {
              none: true,
              cost: 0,
              value: 0,
              consistency: 0,
              rating: 0,
              gold: 0,
              coreMask: 0,
              items: [],
            },
            {
              pick: linkedLowerIdx,
              cost: linkedLower.cost,
              value: linkedLower.expectedValueInt,
              consistency: linkedLower.consistencyInt,
              rating: linkedLower.ratingScore || 0,
              gold: linkedLower.consistentGoldInt || 0,
              coreMask: linkedLower.coreMask || 0,
              items: [linkedLowerIdx],
            },
            {
              combo: [linkedLowerIdx, i],
              cost: it.cost,
              value: it.expectedValueInt,
              consistency: it.consistencyInt,
              rating: it.ratingScore || 0,
              gold: it.consistentGoldInt || 0,
              coreMask: it.coreMask || 0,
              items: [linkedLowerIdx, i],
            },
          ]);
          used[i] = used[linkedLowerIdx] = true;
          continue;
        }
      }
      if (it.circleRowId && idToIdx.has(it.circleRowId)) {
        var circleIdx = idToIdx.get(it.circleRowId);
        if (circleIdx != null && !used[circleIdx]) {
          var up = items[circleIdx];
          groups.push([
            {
              none: true,
              cost: 0,
              value: 0,
              consistency: 0,
              rating: 0,
              gold: 0,
              coreMask: 0,
              items: [],
            },
            {
              pick: i,
              cost: it.cost,
              value: it.expectedValueInt,
              consistency: it.consistencyInt,
              rating: it.ratingScore || 0,
              gold: it.consistentGoldInt || 0,
              coreMask: it.coreMask || 0,
              items: [i],
            },
            {
              combo: [i, circleIdx],
              cost: it.cost + up.cost,
              value: up.expectedValueInt,
              consistency: up.consistencyInt,
              rating: up.ratingScore || 0,
              gold: up.consistentGoldInt || 0,
              coreMask: up.coreMask || 0,
              items: [i, circleIdx],
            },
          ]);
          used[i] = used[circleIdx] = true;
          continue;
        }
      }
      var parents = [];
      if (Array.isArray(it.parentSkillIds) && it.parentSkillIds.length)
        parents = parents.concat(it.parentSkillIds);
      if (it.lowerSkillId && !(isGold(it.category) && it.lowerRowId && idToIdx.has(it.lowerRowId)))
        parents.push(it.lowerSkillId);
      var pid = parents.find(function (x) {
        return findIdxBySkillId(x, '') != null;
      });
      if (pid != null) {
        var preferredParentId = isGold(it.category) ? it.lowerRowId : '';
        var j = findIdxBySkillId(pid, preferredParentId);
        if (j != null && j !== i && !used[j]) {
          var p = items[j];
          var comboCost =
            isGold(it.category) && it.lowerRowId && it.lowerRowId === p.id
              ? it.cost
              : p.cost + it.cost;
          groups.push([
            {
              none: true,
              cost: 0,
              value: 0,
              consistency: 0,
              rating: 0,
              gold: 0,
              coreMask: 0,
              items: [],
            },
            {
              pick: j,
              cost: p.cost,
              value: p.expectedValueInt,
              consistency: p.consistencyInt,
              rating: p.ratingScore || 0,
              gold: p.consistentGoldInt || 0,
              coreMask: p.coreMask || 0,
              items: [j],
            },
            {
              combo: [j, i],
              cost: comboCost,
              value: it.expectedValueInt,
              consistency: it.consistencyInt,
              rating: it.ratingScore || 0,
              gold: it.consistentGoldInt || 0,
              coreMask: it.coreMask || 0,
              items: [j, i],
            },
          ]);
          used[i] = used[j] = true;
          handled = true;
        }
      }
      if (handled) continue;
      groups.push([
        {
          none: true,
          cost: 0,
          value: 0,
          consistency: 0,
          rating: 0,
          gold: 0,
          coreMask: 0,
          items: [],
        },
        {
          pick: i,
          cost: it.cost,
          value: it.expectedValueInt,
          consistency: it.consistencyInt,
          rating: it.ratingScore || 0,
          gold: it.consistentGoldInt || 0,
          coreMask: it.coreMask || 0,
          items: [i],
        },
      ]);
      used[i] = true;
    }
    return groups;
  }

  function expandRequired(items) {
    var idToIdx = new Map(
      items.map(function (it, idx) {
        return [it.id, idx];
      })
    );
    var skillIdToIdx = new Map(),
      parentGoldToChild = new Map();
    items.forEach(function (it, idx) {
      if (it.skillId != null && it.skillId !== '') skillIdToIdx.set(String(it.skillId), idx);
      if (it.parentGoldId) parentGoldToChild.set(it.parentGoldId, idx);
    });
    var reqIds = new Set(
      items
        .filter(function (it) {
          return !!it.required;
        })
        .map(function (it) {
          return it.id;
        })
    );
    var changed = true;
    while (changed) {
      changed = false;
      Array.from(reqIds).forEach(function (id) {
        var idx = idToIdx.get(id);
        if (idx == null) return;
        var it = items[idx];
        if (it.lowerRowId && idToIdx.has(it.lowerRowId) && !reqIds.has(it.lowerRowId)) {
          reqIds.add(it.lowerRowId);
          changed = true;
        }
        if (it.lowerSkillId != null && it.lowerSkillId !== '') {
          var li = skillIdToIdx.get(String(it.lowerSkillId));
          if (li != null) {
            var lid = items[li] && items[li].id;
            if (lid && !reqIds.has(lid)) {
              reqIds.add(lid);
              changed = true;
            }
          }
        }
        (Array.isArray(it.parentSkillIds) ? it.parentSkillIds : []).forEach(function (pid) {
          var pi = skillIdToIdx.get(String(pid));
          if (pi == null) return;
          var pId = items[pi] && items[pi].id;
          if (pId && !reqIds.has(pId)) {
            reqIds.add(pId);
            changed = true;
          }
        });
        if (it.id && parentGoldToChild.has(it.id)) {
          var ci = parentGoldToChild.get(it.id),
            cId = items[ci] && items[ci].id;
          if (cId && !reqIds.has(cId)) {
            reqIds.add(cId);
            changed = true;
          }
        }
      });
    }
    var reqItems = items.filter(function (it) {
      return reqIds.has(it.id);
    });
    var reqGold = new Set(
      reqItems
        .filter(function (it) {
          return isGold(it.category);
        })
        .map(function (it) {
          return it.id;
        })
    );
    var lowerIncluded = new Set();
    reqItems.forEach(function (it) {
      if (!reqGold.has(it.id)) return;
      if (it.lowerRowId && reqIds.has(it.lowerRowId)) lowerIncluded.add(it.lowerRowId);
      if (it.lowerSkillId != null && it.lowerSkillId !== '') {
        var li = skillIdToIdx.get(String(it.lowerSkillId));
        if (li != null) {
          var lid = items[li] && items[li].id;
          if (lid && reqIds.has(lid)) lowerIncluded.add(lid);
        }
      }
      if (it.id && parentGoldToChild.has(it.id)) {
        var ci = parentGoldToChild.get(it.id),
          cId = items[ci] && items[ci].id;
        if (cId && reqIds.has(cId)) lowerIncluded.add(cId);
      }
    });
    var reqCost = 0,
      reqExpected = 0,
      reqCore = 0;
    reqItems.forEach(function (it) {
      if (lowerIncluded.has(it.id)) return;
      reqCost += Math.max(0, Math.floor(num(it.cost, 0)));
      reqExpected += Math.max(0, Math.floor(num(it.expectedValueInt, 0)));
      reqCore |= it.coreMask || 0;
    });
    return {
      requiredIds: reqIds,
      requiredItems: reqItems,
      requiredCost: reqCost,
      requiredExpected: reqExpected,
      requiredCoreMask: reqCore,
    };
  }

  function better(cand, curr) {
    // Team Trials priority:
    // 1) Highest aggregate consistency
    // 2) Highest count of consistent gold skills
    // 3) Highest expected value
    // 4) Highest rating
    if (cand.consistency !== curr.consistency) return cand.consistency > curr.consistency;
    if (cand.gold !== curr.gold) return cand.gold > curr.gold;
    if (cand.value !== curr.value) return cand.value > curr.value;
    if (cand.rating !== curr.rating) return cand.rating > curr.rating;
    return cand.tie < curr.tie;
  }

  function optimizeGroups(groups, items, budget, reqMask) {
    var B = Math.max(0, Math.floor(num(budget, 0))),
      G = groups.length,
      NEG = -1e15;
    var vPrev = Array.from({ length: 4 }, function () {
      return new Array(B + 1).fill(NEG);
    });
    var cPrev = Array.from({ length: 4 }, function () {
      return new Array(B + 1).fill(NEG);
    });
    var gPrev = Array.from({ length: 4 }, function () {
      return new Array(B + 1).fill(NEG);
    });
    var rPrev = Array.from({ length: 4 }, function () {
      return new Array(B + 1).fill(NEG);
    });
    for (var b = 0; b <= B; b += 1) {
      vPrev[0][b] = 0;
      cPrev[0][b] = 0;
      gPrev[0][b] = 0;
      rPrev[0][b] = 0;
    }
    var choiceK = Array.from({ length: G + 1 }, function () {
      return Array.from({ length: 4 }, function () {
        var a = new Int16Array(B + 1);
        a.fill(-1);
        return a;
      });
    });
    var choiceMask = Array.from({ length: G + 1 }, function () {
      return Array.from({ length: 4 }, function () {
        var a = new Int8Array(B + 1);
        a.fill(-1);
        return a;
      });
    });
    for (var g = 1; g <= G; g += 1) {
      var opts = groups[g - 1];
      var vCur = Array.from({ length: 4 }, function () {
        return new Array(B + 1).fill(NEG);
      });
      var cCur = Array.from({ length: 4 }, function () {
        return new Array(B + 1).fill(NEG);
      });
      var gCur = Array.from({ length: 4 }, function () {
        return new Array(B + 1).fill(NEG);
      });
      var rCur = Array.from({ length: 4 }, function () {
        return new Array(B + 1).fill(NEG);
      });
      for (var pm = 0; pm < 4; pm += 1) {
        for (var pb = 0; pb <= B; pb += 1) {
          if (vPrev[pm][pb] <= NEG / 2) continue;
          for (var k = 0; k < opts.length; k += 1) {
            var o = opts[k],
              w = Math.max(0, Math.floor(num(o.cost, 0))),
              nb = pb + w;
            if (nb > B) continue;
            var nm = pm | (o.coreMask || 0);
            var cand = {
              value: vPrev[pm][pb] + Math.max(0, Math.floor(num(o.value, 0))),
              consistency: cPrev[pm][pb] + Math.max(0, Math.floor(num(o.consistency, 0))),
              gold: gPrev[pm][pb] + Math.max(0, Math.floor(num(o.gold, 0))),
              rating: rPrev[pm][pb] + Math.max(0, Math.floor(num(o.rating, 0))),
              tie: k,
            };
            var curr = {
              value: vCur[nm][nb],
              consistency: cCur[nm][nb],
              gold: gCur[nm][nb],
              rating: rCur[nm][nb],
              tie: choiceK[g][nm][nb] === -1 ? 999 : choiceK[g][nm][nb],
            };
            if (better(cand, curr)) {
              vCur[nm][nb] = cand.value;
              cCur[nm][nb] = cand.consistency;
              gCur[nm][nb] = cand.gold;
              rCur[nm][nb] = cand.rating;
              choiceK[g][nm][nb] = k;
              choiceMask[g][nm][nb] = pm;
            }
          }
        }
      }
      vPrev = vCur;
      cPrev = cCur;
      gPrev = gCur;
      rPrev = rCur;
    }
    function bestState(maskNeed) {
      var best = null;
      for (var m = 0; m < 4; m += 1) {
        if ((m & maskNeed) !== maskNeed) continue;
        for (var bb = 0; bb <= B; bb += 1) {
          if (vPrev[m][bb] <= NEG / 2) continue;
          var cand = {
            m: m,
            b: bb,
            v: vPrev[m][bb],
            c: cPrev[m][bb],
            g: gPrev[m][bb],
            r: rPrev[m][bb],
          };
          if (
            !best ||
            cand.c > best.c ||
            (cand.c === best.c && cand.g > best.g) ||
            (cand.c === best.c && cand.g === best.g && cand.v > best.v) ||
            (cand.c === best.c && cand.g === best.g && cand.v === best.v && cand.r > best.r) ||
            (cand.c === best.c &&
              cand.g === best.g &&
              cand.v === best.v &&
              cand.r === best.r &&
              cand.b < best.b)
          ) {
            best = cand;
          }
        }
      }
      return best;
    }
    var full = bestState(reqMask || 0),
      met = true;
    if (!full && (reqMask || 0) !== 0) {
      full = bestState(0);
      met = false;
    }
    if (!full)
      return {
        error: 'required_unreachable',
        chosen: [],
        used: 0,
        value: 0,
        gold: 0,
        mask: 0,
        metRequiredMask: false,
      };
    var chosen = [],
      cm = full.m,
      cb = full.b;
    for (var gb = G; gb >= 1; gb -= 1) {
      var kk = choiceK[gb][cm][cb];
      if (kk < 0) continue;
      var opt = groups[gb - 1][kk];
      if (opt && opt.combo) {
        var picks = opt.combo.slice(),
          baseIdx = picks[picks.length - 1],
          base = items[baseIdx];
        if (base) {
          chosen.push(
            Object.assign({}, base, {
              cost: opt.cost,
              combo: true,
              components: picks
                .map(function (ix) {
                  return items[ix] && items[ix].id;
                })
                .filter(Boolean),
            })
          );
          var parentName = base.name;
          for (var c = 0; c < picks.length - 1; c += 1) {
            var comp = items[picks[c]];
            if (comp)
              chosen.push(
                Object.assign({}, comp, {
                  cost: 0,
                  expectedValue: 0,
                  expectedValueInt: 0,
                  consistencyScore: 0,
                  consistencyInt: 0,
                  ratingScore: 0,
                  comboComponent: true,
                  comboParentName: parentName,
                })
              );
          }
        }
      } else if (opt && opt.pick != null) {
        var p = items[opt.pick];
        if (p) chosen.push(Object.assign({}, p));
      }
      var pm2 = choiceMask[gb][cm][cb];
      if (pm2 < 0) pm2 = 0;
      cb = Math.max(0, cb - Math.max(0, Math.floor(num(opt && opt.cost, 0))));
      cm = pm2;
    }
    chosen.reverse();
    return {
      error: null,
      chosen: chosen,
      used: full.b,
      value: full.v,
      gold: full.g,
      mask: full.m,
      metRequiredMask: met,
    };
  }

  function collectLowerPrereqIdsInGoldCombos(chosen) {
    var byId = new Map(),
      bySkillId = new Map();
    (Array.isArray(chosen) ? chosen : []).forEach(function (it) {
      if (!it || !it.id) return;
      byId.set(it.id, it);
      if (it.skillId != null && it.skillId !== '') bySkillId.set(String(it.skillId), it);
    });
    var lowerInGold = new Set();
    (Array.isArray(chosen) ? chosen : []).forEach(function (g) {
      if (!g || !isGold(g.category)) return;
      if (g.lowerRowId && byId.has(g.lowerRowId)) lowerInGold.add(g.lowerRowId);
      if (g.lowerSkillId != null && g.lowerSkillId !== '') {
        var l = bySkillId.get(String(g.lowerSkillId));
        if (l) lowerInGold.add(l.id);
      }
    });
    (Array.isArray(chosen) ? chosen : []).forEach(function (it) {
      if (it && it.parentGoldId && byId.has(it.parentGoldId)) lowerInGold.add(it.id);
    });
    (Array.isArray(chosen) ? chosen : []).forEach(function (g) {
      if (!g || !isGold(g.category)) return;
      var parentIds = Array.isArray(g.parentSkillIds) ? g.parentSkillIds : [];
      parentIds.forEach(function (pid) {
        var lower = bySkillId.get(String(pid));
        if (lower) lowerInGold.add(lower.id);
      });
    });
    return lowerInGold;
  }

  function totals(chosen) {
    var lowerInGold = collectLowerPrereqIdsInGoldCombos(chosen);
    var rating = 0,
      cSum = 0,
      expected = 0,
      count = 0,
      consistentGoldCount = 0;
    (Array.isArray(chosen) ? chosen : []).forEach(function (it) {
      if (!it || it.comboComponent || lowerInGold.has(it.id)) return;
      rating += Math.max(0, Math.floor(num(it.ratingScore, 0)));
      cSum += clamp(num(it.consistencyScore, 0), 0, 1);
      expected += Math.max(0, num(it.expectedValue, 0));
      if (it.consistentGoldPriority) consistentGoldCount += 1;
      count += 1;
    });
    return {
      rating: rating,
      consistency: count ? cSum / count : 0,
      cSum: cSum,
      expected: expected,
      count: count,
      consistentGoldCount: consistentGoldCount,
    };
  }

  function explain(chosen, total, warnings) {
    var lowerInGold = collectLowerPrereqIdsInGoldCombos(chosen);
    var strengths = [],
      risks = [],
      accel = false,
      speed = false,
      high = 0,
      risky = [];
    (Array.isArray(chosen) ? chosen : []).forEach(function (it) {
      if (!it || it.comboComponent || lowerInGold.has(it.id)) return;
      if ((it.coreMask || 0) & CORE_MASK_ACCEL) accel = true;
      if ((it.coreMask || 0) & CORE_MASK_SPEED) speed = true;
      if (num(it.consistencyScore, 0) >= 0.65) high += 1;
      if (it.isRisky) risky.push(it.name);
    });
    if (accel) strengths.push(window.t('teamTrials.reliableAccel'));
    if (speed) strengths.push(window.t('teamTrials.reliableSpeed'));
    if (high >= 3) strengths.push(window.t('teamTrials.multipleHighProc'));
    if (num(total && total.consistentGoldCount, 0) > 0)
      strengths.push(window.t('teamTrials.prioritizesConsistent'));
    strengths.push(
      window.t('teamTrials.averageConsistency', {
        score: Math.round(clamp(total.consistency, 0, 1) * 100),
      })
    );
    risky.forEach(function (n) {
      risks.push(window.t('teamTrials.riskyPick', { name: n }));
    });
    (Array.isArray(warnings) ? warnings : []).forEach(function (w) {
      if (typeof w === 'string') risks.push(w);
    });
    return { strengths: strengths, risks: risks.slice(0, 8) };
  }

  function optimizeTeamTrialsBuild(input, options) {
    var cfg = input || {},
      opts = options || {};
    var w = Object.assign({}, DEFAULT_WEIGHTS, opts.weights || {});
    var warnings = [];
    var budget = Math.max(0, Math.floor(num(cfg.budget, 0)));
    var src = Array.isArray(cfg.items) ? cfg.items.slice() : [];
    if (!src.length) {
      return {
        error: 'no_items',
        chosen: [],
        used: 0,
        best: 0,
        totalRatingScore: 0,
        consistencyScore: 0,
        perSkillBreakdown: [],
        warnings: [window.t('teamTrials.noCandidates')],
        explain: { strengths: [], risks: [] },
      };
    }
    var met = applyTeamMetrics(src, cfg, w),
      items = met.items;
    var allowedContext = deriveAllowedContext(cfg);
    var filteredOutCount = 0;
    var requiredMismatch = [];
    items = items.filter(function (it) {
      var applicable = skillIsApplicableToContext(it.normalizedSkill, allowedContext);
      if (applicable) return true;
      filteredOutCount += 1;
      if (it.required) requiredMismatch.push(it.name);
      return false;
    });
    if (filteredOutCount > 0) {
      warnings.push(window.t('teamTrials.filteredSkills', { count: filteredOutCount }));
    }
    if (requiredMismatch.length) {
      var uniqueRequiredMismatch = Array.from(new Set(requiredMismatch));
      warnings.push(
        window.t('teamTrials.ignoredRequired', { names: uniqueRequiredMismatch.join(', ') })
      );
    }
    if (!items.length) {
      return {
        error: 'no_applicable_skills',
        chosen: [],
        used: 0,
        best: 0,
        totalRatingScore: 0,
        consistencyScore: 0,
        perSkillBreakdown: [],
        warnings: [window.t('teamTrials.noMatchTargets')],
        explain: {
          strengths: [],
          risks: [window.t('teamTrials.noMatchTargets')],
        },
      };
    }
    if (met.missingMeta > 0) warnings.push(window.t('teamTrials.fallbackHeuristics'));
    var req = expandRequired(items);
    if (req.requiredCost > budget) {
      return {
        error: 'required_unreachable',
        chosen: [],
        used: 0,
        best: 0,
        totalRatingScore: 0,
        consistencyScore: 0,
        perSkillBreakdown: [],
        warnings: [window.t('teamTrials.requiredExceedBudget')],
        explain: { strengths: [], risks: [window.t('teamTrials.requiredExceedBudget')] },
      };
    }
    var optional = items.filter(function (it) {
      return !req.requiredIds.has(it.id);
    });
    var availableMask = 0;
    items.forEach(function (it) {
      availableMask |= it.coreMask || 0;
    });
    var neededMask = availableMask & ~req.requiredCoreMask & (CORE_MASK_ACCEL | CORE_MASK_SPEED);
    var groupResult = optimizeGroups(
      buildGroups(optional),
      optional,
      budget - req.requiredCost,
      neededMask
    );
    if (groupResult.error) {
      return {
        error: groupResult.error,
        chosen: [],
        used: 0,
        best: 0,
        totalRatingScore: 0,
        consistencyScore: 0,
        perSkillBreakdown: [],
        warnings: [window.t('teamTrials.noFeasibleSolution')],
        explain: {
          strengths: [],
          risks: [window.t('teamTrials.noFeasibleSolution')],
        },
      };
    }
    if (!groupResult.metRequiredMask && neededMask !== 0) {
      if (neededMask & CORE_MASK_ACCEL) warnings.push(window.t('teamTrials.noReliableAccel'));
      if (neededMask & CORE_MASK_SPEED) warnings.push(window.t('teamTrials.noReliableSpeed'));
    }
    var chosen = [],
      seen = new Set();
    req.requiredItems.forEach(function (it) {
      if (it && it.id && !seen.has(it.id)) {
        seen.add(it.id);
        chosen.push(Object.assign({}, it));
      }
    });
    groupResult.chosen.forEach(function (it) {
      if (it && it.id && !seen.has(it.id)) {
        seen.add(it.id);
        chosen.push(it);
      }
    });
    var t = totals(chosen);
    if (t.count === 0) warnings.push(window.t('teamTrials.noScoredSkills'));
    var perSkill = chosen.map(function (it) {
      var rating = Math.max(0, Math.floor(num(it.ratingScore, 0)));
      var cost = Math.max(0, Math.floor(num(it.cost, 0)));
      return {
        id: it.id,
        name: it.name,
        skillId: it.skillId != null ? String(it.skillId) : '',
        cost: cost,
        ratingScore: rating,
        scorePerSP: Number(perSp(rating, cost).toFixed(4)),
        consistencyScore: Number(clamp(num(it.consistencyScore, 0), 0, 1).toFixed(4)),
        tierBonus: Number(clamp(num(it.tierBonus, 0), 0, 1).toFixed(4)),
        expectedValue: Number(Math.max(0, num(it.expectedValue, 0)).toFixed(6)),
        tierNote: it.tierNote || '',
        reasons: Array.isArray(it.consistencyReasons) ? it.consistencyReasons.slice(0, 4) : [],
        isRisky: !!it.isRisky,
        consistentGoldPriority: !!it.consistentGoldPriority,
        comboComponent: !!it.comboComponent,
        comboParentName: it.comboParentName || '',
      };
    });
    return {
      error: null,
      chosen: chosen,
      used: req.requiredCost + groupResult.used,
      best: t.rating,
      totalRatingScore: t.rating,
      totalExpectedValue: Math.max(0, (req.requiredExpected + groupResult.value) / 10000),
      consistencyScore: clamp(t.consistency, 0, 1),
      consistencySum: t.cSum,
      consistentGoldCount: t.consistentGoldCount,
      perSkillBreakdown: perSkill,
      warnings: warnings,
      explain: explain(chosen, t, warnings),
    };
  }

  return {
    CORE_MASK_ACCEL: CORE_MASK_ACCEL,
    CORE_MASK_SPEED: CORE_MASK_SPEED,
    DEFAULT_WEIGHTS: DEFAULT_WEIGHTS,
    parseCSV: csvParse,
    normalizeSkill: normalizeSkill,
    buildEnglishSkillIndex: buildEnglishSkillIndex,
    scoreSkillConsistency: scoreSkillConsistency,
    optimizeTeamTrialsBuild: optimizeTeamTrialsBuild,
    timingScore: timingScore,
    breadthScore: breadthScore,
    scenarioScore: scenarioScore,
    effectBuckets: effectBuckets,
    isLateWindow: isLateWindow,
    condText: condText,
    nName: nName,
    clamp: clamp,
  };
});

// Automated skill scoring and tiering for Team Trials optimization
// Replaces manual skill_tiers.csv with data-driven analysis of skills_all.json
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SkillScorer = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Effect type weights — how valuable each effect category is for Team Trials
  // ---------------------------------------------------------------------------
  var EFFECT_TYPE_WEIGHTS = {
    '31': 1.4,   // Acceleration (direct)
    '28': 1.3,   // Acceleration (variant)
    '8':  1.2,   // Acceleration (variant)
    '27': 1.0,   // Target Speed (direct)
    '22': 0.95,  // Target Speed (variant)
    '21': 0.90,  // Target Speed (variant)
    '1':  0.85,  // Speed (raw)
    '3':  0.80,  // Speed (variant)
    '29': 0.60,  // Deceleration protection
    '9':  0.55,  // Stamina recovery
    '2':  0.50,  // HP recovery
    '5':  0.45,  // HP recovery (variant)
    '4':  0.40,  // HP recovery (variant)
    '32': 0.35,  // Opponent debuff
    '10': 0.30,  // Lane change
    '14': 0.30,  // Pace control
    '35': 0.25,  // Special/competition
    '37': 0.25,
    '38': 0.25,
    '41': 0.25,
    '42': 0.25,
    '13': 0.20,  // Field of View
    '6':  0.15,  // Other
  };

  // Reference values per effect category for normalization
  var EFFECT_CATEGORY = {
    accel:    { types: ['31', '28', '8'], ref: 3500 },
    velocity: { types: ['27', '22', '21', '1', '3'], ref: 3500 },
    recovery: { types: ['9', '2', '5', '4'], ref: 550 },
    decel:    { types: ['29'], ref: 3500 },
    debuff:   { types: ['32'], ref: 3500 },
    stat:     { types: [], ref: 150000 },  // 500+ type IDs
    misc:     { types: ['10', '14', '13', '6', '35', '37', '38', '41', '42'], ref: 1000 },
  };

  // Build a quick lookup: effect type → reference value
  var TYPE_TO_REF = {};
  Object.keys(EFFECT_CATEGORY).forEach(function (cat) {
    EFFECT_CATEGORY[cat].types.forEach(function (t) {
      TYPE_TO_REF[t] = EFFECT_CATEGORY[cat].ref;
    });
  });

  var DEFAULT_SCORING_WEIGHTS = {
    effectImpact: 0.35,
    applicability: 0.15,
    costEfficiency: 0.20,
    consistency: 0.20,
    duration: 0.10,
  };

  var DISTANCE_TAGS = ['sho', 'mil', 'med', 'lng'];
  var SURFACE_TAGS = ['tur', 'dir'];
  var STYLE_TAGS = ['run', 'ldr', 'btw', 'cha'];

  var DISTANCE_TAG_LABELS = { sho: 'Sprint', mil: 'Mile', med: 'Medium', lng: 'Long' };
  var SURFACE_TAG_LABELS = { tur: 'Turf', dir: 'Dirt' };
  var STYLE_TAG_LABELS = { run: 'Front', ldr: 'Pace', btw: 'Late', cha: 'End' };

  // Helpers from TeamTrialsOptimizer (resolved at call time)
  function TTO() { return (typeof window !== 'undefined' && window.TeamTrialsOptimizer) || {}; }

  function clamp(v, lo, hi) {
    var fn = TTO().clamp;
    return fn ? fn(v, lo, hi) : Math.max(lo, Math.min(hi, v));
  }
  function nName(v) {
    var fn = TTO().nName;
    return fn ? fn(v) : String(v || '').trim().toLowerCase()
      .replace(/[\u25ce\u25cb\u00d7]/g, '')
      .replace(/[\[\]\(\)!'".,:;+*/\\-]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function condText(g) {
    var fn = TTO().condText;
    return fn ? fn(g) : [
      (g && typeof g.condition === 'string') ? g.condition : '',
      (g && typeof g.precondition === 'string') ? g.precondition : ''
    ].filter(Boolean).join(' & ');
  }

  // ---------------------------------------------------------------------------
  // Effect Impact scoring
  // ---------------------------------------------------------------------------
  function effectTypeRef(typeId) {
    var t = String(typeId);
    if (TYPE_TO_REF[t]) return TYPE_TO_REF[t];
    // Stat boost types (500+)
    if (parseInt(t, 10) >= 500) return EFFECT_CATEGORY.stat.ref;
    return EFFECT_CATEGORY.misc.ref;
  }

  function effectTypeWeight(typeId) {
    var t = String(typeId);
    if (EFFECT_TYPE_WEIGHTS[t] != null) return EFFECT_TYPE_WEIGHTS[t];
    if (parseInt(t, 10) >= 500) return 0.15; // stat boost
    return 0.15; // unknown
  }

  function groupImpactScore(group) {
    var effects = (group && Array.isArray(group.effects)) ? group.effects : [];
    if (!effects.length) return 0;
    var score = 0;
    effects.forEach(function (e) {
      if (!e || e.type == null) return;
      var w = effectTypeWeight(e.type);
      var ref = effectTypeRef(e.type);
      var normVal = clamp(Math.abs(e.value || 0) / ref, 0, 2.0);
      score += w * normVal;
    });
    var baseTime = (group && typeof group.base_time === 'number') ? group.base_time : 0;
    var durationFactor = clamp(baseTime / 30000, 0.3, 2.5);
    return score * durationFactor;
  }

  function scoreEffectImpact(conditionGroups) {
    if (!Array.isArray(conditionGroups) || !conditionGroups.length) return 0;
    var groupScores = conditionGroups.map(groupImpactScore);
    var maxScore = Math.max.apply(Math, groupScores.concat([0]));
    var multiGroupBonus = Math.min(0.15, (conditionGroups.length - 1) * 0.05);
    // Normalize: empirical max around 3.0 for strongest skills
    return clamp((maxScore * (1 + multiGroupBonus)) / 3.0, 0, 1);
  }

  // ---------------------------------------------------------------------------
  // Applicability scoring
  // ---------------------------------------------------------------------------
  function applicabilityFromTags(typeTags) {
    var tags = new Set(Array.isArray(typeTags) ? typeTags.map(function (t) { return String(t).toLowerCase(); }) : []);
    var isUniversal = tags.has('nac');

    var distMatches = DISTANCE_TAGS.filter(function (t) { return tags.has(t); });
    var surfMatches = SURFACE_TAGS.filter(function (t) { return tags.has(t); });
    var styleMatches = STYLE_TAGS.filter(function (t) { return tags.has(t); });

    var distScore = (isUniversal || distMatches.length === 0) ? 1.0 : distMatches.length / DISTANCE_TAGS.length;
    var surfScore = (isUniversal || surfMatches.length === 0) ? 1.0 : surfMatches.length / SURFACE_TAGS.length;
    var styleScore = (isUniversal || styleMatches.length === 0) ? 1.0 : styleMatches.length / STYLE_TAGS.length;

    return distScore * 0.4 + surfScore * 0.2 + styleScore * 0.4;
  }

  function conditionApplicability(conditionGroups) {
    if (!Array.isArray(conditionGroups) || !conditionGroups.length) return 1.0;
    var DIST_MAP = { '1': 'sprint', '2': 'mile', '3': 'medium', '4': 'long' };
    var SURF_MAP = { '1': 'turf', '2': 'dirt' };
    var STYLE_MAP = { '1': 'front', '2': 'pace', '3': 'late', '4': 'end' };

    function countAllowed(text, key, valueMap) {
      var re = new RegExp('(?:^|[^a-z0-9_])' + key + '\\s*==\\s*(\\d+)', 'ig');
      var m, allowed = new Set();
      while ((m = re.exec(text))) allowed.add(m[1]);
      if (!allowed.size) return Object.keys(valueMap).length; // unrestricted
      return allowed.size;
    }

    var bestDist = 0, bestSurf = 0, bestStyle = 0;
    conditionGroups.forEach(function (g) {
      var t = condText(g);
      if (!t) { bestDist = 4; bestSurf = 2; bestStyle = 4; return; }
      bestDist = Math.max(bestDist, countAllowed(t, 'distance_type', DIST_MAP));
      bestSurf = Math.max(bestSurf, countAllowed(t, 'ground_type', SURF_MAP));
      bestStyle = Math.max(bestStyle, countAllowed(t, 'running_style', STYLE_MAP));
    });
    var distScore = bestDist / 4;
    var surfScore = bestSurf / 2;
    var styleScore = bestStyle / 4;
    return distScore * 0.4 + surfScore * 0.2 + styleScore * 0.4;
  }

  function scoreApplicability(typeTags, conditionGroups) {
    var tagScore = applicabilityFromTags(typeTags);
    var condScore = conditionApplicability(conditionGroups);
    return Math.min(tagScore, condScore);
  }

  // ---------------------------------------------------------------------------
  // Cost Efficiency scoring
  // ---------------------------------------------------------------------------
  function scoreCostEfficiency(effectImpact, cost) {
    if (!cost || cost <= 0) return effectImpact; // free skill = full efficiency
    var efficiency = effectImpact / (cost / 160);
    return clamp(efficiency, 0, 1);
  }

  // ---------------------------------------------------------------------------
  // Trigger Consistency scoring (reuses team-trials-optimizer helpers)
  // ---------------------------------------------------------------------------
  function scoreTriggerConsistency(conditionGroups) {
    var tto = TTO();
    if (!tto.timingScore || !tto.breadthScore || !tto.scenarioScore) return 0.5;

    if (!Array.isArray(conditionGroups) || !conditionGroups.length) return 0.58;

    var gScores = [];
    conditionGroups.forEach(function (g) {
      var t = condText(g);
      if (!t) return;
      var ts = tto.timingScore(t);
      var bs = tto.breadthScore(t);
      var ss = tto.scenarioScore(t);

      var strict = 0;
      if (/order\s*==\s*1/.test(t)) strict += 2;
      if (/blocked_|is_overtake|change_order_onetime/.test(t)) strict += 2;
      if (/phase_random|corner_random|straight_random/.test(t)) strict += 1;
      var cmpMatch = String(t).match(/==|>=|<=|>|</g);
      if (cmpMatch && cmpMatch.length >= 5) strict += 1;
      var pen = Math.min(0.24, strict * 0.04);

      gScores.push(clamp(ts * 0.45 + bs * 0.3 + ss * 0.25 - pen, 0.05, 0.99));
    });

    if (!gScores.length) return 0.58;

    // Combine via miss probability (same formula as scoreSkillConsistency)
    var miss = 1;
    gScores.forEach(function (v) {
      miss *= 1 - Math.min(0.97, v * 0.9);
    });
    var c = 1 - miss;
    if (conditionGroups.length > 1) {
      c += Math.min(0.08, (conditionGroups.length - 1) * 0.03);
    }
    return clamp(c, 0.05, 0.99);
  }

  // ---------------------------------------------------------------------------
  // Duration scoring
  // ---------------------------------------------------------------------------
  function scoreDuration(conditionGroups) {
    if (!Array.isArray(conditionGroups) || !conditionGroups.length) return 0.3;
    var maxTime = 0;
    conditionGroups.forEach(function (g) {
      if (g && typeof g.base_time === 'number') {
        maxTime = Math.max(maxTime, g.base_time);
      }
    });
    return clamp(maxTime / 50000, 0, 1);
  }

  // ---------------------------------------------------------------------------
  // Green skill detection — passive stat boosts with volatile race conditions
  // Green skills depend on random track properties (rotation, season, weather,
  // ground condition, post number) that vary across Team Trials races, making
  // them unreliable. Savvy skills are exempt — they provide FoV/wisdom buffs
  // with consistent strategy-based conditions.
  // ---------------------------------------------------------------------------
  var VOLATILE_RACE_RE = /(rotation|season|ground_condition|weather|post_number)\s*(==|!=|>=|<=|>|<)/i;
  var SAVVY_NAME_RE = /savvy|コツ/i;

  function isGreenPassive(conditionGroups) {
    if (!Array.isArray(conditionGroups) || !conditionGroups.length) return false;
    return conditionGroups.every(function (g) {
      if (!g) return false;
      // Passive: base_time is -1 or 0
      var passive = (g.base_time === -1 || g.base_time === 0);
      if (!passive) return false;
      // Must have a volatile race condition
      var t = condText(g);
      return VOLATILE_RACE_RE.test(t);
    });
  }

  function isSavvySkill(name) {
    return SAVVY_NAME_RE.test(name || '');
  }

  // Green penalty: reduces composite score for passive stat-boost skills
  // that depend on random race conditions, except Savvy skills
  var GREEN_PASSIVE_PENALTY = 0.20;

  // ---------------------------------------------------------------------------
  // Tag derivation
  // ---------------------------------------------------------------------------
  function deriveTags(skill, breakdown) {
    var tto = TTO();
    var tags = [];
    if (breakdown.consistency >= 0.75 && breakdown.effectImpact >= 0.6) tags.push('core');
    if (breakdown.consistency >= 0.65) tags.push('consistent');
    if (breakdown.consistency < 0.35) tags.push('inconsistent');

    var eff = tto.effectBuckets ? tto.effectBuckets(skill) : { accel: false, speed: false, recovery: false };
    if (eff.accel) tags.push('accel');
    if (eff.speed) tags.push('speed');
    if (eff.recovery) tags.push('recovery');

    var isLate = tto.isLateWindow ? tto.isLateWindow(skill) : false;
    if (isLate && breakdown.effectImpact >= 0.5) tags.push('team_trials');

    return tags;
  }

  function deriveConsistencyAdjustment(tags) {
    var adj = 0;
    if (tags.indexOf('inconsistent') !== -1) adj -= 0.24;
    if (tags.indexOf('consistent') !== -1) adj += 0.10;
    if (tags.indexOf('team_trials') !== -1) adj += 0.12;
    if (tags.indexOf('core') !== -1) adj += 0.08;
    return clamp(adj, -0.45, 0.35);
  }

  // ---------------------------------------------------------------------------
  // Tier marker from composite score
  // ---------------------------------------------------------------------------
  function markerFromScore(composite) {
    if (composite >= 0.72) return '\u25ce'; // ◎
    if (composite >= 0.52) return '\u25cb'; // ◯
    if (composite >= 0.36) return '\u25b2'; // ▲
    if (composite >= 0.20) return '\u25b3'; // △
    return '\u2715'; // ✕
  }

  // ---------------------------------------------------------------------------
  // Context string from type tags
  // ---------------------------------------------------------------------------
  function deriveContext(typeTags) {
    var tags = new Set(Array.isArray(typeTags) ? typeTags.map(function (t) { return String(t).toLowerCase(); }) : []);
    if (tags.has('nac')) return '/';
    var parts = [];
    DISTANCE_TAGS.forEach(function (t) { if (tags.has(t)) parts.push(DISTANCE_TAG_LABELS[t]); });
    STYLE_TAGS.forEach(function (t) { if (tags.has(t)) parts.push(STYLE_TAG_LABELS[t]); });
    SURFACE_TAGS.forEach(function (t) { if (tags.has(t)) parts.push(SURFACE_TAG_LABELS[t]); });
    return parts.length ? parts.join('/') : '/';
  }

  // ---------------------------------------------------------------------------
  // Explanation generation
  // ---------------------------------------------------------------------------
  function generateExplanation(breakdown, tags, skill) {
    var parts = [];

    // Effect quality
    if (breakdown.effectImpact >= 0.7) parts.push('Strong');
    else if (breakdown.effectImpact >= 0.4) parts.push('Moderate');
    else if (breakdown.effectImpact >= 0.15) parts.push('Weak');
    else parts.push('Minimal');

    // Effect type
    var tto = TTO();
    var eff = tto.effectBuckets ? tto.effectBuckets(skill) : {};
    var isLate = tto.isLateWindow ? tto.isLateWindow(skill) : false;

    if (eff.accel && eff.speed) parts.push('speed & acceleration');
    else if (eff.accel) parts.push('acceleration');
    else if (eff.speed) parts.push('speed boost');
    else if (eff.recovery) parts.push('recovery');
    else parts.push('effect');

    if (isLate) parts.push('in late race');

    // Duration
    if (breakdown.duration >= 0.7) parts.push('(long duration)');
    else if (breakdown.duration < 0.2) parts.push('(short duration)');

    // Cost
    if (breakdown.costEfficiency >= 0.7) parts.push('- cost-efficient');
    else if (breakdown.costEfficiency < 0.3) parts.push('- expensive');

    // Consistency
    if (breakdown.consistency >= 0.75) parts.push('with reliable activation');
    else if (breakdown.consistency >= 0.55) parts.push('with moderate activation reliability');
    else if (breakdown.consistency < 0.35) parts.push('but unreliable activation');

    // Applicability
    if (breakdown.applicability < 0.4) parts.push('(limited applicability)');

    return parts.join(' ');
  }

  // ---------------------------------------------------------------------------
  // Score a single normalized skill
  // ---------------------------------------------------------------------------
  function scoreSkill(normalizedSkill, weights) {
    var w = weights || DEFAULT_SCORING_WEIGHTS;
    var groups = Array.isArray(normalizedSkill.conditionGroups) ? normalizedSkill.conditionGroups : [];
    var typeTags = Array.isArray(normalizedSkill.typeTags) ? normalizedSkill.typeTags : [];
    var cost = normalizedSkill.cost || 0;

    var effectImpact = scoreEffectImpact(groups);
    var applicability = scoreApplicability(typeTags, groups);
    var costEfficiency = scoreCostEfficiency(effectImpact, cost);
    var consistency = scoreTriggerConsistency(groups);
    var duration = scoreDuration(groups);

    var breakdown = {
      effectImpact: effectImpact,
      applicability: applicability,
      costEfficiency: costEfficiency,
      consistency: consistency,
      duration: duration,
    };

    // Normalize weights to sum to 1
    var total = (w.effectImpact || 0) + (w.applicability || 0) + (w.costEfficiency || 0)
      + (w.consistency || 0) + (w.duration || 0);
    if (total <= 0) total = 1;
    var nw = {
      effectImpact: (w.effectImpact || 0) / total,
      applicability: (w.applicability || 0) / total,
      costEfficiency: (w.costEfficiency || 0) / total,
      consistency: (w.consistency || 0) / total,
      duration: (w.duration || 0) / total,
    };

    var composite = clamp(
      nw.effectImpact * effectImpact +
      nw.applicability * applicability +
      nw.costEfficiency * costEfficiency +
      nw.consistency * consistency +
      nw.duration * duration,
      0, 1
    );

    // Penalize green passive skills (volatile race-condition stat boosts)
    // unless they are Savvy skills which provide consistent FoV/wisdom
    var greenPenalized = false;
    if (isGreenPassive(groups) && !isSavvySkill(normalizedSkill.name)) {
      composite = clamp(composite - GREEN_PASSIVE_PENALTY, 0, 1);
      greenPenalized = true;
    }

    var marker = markerFromScore(composite);
    var tags = deriveTags(normalizedSkill, breakdown);
    if (greenPenalized) tags.push('inconsistent');
    var consistencyAdjustment = deriveConsistencyAdjustment(tags);
    var context = deriveContext(typeTags);
    var note = generateExplanation(breakdown, tags, normalizedSkill);
    if (greenPenalized) note += ' - volatile race condition (green passive)';

    // scorePerSp: compute if we have cost
    var scorePerSp = null;
    if (cost > 0) {
      // Use the same scale as the old CSV: rating-like value / cost
      // Approximate: composite * 500 (the typical skill score) / cost
      scorePerSp = Number(((composite * 500) / cost).toFixed(2));
    }

    return {
      skillName: normalizedSkill.name,
      normalizedName: normalizedSkill.normalizedName || nName(normalizedSkill.name),
      marker: marker,
      scorePerSp: scorePerSp,
      context: context,
      note: note,
      tags: tags,
      tierBonus: Number(composite.toFixed(4)),
      consistencyAdjustment: Number(consistencyAdjustment.toFixed(4)),
      skillId: normalizedSkill.id || null,
      breakdown: {
        effectImpact: Number(effectImpact.toFixed(4)),
        applicability: Number(applicability.toFixed(4)),
        costEfficiency: Number(costEfficiency.toFixed(4)),
        consistency: Number(consistency.toFixed(4)),
        duration: Number(duration.toFixed(4)),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Score all skills from the raw skills_all.json array
  // ---------------------------------------------------------------------------
  function scoreAllSkills(rawSkillArray, weights) {
    var tto = TTO();
    var normalizeSkillFn = tto.normalizeSkill;
    if (!normalizeSkillFn) {
      return { byId: new Map(), byName: new Map() };
    }

    var byId = new Map();
    var byName = new Map();
    var w = weights || DEFAULT_SCORING_WEIGHTS;

    (Array.isArray(rawSkillArray) ? rawSkillArray : []).forEach(function (raw) {
      // Score the gene_version (inheritable) skill — this is what players actually acquire
      var gene = raw && raw.gene_version && typeof raw.gene_version === 'object' ? raw.gene_version : null;
      var hasGene = gene && gene.cost != null;

      // Also score the parent (unique/gold) skill
      var parentNorm = normalizeSkillFn(raw);
      if (parentNorm && parentNorm.id) {
        var parentEntry = scoreSkill(parentNorm, w);
        parentEntry.skillId = String(parentNorm.id);
        if (!byId.has(parentEntry.skillId)) byId.set(parentEntry.skillId, parentEntry);
        if (parentEntry.normalizedName && !byName.has(parentEntry.normalizedName)) {
          byName.set(parentEntry.normalizedName, parentEntry);
        }
      }

      // Score the gene version
      if (hasGene) {
        // Build a pseudo-raw object for normalizeSkill
        var geneRaw = Object.assign({}, raw, gene, {
          id: gene.id,
          condition_groups: gene.condition_groups || raw.condition_groups,
          type: raw.type, // type tags come from the parent
        });
        // Preserve loc data for EN overrides
        if (raw.loc && raw.loc.en && raw.loc.en.gene_version) {
          geneRaw.loc = { en: Object.assign({}, raw.loc.en.gene_version, {
            type: (raw.loc && raw.loc.en) ? raw.loc.en.type : undefined,
          }) };
        }
        var geneNorm = normalizeSkillFn(geneRaw);
        if (geneNorm && geneNorm.id) {
          var geneEntry = scoreSkill(geneNorm, w);
          geneEntry.skillId = String(geneNorm.id);
          if (!byId.has(geneEntry.skillId)) byId.set(geneEntry.skillId, geneEntry);
          if (geneEntry.normalizedName && !byName.has(geneEntry.normalizedName)) {
            byName.set(geneEntry.normalizedName, geneEntry);
          }
        }
      }
    });

    return { byId: byId, byName: byName };
  }

  return {
    DEFAULT_SCORING_WEIGHTS: DEFAULT_SCORING_WEIGHTS,
    EFFECT_TYPE_WEIGHTS: EFFECT_TYPE_WEIGHTS,
    scoreSkill: scoreSkill,
    scoreAllSkills: scoreAllSkills,
    markerFromScore: markerFromScore,
    generateExplanation: generateExplanation,
  };
});

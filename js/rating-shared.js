// Shared rating and affinity helpers for optimizer + calculator pages.
(function (global) {
  'use strict';

  function normalize(str) {
    return (str || '').toString().trim().toLowerCase();
  }

  function getBucketForGrade(grade) {
    switch ((grade || '').toUpperCase()) {
      case 'S':
      case 'A': return 'good';
      case 'B':
      case 'C': return 'average';
      case 'D':
      case 'E':
      case 'F': return 'bad';
      default: return 'terrible';
    }
  }

  function createAffinityHelpers(cfg) {
    function updateAffinityStyles() {
      const grades = ['good', 'average', 'bad', 'terrible'];
      Object.values(cfg).forEach(sel => {
        if (!sel) return;
        const bucket = getBucketForGrade(sel.value);
        grades.forEach(g => sel.classList.remove(`aff-grade-${g}`));
        sel.classList.add(`aff-grade-${bucket}`);
      });
    }

    function getBucketForSkill(checkType) {
      const ct = normalize(checkType);
      const map = {
        'turf': cfg.turf,
        'dirt': cfg.dirt,
        'sprint': cfg.sprint,
        'mile': cfg.mile,
        'medium': cfg.medium,
        'long': cfg.long,
        'front': cfg.front,
        'pace': cfg.pace,
        'late': cfg.late,
        'end': cfg.end,
      };
      const sel = map[ct];
      if (!sel) return 'base';
      return getBucketForGrade(sel.value);
    }

    function evaluateSkillScore(skill) {
      if (typeof skill.score === 'number') return skill.score;
      if (!skill.score || typeof skill.score !== 'object') return 0;
      const bucket = getBucketForSkill(skill.checkType);
      const val = skill.score[bucket];
      return typeof val === 'number' ? val : 0;
    }

    return {
      normalize,
      getBucketForGrade,
      updateAffinityStyles,
      getBucketForSkill,
      evaluateSkillScore
    };
  }

  function createRatingEngine({ ratingInputs, ratingDisplays, onChange }) {
    const MAX_STAT_VALUE = 2000;
    const STAT_BLOCK_SIZE = 50;
    // Stat score at each 50-point boundary (stat 0, 50, 100, ..., 2000)
    const STAT_BOUNDARY_SCORES = [
      0, 25, 66, 116, 181, 261, 352, 457, 577, 707, 847,
      993, 1143, 1298, 1463, 1633, 1808, 2004, 2209, 2419,
      2635, 2895, 3171, 3501, 3841,
      4249, 4688, 5160, 5665, 6203, 6773, 7377, 8013, 8682, 9384,
      10117, 10885, 11684, 12516, 13383, 14280
    ];
    let lastSkillScore = 0;

    const RATING_SPRITE = {
      url: 'assets/Rank_tex.png',
      version: '1',
      sheetWidth: 0,
      sheetHeight: 0,
      activeUrl: '',
      loaded: false
    };

    const GAME_RANK_SPRITE_MAP = {
      'A': { x: 4, y: 22, w: 150, h: 151 },
      'UF8': { x: 159, y: 22, w: 151, h: 154 },
      'UC': { x: 315, y: 22, w: 151, h: 154 },
      'UA': { x: 471, y: 22, w: 151, h: 154 },
      'US8': { x: 627, y: 22, w: 151, h: 154 },
      'B+': { x: 4, y: 178, w: 150, h: 151 },
      'UF7': { x: 159, y: 178, w: 151, h: 154 },
      'UD9': { x: 315, y: 178, w: 151, h: 154 },
      'UB9': { x: 471, y: 178, w: 151, h: 154 },
      'US7': { x: 627, y: 178, w: 151, h: 154 },
      'B': { x: 4, y: 334, w: 150, h: 151 },
      'UF6': { x: 159, y: 334, w: 151, h: 154 },
      'UD8': { x: 315, y: 334, w: 151, h: 154 },
      'UB8': { x: 471, y: 334, w: 151, h: 154 },
      'US6': { x: 627, y: 334, w: 151, h: 154 },
      'C+': { x: 4, y: 490, w: 150, h: 151 },
      'UF5': { x: 159, y: 490, w: 151, h: 154 },
      'UD7': { x: 315, y: 490, w: 151, h: 154 },
      'UB7': { x: 471, y: 490, w: 151, h: 154 },
      'US5': { x: 627, y: 490, w: 151, h: 154 },
      'C': { x: 4, y: 646, w: 150, h: 151 },
      'UF4': { x: 159, y: 646, w: 151, h: 154 },
      'UD6': { x: 315, y: 646, w: 151, h: 154 },
      'UB6': { x: 471, y: 646, w: 151, h: 154 },
      'US4': { x: 627, y: 646, w: 151, h: 154 },
      'D+': { x: 4, y: 802, w: 150, h: 151 },
      'UF3': { x: 159, y: 802, w: 151, h: 154 },
      'UD5': { x: 315, y: 802, w: 151, h: 154 },
      'UB5': { x: 471, y: 802, w: 151, h: 154 },
      'US3': { x: 627, y: 802, w: 151, h: 154 },
      'D': { x: 4, y: 958, w: 150, h: 151 },
      'UF2': { x: 159, y: 958, w: 151, h: 154 },
      'UD4': { x: 315, y: 958, w: 151, h: 154 },
      'UB4': { x: 471, y: 958, w: 151, h: 154 },
      'US2': { x: 627, y: 958, w: 151, h: 154 },
      'E+': { x: 4, y: 1114, w: 150, h: 151 },
      'UF1': { x: 159, y: 1114, w: 151, h: 154 },
      'UD3': { x: 315, y: 1114, w: 151, h: 154 },
      'UB3': { x: 471, y: 1114, w: 151, h: 154 },
      'US1': { x: 627, y: 1114, w: 151, h: 154 },
      'E': { x: 4, y: 1270, w: 150, h: 151 },
      'UF': { x: 159, y: 1270, w: 151, h: 154 },
      'UD2': { x: 315, y: 1270, w: 151, h: 154 },
      'UB2': { x: 471, y: 1270, w: 151, h: 154 },
      'US': { x: 627, y: 1270, w: 151, h: 154 },
      'US9': { x: 783, y: 1270, w: 151, h: 154 },
      'F+': { x: 4, y: 1426, w: 150, h: 151 },
      'UG9': { x: 159, y: 1426, w: 151, h: 154 },
      'UD1': { x: 315, y: 1426, w: 151, h: 154 },
      'UB1': { x: 471, y: 1426, w: 151, h: 154 },
      'UA1': { x: 627, y: 1426, w: 151, h: 154 },
      'UA2': { x: 783, y: 1426, w: 151, h: 154 },
      'UA3': { x: 939, y: 1426, w: 151, h: 154 },
      'UA4': { x: 1095, y: 1426, w: 151, h: 154 },
      'UA5': { x: 1251, y: 1426, w: 151, h: 154 },
      'UA6': { x: 1407, y: 1426, w: 151, h: 154 },
      'UA7': { x: 1563, y: 1426, w: 151, h: 154 },
      'UA8': { x: 1719, y: 1426, w: 151, h: 154 },
      'UA9': { x: 1875, y: 1426, w: 151, h: 154 },
      'F': { x: 4, y: 1582, w: 150, h: 151 },
      'UG8': { x: 159, y: 1582, w: 151, h: 154 },
      'UD': { x: 315, y: 1582, w: 151, h: 154 },
      'UC1': { x: 471, y: 1582, w: 151, h: 154 },
      'UC2': { x: 627, y: 1582, w: 151, h: 154 },
      'UC3': { x: 783, y: 1582, w: 151, h: 154 },
      'UC4': { x: 939, y: 1582, w: 151, h: 154 },
      'UC5': { x: 1095, y: 1582, w: 151, h: 154 },
      'UC6': { x: 1251, y: 1582, w: 151, h: 154 },
      'UC7': { x: 1407, y: 1582, w: 151, h: 154 },
      'UC8': { x: 1563, y: 1582, w: 151, h: 154 },
      'UC9': { x: 1719, y: 1582, w: 151, h: 154 },
      'UB': { x: 1875, y: 1582, w: 151, h: 154 },
      'G+': { x: 4, y: 1738, w: 150, h: 151 },
      'UG7': { x: 159, y: 1738, w: 151, h: 154 },
      'UF9': { x: 315, y: 1738, w: 151, h: 154 },
      'UE': { x: 471, y: 1738, w: 151, h: 154 },
      'UE1': { x: 627, y: 1738, w: 151, h: 154 },
      'UE2': { x: 783, y: 1738, w: 151, h: 154 },
      'UE3': { x: 939, y: 1738, w: 151, h: 154 },
      'UE4': { x: 1095, y: 1738, w: 151, h: 154 },
      'UE5': { x: 1251, y: 1738, w: 151, h: 154 },
      'UE6': { x: 1407, y: 1738, w: 151, h: 154 },
      'UE7': { x: 1563, y: 1738, w: 151, h: 154 },
      'UE8': { x: 1719, y: 1738, w: 151, h: 154 },
      'UE9': { x: 1875, y: 1738, w: 151, h: 154 },
      'G': { x: 4, y: 1894, w: 150, h: 151 },
      'A+': { x: 160, y: 1894, w: 150, h: 151 },
      'S': { x: 316, y: 1894, w: 150, h: 154 },
      'S+': { x: 472, y: 1894, w: 150, h: 154 },
      'SS': { x: 627, y: 1894, w: 151, h: 154 },
      'SS+': { x: 783, y: 1894, w: 151, h: 154 },
      'UG': { x: 939, y: 1894, w: 151, h: 154 },
      'UG1': { x: 1095, y: 1894, w: 151, h: 154 },
      'UG2': { x: 1251, y: 1894, w: 151, h: 154 },
      'UG3': { x: 1407, y: 1894, w: 151, h: 154 },
      'UG4': { x: 1563, y: 1894, w: 151, h: 154 },
      'UG5': { x: 1719, y: 1894, w: 151, h: 154 },
      'UG6': { x: 1875, y: 1894, w: 151, h: 154 },
    };

    const RATING_BADGE_MINIMA = [
      { min: 0, label: 'G' },
      { min: 300, label: 'G+' },
      { min: 600, label: 'F' },
      { min: 900, label: 'F+' },
      { min: 1300, label: 'E' },
      { min: 1800, label: 'E+' },
      { min: 2300, label: 'D' },
      { min: 2900, label: 'D+' },
      { min: 3500, label: 'C' },
      { min: 4900, label: 'C+' },
      { min: 7000, label: 'B' },
      { min: 8200, label: 'B+' },
      { min: 10000, label: 'A' },
      { min: 12100, label: 'A+' },
      { min: 14500, label: 'S' },
      { min: 15900, label: 'S+' },
      { min: 17500, label: 'SS' },
      { min: 19200, label: 'SS+' },
      { min: 19600, label: 'UG' },
      { min: 20000, label: 'UG1' },
      { min: 20400, label: 'UG2' },
      { min: 20800, label: 'UG3' },
      { min: 21200, label: 'UG4' },
      { min: 21600, label: 'UG5' },
      { min: 22100, label: 'UG6' },
      { min: 22500, label: 'UG7' },
      { min: 23000, label: 'UG8' },
      { min: 23400, label: 'UG9' },
      { min: 23900, label: 'UF' },
      { min: 24300, label: 'UF1' },
      { min: 24800, label: 'UF2' },
      { min: 25300, label: 'UF3' },
      { min: 25800, label: 'UF4' },
      { min: 26300, label: 'UF5' },
      { min: 26800, label: 'UF6' },
      { min: 27300, label: 'UF7' },
      { min: 27800, label: 'UF8' },
      { min: 28300, label: 'UF9' },
      { min: 28800, label: 'UE' },
      { min: 29400, label: 'UE1' },
      { min: 29900, label: 'UE2' },
      { min: 30400, label: 'UE3' },
      { min: 31000, label: 'UE4' },
      { min: 31500, label: 'UE5' },
      { min: 32100, label: 'UE6' },
      { min: 32700, label: 'UE7' },
      { min: 33200, label: 'UE8' },
      { min: 33800, label: 'UE9' },
      { min: 34400, label: 'UD' },
      { min: 35000, label: 'UD1' },
      { min: 35600, label: 'UD2' },
      { min: 36200, label: 'UD3' },
      { min: 36800, label: 'UD4' },
      { min: 37500, label: 'UD5' },
      { min: 38100, label: 'UD6' },
      { min: 38700, label: 'UD7' },
      { min: 39400, label: 'UD8' },
      { min: 40000, label: 'UD9' },
      { min: 40700, label: 'UC' },
      { min: 41300, label: 'UC1' },
      { min: 42000, label: 'UC2' },
      { min: 42700, label: 'UC3' },
      { min: 43400, label: 'UC4' },
      { min: 44000, label: 'UC5' },
      { min: 44700, label: 'UC6' },
      { min: 45400, label: 'UC7' },
      { min: 46200, label: 'UC8' },
      { min: 46900, label: 'UC9' },
      { min: 47600, label: 'UB' },
      { min: 48300, label: 'UB1' },
      { min: 49000, label: 'UB2' },
      { min: 49800, label: 'UB3' },
      { min: 50500, label: 'UB4' },
      { min: 51300, label: 'UB5' },
      { min: 52000, label: 'UB6' },
      { min: 52800, label: 'UB7' },
      { min: 53600, label: 'UB8' },
      { min: 54400, label: 'UB9' },
      { min: 55200, label: 'UA' },
      { min: 55900, label: 'UA1' },
      { min: 56700, label: 'UA2' },
      { min: 57500, label: 'UA3' },
      { min: 58400, label: 'UA4' },
      { min: 59200, label: 'UA5' },
      { min: 60000, label: 'UA6' },
      { min: 60800, label: 'UA7' },
      { min: 61700, label: 'UA8' },
      { min: 62500, label: 'UA9' },
      { min: 63400, label: 'US' },
      { min: 64200, label: 'US1' },
      { min: 65100, label: 'US2' },
      { min: 66000, label: 'US3' },
      { min: 66800, label: 'US4' },
      { min: 67700, label: 'US5' },
      { min: 68600, label: 'US6' },
      { min: 69500, label: 'US7' },
      { min: 70400, label: 'US8' },
      { min: 71400, label: 'US9' }
    ];

    const RATING_BADGES = RATING_BADGE_MINIMA.map((badge, idx) => {
      const next = RATING_BADGE_MINIMA[idx + 1];
      const sprite = GAME_RANK_SPRITE_MAP[badge.label];
      return {
        threshold: next ? next.min : Infinity,
        label: badge.label,
        ...(sprite ? { sprite } : {})
      };
    });

    function clampStatValue(value) {
      if (typeof value !== 'number' || isNaN(value)) return 0;
      return Math.max(0, Math.min(MAX_STAT_VALUE, value));
    }

    function getCurrentStarLevel() {
      const raw = ratingInputs.star ? parseInt(ratingInputs.star.value, 10) : 0;
      return isNaN(raw) ? 0 : raw;
    }

    function getCurrentUniqueLevel() {
      const raw = ratingInputs.unique ? parseInt(ratingInputs.unique.value, 10) : 0;
      return isNaN(raw) ? 0 : raw;
    }

    function calcUniqueBonus(starLevel, uniqueLevel) {
      const lvl = typeof uniqueLevel === 'number' && uniqueLevel > 0 ? uniqueLevel : 0;
      if (!lvl) return 0;
      const multiplier = starLevel === 1 || starLevel === 2 ? 120 : 170;
      return lvl * multiplier;
    }

    function getRatingBadge(totalScore) {
      for (const badge of RATING_BADGES) {
        if (totalScore < badge.threshold) return badge;
      }
      return RATING_BADGES[RATING_BADGES.length - 1];
    }

    function getRatingBadgeIndex(totalScore) {
      for (let i = 0; i < RATING_BADGES.length; i++) {
        if (totalScore < RATING_BADGES[i].threshold) return i;
      }
      return RATING_BADGES.length - 1;
    }

    function syncBadgeSpriteMetrics(target) {
      if (!target) return { badgeWidth: 0, badgeHeight: 0 };
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(target) : null;
      const cssWidth = style ? parseFloat(style.width) : 0;
      const cssHeight = style ? parseFloat(style.height) : 0;
      const badgeWidth = target.clientWidth || cssWidth || 0;
      const badgeHeight = target.clientHeight || cssHeight || 0;
      return { badgeWidth, badgeHeight };
    }

    function applyBadgeSpriteStyles(target, spriteUrl) {
      if (!target) return;
      target.style.backgroundImage = `url(${spriteUrl})`;
      target.style.backgroundRepeat = 'no-repeat';
      target.style.backgroundPosition = 'center';
      target.style.backgroundSize = 'contain';
    }

    function loadRatingSprite() {
      if (!ratingDisplays.badgeSprite && !ratingDisplays.floatBadgeSprite) return;
      const spriteUrl = RATING_SPRITE.version
        ? `${RATING_SPRITE.url}?v=${RATING_SPRITE.version}`
        : RATING_SPRITE.url;
      const img = new Image();
      img.onload = () => {
        RATING_SPRITE.sheetWidth = img.naturalWidth;
        RATING_SPRITE.sheetHeight = img.naturalHeight;
        RATING_SPRITE.activeUrl = spriteUrl;
        RATING_SPRITE.loaded = true;
        applyBadgeSpriteStyles(ratingDisplays.badgeSprite, spriteUrl);
        applyBadgeSpriteStyles(ratingDisplays.floatBadgeSprite, spriteUrl);
        updateRatingDisplay();
      };
      img.onerror = () => {
        RATING_SPRITE.loaded = false;
        if (ratingDisplays.badgeSprite) ratingDisplays.badgeSprite.textContent = '';
        if (ratingDisplays.floatBadgeSprite) ratingDisplays.floatBadgeSprite.textContent = '';
      };
      img.src = spriteUrl;
    }

    function readRatingStats() {
      return {
        speed: clampStatValue(parseInt(ratingInputs.speed?.value, 10)),
        stamina: clampStatValue(parseInt(ratingInputs.stamina?.value, 10)),
        power: clampStatValue(parseInt(ratingInputs.power?.value, 10)),
        guts: clampStatValue(parseInt(ratingInputs.guts?.value, 10)),
        wisdom: clampStatValue(parseInt(ratingInputs.wisdom?.value, 10))
      };
    }

    function calcStatScore(statValue) {
      const value = clampStatValue(statValue);
      const idx = Math.floor(value / STAT_BLOCK_SIZE);
      const rem = value % STAT_BLOCK_SIZE;
      const last = STAT_BOUNDARY_SCORES.length - 1;
      if (idx >= last) return STAT_BOUNDARY_SCORES[last];
      const base = STAT_BOUNDARY_SCORES[idx];
      if (rem === 0) return base;
      const blockDiff = STAT_BOUNDARY_SCORES[idx + 1] - base;
      return base + Math.round(blockDiff * rem / STAT_BLOCK_SIZE);
    }

    function calculateRatingBreakdown(skillScoreOverride) {
      if (typeof skillScoreOverride === 'number' && !isNaN(skillScoreOverride)) {
        lastSkillScore = Math.max(0, Math.round(skillScoreOverride));
      }
      const stats = readRatingStats();
      const statsScore = Object.values(stats).reduce((sum, val) => sum + calcStatScore(val), 0);
      const starLevel = getCurrentStarLevel();
      const uniqueLevel = getCurrentUniqueLevel();
      const uniqueBonus = calcUniqueBonus(starLevel, uniqueLevel);
      const total = statsScore + uniqueBonus + lastSkillScore;
      return { statsScore, uniqueBonus, skillScore: lastSkillScore, total };
    }

    function updateBadgeSprite(target, badge) {
      if (!target) return;
      if (RATING_SPRITE.loaded && badge.sprite && RATING_SPRITE.sheetWidth && RATING_SPRITE.sheetHeight) {
        const rect = badge.sprite;
        const { badgeWidth, badgeHeight } = syncBadgeSpriteMetrics(target);
        const renderWidth = badgeWidth || rect.w;
        const renderHeight = badgeHeight || rect.h;
        const scale = Math.min(renderWidth / rect.w, renderHeight / rect.h);
        const scaledSpriteWidth = RATING_SPRITE.sheetWidth * scale;
        const scaledSpriteHeight = RATING_SPRITE.sheetHeight * scale;
        const scaledRectWidth = rect.w * scale;
        const scaledRectHeight = rect.h * scale;
        const offsetX = (renderWidth - scaledRectWidth) / 2 - rect.x * scale;
        const offsetY = (renderHeight - scaledRectHeight) / 2 - rect.y * scale;
        target.style.backgroundImage = RATING_SPRITE.activeUrl ? `url(${RATING_SPRITE.activeUrl})` : '';
        target.style.backgroundRepeat = 'no-repeat';
        target.style.backgroundSize = `${scaledSpriteWidth}px ${scaledSpriteHeight}px`;
        target.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
        target.textContent = '';
      } else {
        target.style.backgroundImage = 'none';
        target.style.backgroundSize = '';
        target.style.backgroundPosition = '';
        target.textContent = badge.label;
      }
    }

    function updateRatingDisplay(skillScoreOverride) {
      const breakdown = calculateRatingBreakdown(skillScoreOverride);
      if (ratingDisplays.stats) ratingDisplays.stats.textContent = breakdown.statsScore.toString();
      if (ratingDisplays.skills) ratingDisplays.skills.textContent = breakdown.skillScore.toString();
      if (ratingDisplays.unique) ratingDisplays.unique.textContent = breakdown.uniqueBonus.toString();
      if (ratingDisplays.total) ratingDisplays.total.textContent = breakdown.total.toString();
      if (ratingDisplays.floatTotal) ratingDisplays.floatTotal.textContent = breakdown.total.toString();
      const badge = getRatingBadge(breakdown.total);
      updateBadgeSprite(ratingDisplays.badgeSprite, badge);
      updateBadgeSprite(ratingDisplays.floatBadgeSprite, badge);
      const progressTargets = [
        {
          label: ratingDisplays.nextLabel,
          needed: ratingDisplays.nextNeeded,
          fill: ratingDisplays.progressFill,
          bar: ratingDisplays.progressBar
        },
        {
          label: ratingDisplays.floatNextLabel,
          needed: ratingDisplays.floatNextNeeded,
          fill: ratingDisplays.floatProgressFill,
          bar: ratingDisplays.floatProgressBar
        }
      ];
      const hasProgressTarget = progressTargets.some((t) => t.fill && t.label && t.needed);
      if (hasProgressTarget) {
        const idx = getRatingBadgeIndex(breakdown.total);
        const current = RATING_BADGES[idx];
        const prevThreshold = idx === 0 ? 0 : RATING_BADGES[idx - 1].threshold;
        const nextThreshold = current.threshold;
        const hasNext = Number.isFinite(nextThreshold);
        const range = hasNext ? Math.max(1, nextThreshold - prevThreshold) : 1;
        const clampedTotal = Math.max(prevThreshold, breakdown.total);
        const progress = hasNext
          ? Math.min(1, Math.max(0, (clampedTotal - prevThreshold) / range))
          : 1;
        const nextBadge = hasNext ? RATING_BADGES[idx + 1] : current;
        const needed = hasNext ? Math.max(0, nextThreshold - breakdown.total) : 0;
        const labelText = hasNext
          ? `Next: ${nextBadge?.label || current.label} at ${nextThreshold}`
          : 'Max rank reached';
        const neededText = hasNext ? `+${needed}` : '';
        const width = `${Math.round(progress * 100)}%`;
        progressTargets.forEach((target) => {
          if (target.fill) target.fill.style.width = width;
          if (target.label) target.label.textContent = labelText;
          if (target.needed) target.needed.textContent = neededText;
          if (target.bar) {
            target.bar.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
          }
        });
      }
    }

    function readRatingState() {
      const stats = readRatingStats();
      return {
        stats,
        star: getCurrentStarLevel(),
        unique: getCurrentUniqueLevel()
      };
    }

    function applyRatingState(data) {
      if (!data || typeof data !== 'object') return;
      const stats = data.stats || {};
      if (ratingInputs.speed && typeof stats.speed === 'number') ratingInputs.speed.value = stats.speed;
      if (ratingInputs.stamina && typeof stats.stamina === 'number') ratingInputs.stamina.value = stats.stamina;
      if (ratingInputs.power && typeof stats.power === 'number') ratingInputs.power.value = stats.power;
      if (ratingInputs.guts && typeof stats.guts === 'number') ratingInputs.guts.value = stats.guts;
      if (ratingInputs.wisdom && typeof stats.wisdom === 'number') ratingInputs.wisdom.value = stats.wisdom;
      if (ratingInputs.star && typeof data.star === 'number') ratingInputs.star.value = String(data.star);
      if (ratingInputs.unique && typeof data.unique === 'number') ratingInputs.unique.value = String(data.unique);
    }

    function handleRatingInputChange() {
      updateRatingDisplay();
      if (typeof onChange === 'function') onChange();
    }

    function initRatingInputs() {
      Object.values(ratingInputs).forEach(input => {
        if (!input) return;
        input.addEventListener('input', handleRatingInputChange);
        input.addEventListener('change', handleRatingInputChange);
      });
      updateRatingDisplay();
    }

    return {
      updateRatingDisplay,
      readRatingState,
      applyRatingState,
      initRatingInputs,
      loadRatingSprite
    };
  }

  global.RatingShared = {
    createAffinityHelpers,
    createRatingEngine
  };
})(window);

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
    const STAT_MULTIPLIERS = [
      0.5, 0.8, 1, 1.3, 1.6, 1.8, 2.1, 2.4, 2.6, 2.8, 2.9, 3, 3.1, 3.3, 3.4,
      3.5, 3.9, 4.1, 4.2, 4.3, 5.2, 5.5, 6.6, 6.8, 6.9
    ];
    let lastSkillScore = 0;

    const RATING_SPRITE = {
      url: 'assets/rank_badges.png',
      version: '1',
      columns: 6,
      rows: 6,
      tileWidth: 125,
      tileHeight: 125,
      loaded: false
    };

    const RATING_BADGES = [
      { threshold: 300, label: 'G', sprite: { col: 0, row: 0 } },
      { threshold: 600, label: 'G+', sprite: { col: 0, row: 1 } },
      { threshold: 900, label: 'F', sprite: { col: 0, row: 2 } },
      { threshold: 1300, label: 'F+', sprite: { col: 0, row: 3 } },
      { threshold: 1800, label: 'E', sprite: { col: 0, row: 4 } },
      { threshold: 2300, label: 'E+', sprite: { col: 0, row: 5 } },
      { threshold: 2900, label: 'D', sprite: { col: 1, row: 0 } },
      { threshold: 3500, label: 'D+', sprite: { col: 1, row: 1 } },
      { threshold: 4900, label: 'C', sprite: { col: 1, row: 2 } },
      { threshold: 6500, label: 'C+', sprite: { col: 1, row: 3 } },
      { threshold: 8200, label: 'B', sprite: { col: 1, row: 4 } },
      { threshold: 10000, label: 'B+', sprite: { col: 1, row: 5 } },
      { threshold: 12100, label: 'A', sprite: { col: 2, row: 0 } },
      { threshold: 14500, label: 'A+', sprite: { col: 2, row: 1 } },
      { threshold: 15900, label: 'S', sprite: { col: 2, row: 2 } },
      { threshold: 17500, label: 'S+', sprite: { col: 2, row: 3 } },
      { threshold: 19200, label: 'SS', sprite: { col: 2, row: 4 } },
      { threshold: 19600, label: 'SS+', sprite: { col: 2, row: 5 } },
      { threshold: 20000, label: 'UG', sprite: { col: 3, row: 0 } },
      { threshold: 20400, label: 'UG1', sprite: { col: 3, row: 1 } },
      { threshold: 20800, label: 'UG2', sprite: { col: 3, row: 2 } },
      { threshold: 21200, label: 'UG3', sprite: { col: 3, row: 3 } },
      { threshold: 21600, label: 'UG4', sprite: { col: 3, row: 4 } },
      { threshold: 22100, label: 'UG5', sprite: { col: 3, row: 5 } },
      { threshold: 22500, label: 'UG6', sprite: { col: 4, row: 0 } },
      { threshold: 23000, label: 'UG7', sprite: { col: 4, row: 1 } },
      { threshold: 23400, label: 'UG8', sprite: { col: 4, row: 2 } },
      { threshold: 23900, label: 'UG9', sprite: { col: 4, row: 3 } },
      { threshold: 24300, label: 'UF', sprite: { col: 4, row: 4 } },
      { threshold: 24800, label: 'UF1', sprite: { col: 4, row: 5 } },
      { threshold: 25300, label: 'UF2', sprite: { col: 5, row: 0 } },
      { threshold: 25800, label: 'UF3', sprite: { col: 5, row: 1 } },
      { threshold: 26300, label: 'UF4', sprite: { col: 5, row: 2 } },
      { threshold: 26800, label: 'UF5', sprite: { col: 5, row: 3 } },
      { threshold: 27300, label: 'UF6', sprite: { col: 5, row: 4 } },
      { threshold: 27800, label: 'UF7', sprite: { col: 5, row: 5 } },
      { threshold: Infinity, label: 'UF7', sprite: { col: 5, row: 5 } },
    ];

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

    function applyBadgeSpriteStyles(target, spriteUrl, sheetWidth, sheetHeight) {
      if (!target) return;
      const badgeWidth = target.clientWidth || RATING_SPRITE.tileWidth;
      const badgeHeight = target.clientHeight || RATING_SPRITE.tileHeight;
      const scaleX = badgeWidth / RATING_SPRITE.tileWidth;
      const scaleY = badgeHeight / RATING_SPRITE.tileHeight;
      const bgWidth = sheetWidth * scaleX;
      const bgHeight = sheetHeight * scaleY;
      target.style.backgroundImage = `url(${spriteUrl})`;
      target.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
    }

    function loadRatingSprite() {
      if (!ratingDisplays.badgeSprite && !ratingDisplays.floatBadgeSprite) return;
      const spriteUrl = RATING_SPRITE.version
        ? `${RATING_SPRITE.url}?v=${RATING_SPRITE.version}`
        : RATING_SPRITE.url;
      const img = new Image();
      img.onload = () => {
        const sheetWidth = img.naturalWidth;
        const sheetHeight = img.naturalHeight;
        RATING_SPRITE.tileWidth = sheetWidth / RATING_SPRITE.columns;
        RATING_SPRITE.tileHeight = sheetHeight / RATING_SPRITE.rows;
        RATING_SPRITE.loaded = true;
        applyBadgeSpriteStyles(ratingDisplays.badgeSprite, spriteUrl, sheetWidth, sheetHeight);
        applyBadgeSpriteStyles(ratingDisplays.floatBadgeSprite, spriteUrl, sheetWidth, sheetHeight);
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

    function getMultiplierForBlock(blockIndex) {
      if (blockIndex < STAT_MULTIPLIERS.length) {
        return STAT_MULTIPLIERS[blockIndex];
      }
      return STAT_MULTIPLIERS[STAT_MULTIPLIERS.length - 1];
    }

    function calcStatScore(statValue) {
      const value = clampStatValue(statValue);
      const blocks = Math.floor(value / STAT_BLOCK_SIZE);
      let blockSum = 0;
      for (let i = 0; i < blocks && i < STAT_MULTIPLIERS.length; i++) {
        blockSum += STAT_MULTIPLIERS[i] * STAT_BLOCK_SIZE;
      }
      const remainder = value % STAT_BLOCK_SIZE;
      const multiplier = getMultiplierForBlock(blocks);
      const remainderSum = multiplier * (remainder + 1);
      return Math.floor(blockSum + remainderSum);
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
      if (RATING_SPRITE.loaded && badge.sprite) {
        const badgeWidth = target.clientWidth || RATING_SPRITE.tileWidth;
        const badgeHeight = target.clientHeight || RATING_SPRITE.tileHeight;
        const offsetX = badge.sprite.col * badgeWidth;
        const offsetY = badge.sprite.row * badgeHeight;
        target.style.backgroundPosition = `-${offsetX}px -${offsetY}px`;
        target.textContent = '';
      } else {
        target.style.backgroundImage = 'none';
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

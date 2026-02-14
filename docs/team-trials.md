# Team Trials: Consistency-First Skill Selection

A deep dive into how Team Trials mode selects skills differently from Rating mode, why consistency matters more than raw score, and how every weight and threshold shapes the final loadout.

---

## 1. What is Team Trials Mode?

Team Trials mode is a specialized optimizer mode that prioritizes skill activation **consistency** over raw rating score. In Team Trials races, conditions vary between matches -- track surface, distance, weather, and positioning all shift from race to race. A skill that activates reliably (80% of the time) is more valuable than one that scores higher on paper but only triggers 40% of the time.

The core insight is simple: **a skill you can count on is worth more than a skill that might not fire.** Team Trials mode encodes that philosophy into every layer of the optimization pipeline, from scoring to filtering to the DP solver itself.

---

## 2. Priority Order

The optimizer uses a strict priority chain. Each criterion is only considered if the previous one ties:

1. **Maximize total consistency score** -- how reliably the selected skills activate
2. **Maximize count of consistent gold skills** -- gold skills meeting a reliability threshold
3. **Maximize total expected value** -- a consistency-aware composite metric
4. **Maximize total rating score** -- the traditional rating contribution

This is fundamentally different from Rating mode, which only cares about criterion #4. In Team Trials, a loadout with slightly lower rating but significantly higher consistency will always win.

---

## 3. Consistency Scoring

Each skill receives a consistency score in the range **[0.05, 0.99]** based on analysis of its trigger conditions. The score is built from three components, each examining a different axis of reliability.

### 3.1 Timing Certainty (weight: 45%)

How reliably the skill activates based on its timing window. Skills that fire predictably in well-defined race phases score highest.

| Timing Pattern                               | Score    | Notes                                |
| -------------------------------------------- | -------- | ------------------------------------ |
| `always == 1` (passive/constant)             | **0.98** | Highest reliability -- always active |
| Last spurt / final corner / last straight    | **0.88** | 0.76 if random variant               |
| Distance rate within 20% window              | **0.82** | Narrow positional trigger            |
| Specific phase (phase 1-4)                   | **0.76** | Predictable but phase-dependent      |
| Distance rate outside 20% window             | **0.72** | Wider positional trigger             |
| Default (unrecognized)                       | **0.68** | Unknown timing pattern               |
| Random timing (phase/corner/straight random) | **0.62** | Lowest -- unpredictable activation   |

### 3.2 Condition Breadth (weight: 30%)

How many race scenarios trigger the skill. Narrow conditions (like "must be in first place") are penalized heavily.

- **`order == 1`** (first place only): capped at **0.18** -- extremely narrow
- **`order <= 5`**: boosted to at least **0.52** -- reasonably broad
- Broader ordinal and distance ranges score progressively higher
- Each complex comparator beyond 4: **-0.05** penalty
- **`near_count >= X`**: contribution calculated as `(10 - X) / 10`

The breadth score rewards skills that can fire in a wide range of race states. A skill requiring "order <= 8" covers most scenarios, while "order == 1" demands a very specific situation.

### 3.3 Scenario Dependence (weight: 25%)

Penalty for situational triggers that may not occur in a given race. The base score starts at **0.95** and is reduced by applicable penalties.

| Condition                        | Penalty   |
| -------------------------------- | --------- |
| `blocked_front` / `blocked_side` | **-0.22** |
| `is_overtake`                    | **-0.18** |
| `is_surrounded` / `temptation`   | **-0.20** |
| `change_order_onetime`           | **-0.14** |
| `popularity` / `post_number`     | **-0.12** |
| `is_activate_other_skill_detail` | **-0.09** |
| `always == 1` bonus              | **+0.04** |

Skills that depend on being blocked, overtaking, or other race-state events take significant hits because those events are not guaranteed to happen.

### 3.4 Group Synthesis

Many skills have multiple trigger condition groups (logical OR). Each group is scored independently, then combined:

1. Average timing, breadth, and scenario scores across all groups
2. Apply **strictness penalties** for:
   - Complex conditions (5+ comparators): ~0.04
   - `order == 1` requirement: ~0.04
3. Compute the group score:

```text
groupScore = (timing * 0.45) + (breadth * 0.30) + (scenario * 0.25) - strictnessPenalty
```

1. Multiple groups receive a **fallback bonus**: +0.03 per additional group, capped at +0.08

The fallback bonus reflects the reality that having multiple trigger paths increases the chance at least one fires.

### 3.5 Tier Tag Adjustments

Tags from `assets/skill_tiers.csv` can override the computed consistency:

| Tag                     | Effect                             |
| ----------------------- | ---------------------------------- |
| `inconsistent`          | Cap at **0.45**                    |
| `consistent`            | **+0.10** bonus                    |
| `team_trials` or `core` | **+0.12** bonus, floor at **0.65** |
| Marker `x` (cross)      | Cap at **0.24**                    |
| Marker `◎` or `○`       | Floor at **0.62**                  |

These manual overrides let curators correct for edge cases the algorithm cannot detect from condition data alone.

### 3.6 Green Skill Penalty

Green-category skills receive:

- **-0.18** consistency penalty
- **-12%** expected value reduction

**Rationale:** Green skills typically depend on variable race conditions (positioning, stamina state, etc.) that are less predictable in the shifting Team Trials environment.

### 3.7 Volatile Race Condition Penalty

Skills requiring specific `track_id`, `ground_condition`, `weather`, `season`, or `rotation`:

- **-0.22** consistency penalty
- **-20%** expected value reduction
- **Exception:** Skills tagged `team_trials` or `core` receive only **half** severity

These penalties exist because Team Trials matches cycle through different conditions. A skill that only works on turf in sunny weather will be dead weight half the time.

---

## 4. Expected Value

Expected value combines consistency with cost efficiency into a single metric. It answers the question: "Given how likely this skill is to fire, how much value does it actually deliver per skill point spent?"

```text
expectedValue = ((consistency * 0.68) + (tierBonus * 0.32))
              * ((efficiency * 0.58) + (ratingNorm * 0.42))
              * expectedMultiplier
```

Where:

- **`efficiency`** = ratingScore / costSP (how much rating you get per skill point)
- **`ratingNorm`** = ratingScore / max rating in the candidate set (relative strength)
- **`expectedMultiplier`** = 1.0 normally, reduced by green and volatile penalties

### Bonuses

Certain skill profiles receive expected value bonuses to ensure late-game coverage:

| Profile                     | Bonus     | Conditions                                                     |
| --------------------------- | --------- | -------------------------------------------------------------- |
| Consistent gold             | **+0.14** | consistency >= 0.58, not volatile                              |
| Reliable late acceleration  | **+0.28** | acceleration effect + late timing window + consistency >= 0.58 |
| Reliable late speed trigger | **+0.20** | speed effect + late timing window                              |

These bonuses nudge the optimizer toward loadouts with strong endgame skills, which are critical in Team Trials where late-race performance often decides the outcome.

---

## 5. Applicability Filtering

Before optimization begins, skills are strictly filtered against the user's race configuration. This is more aggressive than Rating mode filtering.

The filter checks:

- **`distance_type`** against the selected distance (short, mile, medium, long, dirt)
- **`ground_type`** against the selected track surface (turf, dirt)
- **`running_style`** against the selected strategy (nige, senkou, sashi, oikomi)
- Falls back to **skill type tags** (`mil`, `med`, `lng`, `sho`, `tur`, `dir`, etc.)

Even **locked and required skills** are removed if they do not match the race configuration. There is no override -- an inapplicable skill provides zero value in Team Trials and would waste skill points.

**Example:** With a Turf + Medium + Pace setup, a Mile-only skill is filtered out entirely, regardless of its rating or consistency score.

---

## 6. Dependency Groups

Team Trials uses the same dependency group system as Rating mode:

- **Gold + lower combos** -- selecting a gold skill automatically includes its linked lower version; the gold cost already accounts for both
- **Circle skill combos** (◎/○) -- additive cost; selecting ○ can bring ◎ as an upgrade
- **Parent chain requirements** -- some skills require a prerequisite skill
- **Standalone skills** -- no dependencies, evaluated individually

The grouped knapsack solver handles all of these as atomic selection units, ensuring dependency constraints are always satisfied.

---

## 7. DP Solver

The solver uses a grouped knapsack algorithm with a **4-criterion comparison function**. Unlike Rating mode's single-criterion comparison, Team Trials evaluates candidates across all four priority levels:

```text
better(candidate, current):
  1. Higher consistency?      -> pick candidate
  2. Higher gold count?       -> pick candidate
  3. Higher expected value?   -> pick candidate
  4. Higher rating?           -> pick candidate
  5. Lower tie index?         -> pick candidate (deterministic tiebreak)
```

At each step, the solver only moves to the next criterion if the previous one is tied. This guarantees that consistency is never sacrificed for rating.

### Core Masks

The solver also tracks **core masks** to ensure late-game skill coverage:

| Mask              | Value | Meaning                                     |
| ----------------- | ----- | ------------------------------------------- |
| `CORE_MASK_ACCEL` | 1     | Reliable late acceleration skill is present |
| `CORE_MASK_SPEED` | 2     | Reliable late speed skill is present        |

When comparing two otherwise-equal solutions, the solver prefers the one with better core mask coverage. This prevents loadouts that are consistent overall but lack critical endgame tools.

---

## 8. Result Breakdown

Each selected skill in the output includes detailed metadata explaining why it was chosen:

| Field                    | Meaning                                                |
| ------------------------ | ------------------------------------------------------ |
| `consistencyScore`       | Final reliability score (0-1, displayed as percentage) |
| `ratingScore`            | Base rating contribution                               |
| `scorePerSP`             | Rating per skill point (cost efficiency)               |
| `tierBonus`              | Bonus from tier list tags                              |
| `expectedValue`          | Consistency-aware composite value metric               |
| `reasons`                | Up to 4 human-readable explanation strings             |
| `isRisky`                | `true` if consistency < 0.42                           |
| `consistentGoldPriority` | `true` if gold + consistent + not volatile             |

The `reasons` array provides plain-language explanations like "High consistency (82%)" or "Late acceleration bonus applied", making it easy for users to understand the selection logic without reading code.

---

## 9. Tuning Weights

All weights are configurable via `DEFAULT_WEIGHTS` in `js/team-trials-optimizer.js`. Adjusting these values changes how aggressively the optimizer pursues consistency versus raw power.

### Weight Reference

| Weight                                    | Default | Description                                                |
| ----------------------------------------- | ------- | ---------------------------------------------------------- |
| `consistency`                             | 0.68    | Weight of consistency in expected value calculation        |
| `tier`                                    | 0.32    | Weight of tier bonus in expected value calculation         |
| `efficiency`                              | 0.58    | Weight of cost efficiency in expected value                |
| `rating`                                  | 0.42    | Weight of raw rating in expected value                     |
| `coreAccelBonus`                          | 0.28    | Expected value bonus for late acceleration skills          |
| `coreSpeedBonus`                          | 0.20    | Expected value bonus for late speed skills                 |
| `consistentGoldMinConsistency`            | 0.58    | Minimum consistency for gold priority treatment            |
| `consistentGoldConsistencyBonus`          | 0.06    | Consistency bonus for qualifying gold skills               |
| `consistentGoldExpectedBonus`             | 0.14    | Expected value bonus for qualifying gold skills            |
| `greenSkillConsistencyPenalty`            | 0.18    | Consistency reduction for green-category skills            |
| `greenSkillExpectedPenalty`               | 0.12    | Expected value reduction for green-category skills         |
| `volatileRaceConditionConsistencyPenalty` | 0.22    | Consistency reduction for volatile race conditions         |
| `volatileRaceConditionExpectedPenalty`    | 0.20    | Expected value reduction for volatile race conditions      |
| `tierCorePenaltyReduction`                | 0.50    | Penalty reduction multiplier for team_trials-tagged skills |

### Tuning Directions

| Goal                                         | What to adjust                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Stricter reliability**                     | Raise `consistency`, lower `rating`                                                                       |
| **More late-game focus**                     | Raise `coreAccelBonus` and `coreSpeedBonus`                                                               |
| **Stronger gold preference**                 | Raise `consistentGoldMinConsistency`, `consistentGoldConsistencyBonus`, and `consistentGoldExpectedBonus` |
| **Avoid green skills more aggressively**     | Raise both `greenSkillConsistencyPenalty` and `greenSkillExpectedPenalty`                                 |
| **Avoid volatile conditions**                | Raise both `volatileRaceConditionConsistencyPenalty` and `volatileRaceConditionExpectedPenalty`           |
| **Looser reliability (allow riskier picks)** | Lower `consistency`, raise `rating`                                                                       |
| **Trust tier tags more**                     | Raise `tier`, lower `consistency`                                                                         |

Note that `consistency` + `tier` should sum to 1.0, and `efficiency` + `rating` should sum to 1.0, since they represent complementary shares of the same calculation.

---

## 10. Rating Mode vs Team Trials -- Comparison Table

| Aspect                  | Rating Mode             | Team Trials                                                         |
| ----------------------- | ----------------------- | ------------------------------------------------------------------- |
| **Primary goal**        | Maximize rating score   | Maximize consistency                                                |
| **DP priority**         | Single criterion: score | Multi-criterion: consistency > gold count > expected value > rating |
| **Green skills**        | Normal weight           | -18% consistency, -12% expected value                               |
| **Volatile conditions** | Normal weight           | -22% consistency, -20% expected value                               |
| **Skill filtering**     | All available skills    | Strict: must match distance/track/strategy                          |
| **Tier tags**           | Not used                | Used: team_trials / core / consistent / inconsistent                |
| **Late-game tracking**  | Not tracked             | Core masks for acceleration + speed coverage                        |
| **Explanations**        | Rating breakdown        | Consistency breakdown + strengths/risks                             |
| **Comparison function** | Higher score wins       | 4-level priority chain                                              |
| **Result metadata**     | Rating, SP cost         | Rating, SP cost, consistency %, expected value, risk flags, reasons |

---

## 11. Source Files

| File                          | Responsibility                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `js/team-trials-optimizer.js` | Full Team Trials algorithm: consistency scoring, expected value, filtering, DP solver |
| `js/optimizer.js`             | Integration with the UI, dependency group construction, mode switching                |
| `assets/skill_tiers.csv`      | Tier notes and tags (team_trials, core, consistent, inconsistent, markers)            |
| `assets/skills_all.json`      | Skill metadata including trigger conditions, effects, and timing data                 |

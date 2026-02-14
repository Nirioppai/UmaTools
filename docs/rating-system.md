# Rating Calculation and Skill Optimization System

This document is a comprehensive reference for how the rating system works in Uma Event Helper Web. It covers stat scoring, unique skill bonuses, skill evaluation, cost discounting, dependency linking, and the optimization engine. Whether you are a user trying to understand the math behind your rating or a developer maintaining the code, this should have everything you need.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Stat Scoring](#2-stat-scoring)
3. [Unique Skill Bonus](#3-unique-skill-bonus)
4. [Skill Scoring](#4-skill-scoring)
5. [Skill Costs and Discounts](#5-skill-costs-and-discounts)
6. [Skill Dependencies](#6-skill-dependencies)
7. [Optimization Engine](#7-optimization-engine)
8. [Rating Badges](#8-rating-badges)
9. [Tips](#9-tips)
10. [Source Files](#10-source-files)

---

## 1. Overview

A character's **Total Rating** is the sum of three independent components:

```
Total Rating = Stat Score + Unique Bonus + Skill Score
```

| Component        | What It Measures                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Stat Score**   | How high your five stats (Speed, Stamina, Power, Guts, Wisdom) are, scored using progressively increasing per-block rates. |
| **Unique Bonus** | A flat bonus based on the character's star level and unique skill level.                                                   |
| **Skill Score**  | The sum of all selected skills' scores, evaluated against your race aptitudes.                                             |

Each component is calculated independently and then summed to produce the final rating, which determines your badge tier (G through US9).

---

## 2. Stat Scoring

Each of the five stats -- Speed, Stamina, Power, Guts, and Wisdom -- is clamped to the range **0 to 2000** and then scored independently. The scores for all five stats are summed to produce the total stat score.

### How It Works

The code stores the **exact stat score at every 50-point boundary** (0, 50, 100, ..., 2000) in a lookup table. For values between boundaries, it interpolates using the block's per-point rate.

### Boundary Score Table

| Stat | Score |     | Stat | Score |     | Stat | Score |
| ---: | ----: | --- | ---: | ----: | --- | ---: | ----: |
|    0 |     0 |     |  700 |  1298 |     | 1400 |  5665 |
|   50 |    25 |     |  750 |  1463 |     | 1450 |  6203 |
|  100 |    66 |     |  800 |  1633 |     | 1500 |  6773 |
|  150 |   116 |     |  850 |  1808 |     | 1550 |  7377 |
|  200 |   181 |     |  900 |  2004 |     | 1600 |  8013 |
|  250 |   261 |     |  950 |  2209 |     | 1650 |  8682 |
|  300 |   352 |     | 1000 |  2419 |     | 1700 |  9384 |
|  350 |   457 |     | 1050 |  2635 |     | 1750 | 10117 |
|  400 |   577 |     | 1100 |  2895 |     | 1800 | 10885 |
|  450 |   707 |     | 1150 |  3171 |     | 1850 | 11684 |
|  500 |   847 |     | 1200 |  3501 |     | 1900 | 12516 |
|  550 |   993 |     | 1250 |  3841 |     | 1950 | 13383 |
|  600 |  1143 |     | 1300 |  4249 |     | 2000 | 14280 |
|  650 |  1298 |     | 1350 |  4688 |     |      |       |

The score grows slowly at low stats (25 points for the first 50) and accelerates dramatically at high stats (897 points for the last 50).

### Formula

```
idx       = floor(stat / 50)
remainder = stat % 50

base      = BOUNDARY_SCORES[idx]
blockDiff = BOUNDARY_SCORES[idx + 1] - base

statScore = base + round(blockDiff * remainder / 50)
```

Key details:

- At exact boundaries (remainder = 0), the score equals the table value directly.
- Between boundaries, `blockDiff / 50` acts as the effective per-point rate for that block, with rounding for precision.
- Stats above 2000 are clamped to 2000 before scoring. Stats below 0 are clamped to 0.

### Worked Example: stat = 1500

```
idx       = floor(1500 / 50) = 30
remainder = 1500 % 50 = 0
base      = BOUNDARY_SCORES[30] = 6773

statScore = 6773
```

So a single stat at 1500 contributes **6773** to the total stat score.

### Total Stat Score

```
totalStatScore = calcStatScore(speed)
               + calcStatScore(stamina)
               + calcStatScore(power)
               + calcStatScore(guts)
               + calcStatScore(wisdom)
```

---

## 3. Unique Skill Bonus

The unique skill bonus is a flat addition based on two inputs: the character's **star level** and their **unique skill level**.

### Unique Bonus Formula

```
uniqueBonus = uniqueLevel * multiplier
```

Where:

| Star Level | Multiplier |
| ---------: | ---------: |
|     1 or 2 |        120 |
|         3+ |        170 |

If `uniqueLevel` is 0, the bonus is 0.

### Examples

| Stars | Level | Calculation | Bonus |
| ----: | ----: | ----------- | ----: |
|  1--2 |     5 | 5 \* 120    |   600 |
|    3+ |     5 | 5 \* 170    |   850 |
|    3+ |    10 | 10 \* 170   | 1,700 |
|   Any |     0 | 0 \* any    |     0 |

---

## 4. Skill Scoring

Each skill has a **score** that contributes to the total rating. Scores can be either a flat number or an object containing multiple buckets that vary based on the character's race aptitudes.

### Bucket Selection

When a skill has a `checkType` (e.g., `"turf"`, `"mile"`, `"front"`), the game looks at the character's aptitude grade for that type and maps it to a score bucket:

| Aptitude Grade | Bucket     |
| :------------- | :--------- |
| S, A           | `good`     |
| B, C           | `average`  |
| D, E, F        | `bad`      |
| Anything else  | `terrible` |

If a skill has **no** `checkType`, the bucket is `"base"`.

### Valid Check Types

```
turf, dirt, sprint, mile, medium, long, front, pace, late, end
```

These correspond to the ten aptitude selectors in the optimizer UI.

### Score Evaluation

The evaluation logic (`evaluateSkillScore`) works as follows:

1. If `skill.score` is a plain number, use it directly.
2. If `skill.score` is an object, look up `score[bucket]` based on the check type and aptitude.
3. If the bucket key is missing from the object, the score is **0**.

### Scores in Combos

When skills are combined through gold or circle linking:

- **Gold combo**: Only the gold skill's score counts. The prerequisite lower skill's score is set to 0 in the combo.
- **Circle combo**: Only the double-circle upgrade's score counts. The single-circle base's score is replaced.

This means you never "double-dip" on scores for linked skill pairs.

---

## 5. Skill Costs and Discounts

### Base Costs

Base skill costs are sourced from:

1. **`assets/skills_all.json`** (primary source) -- contains detailed skill metadata including costs and relationships.
2. **`assets/uma_skills.csv`** (fallback) -- the skill database with 443 skills.

When a skill is added to the optimizer, the base cost is stored in `row.dataset.baseCost` so discounting can be recalculated if the hint level changes.

### Hint Discount Table

Hint levels reduce the cost of a skill. The discount percentages are:

| Hint Level | Discount |
| ---------: | -------: |
|          0 |       0% |
|          1 |      10% |
|          2 |      20% |
|          3 |      30% |
|          4 |      35% |
|          5 |      40% |

Note that hint levels 1--3 increase by 10% each, then the curve flattens: level 4 is only +5% over level 3, and level 5 is another +5%.

### Fast Learner

The **Fast Learner** toggle adds a flat **10%** discount that stacks additively with the hint discount.

### Final Cost Formula

```
totalDiscount = hintDiscount + fastLearnerDiscount
finalCost     = floor(baseCost * max(0, 1 - totalDiscount))
```

The `max(0, ...)` ensures the multiplier never goes negative (though in practice the maximum combined discount is 50%: hint level 5 at 40% plus Fast Learner at 10%).

### Manual Cost Entries

If a user manually types a cost value into the cost field (rather than letting it auto-populate from the skill database), the manually entered value is used as-is. **Manual costs bypass discounting entirely** -- the optimizer uses whatever number is in the cost field.

### Discount Examples

| Base Cost | Hint Level | Fast Learner | Discount |              Final Cost |
| --------: | ---------: | :----------- | -------: | ----------------------: |
|       200 |          0 | No           |       0% |                     200 |
|       200 |          3 | No           |      30% |                     140 |
|       200 |          5 | No           |      40% |                     120 |
|       200 |          3 | Yes          |      40% |                     120 |
|       200 |          5 | Yes          |      50% |                     100 |
|       170 |          4 | Yes          |      45% | floor(170 \* 0.55) = 93 |

---

## 6. Skill Dependencies

Skills are not always independent. Three types of dependencies exist, and the optimizer handles each differently.

### Gold + Lower Linking

A gold (rare) skill typically requires a lower-rarity prerequisite skill. In the optimizer UI, adding a gold skill auto-creates a linked lower skill row below it.

The optimizer creates a **three-option decision group**:

| Option | Cost            | Score           | Description                                                                                                                        |
| -----: | :-------------- | :-------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
|      1 | 0               | 0               | Skip both skills entirely.                                                                                                         |
|      2 | Lower cost      | Lower score     | Take the lower skill only.                                                                                                         |
|      3 | Gold cost alone | Gold score only | Take the gold combo. The gold's listed cost already includes the lower skill cost, so no additional cost is charged for the lower. |

In the results, the lower skill shows as "included with [gold skill]" at 0 additional cost and 0 additional score.

### Circle Skill Linking

Single-circle skills can be upgraded to double-circle versions. Adding a single-circle skill auto-creates a linked double-circle upgrade row.

The optimizer creates a **three-option decision group**:

| Option | Cost                                     | Score                    | Description                                                               |
| -----: | :--------------------------------------- | :----------------------- | :------------------------------------------------------------------------ |
|      1 | 0                                        | 0                        | Skip both.                                                                |
|      2 | Single-circle cost                       | Single-circle score      | Take the base version only.                                               |
|      3 | Single-circle + double-circle (additive) | Double-circle score only | Take the combo. Both costs are paid, but only the upgrade's score counts. |

The key difference from gold linking: circle combo cost is **additive** (base + upgrade), while gold combo cost uses **only the gold cost** (which already subsumes the lower).

### Parent Dependencies

Some skills have a parent skill that must be taken first. If a child skill is selected by the optimizer, its parent is automatically included in the result. The optimizer builds dependency chains during the `buildGroups` phase, presenting choices of:

1. Skip both
2. Take parent only
3. Take parent + child (combined cost, child's score counts)

---

## 7. Optimization Engine

### Modes

The optimizer supports three modes, selectable via the mode dropdown:

#### Rating Mode (Default)

Maximizes the total skill score (sum of all selected skills' rating scores) within the budget constraint.

```
objective = maximize(sum of ratingScore)
```

#### Aptitude Test Mode

Maximizes **aptitude points** first, then uses rating score as a tiebreaker among options with equal aptitude points.

Aptitude point values:

- **Gold/rare skill**: 1,200 points
- **Normal skill**: 400 points
- **Lower skill in a gold combo**: 0 points (does not count)

The combined score used for optimization:

```
score = aptitudeScore * 100,000 + ratingScore
```

The large multiplier (100,000) ensures aptitude points always dominate, with rating acting purely as a tiebreaker.

#### Team Trials Mode

A separate optimization system with its own scoring. See `docs/team-trials.md` for details.

### Grouped Knapsack Algorithm

The core optimizer uses **dynamic programming** to solve a bounded 0/1 knapsack problem with **mutually exclusive groups** (also known as the group knapsack or multiple-choice knapsack problem).

#### Step-by-Step Process

1. **Collect valid skill rows**: Scan the optimizer table for rows with a recognized skill name and a numeric cost. Build an `items` array and `rowsMeta` array.

2. **Expand required skills**: If any skills are marked as required (locked), ensure their dependencies (parents, lower skills) are also included.

3. **Build decision groups** (`buildGroups`): Organize items into groups based on their relationships:
   - **Gold/lower combos**: 3 options (skip, lower only, gold combo)
   - **Circle combos**: 3 options (skip, base only, upgrade combo)
   - **Parent/child chains**: 3 options (skip, parent only, parent + child)
   - **Standalone skills**: 2 options (skip or take)

   Each item is used in exactly one group. A `used` array prevents any item from appearing in multiple groups.

4. **Filter for required skills**: If any items in a group are required, remove group options that do not include those required items. If this leaves any group with zero valid options, the optimization is infeasible.

5. **Run DP**: For each group `g` (1 to G) and each budget level `b` (0 to B):
   - If the group has a "none" option, inherit the previous group's value (`dpPrev[b]`).
   - For each non-none option `k` in the group, check if its cost fits within budget `b`. If so, compute `candidate = dpPrev[b - cost] + score` and keep the best.
   - Record the chosen option in `choice[g][b]` for backtracking.

6. **Backtrack**: Starting from `choice[G][B]`, walk backwards through the groups to reconstruct which option was chosen for each group.

7. **Add remaining required items**: If any required items were not picked up during backtracking, add them to the result with their original cost and score.

8. **Error handling**: If required skills exceed the budget, the optimizer returns an error (`required_unreachable`).

#### Memory Optimization

The DP uses a **rolling two-array approach**: only `dpPrev` and `dpCurr` are maintained (rather than a full G x B matrix). The full `choice` matrix is still needed for backtracking, but the dp values themselves use O(2 x B) instead of O(G x B) space.

```
dpPrev = [0, 0, 0, ..., 0]       // B+1 elements, initialized to 0
dpCurr = [NEG, NEG, ..., NEG]    // B+1 elements, initialized to -1e15

for each group g:
    for each budget b:
        try each option, update dpCurr[b]
    swap dpPrev and dpCurr
    reset dpCurr to NEG
```

After the loop completes, `dpPrev[B]` contains the maximum achievable score within the full budget.

### Auto Build (Ideal Build)

The Auto Build feature filters skills before running the same optimization engine, then highlights matching rows in the results.

#### Filtering Rules

Skills are filtered based on the selected **auto-build targets** (checkboxes for each aptitude type plus "General"):

- **Skills with a `checkType`**: Included only if:
  1. That `checkType` is selected as a target, AND
  2. The character's aptitude for that type is **S or A** (i.e., the bucket is `"good"`)

- **Skills without a `checkType`**: Included only if the **"General"** target is selected.

#### Linked Counterparts

When filtering, the optimizer also includes linked counterparts (gold lower skills, circle upgrade skills) so that `buildGroups` can form proper combo groups. Without this, linked skills would be treated as standalone items and evaluated incorrectly.

---

## 8. Rating Badges

The total rating maps to one of 98 badge tiers. Each badge has a minimum threshold -- you receive the highest badge whose minimum threshold is less than or equal to your rating.

| Min Rating | Badge |     | Min Rating | Badge |     | Min Rating | Badge |
| ---------: | :---- | --- | ---------: | :---- | --- | ---------: | :---- |
|         0 | G     |     |    26,300 | UF5   |     |    46,200 | UC8   |
|       300 | G+    |     |    26,800 | UF6   |     |    46,900 | UC9   |
|       600 | F     |     |    27,300 | UF7   |     |    47,600 | UB    |
|       900 | F+    |     |    27,800 | UF8   |     |    48,300 | UB1   |
|     1,300 | E     |     |    28,300 | UF9   |     |    49,000 | UB2   |
|     1,800 | E+    |     |    28,800 | UE    |     |    49,800 | UB3   |
|     2,300 | D     |     |    29,400 | UE1   |     |    50,500 | UB4   |
|     2,900 | D+    |     |    29,900 | UE2   |     |    51,300 | UB5   |
|     3,500 | C     |     |    30,400 | UE3   |     |    52,000 | UB6   |
|     4,900 | C+    |     |    31,000 | UE4   |     |    52,800 | UB7   |
|     7,000 | B     |     |    31,500 | UE5   |     |    53,600 | UB8   |
|     8,200 | B+    |     |    32,100 | UE6   |     |    54,400 | UB9   |
|    10,000 | A     |     |    32,700 | UE7   |     |    55,200 | UA    |
|    12,100 | A+    |     |    33,200 | UE8   |     |    55,900 | UA1   |
|    14,500 | S     |     |    33,800 | UE9   |     |    56,700 | UA2   |
|    15,900 | S+    |     |    34,400 | UD    |     |    57,500 | UA3   |
|    17,500 | SS    |     |    35,000 | UD1   |     |    58,400 | UA4   |
|    19,200 | SS+   |     |    35,600 | UD2   |     |    59,200 | UA5   |
|    19,600 | UG    |     |    36,200 | UD3   |     |    60,000 | UA6   |
|    20,000 | UG1   |     |    36,800 | UD4   |     |    60,800 | UA7   |
|    20,400 | UG2   |     |    37,500 | UD5   |     |    61,700 | UA8   |
|    20,800 | UG3   |     |    38,100 | UD6   |     |    62,500 | UA9   |
|    21,200 | UG4   |     |    38,700 | UD7   |     |    63,400 | US    |
|    21,600 | UG5   |     |    39,400 | UD8   |     |    64,200 | US1   |
|    22,100 | UG6   |     |    40,000 | UD9   |     |    65,100 | US2   |
|    22,500 | UG7   |     |    40,700 | UC    |     |    66,000 | US3   |
|    23,000 | UG8   |     |    41,300 | UC1   |     |    66,800 | US4   |
|    23,400 | UG9   |     |    42,000 | UC2   |     |    67,700 | US5   |
|    23,900 | UF    |     |    42,700 | UC3   |     |    68,600 | US6   |
|    24,300 | UF1   |     |    43,400 | UC4   |     |    69,500 | US7   |
|    24,800 | UF2   |     |    44,000 | UC5   |     |    70,400 | US8   |
|    25,300 | UF3   |     |    44,700 | UC6   |     |    71,400 | US9   |
|    25,800 | UF4   |     |    45,400 | UC7   |     |           |       |

### Progress Bar

The UI displays a progress bar beneath the badge showing:

- Your **current badge** (rendered as a sprite from the badge sheet)
- The **next badge threshold** and its label
- **Points remaining** to reach the next tier (e.g., "+342")
- A **fill percentage** based on progress between the previous and next thresholds

At maximum rank (US9 at 71,400+), the progress bar shows "Max rank reached" with a full fill.

---

## 9. Tips

- **Set race aptitudes first.** Aptitude grades control which score bucket is used for every skill with a checkType. Changing aptitudes can dramatically shift which skills are valuable.

- **Prioritize skills whose checkType matches your strongest aptitudes (S or A).** Skills evaluated in the `"good"` bucket generally have much higher scores than the same skills evaluated in `"average"` or `"bad"`.

- **Keep costs accurate and set hint levels for proper discounting.** The optimizer can only make good decisions if cost data reflects what you will actually pay in-game. Use the hint level dropdown rather than manually editing costs when possible.

- **For gold skills, include their lower versions so the optimizer can evaluate combos.** When you add a gold skill, the linked lower skill row is created automatically. Leave it in place so the optimizer can compare "lower only" vs. "gold combo" vs. "skip both."

- **Use required locks sparingly.** Locking a skill as required forces the optimizer to include it regardless of efficiency. This reduces the optimizer's flexibility to find the best overall combination within your budget.

- **Use Auto Build for a baseline, then refine.** Run Auto Build to see the ideal skill set for your aptitudes, lock the must-haves, add any additional skills you want considered, and re-optimize.

- **Stats above 2000 are clamped and provide no additional rating benefit.** There is no reason to push any individual stat above 2000 for rating purposes. Spread the points across stats instead.

- **Rounding matters for intermediate stat values.** Between 50-point boundaries, the score is computed by rounding the proportional block difference. At exact boundaries (e.g., 1000, 1050), the score equals the lookup table value directly.

- **Pick Rating or Aptitude Test mode based on your goal.** The optimizer changes its objective accordingly -- Rating mode purely maximizes skill score, while Aptitude Test mode prioritizes earning aptitude points.

---

## 10. Source Files

| File                     | Responsibility                                                                                                                                                                                                |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/rating-shared.js`    | Stat scoring (`calcStatScore`), unique bonus (`calcUniqueBonus`), badge thresholds (`RATING_BADGES`), skill evaluation (`evaluateSkillScore`), aptitude bucket mapping (`getBucketForGrade`).                 |
| `js/optimizer.js`        | Skill row management, cost discounting (`calculateDiscountedCost`), dependency groups (`buildGroups`), knapsack DP (`optimizeGrouped`), Auto Build filtering, aptitude test scoring (`getAptitudeTestScore`). |
| `js/calculator.js`       | Standalone rating calculator page using the shared rating engine.                                                                                                                                             |
| `assets/uma_skills.csv`  | Skill database (443 skills) with names, score buckets, affinity roles, and check types.                                                                                                                       |
| `assets/skills_all.json` | Detailed skill metadata including base costs, parent/lower/circle relationships, skill IDs, and categories.                                                                                                   |

# UmaTools

A fast Uma Musume training toolkit with event OCR, skill optimization, rating calculation, and more.

**Live site**: [daftuyda.moe](https://daftuyda.moe)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/daftuyda/UmaTools)

---

## Features

### [Event Helper](https://daftuyda.moe/events)

Real-time event lookup powered by OCR. Capture your game screen, and UmaTools reads the event name, shows all options, scores them, and highlights the best choice.

### [Support Hint Finder](https://daftuyda.moe/hints)

Search for support cards by skill hints. Add hints as filter chips, choose AND/OR matching, and filter by rarity (SSR / SR / R) to find the cards you need.

### [Skill Optimizer](https://daftuyda.moe/optimizer)

Maximize your build's rating or Team Trials consistency under a skill-point budget. Set your race config and aptitudes, add skills with hint levels, and let the optimizer pick the best combination. Supports gold/lower linking, circle skill upgrades, build saving, and shareable links.

- **Rating mode** — maximizes total rating score
- **Team Trials mode** — prioritizes skill activation consistency over raw score
- **Aptitude Test mode** — maximizes aptitude test points, then rating as tiebreaker

### [Rating Calculator](https://daftuyda.moe/calculator)

Standalone rating projection. Enter your final stats, star rarity, unique skill level, and selected skills to see the projected rating and badge progress.

### [Stamina Check](https://daftuyda.moe/stamina)

Verify whether your uma has enough stamina for the race. Set distance, surface, condition, style, and mood, then enter stats and recovery skills to compare needed vs. actual stamina.

### [Umadle](https://daftuyda.moe/umadle)

A daily guessing game. Pick an uma, compare stats and hint grids, and narrow down the answer.

### [Randomizer](https://daftuyda.moe/random)

Roll a random 5-card support deck or pick a random uma. Filter by rarity, exclude cards you don't want, and optionally enable 2A- speed.

---

## Documentation

For deeper technical details on how things work under the hood:

| Doc                                    | What it covers                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [Rating System](docs/rating-system.md) | Stat scoring formula, skill score buckets, cost discounts, gold/circle skill linking, knapsack optimization algorithm, badge thresholds |
| [Team Trials](docs/team-trials.md)     | Consistency-first skill selection, trigger analysis, green/volatile penalties, expected value scoring, tuning weights                   |
| [OCR Guide](docs/ocr-guide.md)         | Image preprocessing pipeline, Tesseract config, fuzzy matching algorithm, tuning thresholds, troubleshooting                            |

---

## Acknowledgements

- Game data sourced from [GameTora](https://gametora.com)

---

<details>
<summary><strong>Local Development</strong></summary>

Requires [Node.js](https://nodejs.org) and the [Vercel CLI](https://vercel.com/download).

```bash
npm i -g vercel
git clone https://github.com/daftuyda/Uma-Event-Helper-Web.git
cd Uma-Event-Helper-Web
vercel dev --debug
```

</details>

## Checks

```bash
npm run format
npm run lint
npm test
npm run check
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html)

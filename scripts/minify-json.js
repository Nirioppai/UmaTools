const fs = require('fs');
const path = require('path');

const files = [
  'skills_all.json',
  'support_hints.json',
  'uma_data.json',
  'support_card.json',
];

for (const file of files) {
  const p = path.join(__dirname, '..', 'assets', file);
  if (!fs.existsSync(p)) {
    console.log(`${file}: skipped (not found)`);
    continue;
  }
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const before = fs.statSync(p).size;
  fs.writeFileSync(p, JSON.stringify(data));
  const after = fs.statSync(p).size;
  const pct = Math.round((1 - after / before) * 100);
  console.log(`${file}: ${before} -> ${after} (${pct}% reduction)`);
}

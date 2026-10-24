// Dev only (never imported by the page): compares the base xG in src/scoring.js with reference shots.
// Run: npm run calibrate
// Reference: open-play, foot (not header) shots and their xG from StatsBomb Open Data
// (https://github.com/statsbomb/open-data), used under its terms with credit to StatsBomb. These real numbers live only
// in this script, to tune the model's coefficients; the app itself shows synthetic data only.
// Defender effects are ignored here (we don't have those positions), so this checks baseXg, not chanceGoal.
import { baseXg } from '../src/scoring.js';

const REFERENCE = [   // x, y on the 120 x 80 pitch, real xG
  [116.6, 43.0, 0.49],
  [111.8, 32.1, 0.30],
  [103.7, 45.1, 0.28],   // high for its spot (context we can't see); no distance + angle model reaches it
  [108.8, 45.3, 0.23],
  [104.8, 30.1, 0.10],
  [103.1, 34.6, 0.11],
  [92.4, 30.0, 0.025],
  [94.3, 23.5, 0.011],
];
const TOL = 0.08;

const rows = REFERENCE.map(([x, y, real]) => {
  const model = baseXg([x, y]);
  return { x, y, real, model: +model.toFixed(3), error: +(model - real).toFixed(3), ok: Math.abs(model - real) <= TOL ? 'yes' : 'NO' };
});
console.table(rows);
const within = rows.filter(r => r.ok === 'yes').length;
const maxErr = Math.max(...rows.map(r => Math.abs(r.error)));
console.log(`${within}/${rows.length} within ±${TOL}, max error ${maxErr.toFixed(3)}`);

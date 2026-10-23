// Scoring: pure functions, no DOM access, so this file can move to a backend service
// (e.g. Azure Container Apps) unchanged.
// Positions are [x, y] on a 120 x 80 pitch; the goal attacked is at x = 120, y = 36..44.

export const PITCH = { w: 120, h: 80 };
export const GOAL = { x: 120, y1: 36, y2: 44 };

// ---- geometry helpers -------------------------------------------------------
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Distance from point p to the line SEGMENT a-b (so defenders behind the passer don't count).
export function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Angle (radians) the goal mouth covers when seen from `spot`.
export function goalAngle(spot) {
  const a1 = Math.atan2(GOAL.y1 - spot[1], GOAL.x - spot[0]);
  const a2 = Math.atan2(GOAL.y2 - spot[1], GOAL.x - spot[0]);
  return Math.abs(a2 - a1);
}

export function inTriangle(p, a, b, c) {
  const side = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = side(p, a, b), d2 = side(p, b, c), d3 = side(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// ---- the four numbers (opponents = array of freeze_frame players, goalkeeper included) ----

// 1. Chance the pass arrives (0.05 - 0.98). Model estimate.
// `lofted` = the passer is delivering a cross or lofted ball (moment.aerial): it goes over the opponents standing
// on the line, so they are not counted as lane defenders. The defender next to the receiver still counts.
export function chanceArrives(from, to, opponents, lofted = false) {
  const passDistance = dist(from, to);
  const defendersInLane = lofted ? 0 : opponents.filter(o => distToSegment(o.location, from, to) < 2.5).length;
  const nearest = Math.min(...opponents.map(o => dist(o.location, to)));
  const p = 0.98 - 0.012 * passDistance - 0.25 * defendersInLane - 0.15 * (nearest < 3 ? 1 : 0);
  return clamp(p, 0.05, 0.98);
}

// 2. Chance of a goal from the receiver's spot (0.01 - 0.6): a simple xG. Model estimate.
export function chanceGoal(spot, opponents) {
  const distanceToGoal = dist(spot, [GOAL.x, 40]);
  const z = -1.2 + 1.5 * goalAngle(spot) - 0.11 * distanceToGoal;
  const xg = 1 / (1 + Math.exp(-z));
  const post1 = [GOAL.x, GOAL.y1], post2 = [GOAL.x, GOAL.y2];
  const blockers = opponents.filter(o => inTriangle(o.location, spot, post1, post2)).length;
  return clamp(xg - 0.03 * blockers, 0.01, 0.6);
}

// 4. Defenders cut out: outfield opponents strictly between passer and receiver in x. A fact, not an estimate.
export function defendersCutOut(from, to, opponents) {
  return opponents.filter(o => !o.gk && o.location[0] > from[0] && o.location[0] < to[0]).length;
}

// ---- scoring one pass moment -------------------------------------------------

// Scores every teammate of the passer (goalkeeper and the passer excluded) as an option.
// Each option is scored at its `target`: the teammate's position at the pass. With moment.scoreAtEnd, the played
// pass is scored at the pass's end location instead (a through ball into space: the event's real reception point).
export function scoreOptions(moment) {
  const ff = moment.freeze_frame;
  const passer = ff.find(p => p.player === moment.passer);
  const opponents = ff.filter(p => !p.teammate);
  return ff
    .filter(p => p.teammate && !p.gk && p.player !== moment.passer)
    .map(p => {
      const played = p.player === moment.receiver;
      const target = played && moment.scoreAtEnd ? moment.end : p.location;
      const arrives = chanceArrives(passer.location, target, opponents, !!moment.aerial);
      const goal = chanceGoal(target, opponents);
      return {
        player: p.player,
        location: p.location,
        target,
        played,
        arrives,
        goal,
        ev: arrives * goal,                                          // 3. expected value = 1 x 2
        cutOut: defendersCutOut(passer.location, target, opponents),
      };
    });
}

export const VERDICTS = {
  best:    'Best option on the pitch',
  brave:   'The brave pass',
  line:    'Line-breaker',
  timing:  'Perfect timing',
};
export const EPS = 1e-9;

// Numbers decide, in priority order. Ties go to the played pass.
export function pickVerdict(options) {
  const played = options.find(o => o.played);
  const max = key => Math.max(...options.map(o => o[key]));
  let key = 'timing';
  if (played.ev >= max('ev') - EPS) key = 'best';
  else if (played.goal >= max('goal') - EPS) key = 'brave';
  else if (played.cutOut >= max('cutOut')) key = 'line';
  return { key, label: VERDICTS[key] };
}

export function analyseMoment(moment) {
  const options = scoreOptions(moment);
  return { moment, options, played: options.find(o => o.played), verdict: pickVerdict(options) };
}

// ---- wording -----------------------------------------------------------------

export function fmtPct(p) {
  return (p < 0.1 ? (p * 100).toFixed(1) : Math.round(p * 100)) + '%';
}
export function describeChance(p) {
  return p <= 0.5 ? `1-in-${Math.round(1 / p)}` : fmtPct(p);
}

// TODO(next step): this function will be replaced by an Azure OpenAI call that receives the same
// `analysis` object and must write its sentence using only these numbers.
// For now it is a plain template, so the page labels it "auto-generated from the numbers".
export function getVerdictSentence(analysis) {
  const { options, played, verdict } = analysis;
  const others = options.filter(o => !o.played);
  const best = (arr, key) => arr.reduce((a, b) => (b[key] > a[key] ? b : a));

  if (verdict.key === 'best') {
    const next = best(others, 'ev');
    return `${verdict.label}: a ${fmtPct(played.arrives)} chance it arrives and a ${fmtPct(played.goal)} chance of a goal ` +
           `gave the highest expected value (${fmtPct(played.ev)}) of all ${options.length} options, ahead of the next best at ${fmtPct(next.ev)}.`;
  }
  if (verdict.key === 'brave') {
    // compared with the best alternative (highest expected value), so the ratio is meaningful
    const alt = best(others, 'ev');
    const ratio = played.goal / alt.goal;
    const reward = ratio < 1.15 ? 'a higher goal chance than'
      : Math.abs(ratio - 2) < 0.05 ? 'double the goal chance of'
      : `${ratio.toFixed(1)}× the goal chance of`;
    return `${verdict.label}: a ${describeChance(played.arrives)} chance it arrives, but ${reward} the best alternative (${fmtPct(alt.goal)}), and it paid off.`;
  }
  if (verdict.key === 'line') {
    const most = Math.max(...others.map(o => o.cutOut));
    const compare = played.cutOut > most ? 'more than any other option' : 'as many as any other option';
    return `${verdict.label}: one pass cut out ${played.cutOut} defenders, ${compare}, with a ${fmtPct(played.arrives)} chance of arriving.`;
  }
  return `${verdict.label}: a ${fmtPct(played.arrives)} chance it arrives and a ${fmtPct(played.goal)} chance of a goal, and the pass found its player.`;
}

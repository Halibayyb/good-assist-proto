// Scoring: pure functions, no DOM access, so this file can move to a backend service
// (e.g. Azure Container Apps) unchanged.
// Positions are [x, y] on a 120 x 80 pitch; the goal attacked is at x = 120, y = 36..44.
import { normalizeRun, positionAt } from './motion.js';

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

// Distance from p to triangle abc: 0 inside, otherwise distance to the nearest edge.
export function distToTriangle(p, a, b, c) {
  if (inTriangle(p, a, b, c)) return 0;
  return Math.min(distToSegment(p, a, b), distToSegment(p, b, c), distToSegment(p, c, a));
}

// ---- the four numbers (opponents = array of freeze_frame players, goalkeeper included) ----

// 1. Chance the pass arrives (0.05 - 0.98). Model estimate.
// `lofted` = the passer is delivering a cross or lofted ball (moment.aerial): it goes over the opponents standing
// on the line, so they are not counted as lane defenders. A ball in the air is harder to deliver and control, though,
// so it pays a flat penalty instead. The defender next to the receiver still counts.
export const PASS = { base: 0.98, perUnit: 0.012, laneWidth: 2.5, perLaneDefender: 0.25, markerRadius: 3, tightMarker: 0.15, lofted: 0.10, min: 0.05, max: 0.98 };
export function chanceArrives(from, to, opponents, lofted = false) {
  const passDistance = dist(from, to);
  const defendersInLane = lofted ? 0 : opponents.filter(o => distToSegment(o.location, from, to) < PASS.laneWidth).length;
  const nearest = Math.min(...opponents.map(o => dist(o.location, to)));
  const p = PASS.base - PASS.perUnit * passDistance - PASS.perLaneDefender * defendersInLane
    - PASS.tightMarker * (nearest < PASS.markerRadius ? 1 : 0) - (lofted ? PASS.lofted : 0);
  return clamp(p, PASS.min, PASS.max);
}

// 2. Chance of a goal from the receiver's spot (0.01 - 0.7): a simple xG. Model estimate.
// The base is a logistic on distance and angle, hand-tuned against reference open-play shots (scripts/calibrate.js).
// The base already assumes a keeper, so only outfield opponents near the receiver-post-post triangle change it.
// Each one is a partial blocker, weight = max(0, 1 - distance to the triangle / XG.soft): 1 inside it, fading to 0 at
// XG.soft units outside. With b = the summed weight, the factor is perBlocker^b once b >= 1, and below that it blends
// from the "only the keeper to beat" boost (b = 0) down to perBlocker (b = 1): keeperOnly^(1-b) x perBlocker^b.
// So a defender stepping into the shooting lane changes the chance continuously, with no cliff. The keeper is never a blocker.
export const XG = { a: -0.2, angle: 0.5, dist: 0.095, perBlocker: 0.8, keeperOnly: 1.6, soft: 1.5, min: 0.01, max: 0.7 };
export function baseXg(spot) {
  const z = XG.a + XG.angle * goalAngle(spot) - XG.dist * dist(spot, [GOAL.x, 40]);
  return 1 / (1 + Math.exp(-z));
}
export function blockerWeight(spot, opponents) {
  const post1 = [GOAL.x, GOAL.y1], post2 = [GOAL.x, GOAL.y2];
  return opponents.filter(o => !o.gk)
    .reduce((b, o) => b + Math.max(0, 1 - distToTriangle(o.location, spot, post1, post2) / XG.soft), 0);
}
export function blockerFactor(b) {
  return b >= 1 ? XG.perBlocker ** b : XG.keeperOnly ** (1 - b) * XG.perBlocker ** b;
}
export function chanceGoal(spot, opponents) {
  return clamp(baseXg(spot) * blockerFactor(blockerWeight(spot, opponents)), XG.min, XG.max);
}

// 4. Defenders cut out: outfield opponents strictly between passer and receiver in x, and involved in the play:
// within CUT.involved units of the pass. A winger tracking back on the far touchline doesn't count. A fact, not an estimate.
export const CUT = { involved: 12 };
export function defendersCutOut(from, to, opponents) {
  return opponents.filter(o => !o.gk && o.location[0] > from[0] && o.location[0] < to[0]
    && distToSegment(o.location, from, to) <= CUT.involved).length;
}

// Where an option is scored. For a ball into space (moment.intoSpace) the played pass is scored where it is received
// (moment.end), and every other teammate where their own run takes them by the time a ball of the same pace arrives,
// so the played pass gets no head start. Otherwise every option is scored at the teammate's freeze-frame position.
export function receptionPoint(moment, p, passer) {
  if (!moment.intoSpace) return p.location;
  if (p.player === moment.receiver) return moment.end;
  const speed = dist(moment.start, moment.end) / (moment.flight || 1);
  const run = normalizeRun(moment.run && moment.run[p.player]);
  let spot = p.location;
  for (let i = 0; i < 4; i++) spot = positionAt(p.location, run, dist(passer.location, spot) / speed);
  return spot;
}

// ---- scoring one pass moment -------------------------------------------------

// Scores every teammate of the passer (goalkeeper and the passer excluded) as an option.
// Each option is scored at its `target`, from receptionPoint: the teammate's position at the pass, or for a ball
// into space where each one would receive it.
export function scoreOptions(moment) {
  const ff = moment.freeze_frame;
  const passer = ff.find(p => p.player === moment.passer);
  const opponents = ff.filter(p => !p.teammate);
  return ff
    .filter(p => p.teammate && !p.gk && p.player !== moment.passer)
    .map(p => {
      const played = p.player === moment.receiver;
      const target = receptionPoint(moment, p, passer);
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
// The facts the verdict sentence may use: the same JSON body the browser will POST to /api/verdict (Azure OpenAI,
// next step), so the model and this template see exactly the same numbers.
const VERDICT_IDS = { best: 'best_option', brave: 'brave_pass', line: 'line_breaker', timing: 'perfect_timing' };
const round = (v, n = 2) => +v.toFixed(n);
const facts = (o, label) => ({ label, arrives: round(o.arrives), goal: round(o.goal), value: round(o.ev, 3), cut_out: o.cutOut });

export function buildVerdictPayload(analysis) {
  const { options, played, verdict } = analysis;
  const others = options.filter(o => !o.played);
  const next = others.reduce((a, b) => (b.ev > a.ev ? b : a));
  const safe = others.reduce((a, b) => (b.arrives > a.arrives ? b : a));
  return {
    verdict: VERDICT_IDS[verdict.key],
    played: facts(played, `Pass to ${played.player}`),
    next_best: facts(next, `Pass to ${next.player}`),
    safe: facts(safe, `Safe pass to ${safe.player}`),
    value_ratio_vs_next_best: round(played.ev / next.ev),
  };
}

// plain-language comparisons, so the sentence needs at most one number
export function ratioWords(r) {
  if (r >= 5.5) return 'over five times';
  if (r >= 2.5) { const n = Math.round(r); return `${r < n - 0.05 ? 'nearly' : r > n + 0.05 ? 'over' : 'about'} ${['three', 'four', 'five'][n - 3]} times`; }
  if (r >= 1.8) return 'about twice';
  if (r >= 1.3) return 'half as much again as';
  return 'more than';
}
export function arriveWords(p) {
  if (p < 0.25) return 'a long shot to arrive';
  if (p < 0.45) return 'less than a coin flip to arrive';
  if (p < 0.6) return 'about a coin flip to arrive';
  return 'riskier than the safe ball';
}

// The template verdict sentence: one line, at most 20 words and one number, built only from the payload.
// It is the fallback when Azure OpenAI is unavailable (and, until that lands, the only source).
export function verdictSentence(payload) {
  const { verdict, played, value_ratio_vs_next_best: r } = payload;
  if (verdict === 'best_option') return `Best option on the pitch: ${ratioWords(r)} the value of the next best pass.`;
  if (verdict === 'brave_pass') return `The brave pass: ${arriveWords(played.arrives)}, for the biggest goal chance on the pitch.`;
  if (verdict === 'line_breaker') return `Line-breaker: one pass took ${played.cut_out} defenders out of the game, more than any other option.`;
  return 'Perfect timing: the pass found its player at exactly the right moment.';
}

// Easy read: two short plain sentences for screen readers and quick reading, with no percentages. `score` is
// { Home, Away } counted from the goals so far (computed, never typed). Same payload as the verdict sentence.
export function easyRead(payload, { team, passer, score }) {
  const why = {
    best_option: `${passer} picked the pass with the best mix of safety and danger.`,
    brave_pass: `${passer} tried the boldest pass, the one most likely to score.`,
    line_breaker: `${passer}'s pass went past more defenders than any other.`,
    perfect_timing: `${passer} passed at just the right moment.`,
  };
  return `Goal for ${team}. Home ${score.Home}, Away ${score.Away}. ${why[payload.verdict]}`;
}

// the scoreline after goal i (0-based), counted from the moments' teams: { Home, Away }
export function scoreAfter(moments, i) {
  const score = { Home: 0, Away: 0 };
  moments.slice(0, i + 1).forEach(m => { score[m.team]++; });
  return score;
}

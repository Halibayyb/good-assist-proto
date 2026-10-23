import './style.css';
import { analyseMoment, fmtPct, getVerdictSentence, dist } from './scoring.js';
import { MOMENTS } from './data.js';
import { LEAD_S, normalizeRun, positionAt, liftAt, poseAt, passPoint, easeOut, easeInOut, easeBall, easeDriven } from './motion.js';

// UI: draws the pitch in perspective from a moment, animates the goal, then reveals the decision.

const NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);

// Everything on screen is computed here, live, from the scoring functions.
const ANALYSES = MOMENTS.map(analyseMoment);

// Prove the numbers in the console.
ANALYSES.forEach(a => {
  console.log(`Goal ${a.moment.minute}' [${a.verdict.label}] ${a.moment.passer} -> ${a.moment.receiver}`);
  console.table(a.options.map(o => ({
    option: o.player + (o.played ? ' (played)' : ''),
    arrives: +(o.arrives * 100).toFixed(1), goal: +(o.goal * 100).toFixed(1),
    expectedValue: +(o.ev * 100).toFixed(2), cutOut: o.cutOut,
  })));
  console.log(getVerdictSentence(a));
});

// ---- small DOM helpers ------------------------------------------------------
function s(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  kids.flat().forEach(k => e.append(k));
  return e;
}
const shirt = name => (name.match(/\d+/) || [''])[0];

// ---- camera: pitch units (120 x 80) -> screen --------------------------------
// A simple perspective camera looking at the attacking end from the near touchline (y = 80).
// Only the pitch surface is projected; players and labels stay upright so text is never skewed.
const VIEW = { w: 1000, x0: 50, x1: 124, yTop: 84, yBot: 560, zFar: 1.4 };
const FIG = 0.76;                           // player size relative to the pitch (exaggerated so figures stay readable)
const PXU = VIEW.w / (VIEW.x1 - VIEW.x0);   // screen px per pitch unit at the near touchline

// returns [screenX, screenY, scale]; scale is 1 on the near touchline and shrinks with distance
function project(x, y) {
  const z = 1 + (1 - y / 80) * (VIEW.zFar - 1);
  const sc = 1 / z;
  const g = (sc - 1 / VIEW.zFar) / (1 - 1 / VIEW.zFar);
  return [VIEW.w / 2 + (x - (VIEW.x0 + VIEW.x1) / 2) * PXU * sc, VIEW.yTop + (VIEW.yBot - VIEW.yTop) * g, sc];
}
const pts = list => list.map(([x, y]) => project(x, y).slice(0, 2).map(n => n.toFixed(1)).join(',')).join(' ');
const arc = (cx, cy, r, a0, a1, n = 36) =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });

const INK = '#1f2430';

// Static scenery: mowing stripes, line markings, goal frame, stand behind the far touchline.
function drawTurf() {
  const g = $('turf'); g.textContent = '';
  for (let x = -10; x < 130; x += 10) {
    s('polygon', { points: pts([[x, 0], [x + 10, 0], [x + 10, 86], [x, 86]]), fill: (x / 10) % 2 ? '#f7f7f2' : '#eeeee6' }, g);
  }
  // defending half faded so the attacking end stands out
  s('polygon', { points: pts([[-10, 0], [60, 0], [60, 86], [-10, 86]]), fill: '#f4f4ef', 'fill-opacity': .55 }, g);

  const stand = project(60, 0)[1];
  s('rect', { x: 0, y: 0, width: VIEW.w, height: stand - 2, fill: '#d5d8de' }, g);
  s('rect', { x: 0, y: stand - 18, width: VIEW.w, height: 16, fill: '#c3c7cf' }, g);
  s('line', { x1: 0, y1: stand - 2, x2: VIEW.w, y2: stand - 2, stroke: INK, 'stroke-width': 1.6 }, g);

  const line = (list, close) => s(close ? 'polygon' : 'polyline', {
    points: pts(list), fill: 'none', stroke: '#3b4250', 'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-opacity': .85,
  }, g);
  line([[0, 0], [120, 0], [120, 80], [0, 80]], true);                 // outline
  line([[60, 0], [60, 80]]);                                          // halfway line
  line(arc(60, 40, 9.15, 0, Math.PI * 2, 48), true);                  // centre circle
  line([[120, 18], [102, 18], [102, 62], [120, 62]]);                 // penalty area
  line([[120, 30], [114, 30], [114, 50], [120, 50]]);                 // six-yard box
  const a = Math.acos(6 / 9.15);
  line(arc(108, 40, 9.15, Math.PI - a, Math.PI + a, 16));             // penalty arc
  const [sx, sy, sc] = project(108, 40);
  s('ellipse', { cx: sx, cy: sy, rx: 4 * sc, ry: 2 * sc, fill: 'none', stroke: INK, 'stroke-width': 1.4 }, g);

  // goal: front frame, back frame, joined at the top
  const up = (x, y, hu) => { const [px, py, p] = project(x, y); return [px, py - hu * PXU * p]; };
  const H = 2.8, D = 3;
  const front = [[120, 36, 0], [120, 36, H], [120, 44, H], [120, 44, 0]].map(p => up(...p));
  const back = [[120 + D, 36, 0], [120 + D, 36, H * .9], [120 + D, 44, H * .9], [120 + D, 44, 0]].map(p => up(...p));
  const poly = (list, w, c) => s('polyline', {
    points: list.map(p => p.map(n => n.toFixed(1)).join(',')).join(' '), fill: 'none', stroke: c, 'stroke-width': w, 'stroke-linejoin': 'round',
  }, g);
  poly(back, 1.2, '#8b92a0');
  [[1, 1], [2, 2], [0, 0], [3, 3]].forEach(([i, j]) => poly([front[i], back[j]], 1.2, '#8b92a0'));
  poly(front, 3, INK);
}

// ---- animation plumbing -----------------------------------------------------
let current = 0;
let runId = 0;                          // bumping this cancels any animation in flight
const wait = ms => new Promise(r => setTimeout(r, ms));
// calls onFrame(t, now) every animation frame with raw 0..1 progress; resolves when done or cancelled
function tween(ms, onFrame, stale) {
  return new Promise(resolve => {
    const t0 = performance.now();
    (function tick(now) {
      if (stale()) return resolve();
      const t = Math.min(1, (now - t0) / ms);
      onFrame(t, now);
      t < 1 ? requestAnimationFrame(tick) : resolve();
    })(t0);
  });
}
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// The ball sits just in front of the feet, so it is offset 1.1 units from the pitch position.
// `z` is its height in pitch units; a shadow stays on the grass so the arc reads in perspective.
const ZK = 2.4;                           // height exaggeration, matching the exaggerated figure size
function setBall(p, z = 0) {
  const [bx, by, sc] = project(p[0] + 1.1, p[1]);
  const lift = z * PXU * ZK * sc;
  $('ballDot').setAttribute('cx', bx); $('ballDot').setAttribute('cy', by - 5 * sc - lift);
  $('ballDot').setAttribute('r', 6.5 * sc);
  const sh = $('ballShadow');
  sh.setAttribute('cx', bx); sh.setAttribute('cy', by); sh.setAttribute('rx', 6 * sc); sh.setAttribute('ry', 2.2 * sc);
  return [bx, by - 5 * sc - lift];
}
let trailPts = [];
function trailAdd(p, z) { const [x, y] = setBall(p, z); trailPts.push(`${x.toFixed(1)},${y.toFixed(1)}`); $('trail').setAttribute('points', trailPts.join(' ')); }
function trailClear() { trailPts = []; $('trail').setAttribute('points', ''); }

// ---- players ---------------------------------------------------------------
const KITS = {
  atk:   { shirt: '#3d4760', shorts: '#2a3144', sock: '#3d4760' },
  def:   { shirt: '#ffffff', shorts: '#e9ebef', sock: '#ffffff' },
  ownGk: { shirt: '#7a869d', shorts: '#4f596e', sock: '#7a869d' },
  oppGk: { shirt: '#b4bac6', shorts: '#8a91a0', sock: '#b4bac6' },
};

const STRIDE = ['run', 'stand', 'run2', 'stand'];   // one stride = 4 poses
const STEP_MS = 90;

let figs = [];            // one record per player: { p, run, loc, node, use, pos, face, pose, seed }
let figOrder = [];
let lastNow = 0;

function drawPlayers(m) {
  const g = $('players'); g.textContent = ''; figs = []; figOrder = [];
  m.freeze_frame.forEach((p, i) => {
    const kit = KITS[p.teammate ? (p.gk ? 'ownGk' : 'atk') : (p.gk ? 'oppGk' : 'def')];
    const node = s('g', {}, g);
    s('ellipse', { cx: 0, cy: 0, rx: 24, ry: 7, fill: INK, 'fill-opacity': .1 }, node);
    const use = s('use', { href: '#fig-stand' }, node);
    use.style.cssText = `--kit:${kit.shirt};--short:${kit.shorts};--sock:${kit.sock}`;
    figs.push({
      p, loc: p.location, run: normalizeRun(m.run && m.run[p.player]), node, use, pos: p.location,
      face: p.teammate ? 1 : -1,           // attackers face the goal, defenders face them
      pose: 'stand', seed: (i * 53) % 360,
    });
  });
  placeFigs(atTau(0), 0, true);
}

// position of a player `tau` seconds after the pass (negative = before it); tau 0 is the scored freeze frame
const atTau = tau => { const fn = f => positionAt(f.loc, f.run, tau); fn.tau = tau; return fn; };

// Places every player for one frame. `frozen` holds the stride still (idle state and the freeze frame);
// otherwise the pose cycles and the player bobs while moving, and faces the way they move.
function placeFigs(posOf, now, frozen = false) {
  const dt = lastNow ? Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000)) : 0.016;
  lastNow = frozen ? 0 : now;
  figs.forEach(f => {
    const pos = posOf(f);
    const dx = pos[0] - f.pos[0], dy = pos[1] - f.pos[1];
    let moving, face = f.face, pose = 'stand', bob = 0;
    if (frozen) {
      moving = Math.hypot(f.run.v0[0], f.run.v0[1]) > 0.3;     // speed at the moment of the pass
      if (Math.abs(f.run.v0[0]) > 0.3) face = Math.sign(f.run.v0[0]);
      if (moving) pose = 'run';
    } else {
      moving = Math.hypot(dx, dy) / dt > 0.8;
      if (Math.abs(dx) > 0.01) face = Math.sign(dx);
      if (moving) {
        const k = now + f.seed;
        pose = STRIDE[Math.floor(k / STEP_MS) % STRIDE.length];
        bob = -2.2 * Math.abs(Math.sin(Math.PI * k / (2 * STEP_MS)));
      }
    }
    const air = liftAt(f.run, posOf.tau || 0);                      // jumping: lift the figure, keep its shadow on the grass
    if (air > 0.05) pose = 'head';
    const held = poseAt(f.run, posOf.tau || 0);                       // a keeper going down: crouch, then slide
    if (held) { pose = held; bob = 0; }
    f.pos = pos; f.face = face;
    const [sx, sy, sc] = project(pos[0], pos[1]);
    const k = sc * FIG;
    f.node.setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)}) scale(${(k * face).toFixed(3)} ${k.toFixed(3)})`);
    f.use.setAttribute('transform', `translate(0 ${(bob - air * PXU * ZK / FIG).toFixed(1)})`);
    if (pose !== f.pose) { f.use.setAttribute('href', `#fig-${pose}`); f.pose = pose; }
  });
  // far players first so nearer ones overlap them (only touch the DOM when the order changes)
  const order = [...figs].sort((a, b) => a.pos[1] - b.pos[1]);
  if (order.some((f, i) => f !== figOrder[i])) { order.forEach(f => $('players').appendChild(f.node)); figOrder = order; }
}

function reset() {
  const m = MOMENTS[current];
  runId++;
  drawPlayers(m);
  $('overlay').textContent = ''; $('groundRings').textContent = ''; labelSpots = [];
  $('result').textContent = '';
  $('goalFlash').classList.remove('show');
  hideTip();
  trailClear(); setBall(m.start);
  $('status').textContent = '';
  $('playBtn').disabled = false;
  $('playBtn').textContent = '▶ Play the moment';
  document.querySelectorAll('.goal-btn').forEach((b, i) => b.setAttribute('aria-pressed', i === current));
}

// ---- option rings: a glass sphere around the player and an ellipse on the grass ------------
const RING_R = 56, RING_Y = -46;       // sphere radius and centre height, in figure units
const RINGS = {
  passer: { fill: '#44516e', op: .28, w: 2.4 },
  opt:    { fill: '#8fa0c4', op: .32, w: 1.6 },
  played: { fill: '#5f78b0', op: .42, w: 3.2 },
};
const centre = pos => { const [sx, sy, sc] = project(pos[0], pos[1]); const k = sc * FIG; return { x: sx, y: sy + RING_Y * k, r: RING_R * k, foot: sy, sc: k }; };

function addRing(pos, kind, opt) {
  const c = centre(pos), st = RINGS[kind];
  s('ellipse', { cx: c.x, cy: c.foot, rx: 30 * c.sc, ry: 9 * c.sc, fill: st.fill, 'fill-opacity': .55, stroke: INK, 'stroke-width': 1.4, class: 'fade' }, $('groundRings'));
  const g = s('g', { class: 'ring-g fade' }, $('overlay'));
  s('circle', { cx: c.x, cy: c.y, r: c.r, fill: st.fill, 'fill-opacity': st.op, stroke: INK, 'stroke-width': st.w, class: 'ring-c' }, g);
  if (opt) {
    g.setAttribute('tabindex', 0); g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${opt.player}: show numbers`);
    const open = e => { e.stopPropagation(); showTip(g, opt); };
    g.addEventListener('click', open);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  }
  return g;
}

// shorten a segment at both ends so arrows stop at the spheres
function trim(a, b, startGap, endGap) {
  const d = dist(a, b), ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d;
  return [[a[0] + ux * startGap, a[1] + uy * startGap], [b[0] - ux * endGap, b[1] - uy * endGap]];
}

function addArrow(from, opt, played) {
  const c1 = centre(from), c2 = centre(opt.location);
  const [a, b] = trim([c1.x, c1.y], [c2.x, c2.y], c1.r + 2, c2.r + (played ? 8 : 5));
  const color = played ? INK : '#4b5563';
  const g = s('g', { class: 'fade' }, $('overlay'));
  s('line', {
    x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: color,
    'stroke-width': played ? 4.5 : 1.8, 'stroke-dasharray': played ? '' : '7 5',
    'marker-end': `url(#head-${played ? 'played' : 'opt'})`,
  }, g);
  // label above the sphere (below the feet for the played pass); nudged up if it would overlap one already placed
  const lx = c2.x;
  let ly = played ? c2.foot + 30 * c2.sc + 8 : c2.y - c2.r - 8;
  while (labelSpots.some(p => Math.abs(p.x - lx) < 100 && Math.abs(p.y - ly) < 20)) ly -= 20;
  labelSpots.push({ x: lx, y: ly });
  const t = s('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'lbl', fill: color }, g);
  t.textContent = `#${shirt(opt.player)} · ${fmtPct(opt.arrives)}`;
}
let labelSpots = [];

// The played pass drawn as it really goes: along the grass from the ball to the spot where it arrives, with a dashed mark
// there and a faint dotted line showing the receiver running onto it. The estimates still belong to the receiver's spot at the pass.
function addLandingArrow(from, opt, landing, bend = 0) {
  const [lx, ly, lsc] = project(landing[0], landing[1]);
  const k = lsc * FIG;
  const g = s('g', { class: 'fade' }, $('overlay'));
  const rf = centre(opt.location).foot, rx = centre(opt.location).x;
  s('line', { x1: rx, y1: rf, x2: lx, y2: ly, stroke: INK, 'stroke-width': 1.6, 'stroke-opacity': .55, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }, g);
  s('ellipse', { cx: lx, cy: ly, rx: 30 * k, ry: 9 * k, fill: INK, 'fill-opacity': .1, stroke: INK, 'stroke-width': 1.6, 'stroke-dasharray': '5 4' }, g);
  // follow the ball's real ground path (straight when bend = 0), leaving a gap at the ball and at the landing mark
  const pts = Array.from({ length: 41 }, (_, i) => passPoint(from, landing, bend, 0, i / 40).p)
    .map(([x, y]) => project(x + 1.1, y).slice(0, 2));
  const kept = pts.filter(p => dist(p, pts[0]) > 10 && dist(p, [lx, ly]) > 30 * k + 4);
  s('polyline', { points: kept.map(p => p.map(n => n.toFixed(1)).join(',')).join(' '), fill: 'none', stroke: INK, 'stroke-width': 4.5, 'stroke-linejoin': 'round', 'marker-end': 'url(#head-played)' }, g);
  let ty = ly + 9 * k + 22;
  while (labelSpots.some(p => Math.abs(p.x - lx) < 100 && Math.abs(p.y - ty) < 20)) ty += 20;
  labelSpots.push({ x: lx, y: ty });
  const t = s('text', { x: lx, y: ty, 'text-anchor': 'middle', class: 'lbl', fill: INK }, g);
  t.textContent = `#${shirt(opt.player)} · ${fmtPct(opt.arrives)}`;
}

// ---- tooltip ---------------------------------------------------------------
function showTip(ringG, opt) {
  const tip = $('tip'), wrap = tip.parentElement;
  const r = ringG.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  tip.textContent = '';
  tip.append(
    h('b', { textContent: opt.player + (opt.played ? ' (played)' : '') }),
    `Arrives: ${fmtPct(opt.arrives)} (est.)`, h('br'),
    `Goal: ${fmtPct(opt.goal)} (est.)`, h('br'),
    `Expected value: ${fmtPct(opt.ev)} (est.)`, h('br'),
    `Defenders cut out: ${opt.cutOut}`,
  );
  tip.style.display = 'block';
  tip.style.left = clampPx(r.left - w.left + r.width / 2, 120, w.width - 120) + 'px';
  tip.style.top = (r.top - w.top) + 'px';
}
const clampPx = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function hideTip() { $('tip').style.display = 'none'; }
document.addEventListener('click', hideTip);

// ---- result panel ----------------------------------------------------------
function showResult(a, shown) {
  const box = $('result'); box.textContent = '';
  const th = (label, est) => h('th', {}, label, est ? h('span', { className: 'tag', textContent: 'est.', title: 'estimated' }) : '');
  const rows = [...shown].sort((x, y) => y.ev - x.ev).map(o =>
    h('tr', { className: o.played ? 'played' : '' },
      h('td', { textContent: o.player + (o.played ? ' ★' : '') }),
      h('td', { textContent: fmtPct(o.arrives) }),
      h('td', { textContent: fmtPct(o.goal) }),
      h('td', { textContent: fmtPct(o.ev) }),
      h('td', { textContent: o.cutOut })));
  box.append(
    h('span', { className: 'badge', textContent: a.verdict.label }),
    h('p', { className: 'sentence', textContent: getVerdictSentence(a) }),
    h('p', { className: 'note', textContent: 'Auto-generated from the numbers · judged by the odds at the moment of the pass, not the result.' + (a.moment.aerial ? ' A cross goes over the players on the grass, so defenders in the lane are not counted.' : '') + (a.moment.showLanding ? (a.moment.scoreAtEnd ? ' The arrow shows where the ball arrives, and the played pass is scored at that reception point.' : ' The arrow shows where the ball arrives; the estimates are for the receiver\'s spot when the pass is played.') : '') }),
    h('div', { className: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, th('Option'), th('Arrives', true), th('Goal', true), th('Value', true), th('Cut out'))),
      h('tbody', {}, rows))),
    h('p', { className: 'caption', textContent: '★ = the pass that was played. Arrives, Goal and Value (arrives × goal) are estimated; Cut out is the number of defenders the pass goes past, counted from positions. Tap a sphere on the pitch for the same numbers.' }));
}

// ---- the main sequence -------------------------------------------------------
// Game time is in seconds around the pass: tau 0 = the freeze frame that gets scored.
const SHOT_S = 0.65, CELEBRATE_S = 0.4;

async function play() {
  const m = MOMENTS[current], a = ANALYSES[current];
  const id = ++runId, stale = () => id !== runId;
  const btn = $('playBtn');
  const flight = m.flight || 1.0;                          // seconds the pass is in the air
  const passer = figs.find(f => f.p.player === m.passer), receiver = figs.find(f => f.p.player === m.receiver);
  const lead = m.lead || LEAD_S;                           // seconds of play shown before the pass
  // Before the pass the ball travels with the passer, or, with a prelude, it is played in to him first:
  // it sits with the `from` player, is passed to the passer (arriving at `recv`), and his first touch takes it
  // to the strike spot by `touch`. Times are seconds before the pass (negative tau).
  const pre = m.prelude, giver = pre && figs.find(f => f.p.player === pre.from);
  const ballAt = tau => {
    if (!pre || tau >= pre.touch) return pre ? m.start : atTau(tau)(passer);
    if (tau < pre.pass) return atTau(tau)(giver);
    if (tau < pre.recv) return preBall(tau).p;
    return lerp(atTau(pre.recv)(passer), m.start, easeOut((tau - pre.recv) / (pre.touch - pre.recv)));
  };
  const preBall = tau => passPoint(atTau(pre.pass)(giver), atTau(pre.recv)(passer), pre.bend || 0, 0.1,
    easeDriven((tau - pre.pass) / (pre.recv - pre.pass)));
  const arrive = atTau(flight)(receiver);                  // the pass is aimed at where the receiver will be
  const carry = m.carry || 0;                              // seconds the receiver dribbles before shooting
  const shotFrom = atTau(flight + carry)(receiver);
  const shotS = m.shot.s || SHOT_S;                        // a header leaves quickly
  const tauEnd = flight + carry + shotS + CELEBRATE_S;

  $('overlay').textContent = ''; $('groundRings').textContent = ''; $('result').textContent = ''; hideTip();
  labelSpots = []; trailClear();
  $('goalFlash').classList.remove('show');
  btn.disabled = true; btn.textContent = '▶ Playing…';
  $('status').textContent = `Goal ${m.minute}' · ${m.passer} finds ${m.receiver}`;

  // 0. cue the tape back to just before the pass, then run up to it
  await tween(250 + 150 * lead, (t, now) => {
    const tau = -lead * easeInOut(t);
    placeFigs(atTau(tau), now); setBall(ballAt(tau));
  }, stale); if (stale()) return;
  await tween(lead * 1000, (t, now) => {
    const tau = -lead * (1 - t);
    placeFigs(atTau(tau), now);
    if (pre && tau >= pre.pass && tau < pre.recv) { const b = preBall(tau); trailAdd(b.p, b.z); }  // the ball played in
    else setBall(ballAt(tau));
  }, stale); if (stale()) return;
  trailClear();

  // 1. the pass (one smooth curve, with height), then the shot, then GOAL! (players keep running on the same clock)
  await tween(flight * 1000, (t, now) => {
    const b = passPoint(m.start, arrive, m.bend || 0, m.lift || 0, easeBall(t), m.startZ || 0, m.arriveZ || 0);
    placeFigs(atTau(t * flight), now); trailAdd(b.p, b.z);
  }, stale); if (stale()) return;
  if (carry) {                                             // dribble: the ball stays with the receiver
    await tween(carry * 1000, (t, now) => {
      const tau = flight + t * carry;
      placeFigs(atTau(tau), now); trailAdd(atTau(tau)(receiver), 0);
    }, stale); if (stale()) return;
  }
  await tween(shotS * 1000, (t, now) => {
    const b = passPoint(shotFrom, m.shot.to, 0, m.shot.lift ?? 0.3, easeOut(t), carry ? 0 : (m.arriveZ || 0), m.shot.z || 0);
    placeFigs(atTau(flight + carry + t * shotS), now); trailAdd(b.p, b.z);
  }, stale); if (stale()) return;
  $('goalFlash').classList.add('show');
  await tween(700, (t, now) => placeFigs(atTau(flight + carry + shotS + CELEBRATE_S * easeOut(t)), now), stale); if (stale()) return;
  $('goalFlash').classList.remove('show');

  // 2. rewind: everyone runs back along their own path to the moment of the pass, and freezes
  $('status').textContent = 'Rewinding to the moment of the pass…';
  trailClear();
  await tween(750, (t, now) => {
    const e = easeInOut(t);
    placeFigs(atTau(tauEnd * (1 - e)), now); setBall(lerp(m.shot.to, m.start, e));
  }, stale); if (stale()) return;
  placeFigs(atTau(0), 0, true); setBall(m.start);
  $('status').textContent = 'Frozen: what was behind the pass?';
  await wait(500); if (stale()) return;

  // 3. reveal step by step, 0.5 s apart
  const others = a.options.filter(o => !o.played).sort((x, y) => y.ev - x.ev);
  const top3 = m.ringed ? others.filter(o => m.ringed.includes(o.player)) : others.slice(0, m.shown ?? 3);
  const shown = [...top3, a.played];
  addRing(m.start, 'passer');                                              // the passer
  await wait(500); if (stale()) return;
  shown.forEach(o => addRing(o.location, o.played ? 'played' : 'opt', o)); // the options
  await wait(500); if (stale()) return;
  top3.forEach(o => addArrow(m.start, o, false));                          // dashed arrows + % labels
  await wait(500); if (stale()) return;
  if (m.showLanding) addLandingArrow(m.start, a.played, arrive, m.bend || 0);          // the pass played (to where the ball arrives)
  else addArrow(m.start, a.played, true);
  await wait(500); if (stale()) return;

  // 4. why it was smart
  showResult(a, shown);
  $('status').textContent = '';
  btn.disabled = false; btn.textContent = '↻ Replay';
}

// ---- wiring ----------------------------------------------------------------
MOMENTS.forEach((m, i) => {
  const b = h('button', { className: 'goal-btn', type: 'button' },
    h('b', { textContent: `Goal ${i + 1} – ${m.minute}'` }),
    h('span', { textContent: `${m.passer} → ${m.receiver}` }));
  b.addEventListener('click', () => { current = i; reset(); });
  $('picker').append(b);
});
$('playBtn').addEventListener('click', play);
drawTurf();
reset();

import './style.css';
import { analyseMoment, fmtPct, buildVerdictPayload, verdictSentence, easyRead, scoreAfter, dist } from './scoring.js';
import { MOMENTS, EVENTS } from './data.js';
import { createLive } from './live.js';
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
  console.log(verdictSentence(buildVerdictPayload(a)));
});

// The verdict sentence for a moment, cached so a replay never asks twice. Next step: POST buildVerdictPayload(a)
// to /api/verdict (Azure OpenAI) and use its { text, source }; today it is the template, labelled as such.
const sentences = new Map();
function getSentence(i) {
  if (!sentences.has(i)) sentences.set(i, Promise.resolve({ text: verdictSentence(buildVerdictPayload(ANALYSES[i])), source: 'template' }));
  return sentences.get(i);
}
const SOURCE_TAG = { 'azure-openai': 'Written by Azure OpenAI', template: 'Template sentence' };

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
// Moments are stored (and scored) as if the attacking team plays toward x = 120. On screen, Home attacks the right-hand
// goal and Away the left-hand one: for an Away moment the scene is mirrored end to end (x -> 120 - x) and the camera looks
// at the left end. Mirroring (not rotating) keeps the action on the near side, close to the camera. Every path is computed
// in stored coordinates first and mirrored after, so curls and runs mirror with it; the numbers never change.
const VIEW = { w: 1000, x0: 50, x1: 124, yTop: 84, yBot: 560, zFar: 1.4 };
const FIG = 0.76;                           // player size relative to the pitch (exaggerated so figures stay readable)
const PXU = VIEW.w / (VIEW.x1 - VIEW.x0);   // screen px per pitch unit at the near touchline
let flip = false;                           // true while showing an Away moment (set in reset)
const disp = ([x, y]) => (flip ? [120 - x, y] : [x, y]);   // stored coordinates -> real pitch coordinates

// real pitch coordinates -> [screenX, screenY, scale]; scale is 1 on the near touchline and shrinks with distance
function projectWorld(x, y) {
  const cx = flip ? 120 - (VIEW.x0 + VIEW.x1) / 2 : (VIEW.x0 + VIEW.x1) / 2;   // crops so the own keeper is off screen
  const z = 1 + (1 - y / 80) * (VIEW.zFar - 1);
  const sc = 1 / z;
  const g = (sc - 1 / VIEW.zFar) / (1 - 1 / VIEW.zFar);
  return [VIEW.w / 2 + (x - cx) * PXU * sc, VIEW.yTop + (VIEW.yBot - VIEW.yTop) * g, sc];
}
// stored (attacking toward x = 120) coordinates -> screen; everything except the scenery goes through this
const project = (x, y) => projectWorld(...disp([x, y]));
const pts = list => list.map(([x, y]) => projectWorld(x, y).slice(0, 2).map(n => n.toFixed(1)).join(',')).join(' ');
const arc = (cx, cy, r, a0, a1, n = 36) =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });

const INK = '#1f2430';

// Scenery in real pitch coordinates: mowing stripes, both ends' markings and goals, stand behind the far touchline.
// Redrawn per moment because the camera looks at the end being attacked.
function drawTurf() {
  const g = $('turf'); g.textContent = '';
  for (let x = -10; x < 130; x += 10) {
    s('polygon', { points: pts([[x, 0], [x + 10, 0], [x + 10, 86], [x, 86]]), fill: (x / 10) % 2 ? '#f7f7f2' : '#eeeee6' }, g);
  }
  // defending half faded so the attacking end stands out
  const [h0, h1] = flip ? [60, 130] : [-10, 60];
  s('polygon', { points: pts([[h0, 0], [h1, 0], [h1, 86], [h0, 86]]), fill: '#f4f4ef', 'fill-opacity': .55 }, g);

  const stand = projectWorld(60, 0)[1];
  s('rect', { x: 0, y: 0, width: VIEW.w, height: stand - 2, fill: '#d5d8de' }, g);
  s('rect', { x: 0, y: stand - 18, width: VIEW.w, height: 16, fill: '#c3c7cf' }, g);
  s('line', { x1: 0, y1: stand - 2, x2: VIEW.w, y2: stand - 2, stroke: INK, 'stroke-width': 1.6 }, g);

  const line = (list, close) => s(close ? 'polygon' : 'polyline', {
    points: pts(list), fill: 'none', stroke: '#3b4250', 'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-opacity': .85,
  }, g);
  const poly = (list, w, c) => s('polyline', {
    points: list.map(p => p.map(n => n.toFixed(1)).join(',')).join(' '), fill: 'none', stroke: c, 'stroke-width': w, 'stroke-linejoin': 'round',
  }, g);
  const up = (x, y, hu) => { const [px, py, p] = projectWorld(x, y); return [px, py - hu * PXU * p]; };
  line([[0, 0], [120, 0], [120, 80], [0, 80]], true);                 // outline
  line([[60, 0], [60, 80]]);                                          // halfway line
  line(arc(60, 40, 9.15, 0, Math.PI * 2, 48), true);                  // centre circle
  const a = Math.acos(6 / 9.15), H = 2.8, D = 3;
  [[120, -1], [0, 1]].forEach(([gx, d]) => {                          // both ends; d points into the pitch
    line([[gx, 18], [gx + 18 * d, 18], [gx + 18 * d, 62], [gx, 62]]); // penalty area
    line([[gx, 30], [gx + 6 * d, 30], [gx + 6 * d, 50], [gx, 50]]);   // six-yard box
    const a0 = d < 0 ? Math.PI : 0;
    line(arc(gx + 12 * d, 40, 9.15, a0 - a, a0 + a, 16));             // penalty arc
    const [sx, sy, sc] = projectWorld(gx + 12 * d, 40);
    s('ellipse', { cx: sx, cy: sy, rx: 4 * sc, ry: 2 * sc, fill: 'none', stroke: INK, 'stroke-width': 1.4 }, g);
    // goal: front frame, back frame, joined at the top
    const front = [[gx, 36, 0], [gx, 36, H], [gx, 44, H], [gx, 44, 0]].map(p => up(...p));
    const back = [[gx - D * d, 36, 0], [gx - D * d, 36, H * .9], [gx - D * d, 44, H * .9], [gx - D * d, 44, 0]].map(p => up(...p));
    poly(back, 1.2, '#8b92a0');
    [[1, 1], [2, 2], [0, 0], [3, 3]].forEach(([i, j]) => poly([front[i], back[j]], 1.2, '#8b92a0'));
    poly(front, 3, INK);
  });
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
  if (mapNodes) { const [mx, my] = disp([p[0] + 1.1, p[1]]); $('mapBall').setAttribute('cx', mx.toFixed(2)); $('mapBall').setAttribute('cy', my.toFixed(2)); }
  return [bx, by - 5 * sc - lift];
}
let trailPts = [], mapTrailPts = [];
function trailAdd(p, z) {
  const [x, y] = setBall(p, z); trailPts.push(`${x.toFixed(1)},${y.toFixed(1)}`); $('trail').setAttribute('points', trailPts.join(' '));
  if (mapNodes) { mapTrailPts.push(disp([p[0] + 1.1, p[1]]).map(n => n.toFixed(2)).join(',')); $('mapTrail').setAttribute('points', mapTrailPts.join(' ')); }
}
function trailClear() { trailPts = []; mapTrailPts = []; $('trail').setAttribute('points', ''); $('mapTrail').setAttribute('points', ''); }

// ---- players ---------------------------------------------------------------
// Kits belong to the teams (Home dark, Away white), so the attacking side's colours follow `moment.team`.
// `ink` is the colour for a shirt number printed on the shirt colour.
const KITS = {
  Home:   { shirt: '#3d4760', shorts: '#2a3144', sock: '#3d4760', ink: '#f4f4ef' },
  Away:   { shirt: '#ffffff', shorts: '#e9ebef', sock: '#ffffff', ink: INK },
  HomeGk: { shirt: '#7a869d', shorts: '#4f596e', sock: '#7a869d', ink: '#f4f4ef' },
  AwayGk: { shirt: '#b4bac6', shorts: '#8a91a0', sock: '#b4bac6', ink: INK },
};
const teamOf = (p, m) => (p.teammate ? m.team : m.team === 'Home' ? 'Away' : 'Home');
const kitOf = (p, m) => KITS[teamOf(p, m) + (p.gk ? 'Gk' : '')];

const STRIDE = ['run', 'stand', 'run2', 'stand'];   // one stride = 4 poses
const STEP_MS = 90;

let figs = [];            // one record per player: { p, run, loc, node, use, pos, face, pose, seed }
let figOrder = [];
let lastNow = 0;

function drawPlayers(m) {
  const g = $('players'); g.textContent = ''; figs = []; figOrder = [];
  m.freeze_frame.forEach((p, i) => {
    const kit = kitOf(p, m);
    const node = s('g', {}, g);
    s('ellipse', { cx: 0, cy: 0, rx: 24, ry: 7, fill: INK, 'fill-opacity': .1 }, node);
    const use = s('use', { href: '#fig-stand' }, node);
    use.style.cssText = `--kit:${kit.shirt};--short:${kit.shorts};--sock:${kit.sock}`;
    figs.push({
      p, loc: p.location, run: normalizeRun(m.run && m.run[p.player]), node, use, pos: p.location,
      face: (p.teammate ? 1 : -1) * (flip ? -1 : 1),   // attackers face the goal they attack, defenders face them
      pose: 'stand', seed: (i * 53) % 360,
    });
  });
  drawMap(m);
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
      if (Math.abs(f.run.v0[0]) > 0.3) face = Math.sign(f.run.v0[0]) * (flip ? -1 : 1);
      if (moving) pose = 'run';
    } else {
      moving = Math.hypot(dx, dy) / dt > 0.8;
      if (Math.abs(dx) > 0.01) face = Math.sign(dx) * (flip ? -1 : 1);
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
  if (mapNodes) figs.forEach(f => { const [mx, my] = disp(f.pos); mapNodes.get(f).setAttribute('transform', `translate(${mx.toFixed(2)} ${my.toFixed(2)})`); });
}

// ---- node map: the same scene from above, one node per player, moved by placeFigs on the same clock ----------
// Drawn in real pitch units (viewBox is the 120 x 80 pitch, stored positions go through `disp`). Shown in the analyst view.
const MAP_R = 2.2;
let mapNodes = null;                    // Map(fig record -> node <g>) for the current moment

function drawMapTurf() {
  const g = $('mapTurf');
  const st = { fill: 'none', stroke: '#3b4250', 'stroke-width': .3, 'stroke-opacity': .7 };
  for (let x = 0; x < 120; x += 10) s('rect', { x, y: 0, width: 10, height: 80, fill: (x / 10) % 2 ? '#f7f7f2' : '#eeeee6' }, g);
  s('rect', { x: 0, y: 0, width: 120, height: 80, ...st }, g);
  s('line', { x1: 60, y1: 0, x2: 60, y2: 80, ...st }, g);
  s('circle', { cx: 60, cy: 40, r: 9.15, ...st }, g);
  s('circle', { cx: 60, cy: 40, r: .4, fill: '#3b4250' }, g);
  [[0, 1], [120, -1]].forEach(([gx, d]) => {                       // both ends: penalty area, six-yard box, spot, arc, goal
    const a0 = d > 0 ? 0 : Math.PI, w = Math.acos(6 / 9.15);
    s('polyline', { points: `${gx},18 ${gx + 18 * d},18 ${gx + 18 * d},62 ${gx},62`, ...st }, g);
    s('polyline', { points: `${gx},30 ${gx + 6 * d},30 ${gx + 6 * d},50 ${gx},50`, ...st }, g);
    s('circle', { cx: gx + 12 * d, cy: 40, r: .4, fill: '#3b4250' }, g);
    s('polyline', { points: arc(gx + 12 * d, 40, 9.15, a0 - w, a0 + w, 16).map(p => p.join(',')).join(' '), ...st }, g);
    s('rect', { x: d > 0 ? gx - 1.6 : gx, y: 36, width: 1.6, height: 8, fill: 'none', stroke: INK, 'stroke-width': .5 }, g);
  });
}

function drawMap(m) {
  const g = $('mapNodes'); g.textContent = ''; $('mapLinks').textContent = ''; $('roster').textContent = '';
  mapNodes = new Map();
  figs.forEach(f => {
    const kit = kitOf(f.p, m);
    const key = f.p.player === m.passer || f.p.player === m.receiver;   // the two players in the pass get a heavier outline
    const n = s('g', {}, g);
    s('circle', { r: MAP_R, fill: kit.shirt, stroke: INK, 'stroke-width': key ? .6 : .25 }, n);
    const label = s('text', { y: .8, 'text-anchor': 'middle', class: 'map-num', fill: kit.ink }, n);
    label.textContent = shirt(f.p.player) || 'GK';
    mapNodes.set(f, n);
  });
  drawRoster(m);
}

// the list beside the map: both teams by position (keeper, back line, midfield, attack), shown by position name
// (falls back to the player's name without `positions`); hovering a row outlines its node
const POS_ORDER = ['GK', 'RB', 'CB', 'LB', 'DM', 'RM', 'CM', 'LM', 'AM', 'RW', 'LW', 'ST'];
function drawRoster(m) {
  const pos = f => (m.positions || {})[f.p.player];
  const rank = f => (POS_ORDER.indexOf(pos(f)) + 1 || 99) * 100 + (f.p.gk ? 0 : +shirt(f.p.player));
  const role = { [m.passer]: 'pass', [m.receiver]: 'goal' };
  ['Home', 'Away'].forEach(team => {
    const title = team + (team === m.team ? ' · attacking' : '');
    const items = figs.filter(f => teamOf(f.p, m) === team).sort((a, b) => rank(a) - rank(b)).map(f => {
      const kit = kitOf(f.p, m);
      const li = h('li', { tabIndex: 0, className: role[f.p.player] ? 'key' : '', title: f.p.player },
        h('span', { className: 'chip', textContent: shirt(f.p.player) || 'GK' }),
        pos(f) || f.p.player, role[f.p.player] ? h('span', { className: 'role', textContent: role[f.p.player] }) : '');
      li.querySelector('.chip').style.cssText = `background:${kit.shirt};color:${kit.ink}`;
      const ring = mapNodes.get(f).firstChild, w = ring.getAttribute('stroke-width');
      const on = () => { ring.setAttribute('stroke-width', .9); mapNodes.get(f).parentNode.appendChild(mapNodes.get(f)); };
      const off = () => ring.setAttribute('stroke-width', w);
      li.addEventListener('mouseenter', on); li.addEventListener('focus', on);
      li.addEventListener('mouseleave', off); li.addEventListener('blur', off);
      return li;
    });
    $('roster').append(h('div', {}, h('h3', { textContent: title }), h('ul', {}, items)));
  });
}

// the reveal on the map: dashed links to the ringed options, the played pass along its real path to where it arrives
function addMapLinks(m, others, played, landing) {
  const g = s('g', { class: 'fade' }, $('mapLinks'));
  const nodes = figs.map(f => { const [x, y] = disp(f.pos); return [x - MAP_R, y - MAP_R, x + MAP_R, y + MAP_R]; }), placed = [];
  const start = disp(m.start);
  const label = (x, y, text, dir, hgt = 3) => {                              // .map-lbl is 2.5 units; kept inside the map
    const w = text.length * 1.5 + 1, keep = v => clampPx(v, w / 2 - 2, 122 - w / 2);
    const [lx, ly] = placeLabel(keep(x), y, w, hgt, 3, dir, nodes, placed);
    return [keep(lx), ly];
  };
  others.forEach(o => {
    const at = disp(o.location), [a, b] = trim(start, at, MAP_R + .4, MAP_R + .8);
    s('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#4b5563', 'stroke-width': .3, 'stroke-dasharray': '1.2 .9', 'marker-end': 'url(#map-head-opt)' }, g);
    const text = `${letterOf.get(o)} ${fmtPct(o.arrives)}`, [tx, ty] = label(at[0], at[1] - MAP_R - 1, text, -1);
    s('text', { x: tx, y: ty, 'text-anchor': 'middle', class: 'map-lbl', fill: '#4b5563' }, g).textContent = text;
  });
  const endAt = m.showLanding ? landing : played.location, end = disp(endAt);
  const path = Array.from({ length: 41 }, (_, i) => disp(passPoint(m.start, endAt, m.showLanding ? m.bend || 0 : 0, 0, i / 40).p))
    .filter(p => dist(p, start) > MAP_R + .4 && dist(p, end) > 1.4);
  const points = path.map(p => p.map(n => n.toFixed(2)).join(',')).join(' ');
  if (m.aerial) {
    // a cross goes over the players: drawn as a hollow "in the air" line (dark edges, light core), not a pass along the grass
    s('polyline', { points, fill: 'none', stroke: INK, 'stroke-width': 1.1, 'stroke-linejoin': 'round', 'marker-end': 'url(#map-head-air)' }, g);
    s('polyline', { points, fill: 'none', stroke: '#f4f4ef', 'stroke-width': .45, 'stroke-linejoin': 'round' }, g);
  } else {
    s('polyline', { points, fill: 'none', stroke: INK, 'stroke-width': .7, 'stroke-linejoin': 'round', 'marker-end': 'url(#map-head)' }, g);
  }
  if (m.showLanding) s('circle', { cx: end[0], cy: end[1], r: 1.2, fill: 'none', stroke: INK, 'stroke-width': .3, 'stroke-dasharray': '.8 .6' }, g);
  const text = `${letterOf.get(played)} · #${shirt(played.player)} · ${fmtPct(played.arrives)}`;
  const [tx, ty] = label(end[0], end[1] + 4.2, text, 1, m.aerial ? 5.6 : 3);
  const t = s('text', { x: tx, y: m.aerial ? ty - 1.8 : ty, 'text-anchor': 'middle', class: 'map-lbl', fill: INK }, g);
  t.textContent = text;
  if (m.aerial) s('tspan', { x: tx, dy: 2.6, class: 'map-sub' }, t).textContent = 'cross';   // second line: it went through the air
}

function reset() {
  const m = MOMENTS[current];
  runId++;
  flip = m.team === 'Away';
  drawTurf();
  drawPlayers(m);
  $('overlay').textContent = ''; $('groundRings').textContent = ''; labelBoxes = []; ringBoxes = []; ringOf.clear(); letterOf.clear();
  $('result').textContent = '';
  $('goalFlash').classList.remove('show');
  hideTip(); stopSpeech();
  trailClear(); setBall(m.start);
  $('status').textContent = '';
  $('playBtn').disabled = false;
  $('playBtn').textContent = '▶ Play the moment';
  document.querySelectorAll('.tl-goal').forEach((b, i) => b.setAttribute('aria-pressed', i === current));
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
  ringBoxes.push([c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r]);
  if (opt) {
    g.setAttribute('tabindex', 0); g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${letterOf.get(opt) || ''} ${opt.player}: show numbers`.trim());
    const open = e => { e.stopPropagation(); showTip(g, opt); };
    g.addEventListener('click', open);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  }
  return g;
}

// ---- label placement: nudge a label up or down until its box clears players, spheres and other labels ----
// Boxes are [x0, y0, x1, y1] (an optional 5th entry weighs that obstacle). Tries the preferred spot, then steps in `dir` (-1 up, 1 down), then the other way,
// then the same heights shifted sideways, and keeps the first clear spot (or the least covered one).
// Overlap with another label weighs 3x. Returns [x, y] of the text anchor (middle, baseline).
const overlapArea = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
function placeLabel(x, y, w, hgt, step, dir, obstacles, placed) {
  const ks = [0, dir, -dir, 2 * dir];                     // at most two steps away, so a label stays next to its player
  const spots = [0, w * .55, -w * .55].flatMap(dx => ks.map(k => [x + dx, y + k * step]));
  let best = null;
  for (const [lx, ly] of spots) {
    const box = [lx - w / 2, ly - hgt * .78, lx + w / 2, ly + hgt * .22];
    const cost = obstacles.reduce((c, o) => c + overlapArea(box, o) * (o[4] ?? 1), 0) + 3 * placed.reduce((c, o) => c + overlapArea(box, o), 0);
    if (!best || cost < best.cost) best = { at: [lx, ly], box, cost };
    if (cost === 0) break;
  }
  placed.push(best.box);
  return best.at;
}
let labelBoxes = [], ringBoxes = [];
// every figure's screen box at its current (frozen) position; weighted low, since the label's halo keeps it readable over a
// figure, and a label drifting away from its own sphere is worse
const figBoxes = () => figs.map(f => { const [sx, sy, sc] = project(f.pos[0], f.pos[1]), k = sc * FIG; return [sx - 16 * k, sy - 92 * k, sx + 16 * k, sy + 4 * k, .25]; });
const LBL_CHAR = 10.2, LBL_H = 20;                     // .lbl is 17px monospace
const standBox = () => [-VIEW.w, -VIEW.w, 2 * VIEW.w, projectWorld(60, 0)[1]];   // keep labels off the stand behind the far touchline
const letterOf = new Map(), ringOf = new Map();        // option -> "A".."D" (ranked by expected value), option -> its sphere
const rankLetters = shown => { letterOf.clear(); [...shown].sort((x, y) => y.ev - x.ev).forEach((o, i) => letterOf.set(o, 'ABCDE'[i])); };
const pitchText = o => `${letterOf.get(o)} · #${shirt(o.player)} · ${fmtPct(o.arrives)}`;
const pitchLabel = (x, y, text, dir) => placeLabel(x, y, text.length * LBL_CHAR + 6, LBL_H, LBL_H, dir, [...figBoxes(), ...ringBoxes, standBox()], labelBoxes);

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
  // label above the sphere (below the feet for the played pass), nudged clear of players, spheres and other labels
  const text = pitchText(opt);
  const [tx, ty] = pitchLabel(c2.x, played ? c2.foot + 30 * c2.sc + 8 : c2.y - c2.r - 8, text, played ? 1 : -1);
  s('text', { x: tx, y: ty, 'text-anchor': 'middle', class: 'lbl', fill: color }, g).textContent = text;
}

// The played pass drawn as it really goes: from the ball to the spot where it arrives, with a dashed mark on the grass there
// and a faint dotted line showing the receiver running onto it. With `air` ({ lift, z0, z1 }, a cross) the arrow flies
// through the air on the ball's real height curve and ends at head height, with its shadow dashed on the grass.
// the screen path of the played pass: follows the ball's real path (straight when bend = 0), leaving a gap at the ball and at the landing mark
function landingPath(from, landing, bend = 0, air = null) {
  const [lx, ly, lsc] = project(landing[0], landing[1]);
  const k = lsc * FIG;
  const steps = Array.from({ length: 41 }, (_, i) => passPoint(from, landing, bend, air ? air.lift : 0, i / 40, air ? air.z0 : 0, air ? air.z1 : 0));
  const onGrass = steps.map(({ p: [x, y] }) => project(x + 1.1, y).slice(0, 2));
  let kept;
  if (air) {
    // heights scaled so the arrow's tip is at head height above the landing mark (where the ball meets the head)
    const head = 80 * k, zk = head / ((air.z1 || 1) * lsc);
    const inAir = steps.map(({ p: [x, y], z }) => { const [px, py, psc] = project(x + 1.1, y); return [px, py - z * zk * psc]; });
    kept = inAir.filter((p, i) => dist(p, inAir[0]) > 10 && dist(p, inAir[inAir.length - 1]) > 12);
  } else {
    kept = onGrass.filter(p => dist(p, onGrass[0]) > 10 && dist(p, [lx, ly]) > 30 * k + 4);
  }
  return { lx, ly, k, onGrass, kept };
}
// labels placed before the arrow is drawn (the other options') still keep clear of its path and of the landing mark
function reservePath({ lx, ly, k, kept }) {
  ringBoxes.push([lx - 30 * k, ly - 9 * k, lx + 30 * k, ly + 9 * k]);
  kept.forEach(([x, y]) => ringBoxes.push([x - 9, y - 9, x + 9, y + 9]));
}

function addLandingArrow(from, opt, landing, bend = 0, air = null) {
  const { lx, ly, k, onGrass, kept } = landingPath(from, landing, bend, air);
  const g = s('g', { class: 'fade' }, $('overlay'));
  const rf = centre(opt.location).foot, rx = centre(opt.location).x;
  s('line', { x1: rx, y1: rf, x2: lx, y2: ly, stroke: INK, 'stroke-width': 1.6, 'stroke-opacity': .55, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }, g);
  s('ellipse', { cx: lx, cy: ly, rx: 30 * k, ry: 9 * k, fill: INK, 'fill-opacity': .1, stroke: INK, 'stroke-width': 1.6, 'stroke-dasharray': '5 4' }, g);
  const line = list => list.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
  if (air) s('polyline', { points: line(onGrass), fill: 'none', stroke: INK, 'stroke-width': 1.4, 'stroke-opacity': .35, 'stroke-dasharray': '4 4' }, g);   // shadow
  s('polyline', { points: line(kept), fill: 'none', stroke: INK, 'stroke-width': 4.5, 'stroke-linejoin': 'round', 'marker-end': 'url(#head-played)' }, g);
  const text = pitchText(opt);
  const [tx, ty] = pitchLabel(lx, ly + 9 * k + 22, text, 1);
  s('text', { x: tx, y: ty, 'text-anchor': 'middle', class: 'lbl', fill: INK }, g).textContent = text;
}

// ---- tooltip ---------------------------------------------------------------
function showTip(ringG, opt) {
  const tip = $('tip'), wrap = tip.parentElement;
  const r = ringG.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  tip.textContent = '';
  tip.append(
    h('b', { textContent: `${letterOf.get(opt) ? letterOf.get(opt) + ' · ' : ''}${opt.player}${opt.played ? ' (played)' : ''}` }),
    `Arrives: ${fmtPct(opt.arrives)} (est.)`, h('br'),
    `Goal: ${fmtPct(opt.goal)} (est.)`, h('br'),
    `Expected value: ${fmtPct(opt.ev)} (est.)`, h('br'),
    `Defenders cut out: ${opt.cutOut}`,
  );
  tip.style.display = 'block';
  tip.style.left = clampPx(r.left - w.left + r.width / 2, 120, w.width - 120) + 'px';
  tip.style.top = (r.top - w.top) + 'px';
  wrap.scrollIntoView({ block: 'nearest' });              // from the table on a phone, bring the pitch into view
}
const clampPx = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function hideTip() { $('tip').style.display = 'none'; }
document.addEventListener('click', hideTip);

// ---- result panel ----------------------------------------------------------
// "vs next best": an option's expected value (arrives x goal) over the best of all the other options
const vsNextBest = (o, all) => o.ev / Math.max(...all.filter(x => x !== o).map(x => x.ev));
const fmtRatio = r => (r >= 10 ? Math.round(r) : r.toFixed(1)) + '×';

// Listen: the browser's own speech reads the verdict sentence (so it will read the Azure one too once that lands)
const canSpeak = 'speechSynthesis' in window;
const stopSpeech = () => { if (canSpeak) speechSynthesis.cancel(); };
function speak(text, btn) {
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.setAttribute('aria-pressed', false); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.onend = u.onerror = () => btn.setAttribute('aria-pressed', false);
  btn.setAttribute('aria-pressed', true);
  speechSynthesis.speak(u);
}

function showResult(a, shown, said) {
  const box = $('result'); box.textContent = '';
  const m = a.moment;
  const easy = easyRead(buildVerdictPayload(a), { team: m.team, passer: m.passer, score: scoreAfter(MOMENTS, MOMENTS.indexOf(m)) });
  const listen = canSpeak && h('button', { className: 'listen', type: 'button', textContent: '🔊 Listen', title: 'Read the verdict aloud' });
  if (listen) { listen.setAttribute('aria-pressed', false); listen.addEventListener('click', () => speak(`${m.minute} minutes. ${m.team} goal. ${said.text}`, listen)); }
  const pick = o => e => {                                 // a table row opens that option's numbers on its sphere
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); e.stopPropagation();
    if (ringOf.get(o)) showTip(ringOf.get(o), o);
  };
  const th = (label, est) => h('th', {}, label, est ? h('span', { className: 'tag', textContent: 'est.', title: 'estimated' }) : '');
  const rows = [...shown].sort((x, y) => y.ev - x.ev).map(o =>
    h('tr', { className: 'opt-row' + (o.played ? ' played' : ''), tabIndex: 0, title: 'Show this option on the pitch', onclick: pick(o), onkeydown: pick(o) },
      h('td', {}, h('span', { className: 'letter', textContent: letterOf.get(o) }), o.player),
      h('td', { textContent: fmtPct(o.arrives) }),
      h('td', { textContent: fmtPct(o.goal) }),
      h('td', { textContent: fmtRatio(vsNextBest(o, a.options)) + (o.played ? ' ★' : ''), title: `Expected value ${fmtPct(o.ev)} (est.)` }),
      h('td', { textContent: o.cutOut })));
  box.append(
    h('span', { className: 'badge', textContent: a.verdict.label }),
    h('p', { className: 'sentence', textContent: said.text }),
    h('p', { className: 'note' }, h('span', { className: 'tag src', textContent: SOURCE_TAG[said.source] }),
      ' Judged by the odds at the moment of the pass, not the result · estimated'),
    listen || '',
    h('div', { className: 'easy' }, h('h4', { textContent: 'Easy read' }), h('p', { textContent: easy })),
    h('div', { className: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, th('Option'), th('Arrives', true), th('Goal', true), th('vs next best', true), th('Cut out'))),
      h('tbody', {}, rows))),
    h('p', { className: 'caption', textContent: '★ = the pass played. "vs next best" compares its expected value with the best other option; Cut out = defenders the pass goes past. Letters rank the options by expected value. Tap a row or a sphere for all numbers.' }));
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
  const said = getSentence(current);                       // asked for when the goal happens, ready by the reveal

  $('overlay').textContent = ''; $('groundRings').textContent = ''; $('mapLinks').textContent = ''; $('result').textContent = ''; hideTip(); stopSpeech();
  labelBoxes = []; ringBoxes = []; ringOf.clear(); trailClear();
  $('goalFlash').classList.remove('show');
  btn.disabled = true; btn.textContent = '▶ Playing…';
  $('status').textContent = `${m.team} goal ${m.minute}' · ${m.passer} finds ${m.receiver}`;

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
  rankLetters(shown);
  addRing(m.start, 'passer');                                              // the passer
  await wait(500); if (stale()) return;
  shown.forEach(o => ringOf.set(o, addRing(o.location, o.played ? 'played' : 'opt', o))); // the options
  await wait(500); if (stale()) return;
  const air = m.aerial ? { lift: m.lift || 0, z0: m.startZ || 0, z1: m.arriveZ || 0 } : null;
  if (m.showLanding) reservePath(landingPath(m.start, arrive, m.bend || 0, air));   // the other labels keep off the played arrow
  top3.forEach(o => addArrow(m.start, o, false));                          // dashed arrows + % labels
  await wait(500); if (stale()) return;
  if (m.showLanding) addLandingArrow(m.start, a.played, arrive, m.bend || 0, air);     // the pass played (to where the ball arrives)
  else addArrow(m.start, a.played, true);
  if (mapNodes) addMapLinks(m, top3, a.played, arrive);
  await wait(500); if (stale()) return;

  // 4. why it was smart
  const verdictText = await said; if (stale()) return;
  showResult(a, shown, verdictText);
  $('status').textContent = '';
  btn.disabled = false; btn.textContent = '↻ Replay';
}

// ---- wiring ----------------------------------------------------------------
$('playBtn').addEventListener('click', () => { live.stop(); play(); });

// ---- live match mode (the default view) -----------------------------------------
// The clock pauses at each goal, plays the moment, holds the insight for reading, then runs on.
const READ_MS = 6000;
const goals = { Home: 0, Away: 0 };
const showScore = () => { $('score').textContent = `Home ${goals.Home} – ${goals.Away} Away`; };
const tickerAdd = (minute, text, goal) => {
  $('ticker').prepend(h('li', { className: goal ? 'goal' : '' }, h('b', { textContent: `${minute}'` }), ' ' + text));
  while ($('ticker').children.length > 6) $('ticker').lastChild.remove();
};
const LIVE_LABEL = { idle: '▶ Start live match', running: '❚❚ Pause', paused: '▶ Resume live match', goal: '❚❚ Pause', full: '↻ Restart match', reset: '▶ Start live match' };
const live = createLive({
  events: [...EVENTS, ...MOMENTS.map((m, i) => ({ minute: m.minute, text: `GOAL! ${m.team}: ${m.receiver}, assisted by ${m.passer}`, goal: i }))],
  onEvent: e => {
    if (e.goal != null) { goals[MOMENTS[e.goal].team]++; showScore(); }
    tickerAdd(e.minute, e.text, e.goal != null);
  },
  onTick: minute => {
    $('clock').textContent = `${Math.floor(minute)}'`;
    updateTimeline();
  },
  onGoal: async (i, stale) => {
    current = i; reset();
    await play(); if (stale()) return;
    $('status').textContent = 'Live match resumes in a moment…';
    await wait(READ_MS);
    if (!stale()) $('status').textContent = '';
  },
  onState: state => {
    $('liveBtn').textContent = LIVE_LABEL[state];
    if (state === 'reset') { goals.Home = goals.Away = 0; showScore(); $('ticker').textContent = ''; }
    updateTimeline();
  },
});
$('liveBtn').addEventListener('click', () => live.toggle());

// ---- match timeline: goals above (Home) and below (Away) the line, the playhead follows the live clock ------------
// Before kick-off and at full time every goal shows; while the match runs a goal appears only once the clock reaches it.
const revealed = i => !live.started || live.minute >= 90 || live.minute >= MOMENTS[i].minute;
const TL_TICKS = [[0, "0'"], [15, "15'"], [30, "30'"], [45, 'HT'], [60, "60'"], [75, "75'"], [90, "90'"]];
const TL_EVENTS = EVENTS.filter(e => /^(Home|Away|Both)/.test(e.text));
const atMin = min => `${(min / 90) * 100}%`;
const tl = { goals: [], events: [], segs: [] };

function jumpTo(i) { live.stop(); current = i; reset(); }
function step(dir) {                                       // previous / next among the goals shown so far
  const ok = MOMENTS.map((_, i) => i).filter(revealed);
  if (!ok.length) return;
  const at = ok.indexOf(current);
  jumpTo(ok[at < 0 ? 0 : (at + dir + ok.length) % ok.length]);
}

function drawTimeline() {
  const track = h('div', { className: 'tl-track' });
  tl.played = h('div', { className: 'tl-played' });
  tl.head = h('div', { className: 'tl-head' });
  const scrub = h('button', { className: 'tl-scrub', type: 'button', ariaLabel: 'Match timeline: click to jump to the nearest goal' });
  scrub.addEventListener('click', e => {
    const r = scrub.getBoundingClientRect(), min = ((e.clientX - r.left) / r.width) * 90;
    const ok = MOMENTS.map((_, i) => i).filter(revealed);
    if (ok.length) jumpTo(ok.reduce((b, i) => (Math.abs(MOMENTS[i].minute - min) < Math.abs(MOMENTS[b].minute - min) ? i : b)));
  });
  track.append(h('div', { className: 'tl-line' }), tl.played, tl.head, scrub);
  TL_TICKS.forEach(([min, text]) => track.append(h('span', { className: 'tl-tick', textContent: text, style: `left:${atMin(min)}` })));
  tl.events = TL_EVENTS.map(e => { const d = h('span', { className: 'tl-event', title: `${e.minute}' ${e.text}`, style: `left:${atMin(e.minute)}` }); track.append(d); return d; });
  tl.goals = MOMENTS.map((m, i) => {
    const b = h('button', { className: `tl-goal ${m.team.toLowerCase()}`, type: 'button', style: `left:${atMin(m.minute)}`,
      ariaLabel: `Goal ${i + 1}, ${m.minute} minutes, ${m.team}, ${m.passer} to ${m.receiver}` },
      h('span', { className: 'tl-dot' }), h('span', { className: 'tl-lab', textContent: `${m.minute}'` }));
    b.setAttribute('aria-pressed', i === current);
    b.addEventListener('click', () => jumpTo(i));
    track.append(b); return b;
  });
  // score strip: one segment per scoreline, from the moments' order and teams
  const strip = h('div', { className: 'tl-strip', ariaLabel: 'Score through the match' });
  const marks = [0, ...MOMENTS.map(m => m.minute), 90];
  tl.segs = marks.slice(0, -1).map((from, k) => {
    const sc = k ? scoreAfter(MOMENTS, k - 1) : { Home: 0, Away: 0 };
    const seg = h('span', { className: 'tl-seg', textContent: `${sc.Home}–${sc.Away}`, style: `left:${atMin(from)};width:${((marks[k + 1] - from) / 90) * 100}%` });
    strip.append(seg); return seg;
  });
  track.append(strip);
  $('timeline').textContent = '';
  $('timeline').append(track);
}

function updateTimeline() {
  const on = live.started, min = Math.min(90, live.minute);
  tl.played.style.width = on ? atMin(min) : '0';
  tl.head.style.display = on ? '' : 'none';
  tl.head.style.left = atMin(min);
  tl.goals.forEach((b, i) => { b.hidden = !revealed(i); });
  tl.events.forEach((d, i) => { d.hidden = on && live.minute < TL_EVENTS[i].minute; });
  tl.segs.forEach((seg, k) => { seg.classList.toggle('plain', k > 0 && !revealed(k - 1)); });
}
$('prevBtn').addEventListener('click', () => step(-1));
$('nextBtn').addEventListener('click', () => step(1));

// broadcast view (one pitch, like a real overlay) or analyst view (plus the node map and player list)
document.querySelectorAll('.view-toggle button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.view-toggle button').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('views').classList.toggle('analyst', b.dataset.view === 'analyst');
}));
drawMapTurf();
drawTimeline();
reset();
updateTimeline();

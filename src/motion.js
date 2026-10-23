// Motion model: pure functions, no DOM. Shared by the animation (main.js) and the checks (scripts/scores.js).
// Time `tau` is in seconds around the pass: tau = 0 is the freeze frame, the one frame that gets scored.

export const LEAD_S = 0.8;   // how long before the pass the scene starts

// A player's `run` entry in the data can be:
//   [vx, vy]                                  constant velocity (pitch units per second)
//   { v, v0, delay, ramp, then }              v  = velocity after the pass
//                                             v0 = velocity before it (default v)
//                                             delay = seconds after the pass before v kicks in (reaction time)
//                                             ramp = fraction of v0 speed at the start of the lead-in, rising to 1 at the pass
//                                             then = [t, v2, k]: from t seconds after the pass the velocity becomes v2 (a change of
//                                                    direction); with k it then slows smoothly (friction, time constant k seconds)
//                                             jump = { at, h, hang }: leaves the ground around `at` seconds, peaking h pitch units, airborne for `hang` s
//                                             slide = { at, crouch }: goes down (crouch pose for `crouch` s, default 0.12) and slides from `at` on
export function normalizeRun(raw) {
  if (!raw) return { v0: [0, 0], v: [0, 0], delay: 0, ramp: 1, then: null, jump: null, slide: null };
  if (Array.isArray(raw)) return { v0: raw, v: raw, delay: 0, ramp: 1, then: null, jump: null, slide: null };
  const v = raw.v || [0, 0];
  return { v0: raw.v0 || v, v, delay: raw.delay || 0, ramp: raw.ramp == null ? 1 : raw.ramp, then: raw.then || null, jump: raw.jump || null, slide: raw.slide || null };
}

// where a player stands `tau` seconds after the pass (negative = before it)
export function positionAt(loc, run, tau) {
  let dx, dy;
  if (tau <= 0) {
    // displacement before the pass: speed climbs linearly from ramp*|v0| (at -LEAD_S) to |v0| (at 0)
    const L = LEAD_S, t = Math.max(tau, -L), r = run.ramp;
    const p = -(r * -t + ((1 - r) / (2 * L)) * (L * L - (t + L) * (t + L))) + r * (tau - t); // before -L: constant speed
    dx = run.v0[0] * p; dy = run.v0[1] * p;
  } else {
    const t2 = run.then ? run.then[0] : Infinity, v2 = run.then ? run.then[1] : run.v;
    const a = Math.min(tau, run.delay);                         // reaction time: still on the old velocity
    const b = Math.max(0, Math.min(tau, t2) - run.delay);       // main run
    let c = Math.max(0, tau - t2);                              // after the change of direction
    const k = run.then && run.then[2];
    if (k) c = k * (1 - Math.exp(-c / k));                      // friction: the speed decays, the distance levels off
    dx = run.v0[0] * a + run.v[0] * b + v2[0] * c; dy = run.v0[1] * a + run.v[1] * b + v2[1] * c;
  }
  return [loc[0] + dx, loc[1] + dy];
}

// how high above the grass a player is `tau` seconds after the pass (a parabola over the jump's hang time)
export function liftAt(run, tau) {
  if (!run.jump) return 0;
  const d = (tau - run.jump.at) / (run.jump.hang / 2);
  return Math.abs(d) >= 1 ? 0 : run.jump.h * (1 - d * d);
}

// a held pose at `tau`, overriding the running stride: 'crouch' just before a slide, then 'slide'; null otherwise
export function poseAt(run, tau) {
  if (!run.slide) return null;
  if (tau >= run.slide.at) return 'slide';
  if (tau >= run.slide.at - (run.slide.crouch ?? 0.12)) return 'crouch';
  return null;
}

// ---- the ball -------------------------------------------------------------------

export const easeOut = t => 1 - (1 - t) * (1 - t);
export const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
// a struck ball is fastest off the foot and slows a little in flight
export const easeBall = t => 0.5 * t + 0.5 * easeOut(t);
// a driven pass keeps its pace: only a little faster off the foot (1.2x average speed) than at the end (0.8x)
export const easeDriven = t => 1.2 * t - 0.2 * t * t;

// Ball position at progress u (0..1) of a pass: one smooth quadratic curve on the ground plane, bulging
// `bend` pitch units to the right of the direction of travel (negative = left), plus a parabolic height
// that peaks at `lift` pitch units above the straight line between the start height `z0` and the end height `z1`
// (a cross leaves at foot height and arrives at head height). Never a straight line with a sideways offset added afterwards.
export function passPoint(start, end, bend, lift, u, z0 = 0, z1 = 0) {
  const dx = end[0] - start[0], dy = end[1] - start[1], len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;                       // unit normal, pointing to the right of travel
  const cx = (start[0] + end[0]) / 2 + nx * 2 * bend;        // a quadratic curve bulges half as far as its control point
  const cy = (start[1] + end[1]) / 2 + ny * 2 * bend;
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
  return { p: [a * start[0] + b * cx + c * end[0], a * start[1] + b * cy + c * end[1]], z: z0 * (1 - u) + z1 * u + lift * 4 * u * (1 - u) };
}

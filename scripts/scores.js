// Prints every option's numbers and the verdict for each moment, using the same modules as the page.
// Run: npm run scores
import { MOMENTS } from '../src/data.js';
import { analyseMoment, getVerdictSentence } from '../src/scoring.js';
import { normalizeRun, positionAt, passPoint, easeBall } from '../src/motion.js';

// Physical checks on the played pass: onside at release, and how close the curved ball comes to any
// opponent (at their moving position, while the ball is low enough to reach).
function checks(m) {
  const ff = m.freeze_frame, opp = ff.filter(p => !p.teammate);
  const run = name => normalizeRun(m.run && m.run[name]);
  const receiver = ff.find(p => p.player === m.receiver);
  const lastDefender = Math.max(...opp.filter(o => !o.gk).map(o => o.location[0]));   // keeper excluded
  const flight = m.flight || 1;
  const arrive = positionAt(receiver.location, run(m.receiver), flight);
  let clearance = Infinity, who = '';
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const ball = passPoint(m.start, arrive, m.bend || 0, m.lift || 0, easeBall(t), m.startZ || 0, m.arriveZ || 0);
    if (ball.z > 2.6) continue;                                       // out of reach overhead
    opp.forEach(o => {
      const q = positionAt(o.location, run(o.player), t * flight);
      const d = Math.hypot(q[0] - ball.p[0], q[1] - ball.p[1]);
      if (d < clearance) { clearance = d; who = o.player; }
    });
  }
  const dist = Math.hypot(arrive[0] - m.start[0], arrive[1] - m.start[1]);
  const nearest = Math.min(...opp.map(o => Math.hypot(o.location[0] - receiver.location[0], o.location[1] - receiver.location[1])));
  return {
    onside: receiver.location[0] <= lastDefender,
    marker: +nearest.toFixed(1),                                      // nearest opponent to the receiver at release
    clearance: +clearance.toFixed(2), closest: who,
    avgSpeed: +(dist / flight).toFixed(1),                            // pitch units per second
  };
}

const intended = ['line', 'best', 'best'];
MOMENTS.forEach((m, i) => {
  const a = analyseMoment(m);
  const ok = a.verdict.key === intended[i] ? 'OK' : '<<< MISMATCH';
  console.log(`\nGoal ${i + 1} (${m.minute}')  verdict=${a.verdict.key}  intended=${intended[i]}  ${ok}`);
  console.table(a.options.map(o => ({
    option: o.player + (o.played ? ' *' : ''),
    arrives: +(o.arrives * 100).toFixed(1), goal: +(o.goal * 100).toFixed(1),
    ev: +(o.ev * 100).toFixed(2), cutOut: o.cutOut,
  })));
  const others = a.options.filter(o => !o.played);
  const gap = k => a.played[k] - Math.max(...others.map(o => o[k]));
  console.log(`played minus best-other: ev=${(gap('ev') * 100).toFixed(2)}pp goal=${(gap('goal') * 100).toFixed(2)}pp cutOut=${gap('cutOut')}`);
  console.log(getVerdictSentence(a));
  const c = checks(m);
  console.log(`checks: onside=${c.onside}  nearest-defender=${c.marker}  ball-path clearance=${c.clearance} units (${c.closest})  avg ball speed=${c.avgSpeed} units/s`);
  if (a.verdict.key !== intended[i] || !c.onside || c.clearance < 1.5) process.exitCode = 1;
});

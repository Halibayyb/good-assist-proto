// Live match mode: a compressed match clock driving an event ticker. The quiet first 65 minutes fly by; the tense
// last 25 (where the goals are) run slower, so a whole match fits a demo of under two minutes.
// No DOM here: main.js renders through the callbacks. When the clock reaches a goal it stops, awaits onGoal
// (which plays the moment and shows the insight), then runs on.

const PACE = [{ until: 65, ms: 20000 / 65 }, { until: 90, ms: 1600 }];   // ms of real time per match minute
const msPerMinute = minute => PACE.find(p => minute < p.until)?.ms ?? PACE[PACE.length - 1].ms;
const TICK_MS = 100;

// events: [{ minute, text, goal? }] where `goal` is the moment index; callbacks:
//   onEvent(e), onTick(minute), onGoal(index, stale) -> Promise, onState('idle' | 'running' | 'paused' | 'goal' | 'full' | 'reset')
export function createLive({ events, onEvent, onTick, onGoal, onState }) {
  const list = [...events].sort((a, b) => a.minute - b.minute);
  let minute = 0, next = 0, running = false, started = false, busy = false, last = 0, token = 0, timer = null;

  function loop() {
    clearTimeout(timer);
    if (!running || busy) return;
    const now = performance.now();
    minute = Math.min(90, minute + (now - last) / msPerMinute(minute)); last = now;
    while (next < list.length && list[next].minute <= minute) {
      const e = list[next++];
      onEvent(e);
      if (e.goal != null) { minute = e.minute; onTick(minute); goal(e.goal); return; }
    }
    onTick(minute);
    if (minute >= 90) { running = false; onState('full'); return; }
    timer = setTimeout(loop, TICK_MS);
  }

  async function goal(i) {
    busy = true; onState('goal');
    const t = token;
    await onGoal(i, () => t !== token);
    if (t !== token) return;                  // stopped (a goal card was picked) while the insight was showing
    busy = false; last = performance.now();
    onState(running ? 'running' : 'paused');
    loop();
  }

  return {
    get running() { return running; },
    get minute() { return minute; },
    start() {
      if (minute >= 90) this.restart();
      running = started = true; last = performance.now();
      if (!busy) { onState('running'); loop(); }
    },
    pause() { running = false; clearTimeout(timer); if (!busy) onState(started ? 'paused' : 'idle'); },
    toggle() { running ? this.pause() : this.start(); },
    // leave the current goal insight to the user (a goal card or Replay was pressed); the clock stays where it is
    stop() { token++; busy = false; this.pause(); },
    restart() { token++; busy = false; started = false; minute = 0; next = 0; onState('reset'); onTick(0); },
  };
}

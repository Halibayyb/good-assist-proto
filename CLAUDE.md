# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hackathon prototype (Microsoft x Premier League, deadline 2026-10-27): after a goal, replay the killer pass, freeze it, score every option the passer had, and explain why the pass was smart. `decision-behind-the-assist-brief.md` is the product brief. Next steps in the brief: Azure OpenAI writes the verdict sentence, Azure Container Apps hosts a live feed + the scoring service.

Hard rules from the brief: synthetic data only (generic names like "Player 8" / "Defender 4", no real players, clubs, dates or logos), positive tone only, no hardcoded percentages (every number on screen is computed live), model numbers labelled "estimated".

## Commands

```
npm run dev       # Vite dev server
npm run build     # production build to dist/ (base './'; needs a server, module scripts don't load from file://)
npm run scores    # prints every option's numbers + verdict per moment, runs physical checks, exits non-zero on failure
```

There is no test runner or linter. `npm run scores` is the test: it asserts each moment gets its intended verdict (the `intended` array in `scripts/scores.js`: keep it in sync when you change a moment), that the receiver is onside at release, and that the ball path clears moving defenders (>= 1.5 units).

## Architecture

Three layers, deliberately separated so scoring can move to a backend:

- `src/scoring.js`: pure functions, no DOM. `analyseMoment(moment)` -> `{ options, played, verdict }`; `getVerdictSentence` is a template that will be replaced by an Azure OpenAI call taking the same object.
- `src/motion.js`: pure motion model shared by the animation and `scripts/scores.js`: player paths (`positionAt`), jumps (`liftAt`), ball path (`passPoint`), easings.
- `src/data.js` + `src/main.js`: the `MOMENTS` array and the UI. `index.html` holds the SVG shell (marker defs, player pose `<symbol>`s, layer `<g>`s); `main.js` fills the layers.

### The core idea: `freeze_frame` is the only scored frame

Scoring reads only `moment.freeze_frame` (all 22 players on a 120 x 80 pitch, attacking toward x = 120, goal at y 36..44). Time `tau` is seconds around the pass; `tau = 0` is the freeze frame. Player motion is `location + run * tau` (see the `run` forms documented at the top of `motion.js`), so the animation never changes the numbers. The animation rewinds every player back to `tau = 0` before the rings/arrows are drawn on the scored positions.

### Scoring model (spec given by the user, do not change casually)

Arrives = `0.98 - 0.012*dist - 0.25*lane defenders - 0.15*(nearest defender < 3)`, clamped 0.05..0.98. Goal = logistic xG minus 0.03 per opponent in the receiver-post-post triangle, clamped 0.01..0.6. EV = arrives x goal. Cut out = outfield opponents with `passer.x < x < target.x`. Each option's `target` is the teammate's freeze-frame position, except that `scoreAtEnd: true` scores the played pass at `moment.end` (its reception point, for through balls into space). Only Goal 2 uses it; making it global would need Goals 1 and 3 re-tuned. Verdict priority: best EV -> highest goal chance -> most cut out -> "Perfect timing"; **ties go to the played pass**. The opposing goalkeeper counts as a lane defender, a nearest-defender, and a triangle blocker, but not as "cut out". A moment with `aerial: true` (crosses) ignores lane defenders.

### Tuning a moment

Verdicts must come from the numbers, never forced. To get a moment to its intended verdict, move positions in `src/data.js` and re-run `npm run scores`. Known traps:
- xG decays steeply with distance and floors at 0.01, so scenes far from goal tie at the floor and the tie goes to the played pass ("brave pass"). Keep options within roughly 30 units of goal for goal chances to differ.
- A keeper or defender standing in an option's shooting triangle costs 0.03 and can pin it to the floor.
- Check margins in `played minus best-other`: margins of a few hundredths of a point are fragile.
- `intended` verdicts today: Goal 1 line-breaker, Goals 2 and 3 best option.

### Per-moment optional fields (`data.js` header comment has the full list)

`run` (velocities; objects can add `v0`, `delay`, `ramp`, `then` (with an optional friction time constant), `jump`, `slide`), `flight`, `bend`/`lift`/`startZ`/`arriveZ` (curved, lofted ball), `carry` (dribble seconds before the shot), `shot`, `aerial`, `shown` (how many other options to ring, default 3) or `ringed` (their names), `showLanding` (draw the played arrow to where the ball arrives instead of at the receiver), `scoreAtEnd` (see scoring model).

### Rendering

A perspective camera projects pitch coordinates (`project()` in `main.js`; crops to x >= 50 so the own goalkeeper is off screen). Only the pitch surface is projected; players are upright SVG `<use>` figures scaled by `FIG` and depth. `placeFigs` is the single per-frame entry point (positions, stride poses, jump lift, draw order); `play()` is one async timeline (cue back, lead-in, pass, carry, shot, GOAL, rewind, step-by-step reveal) cancelled by bumping `runId`.

## Testing the browser UI headlessly (gotchas)

Headless Chrome with `--virtual-time-budget` does not advance `requestAnimationFrame` or CSS animations/transitions. In a scratch copy, stub `requestAnimationFrame` with `setTimeout(f(performance.now()), 16)`, disable `.fade` animation if you need to see rings/arrows, and use a fresh `--user-data-dir` per run (a reused profile hung runs). Keep scratch harnesses out of the repo.

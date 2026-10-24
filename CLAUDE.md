# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hackathon prototype (Microsoft x Premier League, deadline 2026-10-27): after a goal, replay the killer pass, freeze it, score every option the passer had, and explain why the pass was smart. `decision-behind-the-assist-brief.md` is the product brief; `README.md` is written for the judges.

Hard rules from the brief: synthetic data only (generic names like "Player 8" / "Defender 4", no real players, clubs, dates or logos), positive tone only, no hardcoded percentages (every number on screen is computed live), model numbers labelled "estimated". Be honest about what is wired up: the README and the panel's source tag must not claim Azure OpenAI until it really answers.

Deferred next step (not started, on the user's instruction): Azure OpenAI writes the verdict sentence via `POST /api/verdict` on Azure Static Web Apps + a managed Azure Functions API. The page stays at the repo root and `api/` goes next to it (SWA `app_location: '/'`, `output_location: 'dist'`, `api_location: 'api'`). The key lives only in env vars (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`). The function rejects replies over 25 words or with numbers not in the payload, falls back to the template after a 3 s timeout, and returns `source: "azure-openai" | "template"`.

## Commands

```
npm run dev       # Vite dev server
npm run build     # production build to dist/ (base './'; needs a server, module scripts don't load from file://)
npm run scores    # prints every option's numbers + verdict per moment, runs physical checks, exits non-zero on failure
npm run calibrate # dev only: baseXg vs 8 reference shots (StatsBomb Open Data; real numbers live ONLY in scripts/calibrate.js)
```

There is no test runner or linter. `npm run scores` is the test: it asserts each moment gets its intended verdict (the `intended` array in `scripts/scores.js`: keep it in sync when you change a moment), that the receiver is onside at release, that the ball path clears moving defenders (>= 1.5 units), and that the template sentence is <= 20 words with <= 1 number.

## Architecture

Pure, DOM-free modules (so scoring can move to a backend) plus one UI module:

- `src/scoring.js`: pure functions, no DOM. `analyseMoment(moment)` -> `{ options, played, verdict }`. `buildVerdictPayload(analysis)` is the JSON body for the planned `POST /api/verdict` (Azure OpenAI, deferred; README lists it as planned), and `verdictSentence(payload)` is the template built from that same payload (fallback, and today the only source). `getSentence` in `main.js` is the single seam (cached per goal) where the API call plugs in. The panel shows the source tag honestly.
- The match story: Home 2-1 Away (Home attacks right, Away left). Goal 1 71' Home (line-breaker), Goal 2 82' Away (the header, brave pass), Goal 3 87' Home winner (best option). `moment.team` is the attacking team (`teammate: true` in its freeze_frame); kits belong to teams (`KITS`/`kitOf` in `main.js`: Home dark, Away white), so the attacking side's colours flip for the Away goal. Every replay still attacks toward x = 120, and in each scene the attackers are named "Player N" and the defenders "Defender N", whichever team they are.
- `src/live.js`: live match clock (`PACE`: 0'-65' in ~20 s, then 1.6 s per minute; a full match with three insights takes ~100 s) and event ticker, no DOM; `main.js` renders via callbacks. At each goal it awaits `onGoal` (selects the moment, `await play()`, holds `READ_MS`), then resumes. Goal cards and Replay call `live.stop()`. Ticker events: `EVENTS` in `data.js`; goals come from `MOMENTS[i].minute`.
- `src/motion.js`: pure motion model shared by the animation and `scripts/scores.js`: player paths (`positionAt`), jumps (`liftAt`), ball path (`passPoint`), easings.
- `src/data.js` + `src/main.js`: the `MOMENTS` array and the UI. `index.html` holds the SVG shell (marker defs, player pose `<symbol>`s, layer `<g>`s); `main.js` fills the layers.

### The core idea: `freeze_frame` is the only scored frame

Scoring reads only `moment.freeze_frame` (all 22 players on a 120 x 80 pitch, attacking toward x = 120, goal at y 36..44). Time `tau` is seconds around the pass; `tau = 0` is the freeze frame. Player motion is `location + run * tau` (see the `run` forms documented at the top of `motion.js`), so the animation never changes the numbers. The animation rewinds every player back to `tau = 0` before the rings/arrows are drawn on the scored positions.

### Scoring model (spec given by the user, do not change casually)

Arrives = `0.98 - 0.012*dist - 0.25*lane defenders - 0.15*(nearest defender < 3)`, clamped 0.05..0.98. Goal = `baseXg` (logistic on angle and distance, coefficients in `XG`, tuned with `npm run calibrate`) x 0.75 per **outfield** opponent in the receiver-post-post triangle, or x `XG.keeperOnly` (1.8) when there are none, clamped 0.01..0.7. EV = arrives x goal. Cut out = outfield opponents with `passer.x < x < target.x`. Each option's `target` is the teammate's freeze-frame position, except that `scoreAtEnd: true` scores the played pass at `moment.end` (its reception point, for through balls into space). Only Goal 3 uses it; making it global would need Goals 1 and 2 re-tuned. Verdict priority: best EV -> highest goal chance -> most cut out -> "Perfect timing"; **ties go to the played pass**. The opposing goalkeeper counts as a lane defender and a nearest-defender, but not as a triangle blocker (the base xG already assumes a keeper) and not as "cut out". A moment with `aerial: true` (crosses) ignores lane defenders.

### Tuning a moment

Verdicts must come from the numbers, never forced. To get a moment to its intended verdict, move positions in `src/data.js` and re-run `npm run scores`. Known traps:
- xG decays steeply with distance and floors at 0.01, so scenes far from goal tie at the floor and the tie goes to the played pass ("brave pass"). Keep options within roughly 30 units of goal for goal chances to differ.
- An outfield defender in an option's shooting triangle costs x0.75 and also removes the x1.8 keeper-only boost, so one blocker cuts the goal chance to ~40%. This is the main lever: Goal 3's Defender 5 and Goal 2's Defender 3 stand in the triangles of Player 9 and Player 10.
- Check margins in `played minus best-other`: margins of a few hundredths of a point are fragile.
- `intended` verdicts today: Goal 1 line-breaker, Goal 2 brave pass, Goal 3 best option (all three must stay different). Goal 3's played pass should stay near arrives 40-50%, goal 35-42%, value 16-18%.

### Per-moment optional fields (`data.js` header comment has the full list)

`run` (velocities; objects can add `v0`, `delay`, `ramp`, `then` (with an optional friction time constant), `jump`, `slide`), `flight`, `bend`/`lift`/`startZ`/`arriveZ` (curved, lofted ball), `carry` (dribble seconds before the shot), `shot`, `aerial`, `shown` (how many other options to ring, default 3) or `ringed` (their names), `showLanding` (draw the played arrow to where the ball arrives instead of at the receiver), `scoreAtEnd` (see scoring model), `positions` (name -> 'ST' etc. for the analyst view's player list).

### Rendering

A perspective camera projects pitch coordinates (`project()` in `main.js`; crops to the attacking end so the own goalkeeper is off screen). Data is always stored attacking toward x = 120; for an Away moment (`flip`) the display is mirrored end to end (`disp`: x -> 120 - x) so Away attacks the left-hand goal, as in a real match, with the action still on the near side. Draw anything from stored coordinates through `project` / `disp`; only the scenery (`drawTurf`, redrawn per moment, both ends) uses `projectWorld`. Facing signs flip with it. Scoring never sees the flip. Only the pitch surface is projected; players are upright SVG `<use>` figures scaled by `FIG` and depth. `placeFigs` is the single per-frame entry point (positions, stride poses, jump lift, draw order); `play()` is one async timeline (cue back, lead-in, pass, carry, shot, GOAL, rewind, step-by-step reveal) cancelled by bumping `runId`. `placeFigs` also moves the node map (top-down, in pitch units, shown in the Analyst view via `.views.analyst`). Ring labels go through `placeLabel` (weighted box check against figures (light), spheres, the stand and placed labels; at most two steps up/down, then sideways, so a label stays by its sphere). With `aerial` + `showLanding` (Goal 2's cross) the played arrow flies through the air (tip at head height above the landing mark, shadow dashed on the grass), and in the node map it is a hollow double line labelled "cross", so it never looks like a ground pass.

## Testing the browser UI headlessly (gotchas)

Headless Chrome with `--virtual-time-budget` does not advance `requestAnimationFrame` or CSS animations/transitions. In a scratch copy, stub `requestAnimationFrame` with `setTimeout(f(performance.now()), 16)`, disable `.fade` animation if you need to see rings/arrows, and use a fresh `--user-data-dir` per run (a reused profile hung runs). Keep scratch harnesses out of the repo. Headless Chrome won't lay out narrower than ~500px, so test phone width by loading the page in a 375px `<iframe>`. Live mode needs a virtual-time budget of ~120 s to reach full time.

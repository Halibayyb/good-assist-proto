# The Decision Behind the Assist

> Every broadcast shows the goal. We show the decision that made it possible.

A hackathon prototype for **Inside the Game: Developer Hackathon (Microsoft × Premier League)**.
Deadline: **October 27, 2026**.

---

## What we're building

When a goal is scored in a live stream, our app finds the **killer pass** behind it.
It freezes the moment of the pass, works out **every option the passer had**, and shows
fans in plain language **why this pass was the smart choice**.

- **User:** fans watching a live stream in real time
- **When it appears:** right after the goal, during the celebration and replay (about 30–60 seconds)
- **Tone:** positive only. We celebrate great decisions and never criticize players.

---

## The flow

```
Goal scored
  → Find the killer pass behind it
  → Freeze all 22 player positions at that pass
  → [KEY] Calculate each option's odds
  → [KEY] Compare the options in %
  → Azure OpenAI explains why this was the smart choice
  → Show it on the live stream
```

---

## The key part: how we score each option

At the moment of the pass, **every teammate is an option**. For each one, we calculate:

| # | Number | What it means | How we get it |
|---|---|---|---|
| 1 | **Chance it arrives** | Will the pass reach the teammate? | Model: pass distance, defenders near the passing lane, defender near the receiver |
| 2 | **Chance of a goal** | If it arrives, how dangerous is it? | xG model: distance and angle to goal, defenders in the way |
| 3 | **Expected value** | Risk and reward combined | 1 × 2 |
| 4 | **Defenders cut out** | How many opponents the pass goes past | Simple geometry (a fact, not an estimate) |

**We judge the decision by the odds at the moment of the pass, not by the result.**

Show everything to fans as **percentages**, not xG. "15% chance of a goal" is clear to anyone.
Label model numbers as **estimated** on screen.

---

## Example

| Option | Chance it arrives | Chance of a goal | Expected value | Defenders cut out |
|---|---|---|---|---|
| Safe pass | 95% | 5% | 4.75% | 0 |
| Forward pass | 70% | 15% | 10.5% | 2 |
| **Killer through ball (played)** | **25%** | **30%** | **7.5%** | **4** |

Here the forward pass has the highest expected value, so the app does **not** say "best option."
It says something like:

> "The brave pass: a 1-in-4 gamble for double the reward, and it paid off."

---

## The visual: "option rings" on a mini pitch

A simple, clean frozen frame in the style of tracking-data graphics: rings around players,
arrows between them, short labels. Nothing more.

**What's on it**
- **Mini pitch:** attacking half emphasised, thin line markings, light flat background
- **Passer:** a ring around the player with the ball
- **Options:** a ring around each teammate the app scored (show the top 3–4, not all 10)
- **Arrows:** a thin dashed arrow from the passer to each option; the **pass played** is a thick, highlighted arrow
- **Labels on arrows:** the **% chance it arrives** instead of distances
- **Defenders:** plain grey dots, no rings, so the options stand out
- **Verdict bar:** the one-sentence Azure OpenAI line under the pitch, plus an "estimated" tag

**Interaction (optional, cheap):** tap a ring to see that option's 4 numbers.

**How we build it:** one SVG drawn in the browser from the `freeze_frame` (x, y on the 120 × 80
pitch map straight to SVG coordinates). Optional broadcast look: tilt the flat SVG with CSS
(`transform: perspective(900px) rotateX(35deg)`). No club colours or logos: neutral team colours only.

---

## The pass ladder (for viewers)

| Type | What it is | Typical chance it arrives | Typical chance of a goal |
|---|---|---|---|
| 1. Safe pass | Sideways or backwards | 90–95% | very low |
| 2. Forward pass | Moves the team up the pitch | 70–80% | low |
| 3. Line-breaker | Goes through a line of defenders | 50–65% | medium |
| 4. Killer pass | Straight into a scoring chance | 20–40% | high |

---

## Verdicts (always honest, always positive)

The numbers decide the verdict, not us.

| Verdict | When |
|---|---|
| **Best option on the pitch** | The played pass has the highest expected value |
| **The brave pass** | Lower chance of arriving, but the highest chance of a goal |
| **Line-breaker** | Cut out the most defenders |

Every sentence the AI writes must come only from these numbers.

---

## Data

- **The app runs on synthetic match data** (a hackathon rule).
- At every pass, the data includes **all 22 player positions** on a 120 × 80 pitch
  (x = 0 to 120 toward the goal being attacked, y = 0 to 80 across the width).
- The demo match should include goals with **different verdicts**.
- The models can learn from real passes and shots in
  [StatsBomb Open Data](https://github.com/statsbomb/open-data). Credit StatsBomb and follow their terms.

Example pass event:

```json
{
  "minute": 67,
  "team": "Home",
  "passer": "Player 8",
  "receiver": "Player 9",
  "start": [78.0, 40.0],
  "end": [104.0, 36.0],
  "outcome": "Complete",
  "goal_assist": true,
  "freeze_frame": [
    { "player": "Player 9", "teammate": true, "location": [102.5, 35.0] },
    { "player": "Defender 4", "teammate": false, "location": [98.0, 38.5] }
  ]
}
```

(The real `freeze_frame` lists all 22 players.)

---

## Prototype scope

**In:** synthetic match generator with positions at every pass; option scoring (the 4 numbers);
the "option rings" mini pitch; a one-sentence verdict from Azure OpenAI; the match replayed as a
"live" feed.

**Out (phase 2):** dribbling and off-ball movement; failed passes and missed chances; where the
player looked (scanning).

---

## Tech (Microsoft / Azure)

- **Azure OpenAI** (Azure AI Foundry): writes the one-sentence verdict
- **Azure Container Apps**: hosts the live event feed and the scoring service
- **Web app**: shows the live overlay in the browser
- **Public GitHub repo** (required)

---

## Hackathon rules to remember

- It must really work. No faked features.
- Use synthetic data. No Premier League or club logos.
- Demo video under 2 minutes, showing the app running, with no copyrighted music.

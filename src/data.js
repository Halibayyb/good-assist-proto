// 3 hardcoded synthetic goal moments, same shape as the brief's pass event: the match ends Home 2 - 1 Away.
// `team` ('Home' | 'Away') is the attacking team, the one in each freeze_frame with teammate: true; every replay attacks toward x = 120.
// A live feed (next step) only has to deliver objects like these.
// `start` is the passer's spot, `end` is the receiver's spot at the moment of the pass.
// `run` is optional motion: each player's velocity in pitch units per second. Position at time t
// (seconds, 0 = the pass) is location + run * t, so the freeze_frame stays the one frame that gets scored.
// The animation aims the ball at where the receiver will be when it arrives.
// Optional pass fields: flight (s), bend and lift (pitch units, see motion.js passPoint), startZ / arriveZ (ball height
// at the foot and at the receiver), aerial (a cross: lane defenders are ignored when scoring), carry (s of dribbling).
// shown (number of other options ringed on the reveal, default 3) or ringed (their names), showLanding (draw the played pass to the
// spot where the ball arrives), scoreAtEnd (score the played pass at `end`, its reception point, instead of the receiver's position),
// positions ({ name: 'ST', ... } for the analyst view's player list), lead (seconds shown before the pass) and prelude ({ from, pass, recv, touch, bend }: the ball played in to the passer first).
// Optional shot fields: to, s (seconds in the air), z (height at the goal line), lift.

const A = (player, x, y, gk = false) => ({ player, teammate: true, gk, location: [x, y] });   // attacking team
const D = (player, x, y, gk = false) => ({ player, teammate: false, gk, location: [x, y] });  // defending team

// The live feed's other events (synthetic). Goals are not listed here: they come from MOMENTS[i].minute.
export const EVENTS = [
  { minute: 0, text: 'Kick-off' },
  { minute: 9, text: 'Home: pass completed, Player 8 to Player 10' },
  { minute: 18, text: 'Away: corner won by Player 7' },
  { minute: 27, text: 'Home: great save by the keeper' },
  { minute: 45, text: 'Half-time' },
  { minute: 46, text: 'Second half under way' },
  { minute: 55, text: 'Away: free kick won by Player 10' },
  { minute: 63, text: 'Home: shot from Player 9, just wide' },
  { minute: 66, text: 'Both teams pushing for the opener' },
  { minute: 75, text: 'Away: pressing high for an equaliser' },
  { minute: 78, text: 'Away: great save by the keeper' },
  { minute: 80, text: 'Away: corner won by Player 11' },
  { minute: 84, text: 'Home: strong tackle by Player 6' },
  { minute: 86, text: 'Home: pass completed, Player 17 to Player 16' },
  { minute: 89, text: 'Away: free kick, well defended' },
  { minute: 90, text: 'Full time' },
];

export const MOMENTS = [
  { // 1. Home opener, a curved through ball: bends around a defender in the lane and drops into the space behind the line
    minute: 71, team: 'Home', passer: 'Player 8', receiver: 'Player 11',
    start: [88, 50], end: [107.4, 21.7], shot: { from: [107.4, 21.7], to: [120, 43.3] },
    flight: 1.3, bend: 4, lift: 1.8,
    showLanding: true,                                              // draw the curved pass to where it lands (scored at the runner's spot)
    positions: {
      'Player 1': 'GK', 'Player 2': 'RB', 'Player 4': 'CB', 'Player 5': 'CB', 'Player 3': 'LB', 'Player 6': 'CM',
      'Player 8': 'CM', 'Player 10': 'AM', 'Player 7': 'RW', 'Player 11': 'LW', 'Player 9': 'ST',
      'Goalkeeper': 'GK', 'Defender 2': 'RB', 'Defender 3': 'CB', 'Defender 4': 'CB', 'Defender 5': 'LB', 'Defender 6': 'DM',
      'Defender 7': 'CM', 'Defender 8': 'CM', 'Defender 11': 'RM', 'Defender 9': 'LM', 'Defender 10': 'ST',
    },
    run: {
      'Player 11': { v: [6.5, 1.5], ramp: 0.35 },                      // jogs, then accelerates behind the full-back
      'Player 8': [2.5, -0.5], 'Player 9': [1.5, 0], 'Player 10': [3, 0.5], 'Player 7': [3, -1], 'Player 6': [3, -0.5],
      'Player 5': [3, 0.5], 'Player 4': [3, 0], 'Player 3': [2.5, 0], 'Player 2': [2.5, 0],
      'Goalkeeper': { v0: [0, 0], v: [-1.5, -1], delay: 0.5 },
      'Defender 2': { v0: [0, 0.5], v: [-2.5, 2], delay: 0.35 },       // full-back tracks late
      'Defender 3': { v0: [0, -0.5], v: [-1.5, -2.5], delay: 0.4 },
      'Defender 4': { v0: [0, 0.3], v: [-1, -1], delay: 0.4 },
      'Defender 5': { v0: [0, 0], v: [-1.5, -2], delay: 0.45 },
      'Defender 6': { v0: [0.5, 0.5], v: [-1, -2], delay: 0.3 },
      'Defender 7': { v0: [1, 0], v: [0, -1], delay: 0.3 },
      'Defender 8': { v0: [2, 0], v: [1.5, -0.5], delay: 0.3 },
      'Defender 9': [2, -0.5], 'Defender 10': [2.5, 0.5],
      'Defender 11': { v0: [1, 0.5], v: [-0.5, 1.5], delay: 0.35 },
    },
    freeze_frame: [
      A('Player 1', 5, 40, true), A('Player 2', 60, 58), A('Player 3', 62, 26), A('Player 4', 70, 46), A('Player 5', 74, 30),
      A('Player 6', 82, 60), A('Player 7', 96, 64), A('Player 8', 88, 50), A('Player 9', 99.8, 40), A('Player 10', 92, 38), A('Player 11', 100.2, 20),
      D('Goalkeeper', 115, 40, true), D('Defender 2', 99.4, 10), D('Defender 3', 99.8, 31), D('Defender 4', 100.2, 45), D('Defender 5', 99.6, 63),
      D('Defender 6', 94, 35), D('Defender 7', 94, 52), D('Defender 8', 84, 40), D('Defender 9', 86, 56), D('Defender 10', 80, 28), D('Defender 11', 92, 22),
    ],
  },
  { // 2. Away equaliser, a heading finish: a whipped inswinging cross from the right flank, headed low into the far corner
    minute: 82, team: 'Away', passer: 'Player 7', receiver: 'Player 9',
    start: [102, 68], end: [110.5, 41.6], shot: { to: [120, 36.8], s: 0.45, z: 0.5, lift: 0.2 },
    flight: 1.2, bend: 3, lift: 3.2, startZ: 0.3, arriveZ: 2.9, aerial: true,
    showLanding: true,                                              // the cross drawn through the air onto the header spot
    ringed: ['Player 8', 'Player 10'],                              // the safe short ball and the far post
    positions: {
      'Player 1': 'GK', 'Player 4': 'RB', 'Player 2': 'CB', 'Player 3': 'CB', 'Player 5': 'LB', 'Player 6': 'DM',
      'Player 8': 'CM', 'Player 11': 'CM', 'Player 7': 'RW', 'Player 10': 'LW', 'Player 9': 'ST',
      'Goalkeeper': 'GK', 'Defender 5': 'RB', 'Defender 2': 'CB', 'Defender 3': 'CB', 'Defender 4': 'CB', 'Defender 10': 'LB',
      'Defender 6': 'DM', 'Defender 8': 'CM', 'Defender 7': 'CM', 'Defender 9': 'AM', 'Defender 11': 'ST',
    },
    run: {
      'Player 9': { v: [2.5, -2], ramp: 0.5, then: [1.3, [0.6, 0.6]], jump: { at: 1.2, h: 1, hang: 0.5 } },  // attacks the cross and meets it in the air
      'Player 7': { v: [1.5, -0.5], then: [0.4, [0, 0]] },
      'Player 10': [0.5, -0.5], 'Player 8': [-1, -1], 'Player 6': [1.5, 0], 'Player 11': [1, -1],
      'Player 5': [2, 0], 'Player 4': [2, 0], 'Player 3': [2, 0.5], 'Player 2': [2, 0],
      'Goalkeeper': { v0: [0, 0], v: [-0.3, -1.2], delay: 0.3, then: [1.4, [0.4, -3]] },      // sets, then dives to the far corner
      'Defender 2': { v0: [0.3, -0.2], v: [2.2, -1.8], delay: 0.1, jump: { at: 1.22, h: 0.8, hang: 0.45 } },  // marks the runner, jumps with him
      'Defender 3': { v0: [0, 0.3], v: [0.8, -0.8], delay: 0.3 },
      'Defender 4': { v0: [0, 0], v: [-1, -1.5], delay: 0.35 },
      'Defender 5': { v0: [0, 0], v: [0.5, 1.5], delay: 0.3 },
      'Defender 6': [1, 0], 'Defender 7': [1, -0.5], 'Defender 8': [1, 0.5], 'Defender 9': [1.5, 0], 'Defender 11': [2, -0.5],
      'Defender 10': { v0: [0.3, 0.3], v: [0.5, 0.8], delay: 0.3 },
    },
    freeze_frame: [
      A('Player 1', 5, 40, true), A('Player 2', 62, 48), A('Player 3', 64, 26), A('Player 4', 72, 60), A('Player 5', 76, 18),
      A('Player 6', 95, 40), A('Player 7', 102, 68), A('Player 8', 99, 52), A('Player 9', 107.5, 44), A('Player 10', 112, 28), A('Player 11', 96, 62),
      D('Goalkeeper', 117.5, 44.8, true), D('Defender 2', 108.5, 43.5), D('Defender 3', 114, 31), D('Defender 4', 105, 56), D('Defender 5', 106, 20),
      D('Defender 6', 98, 42), D('Defender 7', 96, 50), D('Defender 8', 97, 30), D('Defender 9', 92, 40), D('Defender 10', 101, 64), D('Defender 11', 90, 46),
    ],
  },
  { // 3. Home winner, a through ball into a well-organised block: a curled pass along the grass past the last line into a diagonal runner, scored at its reception point
    minute: 87, team: 'Home', passer: 'Player 17', receiver: 'Player 20',
    start: [82, 44], end: [109, 48], shot: { to: [120, 37.5], s: 0.3, z: 0, lift: 0.1 },
    flight: 1.55, bend: 3, lift: 0.1,                               // along the grass, curling around the centre-back standing in the lane
    carry: 0.37,                                                    // one touch forward, then a low finish across the keeper
    scoreAtEnd: true,                                               // score the played pass where it is received, not where the runner stood
    showLanding: true,
    positions: {
      'Player 1': 'GK', 'Player 2': 'RB', 'Player 3': 'CB', 'Player 5': 'CB', 'Player 6': 'LB', 'Player 16': 'DM',
      'Player 17': 'CM', 'Player 8': 'CM', 'Player 11': 'LW', 'Player 20': 'RW', 'Player 9': 'ST',
      'Goalkeeper': 'GK', 'Defender 2': 'RB', 'Defender 5': 'CB', 'Defender 4': 'CB', 'Defender 3': 'LB', 'Defender 6': 'DM',
      'Defender 8': 'CM', 'Defender 10': 'CM', 'Defender 11': 'RM', 'Defender 7': 'LM', 'Defender 9': 'ST',
    },
    lead: 2.3,                                                      // show 2.3 s before the pass: the ball is played in first
    prelude: { from: 'Player 11', pass: -1.65, recv: -0.75, touch: -0.25, bend: 3 },  // left winger plays it inside, first touch forward, then the pass
    ringed: ['Player 9', 'Player 8', 'Player 16'],                  // options to ring besides the played one: striker, inside, safe back
    run: {
      'Player 20': { v0: [2.5, -2.2], v: [6.45, -6.77], ramp: 0.3, then: [1.55, [4, -2.7]] },  // drifts along the line, sprints between centre-back and full-back
      'Player 17': { v0: [1.5, 0.5], v: [1, 0] }, 'Player 9': [1.5, 0], 'Player 8': [1, 0.5], 'Player 11': [1.5, 0.5],
      'Player 16': [0.8, -1.5],                                          // steps away from the striker to show for a safe ball
      'Player 2': [1.5, -0.5], 'Player 6': [1.5, 0.5], 'Player 3': [1, 0], 'Player 5': [1, 0],
      'Goalkeeper': { v0: [0, 1], v: [-1.72, 3.79], delay: 0.45, then: [1.92, [0.5, -6.5], 0.35], slide: { at: 1.98 } },  // reads it, rushes out, goes down and slides across at the shot
      'Defender 4': { v0: [-1, 0.8], v: [1, 0.1], delay: 0.3, then: [1, [8, 0.1]] },  // ball-watching: a slow turn, then chases from behind, ~0.4 s after the ball
      'Defender 3': { v0: [-0.4, -1.3], v: [3, -4], delay: 0.3 },               // narrows, but on the outside of the runner
      'Defender 8': { v0: [-3, -4.4], ramp: 0.4, v: [-2, -3], delay: 0.1, then: [0.35, [-1.6, -2.4], 0.3] },  // sprints to press the passer, lunges a step late, pulls up
      'Defender 5': { v0: [-0.5, 1.4], v: [1.5, 1.5], delay: 0.4 },
      'Defender 2': { v0: [-0.4, 1.6], v: [0.5, 0.5] }, 'Defender 6': { v0: [-0.6, 1.5], v: [0.5, 0] },  // the block shifts across with the ball
      'Defender 10': { v0: [-0.5, 1.3], v: [0.5, 0] }, 'Defender 7': [1.5, -0.8], 'Defender 11': [1.2, 1.5], 'Defender 9': [1.2, 0.6],
    },
    freeze_frame: [
      A('Player 1', 22, 40, true), A('Player 2', 76, 70), A('Player 3', 58, 50), A('Player 5', 57, 30), A('Player 6', 74, 14),
      A('Player 16', 73, 34), A('Player 8', 95, 30), A('Player 17', 82, 44), A('Player 20', 99, 58.5), A('Player 9', 100, 40), A('Player 11', 94, 14),
      D('Goalkeeper', 117, 40, true), D('Defender 3', 99.5, 62), D('Defender 4', 100.5, 47), D('Defender 5', 102.5, 40), D('Defender 2', 99, 22),
      D('Defender 8', 84.5, 48.5), D('Defender 6', 89, 38), D('Defender 10', 93, 29), D('Defender 7', 80, 66), D('Defender 11', 79, 18), D('Defender 9', 74, 42),
    ],
  },
];

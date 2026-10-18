import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureTracker, extendedFingers, fingerGesture, openness, validHand } from '../src/gestures.js';
import { HandForces } from '../src/interactions.js';

// ---- synthetic landmarks ---------------------------------------------------------
// Built in isotropic palm units around the wrist (fingers pointing up), optionally
// rotated and mirrored, then normalized for a frame of the given aspect.
// `up` = extended [index, middle, ring, pinky]; `spread` widens extended fingertips.
const FINGERS = [[5, -.3], [9, 0], [13, .3], [17, .55]];
function hand({ up = [1, 1, 1, 1], x = .5, y = .6, palm = .12, aspect = 1, angle = 0, mirror = false, spread = 1 } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  const c = Math.cos(angle), s = Math.sin(angle);
  const put = (i, ux, uy) => {
    if (mirror) ux = -ux;
    const rx = ux * c - uy * s, ry = ux * s + uy * c;
    points[i] = { x: x + rx * palm / aspect, y: y + ry * palm, z: 0 };
  };
  put(0, 0, 0);
  put(1, -.4, -.3); put(2, -.6, -.5); put(3, -.7, -.7); put(4, -.8, -.9);
  FINGERS.forEach(([mcp, dx], k) => {
    const base = mcp === 9 ? 1 : .92;
    put(mcp, dx, -base);
    if (up[k]) { put(mcp + 1, dx, -base - .45); put(mcp + 2, dx * spread, -base - .75); put(mcp + 3, dx * spread, -base - 1); }
    else { put(mcp + 1, dx, -base - .35); put(mcp + 2, dx, -base - .05); put(mcp + 3, dx, -base + .35); }
  });
  return points;
}
const ONE = [1, 0, 0, 0], TWO = [1, 1, 0, 0], THREE = [1, 1, 1, 0], FIST = [0, 0, 0, 0], OPEN = [1, 1, 1, 1];
const combos = Array.from({ length: 16 }, (_, n) => [0, 1, 2, 3].map(b => (n >> b) & 1));

// Same mapping shape as main.js mapPoint with a matching camera/screen aspect.
const mapFor = aspect => p => [(1 - 2 * p.x) * aspect, 1 - 2 * p.y];
const map = mapFor(1);
const STEP = 33; // ~30 Hz tracking
// Feeds frames (a single hand, an array of hands, or {hands, ids}) and samples every
// frame. Returns per-frame samples and all drained bursts with their frame index.
function feed(forces, frames, { start = 1000, step = STEP, aspect = 1 } = {}) {
  const samples = [], bursts = [];
  frames.forEach((frame, i) => {
    if (Array.isArray(frame) && frame.length === 21 && 'x' in frame[0]) frame = [frame];
    const t = start + i * step, hands = Array.isArray(frame) ? frame : frame.hands;
    const handIds = Array.isArray(frame) ? hands.map((_, k) => k + 1) : frame.ids;
    forces.update({ hands, handIds, aspect, timestamp: t }, t, mapFor(aspect));
    samples.push(forces.sample(t));
    forces.drainBursts().forEach(b => bursts.push({ ...b, frame: i }));
  });
  return { samples, bursts, end: start + frames.length * step };
}
const repeat = (value, n) => Array.from({ length: n }, () => value);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ---- classification ----------------------------------------------------------------
test('every finger combination is counted, with the thumb ignored', () => {
  const names = ['fist', 'wand', 'vortex', 'shockwave', 'open'];
  for (const up of combos) {
    const n = up.reduce((a, b) => a + b, 0), shape = fingerGesture(hand({ up }));
    assert.equal(shape.count, n, `combo ${up}`);
    assert.equal(shape.gesture, names[n]);
    assert.deepEqual(shape.tips, [8, 12, 16, 20].filter((_, k) => up[k]));
    assert.equal(openness(hand({ up })), n / 4);
  }
});

test('counting is invariant to rotation, mirroring, frame aspect and hand size', () => {
  for (const aspect of [1, 4 / 3, 16 / 9])
    for (const angle of [0, .7, Math.PI / 2, Math.PI, -2.1])
      for (const mirror of [false, true])
        for (const palm of [.06, .15])
          for (const up of [FIST, ONE, [0, 1, 0, 0], TWO, [0, 1, 1, 0], THREE, OPEN])
            assert.deepEqual(extendedFingers(hand({ up, aspect, angle, mirror, palm, x: .5, y: .5 }), aspect), up.map(Boolean), `${aspect} ${angle} ${mirror} ${palm} ${up}`);
});

test('curled and hooked fingers do not count; incomplete or non-finite hands are rejected', () => {
  assert.equal(fingerGesture(hand({ up: FIST })).count, 0);
  const hooked = hand({ up: TWO }); // middle finger bent toward the camera: tip stays at the PIP
  hooked[12] = { ...hooked[10], y: hooked[10].y - .01 };
  assert.equal(fingerGesture(hooked).count, 1);
  const nan = hand(); nan[8] = { x: NaN, y: .2, z: 0 };
  const inf = hand(); inf[0] = { x: .5, y: Infinity, z: 0 };
  const badZ = hand(); badZ[12].z = Infinity;
  for (const bad of [nan, inf, badZ, hand().slice(0, 20), null, undefined, [], 'hand']) {
    assert.equal(validHand(bad), false);
    assert.equal(extendedFingers(bad), null);
    assert.equal(fingerGesture(bad), null);
  }
});

// ---- GestureTracker palm burst vs three fingers ------------------------------------
const track = (frames, step = 66) => { const g = new GestureTracker(), out = []; frames.forEach((h, i) => out.push(...g.update([h], 1000 + i * step))); return out; };

test('palm burst needs all four long fingers: fist -> three fingers never fires it', () => {
  assert.equal(track([...repeat(hand({ up: FIST }), 3), ...repeat(hand({ up: THREE }), 10)]).length, 0);
  assert.equal(track([...repeat(hand({ up: FIST }), 3), ...repeat(hand({ up: [0, 1, 1, 1] }), 10)]).length, 0);
  assert.equal(track([...repeat(hand({ up: FIST }), 3), ...repeat(hand({ up: OPEN }), 3)]).length, 1);
});

test('a held three-finger shockwave disarms the fist, so a later open palm does not double-fire', () => {
  assert.equal(track([...repeat(hand({ up: FIST }), 3), ...repeat(hand({ up: THREE }), 4), ...repeat(hand({ up: OPEN }), 4)]).length, 0);
  // Passing through a partial count briefly while opening still fires.
  assert.equal(track([...repeat(hand({ up: FIST }), 3), hand({ up: TWO }), hand({ up: THREE }), ...repeat(hand({ up: OPEN }), 3)]).length, 1);
});

// ---- HandForces gestures -----------------------------------------------------------
test('one, two and three fingers become wand, vortex and shockwave only after ~180 ms', () => {
  for (const [up, gesture, sign] of [[ONE, 'wand', 1], [TWO, 'vortex', 1], [THREE, 'shockwave', -1]]) {
    const f = new HandForces(), { samples } = feed(f, repeat([hand({ up })], 12));
    const at = ms => samples[Math.round(ms / STEP)][0];
    assert.notEqual(at(132).gesture, gesture, `${gesture} must not start before the hold`);
    assert.ok(['pull', 'push'].includes(at(132).gesture));
    assert.equal(at(198).gesture, gesture);
    assert.equal(at(198).mode, sign);
    const last = samples.at(-1)[0];
    for (const key of ['x', 'y', 'vx', 'vy', 'strength', 'mode', 'id', 'wand', 'vortex', 'shockwave', 'vortexRadius', 'gesture']) assert.ok(key in last, key);
    assert.ok(last[gesture] > .95, `${gesture} weight settles`);
  }
});

test('fist and open palm keep pull and push with the existing strength range', () => {
  const f = new HandForces();
  const pull = feed(f, repeat([hand({ up: FIST })], 3)).samples.at(-1)[0];
  assert.equal(pull.gesture, 'pull'); assert.ok(pull.strength >= 12 && pull.strength <= 18);
  assert.equal(pull.wand + pull.vortex + pull.shockwave, 0);
  const push = feed(f, repeat([hand({ up: OPEN })], 4), { start: 2000 }).samples.at(-1)[0];
  assert.equal(push.gesture, 'push'); assert.ok(push.strength <= -12 && push.strength >= -18);
});

test('weights blend in ~100 ms, never sum above 1, and strengths approach the gesture targets', () => {
  const f = new HandForces();
  const seq = [...repeat(hand({ up: ONE }), 12), ...repeat(hand({ up: TWO }), 12), ...repeat(hand({ up: THREE }), 12), ...repeat(hand({ up: FIST }), 12)];
  let t = 1000, max = 0;
  const settled = {};
  seq.forEach((h, i) => {
    f.update({ hands: [h], handIds: [1], aspect: 1, timestamp: t }, t, map);
    for (let k = 0; k < 4; k++) { // display frames between tracking frames
      const s = f.sample(t + k * 8)[0];
      max = Math.max(max, s.wand + s.vortex + s.shockwave);
      for (const w of ['wand', 'vortex', 'shockwave']) assert.ok(s[w] >= 0 && s[w] <= 1);
      if (i % 12 === 11 && k === 3) settled[s.gesture] = s;
    }
    t += STEP;
  });
  assert.ok(max <= 1 + 1e-9);
  assert.ok(near(settled.wand.strength, 14, .5));
  assert.ok(near(settled.vortex.strength, 16, .5));
  assert.ok(near(settled.shockwave.strength, -18, .5));
  assert.ok(settled.pull.strength > 0 && settled.pull.shockwave < .05);
  // ~100 ms after the vortex became stable its weight is mostly in.
  const g = new HandForces(); feed(g, repeat([hand({ up: TWO })], 6)); // stable at 165..198 ms
  const enteredAt = 1000 + 6 * STEP;
  g.update({ hands: [hand({ up: TWO })], handIds: [1], aspect: 1, timestamp: enteredAt }, enteredAt, map);
  const before = g.sample(enteredAt).at(0).vortex, later = g.sample(enteredAt + 100).at(0).vortex;
  assert.ok(later > .9 && later > before);
});

test('wand anchors at the raised fingertip, vortex at the two-tip midpoint, others at the palm, without fake velocity', () => {
  for (const [up, gesture, anchor] of [[ONE, 'wand', h => map(h[8])], [[0, 0, 1, 0], 'wand', h => map(h[16])], [TWO, 'vortex', h => { const a = map(h[8]), b = map(h[12]); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }], [THREE, 'shockwave', h => map(h[9])], [FIST, 'pull', h => map(h[9])]]) {
    const h = hand({ up, angle: .4 }), f = new HandForces();
    const { samples } = feed(f, [...repeat(hand({ up: FIST, angle: .4 }), 4), ...repeat(h, 14)]);
    const s = samples.at(-1)[0], [ax, ay] = anchor(h);
    assert.equal(s.gesture, gesture);
    assert.ok(Math.hypot(s.x - ax, s.y - ay) < .01, `${gesture} anchor ${s.x},${s.y} vs ${ax},${ay}`);
    for (const frame of samples) assert.ok(Math.hypot(frame[0].vx, frame[0].vy) < 1e-9, 'a stationary palm has no velocity while the anchor moves');
  }
});

test('anchor changes move smoothly at display cadence', () => {
  const f = new HandForces(), h = hand({ up: ONE });
  feed(f, repeat(h, 5));
  let t = 1000 + 5 * STEP, prev = null, maxJump = 0;
  for (let i = 0; i < 6; i++, t += STEP) {
    f.update({ hands: [h], handIds: [1], aspect: 1, timestamp: t }, t, map);
    for (let k = 0; k < 4; k++) { const s = f.sample(t + k * 8)[0]; if (prev) maxJump = Math.max(maxJump, Math.hypot(s.x - prev.x, s.y - prev.y)); prev = s; }
  }
  const total = Math.hypot(...[0, 1].map(i => map(h[8])[i] - map(h[9])[i]));
  assert.ok(maxJump < total * .35, `largest per-frame step ${maxJump} of ${total}`);
});

test('spreading two fingers increases the vortex radius within .22 .. .8', () => {
  const radius = (spread, palm = .12) => feed(new HandForces(), repeat([hand({ up: TWO, spread, palm })], 10)).samples.at(-1)[0].vortexRadius;
  const together = radius(.3), apart = radius(3), wide = radius(6);
  assert.ok(apart > together, `${apart} > ${together}`);
  assert.ok(wide >= apart);
  assert.ok(near(radius(.05), .22) && near(radius(20, .2), .8), 'clamped');
  // Radius follows the mapped fingertip spread.
  const h = hand({ up: TWO, spread: 3 }), a = map(h[8]), b = map(h[12]);
  assert.ok(near(apart, Math.min(.8, Math.max(.22, Math.hypot(a[0] - b[0], a[1] - b[1]) * 1.8)), 1e-3));
});

// ---- bursts ------------------------------------------------------------------------
test('raising three fingers drains exactly one world-space burst per hold', () => {
  const f = new HandForces(), h = hand({ up: THREE, x: .3 });
  const { bursts } = feed(f, [...repeat(hand({ up: FIST, x: .3 }), 8), ...repeat(h, 60)]);
  assert.equal(bursts.length, 1);
  const [x, y] = map(h[9]);
  assert.deepEqual({ ...bursts[0], frame: undefined }, { x, y, id: 1, strength: 1.2, frame: undefined });
  assert.equal(bursts[0].frame, 8 + Math.ceil(180 / STEP));
  assert.deepEqual(f.drainBursts(), [], 'drained once');
});

test('noisy counts around three fingers neither trigger nor retrigger', () => {
  const noisy = [3, 3, 2, 3, 3, 4, 3, 3, 2, 3, 3, 3, 4, 3, 3].map(n => hand({ up: [1, n > 1, n > 2, n > 3].map(Number) }));
  assert.equal(feed(new HandForces(), [...repeat(hand({ up: FIST }), 8), ...noisy]).bursts.length, 0);
  // After a real entry, single-frame flickers to two or four fingers do not retrigger.
  const held = [...repeat(hand({ up: FIST }), 8), ...repeat(hand({ up: THREE }), 8), ...noisy, ...noisy];
  const { bursts, samples } = feed(new HandForces(), held);
  assert.equal(bursts.length, 1);
  assert.ok(samples.slice(16).every(s => s[0].gesture === 'shockwave'), 'flickers do not leave the gesture');
});

test('a deliberate re-entry after another held gesture fires again; a brief dip or an open palm does not', () => {
  const three = repeat(hand({ up: THREE }), 10);
  const run = between => feed(new HandForces(), [...repeat(hand({ up: FIST }), 8), ...three, ...between, ...three]).bursts.length;
  assert.equal(run(repeat(hand({ up: FIST }), 8)), 2, 'fist held ~260 ms');
  assert.equal(run(repeat(hand({ up: TWO }), 8)), 2, 'vortex held, then a third finger raised');
  assert.equal(run(repeat(hand({ up: FIST }), 4)), 1, 'fist for only ~130 ms');
  assert.equal(run(repeat(hand({ up: OPEN }), 12)), 1, 'lowering from a full palm is not raising three');
});

test('per-hand cooldown spaces bursts even with fast deliberate cycles', () => {
  const f = new HandForces({ enter: 60, exit: 30, cooldown: 600 });
  const cycle = [...repeat(hand({ up: FIST }), 3), ...repeat(hand({ up: THREE }), 3)]; // ~200 ms each
  assert.equal(feed(f, [...cycle, ...cycle, ...cycle]).bursts.length, 1);
  assert.equal(feed(f, [...repeat(hand({ up: FIST }), 3), ...repeat(hand({ up: THREE }), 3)], { start: 3000 }).bursts.length, 1);
});

test('tracking loss: occlusion and reacquire do not retrigger, a long absence does', () => {
  const start = [...repeat(hand({ up: FIST }), 8), ...repeat(hand({ up: THREE }), 10)];
  const lose = (gap, id = 1, x = .5) => {
    const f = new HandForces(), first = feed(f, start);
    const later = first.end + gap;
    f.update({ hands: [], handIds: [], timestamp: first.end }, first.end, map);
    const back = feed(f, repeat({ hands: [hand({ up: THREE, x })], ids: [id] }, 12), { start: later });
    return first.bursts.length + back.bursts.length;
  };
  assert.equal(lose(80), 1, 'brief gap, same state');
  assert.equal(lose(400), 1, 'state expired, same id reacquired');
  assert.equal(lose(400, 7), 1, 'identity churn at the same spot');
  assert.equal(lose(1500), 2, 'came back much later: deliberate');
  assert.equal(lose(400, 7, .05), 2, 'a different hand far away');
});

test('two hands are independent and keep state when detection order changes', () => {
  const f = new HandForces(), frames = [];
  const A = up => hand({ up, x: .25 }), B = up => hand({ up, x: .75 });
  for (let i = 0; i < 20; i++) {
    const a = i < 6 ? A(FIST) : A(THREE), b = B(FIST);
    frames.push(i % 2 ? { hands: [b, a], ids: [9, 4] } : { hands: [a, b], ids: [4, 9] });
  }
  const first = feed(f, frames);
  assert.equal(first.bursts.length, 1);
  assert.equal(first.bursts[0].id, 4);
  const byId = Object.fromEntries(first.samples.at(-1).map(s => [s.id, s]));
  assert.equal(byId[4].gesture, 'shockwave'); assert.equal(byId[9].gesture, 'pull');
  // The second hand, right next to the first one still in shockwave, raises one finger then three.
  const more = [];
  for (let i = 0; i < 20; i++) more.push(i % 2 ? { hands: [B(i < 8 ? ONE : THREE), A(THREE)], ids: [9, 4] } : { hands: [A(THREE), B(i < 8 ? ONE : THREE)], ids: [4, 9] });
  const second = feed(f, more, { start: first.end });
  assert.deepEqual(second.bursts.map(b => b.id), [9]);
  const last = Object.fromEntries(second.samples.at(-1).map(s => [s.id, s]));
  assert.equal(last[4].gesture, 'shockwave'); assert.equal(last[9].gesture, 'shockwave');
});

test('works on a 16:9 frame', () => {
  const aspect = 16 / 9, f = new HandForces();
  const { bursts, samples } = feed(f, [...repeat([hand({ up: FIST, aspect })], 8), ...repeat([hand({ up: THREE, aspect, angle: 2.5, mirror: true })], 10)], { aspect });
  assert.equal(bursts.length, 1);
  assert.equal(samples.at(-1)[0].gesture, 'shockwave');
});

test('invalid hands are ignored and clear() drops states, queued bursts and reacquire memory', () => {
  const f = new HandForces(), nan = hand({ up: THREE }); nan[12] = { x: NaN, y: 0, z: 0 };
  feed(f, repeat([nan, hand({ up: FIST }).slice(0, 12)], 10));
  assert.equal(f.states.size, 0);
  assert.deepEqual(f.sample(2000), []);
  // A queued, undrained burst and the reacquire memory are both cleared.
  f.update({ hands: [], handIds: [] }, 0, map);
  const t = 5000;
  [...repeat(hand({ up: FIST }), 8), ...repeat(hand({ up: THREE }), 8)].forEach((h, i) => f.update({ hands: [h], handIds: [1], aspect: 1, timestamp: t + i * STEP }, t + i * STEP, map));
  assert.equal(f.bursts.length, 1);
  f.clear();
  assert.deepEqual(f.drainBursts(), []);
  assert.equal(f.states.size, 0);
  const again = feed(f, repeat([hand({ up: THREE })], 10), { start: t + 16 * STEP + 50 });
  assert.equal(again.bursts.length, 1, 'no reacquire suppression survives clear()');
});

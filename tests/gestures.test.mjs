import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureTracker, openness, cleanHands, cleanPoses, nextPoseStride } from '../src/gestures.js';
import { Tracking, captureSize } from '../src/tracking.js';

// ---- synthetic landmarks ---------------------------------------------------------
// A hand built in isotropic units (palm length = `palm`, fingers pointing up), then
// normalized for a frame of the given aspect so tests exercise the aspect correction.
const FINGERS = [[5, -.3], [9, 0], [13, .3], [17, .55]]; // MCP index, lateral offset (palm units)
function hand({ x = .5, y = .6, open = 1, palm = .12, aspect = 1 } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  const put = (i, ux, uy) => { points[i] = { x: x + ux * palm / aspect, y: y + uy * palm, z: 0 }; };
  put(0, 0, 0);
  put(1, -.4, -.3); put(2, -.6, -.5); put(3, -.7, -.7); put(4, -.8, -.9);
  for (const [mcp, dx] of FINGERS) {
    const base = mcp === 9 ? 1 : .92;
    put(mcp, dx, -base);
    if (open) { put(mcp + 1, dx, -base - .45); put(mcp + 2, dx, -base - .75); put(mcp + 3, dx, -base - 1); }
    else { put(mcp + 1, dx, -base - .35); put(mcp + 2, dx, -base - .05); put(mcp + 3, dx, -base + .35); } // curled back to the palm
  }
  return points;
}
const closed = o => hand({ ...o, open: 0 });
const half = o => { const h = hand(o); // two fingers curled: openness 0.5
  for (const mcp of [13, 17]) { h[mcp + 1] = { ...h[mcp], y: h[mcp].y - .02 }; h[mcp + 2] = { ...h[mcp], y: h[mcp].y + .02 }; h[mcp + 3] = { ...h[mcp], y: h[mcp].y + .06 }; }
  return h; };
const STEP = 66; // ~15 Hz tracking
// Feeds `frames` (arrays of hands) at ~15 Hz and returns all bursts with their frame index.
function run(tracker, frames, start = 1000, aspect = 1) {
  const out = [];
  frames.forEach((hands, i) => tracker.update(hands, start + i * STEP, aspect).forEach(b => out.push({ ...b, frame: i })));
  return out;
}
const repeat = (value, n) => Array.from({ length: n }, () => value);

// ---- openness --------------------------------------------------------------------
test('openness separates open hand, fist and half-open hand', () => {
  assert.equal(openness(hand()), 1);
  assert.equal(openness(closed()), 0);
  assert.equal(openness(half()), .5);
});

test('openness is aspect-aware: the same physical hand reads identically in a 16:9 frame', () => {
  for (const aspect of [4 / 3, 16 / 9]) {
    assert.equal(openness(hand({ aspect }), aspect), 1);
    assert.equal(openness(closed({ aspect }), aspect), 0);
  }
});

// ---- closed -> open burst ----------------------------------------------------------
test('a closed-to-open transition bursts exactly once, at the middle-finger knuckle', () => {
  const t = new GestureTracker();
  const bursts = run(t, [...repeat([closed()], 3), ...repeat([hand()], 4)]);
  assert.equal(bursts.length, 1);
  assert.equal(bursts[0].frame, 4, 'fires on the second consecutive open frame');
  assert.ok(Math.abs(bursts[0].x - .5) < 1e-9 && Math.abs(bursts[0].y - (.6 - .12)) < 1e-9);
  assert.equal(typeof bursts[0].id, 'number');
});

test('holding the hand open does not retrigger', () => {
  const t = new GestureTracker();
  const bursts = run(t, [...repeat([closed()], 3), ...repeat([hand()], 60)]); // ~4 s open
  assert.equal(bursts.length, 1);
});

test('a hand first seen open never bursts, and neither does a single-frame open flicker', () => {
  assert.equal(run(new GestureTracker(), repeat([hand()], 20)).length, 0);
  assert.equal(run(new GestureTracker(), [...repeat([closed()], 4), [hand()], ...repeat([closed()], 4)]).length, 0);
});

test('a single-frame closed flicker in an open hand does not arm it', () => {
  assert.equal(run(new GestureTracker(), [...repeat([hand()], 5), [closed()], ...repeat([hand()], 5)]).length, 0);
});

test('a fist abandoned half-open for longer than the arm timeout does not burst later', () => {
  const t = new GestureTracker();
  const frames = [...repeat([closed()], 3), ...repeat([half()], 40), ...repeat([hand()], 3)]; // ~2.6 s limbo
  assert.equal(run(t, frames).length, 0);
});

test('a normal fist-to-open passing through half-open frames still bursts', () => {
  const bursts = run(new GestureTracker(), [...repeat([closed()], 3), [half()], [half()], [hand()], [hand()], [hand()]]);
  assert.equal(bursts.length, 1);
});

test('works on a 16:9 frame with aspect-normalized landmarks', () => {
  const a = 16 / 9;
  const bursts = run(new GestureTracker(), [...repeat([closed({ aspect: a })], 3), ...repeat([hand({ aspect: a })], 3)], 1000, a);
  assert.equal(bursts.length, 1);
});

// ---- lost hands --------------------------------------------------------------------
test('a briefly lost hand keeps its identity and its armed state', () => {
  const t = new GestureTracker();
  run(t, repeat([closed()], 3));
  const idBefore = t.ids[0];
  t.update([], 1000 + 3 * STEP);
  t.update([], 1000 + 4 * STEP);
  const bursts = [hand(), hand()].flatMap((h, i) => t.update([h], 1000 + (5 + i) * STEP));
  assert.equal(bursts.length, 1);
  assert.equal(bursts[0].id, idBefore);
});

test('a hand lost longer than the expiry comes back as a new, unarmed track', () => {
  const t = new GestureTracker();
  run(t, repeat([closed()], 3));
  const oldId = t.ids[0];
  t.update([], 1000 + 3 * STEP);
  const later = 1000 + 3 * STEP + 1500;
  const bursts = [hand(), hand(), hand()].flatMap((h, i) => t.update([h], later + i * STEP));
  assert.equal(bursts.length, 0);
  assert.notEqual(t.ids[0], oldId);
  assert.equal(t.tracks.length, 1, 'the expired track was dropped');
});

test('tracks do not leak when hands disappear for good', () => {
  const t = new GestureTracker();
  run(t, repeat([hand({ x: .2 }), hand({ x: .8 })], 5));
  assert.equal(t.tracks.length, 2);
  t.update([], 10000);
  assert.equal(t.tracks.length, 0);
});

// ---- identity and ordering ---------------------------------------------------------
test('detection order does not matter: reordered hands keep their own state', () => {
  const t = new GestureTracker();
  const left = o => [closed({ x: .25, ...o }), hand({ x: .25, ...o })];
  const right = o => [closed({ x: .75, ...o }), hand({ x: .75, ...o })];
  // Right hand stays a fist the whole time; only the left hand opens. The detector
  // reports them in alternating order.
  const frames = [];
  for (let i = 0; i < 8; i++) {
    const L = i < 3 ? left()[0] : left()[1], R = right()[0];
    frames.push(i % 2 ? [R, L] : [L, R]);
  }
  const bursts = run(t, frames);
  assert.equal(bursts.length, 1);
  assert.ok(Math.abs(bursts[0].x - .25) < 1e-9, 'burst belongs to the left hand');
  assert.equal(t.tracks.length, 2);
  // Now the right hand opens, in the other order.
  const more = run(t, [[left()[1], right()[1]], [right()[1], left()[1]], [right()[1], left()[1]]], 1000 + 8 * STEP);
  assert.equal(more.length, 1);
  assert.ok(Math.abs(more[0].x - .75) < 1e-9, 'burst belongs to the right hand');
});

test('simultaneous bursts from several hands are all delivered, even close together', () => {
  const t = new GestureTracker();
  const xs = [.15, .4, .5, .85]; // .4 and .5 are inside the duplicate-suppression radius
  const frames = [...repeat(xs.map(x => closed({ x })), 3), ...repeat(xs.map(x => hand({ x })), 3)];
  const bursts = run(t, frames);
  assert.equal(bursts.length, 4);
  assert.equal(new Set(bursts.map(b => b.id)).size, 4);
  assert.deepEqual(bursts.map(b => b.frame), [4, 4, 4, 4]);
});

test('eight hands are tracked independently', () => {
  const t = new GestureTracker();
  const xs = Array.from({ length: 8 }, (_, i) => .06 + i * .12);
  const bursts = run(t, [...repeat(xs.map(x => closed({ x, palm: .05 })), 3), ...repeat(xs.map(x => hand({ x, palm: .05 })), 3)]);
  assert.equal(bursts.length, 8);
});

test('nearest pairs are matched first, so a fast neighbour cannot steal an identity', () => {
  const t = new GestureTracker();
  run(t, repeat([hand({ x: .3 }), hand({ x: .4 })], 3));
  const [a, b] = t.ids;
  // Detections arrive as [.33, .29]. Per-hand greedy order would give .33 to A and
  // then drag B across to .29; nearest-first gives .29 to A (0.01 away) and .33 to B.
  t.update([hand({ x: .33 }), hand({ x: .29 })], 1000 + 3 * STEP);
  assert.deepEqual(t.ids, [b, a]);
});

test('hands too far from every track start new tracks instead of teleporting an identity', () => {
  const t = new GestureTracker();
  run(t, repeat([hand({ x: .2 })], 3));
  const first = t.ids[0];
  t.update([hand({ x: .8 })], 1000 + 3 * STEP);
  assert.notEqual(t.ids[0], first);
});

// ---- cooldown ----------------------------------------------------------------------
test('a second closed-to-open inside the cooldown is suppressed and needs a fresh fist', () => {
  const t = new GestureTracker();
  const cycle = [...repeat([closed()], 2), ...repeat([hand()], 2)]; // 4 frames = 264 ms
  const bursts = run(t, [...cycle, ...cycle, ...repeat([hand()], 20)]);
  assert.equal(bursts.length, 1, 'the second cycle (264 ms later) is inside the 500 ms cooldown');
});

test('bursts resume once the cooldown has passed', () => {
  const t = new GestureTracker();
  const cycle = [...repeat([closed()], 2), ...repeat([hand()], 2)];
  const bursts = run(t, [...cycle, ...repeat([hand()], 12), ...cycle]);
  assert.equal(bursts.length, 2);
});

test('identity churn near the same spot cannot double-fire', () => {
  const t = new GestureTracker();
  // Track A bursts. Its detection then drops out and the hand is re-detected after its
  // track expired but within the spatial suppression window, as a brand-new closed-open.
  const first = run(t, [...repeat([closed()], 3), ...repeat([hand()], 2)]);
  assert.equal(first.length, 1);
  const t0 = 1000 + 5 * STEP;
  t.tracks = [];
  const second = [closed(), closed(), hand(), hand()].flatMap((h, i) => t.update([h], t0 + 40 + i * 40));
  assert.equal(second.length, 0);
});

// ---- input hygiene -----------------------------------------------------------------
test('update tolerates empty, malformed and non-finite input', () => {
  const t = new GestureTracker();
  assert.deepEqual(t.update([], 0), []);
  assert.deepEqual(t.update(undefined, 10), []);
  assert.deepEqual(t.update([[{ x: 0, y: 0 }]], 20), []);
  assert.deepEqual(t.update([hand()], NaN), []);
});

test('cleanHands rejects malformed/implausible hands and strips visibility', () => {
  const withVisibility = hand().map(p => ({ ...p, visibility: 0 }));
  const nan = hand(); nan[4] = { x: NaN, y: 0, z: 0 };
  const result = cleanHands([withVisibility, nan, hand().slice(0, 20), hand({ palm: .002 }), hand({ x: .1 })], [.9, .9, .9, .9, .8]);
  assert.equal(result.hands.length, 2);
  assert.deepEqual(result.scores, [.9, .8]);
  assert.ok(result.hands.every(h => h.length === 21 && h.every(p => !('visibility' in p))));
});

test('cleanHands collapses duplicate detections of one hand, keeping the higher score and order', () => {
  const a = hand({ x: .3 }), twinA = hand({ x: .305, y: .602 }), b = hand({ x: .7 });
  const result = cleanHands([twinA, b, a], [.6, .8, .9]);
  assert.equal(result.hands.length, 2);
  assert.deepEqual(result.scores, [.8, .9], 'kept detection order: b (index 1) then a (index 2)');
  assert.ok(Math.abs(result.hands[1][0].x - .3) < 1e-9, 'higher-scoring twin kept');
});

test('cleanPoses requires a few visible joints and keeps visibility', () => {
  const pose = visible => Array.from({ length: 33 }, (_, i) => ({ x: .5, y: .5, z: 0, visibility: i < visible ? .9 : .1 }));
  const kept = cleanPoses([pose(20), pose(1), pose(3), pose(20).slice(0, 10)]);
  assert.equal(kept.length, 2);
  assert.equal(kept[0][0].visibility, .9);
});

test('nextPoseStride halves pose rate when slow and recovers with hysteresis', () => {
  assert.equal(nextPoseStride(1, 30), 1);
  assert.equal(nextPoseStride(1, 80), 2);
  assert.equal(nextPoseStride(2, 50), 2, 'between thresholds: no flapping');
  assert.equal(nextPoseStride(2, 30), 1);
});

// ---- capture geometry --------------------------------------------------------------
test('captureSize keeps the camera aspect and caps only the long side', () => {
  assert.deepEqual(captureSize(1280, 720), { width: 640, height: 360 });
  assert.deepEqual(captureSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(captureSize(1920, 1080), { width: 640, height: 360 });
  assert.deepEqual(captureSize(1024, 768), { width: 640, height: 480 });
  assert.deepEqual(captureSize(720, 1280), { width: 360, height: 640 });
  assert.deepEqual(captureSize(320, 240), { width: 320, height: 240 }, 'never upscales');
  assert.equal(captureSize(0, 0), null);
  assert.equal(captureSize(undefined, 480), null);
  for (const [w, h] of [[1280, 720], [1600, 900], [1280, 800], [1920, 1200]]) {
    const s = captureSize(w, h);
    assert.ok(Math.abs(s.width / s.height - w / h) < .01);
  }
});

// ---- Tracking lifecycle (stubbed browser APIs, no camera, no MediaPipe) --------------
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function rig({ autoReady = true, userMedia } = {}) {
  const saved = { navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), Worker: globalThis.Worker, createImageBitmap: globalThis.createImageBitmap };
  const rig = { workers: [], bitmaps: [], statuses: [], results: [] };
  const track = { stopped: false, onended: null, stop() { this.stopped = true; } };
  rig.track = track;
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  rig.video = { srcObject: null, readyState: 4, currentTime: .1, videoWidth: 1280, videoHeight: 720, play: async () => {} };
  class FakeWorker {
    constructor(url) { this.url = String(url); this.posted = []; this.terminated = false; rig.workers.push(this); }
    postMessage(message, transfer) {
      this.posted.push({ message, transfer });
      if (message.type === 'init' && autoReady) queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
    }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage?.({ data }); }
  }
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: userMedia ?? (async () => stream) } }, configurable: true, writable: true });
  globalThis.Worker = FakeWorker;
  globalThis.createImageBitmap = async (video, options) => {
    const bitmap = { width: options?.resizeWidth ?? video.videoWidth, height: options?.resizeHeight ?? video.videoHeight, options, closed: false, close() { this.closed = true; } };
    rig.bitmaps.push(bitmap);
    return bitmap;
  };
  rig.tracking = new Tracking(rig.video, r => rig.results.push(r), s => rig.statuses.push(s));
  rig.stream = stream;
  rig.restore = () => {
    rig.tracking.stop();
    if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); else delete globalThis.navigator;
    globalThis.Worker = saved.Worker; globalThis.createImageBitmap = saved.createImageBitmap;
  };
  return rig;
}
const frames = (worker) => worker.posted.filter(p => p.message.type === 'frame');
const result = (extra = {}) => ({ type: 'result', hands: [], poses: [], ms: 20, width: 640, height: 360, timestamp: 1000, ...extra });

test('Tracking: start loads the worker, keeps camera aspect, and posts a transferable frame', async () => {
  const r = rig();
  try {
    await r.tracking.start();
    assert.equal(r.tracking.active, true);
    assert.ok(r.statuses.includes('Kamera aktivt'));
    const worker = r.workers[0];
    assert.deepEqual(worker.posted[0].message, { type: 'init', maxHands: 2 });
    await r.tracking.capture();
    const [frame] = frames(worker);
    assert.ok(frame, 'a frame was posted');
    assert.deepEqual([r.bitmaps[0].options.resizeWidth, r.bitmaps[0].options.resizeHeight], [640, 360], '16:9 camera is not squashed to 4:3');
    assert.equal(frame.transfer[0], frame.message.bitmap);
    assert.equal(typeof frame.message.timestamp, 'number');
  } finally { r.restore(); }
});

test('Tracking: only one frame is ever in flight, so there is no backlog', async () => {
  const r = rig();
  try {
    await r.tracking.start();
    const worker = r.workers[0];
    await Promise.all([r.tracking.capture(), r.tracking.capture(), r.tracking.capture()]);
    r.video.currentTime = .2; await r.tracking.capture();
    r.video.currentTime = .3; await wait(60); // polling timer fires while the worker is still busy
    assert.equal(frames(worker).length, 1);
    r.video.currentTime = .4;
    worker.emit(result()); // answer frees the worker and immediately feeds the next frame
    await wait(10);
    assert.equal(frames(worker).length, 2);
  } finally { r.restore(); }
});

test('Tracking: results carry bursts, ids, aspect, hz and latency; concurrent hand bursts are delivered', async () => {
  const r = rig();
  try {
    await r.tracking.start();
    const worker = r.workers[0];
    const a = 640 / 360, xs = [.25, .75];
    const seq = [...repeat(xs.map(x => closed({ x, aspect: a })), 3), ...repeat(xs.map(x => hand({ x, aspect: a })), 3)];
    seq.forEach((hands, i) => worker.emit(result({ hands, timestamp: 1000 + i * STEP })));
    const bursts = r.results.flatMap(x => x.bursts);
    assert.equal(r.results.length, 6);
    assert.equal(bursts.length, 2);
    const last = r.results.at(-1);
    assert.equal(last.type, 'result');
    assert.deepEqual(last.handIds.length, 2);
    assert.ok(Math.abs(last.aspect - 16 / 9) < 1e-9);
    for (const key of ['hands', 'poses', 'bursts', 'hz', 'ms', 'timestamp']) assert.ok(key in last, key);
    assert.ok(Number.isFinite(last.latency));
  } finally { r.restore(); }
});

test('Tracking: a throwing onResult consumer does not stop tracking', async () => {
  const r = rig();
  const original = console.error; console.error = () => {};
  try {
    r.tracking.onResult = () => { throw new Error('consumer bug'); };
    await r.tracking.start();
    r.workers[0].emit(result());
    assert.equal(r.tracking.active, true);
  } finally { console.error = original; r.restore(); }
});

test('Tracking: stop() during model loading cancels start and releases camera and worker', async () => {
  const r = rig({ autoReady: false });
  try {
    const started = r.tracking.start();
    await wait(10);
    assert.equal(r.workers.length, 1);
    r.tracking.stop();
    await assert.rejects(started, { name: 'AbortError' });
    assert.equal(r.workers[0].terminated, true);
    assert.equal(r.track.stopped, true);
    assert.equal(r.video.srcObject, null);
    assert.equal(r.tracking.active, false);
  } finally { r.restore(); }
});

test('Tracking: stop() while the camera permission is pending releases the late stream', async () => {
  let grant;
  const r = rig({ userMedia: () => new Promise(resolve => { grant = resolve; }) });
  try {
    const started = r.tracking.start();
    r.tracking.stop();
    grant(r.stream);
    await assert.rejects(started, { name: 'AbortError' });
    assert.equal(r.track.stopped, true);
    assert.equal(r.workers.length, 0);
    assert.equal(r.tracking.active, false);
  } finally { r.restore(); }
});

test('Tracking: a cancelled start does not tear down a newer session', async () => {
  const r = rig({ autoReady: false });
  try {
    const first = r.tracking.start();
    await wait(10);
    r.tracking.stop();
    await assert.rejects(first, { name: 'AbortError' });
    const second = r.tracking.start();
    await wait(10);
    r.workers[1].onmessage({ data: { type: 'ready' } });
    await second;
    assert.equal(r.tracking.active, true);
    assert.equal(r.workers[1].terminated, false);
  } finally { r.restore(); }
});

test('Tracking: start() is idempotent while starting and while active', async () => {
  const r = rig();
  try {
    const a = r.tracking.start(), b = r.tracking.start();
    assert.equal(a, b);
    await a;
    await r.tracking.start();
    assert.equal(r.workers.length, 1);
  } finally { r.restore(); }
});

test('Tracking: model/worker init failure rejects start and cleans up', async () => {
  const r = rig({ autoReady: false });
  try {
    const started = r.tracking.start();
    await wait(10);
    r.workers[0].emit({ type: 'error', message: 'Kunne ikke laste sporingsmodellene: 404', fatal: true });
    await assert.rejects(started, /404/);
    assert.equal(r.workers[0].terminated, true);
    assert.equal(r.track.stopped, true);
    assert.equal(r.tracking.active, false);
  } finally { r.restore(); }
});

test('Tracking: fatal worker error stops tracking with a "Sporing stoppet" status', async () => {
  const r = rig();
  try {
    await r.tracking.start();
    r.workers[0].emit({ type: 'error', message: 'wasm abort', fatal: true });
    assert.equal(r.tracking.active, false);
    assert.equal(r.workers[0].terminated, true);
    assert.equal(r.track.stopped, true);
    assert.match(r.statuses.at(-1), /^Sporing stoppet: wasm abort/);
  } finally { r.restore(); }
});

test('Tracking: sporadic frame errors are tolerated, a run of them is not', async () => {
  const r = rig();
  try {
    await r.tracking.start();
    const worker = r.workers[0];
    for (let i = 0; i < 4; i++) worker.emit({ type: 'error', message: 'glitch', fatal: false });
    assert.equal(r.tracking.active, true);
    worker.emit(result()); // a good frame resets the counter
    for (let i = 0; i < 4; i++) worker.emit({ type: 'error', message: 'glitch', fatal: false });
    assert.equal(r.tracking.active, true);
    worker.emit({ type: 'error', message: 'glitch', fatal: false });
    assert.equal(r.tracking.active, false);
    assert.match(r.statuses.at(-1), /^Sporing stoppet/);
  } finally { r.restore(); }
});

test('Tracking: unplugging the camera stops tracking with a status', async () => {
  const r = rig();
  try {
    await r.tracking.start();
    r.track.onended();
    assert.equal(r.tracking.active, false);
    assert.match(r.statuses.at(-1), /^Sporing stoppet: kameraet/);
  } finally { r.restore(); }
});

test('Tracking: a frame bitmap that finishes after stop() is closed, not posted', async () => {
  const r = rig();
  try {
    await r.tracking.start();
    const worker = r.workers[0];
    const pending = r.tracking.capture();
    r.tracking.stop();
    await pending;
    assert.equal(frames(worker).length, 0);
    assert.equal(r.bitmaps[0].closed, true);
  } finally { r.restore(); }
});

test('Tracking: stop() resets gesture state, hz and flags', async () => {
  const r = rig();
  try {
    await r.tracking.start();
    const worker = r.workers[0];
    for (let i = 0; i < 3; i++) worker.emit(result({ hands: [closed()], timestamp: 1000 + i * STEP }));
    assert.equal(r.tracking.gestures.tracks.length, 1);
    r.tracking.stop();
    assert.equal(r.tracking.gestures.tracks.length, 0);
    assert.equal(r.tracking.hz, 0);
    assert.equal(r.tracking.active, false);
    assert.equal(r.tracking.ready, false);
    worker.emit(result()); // late message from the terminated worker is ignored
    assert.equal(r.results.length, 3);
  } finally { r.restore(); }
});
test('Tracking: uses decoded camera frames, never reprocesses duplicate video timestamps, cancels callback on stop',async()=>{
 const r=rig();let callback,cancelled=false;
 r.video.requestVideoFrameCallback=fn=>{callback=fn;return 7;};r.video.cancelVideoFrameCallback=id=>{cancelled=id===7;};
 try{
  await r.tracking.start();await r.tracking.capture();assert.equal(frames(r.workers[0]).length,0);
  callback(100,{presentedFrames:1,mediaTime:.1});await wait(1);assert.equal(frames(r.workers[0]).length,1);
  r.video.currentTime=.15;r.workers[0].emit(result({timestamp:100}));await r.tracking.capture();assert.equal(frames(r.workers[0]).length,1);
  callback(116,{presentedFrames:2,mediaTime:.116});await wait(1);assert.equal(frames(r.workers[0]).length,2);
  r.tracking.stop();assert.equal(cancelled,true);
 }finally{r.restore();}
});

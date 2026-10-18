// Pure tracking logic (no DOM, no MediaPipe): landmark sanity filters, hand
// openness, finger counting, and a closed-to-open burst detector. Shared by the main thread
// (GestureTracker) and the worker bundle (cleanHands/cleanPoses), and unit tested in Node.
//
// Landmark x/y are normalized to the full camera frame, so on a non-square frame
// they are anisotropic. Every distance below multiplies x (and z, which MediaPipe
// scales like x) by `aspect = width/height` to measure in isotropic units.

const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.z === undefined || Number.isFinite(p.z));
export const validHand = points => Array.isArray(points) && points.length >= 21 && points.slice(0, 21).every(finite);

// Tips of the long fingers: index, middle, ring, pinky. The thumb is deliberately
// excluded from counting; its tip is used separately to detect a pinch.
export const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_GESTURES = ['fist', 'point', 'vortex', 'none', 'open'];

// Extended state of [index, middle, ring, pinky], or null for incomplete/non-finite
// landmarks. A finger is extended when its tip is clearly farther from the wrist than
// its PIP joint and well away from it. Only wrist distances are compared, so the result
// does not depend on hand rotation or mirroring.
export function extendedFingers(points, aspect = 1) {
  if (!validHand(points)) return null;
  const dist = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y, ((a.z || 0) - (b.z || 0)) * aspect);
  const palm = Math.max(dist(points[0], points[9]), .001);
  return FINGER_TIPS.map(i => dist(points[i], points[0]) > dist(points[i - 2], points[0]) * 1.28 && dist(points[i], points[i - 2]) > palm * .32);
}

export function openness(points, aspect = 1) {
  const fingers = extendedFingers(points, aspect);
  return fingers ? fingers.filter(Boolean).length / 4 : 0;
}

// Pinch wins over finger counts: the other three fingers may be raised or curled.
// Require the index tip beyond the knuckle region so a tucked thumb in a fist
// does not become Wand. Distances scale with the palm and camera aspect.
export function fingerGesture(points, aspect = 1) {
  const fingers = extendedFingers(points, aspect);
  if (!fingers) return null;
  const tips = FINGER_TIPS.filter((_, k) => fingers[k]);
  const dist = (a, b) => Math.hypot((a.x-b.x)*aspect, a.y-b.y, ((a.z||0)-(b.z||0))*aspect);
  const palm = Math.max(dist(points[0], points[9]), .001);
  const pinch = dist(points[4], points[8]) < palm*.28 && dist(points[8], points[0]) > palm*1.1;
  const gesture = pinch ? 'wand' : tips.length===1 && tips[0]!==8 ? 'none' : FINGER_GESTURES[tips.length];
  return { count: tips.length, tips, gesture };
}

// Drops malformed or implausible hands, strips them to plain {x,y,z} (MediaPipe's hand
// `visibility` is not a confidence and would hide the skeleton in a `visibility ?? 1`
// check), and removes duplicate detections of one hand, keeping the higher score.
// Returns {hands, scores} aligned by index.
export function cleanHands(hands, scores = [], aspect = 1) {
  const kept = [];
  (hands || []).forEach((points, index) => {
    if (!Array.isArray(points) || points.length < 21 || !points.slice(0, 21).every(finite)) return;
    const plain = points.slice(0, 21).map(p => ({ x: p.x, y: p.y, z: Number.isFinite(p.z) ? p.z : 0 }));
    const palm = Math.hypot((plain[0].x - plain[9].x) * aspect, plain[0].y - plain[9].y);
    if (palm < .012 || palm > 1.2) return;
    kept.push({ points: plain, index, score: Number.isFinite(scores[index]) ? scores[index] : 0, palm });
  });
  const unique = [];
  for (const hand of [...kept].sort((a, b) => b.score - a.score)) {
    const twin = unique.some(other => {
      const limit = Math.max(hand.palm, other.palm) * .45;
      return [0, 9].every(i => Math.hypot((hand.points[i].x - other.points[i].x) * aspect, hand.points[i].y - other.points[i].y) < limit);
    });
    if (!twin) unique.push(hand);
  }
  // Restore detection order so the result stays stable when scores tie.
  unique.sort((a, b) => a.index - b.index);
  return { hands: unique.map(h => h.points), scores: unique.map(h => h.score) };
}

// A pose needs a few clearly visible joints; the model can emit near-empty skeletons.
export function cleanPoses(poses) {
  return (poses || []).filter(points => Array.isArray(points) && points.length >= 33 && points.every(finite)
    && points.filter(p => (p.visibility ?? 1) >= .5).length >= 3)
    .map(points => points.map(p => ({ x: p.x, y: p.y, z: Number.isFinite(p.z) ? p.z : 0, visibility: p.visibility ?? 1 })));
}

// Pose inference is the slow stage. When the whole frame gets expensive the worker runs
// it every other frame so hands (the burst gesture) keep the higher rate. Hysteresis
// keeps the stride from flapping around the threshold.
export function nextPoseStride(stride, averageMs, slowMs = 65, fastMs = 40) {
  if (stride < 2 && averageMs > slowMs) return 2;
  if (stride > 1 && averageMs < fastMs) return 1;
  return stride;
}

// Detection order is not a stable person/hand identity. Associate nearby wrists
// between frames (globally nearest pairs first), expire lost tracks, and require a
// closed-to-open transition. Identity is positional only: it does not survive long
// loss or two hands crossing at the same spot.
// Only a closed fist arms the palm burst. Pinching or holding a partial pose
// disarms it, so releasing a pinch into an open palm cannot create a burst.
const DEFAULTS = {
  closedMax: .25, openMin: 1, closedFrames: 2, openFrames: 2,
  partialHold: 180,     // ms of a steady one-to-three-finger count that disarms a fist
  cooldown: 500,        // ms between bursts of one track
  expire: 600,          // ms a track survives without a matching detection
  gapReset: 250,        // ms of loss after which the consecutive-frame counters restart
  armTimeout: 1500,     // ms a fist stays "armed" after it was last seen closed
  gate: .12, gateGrowth: .0004, gateMax: .35, // match radius (height units) + growth per ms unseen
  suppressDistance: .12, suppressTime: 350,   // identity churn must not double-fire one spot
};

export class GestureTracker {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.reset();
  }
  reset() { this.lastUpdate=null;this.interval=0;this.tracks = []; this.nextId = 1; this.recent = []; this.ids = []; }
  // `ids` (aligned with the last `hands`) holds each hand's current track id.
  update(hands, time, aspect = 1, cadence = this.interval) {
    const o = this.options;
    if (!Number.isFinite(time)) return [];
    hands = (hands || []).filter(points => points && points.length >= 21 && finite(points[0]));
    // Tracking can supply the inference cadence, including the first slow frame.
    // Otherwise use established cadence rather than interpreting loss as slow input.
    this.tracks = this.tracks.filter(t => time - t.seen < Math.max(o.expire,cadence*3));
    if(this.lastUpdate!==null&&time>this.lastUpdate)this.interval=time-this.lastUpdate;
    this.lastUpdate=time;
    this.recent = this.recent.filter(b => time - b.time < o.suppressTime);

    const pairs = [];
    hands.forEach((points, hi) => this.tracks.forEach((track, ti) => {
      const gate = Math.min(o.gateMax, o.gate + o.gateGrowth * Math.max(0, time - track.seen));
      const d = Math.hypot((points[0].x - track.x) * aspect, points[0].y - track.y);
      if (d < gate) pairs.push([d, hi, ti]);
    }));
    pairs.sort((a, b) => a[0] - b[0]);
    const assigned = new Array(hands.length).fill(null), taken = new Set();
    for (const [, hi, ti] of pairs) {
      if (assigned[hi] || taken.has(ti)) continue;
      assigned[hi] = this.tracks[ti]; taken.add(ti);
    }

    const bursts = [];
    this.ids = hands.map((points, hi) => {
      const wrist = points[0];
      let track = assigned[hi];
      if (!track) {
        track = { id: this.nextId++, x: wrist.x, y: wrist.y, seen: time, closed: 0, open: 0, armed: false, closedAt: -Infinity, last: -Infinity, partial: 0, partialSince: null };
        this.tracks.push(track);
      } else if (time - track.seen > o.gapReset) { track.closed = 0; track.open = 0; track.partialSince = null; track.armed = false; }
      track.x = wrist.x; track.y = wrist.y; track.seen = time;

      // Unusable landmarks keep the identity but count as neither closed nor open.
      const shape = fingerGesture(points, aspect), count = shape?.count ?? NaN;
      track.closed = shape?.gesture === 'fist' && count / 4 <= o.closedMax ? track.closed + 1 : 0;
      track.open = shape?.gesture === 'open' && count / 4 >= o.openMin ? track.open + 1 : 0;
      const partial = count > 0 && count < 4;
      if (!partial || count !== track.partial || track.partialSince === null) track.partialSince = partial ? time : null;
      track.partial = count;
      if (shape?.gesture === 'wand') track.armed = false;
      if (track.closed >= o.closedFrames) { track.armed = true; track.closedAt = time; }
      if (track.armed && time - track.closedAt > o.armTimeout) track.armed = false;
      if (track.armed && partial && time - track.partialSince >= o.partialHold) track.armed = false;
      if (track.armed && track.open >= o.openFrames) {
        track.armed = false; // consumed, even when suppressed: the user must close the hand again
        const p = points[9];
        // Only bursts from earlier frames count: simultaneous hands must all fire.
        const duplicate = this.recent.some(b => b.time < time && Math.hypot((b.x - p.x) * aspect, b.y - p.y) < o.suppressDistance);
        if (time - track.last >= o.cooldown && !duplicate) {
          track.last = time;
          this.recent.push({ x: p.x, y: p.y, time });
          bursts.push({ x: p.x, y: p.y, z: p.z || 0, id: track.id });
        }
      }
      return track.id;
    });
    return bursts;
  }
}

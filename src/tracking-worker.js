import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { cleanHands } from './gestures.js';
// Classic worker with GPU inference and an explicit CPU fallback. Paths resolve against the worker URL so the app
// works under any base path; wasm and models are served locally from /wasm and /models.
let hands, ready = false, initializing = false;
let lastTimestamp = 0, backend = 'CPU';
const asset = path => new URL(path, self.location.href).href;
const describe = error => (error && error.message) || String(error);
const fail = (message, fatal) => self.postMessage({ type: 'error', message, fatal });

async function init(options = {}) {
  if (ready || initializing) return;
  initializing = true;
  try {
    const files = await FilesetResolver.forVisionTasks(asset('wasm'));
    const create = delegate => HandLandmarker.createFromOptions(files, {
      baseOptions: { delegate, modelAssetPath: asset('models/hand_landmarker.task') },
      ...(delegate === 'GPU' ? {canvas: new OffscreenCanvas(1, 1)} : {}),
      runningMode: 'VIDEO', numHands: [2, 4, 8].includes(options.maxHands) ? options.maxHands : 2,
      minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5,
    });
    try { hands = await create('GPU'); backend = 'GPU'; }
    catch { hands = await create('CPU'); backend = 'CPU'; }
    ready = true;
    self.postMessage({ type: 'ready', backend });
  } catch (error) {
    hands?.close(); hands = undefined;
    fail(`Kunne ikke laste sporingsmodellene: ${describe(error)}`, true);
  } finally { initializing = false; }
}

function frame({ bitmap, timestamp }) {
  try {
    if (!ready) return; // a frame that raced initialisation is dropped, never queued
    const width = bitmap.width, height = bitmap.height, start = performance.now();
    // VIDEO mode requires strictly increasing integer-millisecond timestamps.
    lastTimestamp = Math.max(Math.floor(timestamp), lastTimestamp + 1);
    const handResult = hands.detectForVideo(bitmap, lastTimestamp);
    const handMs = performance.now() - start;
    const ms = performance.now() - start;
    const scores = (handResult.handedness || []).map(categories => categories[0]?.score);
    const cleaned = cleanHands(handResult.landmarks, scores, width / height);
    self.postMessage({
      type: 'result', hands: cleaned.hands, handScores: cleaned.scores, poses: [],
      poseFresh: false, poseStride: 0, backend, handMs, ms, width, height, timestamp,
    });
  } catch (error) { fail(describe(error), false); }
  finally { bitmap.close(); }
}

self.onmessage = ({ data }) => {
  if (data.type === 'init') init(data);
  else if (data.type === 'frame') frame(data);
};
self.addEventListener('unhandledrejection', event => fail(describe(event.reason), true));

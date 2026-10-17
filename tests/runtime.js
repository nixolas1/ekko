// EKKO runtime verification harness. Served by Vite at /tests/runtime.html; not part of the app bundle.
// Everything reported here is what the browser actually returned. Frame intervals are requestAnimationFrame
// timestamp deltas (display-paced, not GPU execution time) and the worker check uses a synthetic blank frame.
// The pure helpers are exported so tests/quality.test.mjs can unit-test them in Node; the browser parts only run
// when a document exists.
export const HARNESS_VERSION = 1;
export const COUNTS = [32768, 131072, 262144];
export const PALETTES = [0, 1, 2, 3, 4, 5, 6];
export const MAX_PARTICLES = 3145728; // ParticleEngine's storage buffer capacity; the per-particle stride is derived from buffer.size / this
export const NOTES = [
  'Frame intervals are requestAnimationFrame timestamp deltas. They are paced by the display refresh rate and are not GPU execution time.',
  'jsEncodeSubmitMs is CPU time spent inside ParticleEngine.frame (JS encode + submit). It is not GPU time.',
  'queueDrainAfterLoopMs is how long queue.onSubmittedWorkDone took after the last frame was submitted (GPU backlog indicator, not per-frame GPU time).',
  'The worker check uses one synthetic blank ImageBitmap. A blank frame skips landmark stages, so its timing is not live camera performance.',
  'No performance threshold is applied unless minFps is passed; otherwise performance is reported, not judged.',
  'Resource audit only sees main-thread resource timing; fetches made inside the worker (wasm, models) are not visible to it.',
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = (value, digits = 2) => (typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
const errorText = error => error?.message ?? String(error);

export function withTimeout(promise, ms, label) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// Linear-interpolated percentile over an ascending array. Null for empty input, never a made-up number.
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = (sorted.length - 1) * p / 100, lo = Math.floor(rank), hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export function summarizeIntervals(intervals, referenceMs = null) {
  const samples = intervals.length;
  if (!samples) return { samples: 0, meanMs: null, minMs: null, p50Ms: null, p90Ms: null, p95Ms: null, p99Ms: null, maxMs: null, stdDevMs: null, fpsMean: null, fpsFromP99Interval: null, slowFrames: null, slowFrameThresholdMs: null };
  const sorted = [...intervals].sort((a, b) => a - b);
  const mean = intervals.reduce((a, b) => a + b, 0) / samples;
  const stdDev = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / samples);
  const p50 = percentile(sorted, 50), p99 = percentile(sorted, 99);
  const threshold = (referenceMs ?? p50) * 1.5;
  return {
    samples, meanMs: round(mean), minMs: round(sorted[0]), p50Ms: round(p50), p90Ms: round(percentile(sorted, 90)), p95Ms: round(percentile(sorted, 95)), p99Ms: round(p99), maxMs: round(sorted[samples - 1]), stdDevMs: round(stdDev),
    fpsMean: round(1000 / mean, 1), fpsFromP99Interval: round(1000 / p99, 1),
    slowFrames: intervals.filter(v => v > threshold).length, slowFrameThresholdMs: round(threshold),
  };
}

// Pure particle-buffer analysis. Each particle is `stride` floats; the first three vec4s are position (xyz, excitement),
// velocity (xyz, seed) and state (..., w = initialised flag), as in common-shader.wgsl.
export function analyzeParticles(f32, count, stride = 16) {
  let nonFinite = 0, uninitialized = 0, escaped = 0, maxAbs = 0, speed = 0;
  const cells = new Set();
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    let bad = false;
    for (let k = 0; k < stride; k++) if (!Number.isFinite(f32[o + k])) { bad = true; break; }
    if (bad) { nonFinite++; continue; }
    if (f32[o + 11] !== 1) uninitialized++;
    const x = f32[o], y = f32[o + 1], z = f32[o + 2];
    const extent = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
    maxAbs = Math.max(maxAbs, extent);
    if (extent > 8) escaped++;
    speed += Math.hypot(f32[o + 4], f32[o + 5], f32[o + 6]);
    cells.add(Math.min(7, Math.max(0, Math.floor((x + 2) / 0.5))) * 8 + Math.min(7, Math.max(0, Math.floor((y + 1.5) / 0.375))));
  }
  const finite = count - nonFinite;
  return { count, nonFinite, uninitialized, escapedBeyond8: escaped, maxAbsPosition: round(maxAbs, 3), meanSpeed: finite ? round(speed / finite, 4) : null, occupiedCellsOf64: cells.size };
}

// Verdict for one particle/palette case. Real errors always win; a hidden tab invalidates (blocks) rather than passes.
export function caseVerdict({ errors, run, summary, readback, minFps }) {
  if (errors.length) return { status: 'fail', reason: `${errors.length} GPU/engine error(s)` };
  if (run.exception) return { status: 'fail', reason: `exception in frame loop: ${run.exception}` };
  if (readback?.performed && (readback.nonFinite || readback.uninitialized)) return { status: 'fail', reason: `particle readback: ${readback.nonFinite} non-finite, ${readback.uninitialized} uninitialised particles` };
  if (run.hiddenDuring || run.reason === 'hidden') return { status: 'blocked', reason: 'tab was hidden during the run; requestAnimationFrame is throttled so timing is invalid' };
  if (run.reason !== 'complete') return { status: 'fail', reason: `frame loop ended early (${run.reason}) after ${summary.samples} measured intervals` };
  if (minFps != null && !(summary.fpsMean >= minFps)) return { status: 'fail', reason: `fpsMean ${summary.fpsMean} below requested minFps ${minFps}` };
  return { status: 'pass', reason: null };
}

export function overallVerdict(sections) {
  const statuses = sections.map(s => s.status);
  if (!statuses.length) return 'not-run';
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('unavailable')) return 'unavailable';
  if (statuses.includes('blocked') || statuses.includes('skipped') || statuses.includes('running')) return 'incomplete';
  return statuses.every(s => s === 'pass') ? 'pass' : 'incomplete';
}

// requestAnimationFrame measurement loop. Warm-up frames are submitted but not measured. Bounded by timeoutMs
// (rAF never fires in a hidden tab, so the timer is what ends a blocked run).
function rafRun({ warmup, measure, timeoutMs, onFrame }) {
  return new Promise(resolve => {
    const intervals = [], cpu = [];
    let previous = null, index = 0, handle = 0, done = false, hiddenDuring = document.hidden, exception = null;
    const onVisibility = () => { if (document.hidden) hiddenDuring = true; };
    document.addEventListener('visibilitychange', onVisibility);
    const finish = reason => {
      if (done) return;
      done = true; clearTimeout(timer); cancelAnimationFrame(handle); document.removeEventListener('visibilitychange', onVisibility);
      resolve({ reason, intervals, cpu, frames: index, hiddenDuring, exception });
    };
    const timer = setTimeout(() => finish(document.hidden || hiddenDuring ? 'hidden' : 'timeout'), timeoutMs);
    const tick = ts => {
      if (done) return;
      handle = requestAnimationFrame(tick);
      if (previous !== null && index > warmup) intervals.push(ts - previous);
      if (intervals.length >= measure) { finish('complete'); return; }
      const dt = previous === null ? 1 / 60 : Math.min((ts - previous) / 1000, .1);
      try { const ms = onFrame?.(ts, dt, index - warmup); if (index >= warmup && typeof ms === 'number') cpu.push(ms); }
      catch (error) { exception = errorText(error); finish('exception'); return; }
      previous = ts; index++;
    };
    handle = requestAnimationFrame(tick);
  });
}

const infoToObject = info => (info ? { vendor: info.vendor ?? null, architecture: info.architecture ?? null, device: info.device ?? null, description: info.description ?? null, isFallbackAdapter: info.isFallbackAdapter ?? null } : null);

async function describeAdapter() {
  if (!navigator.gpu) return { available: false, reason: `navigator.gpu is undefined (secureContext=${globalThis.isSecureContext}); WebGPU is unavailable in this browser/context` };
  let adapter;
  try { adapter = await withTimeout(navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), 10000, 'requestAdapter'); }
  catch (error) { return { available: false, reason: `requestAdapter failed: ${errorText(error)}` }; }
  if (!adapter) return { available: false, reason: 'navigator.gpu.requestAdapter returned null (no WebGPU adapter; hardware acceleration may be off)' };
  let info = adapter.info ?? null;
  if (!info && adapter.requestAdapterInfo) { try { info = await adapter.requestAdapterInfo(); } catch { info = null; } }
  const limits = {};
  for (const key of ['maxStorageBufferBindingSize', 'maxBufferSize', 'maxUniformBufferBindingSize', 'maxComputeWorkgroupsPerDimension', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX']) limits[key] = adapter.limits?.[key] ?? null;
  const fallback = adapter.isFallbackAdapter ?? info?.isFallbackAdapter ?? null;
  return { available: true, info: infoToObject(info), isFallbackAdapter: fallback, features: [...(adapter.features ?? [])].sort(), limits, preferredCanvasFormat: navigator.gpu.getPreferredCanvasFormat?.() ?? null };
}

const makeForces = (n, t) => Array.from({ length: n }, (_, i) => [Math.cos(t * .3 + i * .7) * .8, Math.sin(t * .4 + i * 1.3) * .6, i < 4 ? 3 : 1.2, i < 4 ? .45 : .35]);

// Push validation/out-of-memory/internal scopes, run fn, pop. Returns the pop promises so callers can issue this
// inside a requestAnimationFrame callback and await afterwards.
function scopedCall(device, fn) {
  device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory'); device.pushErrorScope('internal');
  let thrown = null;
  try { fn(); } catch (error) { thrown = errorText(error); }
  const internal = device.popErrorScope(), memory = device.popErrorScope(), validation = device.popErrorScope();
  return { thrown, pending: Promise.all([validation, memory, internal]) };
}

async function validationFrames(engine, audio, forceCount, frames) {
  const found = [];
  for (let i = 0; i < frames; i++) {
    const call = await new Promise(resolve => requestAnimationFrame(ts => resolve(scopedCall(engine.device, () => engine.frame(1 / 60, audio.sample(ts / 1000), makeForces(forceCount, ts / 1000), false)))));
    if (call.thrown) found.push({ source: 'frame() exception', message: call.thrown });
    const [validation, memory, internal] = await call.pending;
    if (validation) found.push({ source: 'GPUValidationError', message: validation.message });
    if (memory) found.push({ source: 'GPUOutOfMemoryError', message: memory.message });
    if (internal) found.push({ source: 'GPUInternalError', message: internal.message });
    await engine.device.queue.onSubmittedWorkDone();
  }
  return { frames, completedAwaitedOnGpu: true, errors: found };
}

// Needs COPY_SRC on the particle buffer; the engine does not currently request it, so this reports "not performed"
// instead of pretending. Only runs outside the measured loop.
async function readParticles(engine, count) {
  const usage = engine.buffer?.usage ?? 0;
  if (!(usage & GPUBufferUsage.COPY_SRC)) return { performed: false, reason: 'engine.buffer was created without COPY_SRC usage, so particle state cannot be read back (engine change required)' };
  const device = engine.device, strideBytes = engine.buffer.size / engine.capacity, bytes = count * strideBytes;
  if (!Number.isInteger(strideBytes) || strideBytes % 16) return { performed: false, reason: `cannot derive particle stride from buffer size ${engine.buffer.size}` };
  const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(engine.buffer, 0, staging, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await withTimeout(staging.mapAsync(GPUMapMode.READ), 15000, 'particle readback mapAsync');
    const data = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    return { performed: true, strideBytes, ...analyzeParticles(data, count, strideBytes / 4) };
  } catch (error) { return { performed: false, reason: `readback failed: ${errorText(error)}` }; }
  finally { staging.destroy(); }
}

async function measureBaseline(args) {
  const run = await rafRun({ warmup: 5, measure: args.baselineFrames, timeoutMs: args.baselineFrames * 200 + 3000 });
  if (run.reason !== 'complete' || run.hiddenDuring) return { status: run.hiddenDuring ? 'blocked' : 'fail', reason: `idle rAF baseline ended early (${run.reason})`, ...summarizeIntervals(run.intervals) };
  const summary = summarizeIntervals(run.intervals);
  return { status: 'pass', note: 'idle requestAnimationFrame cadence with no GPU work; approximates the display refresh interval', medianMs: summary.p50Ms, estimatedRefreshHz: round(1000 / summary.p50Ms, 1), ...summary };
}

async function runCase({ engine, audio, errors, count, palette, effect, forceCount, stress, args, baseline, firstOfEngine }) {
  const first = errors.length;
  engine.palette = palette;
  if (effect != null) engine.effect = effect;
  const result = { count, palette, effect: effect ?? null, persistent:engine.persistent, stress, forceCount, status: 'running' };
  const validation = await validationFrames(engine, audio, forceCount, 3);
  result.validation = validation;
  if (firstOfEngine) result.initialSeedReadback = await readParticles(engine, count);
  const burstFrames = new Set([30, 90]);
  const run = await rafRun({
    warmup: args.warmup, measure: args.frames, timeoutMs: (args.warmup + args.frames) * 100 + 5000,
    onFrame: (ts, dt, measuredIndex) => {
      if (burstFrames.has(measuredIndex)) engine.explode(.3 * engine.canvas.width / engine.canvas.height, .1);
      const t0 = performance.now();
      engine.frame(dt, audio.sample(ts / 1000), makeForces(forceCount, ts / 1000), false);
      return performance.now() - t0;
    },
  });
  const drainStart = performance.now();
  try { await withTimeout(engine.device.queue.onSubmittedWorkDone(), 20000, 'queue drain after loop'); result.queueDrainAfterLoopMs = round(performance.now() - drainStart, 1); }
  catch (error) { errors.push({ source: 'harness', message: errorText(error) }); }
  await sleep(50);
  const summary = summarizeIntervals(run.intervals, baseline?.medianMs ?? null);
  const cpuSorted = [...run.cpu].sort((a, b) => a - b);
  result.frameLoop = { requested: args.frames, warmup: args.warmup, endedBecause: run.reason, framesSubmitted: run.frames, burstsInjected: burstFrames.size, hiddenDuringRun: run.hiddenDuring };
  result.rafIntervals = summary;
  result.likelyDisplayRefreshBound = baseline?.medianMs ? Math.abs(summary.p50Ms - baseline.medianMs) / baseline.medianMs < .15 && summary.p95Ms < baseline.medianMs * 1.5 : null;
  result.jsEncodeSubmitMs = cpuSorted.length ? { meanMs: round(cpuSorted.reduce((a, b) => a + b, 0) / cpuSorted.length, 3), p50Ms: round(percentile(cpuSorted, 50), 3), p95Ms: round(percentile(cpuSorted, 95), 3), maxMs: round(cpuSorted[cpuSorted.length - 1], 3) } : null;
  result.finalReadback = await readParticles(engine, count);
  if (args.raw) result.intervalsMs = run.intervals.map(v => round(v, 2));
  const caseErrors = [...errors.slice(first), ...validation.errors];
  result.errors = caseErrors;
  result.warnings = [];
  for (const [label, readback] of [['initial seed', result.initialSeedReadback], ['final state', result.finalReadback]])
    if (readback?.performed && readback.occupiedCellsOf64 < 4) result.warnings.push(`${label}: particles occupy only ${readback.occupiedCellsOf64} of 64 coarse cells (clumped or sparse); inspect visually`);
  const verdict = caseVerdict({ errors: caseErrors, run, summary, readback: result.finalReadback, minFps: args.minFps });
  result.status = verdict.status; result.reason = verdict.reason;
  return result;
}

// Case plan: every palette with the engine's default effect, then (if the engine exposes `effect`) one palette-0 case
// per additional effect, then an optional 32-force stress case at the largest count.
export function planCases({ palettes, effects = [], defaultEffect = null, count, maxCount, stress }) {
  const plan = palettes.map(palette => ({ palette, effect: defaultEffect, forceCount: 1, stress: false }));
  for (const effect of effects) if (defaultEffect != null && effect !== defaultEffect) plan.push({ palette: palettes[0] ?? 0, effect, forceCount: 1, stress: false });
  if (stress && count === maxCount) plan.push({ palette: palettes[0] ?? 0, effect: defaultEffect, forceCount: 32, stress: true });
  return plan;
}

// Effect values come from the app's own (local) index.html <select id="effect">, so the harness follows the UI.
async function discoverEffects(args) {
  if (args.effects) return args.effects;
  try {
    const response = await withTimeout(fetch('/index.html', { cache: 'no-store' }), 5000, 'fetch /index.html');
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    return [...doc.querySelectorAll('#effect option')].map(o => Number(o.value)).filter(Number.isFinite);
  } catch { return []; }
}

async function runGpuSection(args, hooks) {
  const section = { status: 'running', adapter: null, baseline: null, canvasPixelsPerRun: null, inits: [], cases: [] };
  hooks.update();
  section.adapter = await describeAdapter();
  if (!section.adapter.available) { section.status = 'unavailable'; section.reason = section.adapter.reason; return section; }
  if (section.adapter.isFallbackAdapter) section.warning = 'Adapter reports isFallbackAdapter=true (software rendering). FPS from this run is not representative of GPU hardware.';
  hooks.log('measuring idle rAF baseline');
  section.baseline = await measureBaseline(args); hooks.update();
  const { ParticleEngine } = await import('../src/gpu.js');
  const { AudioInput } = await import('../src/audio.js');
  const audio = new AudioInput();
  const stage = document.getElementById('stage') ?? document.body;
  const effects = await discoverEffects(args);
  section.effectsDiscovered = effects;
  for (const count of args.counts) {
    const canvas = document.createElement('canvas'); canvas.id = `scene-${count}`; stage.append(canvas);
    const engine = new ParticleEngine(canvas); engine.count = count; engine.persistent = Boolean(args.persistent);
    if (args.renderScale != null && 'renderScale' in engine) engine.renderScale = args.renderScale;
    const defaultEffect = typeof engine.effect === 'number' ? engine.effect : null;
    const plan = planCases({ palettes: args.palettes, effects, defaultEffect, count, maxCount: Math.max(...args.counts), stress: args.stress });
    const errors = [], t0 = performance.now(); let tearingDown = false;
    const record = (source, message) => errors.push({ source, message: String(message), atMs: round(performance.now() - t0, 1) });
    engine.onError = message => record('engine.onError', message);
    const init = { count, ok: false, ms: null, error: null };
    section.inits.push(init);
    hooks.log(`init ParticleEngine count=${count}`);
    try {
      const started = performance.now();
      await withTimeout(engine.init(), 30000, 'ParticleEngine.init');
      init.ms = round(performance.now() - started, 1); init.ok = true;
    } catch (error) { init.error = errorText(error); }
    if (!init.ok) {
      section.cases.push({ count, palette: null, status: 'fail', reason: `ParticleEngine.init failed: ${init.error}`, errors: [{ source: 'init', message: init.error }] });
      canvas.remove(); hooks.update(); continue;
    }
    const device = engine.device;
    device.addEventListener('uncapturederror', event => record('device.uncapturederror', event.error?.message));
    device.lost.then(info => { if (!tearingDown) record('device.lost', `${info.reason}: ${info.message}`); });
    init.canvasPixels = [canvas.width, canvas.height]; section.canvasPixelsPerRun = init.canvasPixels;
    init.sceneTargetPixels = engine.sceneSize ?? null; init.renderScale = engine.renderScale ?? null;
    init.deviceAdapterInfo = infoToObject(device.adapterInfo);
    init.particleBufferBytes = engine.buffer?.size ?? null;
    init.particleStrideBytes = init.particleBufferBytes == null ? null : init.particleBufferBytes / MAX_PARTICLES;
    if (count > MAX_PARTICLES) record('harness', `count ${count} exceeds the harness's assumed buffer capacity ${MAX_PARTICLES}`);
    if (init.particleStrideBytes != null && (!Number.isInteger(init.particleStrideBytes) || init.particleStrideBytes % 16)) record('harness', `particle buffer size ${init.particleBufferBytes} is not a multiple of ${MAX_PARTICLES} x 16 B; buffer capacity assumption changed`);
    try { await withTimeout(device.queue.onSubmittedWorkDone(), 20000, 'post-init queue drain'); } catch (error) { record('harness', errorText(error)); }
    if (errors.length) {
      section.cases.push({ count, palette: null, status: 'fail', reason: 'errors during init', errors: [...errors] });
    } else {
      for (const [i, step] of plan.entries()) {
        hooks.log(`count=${count} palette=${step.palette}${step.effect != null ? ` effect=${step.effect}` : ''}${step.stress ? ' (32-force stress)' : ''}: validation + ${args.warmup}+${args.frames} frames`);
        section.cases.push(await runCase({ engine, audio, errors, count, palette: step.palette, effect: step.effect, forceCount: step.forceCount, stress: step.stress, args, baseline: section.baseline.status === 'pass' ? section.baseline : null, firstOfEngine: i === 0 }));
        hooks.update();
      }
    }
    tearingDown = true; engine.onError = null;
    try { const dispose = engine.dispose ?? engine.destroy; if (typeof dispose === 'function') dispose.call(engine); else device.destroy(); } catch (error) { init.teardownError = errorText(error); }
    canvas.remove(); await sleep(50);
  }
  section.status = overallVerdict(section.cases.map(c => ({ status: c.status })));
  if (section.status === 'incomplete') section.reason = 'one or more cases were blocked/skipped (see per-case reason)';
  if (section.baseline.status !== 'pass') section.baselineWarning = section.baseline.reason;
  return section;
}

function openWorker() {
  const worker = new Worker('/tracking-worker.js');
  const next = (ms, label) => withTimeout(new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => resolve(data);
    worker.onerror = event => reject(new Error(event.message || 'worker error event (script failed to load or threw)'));
    worker.onmessageerror = () => reject(new Error('worker messageerror'));
  }), ms, label);
  return { worker, next };
}

async function closeWorker(worker, waitMs) {
  let stray = 0;
  worker.onmessage = () => { stray++; }; worker.onerror = () => {};
  worker.terminate();
  await sleep(waitMs);
  return { terminated: true, strayMessagesAfterTerminate: stray, waitedMs: waitMs };
}

function blankBitmap() {
  const image = new ImageData(640, 480);
  new Uint32Array(image.data.buffer).fill(0xff202020);
  return createImageBitmap(image);
}

async function runWorkerSection(args, hooks) {
  const section = { status: 'running', url: '/tracking-worker.js', syntheticFrame: '640x480 uniform dark grey ImageBitmap (not a live camera)', init: null, frame: null, close: null, warnings: [] };
  hooks.update();
  let opened = null;
  try {
    opened = openWorker();
    hooks.log('worker: init (loads local wasm + models)');
    const started = performance.now(), ready = opened.next(args.workerInitTimeoutMs, 'worker init');
    opened.worker.postMessage({ type: 'init' });
    const message = await ready;
    if (message.type !== 'ready') throw new Error(`worker init failed: ${message.message ?? JSON.stringify(message)}`);
    section.init = { ok: true, ms: round(performance.now() - started, 1), timeoutMs: args.workerInitTimeoutMs };
    hooks.update();
    const bitmap = await blankBitmap();
    const sentAt = performance.now(), result = opened.next(args.workerFrameTimeoutMs, 'worker frame');
    opened.worker.postMessage({ type: 'frame', bitmap, timestamp: sentAt }, [bitmap]);
    const reply = await result;
    if (reply.type === 'error') throw new Error(`worker frame error: ${reply.message}`);
    const shapeOk = reply.type === 'result' && Array.isArray(reply.hands) && Array.isArray(reply.poses) && typeof reply.ms === 'number' && reply.timestamp === sentAt;
    section.frame = {
      ok: shapeOk, roundTripMs: round(performance.now() - sentAt, 1), workerReportedMs: round(reply.ms, 1), workerHandMs: round(reply.handMs, 1) ?? undefined,
      hands: reply.hands?.length ?? null, poses: reply.poses?.length ?? null, reportedFrameSize: reply.width != null ? [reply.width, reply.height] : null,
      poseFresh: reply.poseFresh ?? undefined, poseStride: reply.poseStride ?? undefined, bitmapDetachedAfterTransfer: bitmap.width === 0,
      note: 'synthetic blank frame; lower bound, not camera performance',
    };
    if (section.frame.reportedFrameSize && (section.frame.reportedFrameSize[0] !== 640 || section.frame.reportedFrameSize[1] !== 480)) section.warnings.push(`worker reported frame size ${section.frame.reportedFrameSize.join('x')}, sent 640x480`);
    if (!shapeOk) throw new Error(`worker result had an unexpected shape: ${JSON.stringify(Object.keys(reply))}`);
    if (reply.hands.length || reply.poses.length) section.warnings.push(`blank frame produced ${reply.hands.length} hand(s) and ${reply.poses.length} pose(s); expected none`);
    section.status = 'pass';
  } catch (error) { section.status = 'fail'; section.error = errorText(error); }
  finally { if (opened) section.close = await closeWorker(opened.worker, args.closeWaitMs); }
  if (section.status === 'pass' && section.close.strayMessagesAfterTerminate) { section.status = 'fail'; section.error = 'worker kept posting messages after terminate()'; }
  return section;
}

async function withGpuShadow(stub, fn) {
  const original = Object.getOwnPropertyDescriptor(navigator, 'gpu');
  Object.defineProperty(navigator, 'gpu', { value: stub, configurable: true });
  try { return await fn(); }
  finally { if (original) Object.defineProperty(navigator, 'gpu', original); else delete navigator.gpu; }
}

async function expectInitRejects(ParticleEngine, stub) {
  return withGpuShadow(stub, async () => {
    const engine = new ParticleEngine(document.createElement('canvas'));
    try { await withTimeout(engine.init(), 5000, 'init under simulated failure'); return { ok: false, detail: 'init() resolved although the failure was simulated' }; }
    catch (error) { const message = errorText(error); return { ok: message.length > 0 && !message.includes('timed out'), message }; }
  });
}

// Failure simulations exercise the engine/worker error paths. "pass" means the failure was detected and surfaced,
// never that the underlying subsystem works.
async function runFailureSection(args, hooks) {
  const section = { status: 'running', checks: [] };
  const add = (id, description, status, detail = {}) => { section.checks.push({ id, description, status, ...detail }); hooks.update(); };
  const { ParticleEngine } = await import('../src/gpu.js');

  try {
    const r = await expectInitRejects(ParticleEngine, undefined);
    add('no-webgpu', 'navigator.gpu shadowed to undefined: init() must reject with a user-facing message', r.ok ? 'pass' : 'fail', r);
  } catch (error) { add('no-webgpu', 'navigator.gpu shadowing', 'skipped', { reason: errorText(error) }); }
  try {
    const r = await expectInitRejects(ParticleEngine, { requestAdapter: async () => null, getPreferredCanvasFormat: () => 'bgra8unorm' });
    add('no-adapter', 'requestAdapter() stubbed to null: init() must reject with a user-facing message', r.ok ? 'pass' : 'fail', r);
  } catch (error) { add('no-adapter', 'navigator.gpu stubbing', 'skipped', { reason: errorText(error) }); }

  const adapter = await describeAdapter();
  if (!adapter.available) {
    for (const id of ['device-error-canary', 'real-uncaptured-error', 'synthetic-uncaptured-event', 'device-lost'])
      add(id, 'needs a real WebGPU device', 'unavailable', { reason: adapter.reason });
  } else {
    const canvas = document.createElement('canvas'); (document.getElementById('stage') ?? document.body).append(canvas);
    const engine = new ParticleEngine(canvas); const received = [];
    engine.onError = message => received.push(message);
    let ready = false;
    try { await withTimeout(engine.init(), 30000, 'ParticleEngine.init'); ready = true; } catch (error) { add('engine-init-for-failure-sims', 'init a real engine', 'fail', { message: errorText(error) }); }
    if (ready) {
      const device = engine.device, own = [];
      device.addEventListener('uncapturederror', event => own.push(event.error?.message));
      // Canary: proves the detector used by the GPU section can actually see a validation error.
      device.pushErrorScope('validation');
      device.createBuffer({ size: 16, usage: 0 });
      const canary = await device.popErrorScope();
      add('device-error-canary', 'an invalid createBuffer inside an error scope must be reported (proves the harness can detect validation errors)', canary ? 'pass' : 'fail', { message: canary?.message ?? null });
      // Real uncaptured error: no scope, so it must reach device 'uncapturederror' and therefore engine.onError.
      device.createBuffer({ size: 16, usage: 0 });
      // Flush the wire protocol even though this check submits no rendered frame.
      // Otherwise Chromium may deliver the pending error only at device.destroy(),
      // incorrectly attributing it to the following intentional-loss check.
      await withTimeout(device.queue.onSubmittedWorkDone(), 3000, 'flush validation canary');
      const deadline = performance.now() + 3000;
      while (performance.now() < deadline && !(received.length && own.length)) await sleep(25);
      add('real-uncaptured-error', 'a real unscoped validation error must reach engine.onError (and device uncapturederror)', received.length && own.length ? 'pass' : 'fail', { engineOnError: received.slice(), deviceListener: own.slice() });
      received.length = 0;
      if (typeof GPUUncapturedErrorEvent === 'function' && typeof GPUValidationError === 'function') {
        device.dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror', { error: new GPUValidationError('synthetic harness error') }));
        add('synthetic-uncaptured-event', 'synthetic uncapturederror event (wiring only, not a GPU fault) must reach engine.onError', received.some(m => m.includes('synthetic harness error')) ? 'pass' : 'fail', { engineOnError: received.slice() });
      } else add('synthetic-uncaptured-event', 'GPUUncapturedErrorEvent constructor unavailable', 'skipped', {});
      received.length = 0;
      // An intentional destroy must resolve device.lost with reason "destroyed" and must NOT be shown to the user as
      // a GPU failure (the engine's lost handler ignores it). A genuine loss (reason "unknown") cannot be forced here.
      device.destroy();
      try {
        const info = await withTimeout(device.lost, 3000, 'device.lost');
        await sleep(300);
        add('device-lost', 'device.destroy() resolves device.lost as "destroyed" and stays silent; genuine device loss cannot be provoked from a page', info.reason === 'destroyed' && !received.length ? 'pass' : 'fail', { lostReason: info.reason, engineOnError: received.slice() });
      } catch (error) { add('device-lost', 'device.lost after destroy()', 'fail', { message: errorText(error) }); }
    }
    canvas.remove();
  }

  let opened = null;
  try {
    opened = openWorker();
    const bitmap = await blankBitmap();
    const reply = opened.next(1500, 'uninitialised worker frame');
    opened.worker.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]);
    // Current worker contract: a frame that races initialisation is dropped without a reply. An {type:"error"}
    // reply is also acceptable; a result or a worker crash is not.
    const outcome = await reply.then(message => ({ message }), error => ({ error }));
    if (outcome.error && !/timed out/.test(outcome.error.message)) add('worker-frame-before-init', 'frame to an uninitialised worker must not crash it', 'fail', { message: errorText(outcome.error) });
    else if (outcome.error) add('worker-frame-before-init', 'frame to an uninitialised worker must be dropped or answered with an error, never produce a result', 'pass', { behavior: 'dropped silently (no reply within 1500 ms)' });
    else add('worker-frame-before-init', 'frame to an uninitialised worker must be dropped or answered with an error, never produce a result', outcome.message.type === 'error' ? 'pass' : 'fail', { behavior: `replied ${outcome.message.type}`, message: outcome.message.message ?? null });
  } catch (error) { add('worker-frame-before-init', 'frame before init', 'fail', { message: errorText(error) }); }
  finally { if (opened) await closeWorker(opened.worker, 50); }

  section.status = overallVerdict(section.checks);
  return section;
}

async function runApiSection() {
  const { ParticleEngine } = await import('../src/gpu.js');
  const { AudioInput } = await import('../src/audio.js');
  const { Tracking } = await import('../src/tracking.js');
  const engine = new ParticleEngine(document.createElement('canvas')), sound = new AudioInput(), tracker = new Tracking(document.createElement('video'), () => {}, () => {});
  const missing = [];
  for (const [owner, object, names] of [['ParticleEngine', engine, ['init', 'resize', 'explode', 'frame']], ['AudioInput', sound, ['sample', 'microphone', 'file', 'stop']], ['Tracking', tracker, ['start', 'stop', 'capture']]])
    for (const name of names) if (typeof object[name] !== 'function') missing.push(`${owner}.${name}`);
  for (const key of ['count', 'palette']) if (typeof engine[key] !== 'number') missing.push(`ParticleEngine.${key}`);
  return { status: missing.length ? 'fail' : 'pass', missing, defaults: { engineCount: engine.count, enginePalette: engine.palette, audioMode: sound.mode } };
}

function auditResources() {
  const entries = performance.getEntriesByType('resource'), remote = new Set();
  for (const entry of entries) {
    try { const url = new URL(entry.name, location.href); if (url.protocol.startsWith('http') && url.origin !== location.origin) remote.add(url.origin); } catch { /* ignore non-URL names */ }
  }
  return { status: remote.size ? 'fail' : 'pass', resourcesChecked: entries.length, remoteOrigins: [...remote], scope: 'main-thread resource timing only' };
}

function describeEnvironment() {
  return {
    userAgent: navigator.userAgent, secureContext: globalThis.isSecureContext ?? null, crossOriginIsolated: globalThis.crossOriginIsolated ?? null,
    hasNavigatorGpu: Boolean(navigator.gpu), devicePixelRatio: globalThis.devicePixelRatio ?? null, viewport: [globalThis.innerWidth ?? null, globalThis.innerHeight ?? null],
    visibilityState: document.visibilityState, documentHasFocus: document.hasFocus?.() ?? null, hardwareConcurrency: navigator.hardwareConcurrency ?? null, deviceMemoryGB: navigator.deviceMemory ?? null, url: location.href,
  };
}

export const DEFAULT_ARGS = { frames: 180, warmup: 20, baselineFrames: 60, counts: COUNTS, palettes: PALETTES, stress: true, effects: null, persistent:false, renderScale: null, minFps: null, raw: false, workerInitTimeoutMs: 60000, workerFrameTimeoutMs: 30000, closeWaitMs: 250 };

export async function runVerification(scope = 'all', overrides = {}, hooks = {}) {
  const args = { ...DEFAULT_ARGS, ...overrides };
  const report = { harness: { name: 'ekko-runtime-verification', version: HARNESS_VERSION }, state: 'running', scope, startedAt: new Date().toISOString(), args, environment: null, sections: {}, pageErrors: [], notes: NOTES };
  const emit = () => hooks.onUpdate?.(report);
  const section = { update: emit, log: message => hooks.log?.(message) };
  const onPageError = event => report.pageErrors.push(`${event.type}: ${event.message ?? errorText(event.reason)}`);
  addEventListener('error', onPageError); addEventListener('unhandledrejection', onPageError);
  const run = async (name, fn) => {
    report.sections[name] = { status: 'running' }; emit(); section.log(`section ${name}`);
    try { report.sections[name] = await fn(); } catch (error) { report.sections[name] = { status: 'fail', error: errorText(error), stack: String(error?.stack ?? '').split('\n').slice(0, 4) }; }
    emit();
  };
  try {
    report.environment = describeEnvironment(); emit();
    const wants = name => scope === 'all' || scope === name || (scope === 'gpu' && name === 'api');
    if (wants('api')) await run('api', runApiSection);
    if (wants('gpu')) await run('gpu', () => runGpuSection(args, section));
    if (wants('failure')) await run('failureSimulations', () => runFailureSection(args, section));
    if (wants('worker')) await run('worker', () => runWorkerSection(args, section));
    if (scope === 'all' || scope === 'gpu') await run('resources', async () => auditResources());
  } finally { removeEventListener('error', onPageError); removeEventListener('unhandledrejection', onPageError); }
  if (report.pageErrors.length) report.sections.pageErrors = { status: 'fail', errors: report.pageErrors };
  report.verdict = overallVerdict(Object.values(report.sections));
  report.finishedAt = new Date().toISOString(); report.state = 'done';
  emit();
  return report;
}

function initUI() {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const numeric = (key, fallback) => (params.has(key) && Number.isFinite(Number(params.get(key))) ? Number(params.get(key)) : fallback);
  const list = (key, fallback) => (params.has(key) ? params.get(key).split(',').map(Number).filter(Number.isFinite) : fallback);
  const readArgs = () => ({
    frames: numeric('frames', Number($('opt-frames').value) || DEFAULT_ARGS.frames), warmup: numeric('warmup', Number($('opt-warmup').value) || 0),
    counts: list('counts', COUNTS), palettes: list('palettes', PALETTES), stress: params.has('stress') ? params.get('stress') !== '0' : $('opt-stress').checked,
    effects: params.has('effects') ? list('effects', []) : null, persistent:params.get('persistent')==='1', renderScale: params.has('renderScale') ? numeric('renderScale', null) : null,
    minFps: params.has('minFps') ? numeric('minFps', null) : null, raw: params.get('raw') === '1',
    workerInitTimeoutMs: numeric('workerInitTimeoutMs', DEFAULT_ARGS.workerInitTimeoutMs), workerFrameTimeoutMs: numeric('workerFrameTimeoutMs', DEFAULT_ARGS.workerFrameTimeoutMs),
  });
  const buttons = ['run-all', 'run-gpu', 'run-worker', 'run-failure'].map($);
  let running = false;
  const show = report => {
    $('results').textContent = JSON.stringify(report, null, 2);
    $('results').dataset.state = report.state;
    $('status').textContent = report.state === 'done' ? `done: ${report.verdict}` : `running: ${report.scope}`;
  };
  const log = message => { $('log').textContent += `${new Date().toLocaleTimeString()} ${message}\n`; $('log').scrollTop = $('log').scrollHeight; };
  async function start(scope) {
    if (running) return window.ekkoVerification.promise;
    running = true; buttons.forEach(b => { b.disabled = true; }); $('log').textContent = '';
    window.ekkoVerification.promise = runVerification(scope, readArgs(), { onUpdate: show, log })
      .then(report => { window.ekkoVerification.result = report; return report; })
      .catch(error => { const failed = { state: 'done', verdict: 'fail', scope, harnessError: errorText(error) }; show(failed); window.ekkoVerification.result = failed; return failed; })
      .finally(() => { running = false; buttons.forEach(b => { b.disabled = false; }); });
    return window.ekkoVerification.promise;
  }
  window.ekkoVerification = { run: start, result: null, promise: null, version: HARNESS_VERSION };
  $('run-all').onclick = () => start('all'); $('run-gpu').onclick = () => start('gpu');
  $('run-worker').onclick = () => start('worker'); $('run-failure').onclick = () => start('failure');
  if (params.has('autorun')) start(['gpu', 'worker', 'failure'].includes(params.get('autorun')) ? params.get('autorun') : 'all');
}

if (typeof document !== 'undefined' && document.getElementById('run-all')) initUI();

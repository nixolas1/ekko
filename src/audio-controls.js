// Pure signal-processing and error-mapping helpers for AudioInput.
// Nothing here touches the DOM or owns browser objects, so it runs unchanged under node --test.

export const clamp01 = x => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
export const sanitizeGain = (g, fallback = 1.2) => (Number.isFinite(g) ? Math.min(8, Math.max(0, g)) : fallback);

// Analyser dB window. getByteFrequencyData maps minDb..maxDb linearly onto 0..255.
export const ANALYSER = { fftSize: 1024, smoothing: 0.6, minDb: -85, maxDb: -15 };
// Normalised level (0..1 of the dB window, ~ -67 dB) below which input counts as room/electrical noise.
export const NOISE_FLOOR = 0.22;
// Music spectra fall ~4.5 dB/octave, so mid/high bands are lifted slightly to read comparably to bass.
export const BAND_TILT = [0, 0.04, 0.1, 0.02];
export const BANDS_HZ = [[30, 180], [180, 2000], [2000, 10000], [30, 10000]];

export function makePowerTable(minDb = ANALYSER.minDb, maxDb = ANALYSER.maxDb) {
  const table = new Float64Array(256);
  for (let i = 0; i < 256; i++) table[i] = Math.pow(10, (minDb + (i / 255) * (maxDb - minDb)) / 10);
  return table;
}
const DEFAULT_TABLE = makePowerTable();

// Half-open bin range [lo, hi) of bins whose centre frequency lies in lowHz..highHz (adjacent bands never
// share a bin), at least one bin wide, DC bin excluded.
export function bandRange(lowHz, highHz, sampleRate, fftSize, binCount = fftSize / 2) {
  const hz = (Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000) / fftSize;
  const lo = Math.min(binCount - 1, Math.max(1, Math.ceil(lowHz / hz)));
  const hi = Math.min(binCount, Math.max(lo + 1, Math.ceil(highHz / hz)));
  return [lo, hi];
}

// Mean *power* over the bins, returned as a 0..1 position in the dB window.
// A single strong bin (a kick's fundamental) therefore dominates a band of quiet bins,
// which a mean of dB-scaled bytes would bury.
export function bandLevel(bins, lo, hi, table = DEFAULT_TABLE, minDb = ANALYSER.minDb, maxDb = ANALYSER.maxDb) {
  let sum = 0;
  const end = Math.min(hi, bins.length);
  if (end <= lo) return 0;
  for (let i = lo; i < end; i++) sum += table[bins[i] & 255];
  const db = 10 * Math.log10(sum / (end - lo));
  return clamp01((db - minDb) / (maxDb - minDb));
}

// Drop everything under the noise floor and stretch the remainder back to 0..1.
export const gate = (level, floor = NOISE_FLOOR) => clamp01((level - floor) / (1 - floor));

// Monotonic soft limiter: identity up to `knee`, then tanh-compressed so it never exceeds 1
// (hard min(1, x) flat-tops loud material and makes the visuals look clipped).
export function softLimit(x, knee = 0.8) {
  if (!Number.isFinite(x) || x <= 0) return 0;
  if (x <= knee) return x;
  return knee + (1 - knee) * Math.tanh((x - knee) / (1 - knee));
}

// One-pole follower with separate attack/release time constants (seconds); frame-rate independent.
export function followEnvelope(prev, target, dt, attack, release) {
  if (!(dt > 0)) return prev;
  const tau = target > prev ? attack : release;
  return prev + (target - prev) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));
}

// Raw analyser bytes -> four ungained levels [bass, mid, high, energy] in 0..1 (gated, tilt-compensated).
export function spectralLevels(bins, sampleRate, fftSize = ANALYSER.fftSize, out = [0, 0, 0, 0]) {
  for (let b = 0; b < 4; b++) {
    const [lo, hi] = bandRange(BANDS_HZ[b][0], BANDS_HZ[b][1], sampleRate, fftSize, bins.length);
    const g = gate(bandLevel(bins, lo, hi));
    out[b] = g > 0 ? clamp01(g + BAND_TILT[b]) : 0;
  }
  return out;
}

// Seven adjacent colour lanes, from kick/sub bass to cymbal air. No overlapping FFT bins.
export const EMISSION_BANDS_HZ = [[30,120],[120,250],[250,500],[500,1000],[1000,2500],[2500,6000],[6000,14000]];
export function emissionLevels(bins,sampleRate,fftSize=ANALYSER.fftSize,out=new Float32Array(7)) {
  for(let i=0;i<7;i++){
    const [lo,hi]=bandRange(...EMISSION_BANDS_HZ[i],sampleRate,fftSize,bins.length);
    const level=gate(bandLevel(bins,lo,hi));
    out[i]=level>0?clamp01(level+i*.015):0;
  }
  return out;
}

// Nine non-overlapping sectors, bass at 10:30 and increasing clockwise.
// Boundaries fit the analyser's bins even at 96 kHz; no duplicated sub-bass bins.
export const RING_BANDS_HZ=[[30,120],[120,250],[250,500],[500,1000],[1000,2000],[2000,3500],[3500,6000],[6000,10000],[10000,20000]];
export function ringLevels(bins,sampleRate,fftSize=ANALYSER.fftSize,out=new Float32Array(9)){
  for(let i=0;i<9;i++){
    const [lo,hi]=bandRange(...RING_BANDS_HZ[i],sampleRate,fftSize,bins.length);
    const level=gate(bandLevel(bins,lo,hi));out[i]=level>0?clamp01(level+i*.012):0;
  }
  return out;
}
export class RingSpectrum {
  constructor(){this.levels=new Float32Array(9);this.attacks=new Float32Array(9);this.previous=new Float32Array(9);this.raw=new Float32Array(9);}
  reset(){this.levels.fill(0);this.attacks.fill(0);this.previous.fill(0);}
  update(bins,sampleRate,fftSize,gain,dt){
    ringLevels(bins,sampleRate,fftSize,this.raw);
    for(let i=0;i<9;i++){
      const target=softLimit(this.raw[i]*sanitizeGain(gain));
      this.attacks[i]=Math.max(this.attacks[i]*Math.exp(-dt/.18),clamp01((this.raw[i]-this.previous[i]-.018)*5*Math.sqrt(sanitizeGain(gain))));
      this.previous[i]=this.raw[i];this.levels[i]=followEnvelope(this.levels[i],target,dt,.008,.085);
    }
  }
}

// Spectral-flux onset detector. Feed it un-smoothed band levels each frame; it returns a 0..1
// envelope that jumps on onsets (kick, snare, clap) and decays in ~140 ms.
export class TransientDetector {
  constructor({ weights = [0.45, 0.3, 0.25], decay = 0.14, floor = 0.015, scale = 0.2, ratio = 1.5, meanTime = 0.4 } = {}) {
    Object.assign(this, { weights, decay, floor, scale, ratio, meanTime });
    this.reset();
  }
  reset() { this.prev = null; this.mean = 0; this.value = 0; }
  update(levels, dt) {
    if (!(dt > 0)) return this.value;
    if (!this.prev) { this.prev = levels.slice(0, 3); return this.value; }
    let flux = 0;
    for (let i = 0; i < 3; i++) { flux += this.weights[i] * Math.max(0, levels[i] - this.prev[i]); this.prev[i] = levels[i]; }
    const onset = clamp01((flux - this.ratio * this.mean - this.floor) / this.scale);
    this.mean += (flux - this.mean) * (1 - Math.exp(-dt / this.meanTime));
    this.value = Math.max(this.value * Math.exp(-dt / this.decay), onset);
    return this.value;
  }
}

// Explicit synthetic signal: a 122 BPM pulse. It is silent (no audio node is created) and only drives visuals.
export const DEMO_BPM = 122;
export function demoFrame(time, bins) {
  const t = Number.isFinite(time) ? time : 0;
  const beat = Math.pow(Math.max(0, Math.cos(t * Math.PI * 2 * DEMO_BPM / 60)), 14);
  const phase = (((t * DEMO_BPM / 60) % 1) + 1) % 1;
  if (bins) for (let i = 0; i < bins.length; i++) bins[i] = Math.max(0, (Math.sin(i * 0.31 + t * 3) * 0.25 + 0.4 + beat * 0.3) * 150 * Math.exp(-i / 450));
  return { levels: [beat * 0.65, 0.18 + Math.sin(t * 2.1) * 0.1, 0.12 + beat * 0.23, 0.15 + beat * 0.4], transient: Math.exp(-phase * 6) };
}

// Errors carry a stable `code` for callers and an English message because main.js prints error.message verbatim.
export class AudioError extends Error {
  constructor(code, message, cause) { super(message); this.name = 'AudioError'; this.code = code; if (cause) this.cause = cause; }
}

export function microphoneError(error) {
  if (error instanceof AudioError) return error;
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return new AudioError('denied', 'Microphone access was denied. Allow microphone access for this site and try again.', error);
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return new AudioError('no-device', 'No microphone found.', error);
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return new AudioError('busy', 'The microphone is busy or could not be opened.', error);
  return new AudioError('failed', error?.message || 'unknown error', error);
}

export async function requestMicrophone(mediaDevices) {
  if (!mediaDevices?.getUserMedia) throw new AudioError('unsupported', 'Microphone access requires HTTPS or localhost.');
  // Raw, unprocessed input: AGC/noise suppression would flatten the dynamics the visuals read.
  const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  try {
    return await mediaDevices.getUserMedia({ audio: raw, video: false });
  } catch (error) {
    if (error?.name === 'OverconstrainedError' || error?.name === 'TypeError') {
      try { return await mediaDevices.getUserMedia({ audio: true, video: false }); } catch (retry) { throw microphoneError(retry); }
    }
    throw microphoneError(error);
  }
}

// Call directly from a click/key gesture: display capture cannot restore permission.
export async function requestTabAudio(mediaDevices) {
  if (!mediaDevices?.getDisplayMedia) throw new AudioError('unsupported', 'Tab audio is unavailable here. Open EKKO in desktop Chrome or Edge over HTTPS or localhost.');
  let stream;
  try {
    let controller;
    if (globalThis.CaptureController?.prototype?.setFocusBehavior) {
      controller = new CaptureController();
      controller.setFocusBehavior('no-focus-change');
    }
    stream = await mediaDevices.getDisplayMedia({
      ...(controller ? { controller } : {}),
      video: { displaySurface: 'browser', frameRate: 1, width: { ideal: 320 }, height: { ideal: 180 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'exclude', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude',
    });
    if (!stream.getAudioTracks().some(track => track.readyState === 'live')) {
      throw new AudioError('no-tab-audio', 'No tab audio was shared. Choose a browser tab and enable “Share tab audio” in the picker. Desktop Chrome or Edge is recommended.');
    }
    return stream;
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    if (error instanceof AudioError) throw error;
    if (error?.name === 'NotAllowedError') throw new AudioError('capture-cancelled', 'Tab sharing was cancelled or denied. Select Share tab to try again.', error);
    if (error?.name === 'InvalidStateError') throw new AudioError('capture-focus', 'Click back into EKKO, then select Share tab again.', error);
    throw new AudioError('capture-failed', 'Could not share tab audio. Try desktop Chrome or Edge and select a browser tab with audio sharing enabled.', error);
  }
}

// Resume with a timeout: some browsers leave resume() pending forever when there is no user gesture.
export async function resumeContext(ctx, timeoutMs = 2000) {
  if (ctx.state !== 'running') {
    let timer;
    try {
      await Promise.race([ctx.resume(), new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
    } catch (error) {
      throw new AudioError('blocked', `The browser could not start the audio engine (${error?.message || error?.name || 'unknown error'})`, error);
    } finally { clearTimeout(timer); }
  }
  if (ctx.state !== 'running') throw new AudioError('blocked', 'Click Play to enable audio in this browser.');
  return ctx;
}

export function checkAudioFile(file) {
  if (!file || typeof file !== 'object' || typeof file.size !== 'number') throw new AudioError('bad-file', 'No file selected.');
  if (file.size === 0) throw new AudioError('bad-file', 'The file is empty.');
  const type = file.type || '';
  if (type && !/^(audio|video)\//.test(type) && type !== 'application/ogg' && type !== 'application/octet-stream') throw new AudioError('bad-file', `«${file.name || 'the file'}» is not an audio file (${type})`);
  return file;
}

export function playbackError(error, file) {
  if (error instanceof AudioError) return error;
  const label = file?.name ? `«${file.name}»` : 'the file';
  switch (error?.name) {
    case 'NotSupportedError': return new AudioError('unsupported-file', `The browser cannot decode ${label}. Try MP3, WAV, OGG or M4A.`, error);
    case 'NotAllowedError': return new AudioError('blocked', 'Playback was blocked. Press Play again.', error);
    case 'AbortError': return new AudioError('aborted', 'Playback was interrupted.', error);
    default: return new AudioError('failed', error?.message || 'unknown error', error);
  }
}

// Resolves once the element has metadata, rejects on a media error or timeout.
export function whenLoaded(element, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (element.readyState >= 1) return resolve();
    let timer;
    const done = fn => value => { clearTimeout(timer); element.removeEventListener('loadedmetadata', onLoad); element.removeEventListener('error', onError); fn(value); };
    const onLoad = done(resolve);
    const onError = done(() => reject(Object.assign(new Error('media error'), { name: 'NotSupportedError' })));
    timer = setTimeout(done(() => reject(new AudioError('timeout', 'Audio loading timed out.'))), timeoutMs);
    element.addEventListener('loadedmetadata', onLoad);
    element.addEventListener('error', onError);
  });
}

// Fullscreen helper for the coordinator's start/fullscreen control. Must be called from a user gesture.
export async function toggleFullscreen(root = globalThis.document?.documentElement, doc = globalThis.document) {
  if (!root || !doc) return false;
  const current = doc.fullscreenElement || doc.webkitFullscreenElement;
  if (current) { await (doc.exitFullscreen || doc.webkitExitFullscreen)?.call(doc); return false; }
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request) throw new AudioError('unsupported', 'Fullscreen is unavailable in this browser.');
  await request.call(root, { navigationUI: 'hide' });
  return true;
}

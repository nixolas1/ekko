import { GestureTracker } from './gestures.js';

// Frames keep the camera's native aspect ratio; only the long side is capped. Landmarks
// are normalized to this full frame, so x/y 0..1 always spans the whole camera image.
const CAPTURE_LONG_SIDE = 640;
const POLL_MS = 8;               // video-frame poll; results also trigger an immediate capture
const INIT_TIMEOUT = 60000;       // wasm + two models
const RESPONSE_TIMEOUT = 10000;   // a frame in flight with no answer means a wedged worker
const STALL_MS = 4000;            // camera delivering no new frames
const MAX_FRAME_ERRORS = 5;       // consecutive non-fatal worker/capture errors

const even = value => Math.max(2, Math.round(value / 2) * 2);
export function captureSize(width, height, longSide = CAPTURE_LONG_SIDE) {
  if (!(width > 0 && height > 0)) return null;
  const scale = Math.min(1, longSide / Math.max(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}
const abortError = () => Object.assign(new Error('Camera startup cancelled.'), { name: 'AbortError' });

// onStatus messages starting with "Tracking stopped" are fatal: tracking has already been
// stopped (active === false) when they are delivered.
export class Tracking {
  constructor(video, onResult, onStatus, options = {}) {
    this.video = video; this.onResult = onResult; this.onStatus = onStatus; this.options = options;
    this.gestures = new GestureTracker();
    this.active = false; this.ready = false; this.generation = 0; this.starting = null;
    this.hz = 0; this.ms = 0; this.aspect = 0; this.lastResult = 0; this.failures = 0;
  }
  start() {
    if (this.active) return Promise.resolve();
    if (!this.starting) {
      const run = this.starting = this.#start(++this.generation);
      const clear = () => { if (this.starting === run) this.starting = null; };
      run.then(clear, clear);
    }
    return this.starting;
  }
  async #start(generation) {
    const cancelled = () => generation !== this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Nettleseren gir ikke tilgang til kamera.');
    const stream = await navigator.mediaDevices.getUserMedia(this.options.constraints ?? {
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60, max: 60 } }, audio: false,
    });
    if (cancelled()) { stream.getTracks().forEach(t => t.stop()); throw abortError(); }
    this.stream = stream;
    this.cameraFps = stream.getVideoTracks()[0]?.getSettings?.().frameRate;
    try {
      stream.getVideoTracks().forEach(track => track.onended = () => {
        if (this.stream === stream) this.#fail('Tracking stopped: camera disconnected.');
      });
      this.video.muted = true; this.video.playsInline = true; this.video.srcObject = stream;
      await this.video.play();
      if (cancelled()) throw abortError();
      this.onStatus('Laster modeller …');
      const worker = this.worker = this.#createWorker();
      await this.#initWorker(worker);
      if (cancelled()) throw abortError();
      worker.onerror = e => this.#fail(`Tracking stopped: ${e.message || 'tracking worker failed'}`, worker);
      worker.onmessageerror = () => this.#fail('Tracking stopped: invalid tracking worker message.', worker);
      worker.onmessage = ({ data }) => this.#message(worker, data);
      this.failures = 0; this.busy = false; this.lastVideo = -1; this.seenTime = -1; this.stalled = false;
      this.frameAt = performance.now();
      this.active = true; this.ready = true;
      this.videoFrameId = null;
      this.useVideoFrames = typeof this.video.requestVideoFrameCallback === 'function';
      if (this.useVideoFrames) {
        const onFrame = (now, metadata) => {
          if (!this.active) return;
          this.videoFrameId = metadata.presentedFrames ?? metadata.mediaTime;
          this.videoFrameAt = now;
          this.capture();
          this.videoCallback = this.video.requestVideoFrameCallback(onFrame);
        };
        this.videoCallback = this.video.requestVideoFrameCallback(onFrame);
      }
      this.onStatus('Camera active');
      this.timer = setInterval(() => this.#tick(), POLL_MS);
    } catch (error) {
      // A cancelled start was already torn down by stop(); a newer start may own the video now.
      if (!cancelled()) this.stop();
      throw error;
    }
  }
  #createWorker() {
    const base = globalThis.document?.baseURI ?? globalThis.location?.href;
    return new Worker(this.options.workerUrl ?? (base ? new URL('tracking-worker.js', base) : '/tracking-worker.js'));
  }
  #initWorker(worker) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => settle(reject, new Error('Tracking model loading timed out. Try the camera again.')), INIT_TIMEOUT);
      const settle = (done, value) => { clearTimeout(timeout); this.rejectInit = null; done(value); };
      this.rejectInit = error => settle(reject, error);
      worker.onerror = e => settle(reject, new Error(e.message || 'Could not start the tracking worker.'));
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') { this.backend=data.backend; settle(resolve); }
        else if (data.type === 'error') settle(reject, new Error(data.message));
      };
      worker.postMessage({ type: 'init', maxHands: this.options.maxHands ?? 2 });
    });
  }
  #message(worker, data) {
    if (worker !== this.worker || !this.active) return;
    if (data.type === 'error') {
      this.busy = false;
      if (data.fatal || ++this.failures >= MAX_FRAME_ERRORS) this.#fail(`Tracking stopped: ${data.message}`, worker);
      return;
    }
    if (data.type !== 'result') return;
    this.busy = false; this.failures = 0;
    const now = performance.now(), gap = now - this.lastResult;
    if (this.lastResult && gap > 0) { const instant = 1000 / gap; this.hz = this.hz && gap < 2000 ? this.hz * .7 + instant * .3 : instant; }
    this.lastResult = now; this.ms = data.ms; this.latency = now - data.timestamp; this.backend = data.backend;
    this.aspect = data.width / data.height || 0;
    // Gesture time is the capture time, so cooldowns do not depend on worker latency.
    const bursts = this.gestures.update(data.hands, data.timestamp, this.aspect || 1);
    try {
      this.onResult({ ...data, bursts, handIds: this.gestures.ids.slice(), aspect: this.aspect, latency: now - data.timestamp, hz: this.hz });
    } catch (error) { console.error(error); }
    this.capture(); // keep the worker fed without waiting for the next poll
  }
  #fail(message, worker = this.worker) {
    if (worker !== this.worker) return;
    this.stop();
    this.onStatus(message);
  }
  #tick() {
    if (!this.active) return;
    const now = performance.now(), video = this.video;
    if (this.busy && now - this.busySince > RESPONSE_TIMEOUT) { this.#fail('Tracking stopped: tracking worker is not responding.'); return; }
    if (globalThis.document?.hidden) { this.frameAt = now; return; } // no capture for a hidden tab
    if (video.currentTime !== this.seenTime) {
      this.seenTime = video.currentTime; this.frameAt = now;
      if (this.stalled) { this.stalled = false; this.onStatus('Camera active'); }
    } else if (!this.stalled && now - this.frameAt > STALL_MS) { this.stalled = true; this.onStatus('Camera frame stalled…'); }
    this.capture();
  }
  async #bitmap(size) {
    const video = this.video;
    if (!this.noResize) {
      try { return await createImageBitmap(video, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'medium' }); }
      catch (error) { if (error?.name === 'InvalidStateError') throw error; this.noResize = true; } // resize options unsupported
    }
    return createImageBitmap(video);
  }
  // At most one frame is ever in flight (`busy`), so there is no backlog: frames that
  // arrive while the worker is busy are skipped, never queued.
  async capture() {
    const video = this.video, worker = this.worker;
    const frameId = this.useVideoFrames ? this.videoFrameId : video.currentTime;
    if (!this.active || this.busy || globalThis.document?.hidden || video.readyState < 2 || frameId === null || frameId === this.lastVideo) return;
    const size = captureSize(video.videoWidth, video.videoHeight, this.options.longSide);
    if (!size) return;
    this.busy = true; this.busySince = performance.now(); this.lastVideo = frameId;
    const timestamp = this.useVideoFrames ? this.videoFrameAt : this.busySince;
    try {
      const bitmap = await this.#bitmap(size);
      if (!this.active || worker !== this.worker) { bitmap.close(); return; }
      worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
    } catch (error) {
      if (worker !== this.worker) return;
      this.busy = false;
      if (++this.failures >= MAX_FRAME_ERRORS) this.#fail(`Tracking stopped: ${error.message}`, worker);
    }
  }
  stop() {
    this.generation++;
    this.active = false; this.ready = false;
    if (this.videoCallback != null) this.video.cancelVideoFrameCallback?.(this.videoCallback);
    this.videoCallback = null;
    clearInterval(this.timer); this.timer = null;
    this.rejectInit?.(abortError()); this.rejectInit = null;
    if (this.worker) { this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null; this.worker.terminate(); }
    this.worker = null;
    this.stream?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    this.stream = null; this.video.srcObject = null;
    this.busy = false; this.lastResult = 0; this.hz = 0; this.ms = 0; this.aspect = 0; this.failures = 0;
    this.gestures = new GestureTracker();
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSER, AudioError, TransientDetector, bandLevel, bandRange, checkAudioFile, demoFrame, followEnvelope, gate, microphoneError, requestMicrophone, resumeContext, sanitizeGain, softLimit, spectralLevels, toggleFullscreen } from '../src/audio-controls.js';
import { AudioInput } from '../src/audio.js';

const dbToByte = db => Math.round(((db - ANALYSER.minDb) / (ANALYSER.maxDb - ANALYSER.minDb)) * 255);

test('bandRange excludes DC, stays in bounds and is at least one bin wide', () => {
  const [lo, hi] = bandRange(30, 180, 48000, 1024, 512);
  assert.ok(lo >= 1 && hi > lo && hi <= 512);
  assert.deepEqual(bandRange(0, 1, 48000, 1024, 512), [1, 2]);
  const [l2, h2] = bandRange(2000, 1e9, 48000, 1024, 512);
  assert.equal(h2, 512); assert.ok(l2 < h2);
  assert.ok(bandRange(30, 180, NaN, 1024, 512)[1] > 1);
});

test('bandLevel is the identity on flat spectra and power-weights a single strong bin', () => {
  const flat = new Uint8Array(512).fill(128);
  assert.ok(Math.abs(bandLevel(flat, 1, 100) - 128 / 255) < 1e-9);
  const spike = new Uint8Array(512); spike[2] = 255;
  const level = bandLevel(spike, 1, 5); // one full-scale bin among four
  assert.ok(level > 0.85 && level < 0.95, `got ${level}`); // ~6 dB below full scale, not 0.25
  assert.equal(bandLevel(new Uint8Array(512), 1, 100), 0);
  assert.equal(bandLevel(flat, 10, 10), 0);
});

test('gate removes the noise floor and keeps 1 at full scale', () => {
  assert.equal(gate(0.1), 0);
  assert.equal(gate(0.22), 0);
  assert.equal(gate(1), 1);
  assert.ok(gate(0.6) > 0 && gate(0.6) < 1);
});

test('softLimit is identity below the knee, monotonic, and never exceeds 1', () => {
  assert.equal(softLimit(0.5), 0.5);
  assert.equal(softLimit(-3), 0);
  assert.equal(softLimit(NaN), 0);
  let prev = -1;
  for (let x = 0; x <= 50; x += 0.05) { const y = softLimit(x); assert.ok(y >= prev && y <= 1); prev = y; }
  assert.ok(softLimit(1.5) < 1 && softLimit(1.5) > softLimit(1));
  assert.ok(Math.abs(softLimit(0.8 + 1e-9) - 0.8) < 1e-6); // continuous at the knee
});

test('followEnvelope attacks faster than it releases and is frame-rate independent', () => {
  const up = followEnvelope(0, 1, 1 / 60, 0.01, 0.2), down = 1 - followEnvelope(1, 0, 1 / 60, 0.01, 0.2);
  assert.ok(up > 0.8 && down < 0.1);
  let a = 0; for (let i = 0; i < 60; i++) a = followEnvelope(a, 1, 1 / 60, 0.1, 0.1);
  let b = 0; for (let i = 0; i < 144; i++) b = followEnvelope(b, 1, 1 / 144, 0.1, 0.1);
  assert.ok(Math.abs(a - b) < 1e-9);
  assert.equal(followEnvelope(0.3, 1, 0, 0.1, 0.1), 0.3);
});

test('spectralLevels: silence and noise floor are 0, a bass tone lights bass only', () => {
  assert.deepEqual(spectralLevels(new Uint8Array(512), 48000), [0, 0, 0, 0]);
  assert.deepEqual(spectralLevels(new Uint8Array(512).fill(dbToByte(-75)), 48000), [0, 0, 0, 0]);
  const bins = new Uint8Array(512);
  for (let i = 1; i <= 3; i++) bins[i] = dbToByte(-25); // ~47-140 Hz
  const [bass, mid, high, energy] = spectralLevels(bins, 48000);
  assert.ok(bass > 0.7, `bass ${bass}`);
  assert.equal(mid, 0); assert.equal(high, 0);
  assert.ok(energy > 0 && energy < bass);
  for (const v of [bass, mid, high, energy]) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
});

test('spectralLevels output stays within 0..1 for arbitrary bytes', () => {
  const bins = new Uint8Array(512); for (let i = 0; i < 512; i++) bins[i] = (i * 97) & 255;
  for (const v of spectralLevels(bins, 44100)) assert.ok(v >= 0 && v <= 1);
});

test('TransientDetector fires on an onset, decays, and ignores steady levels', () => {
  const d = new TransientDetector(), dt = 1 / 60;
  let v; for (let i = 0; i < 120; i++) v = d.update([0.5, 0.4, 0.3], dt);
  assert.ok(v < 0.05, `steady ${v}`);
  const hit = d.update([0.95, 0.7, 0.5], dt);
  assert.ok(hit > 0.5 && hit <= 1, `hit ${hit}`);
  let after = hit; for (let i = 0; i < 30; i++) after = d.update([0.95, 0.7, 0.5], dt);
  assert.ok(after < 0.1, `decayed ${after}`);
  // A slow ramp over a second is not an onset.
  const r = new TransientDetector(); let peak = 0;
  for (let i = 0; i < 60; i++) peak = Math.max(peak, r.update([i / 60, i / 60, i / 60], dt));
  assert.ok(peak < 0.2, `ramp ${peak}`);
  assert.equal(new TransientDetector().update([1, 1, 1], 0), 0);
});

test('demoFrame is finite, bounded and beat-aligned', () => {
  const bins = new Uint8Array(512);
  for (const t of [0, 0.1, 1.234, 99.9, -3, NaN]) {
    const { levels, transient } = demoFrame(t, bins);
    for (const v of [...levels, transient]) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `t=${t} v=${v}`);
  }
  assert.ok(demoFrame(0).transient > 0.99 && demoFrame(0.45).transient < 0.3);
});

test('sanitizeGain and checkAudioFile validate input', () => {
  assert.equal(sanitizeGain(NaN), 1.2); assert.equal(sanitizeGain(-1), 0); assert.equal(sanitizeGain(100), 8);
  assert.throws(() => checkAudioFile(null), AudioError);
  assert.throws(() => checkAudioFile({ size: 0, type: 'audio/mpeg' }), /tom/);
  assert.throws(() => checkAudioFile({ size: 5, type: 'image/png', name: 'a.png' }), /ikke en lydfil/);
  assert.doesNotThrow(() => checkAudioFile({ size: 5, type: '' }));
  assert.doesNotThrow(() => checkAudioFile({ size: 5, type: 'audio/mpeg' }));
});

test('microphone errors map to actionable codes', async () => {
  const named = name => Object.assign(new Error('x'), { name });
  assert.equal(microphoneError(named('NotAllowedError')).code, 'denied');
  assert.equal(microphoneError(named('NotFoundError')).code, 'no-device');
  assert.equal(microphoneError(named('NotReadableError')).code, 'busy');
  await assert.rejects(requestMicrophone(undefined), e => e.code === 'unsupported');
  const calls = [];
  const md = { getUserMedia: async c => { calls.push(c); if (calls.length === 1) throw named('OverconstrainedError'); return 'stream'; } };
  assert.equal(await requestMicrophone(md), 'stream');
  assert.equal(calls[1].audio, true); // retried with relaxed constraints
  assert.equal(calls[0].audio.autoGainControl, false);
});

test('resumeContext resumes, times out on a hung resume, and reports a blocked context', async () => {
  const ok = { state: 'suspended', async resume() { this.state = 'running'; } };
  assert.equal(await resumeContext(ok), ok);
  const hung = { state: 'suspended', resume: () => new Promise(() => {}) };
  await assert.rejects(resumeContext(hung, 20), e => e.code === 'blocked');
  const denied = { state: 'suspended', async resume() { throw new Error('nope'); } };
  await assert.rejects(resumeContext(denied), e => e.code === 'blocked');
});

test('toggleFullscreen enters and exits using the standard API', async () => {
  const log = [];
  const doc = { fullscreenElement: null, async exitFullscreen() { log.push('exit'); doc.fullscreenElement = null; } };
  const root = { async requestFullscreen(o) { log.push(['enter', o.navigationUI]); doc.fullscreenElement = root; } };
  assert.equal(await toggleFullscreen(root, doc), true);
  assert.equal(await toggleFullscreen(root, doc), false);
  assert.deepEqual(log, [['enter', 'hide'], 'exit']);
  await assert.rejects(toggleFullscreen({}, { fullscreenElement: null }), e => e.code === 'unsupported');
});

// ---- AudioInput with fake Web Audio / media objects ----

function installFakes() {
  const made = { streams: [], elements: [], contexts: [] };
  const track = () => ({ stopped: false, onended: null, stop() { this.stopped = true; } });
  class FakeNode { constructor() { this.connected = []; this.gain = { value: 1 }; } connect(n) { this.connected.push(n); return n; } disconnect() { this.connected = []; } }
  class FakeAnalyser extends FakeNode {
    constructor() { super(); this.fftSize = 1024; this.fill = 0; }
    getByteFrequencyData(a) { a.fill(this.fill); }
  }
  class FakeContext {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.destination = new FakeNode(); made.contexts.push(this); }
    createAnalyser() { return new FakeAnalyser(); } createGain() { return new FakeNode(); }
    createMediaStreamSource(stream) { const n = new FakeNode(); n.stream = stream; return n; }
    createMediaElementSource(el) { const n = new FakeNode(); n.element = el; return n; }
    async resume() { this.state = 'running'; }
  }
  class FakeAudio extends EventTarget {
    constructor() { super(); this.readyState = 0; this.paused = true; this.attrs = {}; made.elements.push(this); }
    set src(v) { this._src = v; (v.includes('slow') ? fn => setTimeout(fn, 20) : queueMicrotask)(() => { if (this._src && this._src.includes('bad')) this.dispatchEvent(new Event('error')); else { this.readyState = 1; this.dispatchEvent(new Event('loadedmetadata')); } }); }
    get src() { return this._src; }
    removeAttribute(k) { if (k === 'src') this._src = ''; }
    load() {}
    pause() { this.paused = true; }
    async play() { if (this.rejectPlay) throw Object.assign(new Error('no'), { name: this.rejectPlay }); this.paused = false; }
  }
  const revoked = [];
  const urlCreate = URL.createObjectURL, urlRevoke = URL.revokeObjectURL;
  URL.createObjectURL = f => `blob:${f.name}`; URL.revokeObjectURL = u => revoked.push(u);
  globalThis.AudioContext = FakeContext; globalThis.Audio = FakeAudio;
  const nav = { mediaDevices: { getUserMedia: async () => { const s = { tracks: [track()], getTracks() { return this.tracks; } }; made.streams.push(s); return s; } } };
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  return { made, revoked, nav, restore() { URL.createObjectURL = urlCreate; URL.revokeObjectURL = urlRevoke; delete globalThis.AudioContext; delete globalThis.Audio; delete globalThis.navigator; } };
}
const file = (name = 'a.mp3') => ({ name, size: 10, type: 'audio/mpeg' });

test('AudioInput demo is synthetic and silent: no AudioContext, four finite normalised numbers', () => {
  const f = installFakes();
  try {
    const a = new AudioInput();
    for (let t = 0; t < 3; t += 1 / 60) {
      const s = a.sample(t);
      assert.equal(s.length, 4);
      for (const v of s) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
      assert.ok(a.transient >= 0 && a.transient <= 1);
    }
    assert.equal(a.mode, 'demo'); assert.equal(a.synthetic, true); assert.equal(f.made.contexts.length, 0);
    a.gain = NaN; for (const v of a.sample(5)) assert.ok(Number.isFinite(v));
    a.gain = 50; for (const v of a.sample(5.1)) assert.ok(v <= 1);
  } finally { f.restore(); }
});

test('AudioInput microphone is analysed but never monitored; stop releases tracks', async () => {
  const f = installFakes();
  try {
    const a = new AudioInput(); const modes = []; a.onchange = m => modes.push(m);
    assert.equal(await a.microphone(), true);
    assert.equal(a.mode, 'mic');
    assert.deepEqual(a.source.connected, [a.analyser]); // not connected to ctx.destination
    const ctx = a.ctx; assert.notEqual(a.analyser.connected[0], ctx.destination); // only via zero-gain node
    assert.equal(a.mute.gain.value, 0);
    a.analyser.fill = dbToByte(-30);
    for (let i = 0; i < 30; i++) a.sample(i / 60);
    for (const v of a.sample(1)) assert.ok(v > 0 && v <= 1);
    a.stop();
    assert.ok(f.made.streams[0].tracks[0].stopped); assert.equal(a.mode, 'demo'); assert.equal(a.stream, null);
    assert.deepEqual(modes, ['mic', 'demo']);
  } finally { f.restore(); }
});

test('AudioInput microphone denial leaves the previous source untouched and surfaces a clear message', async () => {
  const f = installFakes();
  try {
    const a = new AudioInput();
    await a.file(file());
    f.nav.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); };
    await assert.rejects(a.microphone(), e => e.code === 'denied' && /mikrofon/.test(e.message));
    assert.equal(a.mode, 'file'); assert.ok(a.element);
    assert.match(a.error, /mikrofon/);
    a.stop(); assert.equal(a.error, null);
  } finally { f.restore(); }
});

test('AudioInput superseded microphone request stops its late stream', async () => {
  const f = installFakes();
  try {
    const a = new AudioInput();
    let release; const gate = new Promise(r => { release = r; });
    const orig = f.nav.mediaDevices.getUserMedia;
    let prompted; const promptOpen = new Promise(r => { prompted = r; });
    f.nav.mediaDevices.getUserMedia = async c => { prompted(); await gate; return orig(c); };
    const pending = a.microphone();
    await promptOpen; a.stop(); // user hit "demo" while the permission prompt is open
    release();
    assert.equal(await pending, false);
    assert.equal(a.mode, 'demo'); assert.equal(a.stream, null);
    assert.ok(f.made.streams[0].tracks[0].stopped);
  } finally { f.restore(); }
});

test('AudioInput file is audible, replaced cleanly, and old URLs/elements are released', async () => {
  const f = installFakes();
  try {
    const a = new AudioInput();
    assert.equal(await a.file(file('one.mp3')), true);
    assert.equal(a.mode, 'file'); assert.ok(a.source.connected.includes(a.ctx.destination)); assert.equal(a.element.loop, true); assert.equal(a.element.paused, false);
    const first = a.element;
    await a.file(file('two.mp3'));
    assert.deepEqual(f.revoked, ['blob:one.mp3']); assert.equal(first.paused, true); assert.equal(first.src, '');
    a.stop(); assert.deepEqual(f.revoked, ['blob:one.mp3', 'blob:two.mp3']); assert.equal(a.element, null);
  } finally { f.restore(); }
});

test('AudioInput unsupported or rejected files raise Norwegian errors and keep the old source', async () => {
  const f = installFakes();
  try {
    const a = new AudioInput();
    await a.file(file('good.mp3'));
    await assert.rejects(a.file(file('bad.xyz')), e => e.code === 'unsupported-file' && /dekode/.test(e.message));
    assert.equal(a.mode, 'file'); assert.equal(a.element.src, 'blob:good.mp3');
    assert.ok(f.revoked.includes('blob:bad.xyz'));
    await assert.rejects(a.file({ name: 'x.png', size: 3, type: 'image/png' }), e => e.code === 'bad-file');
    // play() blocked after commit: falls back to demo and cleans up.
    const b = new AudioInput();
    globalThis.Audio.prototype.rejectPlay = 'NotAllowedError';
    await assert.rejects(b.file(file('blocked.mp3')), e => e.code === 'blocked');
    assert.equal(b.mode, 'demo'); assert.equal(b.element, null); assert.ok(f.revoked.includes('blob:blocked.mp3'));
  } finally { f.restore(); }
});

test('AudioInput file superseded mid-load resolves false and leaks nothing', async () => {
  const f = installFakes();
  try {
    const a = new AudioInput();
    await a.context();
    const p1 = a.file(file('slow.mp3'));
    await new Promise(r => setTimeout(r, 5)); // slow.mp3 is now loading
    const p2 = a.file(file('fast.mp3'));
    assert.equal(await p2, true); assert.equal(await p1, false);
    assert.equal(a.element.src, 'blob:fast.mp3'); assert.deepEqual(f.revoked, ['blob:slow.mp3']);
    assert.equal(f.made.elements[0].paused, true);
  } finally { f.restore(); }
});

test('AudioInput falls back to demo when the microphone is unplugged', async () => {
  const f = installFakes();
  try {
    const a = new AudioInput(); const events = [];
    a.onchange = (m, r) => events.push([m, r]);
    await a.microphone();
    f.made.streams[0].tracks[0].onended();
    assert.equal(a.mode, 'demo'); assert.match(a.error, /frakoblet/);
    assert.deepEqual(events.at(-1), ['demo', 'Mikrofonen ble frakoblet']);
  } finally { f.restore(); }
});
test('AudioInput restores a paused file at its playhead without resuming the audio context',async()=>{
 const f=installFakes();try{const a=new AudioInput();await a.file(file(),{autoplay:false,position:42.125});
 assert.equal(a.mode,'file');assert.equal(a.element.currentTime,42.125);assert.equal(a.element.paused,true);assert.equal(a.ctx.state,'suspended');
 await a.context();await a.element.play();assert.equal(a.ctx.state,'running');assert.equal(a.element.currentTime,42.125);a.stop();
 }finally{f.restore();}
});

test('Stop sound silences immediately, preserves the playhead, and cancels an in-flight replacement',async()=>{
 const f=installFakes();try{const a=new AudioInput();await a.file(file());a.element.currentTime=37.25;const original=a.element;
 const pending=a.file(file('slow.mp3'));await Promise.resolve();a.silence();assert.equal(original.paused,true);assert.equal(a.element,original);assert.equal(a.element.currentTime,37.25);
 assert.equal(await pending,false);assert.equal(a.element,original);assert.equal(a.element.paused,true);a.stop();
 }finally{f.restore();}
});

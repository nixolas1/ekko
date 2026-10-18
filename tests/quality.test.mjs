// Node-side quality checks for EKKO: static consistency between WGSL/JS/HTML, ParticleEngine uniform packing against a
// recording MOCK WebGPU device, gesture/audio behaviour checks, and logic tests for the browser harness
// (tests/runtime.js). Nothing here executes a real GPU, camera, worker or browser; real runtime validation is
// /tests/runtime.html. Font connectivity and reference-audio licensing are documented deployment
// considerations, not assertions that contradict the requested local demo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { register } from 'node:module';

const loaderSource = `
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('?raw')) return { url: new URL(specifier.slice(0, -4), context.parentURL).href + '?raw', shortCircuit: true };
  if (/^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier)) return next(specifier + '.js', context);
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.endsWith('?raw')) return { format: 'module', source: 'export default ' + JSON.stringify(await readFile(fileURLToPath(url.slice(0, -4)), 'utf8')), shortCircuit: true };
  return next(url, context);
}`;
register('data:text/javascript,' + encodeURIComponent(loaderSource));

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const stripComments = code => code.replace(/\/\/[^\n]*/g, '');

const { ParticleEngine } = await import('../src/gpu.js');
const { GestureTracker, openness } = await import('../src/gestures.js');
const { AudioInput } = await import('../src/audio.js');
const harness = await import('./runtime.js');

const wgslFiles = () => Object.fromEntries(readdirSync(new URL('src/', root)).filter(f => f.endsWith('.wgsl')).map(f => [f, read(`src/${f}`)]));

// Parses `struct <name> { field: vec4f, field: array<vec4f, N> }` into ordered fields with byte sizes.
function wgslStruct(code, name) {
  const body = stripComments(code).match(new RegExp(`struct ${name}\\s*\\{([\\s\\S]*?)\\n?\\}`))?.[1];
  if (!body) return null;
  return body.replace(/<\s*vec4f\s*,\s*(\d+)\s*>/g, '<vec4f;$1>').split(/[,\n]/).map(s => s.trim()).filter(Boolean).map(field => {
    const [fieldName, type] = field.split(/:\s*/);
    const array = type.match(/^array<vec4f;(\d+)>$/);
    assert.ok(array || type === 'vec4f', `unsupported field type ${type} in ${name}.${fieldName}; update the test`);
    return { name: fieldName, bytes: array ? 16 * Number(array[1]) : 16 };
  });
}
const structBytes = fields => fields.reduce((sum, f) => sum + f.bytes, 0);
// All definitions of a struct across src/*.wgsl must agree; returns the shared definition.
function sharedStruct(name) {
  const found = Object.entries(wgslFiles()).map(([file, code]) => [file, wgslStruct(code, name)]).filter(([, fields]) => fields);
  assert.ok(found.length, `struct ${name} not found in any src/*.wgsl`);
  for (const [file, fields] of found) assert.deepEqual(fields, found[0][1], `${name} differs between ${found[0][0]} and ${file}`);
  return found[0][1];
}
const gpuConstant = name => Number(read('src/gpu.js').match(new RegExp(`\\b${name}=(\\d+)`))?.[1]);
const uniformLayout = () => {
  let offset = 0; const map = {};
  for (const f of sharedStruct('Parameters')) { map[f.name] = offset; offset += f.bytes / 4; }
  return { map, floats: offset };
};

// ---------------------------------------------------------------- static consistency

test('uniform layout: WGSL Parameters, gpu.js constants and array capacities agree', () => {
  const params = sharedStruct('Parameters'), gpu = read('src/gpu.js');
  assert.equal(gpuConstant('UNIFORM_FLOATS') * 4, structBytes(params), 'UNIFORM_FLOATS*4 != WGSL Parameters byte size');
  assert.match(gpu, /size:UNIFORM_FLOATS\*4,usage:GPUBufferUsage\.UNIFORM/, 'uniform buffer size must come from UNIFORM_FLOATS');
  const capacity = name => params.find(f => f.name === name).bytes / 16;
  assert.equal(gpuConstant('MAX_FORCES'), capacity('forces'), 'MAX_FORCES != forces array length');
  if (params.some(f => f.name === 'forceVel')) assert.equal(capacity('forceVel'), capacity('forces'), 'forceVel must mirror forces');
  if (params.some(f => f.name === 'bursts')) assert.equal(gpuConstant('MAX_BURSTS'), capacity('bursts'), 'MAX_BURSTS != bursts array length');
});

test('particle buffer: stride matches the WGSL Particle struct and fits the largest UI option', () => {
  const particle = structBytes(sharedStruct('Particle'));
  assert.equal(gpuConstant('PARTICLE_BYTES'), particle, 'PARTICLE_BYTES != WGSL Particle byte size');
  const select = read('index.html').match(/<select id="particles">([\s\S]*?)<\/select>/)[1];
  const options = [...select.matchAll(/<option value="(\d+)"/g)].map(m => Number(m[1]));
  assert.ok(options.includes(32768) && options.includes(131072) && options.includes(262144), 'harness counts 32k/131k/262k should exist as UI options');
  assert.ok(Math.max(...options) <= gpuConstant('MAX_PARTICLES'), 'largest UI option exceeds MAX_PARTICLES');
  assert.equal(gpuConstant('MAX_PARTICLES'), harness.MAX_PARTICLES, 'harness assumes a different buffer capacity than gpu.js');
});

test('entry points, workgroup size and braces are consistent across the shaders', () => {
  const gpu = read('src/gpu.js'), files = wgslFiles(), all = Object.values(files).join('\n');
  const entries = [...gpu.matchAll(/entryPoint:'(\w+)'/g)].map(m => m[1]);
  assert.ok(entries.length >= 3);
  for (const entry of entries) assert.match(all, new RegExp(`\\bfn ${entry}\\b`), `entry point ${entry} missing from WGSL`);
  const size = all.match(/@workgroup_size\((\d+)\)/)[1];
  assert.match(gpu, new RegExp(`Math\\.ceil\\(count/${size}\\)`), 'dispatch divisor != @workgroup_size');
  for (const [name, code] of Object.entries(files)) assert.equal((code.match(/\{/g) ?? []).length, (code.match(/\}/g) ?? []).length, `${name}: unbalanced braces`);
});

test('every element id used by main.js exists in index.html; palettes line up', () => {
  const html = read('index.html'), main = read('src/main.js');
  const ids = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]));
  const used = [...new Set([...main.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))];
  assert.deepEqual(used.filter(id => !ids.has(id)), [], 'main.js references ids missing from index.html');
  assert.deepEqual([...html.matchAll(/data-palette="(\d+)"/g)].map(m => Number(m[1])), harness.PALETTES, 'harness palettes != UI palettes');
});

test('app sources load no remote assets (HTML loading attributes, JS, WGSL)', () => {
  const html = read('index.html'), remote = [];
  for (const m of html.matchAll(/<(?:script|img|source|video|audio|iframe|embed|link)\b[^>]*\b(?:src|srcset|poster|href)=["'](https?:\/\/[^"']+)/gi)) {
    if (!/^<a\b/i.test(m[0])) remote.push(`index.html: ${m[1]}`);
  }
  for (const m of html.matchAll(/@import|url\(\s*["']?https?:/g)) remote.push(`index.html: ${m[0]}`);
  for (const file of readdirSync(new URL('src/', root)).filter(f => /\.(js|wgsl)$/.test(f))) {
    // youtube.js constructs validated user links for our same-origin import API; it loads no remote assets.
    if(file==='youtube.js')continue;
    for (const m of read(`src/${file}`).matchAll(/https?:\/\/[^\s'")<>]+/g)) remote.push(`src/${file}: ${m[0]}`);
  }
  assert.deepEqual(remote, []);
});



test('local files referenced by main.js and the worker exist in public/', () => {
  const main = read('src/main.js'), worker = read('src/tracking-worker.js');
  const fetched = [...main.matchAll(/fetch\('(\/[^']+)'/g)].map(m => m[1]);
  for (const path of fetched) assert.ok(existsSync(new URL(`public${path}`, root)), `main.js fetches ${path} but public${path} is missing`);
  const models = [...worker.matchAll(/(?:asset\(|')(\/?models\/[\w.-]+)/g)].map(m => m[1].replace(/^\//, ''));
  assert.ok(models.length >= 1, 'expected hand model path in the worker');
  for (const model of models) assert.ok(statSync(new URL(`public/${model}`, root)).size > 100_000, `${model} missing or suspiciously small`);
  assert.match(worker, /wasm/);
  for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) assert.ok(existsSync(new URL(`public/wasm/${file}`, root)), `public/wasm/${file} missing`);
  assert.ok(statSync(new URL('public/tracking-worker.js', root)).size > 10_000, 'built public/tracking-worker.js missing; run npm run assets');
});

test('built public/tracking-worker.js is not older than src/tracking-worker.js or src/gestures.js', () => {
  const built = statSync(new URL('public/tracking-worker.js', root)).mtimeMs;
  for (const src of ['src/tracking-worker.js', 'src/gestures.js']) assert.ok(built >= statSync(new URL(src, root)).mtimeMs, `public/tracking-worker.js is older than ${src}`);
});



// ---------------------------------------------------------------- ParticleEngine against a recording MOCK WebGPU

// Particles as the shader initialises them: spread over the scene, state.w (index 11) = 1. Stride 16 floats.
const healthyParticles = floats => {
  const data = new Float32Array(floats), stride = 16;
  for (let i = 0; i < floats / stride; i++) { data[i * stride] = (i % 8) * .5 - 1.75; data[i * stride + 1] = (Math.floor(i / 8) % 8) * .375 - 1.3; data[i * stride + 11] = 1; }
  return data;
};
// readback: function(floatCount) -> Float32Array served for MAP_READ staging buffers; false strips COPY_SRC from STORAGE buffers.
function installMockBrowser({ gpu = true, validationError = false, uncapturedOnSubmit = 0, hidden = false, readback = healthyParticles } = {}) {
  const added = [];
  const define = (key, value) => { globalThis[key] = value; added.push(key); };
  const stats = { uniformWrites: [], dispatches: [], draws: [], clears: [], destroyed: 0, submits: 0, devices: [] };
  let validationPops = 0;
  const makeDevice = () => {
    const listeners = [], scopes = [];
    let resolveLost;
    const lost = new Promise(resolve => { resolveLost = resolve; });
    const device = {
      lost, adapterInfo: { vendor: 'mock', architecture: 'mock', device: 'mock', description: 'mock device', isFallbackAdapter: false },
      lose: (reason, message) => resolveLost({ reason, message }),
      addEventListener: (type, fn) => { if (type === 'uncapturederror') listeners.push(fn); },
      dispatchEvent: event => { listeners.forEach(fn => fn(event)); return true; },
      createBuffer: desc => {
        if (desc.usage === 0) {
          const scope = [...scopes].reverse().find(s => s.type === 'validation');
          if (scope) scope.error = { message: 'mock: usage must not be 0' };
          else queueMicrotask(() => listeners.forEach(fn => fn({ error: { message: 'mock uncaptured validation error' } })));
        }
        const buffer = { size: desc.size, usage: desc.usage, destroy() {} };
        if (readback === false && desc.usage & 128) buffer.usage &= ~4;
        if (desc.usage & 1) { // MAP_READ staging buffer: serve prepared particle data
          buffer.mapAsync = async () => {};
          buffer.unmap = () => {};
          buffer.getMappedRange = () => { const data = readback(desc.size / 4); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); };
        }
        return buffer;
      },
      createTexture: () => ({ createView: () => ({}), destroy() {} }),
      createSampler: () => ({}),
      createBindGroup: () => ({}),
      createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
      createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
      createRenderPipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
      pushErrorScope: type => scopes.push({ type, error: null }),
      // validationError: true fails every validation pop; a number N fails from the Nth validation pop on (1 = engine init's own scope).
      popErrorScope: async () => {
        const scope = scopes.pop();
        if (scope.type !== 'validation') return scope.error;
        validationPops++;
        return validationError && validationPops >= (validationError === true ? 1 : validationError) ? { message: 'mock validation failure' } : scope.error;
      },
      queue: {
        writeBuffer: (_buffer, _offset, data) => { if (data.length >= 100) stats.uniformWrites.push(Float32Array.from(data)); },
        onSubmittedWorkDone: async () => {},
        submit() { stats.submits++; if (uncapturedOnSubmit && stats.submits === uncapturedOnSubmit) queueMicrotask(() => listeners.forEach(fn => fn({ error: { message: 'mock uncaptured at submit' } }))); },
      },
      createCommandEncoder: () => ({
        beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups: n => stats.dispatches.push(n), end() {} }),
        beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw: (v, i = 1) => stats.draws.push([v, i]), end() {} }),
        clearBuffer: (_buffer, offset, size) => {if(size!==undefined)stats.clears.push([offset, size]);},
        copyBufferToBuffer() {},
        finish: () => ({}),
      }),
      destroy: () => { stats.destroyed++; resolveLost({ reason: 'destroyed', message: 'mock destroyed' }); },
    };
    stats.devices.push(device);
    return device;
  };
  const adapter = { info: { vendor: 'mock', architecture: 'mock', device: 'mock', description: 'mock adapter', isFallbackAdapter: false }, isFallbackAdapter: false, features: new Set(['mock-feature']), limits: { maxStorageBufferBindingSize: 268435456 }, requestDevice: async () => makeDevice() };
  const stub = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'bgra8unorm' };
  if (gpu) Object.defineProperty(globalThis.navigator, 'gpu', { value: stub, configurable: true });
  else delete globalThis.navigator.gpu;
  const makeCanvas = () => ({ width: 0, height: 0, id: '', remove() {}, getContext: () => ({ configure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) }) });
  const stage = { append() {} };
  define('document', { hidden, visibilityState: hidden ? 'hidden' : 'visible', hasFocus: () => true, body: stage, createElement: () => makeCanvas(), getElementById: () => stage, addEventListener() {}, removeEventListener() {} });
  define('location', { href: 'http://127.0.0.1:5173/tests/runtime.html', origin: 'http://127.0.0.1:5173' });
  define('innerWidth', 1280); define('innerHeight', 720); define('devicePixelRatio', 1); define('isSecureContext', true);
  define('addEventListener', () => {}); define('removeEventListener', () => {});
  define('requestAnimationFrame', cb => setTimeout(() => cb(performance.now()), 2));
  define('cancelAnimationFrame', handle => clearTimeout(handle));
  define('GPUBufferUsage', { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 });
  define('GPUTextureUsage', { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4 });
  define('GPUMapMode', { READ: 1 });
  define('ImageData', class { constructor(width, height) { this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4); } });
  define('createImageBitmap', async image => ({ width: image.width, height: image.height, close() {} }));
  define('GPUValidationError', class { constructor(message) { this.message = message; } });
  define('GPUUncapturedErrorEvent', class { constructor(type, init) { this.type = type; this.error = init.error; } });
  return { stats, restore() { for (const key of added) delete globalThis[key]; delete globalThis.navigator.gpu; } };
}

async function withEngine(fn, options) {
  const mock = installMockBrowser(options);
  try {
    const engine = new ParticleEngine(document.createElement('canvas'));
    await engine.init();
    return await fn(engine, mock.stats);
  } finally { mock.restore(); }
}
const lastUniform = stats => stats.uniformWrites.at(-1);
const slice = (u, offset, n) => [...u.slice(offset, offset + n)];
const f32 = Math.fround;

test('[mock device] frame() packs the uniform block at the offsets the WGSL struct declares', async () => {
  const { map, floats } = uniformLayout();
  await withEngine((engine, stats) => {
    engine.palette = 2;
    engine.explode(0.25, -0.5); engine.explode(-0.4, 0.3, 1.5);
    engine.frame(0.016, [0.1, 0.2, 0.3, 0.4], [[1, 2, 3, 4], [5, 6, 7, 8]], false);
    const u = lastUniform(stats);
    assert.equal(u.length, floats, 'uploaded block size != WGSL Parameters size');
    assert.deepEqual(slice(u, map.clock, 4), [f32(0.016), f32(0.016), f32(1280 / 720), 131072]);
    assert.deepEqual(slice(u, map.sound, 4), [0.1, 0.2, 0.3, 0.4].map(f32));
    assert.deepEqual(slice(u, map.display, 4), [2, 1280, 720, 2]);
    assert.deepEqual(slice(u, map.forces, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(u[map.extra], 2, 'both queued bursts must be drained in this frame');
    assert.deepEqual(slice(u, map.bursts, 8), [f32(0.25), -0.5, 1, 1, f32(-0.4), f32(0.3), 2, 1.5], 'two same-frame explosions must both reach the GPU');
    assert.equal(slice(u, map.burst, 4)[2], 2, 'served serial after the drain');
  });
});

test('[mock device] dispatch/draw follow the count, count is clamped, buffer is cleared only for new particles', async () => {
  const { map } = uniformLayout(), stride = gpuConstant('PARTICLE_BYTES');
  await withEngine((engine, stats) => {
    engine.frame(0.016, [0, 0, 0, 0], [], false);
    assert.deepEqual(stats.clears, [[0, 131072 * stride]]); assert.deepEqual(stats.dispatches, [512,64,512]);
    assert.ok(stats.draws.some(d => d[1] === 131072), 'particle draw must be instanced by count');
    engine.frame(0.016, [0, 0, 0, 0], [], false);
    assert.equal(stats.clears.length, 1, 'unchanged count must not clear again');
    engine.count = 262144; engine.frame(0.016, [0, 0, 0, 0], [], false);
    assert.deepEqual(stats.clears.at(-1), [131072 * stride, 131072 * stride]); assert.equal(stats.dispatches.at(-1), 1024);
    engine.count = 1e9; engine.frame(0.016, [0, 0, 0, 0], [], false);
    assert.equal(lastUniform(stats)[map.clock + 3], gpuConstant('MAX_PARTICLES'), 'count above capacity must be clamped');
    engine.count = 32768; engine.frame(0.016, [0, 0, 0, 0], [], false);
    assert.equal(stats.dispatches.at(-1), 128); assert.equal(lastUniform(stats)[map.clock + 3], 32768);
  });
});

test('[mock device] malformed audio/force input cannot shift the uniform layout', async () => {
  const { map } = uniformLayout();
  await withEngine((engine, stats) => {
    engine.palette = 1;
    const forces = [[NaN, 0, 1, 1], [1, 2, 3, 4], null, [9, 9, 9]];
    for (let i = 0; i < 40; i++) forces.push([i, i, 1, 1]);
    engine.frame(0.016, [0.1, 0.2, 0.3], forces, false);
    const u = lastUniform(stats);
    assert.deepEqual(slice(u, map.sound, 4), [f32(0.1), f32(0.2), f32(0.3), 0], 'short audio vector must be padded, not shift later fields');
    assert.equal(u[map.display], 1, 'palette slot must be intact');
    assert.equal(u[map.display + 3], gpuConstant('MAX_FORCES'), 'force count clamps to capacity and skips invalid entries');
    assert.deepEqual(slice(u, map.forces, 4), [1, 2, 3, 4], 'invalid forces are skipped, valid ones keep order');
    engine.frame(NaN, [NaN, 2, -1, 0], [], false);
    assert.ok([...lastUniform(stats)].every(Number.isFinite), 'NaN input must not reach the GPU');
  });
});

test('[mock device] pause freezes time and the burst queue; queued bursts fire after resume', async () => {
  const { map } = uniformLayout();
  await withEngine((engine, stats) => {
    engine.frame(0.02, [0, 0, 0, 0], [], false);
    const time = engine.time;
    engine.explode(0.1, 0.1);
    engine.frame(0.05, [0, 0, 0, 0], [], true);
    assert.equal(engine.time, time); assert.equal(lastUniform(stats)[map.clock + 1], 0, 'paused frame sends dt = 0');
    assert.equal(lastUniform(stats)[map.extra], 0, 'no burst may drain while paused');
    engine.frame(0.5, [0, 0, 0, 0], [], false);
    assert.ok(Math.abs(lastUniform(stats)[map.clock + 1] - 0.033) < 1e-6, 'GPU dt clamps at 0.033');
    assert.equal(lastUniform(stats)[map.extra], 1, 'queued burst fires after resume');
  });
});

test('[mock device] burst queue caps drain per frame and keeps the rest for later frames', async () => {
  const { map } = uniformLayout(), perFrame = gpuConstant('MAX_BURSTS');
  await withEngine((engine, stats) => {
    for (let i = 0; i < perFrame + 3; i++) engine.explode(i / 10, 0);
    engine.frame(0.016, [0, 0, 0, 0], [], false);
    assert.equal(lastUniform(stats)[map.extra], perFrame);
    engine.frame(0.016, [0, 0, 0, 0], [], false);
    assert.equal(lastUniform(stats)[map.extra], 3);
  });
});

test('[mock device] device loss is reported, intentional destroy is silent, dispose() destroys the device', async () => {
  await withEngine(async (engine, stats) => {
    const messages = []; engine.onError = m => messages.push(m);
    stats.devices[0].lose('destroyed', 'x'); await new Promise(r => setImmediate(r));
    assert.deepEqual(messages, [], 'intentional destroy must not show an error');
    stats.devices[0].lose('unknown', 'GPU reset');
  });
  await withEngine(async (engine, stats) => {
    const messages = []; engine.onError = m => messages.push(m);
    stats.devices[0].lose('unknown', 'GPU reset'); await new Promise(r => setImmediate(r));
    assert.equal(messages.length, 1); assert.match(messages[0], /GPU reset/);
    engine.dispose(); assert.equal(stats.destroyed, 1);
  });
});

// ---------------------------------------------------------------- gestures

function hand(open, x = .5, y = .5) {
  const points = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  points[9] = { x, y: y - .1, z: 0 };
  [[8, 6], [12, 10], [16, 14], [20, 18]].forEach(([tip, pip], k) => {
    const fx = x + (k - 1.5) * .03;
    points[pip] = { x: fx, y: y - .16, z: 0 };
    points[tip] = { x: fx, y: open ? y - .26 : y - .08, z: 0 };
  });
  return points;
}

test('synthetic hands: openness reads 1 for open and 0 for a fist', () => {
  assert.equal(openness(hand(true)), 1); assert.equal(openness(hand(false)), 0);
});

test('closed-to-open transition fires exactly one burst at the palm', () => {
  const g = new GestureTracker(); let t = 0; const bursts = [];
  for (const open of [false, false, false, true, true, true, true]) bursts.push(...g.update([hand(open)], t += 66));
  assert.equal(bursts.length, 1); assert.equal(Math.round(bursts[0].y * 1000) / 1000, .4);
});

test('an always-open hand and a single closed flicker never fire', () => {
  const g = new GestureTracker(); let t = 0, count = 0;
  for (let i = 0; i < 30; i++) count += g.update([hand(true)], t += 66).length;
  for (const open of [true, false, true, true, true]) count += g.update([hand(open)], t += 66).length;
  assert.equal(count, 0);
});

test('a rapid second close/open inside the cooldown is suppressed; a later one fires', () => {
  const g = new GestureTracker(); let t = 0, count = 0;
  const feed = states => states.forEach(open => { count += g.update([hand(open)], t += 66).length; });
  feed([false, false, true, true]); assert.equal(count, 1);
  feed([false, false, true, true]); assert.equal(count, 1);
  t += 900; feed([false, false, true, true]); assert.equal(count, 2);
});

test('two hands keep independent state regardless of detection order', () => {
  const g = new GestureTracker(); let t = 0; const bursts = [];
  const left = open => hand(open, .2, .5), right = open => hand(open, .8, .5);
  [[false, true], [false, true], [true, true], [true, true]].forEach(([l, r], i) => bursts.push(...g.update(i % 2 ? [right(r), left(l)] : [left(l), right(r)], t += 66)));
  assert.equal(bursts.length, 1, 'only the hand that closed then opened may fire');
  assert.ok(Math.abs(bursts[0].x - .2) < 1e-9);
});

test('two hands opening in the same frame both fire', () => {
  const g = new GestureTracker(); let t = 0; const bursts = [];
  for (const open of [false, false, true, true]) bursts.push(...g.update([hand(open, .2, .5), hand(open, .8, .5)], t += 66));
  assert.equal(bursts.length, 2);
});

test('a track that disappears for >600 ms is forgotten (no stale arming)', () => {
  const g = new GestureTracker(); let t = 0, count = 0;
  for (const open of [false, false]) g.update([hand(open)], t += 66);
  t += 700;
  for (const open of [true, true, true]) count += g.update([hand(open)], t += 66).length;
  assert.equal(count, 0);
});

// ---------------------------------------------------------------- audio

test('demo audio is labelled demo, finite, within 0..1 and has beats', () => {
  const audio = new AudioInput();
  assert.equal(audio.mode, 'demo');
  if ('synthetic' in audio) assert.equal(audio.synthetic, true);
  let peak = 0, floor = 1;
  for (let t = 0; t < 20; t += 0.037) {
    const bands = audio.sample(t);
    assert.equal(bands.length, 4);
    for (const b of bands) assert.ok(Number.isFinite(b) && b >= 0 && b <= 1, `band out of range at t=${t}: ${b}`);
    peak = Math.max(peak, bands[0]); floor = Math.min(floor, bands[0]);
  }
  assert.ok(peak - floor > 0.3, `demo bass should pulse (peak ${peak}, floor ${floor})`);
  audio.gain = 8; for (const b of audio.sample(0.5)) assert.ok(b <= 1.0001, 'gain must not push a band above 1');
});

// ---------------------------------------------------------------- harness pure logic

test('percentile and summarizeIntervals use real values and null for empty input', () => {
  assert.equal(harness.percentile([], 50), null);
  assert.equal(harness.percentile([10], 99), 10);
  assert.equal(harness.percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(harness.percentile([0, 10], 25), 2.5);
  const empty = harness.summarizeIntervals([]);
  assert.equal(empty.samples, 0); assert.equal(empty.fpsMean, null); assert.equal(empty.p99Ms, null);
  const s = harness.summarizeIntervals([10, 10, 10, 10, 50], 10);
  assert.equal(s.samples, 5); assert.equal(s.maxMs, 50); assert.equal(s.p50Ms, 10); assert.equal(s.meanMs, 18);
  assert.equal(s.slowFrames, 1); assert.equal(s.fpsMean, 55.6);
});

test('analyzeParticles detects non-finite, uninitialised and sparse data', () => {
  const count = 64, stride = 16, data = new Float32Array(count * stride);
  for (let i = 0; i < count; i++) { data[i * stride] = (i % 8) * .5 - 1.75; data[i * stride + 1] = Math.floor(i / 8) * .375 - 1.3; data[i * stride + 11] = 1; }
  const good = harness.analyzeParticles(data, count, stride);
  assert.deepEqual([good.nonFinite, good.uninitialized], [0, 0]); assert.equal(good.occupiedCellsOf64, 64);
  data[5] = NaN; data[stride * 3 + 11] = 0;
  const bad = harness.analyzeParticles(data, count, stride);
  assert.equal(bad.nonFinite, 1); assert.equal(bad.uninitialized, 1);
  assert.equal(harness.caseVerdict({ errors: [], run: { reason: 'complete' }, summary: { samples: 180, fpsMean: 60 }, readback: { performed: true, ...bad } }).status, 'fail');
  const clumped = new Float32Array(count * stride); for (let i = 0; i < count; i++) clumped[i * stride + 11] = 1;
  assert.equal(harness.analyzeParticles(clumped, count, stride).occupiedCellsOf64, 1, 'all-at-origin seed must show as one occupied cell');
});

test('caseVerdict never reports pass for errors, hidden tabs, early exits or missed minFps', () => {
  const ok = { errors: [], run: { reason: 'complete', hiddenDuring: false }, summary: { samples: 180, fpsMean: 90 } };
  assert.equal(harness.caseVerdict(ok).status, 'pass');
  assert.equal(harness.caseVerdict({ ...ok, errors: [{ message: 'x' }] }).status, 'fail');
  assert.equal(harness.caseVerdict({ ...ok, run: { reason: 'complete', exception: 'boom' } }).status, 'fail');
  assert.equal(harness.caseVerdict({ ...ok, run: { reason: 'complete', hiddenDuring: true } }).status, 'blocked');
  assert.equal(harness.caseVerdict({ ...ok, run: { reason: 'timeout' } }).status, 'fail');
  assert.equal(harness.caseVerdict({ ...ok, minFps: 120 }).status, 'fail');
  assert.equal(harness.caseVerdict({ ...ok, minFps: 60 }).status, 'pass');
});

test('overallVerdict: unavailable, blocked and skipped are never "pass"', () => {
  const v = harness.overallVerdict;
  assert.equal(v([]), 'not-run');
  assert.equal(v([{ status: 'pass' }, { status: 'pass' }]), 'pass');
  assert.equal(v([{ status: 'pass' }, { status: 'unavailable' }]), 'unavailable');
  assert.equal(v([{ status: 'pass' }, { status: 'blocked' }]), 'incomplete');
  assert.equal(v([{ status: 'skipped' }]), 'incomplete');
  assert.equal(v([{ status: 'unavailable' }, { status: 'fail' }]), 'fail');
});

test('planCases covers palettes, extra effects and the single stress case', () => {
  const base = { palettes: [0, 1, 2], count: 262144, maxCount: 262144, stress: true };
  assert.equal(harness.planCases(base).length, 4);
  assert.deepEqual(harness.planCases({ ...base, effects: [0, 1, 2], defaultEffect: 0 }).map(c => [c.palette, c.effect, c.stress]), [[0, 0, false], [1, 0, false], [2, 0, false], [0, 1, false], [0, 2, false], [0, 0, true]]);
  assert.equal(harness.planCases({ ...base, count: 32768 }).length, 3, 'stress only at the largest count');
  assert.equal(harness.planCases({ ...base, stress: false }).length, 3);
});

test('withTimeout rejects a promise that never settles', async () => {
  await assert.rejects(harness.withTimeout(new Promise(() => {}), 20, 'never'), /never timed out after 20 ms/);
  assert.equal(await harness.withTimeout(Promise.resolve(7), 1000, 'fast'), 7);
});

test('runtime.html exposes the Run verification button and a JSON <pre>', () => {
  const html = read('tests/runtime.html');
  assert.match(html, /<button id="run-all"[^>]*>Run verification<\/button>/);
  assert.match(html, /<pre id="results"[^>]*data-state="idle"/);
  assert.match(html, /<script type="module" src="\/tests\/runtime\.js">/);
  assert.deepEqual([...(html + read('tests/runtime.js')).matchAll(/https?:\/\/[^\s'")<>]+/g)].map(m => m[0]), [], 'harness must not reference remote URLs');
  assert.deepEqual(harness.COUNTS, [32768, 131072, 262144]);
});

test('vite.config-less build only bundles index.html, so the harness never ships', () => {
  const dist = new URL('dist/', root);
  if (!existsSync(dist)) return;
  assert.equal(existsSync(new URL('dist/tests/runtime.html', root)), false);
});

// ---------------------------------------------------------------- harness logic against the MOCK device (not a GPU test)

const smallArgs = { frames: 20, warmup: 3, baselineFrames: 10, counts: [32768, 262144], palettes: [0, 1, 2], stress: true, effects: [] };

test('[mock device] harness runs every count/palette plus the stress case and reports real structure', async () => {
  const mock = installMockBrowser();
  try {
    const report = await harness.runVerification('gpu', smallArgs);
    const gpu = report.sections.gpu;
    assert.equal(gpu.status, 'pass', JSON.stringify(gpu.cases.filter(c => c.status !== 'pass')));
    assert.equal(gpu.cases.length, 7, '3 palettes x 2 counts + 1 stress case');
    assert.equal(gpu.cases.filter(c => c.stress).length, 1);
    assert.equal(gpu.cases.find(c => c.stress).forceCount, 32);
    for (const c of gpu.cases) {
      assert.equal(c.rafIntervals.samples, 20); assert.equal(c.validation.frames, 3); assert.equal(c.validation.completedAwaitedOnGpu, true);
      assert.equal(typeof c.queueDrainAfterLoopMs, 'number'); assert.ok(c.jsEncodeSubmitMs.meanMs >= 0);
      assert.equal(c.finalReadback.performed, true, c.finalReadback.reason); assert.equal(c.finalReadback.nonFinite, 0);
    }
    assert.equal(gpu.cases[0].initialSeedReadback.performed, true); assert.equal(gpu.cases[1].initialSeedReadback, undefined, 'initial-seed readback only runs for the first case of an engine');
    assert.equal(gpu.adapter.info.vendor, 'mock'); assert.equal(gpu.inits.length, 2);
    assert.equal(gpu.inits[0].particleStrideBytes, gpuConstant('PARTICLE_BYTES'));
    assert.equal(report.sections.api.status, 'pass', JSON.stringify(report.sections.api));
    assert.equal(report.verdict, 'pass'); assert.equal(report.state, 'done');
    assert.equal(mock.stats.destroyed, 2, 'every engine device must be destroyed after its counts ran');
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
  } finally { mock.restore(); }
});

test('[mock device] extra effects run as additional palette-0 cases and are applied to the engine', async () => {
  const mock = installMockBrowser();
  try {
    const report = await harness.runVerification('gpu', { ...smallArgs, counts: [32768], effects: [0, 1, 2], stress: false });
    const cases = report.sections.gpu.cases;
    assert.deepEqual(cases.map(c => [c.palette, c.effect]), [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]]);
    assert.equal(report.sections.gpu.status, 'pass');
    assert.ok(mock.stats.uniformWrites.some((u, i) => u[uniformLayout().map.style] === 2), 'effect 2 must reach the uniform block');
  } finally { mock.restore(); }
});

test('[mock device] without COPY_SRC the readback is reported as not performed, never as passed', async () => {
  const mock = installMockBrowser({ readback: false });
  try {
    const report = await harness.runVerification('gpu', { ...smallArgs, counts: [32768], palettes: [0], stress: false });
    const c = report.sections.gpu.cases[0];
    assert.equal(c.finalReadback.performed, false); assert.match(c.finalReadback.reason, /COPY_SRC/);
    assert.equal(c.status, 'pass', 'missing readback is a coverage gap, reported in the JSON, not a failure');
  } finally { mock.restore(); }
});

test('[mock device] particle readback path: healthy data passes, NaN or uninitialised data fails the case', async () => {
  const healthy = healthyParticles;
  let mock = installMockBrowser({ readback: healthy });
  try {
    const report = await harness.runVerification('gpu', { ...smallArgs, counts: [32768], palettes: [0], stress: false });
    const c = report.sections.gpu.cases[0];
    assert.equal(c.finalReadback.performed, true); assert.equal(c.finalReadback.strideBytes, gpuConstant('PARTICLE_BYTES'));
    assert.equal(c.finalReadback.nonFinite, 0); assert.equal(c.initialSeedReadback.performed, true); assert.equal(c.status, 'pass', JSON.stringify(c.reason));
  } finally { mock.restore(); }
  mock = installMockBrowser({ readback: floats => { const data = healthy(floats); data[7] = NaN; return data; } });
  try {
    const report = await harness.runVerification('gpu', { ...smallArgs, counts: [32768], palettes: [0], stress: false });
    assert.equal(report.sections.gpu.cases[0].status, 'fail'); assert.match(report.sections.gpu.cases[0].reason, /non-finite/);
  } finally { mock.restore(); }
  mock = installMockBrowser({ readback: floats => { const data = healthy(floats); data[11] = 0; return data; } });
  try {
    const report = await harness.runVerification('gpu', { ...smallArgs, counts: [32768], palettes: [0], stress: false });
    assert.equal(report.sections.gpu.cases[0].status, 'fail'); assert.match(report.sections.gpu.cases[0].reason, /uninitialised/);
  } finally { mock.restore(); }
});

test('[mock device] a validation error from the GPU makes the case and the verdict fail', async () => {
  const mock = installMockBrowser({ validationError: true });
  try {
    const report = await harness.runVerification('gpu', { ...smallArgs, counts: [32768], palettes: [0], stress: false });
    assert.equal(report.sections.gpu.cases[0].status, 'fail'); assert.equal(report.verdict, 'fail');
    assert.match(JSON.stringify(report.sections.gpu.cases[0].errors), /mock validation failure/);
  } finally { mock.restore(); }
});

test('[mock device] a validation error raised inside the harness\'s own scoped frames fails the case', async () => {
  const mock = installMockBrowser({ validationError: 2 });
  try {
    const report = await harness.runVerification('gpu', { ...smallArgs, counts: [32768], palettes: [0], stress: false });
    const c = report.sections.gpu.cases[0];
    assert.equal(report.sections.gpu.inits[0].ok, true, 'engine init must have succeeded for this test to mean anything');
    assert.equal(c.status, 'fail'); assert.ok(c.validation.errors.some(e => e.source === 'GPUValidationError'));
  } finally { mock.restore(); }
});

test('[mock device] an uncaptured error during the animation loop fails the case', async () => {
  const mock = installMockBrowser({ uncapturedOnSubmit: 12 });
  try {
    const report = await harness.runVerification('gpu', { ...smallArgs, counts: [32768], palettes: [0], stress: false });
    const c = report.sections.gpu.cases[0];
    assert.equal(c.status, 'fail');
    const sources = c.errors.map(e => e.source);
    assert.ok(sources.includes('device.uncapturederror'), sources.join());
  } finally { mock.restore(); }
});

test('[mock device] a hidden tab is reported as blocked/incomplete, never pass', async () => {
  const mock = installMockBrowser({ hidden: true });
  try {
    const report = await harness.runVerification('gpu', { ...smallArgs, counts: [32768], palettes: [0], stress: false });
    assert.equal(report.sections.gpu.cases[0].status, 'blocked'); assert.notEqual(report.verdict, 'pass');
  } finally { mock.restore(); }
});

test('no WebGPU is reported as explicit unavailable, with no cases and no pass', async () => {
  const mock = installMockBrowser({ gpu: false });
  try {
    const report = await harness.runVerification('gpu', smallArgs);
    assert.equal(report.sections.gpu.status, 'unavailable'); assert.deepEqual(report.sections.gpu.cases, []);
    assert.match(report.sections.gpu.reason, /navigator\.gpu is undefined/);
    assert.equal(report.verdict, 'unavailable');
  } finally { mock.restore(); }
});

test('[mock device] failure simulations run through the real engine; missing Worker in Node is a failure, not a fake pass', async () => {
  const mock = installMockBrowser();
  try {
    const report = await harness.runVerification('failure', smallArgs);
    const checks = Object.fromEntries(report.sections.failureSimulations.checks.map(c => [c.id, c]));
    for (const id of ['no-webgpu', 'no-adapter', 'device-error-canary', 'real-uncaptured-error', 'synthetic-uncaptured-event', 'device-lost'])
      assert.equal(checks[id]?.status, 'pass', `${id}: ${JSON.stringify(checks[id])}`);
    assert.match(checks['no-webgpu'].message, /WebGPU/); assert.match(checks['no-adapter'].message, /adapter/i);
    assert.equal(checks['worker-frame-before-init'].status, 'fail');
    assert.match(checks['worker-frame-before-init'].message, /Worker is not defined/);
    assert.equal(report.verdict, 'fail');
  } finally { mock.restore(); }
});

// ---------------------------------------------------------------- worker section against a MOCK Worker (contract only)

function installMockWorker(mode) {
  class MockWorker {
    constructor(url) {
      this.url = String(url); this.ready = false; this.terminated = false;
      MockWorker.instances.push(this);
      if (mode === 'load-error') setTimeout(() => this.onerror?.({ message: 'Script error: 404' }), 1);
    }
    postMessage(data, transfer = []) {
      for (const object of transfer) object.width = 0; // transferred ImageBitmaps become detached
      setTimeout(() => {
        if (this.terminated) return;
        const reply = message => this.onmessage?.({ data: message });
        if (data.type === 'init') {
          if (mode === 'init-error') reply({ type: 'error', message: 'model load failed', fatal: true });
          else if (mode !== 'init-hang') { this.ready = true; reply({ type: 'ready' }); }
        } else if (data.type === 'frame') {
          if (!this.ready) {
            if (mode === 'result-before-init') reply({ type: 'result', hands: [], poses: [], ms: 1, timestamp: data.timestamp });
            else if (mode === 'error-before-init') reply({ type: 'error', message: 'not ready', fatal: false });
            return; // default: dropped silently, like src/tracking-worker.js
          }
          if (mode === 'frame-hang') return;
          if (mode === 'bad-shape') reply({ type: 'result', ms: 1, timestamp: data.timestamp });
          else reply({ type: 'result', hands: mode === 'detects-blank' ? [[]] : [], poses: [], handScores: [], ms: 12.3, handMs: 4.1, width: 640, height: 480, timestamp: data.timestamp, poseFresh: true, poseStride: 1 });
        }
      }, 1);
    }
    terminate() { this.terminated = true; if (mode === 'stray-after-terminate') setTimeout(() => this.onmessage?.({ data: { type: 'late' } }), 3); }
  }
  MockWorker.instances = [];
  globalThis.Worker = MockWorker;
  return { Worker: MockWorker, restore() { delete globalThis.Worker; } };
}

const workerArgs = { workerInitTimeoutMs: 80, workerFrameTimeoutMs: 80, closeWaitMs: 20 };
async function workerRun(mode, scope = 'worker') {
  const browser = installMockBrowser({ gpu: false }), workers = installMockWorker(mode);
  try { return { report: await harness.runVerification(scope, { ...smallArgs, ...workerArgs }), workers: workers.Worker.instances }; }
  finally { workers.restore(); browser.restore(); }
}

test('[mock worker] healthy contract: init, one synthetic frame, bounded close', async () => {
  const { report, workers } = await workerRun('ok');
  const w = report.sections.worker;
  assert.equal(w.status, 'pass', JSON.stringify(w));
  assert.equal(w.frame.ok, true); assert.equal(w.frame.workerReportedMs, 12.3); assert.equal(w.frame.bitmapDetachedAfterTransfer, true);
  assert.equal(w.frame.reportedFrameSize.join('x'), '640x480'); assert.match(w.syntheticFrame, /not a live camera/);
  assert.equal(w.close.terminated, true); assert.equal(workers.length, 1); assert.equal(workers[0].terminated, true);
  assert.equal(report.verdict, 'pass'); assert.equal(workers[0].url, '/tracking-worker.js');
});

test('[mock worker] init error, init hang, frame hang, bad shape, load error and stray messages all fail and still terminate', async () => {
  for (const [mode, pattern] of [['init-error', /model load failed/], ['init-hang', /worker init timed out after 80 ms/], ['frame-hang', /worker frame timed out/], ['bad-shape', /unexpected shape/], ['load-error', /Script error: 404/], ['stray-after-terminate', /kept posting messages after terminate/]]) {
    const { report, workers } = await workerRun(mode);
    assert.equal(report.sections.worker.status, 'fail', mode); assert.match(report.sections.worker.error, pattern, mode);
    assert.equal(workers.every(w => w.terminated), true, `${mode}: worker must be terminated even on failure`);
    assert.equal(report.verdict, 'fail');
  }
});

test('[mock worker] detections on a blank frame are surfaced as a warning, not hidden', async () => {
  const { report } = await workerRun('detects-blank');
  assert.equal(report.sections.worker.status, 'pass'); assert.match(report.sections.worker.warnings.join(), /blank frame produced 1 hand/);
});

test('[mock worker] frame-before-init: dropped or error reply passes, a result fails', async () => {
  for (const [mode, expected] of [['drop', 'pass'], ['error-before-init', 'pass'], ['result-before-init', 'fail']]) {
    const browser = installMockBrowser({ gpu: false }), workers = installMockWorker(mode);
    try {
      const report = await harness.runVerification('failure', { ...smallArgs, ...workerArgs });
      const check = report.sections.failureSimulations.checks.find(c => c.id === 'worker-frame-before-init');
      assert.equal(check.status, expected, `${mode}: ${JSON.stringify(check)}`);
    } finally { workers.restore(); browser.restore(); }
  }
});

test('[mock device] smoke modes and music activation are independent; silent pulses cannot enable lamps',async()=>{
 const {map}=uniformLayout();await withEngine((engine,stats)=>{
  engine.flowMode=1;engine.frame(1/60,[1,1,1,1],[],false);assert.deepEqual(slice(lastUniform(stats),map.simulation,2),[2,0]);
  engine.flowMode=2;engine.musicActive=true;engine.frame(1/60,[.5,.4,.3,.6],[],false);assert.deepEqual(slice(lastUniform(stats),map.simulation,2),[3,1]);
  engine.musicActive=false;engine.frame(1/60,[1,1,1,1],[],false);assert.equal(lastUniform(stats)[map.simulation+1],0);
 });
});

// Spectral smoke (simulation mode 4) must emit and light all nine ring bands round the full circle.
// The angular expressions are taken from the shader sources and evaluated here, so these checks follow the
// WGSL rather than a copy of it. Real GPU emission, jets and lighting are measured by tests/spectral-circle.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const loaderSource = `
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('?raw')) return { url: new URL(specifier.slice(0, -4), context.parentURL).href + '?raw', shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.endsWith('?raw')) return { format: 'module', source: 'export default ' + JSON.stringify(await readFile(fileURLToPath(url.slice(0, -4)), 'utf8')), shortCircuit: true };
  return next(url, context);
}`;
register('data:text/javascript,' + encodeURIComponent(loaderSource));
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const particles = read('src/particles.wgsl'), render = read('src/reference-render.wgsl'), volume = read('src/volume.wgsl');
const TAU = 6.2831853;
const fract = x => x - Math.floor(x);
const degrees = a => ((a * 180 / Math.PI) % 360 + 540) % 360 - 180;
const angleError = (a, b) => Math.abs(degrees(a - b));
// Band centres of the fluid ring: band 0 at the upper left (135 degrees), then clockwise in 40 degree steps.
const expected = i => (135 - 40 * i) * Math.PI / 180;

// Turns a WGSL scalar expression into a JS function of the named variables.
function compile(expression, names, constants = {}) {
  let js = expression.replace(/\bf32\(/g, '(').replace(/(\d+(?:\.\d+)?)u\b/g, '$1');
  for (const [name, value] of Object.entries(constants)) js = js.replace(new RegExp(`\\b${name}\\b`, 'g'), String(value));
  return new Function('fract', 'atan2', 'TAU', ...names, `return ${js};`).bind(null, fract, Math.atan2, TAU);
}
function functionBody(source, name) {
  const start = source.indexOf(`fn ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  return source.slice(start, source.indexOf('\n}\n', start) + 2);
}
const spectralStart = Number(particles.match(/const SPECTRAL_START = ([\d.]+);/)[1]);

test('fluid ring, spawn and both lights share one sector origin: bass at the upper left', () => {
  const fluidStart = Number(read('src/fluid.wgsl').match(/let angle=([\d.]+)-f32\(i\)\*TAU\/9\.0;/)[1]);
  assert.equal(spectralStart, fluidStart);
  assert.ok(Math.abs(spectralStart - 3 * Math.PI / 4) < 1e-6);
  for (const source of [render, volume]) assert.match(functionBody(source, 'spectralLight'), new RegExp(`\\(${String(spectralStart).replace('.', '\\.')} - atan2`));
});

test('music-active spawn covers all 360 degrees, with nine bands centred clockwise from the upper left', () => {
  const body = functionBody(particles, 'newSmoke');
  assert.doesNotMatch(body, /\/ 12\.0/, 'the old half-circle mapping must be gone');
  const offsetText = body.match(/let offset = (.+);/)[1].replace(/rnd\(key, 38u\)/, 'r1').replace(/rnd\(key, 39u\)/, 'r2');
  const sourceText = body.match(/source = (fract\(\(SPECTRAL_START.+\));/)[1];
  const offset = compile(offsetText, ['r1', 'r2']);
  const source = compile(sourceText, ['id', 'offset'], { SPECTRAL_START: spectralStart });
  const bins = new Array(72).fill(0), sums = Array.from({ length: 9 }, () => [0, 0]);
  let below = 0, total = 0;
  for (let id = 0; id < 9 * 400; id++) {
    for (const [r1, r2] of [[0, 0], [1, 1], [.5, .5], [fract(id * .61803398875), fract(id * .41421356237)], [fract(id * .75487766625), fract(id * .56984029099)]]) {
      const s = source(id, offset(r1, r2));
      assert.ok(s >= 0 && s < 1, 'source stays a 0..1 ring coordinate');
      const angle = s * TAU;
      bins[Math.floor(fract(angle / TAU) * bins.length)]++;
      sums[id % 9][0] += Math.cos(angle); sums[id % 9][1] += Math.sin(angle);
      below += Math.sin(angle) < 0; total++;
    }
  }
  assert.ok(bins.every(n => n > 0), `empty 5 degree bins: ${bins.map((n, i) => n ? '' : i * 5).filter(Boolean)}`);
  assert.ok(below / total > .4 && below / total < .6, `lower half carries ${(below / total * 100).toFixed(1)}% of the ring`);
  sums.forEach(([x, y], band) => assert.ok(angleError(Math.atan2(y, x), expected(band)) < 1, `band ${band} centre ${degrees(Math.atan2(y, x)).toFixed(1)}`));
  // Clockwise: each band sits 40 degrees further round than the previous one.
  for (let band = 1; band < 9; band++) assert.ok(angleError(Math.atan2(sums[band][1], sums[band][0]) + 40 * Math.PI / 180, Math.atan2(sums[band - 1][1], sums[band - 1][0])) < 1);
  const spread = Number(offsetText.match(/\* ([\d.]+)$/)[1]);
  assert.ok(spread >= .5 && spread < 1, 'neighbouring sectors overlap without swapping centres');
});

test('sector lookup in particles, filaments and volume returns each band at its own direction round the circle', () => {
  const lookups = [
    ['particles', functionBody(particles, 'spectralLevelAt').match(/let s = (.+);/)[1].replace(/radial\./g, '')],
    ['reference-render', functionBody(render, 'spectralLight').match(/let s = (.+);/)[1].replace(/xy\./g, '')],
    ['volume', functionBody(volume, 'spectralLight').match(/let s = (.+);/)[1].replace(/xy\./g, '')],
  ];
  for (const [name, text] of lookups) {
    const coordinate = compile(text, ['y', 'x'], { SPECTRAL_START: spectralStart });
    for (let band = 0; band < 9; band++) {
      const a = expected(band);
      const s = coordinate(Math.sin(a), Math.cos(a));
      assert.ok(Math.abs(s - band) < 1e-4 || Math.abs(s - band - 9) < 1e-4, `${name}: band ${band} direction gave sector ${s}`);
    }
    for (let k = 0; k < 720; k++) {
      const s = coordinate(Math.sin(k * TAU / 720), Math.cos(k * TAU / 720));
      assert.ok(s >= 0 && s < 9 && Number.isFinite(s), `${name}: coordinate ${s}`);
    }
    assert.ok(Number.isFinite(coordinate(0, 0)), `${name}: the exact centre must not produce NaN`);
  }
});

test('lighting is one function in both renderers and uses all nine levels, not the three half-circle lamps', () => {
  assert.equal(functionBody(render, 'spectralLight'), functionBody(volume, 'spectralLight'));
  const light = functionBody(render, 'spectralLight');
  assert.match(light, /params\.ringLevels\[i \/ 4u\]\[i % 4u\]/);
  assert.match(light, /params\.ringAttacks\[j \/ 4u\]\[j % 4u\]/);
  assert.match(light, /lightPalette\(params\.display\.x, f32\(i\) \/ 8\.0\)/, 'hue follows the band like the fluid ring');
  const filamentBranch = render.slice(render.indexOf('if (mode < 4.5) {'), render.indexOf('} else if ((mode < 5.5'));
  // Filaments keep the band of the sector they were born in (u is the birth angle as a 0..1 ring coordinate).
  assert.match(filamentBranch, /spectralLight\(vec2f\(cos\(u \* TAU\), sin\(u \* TAU\)\), 1\.4\)\.rgb, music\)/, 'silent/demo input leaves filament lamps off');
  assert.match(functionBody(particles, 'newSmoke'), /let angle = source \* TAU;[\s\S]*Particle\([\s\S]*vec4f\(source, age, 0\.0, life\)\)/, 'extra.x stores the birth angle');
  assert.doesNotMatch(filamentBranch, /radial\.x|sound\.xyz/);
  const ray = functionBody(volume, 'rayFragment');
  assert.match(ray, /select\(vec4f\(0\.0\), spectralLight\(q\.xy, 0\.65\), music\)/);
  assert.doesNotMatch(ray, /vec2f\(-0\.42|vec2f\(0\.42|sound\.xyz/);
  const simulate = functionBody(particles, 'simulateSmoke');
  assert.match(simulate, /spectralLevelAt\(radial\)/);
  assert.match(simulate, /\(spectral && length\(q\.xy\) > 1\.3\)/, 'every sector recycles at the same radius on wide screens');
  assert.doesNotMatch(simulate, /bassSide|highSide|midSide/);
});

test('silent sectors keep a dim baseline trickle while active sectors emit far faster', () => {
  const simulate = functionBody(particles, 'simulateSmoke');
  assert.match(simulate, /spectralLevel\(id % 9u\)/);
  const rateText = simulate.match(/let rate=select\(1\.8,(.+),params\.simulation\.y>\.5\);/)[1];
  const rate = compile(rateText, ['strength']);
  const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  const strength = level => smoothstep(.06, .85, level);
  const lifeMean = 6; // newSmoke: 4.5 + 3 * rnd
  const alive = r => r * lifeMean / (1 + r * lifeMean);
  assert.ok(rate(0) > 0, 'a silent band still emits');
  assert.ok(alive(rate(0)) > .15 && alive(rate(0)) < .35, `silent band density ${alive(rate(0)).toFixed(2)} stays dim but visible`);
  assert.ok(alive(rate(strength(.9))) > .95, 'a loud band fills its sector');
  assert.ok(rate(strength(.9)) / rate(0) > 50, 'active sectors dominate the baseline');
});

function mockDevice() {
  const log = { uniforms: [] };
  const pipeline = desc => ({ entry: desc.compute?.entryPoint ?? desc.fragment.entryPoint, getBindGroupLayout: () => ({}) });
  const device = {
    lost: new Promise(() => {}), addEventListener() {},
    createBuffer: desc => ({ size: desc.size, destroy() {} }),
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createSampler: () => ({}), createBindGroup: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createComputePipelineAsync: async desc => pipeline(desc), createRenderPipelineAsync: async desc => pipeline(desc),
    pushErrorScope() {}, popErrorScope: async () => null,
    queue: { writeBuffer: (_b, _o, data) => { if (data.length >= 100) log.uniforms.push(Float32Array.from(data)); }, submit() {} },
    createCommandEncoder: () => {
      const pass = () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, draw() {}, end() {} });
      return { beginComputePass: pass, beginRenderPass: pass, clearBuffer() {}, finish: () => ({}) };
    },
    destroy() {},
  };
  return { device, log };
}

test('flowMode 3 carries all nine ring levels and attacks to the spectral smoke shaders', async () => {
  const { ParticleEngine } = await import('../src/gpu.js');
  const { device, log } = mockDevice();
  const globals = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, GPUBufferUsage: { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 }, GPUTextureUsage: { COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 } };
  Object.assign(globalThis, globals);
  Object.defineProperty(globalThis.navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => ({ info: {}, limits: {}, requestDevice: async () => device }), getPreferredCanvasFormat: () => 'bgra8unorm' } });
  try {
    const engine = new ParticleEngine({ width: 0, height: 0, getContext: () => ({ configure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) }) });
    await engine.init();
    engine.flowMode = 3; engine.musicActive = true;
    engine.ringBands = [.1, .2, .3, .4, .5, .6, .7, .8, .9]; engine.ringAttacks = [0, 0, 0, 0, 0, .7, 0, 0, 1];
    engine.frame(1 / 60, [0, 0, 0, 0], [], false);
    const u = log.uniforms.at(-1);
    assert.equal(u[312], 4);
    // Parameters.ringLevels / ringAttacks start at floats 324 and 336; band i is [i / 4][i % 4].
    for (let i = 0; i < 9; i++) {
      assert.ok(Math.abs(u[324 + i] - engine.ringBands[i]) < 1e-6, `level ${i}`);
      assert.ok(Math.abs(u[336 + i] - engine.ringAttacks[i]) < 1e-6, `attack ${i}`);
    }
    // Without a nine-band analyser the ring still receives levels spread from the three coarse bands.
    engine.ringBands = null; engine.ringAttacks = null; engine.emissionBands = null;
    engine.frame(1 / 60, [1, 0, .5, 1], [], false);
    assert.deepEqual(Array.from(log.uniforms.at(-1).slice(324, 333)), [1, 1, 0, 0, 0, 0, .5, .5, .5]);
  } finally { for (const key of Object.keys(globals)) delete globalThis[key]; delete globalThis.navigator.gpu; }
});

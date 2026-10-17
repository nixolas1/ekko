// Spectral smoke (simulation mode 4) wiring checks against a recording MOCK WebGPU device. No real GPU runs here:
// these tests check mode mapping, pass scheduling, bounded splat cost and shader/JS constant agreement only.
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
const { ParticleEngine } = await import('../src/gpu.js');

function mockDevice() {
  const log = { passes: [], uniforms: [], textures: [] };
  const pipeline = desc => ({ entry: desc.compute?.entryPoint ?? desc.fragment.entryPoint, getBindGroupLayout: () => ({}) });
  const device = {
    lost: new Promise(() => {}), addEventListener() {},
    createBuffer: desc => ({ size: desc.size, destroy() {} }),
    createTexture: desc => { log.textures.push(desc); return { createView: () => ({}), destroy() {} }; },
    createSampler: () => ({}), createBindGroup: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createComputePipelineAsync: async desc => pipeline(desc), createRenderPipelineAsync: async desc => pipeline(desc),
    pushErrorScope() {}, popErrorScope: async () => null,
    queue: { writeBuffer: (_b, _o, data) => { if (data.length >= 100) log.uniforms.push(Float32Array.from(data)); }, submit() {} },
    createCommandEncoder: () => {
      const pass = kind => { let current; return { setPipeline: p => { current = p.entry; }, setBindGroup() {}, dispatchWorkgroups: n => log.passes.push([current, n]), draw: () => log.passes.push([current, kind]), end() {} }; };
      return { beginComputePass: () => pass('compute'), beginRenderPass: () => pass('draw'), clearBuffer() {}, finish: () => ({}) };
    },
    destroy() {},
  };
  return { device, log };
}
async function withEngine(fn, limits={}) {
  const { device, log } = mockDevice();
  const globals = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, GPUBufferUsage: { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 }, GPUTextureUsage: { COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 } };
  Object.assign(globalThis, globals);
  Object.defineProperty(globalThis.navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => ({ info: {}, limits, requestDevice: async options => { log.requested=options;return device; } }), getPreferredCanvasFormat: () => 'bgra8unorm' } });
  try {
    const engine = new ParticleEngine({ width: 0, height: 0, getContext: () => ({ configure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) }) });
    await engine.init();
    log.passes.length = 0;
    await fn(engine, log);
  } finally { for (const key of Object.keys(globals)) delete globalThis[key]; delete globalThis.navigator.gpu; }
}
const entries = log => log.passes.map(p => p[0]);
const simulationMode = log => log.uniforms.at(-1)[312];

test('flowMode 3 maps to simulation mode 4 and schedules splat, light, raymarch and upscale passes', async () => {
  await withEngine((engine, log) => {
    engine.flowMode = 3; engine.musicActive = true;
    engine.frame(1 / 60, [0.9, 0.1, 0.4, 0.6], [], false);
    assert.equal(simulationMode(log), 4);
    assert.equal(log.uniforms.at(-1)[313], 1, 'music activation reaches the shader');
    const order = entries(log);
    for (const entry of ['buildNoise', 'binParticles', 'simulate', 'voxelize', 'lightColumns', 'referenceFragment', 'rayFragment', 'volumeFragment', 'compositeFragment']) assert.ok(order.includes(entry), `${entry} missing`);
    assert.ok(order.indexOf('simulate') < order.indexOf('voxelize'), 'volume must follow the simulated positions');
    assert.ok(order.indexOf('voxelize') < order.indexOf('lightColumns') && order.indexOf('lightColumns') < order.indexOf('rayFragment'));
    assert.ok(order.indexOf('rayFragment') < order.indexOf('volumeFragment') && order.indexOf('volumeFragment') < order.indexOf('compositeFragment'));
    assert.deepEqual(log.passes.find(p => p[0] === 'lightColumns'), ['lightColumns', 72], 'one thread per 96x48 column');
    log.passes.length = 0;
    engine.frame(1 / 60, [0, 0, 0, 0], [], false);
    assert.ok(!entries(log).includes('buildNoise'), 'detail noise is generated once');
  });
});

test('other modes never run volume passes, keep their composite source, and the mapping is unchanged', async () => {
  await withEngine((engine, log) => {
    for (const [flowMode, persistent, mode] of [[0, false, 0], [0, true, 1], [1, false, 2], [2, false, 3]]) {
      engine.flowMode = flowMode; engine.persistent = persistent; log.passes.length = 0;
      engine.frame(1 / 60, [0, 0, 0, 0], [], false);
      assert.equal(simulationMode(log), mode);
      assert.deepEqual(entries(log).filter(e => ['buildNoise', 'voxelize', 'lightColumns', 'rayFragment', 'volumeFragment'].includes(e)), []);
    }
    assert.ok(!log.textures.some(t => t.dimension === undefined && t.size?.[0] === 640), 'half-resolution smoke target is only made for spectral smoke');
  });
});

test('splat cost is bounded at any particle count', async () => {
  await withEngine((engine, log) => {
    engine.flowMode = 3;
    for (const [count, groups] of [[32768, 128], [262144, 1024], [1048576, 1024], [2097152, 1024], [3145728, 1024]]) {
      engine.count = count; log.passes.length = 0;
      engine.frame(1 / 60, [0, 0, 0, 0], [], false);
      assert.equal(log.passes.find(p => p[0] === 'voxelize')[1], groups, `count ${count}`);
    }
  });
});

test('pause keeps the last volume: no simulation or splatting, yet the spectral frame still composites', async () => {
  await withEngine((engine, log) => {
    engine.flowMode = 3;
    engine.frame(1 / 60, [0, 0, 0, 0], [], false);
    log.passes.length = 0;
    engine.frame(1 / 60, [0, 0, 0, 0], [], true);
    const order = entries(log);
    assert.deepEqual(order.filter(e => ['simulate', 'voxelize', 'lightColumns'].includes(e)), []);
    assert.ok(order.includes('compositeFragment'));
    engine.resize(true); log.passes.length = 0;
    engine.frame(1 / 60, [0, 0, 0, 0], [], true);
    assert.ok(entries(log).includes('rayFragment') && entries(log).includes('volumeFragment'), 'rebuilt targets are re-rendered from the kept grid while paused');
  });
});

test('volume constants agree between gpu.js and volume.wgsl; fixed point cannot overflow', () => {
  const gpu = read('src/gpu.js'), wgsl = read('src/volume.wgsl');
  const grid = gpu.match(/VOLUME_GRID=\[(\d+),(\d+),(\d+)\]/).slice(1).map(Number);
  assert.deepEqual(['VX', 'VY', 'VZ'].map(n => Number(wgsl.match(new RegExp(`const ${n} = (\\d+)u;`))[1])), grid);
  const splats = Number(gpu.match(/VOLUME_SPLATS=(\d+)/)[1]), fixed = Number(wgsl.match(/const FIXED = ([\d.]+);/)[1]);
  assert.ok(splats * fixed < 2 ** 32, 'one cell receiving every splat must stay below u32 range');
  const fields = wgsl.match(/struct VolumeParams \{([\s\S]*?)\n\}/)[1].split('\n').filter(l => /:\s*vec4f/.test(l)).length;
  assert.equal(fields * 4, Number(gpu.match(/volumeData=new Float32Array\((\d+)\)/)[1]), 'volume uniform size');
  assert.equal(Number(gpu.match(/CAMERA_DISTANCE=1\/([\d.]+)/)[1]), Number(read('src/render.wgsl').match(/clamp\(p\.position\.z, -1\.0, 1\.0\) \* ([\d.]+)/)[1]), 'raymarch camera must match render.wgsl perspective');
});

test('4K keeps native sharp filaments while bounding broad volumetric lighting work', async()=>{
 await withEngine((engine,log)=>{
  engine.resolution='4k';engine.flowMode=3;engine.resize(true);engine.frame(1/60,[0,0,0,0],[],false);
  assert.equal(engine.canvas.width,3840);assert.deepEqual(engine.sceneSize,[3840,2160]);
  assert(entries(log).includes('referenceFragment'));
  assert(log.textures.some(t=>t.size[0]===640&&t.size[1]===360),'bounded light target missing');
  assert.equal(engine.volumeData[6],24,'raymarch work stays bounded at 4K');
 });
});

test('limited adapters cap particle allocation and requests to their actual buffer limits',async()=>{
 await withEngine((engine,log)=>{
  assert.equal(engine.capacity,2097152);assert.equal(engine.buffer.size,134217728);
  assert.equal(log.requested.requiredLimits.maxStorageBufferBindingSize,134217728);
  engine.count=3145728;engine.frame(1/60,[0,0,0,0],[],false);
  assert.equal(log.uniforms.at(-1)[3],2097152);
 },{maxStorageBufferBindingSize:134217728,maxBufferSize:268435456});
});
test('three million coincident particles cannot overflow signed density sums',()=>{
 assert(3145728*511<2147483647);
 assert.match(read('src/particles.wgsl'),/fract\(gridPos.x\) \* 512.0/);
});

test('smoke mode runs the fluid solver, bypasses particle work and freezes density on pause', async()=>{
  await withEngine((engine,log)=>{
    engine.flowMode=1;engine.count=3145728;
    engine.frame(1/60,[0,0,0,0],[],false);
    const order=entries(log);
    for(const name of ['advectVelocity','curl','confine','divergence','pressure','project','dyeForward','dyeBackward','dyeCorrect','fluidFragment'])assert.ok(order.includes(name),name);
    for(const name of ['binParticles','simulate','voxelize','referenceFragment'])assert.ok(!order.includes(name),name);
    assert.equal(order.filter(x=>x==='pressure').length,32);
    assert.ok(order.indexOf('project')<order.indexOf('dyeForward'));
    const allocations=log.textures.length;
    log.passes.length=0;engine.count=32768;engine.frame(1/60,[1,1,1,1],[[0,0,16,.5]],true);
    assert.ok(!entries(log).includes('dyeCorrect'));
    assert.ok(!entries(log).includes('advectVelocity'));
    assert.equal(log.textures.length,allocations,'particle amount cannot reset fluid density');
  });
});

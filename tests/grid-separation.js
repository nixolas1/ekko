import common from '../src/common-shader.wgsl?raw';
import particles from '../src/particles.wgsl?raw';

// Actual WebGPU compute/readback test of binParticles + separation(), isolated from the rest of the
// simulation: the code above `fn tri` in particles.wgsl is compiled with small seeding, probing,
// stepping and histogram kernels. runGridSeparation(section) also accepts another version of that
// section (e.g. `git show HEAD:src/particles.wgsl`) so before/after numbers come from one harness.
const SECTION = particles.slice(0, particles.indexOf('\nfn tri('));
const ASPECT = 16 / 9, GRID = 128, MAX = 3145728, DT = 1 / 60, STEPS = 300;
const FIXTURE = `
struct Fixture { mode: f32, centerX: f32, centerY: f32, sigma: f32 }
@group(0) @binding(3) var<uniform> fixture: Fixture;
@group(0) @binding(4) var<storage, read> probes: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> probeOut: array<vec2f>;
@group(0) @binding(6) var<storage, read_write> phases: array<atomic<u32>, 64>;
@compute @workgroup_size(256) fn seedParticles(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= u32(params.clock.w)) { return; }
  var q = vec2f(fixture.centerX, fixture.centerY);
  if (fixture.mode < 0.5) { q = (vec2f(rnd(id, 1u), rnd(id, 2u)) * 2.0 - 1.0) * vec2f(params.clock.z, 1.0) * 0.98; }
  else if (fixture.mode < 1.5) { let a = rnd(id, 4u) * TAU; q += fixture.sigma * sqrt(-2.0 * log(max(rnd(id, 3u), 1e-7))) * vec2f(cos(a), sin(a)); }
  particles[id] = Particle(vec4f(q, 0.0, 0.0), vec4f(0.0), vec4f(0.0, 0.0, 1.0, 1.0), vec4f(0.0));
}
@compute @workgroup_size(64) fn probeSeparation(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&probes)) { return; }
  probeOut[i] = separation(probes[i].xy, u32(probes[i].z));
}
// Airbender's use of the force: full-strength separation, its weak damping, speed limit and walls.
@compute @workgroup_size(256) fn stepSeparation(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= u32(params.clock.w)) { return; }
  var p = particles[id];
  let dt = params.clock.y;
  var v = p.velocity.xy * exp(-dt * 0.32) + separation(p.position.xy, id) * dt;
  v *= min(1.0, 5.0 / max(length(v), 0.0001));
  var q = p.position.xy + v * dt;
  let bounds = vec2f(params.clock.z, 1.0) * 0.98;
  for (var axis = 0u; axis < 2u; axis++) {
    if (abs(q[axis]) > bounds[axis]) { q[axis] = clamp(q[axis], -bounds[axis], bounds[axis]); v[axis] = -sign(q[axis]) * abs(v[axis]) * 0.65; }
  }
  p.position = vec4f(q, p.position.zw);
  p.velocity = vec4f(v, p.velocity.zw);
  particles[id] = p;
}
// Where particles sit inside their 1/128 cell, 8×8 sub-cell bins, away from the walls.
@compute @workgroup_size(256) fn phaseHistogram(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= u32(params.clock.w)) { return; }
  let q = particles[id].position.xy;
  if (!(abs(q.x) < params.clock.z * 0.9 && abs(q.y) < 0.9)) { return; }
  let g = (q / vec2f(params.clock.z, 1.0) * 0.5 + 0.5) * f32(GRID);
  let b = min(vec2u(fract(g) * 8.0), vec2u(7u));
  atomicAdd(&phases[b.y * 8u + b.x], 1u);
}`;

async function harness(section) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const limit = Math.min(adapter.limits.maxStorageBufferBindingSize, adapter.limits.maxBufferSize);
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: limit, maxBufferSize: limit } });
  const errors = [];
  device.addEventListener('uncapturederror', e => errors.push(e.error.message));
  const module = device.createShaderModule({ code: common + '\n' + section + '\n' + FIXTURE });
  const compile = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
  if (compile.length) throw new Error(compile.map(m => `${m.lineNum}: ${m.message}`).join('\n'));
  const capacity = Math.min(MAX, Math.floor(limit / 64 / 16384) * 16384);
  const S = GPUBufferUsage.STORAGE, D = GPUBufferUsage.COPY_DST, C = GPUBufferUsage.COPY_SRC;
  const buffers = {
    0: device.createBuffer({ size: capacity * 64, usage: S | D | C }),
    1: device.createBuffer({ size: 2048, usage: GPUBufferUsage.UNIFORM | D }),
    2: device.createBuffer({ size: GRID * GRID * 16, usage: S | D | C }),
    3: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | D }),
    6: device.createBuffer({ size: 256, usage: S | D | C }),
  };
  const pipelines = {}, uses = { seedParticles: [0, 1, 3], binParticles: [0, 1, 2], probeSeparation: [1, 2, 4, 5], stepSeparation: [0, 1, 2], phaseHistogram: [0, 1, 6] };
  for (const entryPoint of Object.keys(uses)) pipelines[entryPoint] = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } });
  const group = (entry, extra = {}) => device.createBindGroup({ layout: pipelines[entry].getBindGroupLayout(0), entries: uses[entry].map(binding => ({ binding, resource: { buffer: extra[binding] ?? buffers[binding] } })) });
  const groups = Object.fromEntries(['seedParticles', 'binParticles', 'stepSeparation', 'phaseHistogram'].map(e => [e, group(e)]));
  let count = 0;
  const pass = (encoder, entry, workgroups, bindGroup = groups[entry]) => { const p = encoder.beginComputePass(); p.setPipeline(pipelines[entry]); p.setBindGroup(0, bindGroup); p.dispatchWorkgroups(workgroups); p.end(); };
  const read = async (buffer, size, Type = Float32Array) => {
    const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(buffer, 0, staging, 0, size); device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ); const data = new Type(staging.getMappedRange().slice(0)); staging.unmap(); staging.destroy(); return data;
  };
  // clock.x advances per step as in gpu.js, so any per-frame behaviour keyed on time is exercised.
  const params = (n, time = 0) => { const u = new Float32Array(512); u.set([time, DT, ASPECT, n]); u[312] = 1; device.queue.writeBuffer(buffers[1], 0, u); count = n; };
  const bin = encoder => { encoder.clearBuffer(buffers[2]); pass(encoder, 'binParticles', Math.ceil(count / 256)); };
  return {
    device, errors, capacity,
    seed(n, mode, cx = 0, cy = 0, sigma = 0) {
      params(n); device.queue.writeBuffer(buffers[3], 0, new Float32Array([mode, cx, cy, sigma]));
      const encoder = device.createCommandEncoder(); pass(encoder, 'seedParticles', Math.ceil(n / 256)); device.queue.submit([encoder.finish()]);
    },
    poke(index, values) { device.queue.writeBuffer(buffers[0], index * 64, new Float32Array(values)); },
    async probe(points) {
      const probes = device.createBuffer({ size: points.byteLength, usage: S | D }), out = device.createBuffer({ size: points.length / 2 * 4, usage: S | C });
      device.queue.writeBuffer(probes, 0, points);
      const encoder = device.createCommandEncoder(); bin(encoder); pass(encoder, 'probeSeparation', Math.ceil(points.length / 4 / 64), group('probeSeparation', { 4: probes, 5: out })); device.queue.submit([encoder.finish()]);
      const result = await read(out, out.size); probes.destroy(); out.destroy(); return result;
    },
    async step(steps) {
      for (let s = 0; s < steps; s++) { params(count, (s + 1) * DT); const encoder = device.createCommandEncoder(); bin(encoder); pass(encoder, 'stepSeparation', Math.ceil(count / 256)); device.queue.submit([encoder.finish()]); }
      await device.queue.onSubmittedWorkDone();
    },
    async phases() { const e = device.createCommandEncoder(); e.clearBuffer(buffers[6]); pass(e, 'phaseHistogram', Math.ceil(count / 256)); device.queue.submit([e.finish()]); return read(buffers[6], 256, Uint32Array); },
    densityMass: async () => read(buffers[2], GRID * GRID * 16, Uint32Array),
    positions: async () => read(buffers[0], count * 64),
  };
}

const world = (gx, gy) => [(gx / GRID - 0.5) * 2 * ASPECT, (gy / GRID - 0.5) * 2];
const length = (a, i) => Math.hypot(a[i * 2], a[i * 2 + 1]);

// 1. Uniform random cloud: the cell-periodic (lattice) part of the force, found by averaging the
//    acceleration at each of 8×8 sub-cell phases over 64×64 cells, must sit at the noise floor.
async function latticeBias(h, n) {
  h.seed(n, 0);
  const points = new Float32Array(64 * 64 * 64 * 4);
  let i = 0;
  for (let cy = 32; cy < 96; cy++) for (let cx = 32; cx < 96; cx++) for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
    const [x, y] = world(cx + (px + 0.5) / 8, cy + (py + 0.5) / 8); points.set([x, y, i / 4 % 65536, 0], i); i += 4;
  }
  const a = await h.probe(points), phase = new Float64Array(128);
  let squares = 0, nonFinite = 0, largest = 0;
  for (let k = 0; k < a.length / 2; k++) {
    if (!Number.isFinite(a[2 * k]) || !Number.isFinite(a[2 * k + 1])) { nonFinite++; continue; }
    phase[(k % 64) * 2] += a[2 * k]; phase[(k % 64) * 2 + 1] += a[2 * k + 1];
    squares += a[2 * k] ** 2 + a[2 * k + 1] ** 2; largest = Math.max(largest, length(a, k));
  }
  const cells = 4096, rms = Math.sqrt(squares / (a.length / 2));
  let bias = 0; for (let p = 0; p < 64; p++) bias += (phase[2 * p] / cells) ** 2 + (phase[2 * p + 1] / cells) ** 2;
  const phaseBiasRms = Math.sqrt(bias / 64), noiseFloor = rms / Math.sqrt(cells);
  return { particles: n, accelerationRms: rms, phaseBiasRms, noiseFloor, largest, nonFinite, pass: !nonFinite && phaseBiasRms < 3 * noiseFloor + 0.01 };
}

// 2. Airbender dynamics from the uniform cloud: after 5 s particles must still fill their cells evenly.
async function evolution(h, n) {
  h.seed(n, 0);
  const initial = Array.from(await h.phases()), initialMean = initial.reduce((s, b) => s + b, 0) / 64;
  const initialPhaseDeviationRms = Math.sqrt(initial.reduce((s, b) => s + (b / initialMean - 1) ** 2, 0) / 64);
  const start = performance.now(); await h.step(STEPS); const msPerStep = (performance.now() - start) / STEPS;
  const bins = Array.from(await h.phases()), mean = bins.reduce((s, b) => s + b, 0) / 64;
  const deviation = bins.map(b => b / mean - 1), rms = Math.sqrt(deviation.reduce((s, d) => s + d * d, 0) / 64);
  // Occupancy along each axis separates x/y and cell-centre/border structure in the report.
  const axis = (pick) => Array.from({ length: 8 }, (_, i) => +(deviation.filter((_, b) => pick(b) === i).reduce((s, d) => s + d, 0) / 8).toFixed(3));
  return { particles: n, steps: STEPS, msPerStep, initialPhaseDeviationRms, phaseDeviationRms: rms, phaseRange: [Math.min(...deviation), Math.max(...deviation)], occupancyX: axis(b => b % 8), occupancyY: axis(b => b >> 3), pass: rms < 0.02 };
}

// 3. Smooth blob: force points outward on its flank, and stays continuous across cell borders.
//    discontinuity = largest probe-to-probe change / larger neighbouring change (≈1 continuous, ≫1 jumps).
async function blob(h) {
  const n = 262144, cx = 0.13, cy = -0.07, sigma = 0.15, perCell = 16, span = 24 * perCell;
  h.seed(n, 1, cx, cy, sigma);
  const ring = 4096, points = new Float32Array((ring + span * 2) * 4);
  for (let k = 0; k < ring; k++) { const a = k / ring * Math.PI * 2; points.set([cx + Math.cos(a) * sigma, cy + Math.sin(a) * sigma, k, 0], k * 4); }
  const [gx0, gy0] = [(cx / (2 * ASPECT) + 0.5) * GRID - 12, (cy + 0.6 * sigma) / 2 * GRID + GRID / 2];
  for (let k = 0; k < span; k++) {
    points.set([...world(gx0 + k / perCell, gy0), 12345, 0], (ring + k) * 4);
    points.set([...world((cx + 0.6 * sigma) / (2 * ASPECT) * GRID + GRID / 2 + 0.31, (cy / 2 + 0.5) * GRID - 12 + k / perCell), 12345, 0], (ring + span + k) * 4);
  }
  const a = await h.probe(points);
  let outward = 0, nonFinite = 0, largest = 0;
  for (let k = 0; k < ring + 2 * span; k++) { if (!Number.isFinite(length(a, k))) nonFinite++; else largest = Math.max(largest, length(a, k)); }
  for (let k = 0; k < ring; k++) { const t = k / ring * Math.PI * 2; outward += a[2 * k] * Math.cos(t) + a[2 * k + 1] * Math.sin(t); }
  const discontinuity = offset => {
    const d = []; for (let k = 0; k + 1 < span; k++) { const i = offset + k; d.push(Math.hypot(a[2 * i + 2] - a[2 * i], a[2 * i + 3] - a[2 * i + 1])); }
    let worst = 0; const floor = 1e-4;
    for (let k = 1; k + 1 < d.length; k++) worst = Math.max(worst, d[k] / Math.max(d[k - 1], d[k + 1], floor));
    return worst;
  };
  const horizontal = discontinuity(ring), vertical = discontinuity(ring + span);
  outward /= ring;
  return { particles: n, meanOutwardAtSigma: outward, discontinuity: { horizontal, vertical }, largest, nonFinite, pass: !nonFinite && largest <= 14.001 && outward > 0.1 && horizontal < 2.5 && vertical < 2.5 };
}

// 4. The full pool on one point plus one NaN particle: exact fixed-point mass (no u32 wrap),
//    finite bounded forces, and stacked particles pushed apart in varied directions.
async function coincident(h, n) {
  const cx = 0.3, cy = 0.2;
  h.seed(n, 2, cx, cy); h.poke(0, [NaN, NaN, 0, 0]);
  const probes = 4096, points = new Float32Array(probes * 4);
  for (let k = 0; k < probes; k++) points.set([cx, cy, k * 769 + 1, 0], k * 4);
  const a = await h.probe(points), cells = await h.densityMass();
  let mass = 0; for (let i = 0; i < GRID * GRID; i++) mass += cells[i * 4];
  let nonFinite = 0, largest = 0, magnitude = 0, sx = 0, sy = 0;
  for (let k = 0; k < probes; k++) {
    const m = length(a, k); if (!Number.isFinite(m)) { nonFinite++; continue; }
    largest = Math.max(largest, m); magnitude += m; sx += a[2 * k]; sy += a[2 * k + 1];
  }
  magnitude /= probes;
  const coherence = Math.hypot(sx, sy) / probes / Math.max(magnitude, 1e-9);
  const massExact = mass === n * 1024 || mass === (n - 1) * 1024;
  return { particles: n, mass, expectedMass: n * 1024, massExact, meanMagnitude: magnitude, directionCoherence: coherence, largest, nonFinite, pass: massExact && !nonFinite && largest <= 14.001 && magnitude > 0.5 && coherence < 0.2 };
}

// 5. A coincident stack (as tests/forces.html starts Airbender) must open up, but gently: report the
//    spread after 1 s of Airbender dynamics with no other forces.
async function stackBurst(h) {
  const n = 32768; h.seed(n, 2, 0, 0); await h.step(60);
  const data = await h.positions(); let radius = 0, nonFinite = 0;
  for (let i = 0; i < n; i++) { const r = Math.hypot(data[i * 16], data[i * 16 + 1]); if (Number.isFinite(r)) radius += r; else nonFinite++; }
  radius /= n;
  return { particles: n, meanRadiusAfter1s: radius, nonFinite, pass: !nonFinite && radius > 0.005 };
}

export async function runGridSeparation(section = SECTION) {
  const h = await harness(section), n = h.capacity;
  try {
    const result = { lattice: await latticeBias(h, n), evolution: await evolution(h, Math.min(n, 1048576)), evolutionFull: await evolution(h, n), blob: await blob(h), coincident: await coincident(h, n), stackBurst: await stackBurst(h) };
    result.errors = h.errors;
    result.pass = !h.errors.length && ['lattice', 'evolution', 'evolutionFull', 'blob', 'coincident', 'stackBurst'].every(k => result[k].pass);
    return result;
  } finally { h.device.destroy(); }
}
window.runGridSeparation = runGridSeparation;

document.querySelector('#run').onclick = async () => {
  const output = document.querySelector('#result');
  output.textContent = 'running';
  try {
    const result = await runGridSeparation();
    output.textContent = JSON.stringify({ pass: result.pass, method: 'Actual WebGPU compute/readback of binParticles + separation(): sub-cell force bias in a uniform cloud, sub-cell occupancy after Airbender dynamics, blob repulsion and border continuity, 3M coincident fixed-point bound', ...result }, null, 2);
  } catch (error) { output.textContent = JSON.stringify({ pass: false, error: error.message }, null, 2); }
};

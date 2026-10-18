// Static and model checks for the grid-free particle separation (binParticles + separation in particles.wgsl).
// No GPU runs here. The real compute/readback test is tests/grid-separation.html, run in Chrome with
// `node tests/grid-separation.browser.mjs [--compare]`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const particles = read('src/particles.wgsl'), gpu = read('src/gpu.js');
const section = particles.slice(0, particles.indexOf('\nfn tri('));

test('the fixture can isolate the separation section', () => {
  assert.ok(particles.includes('\nfn tri('), 'grid-separation.js cuts particles.wgsl at fn tri');
  for (const name of ['fn binParticles', 'fn separation', 'struct DensityCell']) assert.ok(section.includes(name), name);
  assert.match(read('tests/grid-separation.html'), /<button id="run">[\s\S]*src="\.\/grid-separation\.js"/);
  assert.match(read('tests/grid-separation.js'), /indexOf\('\\nfn tri\('\)/);
});

test('fixed-point node mass cannot wrap a u32 even with the whole pool on one node', () => {
  const max = Number(gpu.match(/MAX_PARTICLES=(\d+)/)[1]);
  const nodeMass = Number(section.match(/const NODE_MASS = ([\d.]+);/)[1]);
  assert.match(section, /\* 32\.0\)\), vec2u\(32u\)\)/, 'fractions are clamped to 0..32');
  assert.equal(nodeMass, 32 * 32);
  // The four bilinear weights always sum to exactly 32², so no particle adds more than NODE_MASS anywhere.
  for (let x = 0; x <= 32; x++) for (let y = 0; y <= 32; y++) assert.equal((32 - x) * (32 - y) + x * (32 - y) + (32 - x) * y + x * y, nodeMass);
  assert.ok(max * nodeMass <= 2 ** 32 - 1, `${max} × ${nodeMass} must fit in u32`);
  assert.equal((section.match(/atomicAdd\(&density\[/g) || []).length, 4, 'four bilinear deposits per particle');
});

test('density layout matches the buffer gpu.js allocates, without per-cell centroids', () => {
  assert.match(section, /struct DensityCell \{ mass: atomic<u32>, unused: array<u32, 3> \}/);
  assert.match(section, /const GRID = 128u;/);
  assert.match(gpu, /this\.density=device\.createBuffer\(\{size:128\*128\*16,/);
  assert.doesNotMatch(section, /atomic<i32>|center|centroid/i, 'no centroid attractor/repulsor lattice');
});

// Numeric model of the scheme: bilinear deposition on nodes, central-difference node gradients,
// interpolated back with the same weights. It documents the properties the WGSL relies on.
function model(points, size = 16) {
  const mass = new Float64Array(size * size), at = (x, y) => mass[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  const weights = ([x, y]) => { const bx = Math.floor(x), by = Math.floor(y), fx = Math.round((x - bx) * 32) / 32, fy = Math.round((y - by) * 32) / 32; return [bx, by, fx, fy]; };
  for (const p of points) { const [bx, by, fx, fy] = weights(p); mass[by * size + bx] += (1 - fx) * (1 - fy); mass[by * size + bx + 1] += fx * (1 - fy); mass[(by + 1) * size + bx] += (1 - fx) * fy; mass[(by + 1) * size + bx + 1] += fx * fy; }
  return p => {
    const [bx, by, fx, fy] = weights(p), grad = (x, y) => [at(x + 1, y) - at(x - 1, y), at(x, y + 1) - at(x, y - 1)];
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    return mix(mix(grad(bx, by), grad(bx + 1, by), fx), mix(grad(bx, by + 1), grad(bx + 1, by + 1), fx), fy).map(v => -v);
  };
}

test('model: a particle never pushes itself, and coincident stacks feel no grid-aligned pull', () => {
  for (const p of [[6.2, 7.9], [7.5, 7.5], [8.03, 6.71], [5.97, 9.44]]) {
    for (const n of [1, 1000]) assert.ok(Math.hypot(...model(Array(n).fill(p))(p)) < 1e-9 * n, `self-force at ${p} × ${n}`);
  }
});

test('model: zero force in a uniform cloud at every sub-cell position', () => {
  const cloud = [];
  for (let y = 2; y < 14; y += 0.125) for (let x = 2; x < 14; x += 0.125) cloud.push([x + 0.0625, y + 0.0625]);
  const force = model(cloud);
  for (let px = 0; px < 8; px++) for (let py = 0; py < 8; py++) assert.ok(Math.hypot(...force([7 + px / 8, 8 + py / 8])) < 1e-9);
});

test('model: the force is continuous across node and cell borders', () => {
  const blob = [];
  for (let i = 0; i < 4000; i++) { const a = i * 2.39996, r = 2.5 * Math.sqrt((i + 0.5) / 4000); blob.push([8 + r * Math.cos(a), 8 + r * Math.sin(a)]); }
  const force = model(blob), steps = [];
  let previous = force([5, 8.6]);
  for (let x = 5 + 1 / 16; x < 11; x += 1 / 16) { const f = force([x, 8.6]); steps.push(Math.hypot(f[0] - previous[0], f[1] - previous[1])); previous = f; }
  for (let i = 1; i + 1 < steps.length; i++) assert.ok(steps[i] <= 2.5 * Math.max(steps[i - 1], steps[i + 1], 1e-6), `jump at step ${i}`);
});

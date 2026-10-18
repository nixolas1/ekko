// Particle simulation, assembled with common-shader.wgsl before this file and
// reference-simulation.wgsl after it. gpu.js schedules: clear density buffer ->
// binParticles -> simulate -> render. These separate compute passes ensure all
// density deposits are finished before any simulation invocation reads them.
// A workgroup barrier alone cannot synchronise all groups in a whole dispatch.
//
// Each invocation updates one particle in place; it never reads another
// particle's changing record. Interactions use the completed density snapshot,
// so we do not need a second full particle buffer for the simulation.
// Workgroups contain 256 invocations, with ceil(count/256) groups on the CPU.
// The id guard handles the unused lanes of the final group. This is a batching
// choice, not a claim that 256 is the fastest size on every GPU.
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Parameters;
// Only mass is used, but the record stride is 16 bytes to match gpu.js allocation.
// Atomics prevent simultaneous deposits from losing updates. Dense piles can
// still contend on the same nodes; atomics make them correct, not free.
struct DensityCell { mass: atomic<u32>, unused: array<u32, 3> }
@group(0) @binding(2) var<storage, read_write> density: array<DensityCell>;
const GRID = 128u;
// Each particle's unit mass is split bilinearly over its four nearest nodes in exact 1/1024ths, so a
// node holds at most 3,145,728 × 1024 < 2³² even if the whole pool coincides.
const NODE_MASS = 1024.0;
const SOUND_SPEED2 = 0.06;

// A smooth density field on a 128² node grid avoids an O(n²) all-particle collision loop.
// Any grid still slightly favours some spots inside a cell (noise is weaker between nodes), so the
// nodes move by a fresh sub-cell offset every frame, shared by binning and separation; the preference
// then averages out instead of sorting particles into a lattice. Edge particles fold onto border nodes.
// Binning and fixed-size neighbourhood reads cost O(n) for n particles, plus a
// fixed grid clear. This approximates crowd pressure; it is not exact pairwise
// collision detection and cannot resolve interactions below the grid scale.
fn densityCoordinate(q: vec2f) -> vec2f {
  // Low-discrepancy (R2) offsets cover the cell evenly within a few frames, unlike random ones;
  // exact u32 wrap-around keeps them precise however long the session runs.
  let frame = u32(max(params.clock.x, 0.0) * 60.0);
  let shift = vec2f(vec2u(frame * 3242174889u, frame * 2447445413u) >> vec2u(8u)) / 16777216.0;
  return clamp((q / vec2f(max(params.clock.z, 0.01), 1.0) * 0.5 + 0.5) * f32(GRID) - shift, vec2f(0.0), vec2f(f32(GRID - 1u)));
}
fn densityBase(g: vec2f) -> vec2u { return min(vec2u(g), vec2u(GRID - 2u)); }
// 5-bit bilinear fractions: the four weights always sum to exactly 32² whatever the input, NaN included.
// Deposition and interpolation share them, so a particle's own mass never pushes it.
fn densityFraction(g: vec2f, base: vec2u) -> vec2u { return min(vec2u(round((g - vec2f(base)) * 32.0)), vec2u(32u)); }
@compute @workgroup_size(256)
fn binParticles(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= u32(params.clock.w)) { return; }
  let p = particles[id];
  if (p.state.w < 0.5 || abs(p.position.x) > params.clock.z || abs(p.position.y) > 1.0) { return; }
  if (params.simulation.x > 1.5 && p.extra.y < 0.0) { return; }
  let g = densityCoordinate(p.position.xy);
  let base = densityBase(g);
  let f = densityFraction(g, base);
  let index = base.y * GRID + base.x;
  atomicAdd(&density[index].mass, (32u - f.x) * (32u - f.y));
  atomicAdd(&density[index + 1u].mass, f.x * (32u - f.y));
  atomicAdd(&density[index + GRID].mass, (32u - f.x) * f.y);
  atomicAdd(&density[index + GRID + 1u].mass, f.x * f.y);
}
fn densityPressure(node: vec2i, scale: f32) -> f32 {
  let c = clamp(node, vec2i(0), vec2i(i32(GRID) - 1));
  return f32(atomicLoad(&density[u32(c.y) * GRID + u32(c.x)].mass)) * scale;
}
// Pressure gradient of the density field. Node gradients are central differences, interpolated with
// the same bilinear weights used for deposition: the force is continuous across cell borders, exactly
// zero in a uniform cloud, and a particle exerts no force on itself, so no cell-periodic lattice forms.
// Node values stay linear in density (capping them would pull dense stacks onto nodes). Dividing by the
// interpolated density, as an isothermal gas does, keeps dense clumps dispersing gently.
fn separation(q: vec2f, id: u32) -> vec2f {
  let cellSize = vec2f(max(params.clock.z, 0.01) * 2.0, 2.0) / f32(GRID);
  let g = densityCoordinate(q);
  let cell = densityBase(g);
  let f = vec2f(densityFraction(g, cell)) / 32.0;
  let base = vec2i(cell);
  let scale = 1.0 / (NODE_MASS * max(params.clock.w / f32(GRID * GRID), 1.0));
  // Twelve loads: the four interpolation nodes and the eight neighbours their gradients need.
  let p00 = densityPressure(base, scale);
  let p10 = densityPressure(base + vec2i(1, 0), scale);
  let p01 = densityPressure(base + vec2i(0, 1), scale);
  let p11 = densityPressure(base + vec2i(1, 1), scale);
  let g00 = vec2f(p10 - densityPressure(base + vec2i(-1, 0), scale), p01 - densityPressure(base + vec2i(0, -1), scale));
  let g10 = vec2f(densityPressure(base + vec2i(2, 0), scale) - p00, p11 - densityPressure(base + vec2i(1, -1), scale));
  let g01 = vec2f(p11 - densityPressure(base + vec2i(-1, 1), scale), densityPressure(base + vec2i(0, 2), scale) - p00);
  let g11 = vec2f(densityPressure(base + vec2i(2, 1), scale) - p01, densityPressure(base + vec2i(1, 2), scale) - p10);
  let gradient = mix(mix(g00, g10, f.x), mix(g01, g11, f.x), f.y);
  let pressure = mix(mix(p00, p10, f.x), mix(p01, p11, f.x), f.y);
  var acceleration = -gradient * (0.5 * SOUND_SPEED2) / (cellSize * max(pressure, 1.0));
  // Exactly coincident particles see identical gradients forever; a fixed per-particle direction,
  // active only well above typical density, lets stacks drift apart without a grid-aligned bias.
  let a = rnd(id, 29u) * TAU;
  acceleration += vec2f(cos(a), sin(a)) * 0.05 * clamp(pressure - 2.0, 0.0, 14.0);
  return acceleration * min(1.0, 14.0 / max(length(acceleration), 0.0001));
}

fn tri(x: f32) -> f32 { return abs(fract(x) - 0.5) * 4.0 - 1.0; }
// The shape functions below are procedural rest positions. A strand index k
// selects a curve and u selects a point along it. Regenerating positions from
// these small formulas avoids storing or uploading animated path geometry.
fn rot(p: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}
fn strandCount(effect: u32) -> u32 {
  if (effect == 3u) { return 48u; }
  if (effect == 1u) { return 40u; }
  if (effect == 2u) { return 32u; }
  return 24u;
}
// Effect 0: braided strands winding round two tilted, counter-rotating rings.
fn orbital(k: u32, u: f32, t: f32, bass: f32, mid: f32) -> vec3f {
  let kf = f32(k);
  let inner = k >= 16u;
  let phase = kf * 0.3927;
  let twist = f32(2u + k % 3u);
  let a = u * TAU + t * (0.09 + 0.011 * f32(k % 5u)) * select(1.0, -1.3, inner);
  let ring = (0.58 + 0.06 * sin(a * 3.0 + t * 0.45 + phase) + 0.03 * sin(a * 7.0 - t * 0.8 + kf)) * select(1.0, 0.52, inner);
  let b = a * twist + phase * 2.0 + t * 0.35;
  let tube = (0.11 + 0.055 * sin(a * 2.0 - t * 0.3 + phase)) * (1.0 + bass * 0.5 + mid * 0.2) + 0.014 * tri(u * 13.0 + kf * 0.37 + t * 0.6);
  let radial = ring + tube * cos(b);
  var p = vec3f(cos(a) * radial, sin(a) * radial, tube * sin(b) * 1.4);
  let tilt = select(0.78, -0.55, inner) + 0.16 * sin(t * 0.11 + select(0.0, 1.7, inner));
  let ct = cos(tilt);
  let st = sin(tilt);
  p = vec3f(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
  return vec3f(rot(p.xy, t * 0.04 * select(1.0, -1.0, inner)), p.z);
}
// Effect 1: slender jagged ribbons; strands k%5 != 0 branch off their parent strand and curl.
fn ribbons(k: u32, u: f32, t: f32, bass: f32, mid: f32) -> vec3f {
  let kf = f32(k);
  let child = k % 5u;
  let g = f32(k / 5u);
  let x = (u * 2.0 - 1.0) * 1.15;
  let ph = g * 1.7;
  var p = vec3f(
    x + 0.16 * sin(t * 0.21 + g),
    0.34 * sin(x * 2.6 + t * 0.55 + ph) + 0.17 * sin(x * 5.8 - t * 0.9 + ph * 1.9) + (g - 3.5) * 0.06,
    0.26 * sin(x * 2.1 + t * 0.4 + ph));
  let branchAt = 0.12 + 0.76 * rnd(k, 13u);
  let side = select(1.0, -1.0, (k & 1u) == 0u);
  let w = smoothstep(0.0, 0.5, (u - branchAt) * side) * select(0.0, 1.0, child != 0u);
  p += w * vec3f(0.2 * sin(u * 19.0 + kf + t * 0.7), 0.28 * sin(u * 13.0 - kf * 1.3 + t * 1.1) + 0.11 * (f32(child) - 2.0), 0.2 * cos(u * 9.0 + kf));
  p.y += 0.032 * tri(u * 37.0 + kf * 0.73 + t * 0.8) * (0.4 + mid);
  p.x += 0.02 * tri(u * 29.0 - kf * 0.41 - t * 0.6) * (0.4 + mid);
  p.y *= 1.0 + bass * 0.3;
  return p;
}
// Effect 2: stacked lines carrying travelling waves plus a bass-driven ripple from the centre.
fn wave(k: u32, u: f32, t: f32, bass: f32, mid: f32) -> vec3f {
  let kf = f32(k);
  let r = kf / 15.5 - 1.0;
  let x = (u * 2.0 - 1.0) * 1.15;
  let dist = length(vec2f(x * 0.8, r * 0.7));
  let h = 0.12 * sin(x * 3.4 - t * 1.1 + r * 2.2) + 0.06 * sin(x * 7.1 + t * 1.7 - r * 3.1) + (0.08 + 0.22 * bass) * sin(dist * 9.0 - t * 3.0) * exp(-dist * 1.3);
  let y = r * 0.58 + h * (0.8 + mid) + 0.012 * tri(u * 41.0 + kf * 0.6 + t);
  let z = 0.34 * sin(x * 2.2 + r * 1.7 + t * 0.5);
  return vec3f(x, y, z);
}
fn sculpture(effect: u32, k: u32, u: f32, t: f32, bass: f32, mid: f32) -> vec3f {
  // Parallel right-angle staircases, tilted into the reference's chevron bundles.
  if (effect == 3u) {
    let progress = u * 8.0;
    let cell = floor(progress);
    let part = fract(progress);
    let x = (cell + min(part * 2.0, 1.0)) * 0.23 - 0.92;
    let y = (cell + max(part * 2.0 - 1.0, 0.0)) * 0.17 - 0.68;
    let bundle = f32(k / 12u);
    let offset = (f32(k % 12u) - 5.5) * 0.012;
    let xy = rot(vec2f(x, y + offset), -0.6 + bundle * 1.45 + sin(t * 0.1) * 0.12);
    return vec3f(xy * (0.8 + bass * 0.18) + vec2f(sin(bundle * 2.1 + t * 0.16), cos(bundle * 2.1 + t * 0.16)) * 0.25, (bundle - 1.5) * 0.13 + sin(t * 0.2 + u * 3.0) * 0.06);
  }
  if (effect == 1u) { return ribbons(k, u, t, bass, mid); }
  if (effect == 2u) { return wave(k, u, t, bass, mid); }
  return orbital(k, u, t, bass, mid);
}
fn flow(q: vec3f, t: f32) -> vec3f {
  let a = sin(q.y * 4.3 + t * 0.7 + sin(q.z * 3.1 - t * 0.4) * 1.7);
  let b = sin(q.z * 3.7 - t * 0.5 + sin(q.x * 4.9 + t * 0.6) * 1.7);
  let c = sin(q.x * 5.1 + t * 0.45 + sin(q.y * 3.3 + t * 0.3) * 1.7);
  return vec3f(a, b, c);
}

// Each wave is the curl of a vector potential: cross(k, a) * cos(dot(k, q)).
// Shared spatial phases keep neighboring particles in coherent folds; no per-frame jitter.
// An analytic curl supplies swirling motion without sampling a 3D noise field
// repeatedly to estimate derivatives. Its divergence is zero mathematically;
// the full motion also includes artistic forces and is not a pressure solve.
fn smokeCurl(q: vec3f, t: f32) -> vec3f {
  let k1 = vec3f(2.1, 3.7, 1.3);
  let k2 = vec3f(-3.3, 1.5, 2.7);
  let k3 = vec3f(1.7, -2.9, 3.1);
  var f = cross(k1, vec3f(0.3, -0.2, 0.8)) * cos(dot(k1, q) + t * 0.37);
  f += cross(k2, vec3f(0.7, 0.4, -0.1)) * cos(dot(k2, q) - t * 0.29 + 2.0);
  f += cross(k3, vec3f(-0.2, 0.9, 0.3)) * cos(dot(k3, q) + t * 0.23 + 4.0);
  return f * 0.13;
}

// Spectral ring sectors match fluid.wgsl: band 0 (bass) at the upper left, higher bands clockwise.
const SPECTRAL_START = 2.35619449;
fn spectralLevel(i: u32) -> f32 { return clamp(params.ringLevels[i / 4u][i % 4u], 0.0, 1.0); }
fn spectralAttack(i: u32) -> f32 { return clamp(params.ringAttacks[i / 4u][i % 4u], 0.0, 1.0); }
// Level at a direction, interpolated between the two nearest sector centres round the full circle.
fn spectralLevelAt(radial: vec2f) -> f32 {
  let s = fract((SPECTRAL_START - atan2(radial.y, radial.x + 0.000001)) / TAU) * 9.0;
  let i = u32(s) % 9u;
  return mix(spectralLevel(i), spectralLevel((i + 1u) % 9u), smoothstep(0.0, 1.0, fract(s)));
}

fn newSmoke(id: u32, mode: f32, warm: bool) -> Particle {
  // Fixed pool lifecycle: extra = (source parameter, age, unused, lifetime).
  // Negative age means waiting to emit. Recycling the same slot avoids a GPU
  // allocator, a CPU birth list, and growing buffers as smoke is produced.
  let key = id ^ pcg(u32(params.clock.x * 71.0));
  let ring = mode > 2.5;
  let life = 4.5 + rnd(id, 35u) * 3.0;
  var source = rnd(key, 32u);
  let spectral = mode > 3.5;
  if (spectral && params.simulation.y > 0.5) {
    // Stable frequency sectors round the whole ring. A triangular spread overlapping
    // neighbouring sectors keeps the sheet continuous while each band stays centred.
    let offset = (rnd(key, 38u) + rnd(key, 39u) - 1.0) * 0.9;
    source = fract((SPECTRAL_START - (f32(id % 9u) + offset) * TAU / 9.0) / TAU);
  }
  let angle = source * TAU;
  let radial = vec2f(cos(angle), sin(angle));
  let width = min(params.clock.z * 0.68, 1.1);
  var origin = vec3f((source * 2.0 - 1.0) * width, -0.72 + 0.12 * pow(source * 2.0 - 1.0, 2.0), (rnd(key, 33u) - 0.5) * 0.035);
  var velocity = vec3f(0.0, 0.22, 0.0);
  if (ring) {
    origin = vec3f(radial * 0.23, (rnd(key, 33u) - 0.5) * 0.035);
    velocity = vec3f(radial * 0.26, 0.0);
  }
  // Short staggered waits change the actual birth rate with music, without buffer allocation.
  var age = -rnd(key, 36u) * 1.4 / (0.35 + params.sound.w * 2.0);
  if (warm && !(spectral && params.simulation.y > 0.5)) {
    age = rnd(id, 37u) * life * 0.8;
    // Distributed warm start avoids concentrating the entire pool into one density cell.
    origin += velocity * age + smokeCurl(origin * 1.4, params.clock.x - age * 0.2) * age * 0.12;
  }
  if (spectral && params.simulation.y > 0.5) { age = -0.001; }
  return Particle(vec4f(origin, 0.0), vec4f(velocity, rnd(id, 6u)), vec4f(params.burst.z, 0.0, mode, 1.0), vec4f(source, age, 0.0, life));
}

fn simulateSmoke(id: u32, old: Particle) -> Particle {
  let dt = params.clock.y;
  let t = params.clock.x;
  let mode = params.simulation.x;
  let ring = mode > 2.5;
  let energy = clamp(params.sound.w, 0.0, 1.0);
  let bass = clamp(params.sound.x, 0.0, 1.0);
  var p = old;
  let invalid = !all(abs(p.position.xyz) < vec3f(8.0)) || !all(abs(p.velocity.xyz) < vec3f(60.0));
  if (p.state.w < 0.5 || p.state.z != mode || invalid) { p = newSmoke(id, mode, true); }
  if (dt == 0.0) { return p; }
  if (mode > 3.5 && params.simulation.y > 0.5 && p.extra.y < 0.0) {
    let band=spectralLevel(id % 9u);
    let attack=spectralAttack(id % 9u);
    let strength=smoothstep(.06,.85,band);
    // A dim baseline trickle keeps silent sectors as faint grey smoke, so the ring stays whole.
    // 1-exp(-rate*dt) is the probability of an event during this time interval.
    // It makes the emission rate less dependent on how many frames are rendered.
    let chance=1.0-exp(-(0.07+strength*strength*strength*5.0)*dt);
    if (rnd(id ^ pcg(u32(t*1000.0)),63u) >= chance) { return p; }
    p.extra.y=0.0;
    p.velocity=vec4f(p.velocity.xy*(1.0+band*2.0+attack*strength*1.5),p.velocity.zw);
    // Births are continuous within the frame. Starting every particle on precisely
    // the same radius each tick produces visible concentric sampling bands.
    let subframe = rnd(id ^ pcg(u32(t*1000.0)),64u) * dt;
    p.position = vec4f(p.position.xyz + p.velocity.xyz * subframe * (0.8 + energy * 0.65),p.position.w);
    p.extra.y = subframe;
  }
  p.extra.y += dt;
  if (p.extra.y < 0.0) { return p; }
  var q = p.position.xyz;
  var v = p.velocity.xyz;
  let hot = exp(-p.extra.y * 0.4);
  let spectral = mode > 3.5;
  let turbulence = smokeCurl(q * 1.8, t) * select(0.38, 0.65, spectral) + smokeCurl(q * 5.8 + vec3f(8.0), t * 1.3) * select(0.11, 0.22, spectral);
  var transport = vec3f(0.02 * sin(t * 0.2), 0.24 + hot * 0.14 + bass * 0.1, 0.0) + turbulence;
  if (ring) {
    let radius = length(q.xy);
    let radial = q.xy / max(radius, 0.001);
    let pulse = 0.8 + 0.25 * sin(p.extra.x * TAU * 5.0 + t * 0.65);
    // Particle ring: measured bass drives outward speed, independently of treble
    // or the synthetic idle signal. Keep a slow drift between bass hits.
    var ringSpeed = 0.22 + bass * 0.22;
    if (!spectral && params.simulation.y > 0.5) {
      ringSpeed = 0.18 + pow(bass, 1.25) * (1.25 + params.simulation.z * .45) * clamp(params.simulation.w,.3,3.0);
    }
    transport = vec3f(radial * ringSpeed * pulse, 0.0) + turbulence * smoothstep(0.16, 0.5, radius);
    transport += vec3f(-radial.y, radial.x, 0.0) * 0.08;
    if (radius < 0.22) { transport += vec3f(radial * (0.22 - radius) * 5.0, 0.0); }
    if (spectral) {
      // Each of the nine sectors pushes along its own direction, all the way round the ring.
      let jet = select(0.0, spectralLevelAt(radial) * 1.6, params.simulation.y > 0.5);
      transport = vec3f(radial * (0.12 + jet * exp(-max(0.0, radius - 0.23) * 1.1)), 0.0);
      transport += turbulence * smoothstep(0.23, 0.48, radius) + vec3f(0.0, 0.09, 0.0);
      // A toroidal eddy rolls the thin emitting sheet over itself. Its spatially
      // shared velocity makes coherent billows instead of independent noisy dots.
      let rollRadius = 0.48 + 0.045 * sin(p.extra.x * TAU * 3.0 + t * 0.45);
      let dr = radius - rollRadius;
      let dz = q.z - 0.045;
      let roll = 4.5 * exp(-(dr * dr + dz * dz) / 0.065);
      transport += vec3f(radial * (-dz * roll), dr * roll);
      // Cool, slow curls grow behind the fast fresh jet, retaining volume in depth.
      transport.z += sin(radius * 9.0 - t * 1.2 + p.extra.x * TAU) * 0.13;
      if (radius < 0.22) { transport += vec3f(radial * (0.22 - radius) * 6.0, 0.0); }
    }
  }
  // Relaxation supplies drag and buoyancy while retaining the momentum of hand impulses.
  let responseRate=select(2.0,12.0,ring && !spectral && params.simulation.y>.5 && length(transport)>length(v));
  v += (transport - v) * (1.0 - exp(-dt * responseRate));
  var heat = p.state.y * exp(-dt * 2.0);
  for (var j = 0u; j < min(u32(params.display.w), 32u); j++) {
    let f = params.forces[j];
    if(f.w<0.0){continue;}
    let delta = f.xy - q.xy;
    let dist = length(delta);
    let n = delta / max(dist, 0.001);
    let influence = exp(-dot(delta, delta) / max(f.w * f.w, 0.001));
    let strength = min(abs(f.z), 24.0);
    var wantedFlow = n * clamp((dist - 0.1) * 4.0, -0.8, 1.4) + vec2f(-n.y, n.x) * 1.2 + params.forceVel[j].xy * 0.65;
    if (f.z < 0.0) { wantedFlow = -n * 2.0 + params.forceVel[j].xy * 0.5; }
    wantedFlow=gestureFlow(wantedFlow,delta,f.w,params.forceVel[j].xy,params.forceVel[j].zw);
    let weight = 1.0 - exp(-strength * influence * dt * 0.8);
    v = vec3f(mix(v.xy, wantedFlow, weight), v.z);
    heat = max(heat, influence * strength / 24.0);
  }
  for (var j = 0u; j < min(u32(params.extra.x), 8u); j++) {
    let b = params.bursts[j];
    if (b.z > p.state.x) {
      let delta = q.xy - b.xy;
      let shock = exp(-dot(delta, delta) / 0.35) * b.w;
      v += vec3f(delta / max(length(delta), 0.02) * shock * 1.7, 0.0);
      heat = max(heat, shock); p.state.x = b.z;
    }
  }
  // Weak density pressure preserves wisps while keeping coincident particles apart.
  v += vec3f(separation(q.xy, id) * dt * 0.035, 0.0);
  v *= min(1.0, 3.5 / max(length(v), 0.001));
  v=vec3f(cursorVelocity(q.xy,v.xy,dt),v.z);
  q += v * dt * (0.8 + energy * 0.65);
  // The spectral ring recycles at one radius, so wide screens do not stretch the side sectors thin.
  let escaped = abs(q.x) > params.clock.z * 1.2 || abs(q.y) > 1.3 || (spectral && length(q.xy) > 1.3);
  if (p.extra.y > p.extra.w || escaped || abs(q.z) > 1.4) { return newSmoke(id, mode, false); }
  return Particle(vec4f(q, 0.0), vec4f(v, p.velocity.w), vec4f(p.state.x, heat, mode, 1.0), p.extra);
}

@compute @workgroup_size(256)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  let count = u32(params.clock.w);
  if (id >= count) { return; }
  var p = particles[id];
  // Mode is uniform across the dispatch, so all active invocations take the
  // same major branch. Fluid modes bypass this entry point in gpu.js entirely.
  if (params.simulation.x > 4.5) { particles[id] = simulateReference(id, p); return; }
  if (params.simulation.x > 1.5) { particles[id] = simulateSmoke(id, p); return; }
  let t = params.clock.x;
  let dt = params.clock.y;
  let aspect = params.clock.z;
  let bass = clamp(params.sound.x, 0.0, 1.5);
  let mid = clamp(params.sound.y, 0.0, 1.5);
  let energy = clamp(params.sound.w, 0.0, 1.0);
  let musicSpeed = 0.7 + energy * 0.65 + min(bass, 1.0) * 0.35;
  let effect = u32(params.style.x + 0.5);
  let fill = clamp(params.style.y, 0.0, 1.0);
  let persistent = params.simulation.x > 0.5;

  // Which strand and where along it; stratified so strands stay evenly lit at every count.
  // Modulo distributes successive ids across strands; division assigns each a
  // small interval along its strand. Jitter within that interval hides regular
  // spacing without the large gaps of fully random sampling.
  let strands = strandCount(effect);
  let k = id % strands;
  let per = f32((count + strands - 1u) / strands);
  let u = clamp((f32(id / strands) + rnd(id, 1u)) / per, 0.0, 1.0);
  let lr = rnd(id, 2u);
  let layer = select(select(0.0, 1.0, lr > 0.55), 2.0, lr > 0.88);
  let scat = select(select(0.007, 0.022, layer > 0.5), 0.085, layer > 1.5);
  let scatter = (vec3f(rnd(id, 3u), rnd(id, 4u), rnd(id, 5u)) - vec3f(0.5)) * 2.0 * scat;

  // Centred between intro and panel by default; fill spreads the sculpture over the whole scene.
  let sFit = clamp(aspect / 1.2, 0.45, 1.0);
  let fit = mix(0.88, 1.15, fill) * sFit;
  let centerX = mix(0.1, 0.0, fill) * aspect * sFit;
  let stretch = mix(1.0, clamp(aspect / 1.25, 1.0, 1.6), fill);
  var rest = vec3f(0.0);
  if (!persistent) { rest = sculpture(effect, k, u, t, bass, mid) * (1.0 + bass * 0.1) * fit; }
  if (effect != 0u) { rest.x *= stretch; }
  rest = rest + scatter * (1.0 + mid * 0.6) + vec3f(centerX, 0.03, 0.0);

  // Fresh, or corrupted by anything non-finite: respawn near the sculpture.
  let finite = all(abs(p.position.xyz) < vec3f(8.0)) && all(abs(p.velocity.xyz) < vec3f(60.0));
  if (p.state.w == 0.0 || !finite || (persistent && p.state.z < 0.5)) {
    p.position = vec4f(rest * 0.3, 0.0);
    p.velocity = vec4f(0.0, 0.0, 0.0, rnd(id, 6u));
    p.state = vec4f(params.burst.w, 0.0, 0.0, 1.0);
    if (persistent) {
      p.position = vec4f((rnd(id, 22u) * 2.0 - 1.0) * aspect * 0.94, (rnd(id, 23u) * 2.0 - 1.0) * 0.94, (rnd(id, 24u) - 0.5) * 0.9, 0.0);
      p.velocity = vec4f(0.0, 0.0, 0.0, rnd(id, 6u));
    }
  }

  // Every burst drained this frame is applied, in order, once per particle.
  // state.x remembers the last consumed serial. This prevents a persistent
  // event value in the uniform buffer from kicking the same particle repeatedly.
  let nb = min(u32(params.extra.x), 8u);
  for (var i = 0u; i < nb; i++) {
    let b = params.bursts[i];
    if (b.z > p.state.x) {
      p.state.x = b.z;
      let key = id + u32(b.z) * 7919u;
      let rel = p.position.xy - b.xy;
      let d2 = dot(rel, rel);
      let shock = exp(-d2 / 0.42) * b.w;
      let r1 = rnd(key, 7u);
      p.velocity = vec4f(p.velocity.xyz + vec3f(rel * inverseSqrt(d2 + 0.0004) * shock * (1.2 + 2.0 * r1), (r1 - 0.5) * shock), p.velocity.w);
      p.position.w = max(p.position.w, min(1.0, shock * 1.1));
      p.state.y = max(p.state.y, shock * 0.7);
      if (!persistent && rnd(key, 8u) < min(0.16, 0.035 + energy * 0.09 + bass * 0.035)) {
        let ang = rnd(key, 9u) * TAU;
        let sp = (0.5 + 2.0 * pow(rnd(key, 10u), 1.5)) * b.w;
        let r2 = rnd(key, 18u) - 0.5;
        p.position = vec4f(b.xy, r2 * 0.12, 1.0);
        p.velocity = vec4f(cos(ang) * sp, sin(ang) * sp, r2 * 0.5, p.velocity.w);
        p.state.y = 1.0;
      }
    }
  }

  var q = p.position.xyz;
  var v = p.velocity.xyz;
  var ex = p.position.w;
  var heat = p.state.y * exp(-dt * 1.6);
  let nf = min(u32(params.display.w), 32u);

  // Hand and body points claim a share of a reserved pool and emit it as a stream along their motion.
  // Only a stable 22% subset enters this path. Dividing the emission probability
  // by that subset's size keeps the expected birth rate similar as count changes.
  if (!persistent && dt > 0.0 && nf > 0u && rnd(id, 14u) < 0.22) {
    let key = id ^ pcg(u32(t * 1000.0));
    let x = rnd(key, 15u);
    let scale = dt / (0.22 * f32(count));
    var cum = 0.0;
    for (var j = 0u; j < nf; j++) {
      let f = params.forces[j];
      if(f.w<0.0){continue;}
      let pj = clamp(abs(f.z), 0.0, 24.0) * 260.0 * scale * (0.15 + bass * 2.1 + energy * 0.8);
      if (x >= cum && x < cum + pj) {
        let a = rnd(key, 16u) * TAU;
        let r1 = rnd(key, 17u);
        let hv = params.forceVel[j].xy;
        let hs = length(hv);
        let bias = hv / max(hs, 0.001) * min(hs, 2.0) * 0.8;
        let dirE = normalize(vec2f(cos(a), sin(a)) + bias + vec2f(0.0001, 0.0));
        let jet = (0.5 + 1.6 * r1) * (0.6 + 0.4 * min(abs(f.z) / 16.0, 1.0));
        let emitRadius = mix(select(0.025, 0.10, f.z >= 10.0),0.012,params.forceVel[j].z);
        q = vec3f(f.xy + vec2f(cos(a), sin(a)) * emitRadius, (rnd(key, 21u) - 0.5) * 0.1);
        v = vec3f(dirE * jet + hv * 0.7, (r1 - 0.5) * 0.3);
        ex = 0.8;
        heat = 1.0;
        break;
      }
      cum += pj;
    }
  }

  // Spring to the sculpture plus a swirling flow field; explosions loosen the spring.
  if (persistent) {
    // No path spring, background flow, respawning or emission: these particles remain in the room.
    v *= exp(-dt * 0.32);
  } else {
    let stiff = mix(9.0, 0.5, smoothstep(0.0, 1.0, ex)) * (0.75 + 0.5 * rnd(id, 11u));
    var acc = (rest - q) * stiff;
    acc += flow(q, t) * (0.22 + 0.9 * mid) * (0.5 + 0.55 * layer);
    acc *= min(1.0, 60.0 / max(length(acc), 0.0001));
    v += acc * dt;
    v *= exp(-dt * mix(3.4, 1.8, ex));
  }

  // Each force point relaxes nearby velocities toward a swirl round it that also follows its motion.
  // For a fixed target, 1-exp(-rate*dt) stays in [0,1], so this velocity blend
  // cannot overshoot it. This does not guarantee stability of the entire solver:
  // springs, moving targets and position integration still need bounded steps.
  for (var j = 0u; j < nf; j++) {
    let f = params.forces[j];
    if(f.w<0.0){continue;}
    if (abs(f.z) < 0.001) { continue; }
    let d = f.xy - q.xy;
    let dd2 = dot(d, d);
    let dd = sqrt(dd2);
    let s = clamp(abs(f.z), 0.0, 24.0);
    let range2 = max(f.w * f.w, 0.0009);
    let ordinaryInfluence=select(exp(-(dd2 + 0.02) / range2),1.0/(1.0+dd2/(range2*.45)),persistent);
    let infl=mix(ordinaryInfluence,exp(-dd2/range2),params.forceVel[j].z+params.forceVel[j].w);
    let n = d / max(dd, 0.001);
    let spin = min(0.7 + 0.09 * s, 2.0) * smoothstep(0.0, 0.18, dd);
    let ring = select(0.0, 0.1, f.z >= 10.0);
    var wanted = n * clamp((dd - ring) * 5.0, -1.0, 1.8) + vec2f(-n.y, n.x) * spin + params.forceVel[j].xy * 0.8;
    // An open hand pushes radially outward for as long as it stays open.
    if (f.z < 0.0) {
      // Strong at the palm, falling to rest at the edge instead of sweeping
      // persistent particles into a bright rectangle at the screen boundaries.
      let falloff=pow(max(0.0,1.0-dd/max(f.w,.05)),2.0);
      wanted = -n * (1.8 + s * 0.09) * falloff + params.forceVel[j].xy * 0.4 * falloff;
    }
    wanted=gestureFlow(wanted,d,f.w,params.forceVel[j].xy,params.forceVel[j].zw);
    let relax = 1.0 - exp(-(1.5 + 0.9 * s) * infl * dt);
    v = vec3f(v.xy + (wanted - v.xy) * relax, v.z);
    if (persistent) { v.z += (-q.z * 1.8 - v.z) * relax; }
    heat = max(heat, infl * min(s / 16.0, 1.0) * 0.32);
  }

  v += vec3f(separation(q.xy, id) * dt, 0.0);
  v *= min(1.0, 5.0 / max(length(v), 0.0001));
  v=vec3f(cursorVelocity(q.xy,v.xy,dt),v.z);
  q += v * dt * musicSpeed;
  if (persistent) {
    let bounds = vec3f(max(aspect * 0.98, 0.2), 0.98, 0.9);
    for (var axis = 0u; axis < 3u; axis++) {
      if (abs(q[axis]) > bounds[axis]) {
        q[axis] = clamp(q[axis], -bounds[axis], bounds[axis]);
        v[axis] = -sign(q[axis]) * abs(v[axis]) * 0.65;
      }
    }
  }
  ex = max(0.0, ex - dt * 0.42);
  particles[id] = Particle(vec4f(q, ex), vec4f(v, p.velocity.w), vec4f(p.state.x, heat, select(0.0, 1.0, persistent), 1.0), vec4f(f32(k) / f32(strands), u, layer, rnd(id, 12u)));
}

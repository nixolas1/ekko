// Spectral smoke volume (simulation mode 4): particles are splatted into a coarse density grid,
// the grid is smoothed and lit by a vertical light scan, then a half-width, half-height raymarch
// produces premultiplied smoke colour plus opacity for post-shader.wgsl to upscale into the HDR scene.
@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Parameters;
@group(0) @binding(2) var<storage, read_write> accum: array<atomic<u32>>;
@group(0) @binding(3) var<uniform> volume: VolumeParams;
@group(0) @binding(4) var lightOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(5) var lightTex: texture_3d<f32>;
@group(0) @binding(6) var volumeSampler: sampler;
@group(0) @binding(7) var noiseOut: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(8) var noiseTex: texture_3d<f32>;
@group(0) @binding(9) var noiseSampler: sampler;

struct VolumeParams {
  box: vec4f,    // half extents x, y, z of the grid in scene units; camera distance
  shading: vec4f, // density per splat unit, splat stride, ray steps, extinction per scene unit
  light: vec4f,  // ambient, key light, time, detail strength
}
const VX = 96u;
const VY = 64u;
const VZ = 48u;
const FIXED = 4096.0; // fixed point per splat; 262144 splats * 4096 < 2^32 even in one cell

fn cellIndex(c: vec3u) -> u32 { return (c.z * VY + c.y) * VX + c.x; }

// Trilinear splat: every particle spreads one unit over its eight surrounding cell centres,
// so density moves continuously instead of popping between cells.
@compute @workgroup_size(256)
fn voxelize(@builtin(global_invocation_id) gid: vec3u) {
  let stride = u32(volume.shading.y);
  let id = gid.x * stride;
  if (id >= u32(params.clock.w)) { return; }
  let p = particles[id];
  if (p.state.w < 0.5 || p.extra.y < 0.0) { return; }
  // Smoke fades in after birth and thins out towards the end of life, as in render.wgsl.
  let age = p.extra.y;
  let life = max(p.extra.w, 0.001);
  // The radial term matches reference-render.wgsl: the ring dissolves before its recycle radius.
  let weight = smoothstep(0.0, 0.35, age) * (1.0 - smoothstep(life * 0.5, life, age)) * (1.0 - smoothstep(0.95, 1.3, length(p.position.xy)));
  // The comparison is false for NaN, so non-finite positions are rejected here as well.
  if (weight < 0.004 || !all(abs(p.position.xyz) < volume.box.xyz)) { return; }
  let g = clamp((p.position.xyz / volume.box.xyz * 0.5 + 0.5) * vec3f(f32(VX), f32(VY), f32(VZ)) - 0.5, vec3f(0.0), vec3f(f32(VX) - 1.001, f32(VY) - 1.001, f32(VZ) - 1.001));
  let base = vec3u(g);
  let f = fract(g);
  for (var corner = 0u; corner < 8u; corner++) {
    let o = vec3u(corner & 1u, (corner >> 1u) & 1u, corner >> 2u);
    let w = select(1.0 - f, f, vec3<bool>(o == vec3u(1u)));
    let amount = u32(w.x * w.y * w.z * weight * FIXED + 0.5);
    if (amount > 0u) { atomicAdd(&accum[cellIndex(base + o)], amount); }
  }
}

fn raw(c: vec3i) -> f32 {
  let k = clamp(c, vec3i(0), vec3i(i32(VX) - 1, i32(VY) - 1, i32(VZ) - 1));
  return f32(atomicLoad(&accum[cellIndex(vec3u(k))]));
}

// One thread per vertical column. A separable Gaussian stencil removes splat noise; the top-down running optical
// depth gives each cell its shadow from an overhead key light at no extra raymarch cost.
@compute @workgroup_size(64)
fn lightColumns(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= VX * VZ) { return; }
  let x = i32(gid.x % VX);
  let z = i32(gid.x / VX);
  let cellHeight = volume.box.y * 2.0 / f32(VY);
  let extinction = volume.shading.w;
  var depth = 0.0;
  for (var y = i32(VY) - 1; y >= 0; y--) {
    let c = vec3i(x, y, z);
    // Seven coalesced reads instead of a 27-tap cubic stencil. Trilinear sampling
    // supplies the remaining smoothing; this volume now carries broad illumination only.
    let sum = raw(c) * 0.4 + 0.1 * (raw(c+vec3i(1,0,0)) + raw(c-vec3i(1,0,0))
      + raw(c+vec3i(0,1,0)) + raw(c-vec3i(0,1,0))
      + raw(c+vec3i(0,0,1)) + raw(c-vec3i(0,0,1)));
    // Soft saturation keeps a million coincident particles from producing an opaque wall.
    let n = sum / FIXED * volume.shading.x;
    let rho = n / (1.0 + n * 0.25);
    let halfDepth = rho * extinction * cellHeight * 0.5;
    depth += halfDepth;
    // g: single-scatter shadow; b: softer multiple-scatter approximation that lets light leak deeper.
    textureStore(lightOut, c, vec4f(rho, exp(-depth), exp(-depth * 0.25), 0.0));
    depth += halfDepth;
  }
}

// One-time tileable detail noise: smoothed lattice values, two independent channels.
fn lattice(c: vec3u, salt: u32) -> f32 { return rnd(cellIndex(c % vec3u(32u)) + salt * 40009u, salt); }
@compute @workgroup_size(64)
fn buildNoise(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= 32768u) { return; }
  let c = vec3u(gid.x % 32u, (gid.x / 32u) % 32u, gid.x / 1024u);
  var a = 0.0;
  var b = 0.0;
  for (var i = 0u; i < 27u; i++) {
    let o = vec3u(i % 3u, (i / 3u) % 3u, i / 9u);
    let w = select(0.5, 1.0, o.x == 1u) * select(0.5, 1.0, o.y == 1u) * select(0.5, 1.0, o.z == 1u);
    let q = c + o + vec3u(31u);
    a += lattice(q, 1u) * w;
    b += lattice(q, 2u) * w;
  }
  // 27-tap weights sum to 8.
  let sa = clamp((a / 8.0 - 0.5) * 2.6 + 0.5, 0.0, 1.0);
  let sb = clamp((b / 8.0 - 0.5) * 2.6 + 0.5, 0.0, 1.0);
  textureStore(noiseOut, vec3i(c), vec4f(sa, sb, 0.0, 1.0));
}

struct RayOutput { @builtin(position) position: vec4f, @location(0) screen: vec2f }
@vertex fn rayVertex(@builtin(vertex_index) vertexId: u32) -> RayOutput {
  let xy = vec2f(f32((vertexId << 1u) & 2u), f32(vertexId & 2u)) * 2.0 - 1.0;
  var output: RayOutput;
  output.position = vec4f(xy, 0.0, 1.0);
  output.screen = vec2f(xy.x * params.clock.z, xy.y);
  return output;
}

fn density(q: vec3f, detail: f32) -> vec2f {
  let uvw = q / volume.box.xyz * 0.5 + 0.5;
  let cell = textureSampleLevel(lightTex, volumeSampler, uvw, 0.0);
  // Empty space costs one fetch; detail noise is only sampled inside smoke.
  if (cell.r < 0.0005) { return vec2f(0.0); }
  // Mean-preserving multiplicative detail below voxel resolution, drifting upward with the smoke.
  let t = volume.light.z;
  let n = textureSampleLevel(noiseTex, noiseSampler, q * 1.9 + vec3f(0.0, -t * 0.05, t * 0.013), 0.0).r * 0.65
        + textureSampleLevel(noiseTex, noiseSampler, q * 4.7 + vec3f(t * 0.02, -t * 0.11, 0.0), 0.0).g * 0.35;
  let rho = cell.r * max(0.0, 1.0 + (n - 0.5) * 2.0 * detail);
  return vec2f(rho, cell.g * 0.75 + cell.b * 0.25);
}

// Spectral ring light, identical in reference-render.wgsl: nine sectors round the full circle, band 0 (bass)
// at the upper left and higher bands clockwise as in fluid.wgsl. Hue follows the band, brightness its level;
// w carries that brightness alone, for lamp coverage.
fn spectralLight(xy: vec2f, response: f32) -> vec4f {
  let s = fract((2.35619449 - atan2(xy.y, xy.x + 0.000001)) / TAU) * 9.0;
  let i = u32(s) % 9u;
  let j = (i + 1u) % 9u;
  let w = smoothstep(0.0, 1.0, fract(s));
  let a = pow(clamp(params.ringLevels[i / 4u][i % 4u], 0.0, 1.0), response) * (1.0 + 0.8 * clamp(params.ringAttacks[i / 4u][i % 4u], 0.0, 1.0));
  let b = pow(clamp(params.ringLevels[j / 4u][j % 4u], 0.0, 1.0), response) * (1.0 + 0.8 * clamp(params.ringAttacks[j / 4u][j % 4u], 0.0, 1.0));
  return vec4f(mix(lightPalette(params.display.x, f32(i) / 8.0) * a, lightPalette(params.display.x, f32(j) / 8.0) * b, w), mix(a, b, w));
}

// Same pinhole camera as render.wgsl: screen = xy / (1 - z / distance), eye on +z.
@fragment fn rayFragment(input: RayOutput) -> @location(0) vec4f {
  let eye = vec3f(0.0, 0.0, volume.box.w);
  let dir = normalize(vec3f(input.screen, -volume.box.w));
  let inv = 1.0 / dir;
  let t0 = (-volume.box.xyz - eye) * inv;
  let t1 = (volume.box.xyz - eye) * inv;
  let entry = max(max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z)), 0.0);
  let leave = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  if (leave <= entry) { return vec4f(0.0); }
  let steps = clamp(u32(volume.shading.z), 8u, 64u);
  let span = leave - entry;
  let dt = span / f32(steps);
  // Interleaved gradient noise offsets the first sample per pixel; the bilinear upscale hides it.
  let jitter = fract(52.9829189 * fract(dot(input.position.xy, vec2f(0.06711056, 0.00583715))));
  let extinction = volume.shading.w;
  let detail = volume.light.w;
  // Neutral grey smoke: slightly cool sky ambient, near-white key from above, albedo below 1.
  let ambient = vec3f(0.36, 0.38, 0.42) * volume.light.x;
  let key = vec3f(1.0, 0.98, 0.94) * volume.light.y;
  // The volume itself scatters the music lights; tiny additive particles alone
  // disappear behind dense smoke. Silent/demo input leaves this lighting off.
  let music = params.simulation.y > 0.5;
  var transmittance = 1.0;
  var color = vec3f(0.0);
  for (var i = 0u; i < steps; i++) {
    let q = eye + dir * (entry + (f32(i) + jitter) * dt);
    let s = density(q, detail);
    if (s.x > 0.0005) {
      let sigma = s.x * extinction;
      let absorbed = 1.0 - exp(-sigma * dt);
      // Lower smoke receives less sky. Weighting by the absorbed fraction keeps brightness
      // independent of the step count.
      let sky = 0.55 + 0.45 * smoothstep(-1.0, 1.0, q.y);
      // Sector lamps sit on a band round the emitting ring; the undefined direction at the centre stays unlit.
      let r = length(q.xy);
      let lamp = select(vec4f(0.0), spectralLight(q.xy, 0.65), music) * exp(-(r - 0.42) * (r - 0.42) * 2.2) * smoothstep(0.03, 0.18, r);
      let musicLight = lamp.rgb;
      let lampCoverage = min(lamp.w, 1.0);
      let neutral = 0.82 * (1.0 - lampCoverage * 0.88) * (ambient * sky + key * s.y);
      color += transmittance * absorbed * (neutral + musicLight * 8.0);
      transmittance *= 1.0 - absorbed;
      if (transmittance < 0.01) { break; }
    }
  }
  return vec4f(color, 1.0 - transmittance);
}

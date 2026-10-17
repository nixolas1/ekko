// Reference modes 5 (plume) and 6 (twin vortex bundles). Standalone: common-shader.wgsl is prepended.
// Very fine short streaks; each particle carries a fixed light energy spread over its streak, so faint
// isolated points vanish and only the projected density of sheets (edge-on folds) reads as bright bands.
@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Parameters;
struct ReferenceOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,        // in gaussian sigmas: x along the streak, y across it
  @location(1) color: vec3f,
  @location(2) halfLength: f32,  // half streak length in sigmas
}
// Tuning gains for the main agent: per-particle light energy in pixel units at 1080 px scene height.
const PLUME_GRAY = 0.09;
const PLUME_LAMP = 0.9;
const VORTEX_GAIN = 0.16;

// Must match reference-simulation.wgsl.
fn refLife(id: u32, mode: f32) -> f32 { return select(6.5 + 3.0 * rnd(id, 51u), 9.0 + 4.0 * rnd(id, 51u), (mode > 5.5 && mode < 6.5)); }
fn refSide(id: u32) -> u32 { return select(0u, 1u, rnd(id, 50u) < 0.55); }
fn ramp3(a: vec3f, b: vec3f, c: vec3f, t: f32) -> vec3f {
  let s = clamp(t, 0.0, 1.0) * 2.0;
  if (s < 1.0) { return mix(a, b, s); }
  return mix(b, c, s - 1.0);
}
// Thin bright threads: a few emitter positions shine more, so their streak lines become coherent filaments.
fn threads(u: f32, count: f32, sharp: f32) -> f32 {
  let x = 0.5 + 0.5 * sin(u * TAU * count + 2.0 * sin(u * TAU * 3.0));
  return pow(x, sharp);
}

@vertex fn referenceVertex(@builtin(vertex_index) vertexId: u32, @builtin(instance_index) id: u32) -> ReferenceOutput {
  let corner = vec2f(f32(vertexId & 1u), f32(vertexId >> 1u)) * 2.0 - 1.0;
  let p = particles[id];
  let mode = params.simulation.x;
  let age = p.extra.y;
  var o: ReferenceOutput;
  if (age <= 0.0 || p.state.w < 0.5 || (mode>6.5 && mode<7.5 && p.state.z!=7.0)) {
    o.position = vec4f(2.0, 2.0, 2.0, 1.0);
    o.uv = vec2f(0.0);
    o.color = vec3f(0.0);
    o.halfLength = 0.0;
    return o;
  }
  let life = select(refLife(id, mode), max(p.extra.w, 0.001), mode < 4.5 || (mode>6.5 && mode<7.5));
  let persp = 1.0 / (1.0 - clamp(p.position.z, -1.0, 1.0) * 0.35);
  let head = p.position.xy * persp;
  let vel = p.velocity.xy * persp;
  let speed = length(vel);
  let dir = select(vec2f(0.0, 1.0), vel / max(speed, 0.0001), speed > 0.0001);
  let perp = vec2f(-dir.y, dir.x);
  let heat = clamp(p.state.y, 0.0, 1.5);
  let seed = rnd(id, 6u);
  let pixel = 2.0 / max(params.display.z, 1.0);
  let sigmaPx = mix(0.45, 0.65, seed);
  let sigma = sigmaPx * pixel;
  // Short streaks: a few pixels at most, longer when a hand or burst has heated the particle.
  let trail = min(speed * (0.014 + 0.01 * heat), 6.0 * pixel * (1.0 + heat * 2.0));
  let halfLen = trail * 0.5;
  let extent = 2.6 * sigma;
  let center = head - dir * halfLen;
  let world = center + dir * corner.x * (halfLen + extent) + perp * corner.y * extent;
  o.position = vec4f(world.x / params.clock.z, world.y, 0.0, 1.0);
  o.uv = vec2f(corner.x * (halfLen + extent) / sigma, corner.y * extent / sigma);
  o.halfLength = halfLen / sigma;

  // Energy normalisation: integral of the streak profile is sigma^2 (2 pi + sqrt(2 pi) * 2 * halfLength).
  let area = sigmaPx * sigmaPx * (6.2831853 + 5.013 * o.halfLength);
  let density = select(params.style.z,1.0,mode>6.5 && mode<7.5) * params.style.w * (params.display.z / 1080.0);
  let fade = smoothstep(0.0, 0.35, age) * (1.0 - smoothstep(life * 0.65, life, age));
  let depth = clamp(0.8 + p.position.z * 0.6, 0.45, 1.2);
  let vary = 0.35 + 1.3 * seed * seed;
  let u = p.extra.x;
  let music = params.simulation.y > 0.5;
  var color = vec3f(0.0);
  if (mode < 4.5) {
    // Native-resolution subpixel filaments provide the detail the volumetric grid cannot hold.
    let radial = normalize(p.position.xy + vec2f(0.0001));
    let bands = select(vec3f(0.0), pow(clamp(params.sound.xyz,vec3f(0.0),vec3f(1.0)),vec3f(1.4)), music);
    let left = pow(max(0.0,-radial.x),2.0);
    let top = pow(max(0.0,radial.y),4.0);
    let right = pow(max(0.0,radial.x),2.0);
    let lighting = lightPalette(params.display.x,0.0) * bands.x * left
      + lightPalette(params.display.x,0.5) * bands.y * top
      + lightPalette(params.display.x,1.0) * bands.z * right;
    let thread = threads(u, 37.0, 5.0);
    // Coherent bright folds separated by transparent regions, rather than a uniform grey veil.
    let sheet = smoothstep(.22, .72, .5 + .5 * sin(u * TAU * 11.0 + sin(u * TAU * 3.0)));
    color = (vec3f(.09,.10,.12) + lighting * 2.1) * vary * (.12 + 1.5 * sheet) * (.45 + 1.6 * thread);
    color *= 1.0 + select(0.0, params.simulation.z * 1.5, music);
  } else if ((mode < 5.5 || mode > 7.5)) {
    // Neutral smoke; lamp light picked up at birth travels up with it and fades.
    let hue = clamp((u - 0.12) / 0.74, 0.0, 1.0);
    let glow = fract(p.position.w) * 2.0 * exp(-age * 0.42) * (1.0 + 2.5 * exp(-age * 4.0));
    let lamp = lightPalette(params.display.x, hue);
    let gray = vec3f(0.5, 0.53, 0.56) * PLUME_GRAY * vary * (0.6 + 1.4 * threads(u, 23.0, 6.0));
    color = gray + lamp * (glow + 0.08) * PLUME_LAMP * (0.6 + 0.6 * seed);
    if (mode > 7.5) {
      // Emission is latched at birth. Never re-flash old smoke when another note
      // plays: the local HDR patch moves with these particles and blooms nearby.
      let carried=fract(p.position.w)*2.0;
      let ember=carried*(1.0-smoothstep(life*.28,life*.9,age));
      let core=pow(clamp(ember,0.0,1.0),1.7);
      color=gray*1.7+lamp*ember*2.5*(.65+.65*seed)+vec3f(1.0,.95,.88)*core*.32;
    }
    if (music && mode < 5.5) {
      // Illuminate smoke that is already in the air on this frame, not just newborn particles.
      // Bass fills the whole sail; treble catches alternating ribbons and fine folded edges.
      let bass = pow(clamp(params.sound.x, 0.0, 1.0), 1.7);
      let treble = pow(clamp(params.sound.z, 0.0, 1.0), 1.35);
      let onset = params.simulation.z;
      let ribbons = pow(0.5 + 0.5 * sin(u * TAU * 7.0 + p.position.y * 3.5), 3.0);
      let lane = u32(clamp(round((u-.12)/.74*6.0),0.0,6.0));
      let laneLevel=emissionLevel(lane,params.emissionLow,params.emissionHigh);
      let flash = laneLevel * (bass * 0.9 + onset * 0.65 + treble * (0.2 + 1.5 * ribbons));
      color *= 1.0 + bass * 3.5 + onset * 2.0;
      color += lamp * flash * PLUME_LAMP * (0.65 + 0.55 * seed);
    }
  } else if (mode>6.5 && mode<7.5) {
    let lamp=lightPalette(params.display.x,u);
    let carried=p.position.w*(1.0-smoothstep(life*.25,life*.95,age));
    let filament=.35+1.3*seed*seed;
    color=(lamp*(.18+carried*2.4)+vec3f(1.0,.95,.9)*pow(carried,2.0)*.18)*filament;
  } else {
    // Warm left, icy right; colour cools/deepens with age, bright threads go white-gold / white-ice.
    let a = age / life;
    let right = refSide(id) == 1u;
    let warm = ramp3(vec3f(1.0, 0.82, 0.42), vec3f(1.0, 0.45, 0.08), vec3f(0.7, 0.18, 0.04), a * 1.3 + (seed - 0.5) * 0.3);
    let cool = ramp3(vec3f(0.72, 0.88, 1.0), vec3f(0.32, 0.42, 1.0), vec3f(0.48, 0.22, 0.95), a * 1.3 + (seed - 0.5) * 0.3);
    var base = select(warm, cool, right);
    base = mix(base, vec3f(0.5, 0.56, 0.16) * 0.8, clamp(p.position.w, 0.0, 1.0) * 0.8);
    let thread = threads(u, 13.0, 10.0);
    base = mix(base, select(vec3f(1.0, 0.93, 0.7), vec3f(0.85, 0.95, 1.0), right), thread * 0.6);
    if (params.display.x < 5.5) {
      base = lightPalette(params.display.x, select(a * .38, .62 + a * .38, right));
      base = mix(base, vec3f(1.0), thread * .25);
    }
    let band = select(clamp(params.sound.x, 0.0, 1.0), clamp(params.sound.z, 0.0, 1.0), right);
    let pulse = 1.0 + select(0.0, band * 0.6, music);
    color = base * VORTEX_GAIN * vary * (1.0 + 1.6 * thread) * (1.0 + 1.2 * exp(-age * 0.8)) * pulse;
  }
  color += vec3f(1.0, 0.95, 0.85) * heat * 0.08;
  o.color = color * density * depth * fade / area;
  return o;
}
@fragment fn referenceFragment(input: ReferenceOutput) -> @location(0) vec4f {
  let beyond = max(abs(input.uv.x) - input.halfLength, 0.0);
  let r2 = beyond * beyond + input.uv.y * input.uv.y;
  return vec4f(input.color * exp(-0.5 * r2), 0.0);
}

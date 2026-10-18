// Shared by particles.wgsl, render.wgsl and post-shader.wgsl. gpu.js prepends this file to each module.
struct Particle {
  position: vec4f, // xyz, excitement 0..1 (weakens the spring, decays after a burst)
  velocity: vec4f, // xyz, seed
  state: vec4f,    // last burst serial consumed, heat 0..1 (white-hot glow), simulation mode, initialised flag
  extra: vec4f,    // strand 0..1, position along strand, layer 0/1/2, colour jitter
}
struct Parameters {
  clock: vec4f,   // time, delta, aspect, count
  sound: vec4f,   // bass, mid, high, energy
  display: vec4f, // palette, scene pixel width, scene pixel height, force count
  burst: vec4f,   // latest burst x, y, serial after this frame's drain, serial before it
  forces: array<vec4f, 32>, // x, y, strength, radius
  style: vec4f,   // effect, fill, brightness gain, frame scale
  extra: vec4f,   // bursts drained this frame, trail decay, exposure, bloom strength
  bursts: array<vec4f, 8>,  // x, y, serial, strength
  forceVel: array<vec4f, 32>, // smoothed velocity xy, Wand/Vortex blend weights zw
  simulation: vec4f, // mode: 0 sculpture, 1 persistent, 2 smoke, 3 ring, 4 volume, 5 plume, 6 duet; audible input active, onset envelope, reserved
  emissionLow: vec4f, // seven measured bands: bass to treble
  emissionHigh: vec4f,
  ringLevels: array<vec4f,3>, // nine ascending frequency bands
  ringAttacks: array<vec4f,3>, // independently decaying note attacks
  mouse: vec4f, // world xy, radius, active
  tuning: vec4f, // speed, turbulence, glow, emission
}
const TAU = 6.2831853;
fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
// Independent uniform 0..1 stream per (id, salt).
fn rnd(id: u32, salt: u32) -> f32 {
  return f32(pcg(pcg(id) ^ (salt * 2654435769u + 2135587861u)) >> 8u) / 16777216.0;
}

// One palette definition for particle lamps, smoke lighting and reference filaments.
fn lightRamp(a: vec3f, b: vec3f, c: vec3f, d: vec3f, t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0) * 3.0;
  if (x < 1.0) { return mix(a, b, x); }
  if (x < 2.0) { return mix(b, c, x - 1.0); }
  return mix(c, d, x - 2.0);
}
fn lightPalette(choice: f32, t: f32) -> vec3f {
  let u = clamp(t, 0.0, 1.0);
  if (choice > 5.5) { return lightRamp(vec3f(1.0,.18,.015),vec3f(1.0,.75,.2),vec3f(.12,.65,1.0),vec3f(.6,.25,1.0),u); }
  if (choice > 4.5) { return mix(vec3f(.55,.65,.8),vec3f(1.0),u); }
  if (choice > 3.5) { return lightRamp(vec3f(1.0,.015,.28),vec3f(.65,.02,1.0),vec3f(.015,.5,1.0),vec3f(.02,1.0,.65),u); }
  if (choice > 2.5) {
    // Red, orange, yellow, green, cyan, blue and violet, without a white midpoint.
    let rgb = clamp(abs(fract(vec3f(u*.79) + vec3f(0.0,2.0/3.0,1.0/3.0))*6.0-3.0)-1.0,vec3f(0.0),vec3f(1.0));
    let color = mix(vec3f(.015),vec3f(1.0),rgb);
    // Blue needs more energy than yellow to remain equally legible on black.
    return color * clamp(.55 / max(dot(color,vec3f(.2126,.7152,.0722)),.1),.85,1.8);
  }
  if (choice > 1.5) { return lightRamp(vec3f(.02,.2,.9),vec3f(.08,.6,1.0),vec3f(.15,.9,.95),vec3f(.6,1.0,.85),u); }
  if (choice > .5) { return lightRamp(vec3f(1.0,.07,.03),vec3f(1.0,.4,.04),vec3f(1.0,.85,.1),vec3f(1.0,.95,.6),u); }
  return lightRamp(vec3f(.1,.95,.55),vec3f(.1,.6,1.0),vec3f(.55,.22,1.0),vec3f(1.0,.25,.6),u);
}

fn emissionLevel(lane: u32, low: vec4f, high: vec4f) -> f32 {
  let i=min(lane,6u);
  if (i<4u) { return low[i]; }
  return high[i-4u];
}

// Soft mouse obstacle: compact support, maximum repulsion at its centre.
fn mouseVelocity(q:vec2f,v:vec2f,mouse:vec4f,dt:f32)->vec2f {
  let delta=q-mouse.xy;let distance=length(delta);let radius=max(mouse.z,.001);
  if(mouse.w<.5 || distance>=radius || dt<=0.0){return v;}
  let n=select(vec2f(1,0),delta/max(distance,.00001),distance>.00001);
  let falloff=pow(1.0-distance/radius,2.0);
  return v+n*max(0.0,2.4*falloff-dot(v,n))*(1.0-exp(-dt*35.0));
}

// Continuous gesture blending, shared by all particle and fluid modes. A wand
// gathers a tiny core; a vortex preserves an orbit instead of collapsing it.
fn gestureFlow(base:vec2f,delta:vec2f,radius:f32,motion:vec2f,weights:vec2f)->vec2f {
  if(weights.x+weights.y<.0001){return base;}
  let d=length(delta);let n=delta/max(d,.001);let tangent=vec2f(-n.y,n.x);
  let wand=n*clamp((d-.018)*10.0,-.25,2.4)+tangent*.08+motion*.85;
  let orbit=max(radius*.42,.06);
  let vortex=n*clamp((d-orbit)*5.0,-1.2,1.2)+tangent*2.6*smoothstep(0.0,orbit*.35,d)+motion*.65;
  return base*max(0.0,1.0-weights.x-weights.y)+wand*weights.x+vortex*weights.y;
}

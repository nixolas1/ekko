// Shader starting point: gpu.js prepends this source to every shader module;
// WGSL files here do not import one another. The particle compute module also
// appends reference-simulation.wgsl after particles.wgsl.
//
// Data stays on the GPU: compute updates the particle storage buffer, then the
// vertex shaders read that same buffer to draw it. JavaScript uploads Parameters
// once per frame for timing, audio and interaction, rather than uploading every
// particle. Bindings in each module connect these declarations to gpu.js/fluid.js.
//
// Coordinates: scene y spans roughly -1..1, x spans -aspect..aspect, and +z is
// towards the camera. Render shaders divide x by aspect to reach clip space.
// clock.y is the simulation step in seconds (zero when paused); clock.x is time.
//
// Layout contract: four vec4f fields make Particle 64 bytes. Parameters is packed
// in 16-byte vec4f slots, including its arrays. Keep field order and sizes in sync
// with PARTICLE_BYTES, UNIFORM_FLOATS and Float32Array offsets in gpu.js.
// The Particle annotations below describe sculpture mode. Smoke reuses these
// slots for age/lifetime, and reference-simulation.wgsl documents its own layout.
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
  forces: array<vec4f, 32>, // x, y, strength, radius (negative radius = cursor obstacle)
  style: vec4f,   // effect, fill, brightness gain, frame scale
  extra: vec4f,   // bursts drained this frame, trail decay, exposure, bloom strength
  bursts: array<vec4f, 8>,  // x, y, serial, strength
  forceVel: array<vec4f, 32>, // smoothed velocity xy, Wand/Vortex blend weights zw
  simulation: vec4f, // mode (see below), audible input active, onset envelope, audio response gain
  emissionLow: vec4f, // seven measured bands: bass to treble
  emissionHigh: vec4f,
  ringLevels: array<vec4f,3>, // nine ascending frequency bands
  ringAttacks: array<vec4f,3>, // independently decaying note attacks
  mouse: vec4f, // world xy, radius, active
  tuning: vec4f, // speed, turbulence, glow, emission
}
// Shader mode numbers differ from the UI's flowMode: 0 sculpture, 1 persistent,
// 2 fluid smoke, 3 particle ring, 4 spectral volume, 5 plume, 6 twin vortices,
// 7 fluid ring, 8 lasting-glow plume. gpu.js routes 2/7 to fluid.js instead of
// the particle compute pass; mode 7 shares the reference particle renderer.
const TAU = 6.2831853;
// Integer hashing gives reproducible variation without a random-state buffer.
// Different salts let one particle have unrelated lifetime, colour and position
// samples; reuse the same id/salt when a property should stay stable over time.
fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
// Deterministic pseudo-random value in [0,1). Keeping the upper 24 bits makes the
// integer exactly representable as f32 before scaling; no sample rounds up to 1.
fn rnd(id: u32, salt: u32) -> f32 {
  return f32(pcg(pcg(id) ^ (salt * 2654435769u + 2135587861u)) >> 8u) / 16777216.0;
}

// One palette definition for particle lamps, smoke lighting and reference filaments.
// These are linear HDR light values: components may exceed 1 until the final
// post-process maps them to the display. Early clamping would remove bloom energy.
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
// The early return avoids force math outside the radius. 1-exp(-rate*dt) relaxes
// velocity towards an outward target without overshooting that target, and
// exp(-rate*dt) elsewhere provides decay that accounts for elapsed time.
fn mouseVelocity(q:vec2f,v:vec2f,mouse:vec4f,dt:f32)->vec2f {
  let delta=q-mouse.xy;let distance=length(delta);let radius=max(mouse.z,.001);
  if(mouse.w<.5 || distance>=radius || dt<=0.0){return v;}
  let n=select(vec2f(1,0),delta/max(distance,.00001),distance>.00001);
  let falloff=pow(1.0-distance/radius,2.0);
  return v+n*max(0.0,2.4*falloff-dot(v,n))*(1.0-exp(-dt*35.0));
}

// Apply the mouse and all pointing fingertips with the same compact response.
fn cursorVelocity(q:vec2f,velocity:vec2f,dt:f32)->vec2f {
  var v=mouseVelocity(q,velocity,params.mouse,dt);
  for(var j=0u;j<min(u32(params.display.w),32u);j++){
    let f=params.forces[j];
    if(f.w<0.0 && f.z>0.0){v=mouseVelocity(q,v,vec4f(f.xy,-f.w,1.0),dt*f.z);}
  }
  return v;
}

// Continuous gesture blending, shared by all particle and fluid modes. A wand
// gathers a tiny core; a vortex preserves an orbit instead of collapsing it.
// delta points towards the hand; rotating its unit direction by 90 degrees gives
// the tangent used for orbiting. gpu.js normalises the two gesture weights so
// their sum is at most 1, leaving the remaining weight for the ordinary force.
fn gestureFlow(base:vec2f,delta:vec2f,radius:f32,motion:vec2f,weights:vec2f)->vec2f {
  if(weights.x+weights.y<.0001){return base;}
  let d=length(delta);let n=delta/max(d,.001);let tangent=vec2f(-n.y,n.x);
  let wand=n*clamp((d-.018)*10.0,-.25,2.4)+tangent*.08+motion*.85;
  let orbit=max(radius*.42,.06);
  let vortex=n*clamp((d-orbit)*5.0,-1.2,1.2)+tangent*2.6*smoothstep(0.0,orbit*.35,d)+motion*.65;
  return base*max(0.0,1.0-weights.x-weights.y)+wand*weights.x+vortex*weights.y;
}

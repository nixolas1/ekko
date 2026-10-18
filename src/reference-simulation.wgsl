// Reference modes, appended to particles.wgsl after common-shader.wgsl. Mode 5:
// rising smoke sheets lit along a curved emitter; mode 6: two rolling vortex
// bundles; mode 8: the plume with dim continuous smoke and light captured at birth.
// simulate() in particles.wgsl calls simulateReference(); this file has no entry
// point of its own and shares params, rnd(), separation() and interaction helpers.
//
// The analytic fields use curls and axisymmetric stream functions to make
// divergence-free flow in their intended domain. Nearby particles follow a
// shared smooth field, folding a line of emissions into visible sheets. Added
// interactions, discrete integration and domain clamps can break that ideal.
// Unlike fluid.wgsl, these modes do not iterate a pressure grid: they evaluate
// prescribed velocity formulas per particle. This saves grid passes but does
// not simulate smoke pushing back on its environment or arbitrary fluid boundaries.
// Particle layout in these modes:
//   position: xyz, w = mode 5: lamp hue step 0..7 plus glow * 0.5 in the fraction;
//                     mode 6: olive mixing 0..1; mode 8: captured emission strength * 0.65
//   velocity: xyz total velocity (streak direction), w = impulse x
//   state:    last burst serial, heat, mode, initialised
//   extra:    emitter parameter u 0..1, age (negative while waiting to be born), impulse y, impulse z
// The impulse is the hand/burst velocity on top of the analytic flow; it decays, so shapes recover.
// Packing mode-specific values into the shared 64-byte record avoids extra
// per-particle buffers. Keep reference-render.wgsl in sync when changing meanings.

struct RefCurl { potential: vec3f, curl: vec3f }
struct RefBundle { center: vec3f, axis: vec3f, size: vec2f } // size: ring radius, core width

fn refLife(id: u32, mode: f32) -> f32 { return select(6.5 + 3.0 * rnd(id, 51u), 9.0 + 4.0 * rnd(id, 51u), (mode > 5.5 && mode < 6.5)); }
fn refSide(id: u32) -> u32 { return select(0u, 1u, rnd(id, 50u) < 0.55); }
fn refFit() -> f32 { return clamp(params.clock.z / 1.6, 0.6, 1.1); }
// Same horizontal centring as the sculptures: shifted right of the intro, centred when filling the scene.
fn refOffset() -> f32 { return mix(0.1, 0.0, clamp(params.style.y, 0.0, 1.0)) * params.clock.z * clamp(params.clock.z / 1.2, 0.45, 1.0); }
// smoothstep value and its derivative.
// Returning both avoids estimating the derivative with extra field evaluations;
// refLayer/refJet need it to fade a flow without introducing compression.
fn refStep(a: f32, b: f32, x: f32) -> vec2f {
  let s = clamp((x - a) / (b - a), 0.0, 1.0);
  return vec2f(s * s * (3.0 - 2.0 * s), 6.0 * s * (1.0 - s) / (b - a));
}
fn refBasis(n: vec3f) -> mat2x3f {
  // Build two perpendicular vectors around a unit axis. Switch the helper axis
  // near the pole so their cross product does not collapse to almost zero.
  let b1 = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
  return mat2x3f(b1, cross(n, b1));
}

// Sum of plane waves A = a sin(k.q + wt) / |k|; its curl is (dir x a) cos(k.q + wt).
// Directions follow a Fibonacci sphere, so no axis dominates and neighbouring points share phases.
// Evaluate potential and curl together using their analytic formulas: computing
// curl with finite differences would need several extra samples of the potential.
// Only a few waves are used per frequency scale; more waves add variation but
// multiply trigonometric work for every particle. 1/sqrt(count) normalises their
// approximate combined amplitude so adding waves does not simply amplify motion.
fn refWaves(q: vec3f, t: f32, base: f32, count: u32, salt: f32) -> RefCurl {
  var potential = vec3f(0.0);
  var curl = vec3f(0.0);
  for (var i = 0u; i < count; i++) {
    let fi = f32(i) + salt;
    let z = 1.0 - 2.0 * fract(fi * 0.6180339 + 0.31);
    let azimuth = fi * 2.3999632;
    let r = sqrt(max(1.0 - z * z, 0.0));
    let dir = vec3f(r * cos(azimuth), r * sin(azimuth), z);
    let basis = refBasis(dir);
    let b = fi * 1.7320508;
    let amp = basis[0] * cos(b) + basis[1] * sin(b);
    let k = base * (0.75 + 0.5 * fract(fi * 0.7548777));
    let phase = dot(dir, q) * k + t * (0.1 + 0.25 * fract(fi * 0.5698403)) * (k / base) + fi * 4.1;
    potential += amp * sin(phase) / k;
    curl += cross(dir, amp) * cos(phase);
  }
  let norm = inverseSqrt(f32(count));
  return RefCurl(potential * norm, curl * norm);
}
// curl(g(y) A) = g curl A + grad g x A, with grad g = (0, g', 0): turbulence fades in with height
// without breaking incompressibility.
// Simply multiplying velocity by g would omit the derivative term. Fading the
// vector potential and then taking its curl preserves the divergence-free design.
fn refLayer(w: RefCurl, g: vec2f, amplitude: f32) -> vec3f {
  return (w.curl * g.x + vec3f(w.potential.z, 0.0, -w.potential.x) * g.y) * amplitude;
}

// ---------------------------------------------------------------- mode 5: plume

fn refEmitter(u: f32) -> vec3f {
  let theta = (u - 0.5) * 2.5;
  // Front arc of a wide ellipse; perspective bends it into the shallow curved rim of the reference.
  return vec3f(refOffset() + sin(theta) * 0.8 * refFit(), -0.8 - 0.035 * cos(theta), 0.42 * (cos(theta) - 0.62));
}
fn refPlumeFlow(q: vec3f, t: f32) -> vec3f {
  let music = params.simulation.y > 0.5;
  let bands = select(vec3f(0.0), clamp(params.sound.xyz, vec3f(0.0), vec3f(1.0)), music);
  let h = max(q.y + 0.8, 0.0);
  // Buoyant column slowing with height; the lateral spread is exactly what keeps it incompressible
  // (d/dx of the spread cancels d/dy of the rise).
  let lift = (0.3 + 0.025 * sin(t * 0.41)) * (1.0 + bands.x * 0.45);
  let denom = 1.0 + 0.5 * h;
  let spread = 0.5 * lift / (denom * denom);
  var v = vec3f((q.x - refOffset()) * spread * 0.7, lift / denom, (q.z + 0.05) * spread * 0.3);
  // High-level drift, uniform in x: carries the billows aside without compressing them.
  v.x += (-0.09 + 0.07 * sin(t * 0.053 + 1.3)) * smoothstep(0.5, 1.5, h);
  // Eddies ride up with the smoke (frozen turbulence), so folds persist instead of shimmering.
  // Laminar at the emitter, billowing above.
  // Three frequency scales provide large billows, medium folds and fine ripples.
  // Fewer waves and lower amplitudes at fine scales bound cost and avoid letting
  // tiny motion overwhelm the coherent sheets created by the larger scales.
  let carried = vec3f(q.x, q.y - 0.24 * t, q.z);
  v += refLayer(refWaves(carried, t * 0.6, 2.4, 6u, 0.0), refStep(0.05, 1.1, h), 0.34 * (1.0 + bands.y * 0.6));
  v += refLayer(refWaves(carried, t, 6.2, 5u, 11.0), refStep(0.0, 0.55, h), 0.1);
  v += refLayer(refWaves(carried, t * 1.4, 15.0, 4u, 23.0), refStep(0.0, 0.3, h), 0.03 * (1.0 + bands.z * 1.5));
  return v;
}
fn refLampLevel(i: f32, band: f32, t: f32) -> f32 {
  let idle = 0.16 + 0.84 * pow(0.5 + 0.5 * sin(t * (0.43 + 0.13 * i) + i * 2.3), 5.0);
  if (params.simulation.y > 0.5) { return 0.12 + 0.25 * idle + 1.4 * pow(clamp(band, 0.0, 1.0), 1.4); }
  return idle;
}
// Narrow lamps along the emitter: x centre in u, width, hue 0 lime .. 0.5 emerald .. 1 cyan-white, level.
// Returns glow and the glow-weighted hue.
fn refLamps(u: f32, t: f32) -> vec2f {
  let s = params.sound.xyz;
  var lamps = array<vec4f, 7>(
    vec4f(0.12, 0.04, 0.0, refLampLevel(0.0, emissionLevel(0u, params.emissionLow, params.emissionHigh), t)),
    vec4f(0.24, 0.04, 0.17, refLampLevel(1.0, emissionLevel(1u, params.emissionLow, params.emissionHigh), t)),
    vec4f(0.36, 0.04, 0.33, refLampLevel(2.0, emissionLevel(2u, params.emissionLow, params.emissionHigh), t)),
    vec4f(0.49, 0.04, 0.5, refLampLevel(3.0, emissionLevel(3u, params.emissionLow, params.emissionHigh), t)),
    vec4f(0.61, 0.04, 0.67, refLampLevel(4.0, emissionLevel(4u, params.emissionLow, params.emissionHigh), t)),
    vec4f(0.74, 0.04, 0.83, refLampLevel(5.0, emissionLevel(5u, params.emissionLow, params.emissionHigh), t)),
    vec4f(0.86, 0.04, 1.0, refLampLevel(6.0, emissionLevel(6u, params.emissionLow, params.emissionHigh), t)));
  let du = (u - 0.34) / 0.13;
  let wash = 0.1 * exp(-du * du) * (0.6 + 0.4 * sin(t * 0.21));
  var glow = wash;
  var hue = wash * 0.25;
  for (var i = 0u; i < 7u; i++) {
    let lamp = lamps[i];
    let d = (u - lamp.x) / lamp.y;
    let g = lamp.w * exp(-d * d);
    glow += g;
    hue += g * lamp.z;
  }
  return vec2f(glow, hue / max(glow, 0.0001));
}

// ---------------------------------------------------------------- mode 6: twin vortex bundles

fn refBundle(side: u32, t: f32) -> RefBundle {
  let fit = refFit();
  let span = min(params.clock.z, 2.0);
  let ox = refOffset();
  if (side == 0u) {
    return RefBundle(
      vec3f(ox - 0.56 * span + 0.03 * sin(t * 0.13), 0.26 + 0.03 * sin(t * 0.17 + 1.0), -0.05),
      normalize(vec3f(0.92, 0.3 + 0.12 * sin(t * 0.11), 0.42 + 0.18 * sin(t * 0.07 + 1.0))),
      vec2f(0.2 * (1.0 + 0.07 * sin(t * 0.29)), 0.23) * fit);
  }
  return RefBundle(
    vec3f(ox + 0.4 * span + 0.03 * sin(t * 0.11 + 2.0), -0.07 + 0.03 * sin(t * 0.15), 0.05),
    normalize(vec3f(-0.82, 0.24 + 0.1 * sin(t * 0.09 + 2.0), 0.55 + 0.18 * cos(t * 0.06))),
    vec2f(0.25 * (1.0 + 0.07 * sin(t * 0.23 + 1.0)), 0.28) * fit);
}
// Vortex ring from the stream function psi = strength * rho^2 * exp(-((rho - R)^2 + s^2) / w^2):
// u_rho = -(1/rho) dpsi/ds, u_s = (1/rho) dpsi/drho, plus an axisymmetric swirl. Flow goes through the hole
// along +axis, rolls over the core and returns outside: closed whorls that particles wind round.
// rho is distance from the bundle axis and s is distance along it. Derivatives
// of one stream function couple axial and radial speeds consistently, producing
// circulation without solving a velocity grid. The apparent 1/rho factors have
// been cancelled algebraically in vr/vs; the direction still needs a safe divisor.
fn refRing(p: vec3f, b: RefBundle, strength: f32, swirl: f32) -> vec3f {
  let r = p - b.center;
  let s = dot(r, b.axis);
  let radial = r - b.axis * s;
  let rho = length(radial);
  let e = select(vec3f(0.0), radial / max(rho, 0.00001), rho > 0.00001);
  let w2 = b.size.y * b.size.y;
  let falloff = exp(-((rho - b.size.x) * (rho - b.size.x) + s * s) / w2);
  let vr = strength * 2.0 * rho * s / w2 * falloff;
  let vs = strength * falloff * (2.0 - 2.0 * rho * (rho - b.size.x) / w2);
  return e * vr + b.axis * vs + cross(b.axis, e) * swirl * rho * falloff;
}
// Feeding jet behind the ring, psi = strength/2 * rho^2 * exp(-rho^2 / width^2) * window(s).
fn refJet(p: vec3f, b: RefBundle, strength: f32) -> vec3f {
  let fit = refFit();
  let r = p - b.center;
  let s = dot(r, b.axis);
  let radial = r - b.axis * s;
  let rho = length(radial);
  let e = select(vec3f(0.0), radial / max(rho, 0.00001), rho > 0.00001);
  let width2 = 0.0072 * fit * fit;
  let rise = refStep(-0.8 * fit, -0.6 * fit, s);
  let fall = refStep(-0.18 * fit, 0.05 * fit, s);
  let gate = rise.x * (1.0 - fall.x);
  let slope = rise.y * (1.0 - fall.x) - rise.x * fall.y;
  let g = exp(-rho * rho / width2);
  return b.axis * (strength * gate * g * (1.0 - rho * rho / width2)) - e * (0.5 * strength * rho * g * slope);
}
fn refMeet(t: f32) -> vec3f {
  let span = min(params.clock.z, 2.0);
  return vec3f(refOffset() - 0.08 * span, 0.1 + 0.05 * sin(t * 0.12), 0.5 * span);
}
fn refVortexFlow(q: vec3f, t: f32) -> vec3f {
  let fit = refFit();
  let music = params.simulation.y > 0.5;
  let bands = select(vec3f(0.0), clamp(params.sound.xyz, vec3f(0.0), vec3f(1.0)), music);
  let left = refBundle(0u, t);
  let right = refBundle(1u, t);
  let breatheL = 0.85 + 0.3 * pow(0.5 + 0.5 * sin(t * 0.37), 2.0);
  let breatheR = 0.85 + 0.3 * pow(0.5 + 0.5 * sin(t * 0.31 + 2.0), 2.0);
  var v = refRing(q, left, 0.22 * (breatheL + bands.x * 0.9), 0.9 * (1.0 + bands.y * 0.8));
  v += refRing(q, right, 0.21 * (breatheR + bands.z * 0.9), -0.75 * (1.0 + bands.y * 0.8));
  v += refJet(q, left, 0.42 * (1.0 + bands.x * 0.8));
  v += refJet(q, right, 0.42 * (1.0 + bands.z * 0.8));
  // Where leaked smoke from both bundles meets: a 2D stagnation stream function
  // psi = a X Y exp(-(X^2 + Y^2) / L^2) squeezes it in x and spreads it up and down.
  let meet = refMeet(t);
  let d = q.xy - meet.xy;
  let L2 = meet.z * meet.z;
  let E = exp(-dot(d, d) / L2);
  let a = -0.3;
  v += vec3f(a * d.x * E * (1.0 - 2.0 * d.y * d.y / L2), -a * d.y * E * (1.0 - 2.0 * d.x * d.x / L2), 0.0);
  v += refWaves(q, t * 0.5, 3.0 / fit, 6u, 31.0).curl * 0.1;
  v += refWaves(q, t, 8.0 / fit, 5u, 41.0).curl * 0.04 * (1.0 + bands.z);
  return v;
}

// ---------------------------------------------------------------- shared lifecycle

fn refField(q: vec3f, t: f32, mode: f32) -> vec3f {
  if ((mode > 5.5 && mode < 6.5)) { return refVortexFlow(q, t); }
  return refPlumeFlow(q, t);
}
fn refOrigin(id: u32, u: f32, mode: f32, key: u32, t: f32) -> vec3f {
  let jitter = (vec3f(rnd(key, 44u), rnd(key, 45u), rnd(key, 46u)) - vec3f(0.5)) * 0.004;
  if ((mode > 5.5 && mode < 6.5)) {
    // A small circle on the jet axis, behind each ring: a closed line source, so the streak surface is a tube
    // that the ring rolls up into nested sheets.
    let fit = refFit();
    let b = refBundle(refSide(id), t);
    let basis = refBasis(b.axis);
    let a = u * TAU;
    return b.center - b.axis * 0.6 * fit + (basis[0] * cos(a) + basis[1] * sin(a)) * 0.045 * fit + jitter;
  }
  return refEmitter(u) + jitter;
}
fn refSpawn(id: u32, mode: f32, warm: bool) -> Particle {
  let t = params.clock.x;
  let key = id ^ pcg(u32(t * 71.0) + u32(mode) * 7919u);
  let life = refLife(id, mode);
  let gated = (mode < 5.5 || mode > 7.5) && params.simulation.y > 0.5;
  let warmStart = warm && !gated;
  var u = rnd(key, 41u);
  // Mode 5 favours the lit middle of the emitter, leaving dark gaps at the ends.
  if ((mode < 5.5 || mode > 7.5) && rnd(key, 40u) < 0.4) { u = clamp(0.42 + (rnd(key, 42u) + rnd(key, 43u) + u - 1.5) * 0.2, 0.0, 1.0); }
  // Staggered waits change the birth rate with loudness; without music the plume stays well fed.
  var age = -rnd(key, 36u) * 0.9 / (0.6 + clamp(params.sound.w, 0.0, 1.0) * 2.0);
  if (warmStart) { age = rnd(id, 37u) * life * 0.95; }
  if (gated) { u = .12 + f32(id % 7u) / 6.0 * .74 + (rnd(key,42u)-.5)*.06; age = -0.001; }
  let birth = t - max(age, 0.0);
  var q = refOrigin(id, u, mode, key, birth);
  // Warm start: integrate the analytic flow over the particle's age (midpoint rule) so the first frame
  // already shows developed sheets. Used for initialisation/mode changes and
  // invalid-state recovery, not ordinary recycling. At most 24 steps limit this
  // burst of work, but each midpoint step evaluates the field twice and can still
  // make initialisation more expensive than a steady-state simulation frame.
  if (warmStart) {
    let steps = clamp(u32(ceil(age / 0.3)), 1u, 24u);
    let h = age / f32(steps);
    for (var i = 0u; i < steps; i++) {
      let tt = birth + h * f32(i);
      let k1 = refField(q, tt, mode);
      q += refField(q + k1 * h * 0.5, tt + h * 0.5, mode) * h;
    }
  }
  var w = 0.0;
  if ((mode < 5.5 || mode > 7.5)) {
    let lamp = refLamps(u, birth);
    w = round(clamp(lamp.y, 0.0, 1.0) * 7.0) + min(lamp.x * 0.5, 0.999);
    if(mode>7.5){w=0.0;}
  } else if (warmStart) {
    let m = refMeet(t);
    let dm = (q.x - m.x) / (0.3 * refFit());
    w = clamp(exp(-dm * dm) * age * 0.15, 0.0, 1.0);
  }
  if (!all(abs(q) < vec3f(8.0))) { q = refOrigin(id, u, mode, key, t); }
  return Particle(vec4f(q, w), vec4f(refField(q, t, mode), 0.0), vec4f(params.burst.z, 0.0, mode, 1.0), vec4f(u, age, 0.0, 0.0));
}

fn simulateReference(id: u32, old: Particle) -> Particle {
  let dt = params.clock.y;
  let t = params.clock.x;
  let mode = params.simulation.x;
  var p = old;
  let invalid = !all(abs(p.position) < vec4f(8.0, 8.0, 8.0, 16.0)) || !all(abs(p.velocity) < vec4f(60.0)) || !all(abs(p.extra) < vec4f(2.0, 100.0, 60.0, 60.0));
  if (p.state.w < 0.5 || p.state.z != mode || invalid) { p = refSpawn(id, mode, true); }
  if (dt == 0.0) { return p; }
  if ((mode < 5.5 || mode > 7.5) && params.simulation.y > 0.5 && p.extra.y < 0.0) {
    // Negative age marks an inactive slot. A time-scaled event probability gates
    // emission per audio band; mode 8 adds a baseline even when the band is quiet.
    // Early return skips analytic flow/interaction work until this slot is born,
    // while retaining a fixed-size pool instead of allocating individual particles.
    let band=emissionLevel(id % 7u,params.emissionLow,params.emissionHigh);
    let strength=smoothstep(.06,.85,band);
    let chance=1.0-exp(-(strength*strength*strength*3.5+select(0.0,.16,mode>7.5))*params.tuning.w*dt);
    if (rnd(id ^ pcg(u32(t*1000.0)),63u) >= chance) { return p; }
    p.extra.y=0.0;
    let lamp=refLamps(p.extra.x,t);
    p.position.w=round(clamp(lamp.y,0.0,1.0)*7.0)+min(lamp.x*.5,.999);
    if(mode>7.5){p.position.w=min(strength*.65,.999);}
  }
  p.extra.y += dt;
  if (p.extra.y < 0.0) { return p; }
  var q = p.position.xyz;
  let flowV = refField(q, t, mode);
  var v = flowV + vec3f(p.velocity.w, p.extra.z, p.extra.w) * exp(-dt * 1.4);
  var heat = p.state.y * exp(-dt * 2.0);
  // Hand interactions as in simulateSmoke: closed hands attract and swirl, open hands repel,
  // both drag the smoke along with their motion.
  for (var j = 0u; j < min(u32(params.display.w), 32u); j++) {
    let f = params.forces[j];
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
      heat = max(heat, shock);
      p.state.x = b.z;
    }
  }
  // Very weak density pressure: separates coincident points in the ring cores without blurring the sheets.
  v += vec3f(separation(q.xy, id) * dt * 0.02, 0.0);
  var impulse = v - flowV;
  // Store only the interaction residual separately from the analytic velocity.
  // Next frame recomputes the field at the new position and decays this residual,
  // so hand motion does not permanently replace the underlying plume/vortex.
  impulse *= min(1.0, 3.0 / max(length(impulse), 0.001));
  v = flowV + impulse;
  v=vec3f(mouseVelocity(q.xy,v.xy,params.mouse,dt),v.z);
  q += v * dt * (0.85 + clamp(params.sound.w, 0.0, 1.0) * 0.6);
  var w = p.position.w;
  if ((mode > 5.5 && mode < 6.5)) {
    // Smoke drifting into the meeting zone gradually turns olive, as where the two colours mix in the reference.
    let m = refMeet(t);
    let dm = (q.x - m.x) / (0.3 * refFit());
    w = clamp(w * exp(-dt * 0.08) + dt * 0.35 * exp(-dm * dm), 0.0, 1.0);
  }
  let outside = abs(q.x) > params.clock.z * 1.25 || abs(q.y) > 1.35 || abs(q.z) > 1.4;
  if (p.extra.y > refLife(id, mode) || outside) { return refSpawn(id, mode, false); }
  return Particle(vec4f(q, w), vec4f(v, impulse.x), vec4f(p.state.x, heat, mode, 1.0), vec4f(p.extra.x, p.extra.y, impulse.y, impulse.z));
}

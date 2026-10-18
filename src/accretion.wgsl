// Actual particle integration, appended to particles.wgsl. A softened
// Paczynski-Wiita-style central potential supplies gravity; leapfrog integration
// preserves orbits. Weak drag removes angular momentum so material accretes.
// Lensing is an approximation in the particle vertex shader, not a painted disk.
fn accretionGravity(q: vec3f) -> vec3f {
  let r = max(length(q), .19);
  let gap = max(r - .12, .07);
  return -q * (.23 / (r * gap * gap));
}
fn newAccretion(id: u32, generation: f32, outer: bool) -> Particle {
  let key = id + u32(generation) * 7919u;
  let lane = (floor(pow(rnd(key, 71u), 1.35) * 96.0) + .15 + rnd(key, 72u) * .7) / 96.0;
  let r = select(.48 + lane * .96, 1.25 + rnd(key, 71u) * .2, outer);
  let angle = rnd(key, 73u) * TAU;
  let height = (rnd(key, 74u) - .5) * .016 * r;
  let q = vec3f(cos(angle) * r, height, sin(angle) * r);
  let speed = sqrt(.23 * r) / (r - .12);
  let v = vec3f(-sin(angle) * speed, 0.0, cos(angle) * speed);
  return Particle(vec4f(q, 0.0), vec4f(v, rnd(key, 75u)), vec4f(params.burst.w, 0.0, 10.0, 1.0), vec4f(lane, generation, 0.0, rnd(key, 76u)));
}
fn simulateAccretion(id: u32, previous: Particle) -> Particle {
  var p = previous;
  if (p.state.w < .5 || p.state.z != 10.0) { p = newAccretion(id, 0.0, false); }
  let dt = params.clock.y;
  if (dt <= 0.0) { return p; }
  var q = p.position.xyz;
  var v = p.velocity.xyz;
  var heat = p.state.y * exp(-dt * 1.8);
  var excitement = p.position.w * exp(-dt * .6);
  // Bursts act on the physical particles, once per serial, exactly as in other shapes.
  for (var i = 0u; i < min(u32(params.extra.x), 8u); i++) {
    let b = params.bursts[i];
    if (b.z <= p.state.x) { continue; }
    let imageId = accretionInteractionImage(q, b.xy);
    let delta = accretionImage(q, imageId) - b.xy;
    let shock = exp(-dot(delta, delta) / .42) * b.w;
    v += accretionImageLift(delta / max(length(delta), .015) * shock * 1.8, q, imageId);
    v.z += (rnd(id, 77u) - .5) * shock;
    heat = max(heat, shock); excitement = max(excitement, shock);
    p.state.x = b.z;
  }
  for (var j = 0u; j < min(u32(params.display.w), 32u); j++) {
    let f = params.forces[j];
    if (f.w < 0.0 || abs(f.z) < .001) { continue; }
    let imageId = accretionInteractionImage(q, f.xy);
    let screen = accretionImage(q, imageId);
    let delta = f.xy - screen;
    let distance = length(delta);
    let n = delta / max(distance, .001);
    let influence = exp(-dot(delta, delta) / max(f.w * f.w, .0009));
    let strength = min(abs(f.z), 216.0);
    var wanted = n * clamp((distance - .06) * 5.0, -1.0, 1.8) + vec2f(-n.y, n.x) * .9 + params.forceVel[j].xy * .8;
    if (f.z < 0.0) { wanted = -n * 2.4 + params.forceVel[j].xy * .4; }
    wanted = gestureFlow(wanted, delta, f.w, params.forceVel[j].xy, params.forceVel[j].zw);
    let screenVelocity = (accretionImage(q + v * .008, imageId) - screen) / .008;
    let blend = 1.0 - exp(-(1.5 + .9 * strength) * influence * dt);
    v += accretionImageLift((wanted - screenVelocity) * blend, q, imageId);
    heat = max(heat, influence * strength / 24.0);
    excitement = max(excitement, influence);
  }
  // Mouse and pointing fingertips use the same image-aware obstacle response.
  for (var j = 0u; j <= min(u32(params.display.w), 32u); j++) {
    var pointer = params.mouse;
    if (j > 0u) {
      let f = params.forces[j - 1u];
      if (f.w >= 0.0 || f.z <= 0.0) { continue; }
      pointer = vec4f(f.xy, -f.w, f.z);
    }
    if (pointer.w <= 0.0) { continue; }
    let imageId = accretionInteractionImage(q, pointer.xy);
    let screen = accretionImage(q, imageId);
    let screenVelocity = (accretionImage(q + v * .008, imageId) - screen) / .008;
    v += accretionImageLift(mouseVelocity(screen, screenVelocity, pointer, dt * pointer.w) - screenVelocity, q, imageId);
  }
  // Music drives a small radial pressure fluctuation, while gravity still
  // determines the orbit. Emission temperature also follows the measured bands.
  let bass = clamp(params.sound.x, 0.0, 1.0);
  let radial = q / max(length(q), .1);
  v += radial * sin(params.clock.x * 3.0 + p.extra.x * TAU * 3.0) * bass * dt * .18;
  heat = max(heat, bass * .2 + clamp(params.sound.z, 0.0, 1.0) * .15);
  // Two bounded kick-drift-kick substeps stay stable even near the inner edge.
  let h = dt * .5;
  for (var step = 0u; step < 2u; step++) {
    v += accretionGravity(q) * (h * .5);
    q += v * h;
    v += accretionGravity(q) * (h * .5);
  }
  v *= exp(-dt * .004);
  v.y *= exp(-dt * .55 * (1.0 - min(excitement, 1.0)));
  let r = length(q);
  if (r < .24 || r > 3.5 || !all(abs(v) < vec3f(30.0))) {
    return newAccretion(id, p.extra.y + 1.0, true);
  }
  p.position = vec4f(q, excitement);
  p.velocity = vec4f(v, p.velocity.w);
  p.state.y = heat;
  return p;
}

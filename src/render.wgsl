@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Parameters;
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,         // in line widths: x along the streak, y across it
  @location(1) color: vec3f,
  @location(2) lengthRatio: f32,  // streak length in line widths
}
fn ramp(a: vec3f, b: vec3f, c: vec3f, d: vec3f, t: f32) -> vec3f {
  let s = t * 3.0;
  if (s < 1.0) { return mix(a, b, s); }
  if (s < 2.0) { return mix(b, c, s - 1.0); }
  return mix(c, d, s - 2.0);
}
fn palette(t: f32) -> vec3f { return lightPalette(params.display.x, t); }
@vertex fn vertex(@builtin(vertex_index) vertexId: u32, @builtin(instance_index) id: u32) -> VertexOutput {
  let corner = vec2f(f32(vertexId & 1u), f32(vertexId >> 1u)) * 2.0 - 1.0;
  let p = particles[id];
  let smoke = params.simulation.x > 1.5;
  let persp = 1.0 / (1.0 - clamp(p.position.z, -1.0, 1.0) * 0.35);
  let head = p.position.xy * persp;
  let vel = p.velocity.xy * persp;
  let speed = length(vel);
  let dir = select(vec2f(1.0, 0.0), vel / max(speed, 0.0001), speed > 0.002);
  let perp = vec2f(-dir.y, dir.x);
  let layer = p.extra.z;
  let heat = clamp(p.state.y, 0.0, 1.5);
  let energy = clamp(params.sound.w, 0.0, 1.5);
  // A stable subset of the advected particles are tiny lamps. Loudness selects how many
  // light up; bass/onset energy controls their brightness. Silent demo pulses never light them.
  let bulb = smoke && rnd(id, 45u) < 0.12;
  let lit = select(0.0, (1.0 - smoothstep(min(energy, 1.0) * 0.8, min(energy, 1.0) * 0.8 + 0.08, rnd(id, 46u))) * min(1.0, energy * 8.0), bulb && params.simulation.y > 0.5);
  // Depth-aware circle of confusion: sharp focus plane, softly defocused near/far points.
  // Energy changes focus/bokeh gently; inverse-area compensation prevents a glowing fog.
  let focus = -0.08 + min(params.sound.x, 1.0) * 0.16;
  let coc = clamp((abs(p.position.z - focus) - 0.12) * 2.0, 0.0, 1.0);
  let defocus = 1.0 + coc * select(0.2, 0.5 + min(energy, 1.0) * 1.2, smoke);

  // Width is a fixed pixel count and the streak length is clamped, so fill cost per particle is bounded.
  let pixel = 2.0 / params.display.z;
  let widthPx = select(select(select(0.9, 1.05, layer > 0.5), 1.25, layer > 1.5), 1.1, smoke) * (1.0 + params.sound.z * 0.12 + heat * 0.15) * persp;
  let w = widthPx * pixel * defocus * (1.0 + lit * 0.35);
  let trail = min(speed * (0.016 + 0.009 * heat + 0.008 * energy), 0.06) * (1.0 - lit * 0.92);
  let halfLength = trail * 0.5 + w * 3.0;
  let center = head - dir * trail * 0.5;
  let world = center + dir * corner.x * halfLength + perp * corner.y * w * 3.0;

  // Hue follows screen x and strand; the far layer is dim, deeper particles dimmer, fast and hot ones brighter.
  let strand = p.extra.x;
  let jitter = select(p.extra.w, p.velocity.w, smoke);
  let hue = clamp(0.5 + p.position.x * 0.45 + (strand - 0.5) * 0.45 + (jitter - 0.5) * 0.2 + 0.1 * sin(params.clock.x * 0.12 + strand * 6.2831853) + params.sound.z * 0.05, 0.0, 1.0);
  let dim = select(select(1.0, 0.55, layer > 0.5), 0.2, layer > 1.5);
  let depth = clamp(0.75 + p.position.z * 0.9, 0.35, 1.25);
  var intensity = params.style.z * params.style.w * dim * depth * (0.7 + min(speed, 2.0) * 0.45) * (0.036 + 0.03 * energy + 0.07 * heat);
  if (!smoke) {
    // Visible individual cores even without a hand concentrating the particles.
    intensity = params.style.z * params.style.w * max(dim,.65) * max(depth,.65)
      * (0.85 + min(speed,2.0)*.3) * (select(.8,1.4,params.simulation.x>.5) + .08*energy + .14*heat);
  }
  var color = mix(palette(hue), vec3f(1.0, 0.92, 0.75), min(heat, 1.0) * 0.18);
  if (smoke) {
    let age = p.extra.y;
    let life = p.extra.w;
    intensity *= smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(life * 0.45, life, age)) * 2.8;
    // Emission colour travels with the smoke; broad gradients reveal the folds.
    if (params.display.x < 0.5) {
      let sourceHue = select(p.extra.x, 0.5 + cos(p.extra.x * TAU) * 0.5, params.simulation.x > 2.5);
      color = palette(sourceHue);
    }
    let lampColor = mix(vec3f(dot(color, vec3f(0.2126, 0.7152, 0.0722))), color, 0.5);
    color = mix(vec3f(0.48, 0.51, 0.56), lampColor * (5.0 + min(params.sound.x, 1.0) * 4.0), lit);
    // Keep fine wisps visible after reducing sprite width; only lit bulbs gain color.
    intensity *= select(1.7, 0.8, params.simulation.x > 3.5);
  }

  var output: VertexOutput;
  output.position = vec4f(world.x / params.clock.z, world.y, 0.0, 1.0);
  output.uv = vec2f(corner.x * halfLength / w, corner.y * 3.0);
  if (params.simulation.x > 2.5 && params.simulation.x < 3.5 && params.simulation.y > 0.5) {
    let bass = pow(clamp(params.sound.x,0.0,1.0),1.7);
    let high = pow(clamp(params.sound.z,0.0,1.0),1.35);
    let ribbon = pow(.5 + .5 * sin(strand * TAU * 6.0),3.0);
    let flash = bass * 2.5 + high * (0.4 + 3.0 * ribbon) + params.simulation.z * 2.0;
    color += palette(hue) * flash;
  }
  output.color = color * intensity / (defocus * defocus);
  output.lengthRatio = trail / w;
  return output;
}
@fragment fn fragment(input: VertexOutput) -> @location(0) vec4f {
  let halfLength = input.lengthRatio * 0.5;
  let beyond = max(abs(input.uv.x) - halfLength, 0.0);
  let r2 = beyond * beyond + input.uv.y * input.uv.y;
  let along = smoothstep(-halfLength - 1.0, halfLength + 0.5, input.uv.x);
  let taper = mix(0.12, 1.0, along * along);
  let profile = exp(-r2 * 2.5) + 0.025 * exp(-r2 * 0.85);
  return vec4f(input.color * profile * taper, 0.0);
}

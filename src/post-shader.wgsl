@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex0: texture_2d<f32>;
@group(0) @binding(2) var tex1: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: Parameters;
@group(0) @binding(4) var<uniform> blurDir: vec4f; // direction in texels
@group(0) @binding(5) var<uniform> volumeMix: vec4f; // particle gain behind smoke, transmittance exponent

struct FullscreenOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn fullscreenVertex(@builtin(vertex_index) vertexId: u32) -> FullscreenOutput {
  let xy = vec2f(f32((vertexId << 1u) & 2u), f32(vertexId & 2u));
  var output: FullscreenOutput;
  output.position = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  output.uv = vec2f(xy.x, 1.0 - xy.y);
  return output;
}
fn luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
// Apply the toe to accumulated smoke, not each particle: dense fine filaments survive
// automatic particle-count changes. Max RGB preserves saturated blue and red edges.
fn smokeContrast(c: vec3f) -> vec3f {
  if (params.simulation.x < 3.5 || params.simulation.x > 5.5) { return c; }
  let peak = max(c.r, max(c.g, c.b));
  return c * smoothstep(0.012, 0.085, peak) * 1.18;
}

// Trail persistence: the previous frame fades with a slight diffusion so streaks leave soft wakes.
@fragment fn fadeFragment(input: FullscreenOutput) -> @location(0) vec4f {
  return textureSampleLevel(tex0, samp, input.uv, 0.0) * params.extra.y;
}

// Quarter-resolution bright pass: four bilinear taps cover the 4x4 source block exactly.
fn bright(c: vec3f) -> vec3f { let clean = smokeContrast(c); return clean * smoothstep(0.12, 0.8, luminance(clean)); }
@fragment fn downFragment(input: FullscreenOutput) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(tex0));
  var sum = bright(textureSampleLevel(tex0, samp, input.uv + texel * vec2f(-1.0, -1.0), 0.0).rgb);
  sum += bright(textureSampleLevel(tex0, samp, input.uv + texel * vec2f(1.0, -1.0), 0.0).rgb);
  sum += bright(textureSampleLevel(tex0, samp, input.uv + texel * vec2f(-1.0, 1.0), 0.0).rgb);
  sum += bright(textureSampleLevel(tex0, samp, input.uv + texel * vec2f(1.0, 1.0), 0.0).rgb);
  return vec4f(sum * 0.25, 1.0);
}

// Separable 9-tap gaussian expressed as 5 bilinear taps.
@fragment fn blurFragment(input: FullscreenOutput) -> @location(0) vec4f {
  let stride = blurDir.xy / vec2f(textureDimensions(tex0));
  var c = textureSampleLevel(tex0, samp, input.uv, 0.0).rgb * 0.2270270270;
  c += (textureSampleLevel(tex0, samp, input.uv + stride * 1.3846153846, 0.0).rgb + textureSampleLevel(tex0, samp, input.uv - stride * 1.3846153846, 0.0).rgb) * 0.3162162162;
  c += (textureSampleLevel(tex0, samp, input.uv + stride * 3.2307692308, 0.0).rgb + textureSampleLevel(tex0, samp, input.uv - stride * 3.2307692308, 0.0).rgb) * 0.0702702703;
  return vec4f(c, 1.0);
}

// Spectral smoke: bilinear upscale of the half-resolution raymarch (premultiplied colour, opacity).
// Particles sit inside the medium rather than behind it, so they see a partial transmittance.
@fragment fn volumeFragment(input: FullscreenOutput) -> @location(0) vec4f {
  let scene = textureSampleLevel(tex0, samp, input.uv, 0.0).rgb;
  let smoke = textureSampleLevel(tex1, samp, input.uv, 0.0);
  let through = pow(clamp(1.0 - smoke.a, 0.0, 1.0), volumeMix.y);
  return vec4f(scene * volumeMix.x * through + smoke.rgb * volumeMix.z, 1.0);
}

@fragment fn compositeFragment(input: FullscreenOutput) -> @location(0) vec4f {
  let scene = smokeContrast(textureSampleLevel(tex0, samp, input.uv, 0.0).rgb);
  let glow = textureSampleLevel(tex1, samp, input.uv, 0.0).rgb;
  let energy = clamp(params.sound.w, 0.0, 1.0);
  let high = clamp(params.sound.z, 0.0, 1.0);
  // Sparse anamorphic glare from the quarter-resolution bright-pass texture.
  // The direct scene stays sharp; only bright highlights contribute to these streaks.
  let spread = 0.006 + energy * 0.01;
  var glare = textureSampleLevel(tex1, samp, input.uv + vec2f(spread, 0.0), 0.0).rgb;
  glare += textureSampleLevel(tex1, samp, input.uv - vec2f(spread, 0.0), 0.0).rgb;
  glare += (textureSampleLevel(tex1, samp, input.uv + vec2f(spread * 2.7, 0.0), 0.0).rgb + textureSampleLevel(tex1, samp, input.uv - vec2f(spread * 2.7, 0.0), 0.0).rgb) * 0.35;
  // Additive particle overlap already raises HDR luminance. Bloom grows locally with that
  // density, rather than putting a uniform haze over sparse, individual particles.
  let overlap = smoothstep(0.16, 1.2, luminance(scene));
  var color = scene * params.extra.z + glow * (params.extra.w * (0.65 + energy * 0.6) + overlap * 0.2) + glare * (0.008 + high * 0.028 + energy * 0.018);
  if (params.simulation.x > 4.5 && params.simulation.x < 5.5 && params.simulation.y > 0.5) {
    let bass = pow(clamp(params.sound.x, 0.0, 1.0), 1.7);
    let flare = bass * 0.18 + high * 0.22 + params.simulation.z * 0.15;
    color += glow * flare + glare * flare * 0.12;
  }
  // Filmic roll-off; the brightest cores drift toward white instead of clipping flat.
  color = mix(color, vec3f(luminance(color)), smoothstep(3.0, 10.0, luminance(color)) * 0.15);
  color = vec3f(1.0) - exp(-color * 1.25);
  let centered = input.uv - vec2f(0.5);
  let vignette = 1.0 - dot(centered, centered) * 0.7;
  let dither = (fract(52.9829189 * fract(dot(input.position.xy, vec2f(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  let smokeMode = params.simulation.x > 3.5 && params.simulation.x < 5.5;
  let background = select(vec3f(0.004, 0.006, 0.016), vec3f(0.0), smokeMode);
  return vec4f(max(color * vignette + background * vignette + dither, vec3f(0.0)), 1.0);
}

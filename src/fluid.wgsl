// Original WebGPU implementation of a 2D staggered-grid smoke solver.
// Method reference: SebLague/Smoke-Simulation (Unity); no source/assets copied.
// RG velocity stores the left/bottom face speeds of each cell; smoke RGB is
// advected dye concentration, A is excess temperature. All distances are world units.
@group(0) @binding(0) var<uniform> params: Parameters;
@group(0) @binding(1) var field: texture_2d<f32>;
@group(0) @binding(2) var velocity: texture_2d<f32>;
@group(0) @binding(3) var auxiliary: texture_2d<f32>;
@group(0) @binding(4) var original: texture_2d<f32>;
@group(0) @binding(5) var linearSampler: sampler;
@group(0) @binding(6) var result: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var scalarResult: texture_storage_2d<r32float, write>;

fn worldSize() -> vec2f { return vec2f(params.clock.z * 2.0, 2.0); }
fn uvOf(q: vec2f) -> vec2f { return q / worldSize() + .5; }
fn worldAt(uv: vec2f) -> vec2f { return (uv - .5) * worldSize(); }
fn bounded(c: vec2i, size: vec2u) -> vec2i { return clamp(c, vec2i(0), vec2i(size)-1); }
fn value(c: vec2i) -> vec4f { return textureLoad(field, bounded(c, textureDimensions(field)), 0); }
fn velAt(q: vec2f) -> vec2f {
  let uv = uvOf(q);
  let halfCell = .5 / vec2f(textureDimensions(velocity));
  return vec2f(textureSampleLevel(velocity, linearSampler, uv+vec2f(halfCell.x,0),0).x,
    textureSampleLevel(velocity, linearSampler, uv+vec2f(0,halfCell.y),0).y);
}
fn rewind(q: vec2f, dt: f32) -> vec2f {
  return q - velAt(q - velAt(q) * dt * .5) * dt;
}
fn source(q: vec2f) -> vec4f {
  var s = vec4f(0.0);
  let width = min(params.clock.z*.7, .95);
  for (var i=0u; i<7u; i++) {
    let u = f32(i)/6.0;
    let centre = vec2f((u-.5)*width*2.0 + .018*sin(params.clock.x*1.3+f32(i)), -.8);
    let d = (q-centre)/vec2f(.045,.035);
    let shape = exp(-dot(d,d)*.5);
    let level = emissionLevel(i,params.emissionLow,params.emissionHigh);
    let strength = select(.7, smoothstep(.06,.85,level), params.simulation.y>.5);
    let colour = select(vec3f(.65,.69,.75), lightPalette(params.display.x,u), params.simulation.y>.5);
    s += vec4f(colour*strength*shape*3.5, strength*shape*5.5);
  }
  return s;
}

@compute @workgroup_size(8,8) fn advectVelocity(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(result); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size);
  let q=worldAt((vec2f(id.xy)+.5)/vec2f(size));
  let qx=q-vec2f(h.x*.5,0); let qy=q-vec2f(0,h.y*.5);
  var v=vec2f(velAt(rewind(qx,params.clock.y)).x,velAt(rewind(qy,params.clock.y)).y);
  let smoke=textureSampleLevel(field,linearSampler,uvOf(q),0);
  let concentration=dot(smoke.rgb,vec3f(1.0/3.0));
  v.y += (smoke.a*1.6-concentration*.09)*params.clock.y;
  let src=source(q);
  v += vec2f(.16*sin(params.clock.x*1.9+q.x*19.0),.35)*src.a*params.clock.y;
  for(var j=0u;j<min(u32(params.display.w),32u);j++) {
    let hand=params.forces[j]; let delta=hand.xy-q;
    let radius=max(hand.w,.05); let d=length(delta);
    let n=delta/max(d,.001); let w=exp(-dot(delta,delta)/(radius*radius));
    // Circulation and hand motion survive incompressibility projection; a purely
    // radial force is a pressure gradient and would be removed by the solver.
    let sign=select(-1.0,1.0,hand.z>0.0);
    let desired=(n*.7+vec2f(-n.y,n.x)*1.15)*sign+params.forceVel[j].xy*.8;
    v += desired * w * min(abs(hand.z),24.0) * params.clock.y * .65;
  }
  for(var j=0u;j<min(u32(params.extra.x),8u);j++) {
    let b=params.bursts[j]; let delta=q-b.xy; let r=length(delta);
    v += (delta+vec2f(-delta.y,delta.x)*.6)/max(r,.02)*exp(-r*r/.18)*b.w*1.8;
  }
  v *= exp(-params.clock.y*.12);
  v=clamp(v,vec2f(-3.0),vec2f(3.0));
  // Closed side/bottom walls, open top so the plume can leave the domain.
  if(id.x==0u || id.x==size.x-1u){v.x=0.0;}
  if(id.y==0u){v.y=0.0;}
  if(id.y==size.y-1u){v.y=max(v.y,0.0);}
  textureStore(result,c,vec4f(v,0,0));
}
@compute @workgroup_size(8,8) fn curl(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(scalarResult); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size);
  let w=(value(c+vec2i(1,0)).y-value(c-vec2i(1,0)).y)/(2*h.x)
       -(value(c+vec2i(0,1)).x-value(c-vec2i(0,1)).x)/(2*h.y);
  textureStore(scalarResult,c,vec4f(w,0,0,0));
}
@compute @workgroup_size(8,8) fn confine(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(result); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size);
  let g=vec2f(abs(value(c+vec2i(1,0)).x)-abs(value(c-vec2i(1,0)).x),
              abs(value(c+vec2i(0,1)).x)-abs(value(c-vec2i(0,1)).x));
  let n=g/max(length(g),.00001);
  let w=value(c).x;
  var v=textureLoad(velocity,c,0).xy+vec2f(n.y,-n.x)*w*min(h.x,h.y)*4.0*params.clock.y;
  v=clamp(v,vec2f(-3),vec2f(3));
  if(id.x==0u || id.x==size.x-1u){v.x=0;}
  if(id.y==0u){v.y=0;}
  textureStore(result,c,vec4f(v,0,0));
}
@compute @workgroup_size(8,8) fn divergence(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(scalarResult); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size);
  let v=value(c).xy;
  let d=(value(c+vec2i(1,0)).x-v.x)/h.x+(value(c+vec2i(0,1)).y-v.y)/h.y;
  textureStore(scalarResult,c,vec4f(d,0,0,0));
}
@compute @workgroup_size(8,8) fn pressure(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(scalarResult); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size); let a=1.0/(h*h);
  let neighbours=(value(c-vec2i(1,0)).x+value(c+vec2i(1,0)).x)*a.x
    +(value(c-vec2i(0,1)).x+value(c+vec2i(0,1)).x)*a.y;
  var p=(neighbours-textureLoad(auxiliary,c,0).x)/(2.0*(a.x+a.y));
  if(id.y==size.y-1u){p=0.0;}
  textureStore(scalarResult,c,vec4f(p,0,0,0));
}
@compute @workgroup_size(8,8) fn project(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(result); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size); let p=value(c).x;
  var v=textureLoad(velocity,c,0).xy-vec2f(p-value(c-vec2i(1,0)).x,p-value(c-vec2i(0,1)).x)/h;
  if(id.x==0u || id.x==size.x-1u){v.x=0.0;}
  if(id.y==0u){v.y=0.0;}
  textureStore(result,c,vec4f(clamp(v,vec2f(-3),vec2f(3)),0,0));
}
fn dye(q: vec2f) -> vec4f {
  let uv=uvOf(q);
  if(any(uv<vec2f(0))||any(uv>vec2f(1))){return vec4f(0);}
  return textureSampleLevel(field,linearSampler,uv,0);
}
@compute @workgroup_size(8,8) fn dyeForward(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(result); if(any(id.xy>=size)){return;}
  let q=worldAt((vec2f(id.xy)+.5)/vec2f(size));
  textureStore(result,vec2i(id.xy),dye(rewind(q,params.clock.y)));
}
@compute @workgroup_size(8,8) fn dyeBackward(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(result); if(any(id.xy>=size)){return;}
  let q=worldAt((vec2f(id.xy)+.5)/vec2f(size));
  textureStore(result,vec2i(id.xy),dye(rewind(q,-params.clock.y)));
}
@compute @workgroup_size(8,8) fn dyeCorrect(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(result); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let q=worldAt((vec2f(id.xy)+.5)/vec2f(size));
  let pos=uvOf(rewind(q,params.clock.y))*vec2f(size)-.5; let cell=vec2i(floor(pos));
  let a=value(cell);let b=value(cell+vec2i(1,0));let d=value(cell+vec2i(0,1));let e=value(cell+vec2i(1,1));
  let lo=min(min(a,b),min(d,e));let hi=max(max(a,b),max(d,e));
  let corrected=textureLoad(auxiliary,c,0)+.5*(value(c)-textureLoad(original,c,0));
  // Limited MacCormack correction retains fine edges without negative density or ringing.
  var smoke=clamp(corrected,lo,hi)*exp(-params.clock.y*vec4f(.15,.15,.15,.5));
  smoke+=source(q)*params.clock.y;
  let uv=(vec2f(id.xy)+.5)/vec2f(size);
  smoke*=smoothstep(0.0,.025,uv.x)*smoothstep(0.0,.025,1.0-uv.x)*smoothstep(0.0,.025,1.0-uv.y);
  textureStore(result,c,clamp(smoke,vec4f(0),vec4f(8)));
}
struct FluidVertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn fluidVertex(@builtin(vertex_index) id: u32) -> FluidVertex {
  let p=vec2f(f32((id<<1u)&2u),f32(id&2u));
  var o:FluidVertex;o.position=vec4f(p*2.0-1.0,0,1);o.uv=p;return o;
}
@fragment fn fluidFragment(input: FluidVertex) -> @location(0) vec4f {
  let s=textureSampleLevel(field,linearSampler,input.uv,0);
  let concentration=max(s.r,max(s.g,s.b));
  let h=1.0/vec2f(textureDimensions(field));
  let near=textureSampleLevel(field,linearSampler,input.uv+vec2f(-h.x,h.y)*2.0,0).rgb;
  let edge=clamp((concentration-max(near.r,max(near.g,near.b)))*.8,-.25,.45);
  let alpha=(1.0-exp(-concentration*2.4))*smoothstep(.012,.09,concentration);
  let hue=s.rgb/max(concentration,.0001);
  let musicLight=select(0.0,1.0,params.simulation.y>.5);
  let lighting=.6+edge+musicLight*(params.sound.x*.65+params.simulation.z*.4);
  return vec4f(hue*alpha*lighting,1);
}

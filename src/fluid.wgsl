// Original WebGPU implementation of a 2D staggered-grid smoke solver.
// Method reference: SebLague/Smoke-Simulation (Unity); no source/assets copied.
// RG velocity stores the left/bottom face speeds of each cell; smoke RGB is
// advected dye concentration, A is excess temperature. All distances are world units.
//
// Read alongside FluidSmoke in fluid.js, which assembles this module with
// common-shader.wgsl and assigns textures to the bindings below for each pass:
//   advectVelocity -> curl -> confine -> divergence -> pressure (32 iterations)
//   -> project -> dyeForward -> dyeBackward -> dyeCorrect -> advectLight.
// Fluid-ring mode also runs advectDetail before drawing fluid and tracer streaks.
//
// This is a MAC (marker-and-cell) arrangement: pressure/dye live at cell centres,
// while the x/y velocity components live on different cell faces. Measuring net
// flow through those faces lets projection remove unwanted compression.
// field, auxiliary and original are pass-dependent inputs, not fixed datasets.
// Read/write textures are kept separate; fluid.js swaps ("ping-pongs") them so
// each dispatch reads a completed snapshot rather than its neighbours' writes.
//
// Performance: velocity/pressure are at most 512x192; dye and light have four
// times the width and height. Each pressure iteration therefore visits 1/16 as
// many cells as it would at dye resolution. Fine dye edges
// and native-resolution tracers supply detail, but cannot add finer fluid motion.
// Each 8x8 compute group covers a tile of 64 cells. Dispatches round up, so every
// entry point checks image bounds; these kernels use texture reads, not a shared
// workgroup-memory tile. textureLoad reads exact cells for difference stencils;
// textureSampleLevel uses linear interpolation for transport between cells.
@group(0) @binding(0) var<uniform> params: Parameters;
@group(0) @binding(1) var field: texture_2d<f32>;
@group(0) @binding(2) var velocity: texture_2d<f32>;
@group(0) @binding(3) var auxiliary: texture_2d<f32>;
@group(0) @binding(4) var original: texture_2d<f32>;
@group(0) @binding(5) var linearSampler: sampler;
@group(0) @binding(6) var result: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var<storage,read_write> detailParticles:array<Particle>;
@group(0) @binding(7) var scalarResult: texture_storage_2d<r32float, write>;

fn worldSize() -> vec2f { return vec2f(params.clock.z * 2.0, 2.0); }
fn uvOf(q: vec2f) -> vec2f { return q / worldSize() + .5; }
fn worldAt(uv: vec2f) -> vec2f { return (uv - .5) * worldSize(); }
fn bounded(c: vec2i, size: vec2u) -> vec2i { return clamp(c, vec2i(0), vec2i(size)-1); }
fn value(c: vec2i) -> vec4f { return textureLoad(field, bounded(c, textureDimensions(field)), 0); }
fn velAt(q: vec2f) -> vec2f {
  // The texture packs staggered components into RG at one texel address. Each
  // component therefore needs its own half-cell offset when sampled at q.
  let uv = uvOf(q);
  let halfCell = .5 / vec2f(textureDimensions(velocity));
  return vec2f(textureSampleLevel(velocity, linearSampler, uv+vec2f(halfCell.x,0),0).x,
    textureSampleLevel(velocity, linearSampler, uv+vec2f(0,halfCell.y),0).y);
}
fn rewind(q: vec2f, dt: f32) -> vec2f {
  // Semi-Lagrangian transport asks "where did material at q come from?" and
  // samples there. This midpoint (RK2) backtrace samples velocity halfway along
  // the estimated trip, improving curved trajectories over a single Euler step.
  return q - velAt(q - velAt(q) * dt * .5) * dt;
}
fn ringMode() -> bool { return params.simulation.x>6.5; }
fn ringLevel(i:u32) -> f32 { return params.ringLevels[i/4u][i%4u]; }
fn ringAttack(i:u32) -> f32 { return params.ringAttacks[i/4u][i%4u]; }
fn sectorDirection(i:u32) -> vec2f {
  let angle=2.35619449-f32(i)*TAU/9.0;
  return vec2f(cos(angle),sin(angle));
}
fn ringRadius() -> f32 { return .21*min(params.clock.z,1.0); }
fn sectorShape(q:vec2f,i:u32) -> f32 {
  let n=sectorDirection(i);let tangent=vec2f(-n.y,n.x);
  let delta=q-n*ringRadius();
  let d=vec2f(dot(delta,n)/.023,dot(delta,tangent)/(.042*min(params.clock.z,1.0)));
  return exp(-dot(d,d)*.5);
}
fn sectorStrength(i:u32) -> f32 {
  return select(.32,smoothstep(.10,.82,ringLevel(i))*(.3+ringAttack(i)*1.7),params.simulation.y>.5);
}
// Response remains an unsaturated physical gain even when the analyser is loud.
// The two low-frequency jets receive more kick momentum, without lighting silent bands.
fn sectorLaunch(i:u32)->f32 {
  let bassWeight=select(1.0,1.85,i<2u);
  let response=select(1.0,clamp(params.simulation.w,.3,3.0),params.simulation.y>.5);
  return sectorStrength(i)*(0.55+response*.65)*(1.0+ringAttack(i)*bassWeight*2.2)*bassWeight;
}
fn source(q: vec2f) -> vec4f {
  // Analytic Gaussian nozzles produce RGB dye and heat without an emitter texture.
  // These are rates: callers multiply by dt when adding material or light.
  var s=vec4f(0);
  if(ringMode()){
    for(var i=0u;i<9u;i++){
      let sheet=(dot(q,sectorDirection(i))-ringRadius())/.009;
      let strength=sectorShape(q,i)*sectorStrength(i)*exp(-sheet*sheet*.5);
      // Full colour spectrum follows frequency. The palette control can still
      // select a narrower colour field, just as in the original smoke modes.
      let colour=lightPalette(params.display.x,f32(i)/8.0);
      s+=vec4f(colour*strength*26.0,strength*5.5)*params.tuning.w;
    }
    return s;
  }
  for(var i=0u;i<7u;i++){
    let u=f32(i)/6.0;
    let d=(q-vec2f(laneX(i),-.8))/vec2f(.045,.035);
    let shape=exp(-dot(d,d)*.5);
    let colour=select(vec3f(.65,.69,.75),lightPalette(params.display.x,u),params.simulation.y>.5);
    let strength=laneStrength(i);
    s+=vec4f(colour*strength*shape*3.5,strength*shape*5.5)*params.tuning.w;
  }
  return s;
}
// Rising-smoke lanes run bass (left) to treble (right). Ring attack bands 0-3
// match lanes 0-3 exactly; the higher ring bands fold into lanes 4-6.
fn laneX(i:u32) -> f32 {
  let width=min(params.clock.z*.7,.95);
  return (f32(i)/6.0-.5)*width*2.0+.018*sin(params.clock.x*1.3+f32(i));
}
fn laneAttack(i:u32) -> f32 {
  if(i<5u){return ringAttack(i);}
  if(i==5u){return max(ringAttack(5u),ringAttack(6u));}
  return max(ringAttack(7u),ringAttack(8u));
}
fn laneLevel(i:u32) -> f32 { return smoothstep(.06,.85,emissionLevel(i,params.emissionLow,params.emissionHigh)); }
fn laneBass(i:u32) -> f32 { return select(select(1.0,1.6,i==1u),2.4,i==0u); }
// Silence keeps the fixed gray baseline. With music, the held level sets the
// emission rate and note onsets multiply it, most strongly in the bass lanes.
fn laneStrength(i:u32) -> f32 {
  if(params.simulation.y<.5){return .7;}
  return laneLevel(i)*(1.0+laneAttack(i)*laneBass(i)*1.4);
}
// Upward nozzle acceleration over a short column above each lane. Held notes
// lift gently; attacks, weighted towards bass, fire the plume upwards.
fn laneJet(q:vec2f) -> vec2f {
  if(params.simulation.y<.5){return vec2f(0);}
  let response=clamp(params.simulation.w,.3,3.0);
  let column=smoothstep(-.9,-.82,q.y)*(1.0-smoothstep(-.65,-.4,q.y));
  var lift=0.0;
  for(var i=0u;i<7u;i++){
    let dx=(q.x-laneX(i))/.05;
    let launch=laneLevel(i)*(.55+response*.65)*(.4+laneAttack(i)*laneBass(i)*2.2)*laneBass(i);
    lift+=exp(-dx*dx*.5)*launch;
  }
  return vec2f(0,lift*column*5.0*params.tuning.w);
}
fn nozzleVelocity(q:vec2f) -> vec2f {
  var force=vec2f(0);
  for(var i=0u;i<9u;i++){
    let n=sectorDirection(i);let tangent=vec2f(-n.y,n.x);
    // Each finite-width jet sheds counter-rotating vortices at its edges.
    // Slight directional wobble breaks symmetry without random particle jitter.
    let wobble=sin(params.clock.x*5.0+f32(i)*2.4)*.28*params.tuning.y;
    force+=(n+tangent*wobble)*sectorShape(q,i)*sectorLaunch(i)*55.0;
  }
  return force;
}

// First carry each face velocity through the old flow, then add buoyancy, jets
// and input forces. Hot smoke rises and concentration adds a small downward load.
// The resulting velocity can compress/expand locally; projection fixes that later.
@compute @workgroup_size(8,8) fn advectVelocity(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(result); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size);
  let q=worldAt((vec2f(id.xy)+.5)/vec2f(size));
  let qx=q-vec2f(h.x*.5,0); let qy=q-vec2f(0,h.y*.5);
  var v=vec2f(velAt(rewind(qx,params.clock.y)).x,velAt(rewind(qy,params.clock.y)).y);
  let smoke=textureSampleLevel(field,linearSampler,uvOf(q),0);
  let concentration=dot(smoke.rgb,vec3f(1.0/3.0));
  v.y += (smoke.a*select(1.6,.13,ringMode())-concentration*.09)*params.clock.y;
  let src=source(q);
  if(ringMode()){v+=nozzleVelocity(q)*params.clock.y;}
  else {v += (vec2f(.16*sin(params.clock.x*1.9+q.x*19.0),.35)*src.a+laneJet(q))*params.clock.y;}
  for(var j=0u;j<min(u32(params.display.w),32u);j++) {
    let hand=params.forces[j]; let delta=hand.xy-q;
    let radius=max(hand.w,.05); let d=length(delta);
    let n=delta/max(d,.001); let w=exp(-dot(delta,delta)/(radius*radius));
    // Circulation and hand motion survive incompressibility projection; a purely
    // radial force is a pressure gradient and would be removed by the solver.
    let sign=select(-1.0,1.0,hand.z>0.0);
    let base=(n*.7+vec2f(-n.y,n.x)*1.15)*sign+params.forceVel[j].xy*.8;
    let desired=gestureFlow(base,delta,radius,params.forceVel[j].xy,params.forceVel[j].zw);
    v += desired * w * min(abs(hand.z),24.0) * params.clock.y * .65;
  }
  for(var j=0u;j<min(u32(params.extra.x),8u);j++) {
    let b=params.bursts[j]; let delta=q-b.xy; let r=length(delta);
    v += (delta+vec2f(-delta.y,delta.x)*.6)/max(r,.02)*exp(-r*r/.18)*b.w*1.8;
  }
  v *= exp(-params.clock.y*select(.12,.85,ringMode()));
  v=clamp(v,vec2f(-3.0),vec2f(3.0));
  // Closed side/bottom walls, open top so the plume can leave the domain.
  if(!ringMode() && (id.x==0u || id.x==size.x-1u)){v.x=0.0;}
  if(!ringMode() && id.y==0u){v.y=0.0;}
  if(id.y==size.y-1u){v.y=max(v.y,0.0);}
  textureStore(result,c,vec4f(v,0,0));
}
// In 2D, curl is a scalar: dv_y/dx - dv_x/dy measures local rotation and its sign.
// Central differences approximate these derivatives from neighbouring texels.
@compute @workgroup_size(8,8) fn curl(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(scalarResult); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size);
  let w=(value(c+vec2i(1,0)).y-value(c-vec2i(1,0)).y)/(2*h.x)
       -(value(c+vec2i(0,1)).x-value(c-vec2i(0,1)).x)/(2*h.y);
  textureStore(scalarResult,c,vec4f(w,0,0,0));
}
// Repeated interpolation damps small eddies. Vorticity confinement finds the
// direction of increasing |curl| and applies a perpendicular, signed force to
// reinforce them. Scaling by cell size limits the correction as the grid refines;
// this is a visual compensation for numerical diffusion, not extra resolution.
@compute @workgroup_size(8,8) fn confine(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(result); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size);
  let g=vec2f(abs(value(c+vec2i(1,0)).x)-abs(value(c-vec2i(1,0)).x),
              abs(value(c+vec2i(0,1)).x)-abs(value(c-vec2i(0,1)).x));
  let n=g/max(length(g),.00001);
  let w=value(c).x;
  var v=textureLoad(velocity,c,0).xy+vec2f(n.y,-n.x)*w*min(h.x,h.y)*select(1.8,2.5,ringMode())*params.tuning.y*params.clock.y;
  v=clamp(v,vec2f(-3),vec2f(3));
  if(!ringMode() && (id.x==0u || id.x==size.x-1u)){v.x=0;}
  if(!ringMode() && id.y==0u){v.y=0;}
  textureStore(result,c,vec4f(v,0,0));
}
// Outgoing minus incoming face velocity, divided by cell size, measures local
// expansion. The pressure solve seeks a gradient whose divergence cancels it.
@compute @workgroup_size(8,8) fn divergence(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(scalarResult); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size);
  let v=value(c).xy;
  let d=(value(c+vec2i(1,0)).x-v.x)/h.x+(value(c+vec2i(0,1)).y-v.y)/h.y;
  textureStore(scalarResult,c,vec4f(d,0,0,0));
}
// One Jacobi iteration of Laplacian(p) = divergence(v). field is the previous
// pressure estimate, auxiliary holds divergence, and scalarResult gets the next
// estimate. The 1/h^2 weights account for different x/y cell sizes on wide views.
// Here p is a velocity-correction potential with timestep/density factors absorbed.
// fluid.js runs 32 iterations and retains pressure between frames as a warm start:
// fixed work gives approximate incompressibility, not an exactly converged solve.
// Zero pressure on open edges lets smoke leave; clamped reads handle other edges.
@compute @workgroup_size(8,8) fn pressure(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(scalarResult); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size); let a=1.0/(h*h);
  let neighbours=(value(c-vec2i(1,0)).x+value(c+vec2i(1,0)).x)*a.x
    +(value(c-vec2i(0,1)).x+value(c+vec2i(0,1)).x)*a.y;
  var p=(neighbours-textureLoad(auxiliary,c,0).x)/(2.0*(a.x+a.y));
  if(id.y==size.y-1u || (ringMode() && (id.x==0u || id.x==size.x-1u || id.y==0u))){p=0.0;}
  textureStore(scalarResult,c,vec4f(p,0,0,0));
}
// Subtract the pressure gradient at each face to reduce divergence. Some artistic
// interactions are deliberately applied afterwards and can reintroduce divergence;
// this preserves the visible suction/push behaviour rather than strict fluid physics.
@compute @workgroup_size(8,8) fn project(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(result); if(any(id.xy>=size)){return;}
  let c=vec2i(id.xy); let h=worldSize()/vec2f(size); let p=value(c).x;
  var v=textureLoad(velocity,c,0).xy-vec2f(p-value(c-vec2i(1,0)).x,p-value(c-vec2i(0,1)).x)/h;
  if(!ringMode() && (id.x==0u || id.x==size.x-1u)){v.x=0.0;}
  if(!ringMode() && id.y==0u){v.y=0.0;}
  let q=worldAt((vec2f(id.xy)+.5)/vec2f(size));
  // Magical suction/push must survive the pressure solve, which otherwise
  // cancels radial forces. Apply bounded local drift just like the mouse obstacle.
  for(var j=0u;j<min(u32(params.display.w),32u);j++){
    let hand=params.forces[j];let delta=hand.xy-q;let d=length(delta);
    let radius=max(hand.w,.05);let n=delta/max(d,.001);
    let wand=params.forceVel[j].z;
    let push=select(0.0,1.0,hand.z<0.0)*(1.0-wand-params.forceVel[j].w);
    let influence=exp(-d*d/(radius*radius));
    let rate=(1.0-exp(-params.clock.y*min(abs(hand.z),24.0)*1.1))*influence;
    v=mix(v,n*clamp((d-.018)*10.0,-.25,2.4)+params.forceVel[j].xy*.85,rate*wand);
    v=mix(v,-n*2.0+params.forceVel[j].xy*.5,rate*push);
  }
  for(var j=0u;j<min(u32(params.extra.x),8u);j++){
    let b=params.bursts[j];let delta=q-b.xy;let r=length(delta);
    v+=delta/max(r,.02)*exp(-r*r/.18)*b.w*1.2;
  }
  v=mouseVelocity(q,v,params.mouse,params.clock.y);
  textureStore(result,c,vec4f(clamp(v,vec2f(-3),vec2f(3)),0,0));
}
fn dye(q: vec2f) -> vec4f {
  // Returning zero outside the domain prevents the clamp sampler from dragging
  // the last edge texel indefinitely into backtraces that leave the simulation.
  let uv=uvOf(q);
  if(any(uv<vec2f(0))||any(uv>vec2f(1))){return vec4f(0);}
  return textureSampleLevel(field,linearSampler,uv,0);
}
// MacCormack transport uses three passes to counter interpolation blur:
// forward moves old dye through dt; backward transports that result through -dt;
// correct adds half the difference between old dye and the round-trip result.
// The extra reads/passes preserve wisps better than simple forward advection.
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
  // Bindings here: field = old dye, auxiliary = forward dye, original = backward
  // dye (despite its name). The four old samples around the departure point set
  // a local min/max: clamping to that range stops correction from inventing bright
  // halos or negative concentrations at sharp edges. Heat then cools faster than dye.
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
  if(ringMode()){smoke*=smoothstep(ringRadius()*.62,ringRadius()*.87,length(q))*smoothstep(0.0,.025,uv.y);}
  textureStore(result,c,clamp(smoke,vec4f(0),vec4f(8)));
}
// Emissive colour is a separate transported quantity. It stays attached to the
// moving dye after the note ends; small diffusion spills light into nearby smoke.
// Light uses the same midpoint backtrace but skips MacCormack correction and adds
// four-neighbour diffusion: broad glow can be smooth while dye carries sharp edges.
@compute @workgroup_size(8,8) fn advectLight(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(result);if(any(id.xy>=size)){return;}
  let uv=(vec2f(id.xy)+.5)/vec2f(size);let q=worldAt(uv);
  let back=rewind(q,params.clock.y);let h=worldSize()/vec2f(size)*1.5;
  let centre=dye(back);
  let neighbour=(dye(back+vec2f(h.x,0))+dye(back-vec2f(h.x,0))+dye(back+vec2f(0,h.y))+dye(back-vec2f(0,h.y)))*.25;
  var light=mix(centre,neighbour,min(params.clock.y*5.0,.2))*exp(-params.clock.y*.55);
  if(params.simulation.y>.5){light+=source(q)*params.clock.y*2.6;}
  if(ringMode()){light*=smoothstep(ringRadius()*.62,ringRadius()*.87,length(q));}
  light*=smoothstep(0.0,.025,uv.x)*smoothstep(0.0,.025,1.0-uv.x)*smoothstep(0.0,.025,uv.y)*smoothstep(0.0,.025,1.0-uv.y);
  textureStore(result,vec2i(id.xy),clamp(light,vec4f(0),vec4f(16)));
}
// Native-resolution tracers follow the pressure-projected fluid field. They add
// fine grain and folded filaments without increasing the pressure grid cost.
// The 262144 cap must match fluid.js. Each tracer samples the existing flow with
// a midpoint step and never pushes back on it: this detail is cheap relative to
// enlarging a grid that would need all 32 pressure iterations at higher resolution.
@compute @workgroup_size(256) fn advectDetail(@builtin(global_invocation_id) id:vec3u){
  if(id.x>=min(u32(params.clock.w),262144u)){return;}
  var p=detailParticles[id.x];let dt=params.clock.y;let band=id.x%9u;
  let key=id.x^pcg(u32(params.clock.x*1000.0));
  let life=2.8+rnd(id.x,81u)*2.2;
  if(p.state.w<.5 || p.state.z!=7.0){p=Particle(vec4f(0),vec4f(0),vec4f(0,0,7,1),vec4f(f32(band)/8.0,-.001,0,life));}
  if(p.extra.y<0.0){
    let strength=sectorStrength(band);
    if(rnd(key,82u)>1.0-exp(-strength*params.tuning.w*dt*4.0)){detailParticles[id.x]=p;return;}
    let n=sectorDirection(band);let tangent=vec2f(-n.y,n.x);
    let across=(rnd(key,83u)+rnd(key,84u)-1.0)*.052;
    let q=n*(ringRadius()+(rnd(key,85u)-.5)*.009)+tangent*across;
    p.position=vec4f(q,(rnd(key,86u)-.5)*.035,select(0.0,clamp(ringLevel(band)*.8+ringAttack(band)*.7,0.0,1.5),params.simulation.y>.5));
    p.extra.y=0.0;
  }
  let q=p.position.xy;let v=mouseVelocity(q,velAt(q+velAt(q)*dt*.5),params.mouse,dt);
  p.position=vec4f(q+v*dt,p.position.z,p.position.w);
  p.velocity=vec4f(v,0,0);p.extra.y+=dt;
  if(p.extra.y>life || any(abs(p.position.xy)>worldSize()*.51) || length(p.position.xy)<ringRadius()*.65){p.extra.y=-.001;}
  detailParticles[id.x]=p;
}
struct FluidVertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
// A generated oversized triangle covers the viewport without a vertex buffer.
// Unlike post-shader.wgsl, UV y is not flipped: this solver maps increasing texture
// y to increasing world y. Keep that convention consistent with worldAt/uvOf.
@vertex fn fluidVertex(@builtin(vertex_index) id: u32) -> FluidVertex {
  let p=vec2f(f32((id<<1u)&2u),f32(id&2u));
  var o:FluidVertex;o.position=vec4f(p*2.0-1.0,0,1);o.uv=p;return o;
}
@fragment fn fluidFragment(input: FluidVertex) -> @location(0) vec4f {
  // A 2D shading approximation: 1-exp(-density*scale) turns concentration into
  // opacity, and one offset density sample suggests directional edge lighting.
  // This avoids a volume raymarch for the fluid modes. Output is opaque HDR RGB;
  // the local alpha variable shapes brightness rather than framebuffer blending.
  let s=textureSampleLevel(field,linearSampler,input.uv,0);
  let concentration=max(s.r,max(s.g,s.b));
  let h=1.0/vec2f(textureDimensions(field));
  let near=textureSampleLevel(field,linearSampler,input.uv+vec2f(-h.x,h.y)*2.0,0).rgb;
  let edge=clamp((concentration-max(near.r,max(near.g,near.b)))*.8,-.25,.45);
  let alpha=(1.0-exp(-concentration*2.4))*smoothstep(.012,.09,concentration);
  let hue=s.rgb/max(concentration,.0001);
  let emission=textureSampleLevel(auxiliary,linearSampler,input.uv,0).rgb;
  let peak=max(emission.r,max(emission.g,emission.b));
  // Keep the fine MacCormack density edges in the light: the transported lamp
  // field controls energy, while the sharper dye supplies the visible structure.
  let glow=s.rgb*min(peak/max(concentration,.001),4.0)*smoothstep(.018,.16,peak);
  let core=pow(clamp(peak*.45,0.0,1.0),2.0);
  let base=hue*alpha*(.38+edge);
  let colour=base+glow*(.8+alpha*.7)+vec3f(1.0,.96,.9)*core*.25;
  return vec4f(colour*select(1.0,.22,ringMode()),1);
}

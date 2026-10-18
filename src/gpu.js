import commonCode from './common-shader.wgsl?raw';
import computeCode from './particles.wgsl?raw';
import renderCode from './render.wgsl?raw';
import postCode from './post-shader.wgsl?raw';
import volumeCode from './volume.wgsl?raw';
import referenceSimulation from './reference-simulation.wgsl?raw';
import referenceRenderCode from './reference-render.wgsl?raw';
import {FluidSmoke} from './fluid.js';
import {remixSources} from './remix/shader.js';
const MAX_PARTICLES=3145728,PARTICLE_BYTES=64,MAX_FORCES=32,MAX_BURSTS=8,MAX_QUEUE=64;
// Spectral smoke volume: grid mirrors VX/VY/VZ in volume.wgsl. At most VOLUME_SPLATS particles are splatted per
// frame (every stride-th one, weighted up), which bounds both the atomic cost and the fixed point range.
const VOLUME_GRID=[96,64,48],VOLUME_SPLATS=262144,VOLUME_DEPTH=.8,CAMERA_DISTANCE=1/.35,SPECTRAL_MODE=4;
const UNIFORM_FLOATS=356; // layout mirrors Parameters in common-shader.wgsl
const SCENE_FORMAT='rgba16float';
const PREFIX=commonCode+'\n',PREFIX_LINES=PREFIX.split('\n').length-1;
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
export class ParticleEngine {
  constructor(canvas) {
    this.canvas=canvas; this.capacity=MAX_PARTICLES; this.count=131072; this.palette=0; this.burst=[0,0,0,1]; this.time=0; this.data=new Float32Array(UNIFORM_FLOATS);
    this.effect=0; // 0 orbital, 1 ribbons, 2 wave, 3 angular paths
    this.persistent=false; this.flowMode=0; this.lastMode=0; this.musicActive=false;
    this.fill=0; // 0 centred between intro and panel, 1 fills the scene (exhibition mode)
    this.exposure=.8; this.bloom=.06; this.trail=.035; this.renderScale=1; this.resolution='native';
    this.pending=[]; this.serial=0; this.served=0; this.tracked=[]; this.clock=0; this.lastCount=0; this.signature='';
    // Spectral smoke look; tuned by eye, not measured against a reference.
    this.smokeDensity=1; this.smokeLight=1; this.smokeDetail=.45; this.smokeStreaks=1.0;
    this.volumeData=new Float32Array(12); this.noiseReady=false;
  }
  async init() {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable. Use an up-to-date browser with hardware acceleration on localhost or HTTPS.');
    const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if (!adapter) throw new Error('No WebGPU adapter found. Check hardware acceleration and GPU support.');
    this.adapterName=adapter.info?.description||adapter.info?.vendor||'';
    const wantedBytes=MAX_PARTICLES*PARTICLE_BYTES;
    const supportedBytes=Math.min(adapter.limits?.maxStorageBufferBindingSize??wantedBytes,adapter.limits?.maxBufferSize??wantedBytes);
    this.capacity=Math.min(MAX_PARTICLES,Math.floor(supportedBytes/PARTICLE_BYTES/16384)*16384);
    const bytes=this.capacity*PARTICLE_BYTES;
    this.device=await adapter.requestDevice({requiredLimits:{maxStorageBufferBindingSize:bytes,maxBufferSize:bytes}});
    this.device.lost.then(info=>{if(info.reason!=='destroyed')this.report(`GPU connection lost: ${info.message}. Reload the page.`);});
    this.device.addEventListener('uncapturederror',event=>this.report(event.error.message));
    this.context=this.canvas.getContext('webgpu');
    if (!this.context) throw new Error('The browser could not create a WebGPU context.');
    const format=navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({device:this.device,format,alphaMode:'opaque'});
    // Validation errors raised while creating resources and bind groups surface here instead of on the first frame.
    this.device.pushErrorScope('validation');
    let failure;
    try { await this.build(format); } finally { failure=await this.device.popErrorScope(); }
    if (failure) throw new Error(failure.message);
  }
  report(message) { if(this.reported===message)return; this.reported=message; this.onError?.(message); }
  async module(name,code) {
    const module=this.device.createShaderModule({label:name,code:PREFIX+code});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if (errors.length) throw new Error(`${name}: `+errors.map(e=>e.lineNum>PREFIX_LINES?`${e.lineNum-PREFIX_LINES}: ${e.message}`:`common-shader.wgsl ${e.lineNum}: ${e.message}`).join('\n'));
    return module;
  }
  async build(format) {
    const device=this.device;
    this.uniform=device.createBuffer({size:UNIFORM_FLOATS*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.buffer=device.createBuffer({size:this.capacity*PARTICLE_BYTES,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
    this.density=device.createBuffer({size:128*128*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    this.sampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
    this.blurDirs=[[1,0],[0,1],[2.4,0],[0,2.4]].map(dir=>{const buffer=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,new Float32Array([...dir,0,0]));return buffer;});
    const [compute,render,post,volume,referenceRender]=await Promise.all([this.module('particles.wgsl + reference-simulation.wgsl',computeCode+'\n'+referenceSimulation),this.module('render.wgsl',renderCode),this.module('post-shader.wgsl',postCode),this.module('volume.wgsl',volumeCode),this.module('reference-render.wgsl',referenceRenderCode)]);
    const additive={color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}};
    const screen=(entryPoint,target)=>({layout:'auto',vertex:{module:post,entryPoint:'fullscreenVertex'},fragment:{module:post,entryPoint,targets:[{format:target}]},primitive:{topology:'triangle-list'}});
    [this.compute,this.render,this.fadePipeline,this.downPipeline,this.blurPipeline,this.compositePipeline]=await Promise.all([
      device.createComputePipelineAsync({layout:'auto',compute:{module:compute,entryPoint:'simulate'}}),
      device.createRenderPipelineAsync({layout:'auto',vertex:{module:render,entryPoint:'vertex'},fragment:{module:render,entryPoint:'fragment',targets:[{format:SCENE_FORMAT,blend:additive}]},primitive:{topology:'triangle-strip'}}),
      device.createRenderPipelineAsync(screen('fadeFragment',SCENE_FORMAT)),
      device.createRenderPipelineAsync(screen('downFragment',SCENE_FORMAT)),
      device.createRenderPipelineAsync(screen('blurFragment',SCENE_FORMAT)),
      device.createRenderPipelineAsync(screen('compositeFragment',format)),
    ]);
    this.referenceRender=await device.createRenderPipelineAsync({layout:'auto',vertex:{module:referenceRender,entryPoint:'referenceVertex'},fragment:{module:referenceRender,entryPoint:'referenceFragment',targets:[{format:SCENE_FORMAT,blend:additive}]},primitive:{topology:'triangle-strip'}});
    const entries=[{binding:0,resource:{buffer:this.buffer}},{binding:1,resource:{buffer:this.uniform}}];
    this.computeGroup=device.createBindGroup({layout:this.compute.getBindGroupLayout(0),entries:[...entries,{binding:2,resource:{buffer:this.density}}]});
    this.bin=await device.createComputePipelineAsync({layout:'auto',compute:{module:compute,entryPoint:'binParticles'}});
    this.binGroup=device.createBindGroup({layout:this.bin.getBindGroupLayout(0),entries:[...entries,{binding:2,resource:{buffer:this.density}}]});
    this.renderGroup=device.createBindGroup({layout:this.render.getBindGroupLayout(0),entries});
    this.referenceRenderGroup=device.createBindGroup({layout:this.referenceRender.getBindGroupLayout(0),entries});
    await this.buildVolume(volume,post);
    this.fluid=new FluidSmoke(this);await this.fluid.init();
    this.resize(true);
  }
  // Compile both editable hooks before replacing either pipeline. The existing
  // bind groups are rebuilt only after success; failed edits leave the live scene intact.
  async compileRemix(source) {
    const code=remixSources(source,computeCode+'\n'+referenceSimulation,postCode),device=this.device;
    const lines=source.split('\n').length;
    device.pushErrorScope('validation');
    let nextCompute,nextComposite,failure;
    try {
      const compile=async(text)=>{
        const module=device.createShaderModule({code:PREFIX+text});
        const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
        if(errors.length)throw new Error(errors.map(e=>{const line=e.lineNum-PREFIX_LINES;return `${line>0&&line<=lines?'Line '+line:'Shader'}: ${e.message}`;}).join('\n'));
        return module;
      };
      const [compute,post]=await Promise.all([compile(code.compute),compile(code.post)]);
      [nextCompute,nextComposite]=await Promise.all([
        device.createComputePipelineAsync({layout:'auto',compute:{module:compute,entryPoint:'simulate'}}),
        device.createRenderPipelineAsync({layout:'auto',vertex:{module:post,entryPoint:'fullscreenVertex'},fragment:{module:post,entryPoint:'compositeFragment',targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:'triangle-list'}}),
      ]);
    } catch(error) { failure=error; }
    const validation=await device.popErrorScope();
    if(failure||validation)throw failure||new Error(validation.message);
    this.compute=nextCompute;this.compositePipeline=nextComposite;
    this.computeGroup=device.createBindGroup({layout:this.compute.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.buffer}},{binding:1,resource:{buffer:this.uniform}},{binding:2,resource:{buffer:this.density}}]});
    this.buildTargets();
  }
  // Grid-sized resources are independent of the canvas; the raymarch targets are made in buildVolumeTargets().
  async buildVolume(volume,post) {
    const device=this.device,[vx,vy,vz]=VOLUME_GRID;
    this.voxels=device.createBuffer({size:vx*vy*vz*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    this.volumeUniform=device.createBuffer({size:this.volumeData.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.volumeMix=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const grid=(size,format)=>device.createTexture({size,dimension:'3d',format,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});
    this.light=grid(VOLUME_GRID,'rgba16float'); this.noise=grid([32,32,32],'rgba8unorm');
    const lightView=this.light.createView(),noiseView=this.noise.createView();
    const clampSampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge',addressModeW:'clamp-to-edge'});
    const repeatSampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',addressModeW:'repeat'});
    [this.voxelize,this.lightColumns,this.buildNoise,this.rayPipeline,this.volumePipeline]=await Promise.all([
      device.createComputePipelineAsync({layout:'auto',compute:{module:volume,entryPoint:'voxelize'}}),
      device.createComputePipelineAsync({layout:'auto',compute:{module:volume,entryPoint:'lightColumns'}}),
      device.createComputePipelineAsync({layout:'auto',compute:{module:volume,entryPoint:'buildNoise'}}),
      device.createRenderPipelineAsync({layout:'auto',vertex:{module:volume,entryPoint:'rayVertex'},fragment:{module:volume,entryPoint:'rayFragment',targets:[{format:SCENE_FORMAT}]},primitive:{topology:'triangle-list'}}),
      device.createRenderPipelineAsync({layout:'auto',vertex:{module:post,entryPoint:'fullscreenVertex'},fragment:{module:post,entryPoint:'volumeFragment',targets:[{format:SCENE_FORMAT}]},primitive:{topology:'triangle-list'}}),
    ]);
    const group=(pipeline,list)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:list.map(([binding,resource])=>({binding,resource}))});
    const voxels=[2,{buffer:this.voxels}],settings=[3,{buffer:this.volumeUniform}];
    this.voxelGroup=group(this.voxelize,[[0,{buffer:this.buffer}],[1,{buffer:this.uniform}],voxels,settings]);
    this.lightGroup=group(this.lightColumns,[voxels,settings,[4,lightView]]);
    this.noiseGroup=group(this.buildNoise,[[7,noiseView]]);
    this.rayGroup=group(this.rayPipeline,[[1,{buffer:this.uniform}],settings,[5,lightView],[6,clampSampler],[8,noiseView],[9,repeatSampler]]);
  }
  // Hybrid smoke: native-resolution filaments carry every sharp edge. The low-frequency
  // volumetric lighting is evaluated on a smaller target, bounded independently of 4K output.
  buildVolumeTargets() {
    const device=this.device,[w,h]=this.sceneSize;
    const make=(width,height)=>device.createTexture({size:[width,height],format:SCENE_FORMAT,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const divisor=Math.max(2,Math.max(w,h)/640);
    const smoke=make(Math.max(2,Math.ceil(w/divisor)),Math.max(2,Math.ceil(h/divisor))),lit=make(w,h);
    this.volumeTextures=[smoke,lit]; this.textures.push(smoke,lit);
    this.smokeView=smoke.createView(); this.litView=lit.createView();
    const group=(pipeline,list)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:list.map(([binding,resource])=>({binding,resource}))});
    this.volumeGroups=this.sceneViews.map(view=>group(this.volumePipeline,[[0,this.sampler],[1,view],[2,this.smokeView],[5,{buffer:this.volumeMix}]]));
    this.litCompositeGroup=group(this.compositePipeline,[[0,this.sampler],[1,this.litView],[2,this.glowViews[0]],[3,{buffer:this.uniform}]]);
  }
  // Per-frame volume settings. The density scale makes optical depth independent of particle count and stride.
  writeVolume(count,stride) {
    const v=this.volumeData,density=Math.max(0,Number(this.smokeDensity)||0),light=Math.max(0,Number(this.smokeLight)||0);
    const steps=24;
    v.set([this.canvas.width/this.canvas.height*1.02,1.02,VOLUME_DEPTH,CAMERA_DISTANCE],0);
    v.set([.4*stride*131072/count*density,stride,steps,3],4);
    v.set([light,.9*light,this.time,clamp(Number(this.smokeDetail)||0,0,1)],8);
    this.device.queue.writeBuffer(this.volumeUniform,0,v);
    this.device.queue.writeBuffer(this.volumeMix,0,new Float32Array([clamp(Number(this.smokeStreaks)||0,0,2),.1,.08,0]));
  }
  // Scene and bloom targets follow the canvas size; bind groups reference them so they are rebuilt together.
  buildTargets() {
    const device=this.device;
    this.textures?.forEach(texture=>texture.destroy());
    const scale=this.resolution==='auto'?clamp(Number(this.renderScale)||1,.4,1):1;
    const w=Math.max(8,Math.round(this.canvas.width*scale)),h=Math.max(8,Math.round(this.canvas.height*scale)),bw=Math.max(2,w>>2),bh=Math.max(2,h>>2);
    const make=(width,height)=>device.createTexture({size:[width,height],format:SCENE_FORMAT,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    this.scene=[make(w,h),make(w,h)]; this.glow=[make(bw,bh),make(bw,bh)];
    this.textures=[...this.scene,...this.glow];
    this.sceneViews=this.scene.map(t=>t.createView()); this.glowViews=this.glow.map(t=>t.createView());
    this.sceneSize=[w,h]; this.appliedScale=this.renderScale; this.sceneIndex=0; this.dirty=true;
    const group=(pipeline,entries)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:entries.map(([binding,resource])=>({binding,resource}))});
    const sampler=[0,this.sampler],uniform=[3,{buffer:this.uniform}];
    this.fadeGroups=this.sceneViews.map(view=>group(this.fadePipeline,[sampler,[1,view],uniform]));
    this.downGroups=this.sceneViews.map(view=>group(this.downPipeline,[sampler,[1,view],uniform]));
    // Two gaussian iterations ping-pong between the bloom targets and end in glow[0].
    this.blurGroups=[0,1,0,1].map((from,i)=>group(this.blurPipeline,[sampler,[1,this.glowViews[from]],[4,{buffer:this.blurDirs[i]}]]));
    this.compositeGroups=this.sceneViews.map(view=>group(this.compositePipeline,[sampler,[1,view],[2,this.glowViews[0]],uniform]));
    this.volumeGroups=null; // spectral targets are rebuilt on demand at the new size
  }
  resize(force=false) {
    const nativeDpr=Math.max(1,Number(devicePixelRatio)||1);
    const dpr=this.resolution==='4k'?3840/Math.max(innerWidth,innerHeight):this.resolution==='auto'?Math.min(nativeDpr,1.5):nativeDpr;
    const w=Math.round(innerWidth*dpr),h=Math.round(innerHeight*dpr);
    const changed=this.canvas.width!==w||this.canvas.height!==h;
    if (changed) { this.canvas.width=w; this.canvas.height=h; }
    if (this.device&&(changed||force)) this.buildTargets();
  }
  // Every call is kept: same-frame hand explosions queue up and the GPU drains up to eight per frame.
  explode(x=0.1*(1-this.fill)*innerWidth/innerHeight,y=0,strength=1) {
    if (!Number.isFinite(x)||!Number.isFinite(y)) return;
    const power=clamp(Number(strength)||1,0,2);
    this.pending.push({x,y,strength:power,serial:++this.serial});
    if (this.pending.length>MAX_QUEUE) this.pending.shift();
    this.burst=[x,y,this.serial,power];
  }
  // Hand IDs keep motion independent when hands cross or detections reorder.
  // Synthetic forces without IDs retain nearest-position matching.
  trackForces(list,dt) {
    const previous=this.tracked,used=new Set(),next=[];
    for (const f of list) {
      let best=null,bestD=.35*.35;
      const id=Number.isFinite(f[6])?f[6]:null;
      for (const p of previous) { if(used.has(p))continue; const d=(f[0]-p.x)**2+(f[1]-p.y)**2; if(id!==null?p.id===id:d<bestD){bestD=d;best=p;if(id!==null)break;} }
      const entry=best||{vx:0,vy:0,moved:this.clock};
      if (best) {
        used.add(best);
        if (bestD>1e-8) { const span=Math.max(this.clock-entry.moved,1/120); entry.vx+=(clamp((f[0]-entry.x)/span,-4,4)-entry.vx)*.5; entry.vy+=(clamp((f[1]-entry.y)/span,-4,4)-entry.vy)*.5; entry.moved=this.clock; }
        else { const keep=Math.exp(-dt*2.5); entry.vx*=keep; entry.vy*=keep; }
      }
      // Filtered palm motion excludes the anchor shift when finger powers change.
      if(Number.isFinite(f[7])&&Number.isFinite(f[8])){entry.vx=clamp(f[7],-4,4);entry.vy=clamp(f[8],-4,4);}
      entry.x=f[0]; entry.y=f[1];entry.id=id;next.push(entry);
    }
    this.tracked=next; return next;
  }
  frame(dt,audio,forces,paused) {
    if (!this.compositeGroups) return;
    if (this.appliedScale!==this.renderScale) this.buildTargets();
    const device=this.device,d=this.data;
    const count=clamp(Math.floor(Number(this.count))||131072,1,this.capacity);
    const effect=clamp(Math.round(Number(this.effect))||0,0,3),fill=clamp(Number(this.fill)||0,0,1);
    const real=clamp(Number.isFinite(dt)?dt:1/60,0,.1);
    const tuning=this.modeSettings||{};
    const speed=clamp(Number(tuning.speed)||1,.25,2);
    const step=paused?0:Math.min(real*speed,.033);
    const list=[];
    for (const f of forces||[]) { if(list.length>=MAX_FORCES)break; if(f&&Number.isFinite(f[0])&&Number.isFinite(f[1])&&Number.isFinite(f[2])&&Number.isFinite(f[3]))list.push(f); }
    // Pause freezes the clock, the force trackers and the burst queue; queued bursts fire after resume.
    let drained=[];
    if (!paused) { this.time+=real*speed; this.clock+=real*speed; drained=this.pending.splice(0,MAX_BURSTS); }
    const velocities=paused?this.tracked:this.trackForces(list,real);
    const before=this.served;
    if (drained.length) this.served=drained[drained.length-1].serial;
    const mode=this.flowMode===1?2:this.flowMode===2?3:this.flowMode===3?SPECTRAL_MODE:this.flowMode===4?5:this.flowMode===5?6:this.flowMode===6?7:this.flowMode===7?8:this.persistent?1:0;
    const smoke=mode===SPECTRAL_MODE;
    if (smoke&&!this.volumeGroups) this.buildVolumeTargets();
    const modeChanged=mode!==this.lastMode;
    if(modeChanged){this.lastCount=0;this.lastMode=mode;this.dirty=true;}
    const needInit=count>this.lastCount;
    const signature=`${count}|${this.palette}`;
    const redraw=!paused||this.dirty||signature!==this.signature;
    const fresh=this.dirty||paused||signature!==this.signature;
    d.fill(0);
    d.set([this.time,step,this.canvas.width/this.canvas.height,count],0);
    if(mode===7)d[3]=Math.min(this.capacity,262144);
    d.set([0,1,2,3].map(i=>clamp(Number(audio?.[i])||0,0,1.5)),4);
    d.set([Number(this.palette)||0,this.sceneSize[0],this.sceneSize[1],list.length,...this.burst.slice(0,2),this.served,before],8);
    list.forEach((f,i)=>d.set([f[0],f[1],f[2],f[3]],16+i*4));
    list.forEach((f,i)=>{const w=clamp(Number(f[4])||0,0,1),v=clamp(Number(f[5])||0,0,1),sum=Math.max(1,w+v);d.set([w/sum,v/sum],186+i*4);});
    if (!paused) velocities.slice(0,list.length).forEach((v,i)=>d.set([v.vx,v.vy],184+i*4));
    // A brightness floor keeps dispersed particles legible at high counts. This
    // setting changes direct particle light, independently of the bloom control.
    const particleVisibility=mode<1.5?clamp(Number(tuning.visibility)||1,.25,4):1;
    const densityGain=mode<1.5?Math.max(.38,Math.pow(131072/count,.55)):Math.pow(131072/count,.55);
    d.set([effect,fill,densityGain*particleVisibility,clamp(real*60,.3,2.5)],144);
    d.set([drained.length,fresh?0:Math.exp(-real/Math.max(.02,Number(this.trail)||.14)),Math.max(0,Number(this.exposure)||0),Math.max(0,Number(this.bloom)||0)],148);
    d.set([mode,this.musicActive?1:0,clamp(Number(this.musicTransient)||0,0,1),clamp(Number(this.audioResponse)||1.2,.3,3)],312);
    const emission=this.emissionBands||[audio?.[0],audio?.[0],audio?.[1],audio?.[1],audio?.[1],audio?.[2],audio?.[2]];
    d.set(Array.from({length:7},(_,i)=>clamp(Number(emission[i])||0,0,1)),316);
    const ring=this.ringBands||[emission[0],emission[1],emission[2],emission[3],emission[4],emission[4],emission[5],emission[6],emission[6]];
    d.set(Array.from({length:9},(_,i)=>clamp(Number(ring[i])||0,0,1)),324);
    d.set(Array.from({length:9},(_,i)=>clamp(Number(this.ringAttacks?.[i])||0,0,1)),336);
    d.set(this.mouse||[0,0,.18,0],348);
    d.set([speed,...['turbulence','glow','emission'].map(key=>clamp(Number.isFinite(tuning[key])?tuning[key]:1,0,3))],352);
    drained.forEach((b,i)=>d.set([b.x,b.y,b.serial,b.strength],152+i*4));
    device.queue.writeBuffer(this.uniform,0,d);
    const stride=Math.ceil(count/VOLUME_SPLATS);
    if (smoke) this.writeVolume(count,stride);
    const encoder=device.createCommandEncoder();
    if (mode===2 || mode===7) {
      this.fluid.allocate(this.canvas.width/this.canvas.height,modeChanged);
      if (!paused && step>0) this.fluid.step(encoder);
      if (redraw) {
        this.fluid.draw(encoder,this.sceneViews[0]);this.sceneIndex=0;
        this.screenPass(encoder,this.downPipeline,this.downGroups[0],this.glowViews[0]);
        [1,0,1,0].forEach((to,i)=>this.screenPass(encoder,this.blurPipeline,this.blurGroups[i],this.glowViews[to]));
        this.dirty=false;this.signature=signature;
      }
      this.screenPass(encoder,this.compositePipeline,this.compositeGroups[0],this.context.getCurrentTexture().createView());
      device.queue.submit([encoder.finish()]);return;
    }
    if (smoke&&!this.noiseReady) {
      const noise=encoder.beginComputePass();noise.setPipeline(this.buildNoise);noise.setBindGroup(0,this.noiseGroup);noise.dispatchWorkgroups(32768/64);noise.end();
      this.noiseReady=true;
    }
    if (needInit) encoder.clearBuffer(this.buffer,this.lastCount*PARTICLE_BYTES,(count-this.lastCount)*PARTICLE_BYTES);
    this.lastCount=count;
    if (!paused||needInit) {
      encoder.clearBuffer(this.density);
      const bin=encoder.beginComputePass();bin.setPipeline(this.bin);bin.setBindGroup(0,this.binGroup);bin.dispatchWorkgroups(Math.ceil(count/256));bin.end();
      const sim=encoder.beginComputePass();sim.setPipeline(this.compute);sim.setBindGroup(0,this.computeGroup);sim.dispatchWorkgroups(Math.ceil(count/256));sim.end();
      // The volume follows the positions drawn this frame; paused frames reuse the last lit grid.
      if (smoke) {
        encoder.clearBuffer(this.voxels);
        const splat=encoder.beginComputePass();splat.setPipeline(this.voxelize);splat.setBindGroup(0,this.voxelGroup);splat.dispatchWorkgroups(Math.ceil(Math.ceil(count/stride)/256));splat.end();
        const light=encoder.beginComputePass();light.setPipeline(this.lightColumns);light.setBindGroup(0,this.lightGroup);light.dispatchWorkgroups(Math.ceil(VOLUME_GRID[0]*VOLUME_GRID[2]/64));light.end();
      }
    }
    if (redraw) {
      const previous=this.sceneIndex,current=1-previous;
      const pass=encoder.beginRenderPass({colorAttachments:[{view:this.sceneViews[current],clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
      pass.setPipeline(this.fadePipeline);pass.setBindGroup(0,this.fadeGroups[previous]);pass.draw(3);
      pass.setPipeline(mode>=4?this.referenceRender:this.render);pass.setBindGroup(0,mode>=4?this.referenceRenderGroup:this.renderGroup);pass.draw(4,count);pass.end();
      this.sceneIndex=current;this.dirty=false;this.signature=signature;
      this.screenPass(encoder,this.downPipeline,this.downGroups[current],this.glowViews[0]);
      [1,0,1,0].forEach((to,i)=>this.screenPass(encoder,this.blurPipeline,this.blurGroups[i],this.glowViews[to]));
      // Bloom stays particle-only so the lamps glow through the smoke; the smoke itself is not bloomed.
      if (smoke) {
        this.screenPass(encoder,this.rayPipeline,this.rayGroup,this.smokeView,{r:0,g:0,b:0,a:0});
        this.screenPass(encoder,this.volumePipeline,this.volumeGroups[current],this.litView);
      }
    }
    this.screenPass(encoder,this.compositePipeline,smoke?this.litCompositeGroup:this.compositeGroups[this.sceneIndex],this.context.getCurrentTexture().createView());
    device.queue.submit([encoder.finish()]);
  }
  screenPass(encoder,pipeline,group,view,clearValue={r:0,g:0,b:0,a:1}) {
    const pass=encoder.beginRenderPass({colorAttachments:[{view,clearValue,loadOp:'clear',storeOp:'store'}]});
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
  }
  dispose() { this.device?.destroy(); }
}

import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-gpu']});
const base=process.env.EKKO_TEST_URL||'http://127.0.0.1:5173';
try{
 const page=await browser.newPage({viewport:{width:320,height:320}});
 await page.route('**/emission-harness',route=>route.fulfill({contentType:'text/html',body:'<canvas></canvas>'}));await page.goto(base+'/emission-harness');
 const result=await page.evaluate(async()=>{
  const {ParticleEngine}=await import('/src/gpu.js');const e=new ParticleEngine(document.querySelector('canvas')),errors=[];e.onError=x=>errors.push(x);e.count=16384;await e.init();
  async function readBuffer(){const b=e.device.createBuffer({size:e.count*64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=e.device.createCommandEncoder();c.copyBufferToBuffer(e.buffer,0,b,0,b.size);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);const data=new Float32Array(b.getMappedRange().slice(0));b.unmap();b.destroy();return data;}
  const half=x=>{const s=x&32768?-1:1,a=x>>10&31,b=x&1023;return s*(a===0?b*2**-24:a===31?(b?NaN:Infinity):(1+b/1024)*2**(a-15));};
  async function texture(t,size){const stride=Math.ceil(size[0]*8/256)*256,b=e.device.createBuffer({size:stride*size[1],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=e.device.createCommandEncoder();c.copyTextureToBuffer({texture:t.texture},{buffer:b,bytesPerRow:stride},size);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);const raw=new Uint16Array(b.getMappedRange()),data=[];for(let y=0;y<size[1];y++)for(let x=0;x<size[0]*4;x++)data.push(half(raw[y*stride/2+x]));b.unmap();b.destroy();return data;}
  async function emit(mode,level,response,amount=1,active=true){
   e.flowMode=mode;e.musicActive=active;e.modeSettings={spectrumEmission:response,emission:amount};e.time=0;e.clock=0;e.emissionBands=Array(7).fill(level);e.ringBands=Array(9).fill(level);e.ringAttacks=Array(9).fill(0);
   e.frame(0,[level,level,level,level],[],false);
   if(mode===1||mode===6)e.fluid.allocate(1,true);else e.device.queue.writeBuffer(e.buffer,0,new Float32Array(e.count*16));
   for(let i=0;i<(mode===1||mode===6?1:12);i++)e.frame(1/60,[level,level,level,level],[],false);
   const data=mode===1||mode===6?await texture(e.fluid.dye[e.fluid.index],e.fluid.dyeSize):await readBuffer();
   if(!data.every(Number.isFinite))throw new Error('nonfinite mode '+mode);
   return mode===1||mode===6?data.reduce((s,v,i)=>s+(i%4<3?v:0),0):data.reduce((s,v,i)=>s+(i%16===13&&v>=0?1:0),0);
  }
  const emission=[];
  for(const mode of [1,6,2,3,4,7,5]){
   const quietBase=await emit(mode,.2,0),quiet=await emit(mode,.2,1),loudBase=await emit(mode,.8,0),loud=await emit(mode,.8,1),off=await emit(mode,.8,1,0),idleOff=await emit(mode,.8,1,0,false);
   emission.push({mode,quietBase,quiet,loudBase,loud,off,idleOff});
  }
  // Project a centred vertical jet. Mirrored velocities must remain mirrored;
  // this exposes missing right faces or asymmetric pressure boundary conditions.
  e.flowMode=1;e.musicActive=true;e.modeSettings={emission:0,turbulence:0};e.frame(0,[0,0,0,0],[],false);
  const symmetry=[];
  for(const openBoundaries of [false,true]){
   e.modeSettings.openBoundaries=openBoundaries;e.frame(0,[0,0,0,0],[],false);const f=e.fluid;f.allocate(1,true);
   const module=e.device.createShaderModule({code:`@group(0) @binding(0) var output:texture_storage_2d<rgba16float,write>;@compute @workgroup_size(8,8) fn seed(@builtin(global_invocation_id) id:vec3u){let size=textureDimensions(output);if(any(id.xy>=size)){return;}let q=(vec2f(id.xy)+vec2f(.5,0))/vec2f(size-vec2u(1))*2.0-1.0;let d=q-vec2f(0,-.4);textureStore(output,vec2i(id.xy),vec4f(0,exp(-dot(d,d)/.1),0,0));}`});
   const pipeline=await e.device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'seed'}}),g=e.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:f.vel[2].view}]});
   const c=e.device.createCommandEncoder(),p=c.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,g);p.dispatchWorkgroups(Math.ceil(f.velocitySize[0]/8),Math.ceil(f.velocitySize[1]/8));p.end();
   f.dispatch(c,'divergence',f.groups.div);for(let i=0;i<100;i++){f.dispatch(c,'pressure',f.groups.pressure[f.pressureIndex]);f.pressureIndex=1-f.pressureIndex;}
   f.dispatch(c,'project',f.groups.project[f.pressureIndex],f.velocitySize);e.device.queue.submit([c.finish()]);
   const vel=await texture(f.vel[0],f.velocitySize),[w,h]=f.size,stride=f.velocitySize[0];let error=0,scale=0,netX=0;
   for(let y=0;y<h;y++)for(let x=0;x<=w;x++){const a=vel[(y*stride+x)*4],b=vel[(y*stride+w-x)*4];error+=Math.abs(a+b);scale+=Math.abs(a)+Math.abs(b);netX+=a;}
   for(let y=0;y<=h;y++)for(let x=0;x<w;x++){const a=vel[(y*stride+x)*4+1],b=vel[(y*stride+w-1-x)*4+1];error+=Math.abs(a-b);scale+=Math.abs(a)+Math.abs(b);}
   symmetry.push({openBoundaries,relativeError:error/scale,netX:netX/(w*h)});
  }
  e.dispose();return {emission,symmetry,errors};
 });
 console.log(JSON.stringify(result,null,2));assert.deepEqual(result.errors,[]);
 for(const r of result.emission){assert(r.quiet<r.quietBase*.65,JSON.stringify(r));assert(r.loud>r.loudBase*1.2,JSON.stringify(r));assert.equal(r.off,0);assert.equal(r.idleOff,0);}
 for(const r of result.symmetry){assert(r.relativeError<.001,JSON.stringify(r));assert(Math.abs(r.netX)<.00001,JSON.stringify(r));}
}finally{await browser.close();}

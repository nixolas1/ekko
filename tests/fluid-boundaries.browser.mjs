import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-gpu']});
const base=process.env.EKKO_TEST_URL||'http://127.0.0.1:5173';
try{
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?mode=smoke&openBoundaries=1');
 await page.waitForFunction(()=>!document.querySelector('#showcase-start').disabled);
 await page.locator('.mode-settings summary').click();
 const toggle=page.locator('#mode-open-boundaries');
 assert(await toggle.isVisible());assert(await toggle.isChecked());
 await toggle.uncheck();
 await page.waitForFunction(()=>new URL(location.href).searchParams.get('openBoundaries')==='0');
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#showcase-start').disabled);
 assert.equal(await toggle.isChecked(),false);
 await page.locator('.mode-settings summary').click();await toggle.check();
 await page.locator('[data-mode="fluid-ring"]').click();assert(await toggle.isHidden());
 await page.locator('[data-mode="smoke"]').click();assert(await toggle.isChecked());
 await toggle.scrollIntoViewIfNeeded();await page.waitForTimeout(1200);
 await page.screenshot({path:'test-results/fluid-open-boundaries.png'});
 assert.deepEqual(errors,[]);
 // Isolate the solver from the app's animation loop; seed the same dye patch
 // and uniform outward velocity for each side, then compare open vs walled.
 await page.route('**/boundary-harness',route=>route.fulfill({contentType:'text/html',body:'<canvas style="width:256px;height:256px"></canvas>'}));
 await page.goto(base+'/boundary-harness');
 const result=await page.evaluate(async()=>{
  const {ParticleEngine}=await import('/src/gpu.js');
  const e=new ParticleEngine(document.querySelector('canvas')),errors=[];e.onError=x=>errors.push(x);
  await e.init();e.flowMode=1;e.musicActive=true;e.count=1;e.emissionBands=Array(7).fill(0);e.ringBands=Array(9).fill(0);e.ringAttacks=Array(9).fill(0);
  const half=x=>{const s=x&32768?-1:1,a=x>>10&31,b=x&1023;return s*(a===0?b*2**-24:a===31?(b?NaN:Infinity):(1+b/1024)*2**(a-15));};
  async function read(t,size){const stride=Math.ceil(size[0]*8/256)*256,b=e.device.createBuffer({size:stride*size[1],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=e.device.createCommandEncoder();c.copyTextureToBuffer({texture:t.texture},{buffer:b,bytesPerRow:stride},size);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);const raw=new Uint16Array(b.getMappedRange()),out=[];for(let y=0;y<size[1];y++)for(let x=0;x<size[0]*4;x++)out.push(half(raw[y*stride/2+x]));b.unmap();b.destroy();return out;}
  const reports=[];
  for(const [side,vx,vy] of [['left',-1,0],['right',1,0],['bottom',0,-1],['top',0,1]]){
   const runs=[];
   for(const openBoundaries of [false,true]){
    e.modeSettings={openBoundaries,emission:0,turbulence:0};e.frame(0,[0,0,0,0],[],false);const f=e.fluid;f.allocate(e.canvas.width/e.canvas.height,true);
    const module=e.device.createShaderModule({code:`@group(0) @binding(0) var output: texture_storage_2d<rgba16float,write>;
    @compute @workgroup_size(8,8) fn velocity(@builtin(global_invocation_id) id:vec3u){if(any(id.xy>=textureDimensions(output))){return;}textureStore(output,vec2i(id.xy),vec4f(${vx}.0,${vy}.0,0,0));}
    @compute @workgroup_size(8,8) fn dye(@builtin(global_invocation_id) id:vec3u){let size=textureDimensions(output);if(any(id.xy>=size)){return;}let q=(vec2f(id.xy)+.5)/vec2f(size)*2.0-1.0;let delta=q-vec2f(${vx*.65},${vy*.65});let d=exp(-dot(delta,delta)/.008);textureStore(output,vec2i(id.xy),vec4f(d,d,d,0));}`});
    for(const [entryPoint,t,size] of [['velocity',f.vel[0],f.velocitySize],['dye',f.dye[0],f.dyeSize]]){
     const pipeline=await e.device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}}),g=e.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:t.view}]}),c=e.device.createCommandEncoder(),p=c.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,g);p.dispatchWorkgroups(Math.ceil(size[0]/8),Math.ceil(size[1]/8));p.end();e.device.queue.submit([c.finish()]);
    }
    for(let i=0;i<45;i++){e.frame(1/60,[0,0,0,0],[],false);if(i%15===0)await e.device.queue.onSubmittedWorkDone();}
    const dye=await read(f.dye[f.index],f.dyeSize),vel=await read(f.vel[0],f.velocitySize);
    const x=vx<0?0:vx>0?f.velocitySize[0]-1:Math.floor(f.velocitySize[0]/2),y=vy<0?0:vy>0?f.velocitySize[1]-1:Math.floor(f.velocitySize[1]/2),i=(y*f.velocitySize[0]+x)*4;
    runs.push({openBoundaries,mass:dye.reduce((s,v,i)=>s+(i%4<3?v:0),0),outward:vel[i]*vx+vel[i+1]*vy,finite:[...dye,...vel].every(Number.isFinite)});
   }
   reports.push({side,closed:runs[0],open:runs[1]});
  }
  e.dispose();return {reports,errors};
 });
 console.log(JSON.stringify(result,null,2));
 assert.deepEqual(result.errors,[]);
 for(const {side,closed,open} of result.reports){
  assert(closed.finite&&open.finite,side+' finite');assert(open.outward>.2,side+' outward flow');
  if(side!=='top'){assert(Math.abs(closed.outward)<.001,side+' wall blocks flow');assert(open.mass<closed.mass*.25,side+' smoke escapes');}
 }
}finally{await browser.close();}

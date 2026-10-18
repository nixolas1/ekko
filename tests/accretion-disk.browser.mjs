import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-gpu']});
const base=process.env.EKKO_TEST_URL||'http://127.0.0.1:5173';
try {
  const page=await browser.newPage({viewport:{width:1200,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/accretion-harness',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>'}));
  await page.goto(base+'/accretion-harness');
  const result=await page.evaluate(async()=>{
    const {ParticleEngine}=await import('/src/gpu.js');
    const e=new ParticleEngine(document.querySelector('canvas'));
    e.count=32768;e.effect=4;e.fill=1;
    window.gpuErrors=[];e.onError=message=>window.gpuErrors.push(message);window.engine=e;await e.init();
    async function read(){
      const b=e.device.createBuffer({size:e.count*64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const c=e.device.createCommandEncoder();c.copyBufferToBuffer(e.buffer,0,b,0,b.size);e.device.queue.submit([c.finish()]);
      await b.mapAsync(GPUMapMode.READ);const a=new Float32Array(b.getMappedRange().slice(0));b.unmap();b.destroy();
      if(!a.every(Number.isFinite))throw Error('Non-finite particle data');return a;
    }
    e.frame(0,[0,0,0,0],[],false);const initial=await read();
    const reset=()=>{e.device.queue.writeBuffer(e.buffer,0,initial);e.time=0;e.dirty=true;e.mouse=[0,0,.18,0];e.pending=[];e.served=0;e.serial=0;e.burst=[0,0,0,0];};
    async function run({audio=[0,0,0,0],forces=[],mouse,burst=false,frames=90}={}){
      reset();if(mouse)e.mouse=mouse;if(burst)e.explode(.3,.05,1);
      for(let i=0;i<frames;i++)e.frame(1/60,audio,forces,false);
      return read();
    }
    const delta=(a,b)=>{let sum=0;for(let i=0;i<a.length;i+=16)sum+=Math.hypot(a[i]-b[i],a[i+1]-b[i+1],a[i+2]-b[i+2]);return sum/e.count;};
    const baseline=await run();
    const motion=delta(initial,baseline);
    const response={};
    for(const [name,settings] of Object.entries({
      music:{audio:[1,.7,.6,.8]},pull:{forces:[[.55,.05,18,.4]]},push:{forces:[[.55,.05,-18,.4]]},
      wand:{forces:[[.55,.05,18,.35,1,0]]},vortex:{forces:[[.55,.05,18,.4,0,1]]},
      upperArc:{forces:[[0,.48,18,.2]]},lowerArc:{forces:[[0,-.4,18,.2]]},
      pointing:{forces:[[0,.48,1,-.2]]},mouse:{mouse:[.55,.05,.25,1]},burst:{burst:true}
    }))response[name]=delta(baseline,await run(settings));
    const stable=await run({frames:600});
    let radius=0,height=0,maxRadius=0;
    for(let i=0;i<stable.length;i+=16){const r=Math.hypot(stable[i],stable[i+1],stable[i+2]);radius+=r;height+=Math.abs(stable[i+1]);maxRadius=Math.max(maxRadius,r);}
    e.frame(1/60,[0,0,0,0],[],true);const paused=(await read()).every((v,i)=>v===stable[i]);
    e.effect=0;e.frame(1/60,[0,0,0,0],[],false);
    e.effect=4;e.frame(0,[0,0,0,0],[],true);const switched=await read();
    const resetOnSwitch=switched.every((v,i)=>i%16!==10||v===10);
    e.count=131072;for(let i=0;i<120;i++)e.frame(1/60,[0,0,0,0],[],false);
    const grown=await read();const countGrows=grown.every((v,i)=>i%16!==11||v===1);
    await e.device.queue.onSubmittedWorkDone();
    return {motion,response,meanRadius:radius/32768,meanHeight:height/32768,maxRadius,paused,resetOnSwitch,countGrows};
  });
  assert(result.motion>.2,'particles must actually orbit');
  for(const [kind,amount] of Object.entries(result.response))assert(amount>.001,`${kind} must move physical particles: ${amount}`);
  assert(result.meanRadius>.3&&result.meanRadius<1.5);assert(result.maxRadius<3.5);assert(result.meanHeight<.02);
  assert(result.paused);assert(result.resetOnSwitch);assert(result.countGrows);
  await page.screenshot({path:'/tmp/ekko-particle-hole.png'});
  await page.evaluate(async()=>{const e=window.engine;for(let i=0;i<45;i++)e.frame(1/60,[.4,.2,.3,.3],[[0,.48,18,.2]],false);await e.device.queue.onSubmittedWorkDone();});
  await page.screenshot({path:'/tmp/ekko-particle-hole-grab.png'});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(async()=>{const e=window.engine;e.resize(true);e.frame(1/60,[0,0,0,0],[],false);await e.device.queue.onSubmittedWorkDone();});
  await page.screenshot({path:'/tmp/ekko-particle-hole-mobile.png'});
  assert.deepEqual(await page.evaluate(()=>window.gpuErrors),[]);
  await page.goto(base+'/?mode=sculpture&effect=4&palette=0&immersive=0&auto=0&count=32768');
  await page.waitForFunction(()=>document.querySelector('#gpu-status').textContent==='WebGPU active');
  assert.equal(await page.locator('#effect').inputValue(),'4');assert(await page.locator('#particles').isEnabled());
  await page.locator('#effect').selectOption('0');await page.locator('#effect').selectOption('4');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ekko:settings:v1')).effect===4&&new URL(location.href).searchParams.get('effect')==='4');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#gpu-status').textContent==='WebGPU active');
  assert.equal(await page.locator('#effect').inputValue(),'4');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({...result,errors},null,2));
} finally {await browser.close();}

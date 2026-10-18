import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-gpu']});
try{
 const page=await browser.newPage({viewport:{width:1000,height:700}});
 await page.route('**/hand-fire-harness',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#080a14}canvas{width:100vw;height:100vh}</style><canvas></canvas>'}));
 await page.goto((process.env.EKKO_TEST_URL||'http://127.0.0.1:5173')+'/hand-fire-harness');
 const result=await page.evaluate(async()=>{
  const {ParticleEngine}=await import('/src/gpu.js');const e=new ParticleEngine(document.querySelector('canvas')),errors=[];
  e.count=32768;e.palette=6;e.flowMode=8;e.musicActive=true;e.onError=x=>errors.push(x);await e.init();
  const source=(x,band,direction=[0,1],power=1)=>({x,y:-.5,band,direction,power});
  const tick=(n=1)=>{for(let i=0;i<n;i++)e.frame(1/60,[0,0,0,0],[],false);};
  async function read(){const b=e.device.createBuffer({size:e.count*64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=e.device.createCommandEncoder();c.copyBufferToBuffer(e.buffer,0,b,0,b.size);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);const a=new Float32Array(b.getMappedRange().slice(0));b.unmap();b.destroy();if(!a.every(Number.isFinite))throw Error('Nonfinite particles');return a;}
  const active=a=>Array.from({length:e.count},(_,i)=>i*16).filter(i=>a[i+13]>0);
  const clear=()=>{e.device.queue.writeBuffer(e.buffer,0,new Float32Array(e.count*16));e.time=0;};
  e.emitters=[];tick(10);const empty=active(await read()).length;
  async function trial(bands){clear();e.ringBands=bands;e.emitters=[source(-.5,0),source(.5,1)];tick(30);const a=await read(),ids=active(a);return [ids.filter(i=>a[i+12]===0).length,ids.filter(i=>a[i+12]===1).length];}
  const bass=await trial([1,0,0,0,0,0,0,0,0]),treble=await trial([0,0,0,0,0,0,0,0,1]);
  clear();e.ringBands=[.9,.9,0,0,.25,0,0,0,0];e.emitters=[source(-.5,0),source(.5,.5)];tick(30);
  const balancedData=await read(),balancedIds=active(balancedData);
  const midBalance=[0,.5].map(band=>balancedIds.filter(i=>balancedData[i+12]===band).length);
  clear();e.ringBands=[.9,.9,0,0,0,0,0,0,0];e.emitters=[source(-.5,0),source(.5,.5)];tick(30);
  const silentMidData=await read(),silentMid=active(silentMidData).filter(i=>silentMidData[i+12]===.5).length;
  const trebleBoost=[];
  for(const band of [0,1]){
   clear();e.ringBands=Array(9).fill(.4);e.emitters=[source(0,band)];tick(12);
   trebleBoost.push(active(await read()).length);
  }
  async function widths(hit,music=true){
   clear();e.musicActive=music;e.ringBands=[.2,.2,.6,.6,.6,.6,.6,.6,.6];
   e.ringAttacks=[hit,0,0,0,0,0,0,0,0];e.emitters=[source(-.6,0),source(0,.5),source(.6,1)];tick();
   const a=await read(),ids=active(a);
   return [0,.5,1].map((band,j)=>{
    const born=ids.filter(i=>a[i+12]===band);
    return Math.sqrt(born.reduce((sum,i)=>sum+(a[i]-(-.6+j*.6))**2+a[i+2]**2,0)/born.length);
   });
  }
  const narrow=await widths(0),wide=await widths(1),idleNarrow=await widths(0,false),idleWide=await widths(1,false);
  e.ringAttacks=Array(9).fill(0);e.musicActive=true;
  clear();e.ringBands=Array(9).fill(1);e.emitters=[source(-.6,0,[1,0])];tick(2);const before=await read(),born=active(before);
  e.emitters=[source(.6,1,[-1,0],4)];e.ringBands=Array(9).fill(0);tick();const after=await read();
  const retained=born.every(i=>Math.hypot(after[i]-before[i],after[i+1]-before[i+1])<.1&&after[i+12]===0&&after[i+3]===before[i+3]&&after[i+11]===before[i+11]&&after[i+14]===1);
  e.emitters=[];tick(5);const stopped=await read();const noNew=active(stopped).length===active(after).length;
  e.frame(1/60,[0,0,0,0],[],true);const frozen=await read();const paused=frozen.every((v,i)=>v===stopped[i]);
  clear();e.emitters=[source(0,0)];e.modeSettings={emission:0};tick(10);const off=active(await read()).length;
  clear();e.modeSettings={};e.emitters=Array.from({length:9},(_,i)=>source(-1+i*.25,i/8));e.ringBands=Array(9).fill(.6);tick(10);const nine=new Set(active(await read()).map(i=>e.count&&i% (9*16))).size;
  async function forceTrial(force,burst=false){
   clear();e.emitters=[source(-.5,0)];e.ringBands=Array(9).fill(.8);tick(30);e.emitters=[];
   if(burst)e.explode(-.65,-.5,1);
   for(let i=0;i<12;i++)e.frame(1/60,[0,0,0,0],force?[force]:[],false);
   return read();
  }
  const baseline=await forceTrial(null),forces=[];
  for(const force of [[-.3,-.4,18,.65,0,0,1,0,0],[-.3,-.4,-18,.65,0,0,1,0,0],[-.3,-.4,14,.22,1,0,1,0,0],[-.3,-.4,16,.4,0,1,1,0,0],null]){
   const data=await forceTrial(force,!force),ids=active(baseline);
   forces.push(ids.reduce((sum,i)=>sum+Math.hypot(data[i]-baseline[i],data[i+1]-baseline[i+1]),0)/ids.length);
  }
  const depthCounts=[];
  for(const power of [.25,1,4]){
   clear();e.musicActive=false;e.emitters=[source(0,0,[0,1],power)];tick(12);
   depthCounts.push(active(await read()).length);
  }
  e.musicActive=true;
  // A visual fixture uses the real GPU renderer with two synthetic active sources.
  clear();e.count=131072;e.emitters=[source(-.55,0,[.6,.8]),source(.55,1,[-.6,.8])];e.ringBands=Array(9).fill(.8);tick(480);
  await e.device.queue.onSubmittedWorkDone();window.handFireEngine=e;window.handFireErrors=errors;
  return {empty,bass,treble,midBalance,silentMid,trebleBoost,narrow,wide,idleNarrow,idleWide,retained,noNew,paused,off,nine,forces,depthCounts,errors};
 });
 await page.screenshot({path:'/tmp/ekko-hand-fire.png'});
 for(const [name,power] of [['far',.25],['near',4],['moving',2]]){
  await page.evaluate(async({name,power})=>{
   const e=window.handFireEngine;e.musicActive=false;e.time=0;
   e.device.queue.writeBuffer(e.buffer,0,new Float32Array(e.count*16));
   for(let frame=0;frame<180;frame++){
    const t=frame/60,swing=name==='moving'?Math.sin(t*2.2)*.6:0;
    e.emitters=[{x:-.65,y:-.55,band:0,power,direction:[Math.sin(.45+swing),Math.cos(.45+swing)]},
     {x:.65,y:-.55,band:1,power,direction:[Math.sin(-.45+swing),Math.cos(-.45+swing)]}];
    e.frame(1/60,[0,0,0,0],[],false);
   }
   await e.device.queue.onSubmittedWorkDone();
  },{name,power});
  await page.screenshot({path:`/tmp/ekko-hand-fire-${name}.png`});
 }
 if(process.env.EKKO_FIRE_STRESS){
  result.stress=await page.evaluate(async()=>{
   const e=window.handFireEngine;e.count=Math.min(2097152,e.capacity);
   const start=performance.now();
   for(let i=0;i<90;i++){e.frame(1/60,[0,0,0,0],[],false);if(i%10===9)await e.device.queue.onSubmittedWorkDone();}
   return {count:e.count,averageFrameMs:(performance.now()-start)/90};
  });
  await page.screenshot({path:'/tmp/ekko-hand-fire-stress.png'});
 }
 result.errors=await page.evaluate(()=>window.handFireErrors);
 console.log(JSON.stringify(result,null,2));
 assert(result.trebleBoost[1]>result.trebleBoost[0]*3);
 assert(result.midBalance[1]>result.midBalance[0]*.7&&result.midBalance[1]<result.midBalance[0]*1.4);
 assert(result.silentMid<result.midBalance[1]*.1,'bass alone must not activate the mid stream');
 result.wide.forEach((width,i)=>assert(width>result.narrow[i]*2.5,`source ${i} did not widen on bass`));
 assert.deepEqual(result.idleWide,result.idleNarrow,'inactive music must not widen streams');
 assert(result.depthCounts[1]>result.depthCounts[0]*2.5);assert(result.depthCounts[2]>result.depthCounts[1]*2.5);assert.equal(result.empty,0);assert(result.bass[0]>result.bass[1]*5);assert(result.treble[1]>result.treble[0]*5);assert(result.retained);assert(result.noNew);assert(result.paused);assert.equal(result.off,0);assert.equal(result.nine,9);assert(result.forces.every(delta=>delta>.001),JSON.stringify(result.forces));assert.deepEqual(result.errors,[]);
}finally{await browser.close();}

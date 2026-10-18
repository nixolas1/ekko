// Real-GPU readback for spectral smoke (flowMode 3, simulation mode 4): all nine bands emit, push and
// light round the full circle, bass at the upper left and higher bands clockwise.
import {ParticleEngine} from '../src/gpu.js';
const N=32768,STRIDE=16,DEG=180/Math.PI;
const expected=band=>(135-40*band)/DEG;
const wrap=a=>((a*DEG)%360+540)%360-180;
const error=(a,b)=>Math.abs(wrap(a-b));
const oneHot=(band,level=.9)=>Array.from({length:9},(_,i)=>i===band?level:0);
const out=document.querySelector('#result');
let engine,ready;

async function setup(){
 if(ready)return ready;
 ready=(async()=>{
  engine=new ParticleEngine(document.querySelector('canvas'));engine.errors=[];engine.onError=x=>engine.errors.push(String(x?.message||x));
  engine.count=N;engine.flowMode=3;engine.palette=3;await engine.init();
  engine.frame(0,[0,0,0,0],[],false);await engine.device.queue.onSubmittedWorkDone();
 })();
 return ready;
}
async function read(){
 const e=engine,size=N*STRIDE*4,b=e.device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=e.device.createCommandEncoder();
 c.copyBufferToBuffer(e.buffer,0,b,0,size);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);
 const a=new Float32Array(b.getMappedRange().slice(0));b.unmap();b.destroy();return a;
}
// Fresh particles from an all-zero buffer, then a fixed number of 60 Hz steps under the given ring levels.
async function emit(levels,frames,{active=true,attacks=new Array(9).fill(0),time=0}={}){
 const e=engine;e.device.queue.writeBuffer(e.buffer,0,new Float32Array(N*STRIDE));
 e.time=time;e.clock=time;e.tracked=[];e.musicActive=active;e.ringBands=levels;e.ringAttacks=attacks;e.emissionBands=null;
 for(let f=0;f<frames;f++){e.frame(1/60,[0,0,0,.5],[],false);if(f%15===14)await e.device.queue.onSubmittedWorkDone();}
 return read();
}
function emission(data){
 const bands=Array.from({length:9},()=>({alive:0,total:0,birth:[0,0],place:[0,0]})),bins=new Array(36).fill(0);
 let alive=0,below=0,nonFinite=0,place=[0,0];
 for(let i=0;i<N;i++){
  const o=i*STRIDE,b=bands[i%9];b.total++;
  for(let j=0;j<16;j++)if(!Number.isFinite(data[o+j]))nonFinite++;
  if(data[o+11]<.5||data[o+10]!==4||data[o+13]<0)continue;
  const x=data[o],y=data[o+1],r=Math.hypot(x,y),birth=data[o+12]*Math.PI*2;
  b.alive++;alive++;b.birth[0]+=Math.cos(birth);b.birth[1]+=Math.sin(birth);
  if(r>.05){b.place[0]+=x/r;b.place[1]+=y/r;place[0]+=x/r;place[1]+=y/r;bins[Math.floor((Math.atan2(y,x)/(Math.PI*2)+.5)*36)%36]++;below+=y<0;}
 }
 return {alive,below:below/Math.max(alive,1),bins,nonFinite,place:Math.atan2(place[1],place[0]),bands:bands.map((b,band)=>({band,fraction:b.alive/b.total,birthError:b.alive?error(Math.atan2(b.birth[1],b.birth[0]),expected(band)):180,placeError:b.alive?error(Math.atan2(b.place[1],b.place[0]),expected(band)):180}))};
}
// Live particles seeded on a circle, one step: the outward velocity gained from one band must point along its sector.
async function jets(){
 const e=engine,seed=new Float32Array(N*STRIDE);
 for(let i=0;i<N;i++){const o=i*STRIDE,a=(i%1024)/1024*Math.PI*2;seed[o]=Math.cos(a)*.45;seed[o+1]=Math.sin(a)*.45;seed[o+2]=(i%19-9)*.005;seed[o+10]=4;seed[o+11]=1;seed[o+12]=(i%1024)/1024;seed[o+13]=1;seed[o+15]=8;}
 const once=async levels=>{e.device.queue.writeBuffer(e.buffer,0,seed);e.time=0;e.clock=0;e.tracked=[];e.musicActive=true;e.ringBands=levels;e.ringAttacks=new Array(9).fill(0);e.frame(1/60,[0,0,0,.5],[],false);return read();};
 const base=await once(new Array(9).fill(0)),result=[];
 for(let band=0;band<9;band++){
  const lit=await once(oneHot(band,1));let sx=0,sy=0,opposite=0,along=0;
  for(let i=0;i<N;i++){const o=i*STRIDE,x=seed[o]/.45,y=seed[o+1]/.45,gain=(lit[o+4]-base[o+4])*x+(lit[o+5]-base[o+5])*y;
   if(gain>0){sx+=gain*x;sy+=gain*y;}
   const c=Math.cos(Math.atan2(y,x)-expected(band));if(c>.94)along+=gain;if(c<-.5)opposite+=Math.abs(gain);}
  result.push({band,directionError:error(Math.atan2(sy,sx),expected(band)),along:along/N,opposite:opposite/N});
 }
 return result;
}

window.spectralCircleInternals={setup,emit,emission,oneHot,get engine(){return engine;}};
// Render a settled ring for screenshot checks; the driver hides the panel while capturing.
window.renderRing=async(levels,frames=150,time=0)=>{await setup();await emit(levels,frames,{time});await engine.device.queue.onSubmittedWorkDone();return engine.errors;};

window.runSpectralCircle=async()=>{
 await setup();
 const all=emission(await emit(new Array(9).fill(.9),45));
 const single=[];
 for(let band=0;band<9;band++){const r=emission(await emit(oneHot(band),45)),own=r.bands[band].fraction,others=Math.max(...r.bands.filter(b=>b.band!==band).map(b=>b.fraction));single.push({band,own,others,ratio:own/Math.max(others,1e-6),directionError:error(r.place,expected(band))});}
 const silent=emission(await emit(new Array(9).fill(0),120));
 const demo=emission(await emit(new Array(9).fill(0),45,{active:false}));
 const jet=await jets();
 const checks={
  allBandsEmit:all.bands.every(b=>b.fraction>.8),
  birthCentred:all.bands.every(b=>b.birthError<3),
  placeCentred:all.bands.every(b=>b.placeError<20),
  fullCircle:all.bins.every(n=>n>all.alive/36*.3),
  lowerHalf:all.below>.38&&all.below<.62,
  singleBandDominates:single.every(s=>s.ratio>5),
  singleBandDirection:single.every(s=>s.directionError<20),
  silentBaselineWholeRing:silent.bands.every(b=>b.fraction>.01&&b.fraction<.2)&&silent.bins.filter(n=>n>0).length>=33&&silent.below>.3,
  silentDimmerThanActive:silent.alive<all.alive*.25,
  demoFullCircle:demo.below>.38,
  jetDirection:jet.every(j=>j.directionError<15&&j.along>j.opposite*3),
  finite:[all,silent,demo].every(r=>r.nonFinite===0),
  noErrors:engine.errors.length===0,
 };
 const result={pass:Object.values(checks).every(Boolean),checks,all:{alive:all.alive,below:all.below,bins:all.bins,bands:all.bands},single,silent:{alive:silent.alive,below:silent.below,bands:silent.bands},demo:{below:demo.below},jet,errors:engine.errors};
 out.textContent=JSON.stringify(result,null,2);window.spectralCircleResult=result;return result;
};
document.querySelector('#run').onclick=()=>window.runSpectralCircle().catch(error=>{out.textContent=JSON.stringify({pass:false,error:error.message,errors:engine?.errors},null,2);});

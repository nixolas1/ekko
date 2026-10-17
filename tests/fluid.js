import {ParticleEngine} from '../src/gpu.js';
const $=id=>document.getElementById(id),e=new ParticleEngine(document.querySelector('canvas')),errors=[];
e.onError=message=>{errors.push(message);$('result').textContent=message;};e.flowMode=1;e.count=32768;e.resolution=new URL(location.href).searchParams.get('resolution')==='4k'?'4k':'native';
let paused=false,testing=false,last=0,samples=[];
$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Resume':'Pause';};
await e.init();e.frame(0,[0,0,0,0],[],false);
requestAnimationFrame(function frame(now){requestAnimationFrame(frame);const dt=last?(now-last)/1000:1/60;last=now;if(testing||document.hidden)return;
 e.musicActive=$('signal').value==='music';const bass=(.5+.5*Math.sin(now*.006))**4;
 const hand=$('hand').value; e.frame(dt,e.musicActive?[bass,.45,.5,.6]:[0,0,0,0],hand==='none'?[]:[[Math.sin(now*.0005)*.4,0,hand==='pull'?8:-8,.4]],paused);
 samples.push(dt);if(samples.length>120)samples.shift();$('fps').textContent=`${(samples.length/samples.reduce((a,b)=>a+b,0)).toFixed(1)} FPS · fluid ${e.fluid.size.join('×')} · dye ${e.fluid.dyeSize.join('×')} · output ${e.canvas.width}×${e.canvas.height}`;
});
addEventListener('resize',()=>e.resize());addEventListener('pagehide',()=>e.dispose());
const half=x=>{const s=x&32768?-1:1,a=x>>10&31,b=x&1023;return s*(a===0?b*2**-24:a===31?(b?NaN:Infinity):(1+b/1024)*2**(a-15));};
async function read(resource,size,scalar=false){const stride=Math.ceil(size[0]*(scalar?4:8)/256)*256,b=e.device.createBuffer({size:stride*size[1],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=e.device.createCommandEncoder();c.copyTextureToBuffer({texture:resource.texture},{buffer:b,bytesPerRow:stride},size);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);const raw=scalar?new Float32Array(b.getMappedRange()):new Uint16Array(b.getMappedRange());const out=new Float32Array(size[0]*size[1]*(scalar?1:4));for(let y=0;y<size[1];y++)for(let x=0;x<size[0]*(scalar?1:4);x++)out[y*size[0]*(scalar?1:4)+x]=scalar?raw[y*stride/4+x]:half(raw[y*stride/2+x]);b.unmap();b.destroy();return out;}
$('run').onclick=async()=>{testing=true;$('result').textContent='running';try{
 e.musicActive=false;e.fluid.allocate(e.canvas.width/e.canvas.height,true);
 for(let i=0;i<180;i++){e.frame(1/60,[0,0,0,0],[],false);if(i%30===0)await e.device.queue.onSubmittedWorkDone();}
 const f=e.fluid,vel=await read(f.vel[0],f.size),div=await read(f.div,f.size,true),smoke=await read(f.dye[f.index],f.dyeSize);
 let before=0,after=0,n=0;const [w,h]=f.size,hx=e.canvas.width/e.canvas.height*2/w,hy=2/h;
 for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){const i=y*w+x;before+=div[i]**2;const d=(vel[(i+1)*4]-vel[i*4])/hx+(vel[(i+w)*4+1]-vel[i*4+1])/hy;after+=d*d;n++;}
 let mass=0,height=0;for(let i=0;i<smoke.length;i+=4){const d=smoke[i]+smoke[i+1]+smoke[i+2];mass+=d;height+=d*((Math.floor(i/4/f.dyeSize[0])+.5)/f.dyeSize[1]*2-1);}
 e.frame(1/60,[1,1,1,1],[[0,0,16,.5]],true);const frozen=await read(f.dye[f.index],f.dyeSize);
 const snapshot=await read(f.vel[0],f.size);
 e.frame(1/60,[0,0,0,0],[[0,0,16,.6]],false);const pulled=await read(f.vel[0],f.size);
 let handDelta=0;for(let i=0;i<snapshot.length;i+=4)handDelta+=Math.abs(snapshot[i]-pulled[i])+Math.abs(snapshot[i+1]-pulled[i+1]);
 const finite=[...vel,...smoke].every(Number.isFinite),pauseUnchanged=smoke.every((x,i)=>x===frozen[i]);
 const report={pass:finite&&pauseUnchanged&&mass>0&&height/mass>-.75&&after<before&&handDelta>0&&!errors.length,divergenceBefore:Math.sqrt(before/n),divergenceAfter:Math.sqrt(after/n),densityCentroidY:height/mass,sourceY:-.8,mass,finite,pauseUnchanged,handDelta,errors};
 $('result').textContent=JSON.stringify(report,null,2);
 }catch(error){$('result').textContent=JSON.stringify({pass:false,error:error.message,errors});}finally{testing=false;last=0;}};

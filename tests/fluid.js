import {ParticleEngine} from '../src/gpu.js';
const $=id=>document.getElementById(id),e=new ParticleEngine(document.querySelector('canvas')),errors=[];
e.onError=message=>{if(errors.length<8)errors.push(message);$('result').textContent=JSON.stringify(errors,null,2);};e.flowMode=Number(new URL(location.href).searchParams.get('flow')||6);e.palette=3;$('mode').value=String(e.flowMode);$('mode').onchange=()=>{e.flowMode=Number($('mode').value);e.fluid.allocate(e.canvas.width/e.canvas.height,true);};e.count=262144;e.resolution=new URL(location.href).searchParams.get('resolution')==='4k'?'4k':'native';
$('hide-results').onclick=()=>{$('result').hidden=!$('result').hidden;};
let paused=false,testing=false,last=0,samples=[];
$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Resume':'Pause';};
await e.init();e.frame(0,[0,0,0,0],[],false);
requestAnimationFrame(function frame(now){requestAnimationFrame(frame);const dt=last?(now-last)/1000:1/60;last=now;if(testing||document.hidden||errors.length)return;
 e.musicActive=$('signal').value==='music';const bass=(.5+.5*Math.sin(now*.006))**4;
 e.ringBands=Array.from({length:9},(_,i)=>Math.max(0,Math.sin(now*.0035+i*2.1))**8);e.ringAttacks=e.ringBands;
 e.emissionBands=e.ringBands.slice(0,7);const hand=$('hand').value; e.frame(dt,e.musicActive?[bass,.45,.5,.6]:[0,0,0,0],hand==='none'?[]:[[Math.sin(now*.0005)*.4,0,hand==='pull'?8:-8,.4]],paused);
 samples.push(dt);if(samples.length>120)samples.shift();$('fps').textContent=`${(samples.length/samples.reduce((a,b)=>a+b,0)).toFixed(1)} FPS · fluid ${e.fluid.size.join('×')} · dye ${e.fluid.dyeSize.join('×')} · output ${e.canvas.width}×${e.canvas.height}`;
});
addEventListener('resize',()=>e.resize());addEventListener('pagehide',()=>e.dispose());
const half=x=>{const s=x&32768?-1:1,a=x>>10&31,b=x&1023;return s*(a===0?b*2**-24:a===31?(b?NaN:Infinity):(1+b/1024)*2**(a-15));};
async function read(resource,size,scalar=false){const stride=Math.ceil(size[0]*(scalar?4:8)/256)*256,b=e.device.createBuffer({size:stride*size[1],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=e.device.createCommandEncoder();c.copyTextureToBuffer({texture:resource.texture},{buffer:b,bytesPerRow:stride},size);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);const raw=scalar?new Float32Array(b.getMappedRange()):new Uint16Array(b.getMappedRange());const out=new Float32Array(size[0]*size[1]*(scalar?1:4));for(let y=0;y<size[1];y++)for(let x=0;x<size[0]*(scalar?1:4);x++)out[y*size[0]*(scalar?1:4)+x]=scalar?raw[y*stride/4+x]:half(raw[y*stride/2+x]);b.unmap();b.destroy();return out;}
$('run').onclick=async()=>{testing=true;$('result').textContent='running';try{
 e.flowMode=1;e.musicActive=false;e.frame(0,[0,0,0,0],[],false);e.fluid.allocate(e.canvas.width/e.canvas.height,true);
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

$('ring-test').onclick=async()=>{testing=true;$('result').textContent='running ring tests';try{
 e.flowMode=6;e.musicActive=true;e.frame(0,[0,0,0,0],[],false);
 const f=e.fluid,reports=[];
 for(let band=0;band<9;band++){
  f.allocate(e.canvas.width/e.canvas.height,true);e.ringBands=Array(9).fill(0);e.ringAttacks=Array(9).fill(0);e.ringBands[band]=1;e.ringAttacks[band]=1;
  e.frame(1/60,[0,0,0,0],[],false);
  const dye=await read(f.dye[f.index],f.dyeSize);let mass=0,x=0,y=0,centre=0;
  for(let i=0;i<dye.length;i+=4){const v=dye[i]+dye[i+1]+dye[i+2],px=((i/4%f.dyeSize[0]+.5)/f.dyeSize[0]*2-1)*e.canvas.width/e.canvas.height,py=(Math.floor(i/4/f.dyeSize[0])+.5)/f.dyeSize[1]*2-1;mass+=v;x+=px*v;y+=py*v;if(Math.hypot(px,py)<.1)centre+=v;}
  const expected=3*Math.PI/4-band*Math.PI*2/9,actual=Math.atan2(y,x),error=Math.abs(Math.atan2(Math.sin(actual-expected),Math.cos(actual-expected)));
  reports.push({band,mass,directionDegrees:actual*180/Math.PI,errorDegrees:error*180/Math.PI,centre,pass:mass>0&&error<.08&&centre<.001});
 }
 f.allocate(e.canvas.width/e.canvas.height,true);e.ringBands.fill(0);e.ringAttacks.fill(0);e.frame(1/60,[0,0,0,0],[],false);
 const silent=await read(f.dye[f.index],f.dyeSize);const silenceEmpty=silent.every(v=>v===0);
 e.ringBands[0]=1;e.ringAttacks[0]=1;
 for(let i=0;i<30;i++)e.frame(1/60,[0,0,0,0],[],false);
 const lit=await read(f.light[f.index],f.dyeSize);const sum=a=>a.reduce((s,v,i)=>s+(i%4===3?0:v),0);
 const birthLight=sum(lit);e.ringBands.fill(0);e.ringAttacks.fill(0);
 for(let i=0;i<30;i++)e.frame(1/60,[0,0,0,0],[],false);
 const afterNote=sum(await read(f.light[f.index],f.dyeSize));
 e.frame(1/60,[0,0,0,0],[],true);const pausedLight=sum(await read(f.light[f.index],f.dyeSize));
 for(let i=0;i<180;i++){e.frame(1/60,[0,0,0,0],[],false);if(i%30===0)await e.device.queue.onSubmittedWorkDone();}
 const lateLight=sum(await read(f.light[f.index],f.dyeSize));
 $('result').textContent=JSON.stringify({pass:reports.every(r=>r.pass)&&silenceEmpty&&birthLight>0&&afterNote>birthLight*.1&&lateLight<afterNote*.6&&pausedLight===afterNote&&!errors.length,sectors:reports,silenceEmpty,birthLight,afterNote,lateLight,pauseUnchanged:pausedLight===afterNote,errors},null,2);
 }catch(error){$('result').textContent=JSON.stringify({pass:false,error:error.message,errors});}finally{testing=false;last=0;}};

$('force-test').onclick=async()=>{testing=true;$('result').textContent='testing launch response';try{
 e.flowMode=6;e.musicActive=true;e.mouse=[0,0,.18,0];e.frame(0,[0,0,0,0],[],false);
 const f=e.fluid;
 async function launch(response,band,attack){
  f.allocate(e.canvas.width/e.canvas.height,true);e.audioResponse=response;e.ringBands=Array(9).fill(0);e.ringAttacks=Array(9).fill(0);e.ringBands[band]=.8;e.ringAttacks[band]=attack;
  e.frame(1/60,[0,0,0,0],[],false);const v=await read(f.vel[0],f.size);
  return v.reduce((sum,x,i)=>sum+(i%4<2?x*x:0),0);
 }
 const low=await launch(.3,0,1),high=await launch(3,0,1),held=await launch(1.2,0,0),kick=await launch(1.2,0,1),treble=await launch(1.2,8,1);
 f.allocate(e.canvas.width/e.canvas.height,true);e.ringBands.fill(0);e.ringAttacks.fill(0);e.mouse=[.4,0,.18,1];e.frame(1/60,[0,0,0,0],[],false);
 const v=await read(f.vel[0],f.size);let inner=0,outer=0,ni=0,no=0,inward=0;
 for(let y=0;y<f.size[1];y++)for(let x=0;x<f.size[0];x++){
  const dx=((x+.5)/f.size[0]*2-1)*e.canvas.width/e.canvas.height-.4,dy=(y+.5)/f.size[1]*2-1,d=Math.hypot(dx,dy),idx=(y*f.size[0]+x)*4;
  if(d>.18||d<.001)continue;const radial=(v[idx]*dx+v[idx+1]*dy)/d;
  if(radial<-.0001)inward++;if(d<.06){inner+=radial;ni++;}if(d>.12){outer+=radial;no++;}
 }
 const report={pass:high>low*1.3&&kick>held*2&&kick>treble&&inward===0&&inner/ni>outer/no,lowResponse:low,highResponse:high,heldBass:held,bassKick:kick,trebleKick:treble,mouseInner:inner/ni,mouseEdge:outer/no,inwardCells:inward,errors};
 $('result').textContent=JSON.stringify(report,null,2);
 }catch(error){$('result').textContent=JSON.stringify({pass:false,error:error.message,errors});}finally{e.audioResponse=1.2;e.mouse=[0,0,.18,0];testing=false;last=0;}};

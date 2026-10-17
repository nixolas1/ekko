import {ParticleEngine} from '../src/gpu.js';
import {AdaptiveQuality} from '../src/performance.js';
const $=id=>document.getElementById(id),engine=new ParticleEngine(document.querySelector('canvas')),quality=new AdaptiveQuality();
engine.resolution=new URL(location.href).searchParams.get('resolution')==='4k'?'4k':'native';
engine.count=262144;engine.flowMode=Number(new URL(location.href).searchParams.get('mode'))||4;$('mode').value=String(engine.flowMode);
engine.onError=message=>{$('result').textContent=JSON.stringify({pass:false,error:message});};
let testing=false,last=0,samples=[],lastUI=0;
$('mode').onchange=()=>{engine.flowMode=Number($('mode').value);quality.reset();};
// Draw a deterministic light preview even when this diagnostics tab is in the background.
$('signal').onchange=()=>{const value=$('signal').value;engine.musicActive=value!=='silent';engine.dirty=true;engine.frame(0,value==='bass'?[1,0,0,1]:value==='high'?[0,0,1,1]:value==='pulse'?[.6,.3,.4,.6]:[0,0,0,0],[],true);};
$('clean').onclick=()=>document.body.classList.add('clean');
addEventListener('keydown',event=>{if(event.key.toLowerCase()==='h')document.body.classList.toggle('clean');});
addEventListener('resize',()=>engine.resize());
try{await engine.init();engine.frame(1/60,[0,0,0,0],[],false);requestAnimationFrame(frame);}catch(error){$('result').textContent=JSON.stringify({pass:false,error:error.message});}
function frame(now){requestAnimationFrame(frame);const dt=last?(now-last)/1000:1/60;last=now;if(testing||document.hidden)return;
 let sound=[0,0,0,0];engine.musicActive=$('signal').value!=='silent';
 if($('signal').value==='bass')sound=[1,0,0,1];else if($('signal').value==='high')sound=[0,0,1,1];else if(engine.musicActive){const pulse=Math.pow(.5+.5*Math.sin(now*.0063),4);sound=[pulse,.3,.15+.2*Math.sin(now*.001)**2,.2+.8*pulse];}
 const hand=$('hands').value,forces=hand==='none'?[]:[[Math.sin(now*.0007)*.6,.05,hand==='pull'?16:-16,.75]];
 const change=quality.update(dt,engine.count,engine.renderScale);if(change){engine.count=change.count;engine.renderScale=engine.resolution==='auto'?change.scale:1;}
 engine.frame(dt,sound,forces,false);samples.push(dt*1000);if(samples.length>180)samples.shift();
 if(now-lastUI>500){lastUI=now;const mean=samples.reduce((a,b)=>a+b,0)/samples.length;$('telemetry').textContent=`${(1000/mean).toFixed(1)} FPS · ${engine.count} particles · ${engine.canvas.width}×${engine.canvas.height} · scale ${engine.renderScale}`;}
}
$('check').onclick=async()=>{testing=true;$('result').textContent='running';const results=[];const originalMode=engine.flowMode;
 try{
  engine.count=32768;
  const read=async()=>{const b=engine.device.createBuffer({size:engine.count*64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),cmd=engine.device.createCommandEncoder();cmd.copyBufferToBuffer(engine.buffer,0,b,0,b.size);engine.device.queue.submit([cmd.finish()]);await b.mapAsync(GPUMapMode.READ);const floats=new Float32Array(b.getMappedRange().slice(0));b.unmap();b.destroy();return floats;};
  for(const mode of [4,5]){engine.flowMode=mode;engine.frame(0,[0,0,0,0],[],false);const seed=await read();engine.frame(1/60,[0,0,0,0],[],false);const base=await read();engine.device.queue.writeBuffer(engine.buffer,0,seed);engine.frame(1/60,[0,0,0,0],[[.3,.1,-20,.9]],false);const push=await read();let delta=0;for(let i=0;i<base.length;i+=16)delta+=Math.hypot(push[i+4]-base[i+4],push[i+5]-base[i+5]);
   for(let i=0;i<240;i++){engine.frame(1/60,[.8,.3,.6,.7],[[Math.sin(i*.04)*.5,.1,i%80<40?16:-16,.8]],false);if(i%30===0)await engine.device.queue.onSubmittedWorkDone();}
   const active=await read();engine.frame(1/60,[0,0,0,0],[],true);const paused=await read();results.push({mode,handVelocityChange:delta/engine.count,nonFinite:[...active].filter(v=>!Number.isFinite(v)).length,pauseUnchanged:active.every((v,i)=>v===paused[i]),initialized:active.every((v,i)=>i%16!==10||v===mode+1)});
  }
  $('result').textContent=JSON.stringify({pass:results.every(r=>r.handVelocityChange>.01&&!r.nonFinite&&r.pauseUnchanged&&r.initialized),results},null,2);
 }catch(error){$('result').textContent=JSON.stringify({pass:false,error:error.message,results},null,2);}finally{engine.flowMode=originalMode;engine.count=262144;quality.reset();testing=false;last=0;}
};
addEventListener('pagehide',()=>engine.dispose());

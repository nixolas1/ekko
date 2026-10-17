import {ParticleEngine} from '../src/gpu.js';
document.querySelector('#run').onclick=async()=>{
 const out=document.querySelector('#result'),e=new ParticleEngine(document.querySelector('canvas')),errors=[];
 e.onError=x=>errors.push(x);out.textContent='running';
 try{
  e.count=32768;e.flowMode=3;await e.init();
  const n=e.count,seed=new Float32Array(n*16);
  const read=async()=>{const b=e.device.createBuffer({size:seed.byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=e.device.createCommandEncoder();c.copyBufferToBuffer(e.buffer,0,b,0,seed.byteLength);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);const a=new Float32Array(b.getMappedRange().slice(0));b.unmap();b.destroy();return a;};
  e.frame(0,[0,0,0,0],[],false);await e.device.queue.onSubmittedWorkDone();
  for(let i=0;i<n;i++){const o=i*16,a=(i%1024)/1024*Math.PI*2;seed[o]=Math.cos(a)*.45;seed[o+1]=Math.sin(a)*.45;seed[o+2]=(i%19-9)*.005;seed[o+10]=4;seed[o+11]=1;seed[o+12]=(i%1024)/1024;seed[o+13]=1;seed[o+15]=8;}
  const run=async(bands,active=true,forces=[])=>{e.device.queue.writeBuffer(e.buffer,0,seed);e.time=0;e.clock=0;e.tracked=[];e.musicActive=active;e.frame(1/60,bands,forces,false);return read();};
  const base=await run([0,0,0,0]),bass=await run([1,0,0,1]),treble=await run([0,0,1,1]),silentBass=await run([1,0,0,1],false),silentTreble=await run([0,0,1,1],false),pull=await run([0,0,0,0],false,[[0,0,16,.95]]),push=await run([0,0,0,0],false,[[0,0,-16,.95]]);
  let bassLeft=0,bassRight=0,highLeft=0,highRight=0,attract=0,repel=0,silentVelocityDifference=0;
  for(let i=0;i<n;i++){const o=i*16,x=seed[o]/.45,y=seed[o+1]/.45;
   const bd=(bass[o+4]-base[o+4])*x,hd=(treble[o+4]-base[o+4])*x;
   if(x<0){bassLeft+=bd;highLeft+=hd;}else{bassRight+=bd;highRight+=hd;}
   attract+=(pull[o+4]-base[o+4])*x+(pull[o+5]-base[o+5])*y;repel+=(push[o+4]-base[o+4])*x+(push[o+5]-base[o+5])*y;
   for(let j=4;j<7;j++)silentVelocityDifference=Math.max(silentVelocityDifference,Math.abs(silentBass[o+j]-silentTreble[o+j]));
  }
  for(let step=0;step<360;step++){e.frame(1/60,[.8,.3,.6,.7],[[Math.sin(step*.03)*.4,.1,step%120<60?16:-16,.8]],false);if(step%30===0)await e.device.queue.onSubmittedWorkDone();}
  const after=await read();e.frame(1/60,[0,0,0,0],[],true);const frozen=await read();
  const stability={nonFinite:[...after].filter(v=>!Number.isFinite(v)).length,pauseUnchanged:after.every((v,i)=>v===frozen[i])};
  const direction={bassLeft:bassLeft/n,bassRight:bassRight/n,highLeft:highLeft/n,highRight:highRight/n,silentVelocityDifference,closedHandChange:attract/n,openHandChange:repel/n};
  out.textContent=JSON.stringify({pass:e.data[312]===4&&bassLeft>bassRight+.01&&highRight>highLeft+.01&&silentVelocityDifference<1e-5&&attract<0&&repel>0&&!stability.nonFinite&&stability.pauseUnchanged&&!errors.length,direction,stability,errors},null,2);
 }catch(error){out.textContent=JSON.stringify({pass:false,error:error.message,errors},null,2);}finally{e.dispose();}
};

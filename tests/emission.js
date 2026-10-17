import {ParticleEngine} from '../src/gpu.js';
document.querySelector('#run').onclick=async()=>{
 const out=document.querySelector('#result'),e=new ParticleEngine(document.querySelector('canvas')),errors=[],results=[];
 out.textContent='running';e.onError=error=>errors.push(error);
 try{
  e.count=32768;e.musicActive=true;e.emissionBands=Array(7).fill(0);await e.init();
  const read=async()=>{const b=e.device.createBuffer({size:e.count*64,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});const c=e.device.createCommandEncoder();c.copyBufferToBuffer(e.buffer,0,b,0,b.size);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);const a=new Float32Array(b.getMappedRange().slice(0));b.unmap();b.destroy();return a;};
  for(const mode of [3,4]){
   e.flowMode=mode;e.emissionBands.fill(0);e.frame(0,[0,0,0,0],[],false);const seed=await read();
   for(const lane of [-1,0,3,6]){
    e.device.queue.writeBuffer(e.buffer,0,seed);e.emissionBands.fill(0);if(lane>=0)e.emissionBands[lane]=1;
    for(let frame=0;frame<30;frame++){e.frame(1/60,[0,0,0,0],[],false);if(frame%10===0)await e.device.queue.onSubmittedWorkDone();}
    const data=await read(),counts=Array(7).fill(0);let nonFinite=0;
    for(let i=0;i<e.count;i++){if(data[i*16+13]>0)counts[i%7]++;for(let j=0;j<16;j++)if(!Number.isFinite(data[i*16+j]))nonFinite++;}
    const pass=!nonFinite&&counts.every((n,i)=>i===lane?n>100:n===0);results.push({mode,lane,counts,nonFinite,pass});
   }
  }
  out.textContent=JSON.stringify({pass:results.every(r=>r.pass)&&!errors.length,results,errors},null,2);
 }catch(error){out.textContent=JSON.stringify({pass:false,error:error.message,results,errors},null,2);}finally{e.dispose();}
};

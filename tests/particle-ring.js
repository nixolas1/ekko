import {ParticleEngine} from '../src/gpu.js';
document.querySelector('#run').onclick=async()=>{
 const out=document.querySelector('#result'),e=new ParticleEngine(document.querySelector('canvas')),errors=[];
 out.textContent='running';e.onError=message=>errors.push(message);
 try{
  e.count=32768;e.flowMode=2;e.musicActive=true;e.audioResponse=1.2;await e.init();
  const read=async()=>{const b=e.device.createBuffer({size:e.count*64,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),enc=e.device.createCommandEncoder();enc.copyBufferToBuffer(e.buffer,0,b,0,b.size);e.device.queue.submit([enc.finish()]);await b.mapAsync(GPUMapMode.READ);const data=new Float32Array(b.getMappedRange().slice(0));b.unmap();b.destroy();return data;};
  e.frame(0,[0,0,0,0],[],false);const seed=await read();
  async function run(bass,high=0){
   e.device.queue.writeBuffer(e.buffer,0,seed);e.time=0;e.clock=0;
   for(let i=0;i<12;i++)e.frame(1/60,[bass,0,high,0],[],false);
   const data=await read();let radial=0,n=0;
   for(let i=0;i<e.count;i++){
    const k=i*16,r=Math.hypot(data[k],data[k+1]);
    if(data[k+13]<0||r<.25||r>.7)continue;
    radial+=(data[k]*data[k+4]+data[k+1]*data[k+5])/r;n++;
   }
   return {speed:radial/n,n,finite:data.every(Number.isFinite)};
  }
  const quiet=await run(0),medium=await run(.4),bass=await run(1),treble=await run(0,1);
  out.textContent=JSON.stringify({pass:quiet.finite&&medium.finite&&bass.finite&&treble.finite&&medium.speed>quiet.speed*1.5&&bass.speed>medium.speed*1.5&&Math.abs(treble.speed-quiet.speed)<.01&&!errors.length,quiet,medium,bass,treble,errors},null,2);
 }catch(e){out.textContent=JSON.stringify({pass:false,error:e.message,errors});}finally{e.dispose();}
};

import {ParticleEngine} from '../src/gpu.js';
const output=document.querySelector('#result');
window.runHandPowers=async()=>{
 const e=new ParticleEngine(document.querySelector('canvas')),errors=[];e.onError=x=>errors.push(String(x));e.count=32768;
 try{
  await e.init();const n=e.count,seed=new Float32Array(n*16);
  const read=async()=>{const b=e.device.createBuffer({size:seed.byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=e.device.createCommandEncoder();c.copyBufferToBuffer(e.buffer,0,b,0,seed.byteLength);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);const a=new Float32Array(b.getMappedRange().slice(0));b.unmap();b.destroy();return a;};
  const run=async(forces,burst=false,mouse=false)=>{
   e.mouse=mouse?[0,0,.3,1]:[0,0,.3,0];
   e.time=0;e.clock=0;e.tracked=[];e.pending=[];e.serial=0;e.served=0;e.burst=[0,0,0,0];e.device.queue.writeBuffer(e.buffer,0,seed);
   if(burst)e.explode(0,0,1.2);e.frame(1/60,[0,0,0,0],forces,false);return read();
  };
  const results=[];
  for(const [flow,persistent,mode] of [[0,true,1],[0,false,0],[2,false,3],[3,false,4],[4,false,5],[5,false,6],[7,false,8],[8,false,9]]){
   e.flowMode=flow;e.persistent=persistent;e.musicActive=false;e.frame(0,[0,0,0,0],[],false);await e.device.queue.onSubmittedWorkDone();
   seed.fill(0);for(let i=0;i<n;i++){const o=i*16,a=i/n*Math.PI*2;seed[o]=Math.cos(a)*.18;seed[o+1]=Math.sin(a)*.18;seed[o+10]=mode;seed[o+11]=1;seed[o+12]=i/n;seed[o+13]=1;seed[o+15]=mode<5?8:0;}
   const baseline=await run([]);
   const metric=data=>{let radial=0,tangent=0,used=0,nonFinite=0;for(let i=0;i<n;i++){const o=i*16,x=seed[o]/.18,y=seed[o+1]/.18;for(let j=0;j<16;j++)if(!Number.isFinite(data[o+j]))nonFinite++;if(Math.hypot(data[o]-baseline[o],data[o+1]-baseline[o+1])>.08)continue;const vx=data[o+4]-baseline[o+4],vy=data[o+5]-baseline[o+5];radial+=vx*x+vy*y;tangent+=vx*y-vy*x;used++;}return {radial:radial/used,tangent:tangent/used,nonFinite,used};};
   const wand=metric(await run([[0,0,14,.22,1,0,1]])),vortex=metric(await run([[0,0,16,.5,0,1,1]])),push=metric(await run([[0,0,-18,1,0,0,1]])),burst=metric(await run([],true));
   const pointing=await run([[0,0,1,-.3,0,0,1,0,0]]),mouse=await run([],false,true);
   const cursor=metric(pointing),cursorError=pointing.reduce((m,v,i)=>i%16<8?Math.max(m,Math.abs(v-mouse[i])):m,0);
   const depth={pull:[],push:[]};
   for(const strength of [4.5,18,72])for(const [name,sign] of [['pull',1],['push',-1]]){
    const m=metric(await run([[0,0,strength*sign,.65,0,0,1,0,0]]));depth[name].push(Math.abs(m.radial));
   }
   const scaled=Object.values(depth).every(values=>values[1]>values[0]*1.2&&values[2]>values[1]*1.2);
   // Pointing emits in Hand Fire, so its simulation intentionally ignores cursor obstacles.
   const cursorPass=cursorError<1e-6&&(mode===9?cursor.radial===0:cursor.radial>.01&&Math.abs(cursor.tangent)<.001);
   const pass=scaled&&cursorPass&&wand.radial<-.015&&vortex.tangent>.1&&vortex.tangent>Math.abs(vortex.radial)*2&&push.radial>.05&&burst.radial>.3&&[wand,vortex,push,burst].every(m=>!m.nonFinite&&m.used>n*.75);
   results.push({mode,wand,vortex,push,burst,cursor,cursorError,depth,pass});
  }
  const half=x=>{const s=x&32768?-1:1,a=x>>10&31,b=x&1023;return s*(a===0?b*2**-24:a===31?(b?NaN:Infinity):(1+b/1024)*2**(a-15));};
  const readVel=async()=>{const [w,h]=e.fluid.size,stride=Math.ceil(w*8/256)*256,b=e.device.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=e.device.createCommandEncoder();c.copyTextureToBuffer({texture:e.fluid.vel[0].texture},{buffer:b,bytesPerRow:stride},[w,h]);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);const raw=new Uint16Array(b.getMappedRange());let radial=0,tangent=0,num=0,nonFinite=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const qx=((x+.5)/w*2-1)*e.canvas.width/e.canvas.height,qy=(y+.5)/h*2-1,r=Math.hypot(qx,qy),i=y*stride/2+x*4,vx=half(raw[i]),vy=half(raw[i+1]);if(!Number.isFinite(vx+vy))nonFinite++;if(r>.08&&r<.25){radial+=(vx*qx+vy*qy)/r;tangent+=(vx*qy-vy*qx)/r;num++;}}b.unmap();b.destroy();return {radial:radial/num,tangent:tangent/num,nonFinite};};
  const fluid=[];for(const flow of [1,6]){
   e.flowMode=flow;e.musicActive=true;e.ringBands=Array(9).fill(0);e.emissionBands=Array(7).fill(0);e.frame(0,[0,0,0,0],[],false);
   const once=async(forces,burst=false,mouse=false)=>{e.mouse=mouse?[0,0,.3,1]:[0,0,.3,0];e.fluid.allocate(e.canvas.width/e.canvas.height,true);e.tracked=[];e.pending=[];if(burst)e.explode(0,0,1.2);e.frame(1/60,[0,0,0,0],forces,false);return readVel();};
   const wand=await once([[0,0,14,.22,1,0,1]]),vortex=await once([[0,0,16,.5,0,1,1]]),push=await once([[0,0,-18,1,0,0,1]]),burst=await once([],true);
   const cursor=await once([[0,0,1,-.3,0,0,1,0,0]]),mouse=await once([],false,true);
   const cursorError=Math.abs(cursor.radial-mouse.radial)+Math.abs(cursor.tangent-mouse.tangent);
   const depth={pull:[],push:[]};
   for(const strength of [4.5,18,72])for(const [name,sign] of [['pull',1],['push',-1]]){
    const m=await once([[0,0,strength*sign,.65,0,0,1,0,0]]);depth[name].push(Math.hypot(m.radial,m.tangent));
   }
   const scaled=Object.values(depth).every(values=>values[1]>values[0]*1.2&&values[2]>values[1]*1.2);
   fluid.push({flow,wand,vortex,push,burst,cursor,cursorError,depth,pass:scaled&&cursorError<1e-6&&cursor.radial>.01&&wand.radial<-.02&&vortex.tangent>.1&&push.radial>.08&&burst.radial>.4&&[wand,vortex,push,burst].every(m=>!m.nonFinite)});
  }
  return {pass:results.every(r=>r.pass)&&fluid.every(r=>r.pass)&&!errors.length,particles:results,fluid,errors};
 }finally{e.dispose();}
};
document.querySelector('#run').onclick=async()=>{output.textContent='Running';try{output.textContent=JSON.stringify(await window.runHandPowers(),null,2);}catch(error){output.textContent=JSON.stringify({pass:false,error:error.stack},null,2);}};

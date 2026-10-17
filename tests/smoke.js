// Particle-ring regression. Grid smoke is checked separately in tests/fluid.html.
import {ParticleEngine} from '../src/gpu.js';
document.querySelector('#run').onclick=async()=>{
 const out=document.querySelector('#result'),e=new ParticleEngine(document.querySelector('canvas')),errors=[];e.onError=x=>errors.push(x);out.textContent='running';
 try{
  e.count=32768;await e.init();const n=e.count,seed=new Float32Array(n*16);
  const read=async()=>{const b=e.device.createBuffer({size:seed.byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=e.device.createCommandEncoder();c.copyBufferToBuffer(e.buffer,0,b,0,seed.byteLength);e.device.queue.submit([c.finish()]);await b.mapAsync(GPUMapMode.READ);const a=new Float32Array(b.getMappedRange().slice(0));b.unmap();b.destroy();return a;};
  const run=async(mode,forces=[])=>{e.flowMode=mode;e.frame(0,[0,0,0,0],[],false);await e.device.queue.onSubmittedWorkDone();e.time=0;e.clock=0;e.tracked=[];for(let i=0;i<n;i++){const o=i*16,a=(i%1024)/1024*Math.PI*2;seed[o]=Math.cos(a)*.45;seed[o+1]=Math.sin(a)*.45;seed[o+2]=(i%19-9)*.005;seed[o+10]=mode+1;seed[o+11]=1;seed[o+13]=1;seed[o+15]=8;}e.device.queue.writeBuffer(e.buffer,0,seed);e.frame(1/60,[0,0,0,0],forces,false);return read();};
  const smoke=await run(2),ring=await run(2),pull=await run(2,[[0,0,16,.95]]),push=await run(2,[[0,0,-16,.95]]);
  let upward=0,radial=0,attract=0,repel=0;
  for(let i=0;i<n;i++){const o=i*16,x=seed[o]/.45,y=seed[o+1]/.45;upward+=smoke[o+5];radial+=ring[o+4]*x+ring[o+5]*y;attract+=(pull[o+4]-smoke[o+4])*x+(pull[o+5]-smoke[o+5])*y;repel+=(push[o+4]-smoke[o+4])*x+(push[o+5]-smoke[o+5])*y;}
  const motion={upwardVelocity:upward/n,ringOutwardVelocity:radial/n,closedHandChange:attract/n,openHandChange:repel/n};
  const cycles=[];
  for(const mode of [2]){e.flowMode=mode;for(let step=0;step<540;step++){if(step%90===0)e.explode(.1,0);e.frame(1/60,[.8,.4,.2,.7],[[Math.sin(step*.03)*.4,.1,step%120<60?16:-16,.8]],false);if(step%30===0)await e.device.queue.onSubmittedWorkDone();}const data=await read();let bad=0,born=0;for(let i=0;i<n;i++){const o=i*16;for(let j=0;j<16;j++)if(!Number.isFinite(data[o+j]))bad++;if(data[o+13]<1)born++;}e.frame(1/60,[0,0,0,0],[],true);const frozen=await read();cycles.push({mode,nonFinite:bad,recentBirths:born,pauseUnchanged:data.every((v,i)=>v===frozen[i])});}
  // Render the exact same frozen smoke twice: synthetic signal alone must stay gray,
  // while an explicitly active music source must light colored bulbs. No audio is played.
  const lightStats=async active=>{
   e.musicActive=active;e.frame(1/60,[.8,.4,.2,.7],[],true);
   const w=512,h=288;e.data[9]=w;e.data[10]=h;e.device.queue.writeBuffer(e.uniform,0,e.data);
   const tex=e.device.createTexture({size:[w,h],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   const buffer=e.device.createBuffer({size:w*h*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),cmd=e.device.createCommandEncoder();
   const pass=cmd.beginRenderPass({colorAttachments:[{view:tex.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(e.render);pass.setBindGroup(0,e.renderGroup);pass.draw(4,n);pass.end();
   cmd.copyTextureToBuffer({texture:tex},{buffer,bytesPerRow:w*8},[w,h]);e.device.queue.submit([cmd.finish()]);await buffer.mapAsync(GPUMapMode.READ);
   const pixels=new Uint16Array(buffer.getMappedRange());const half=v=>{const exponent=(v>>10)&31,m=v&1023;return (v&32768?-1:1)*(exponent?Math.pow(2,exponent-15)*(1+m/1024):m*Math.pow(2,-24));};
   let radiance=0,chroma=0,peak=0;for(let i=0;i<pixels.length;i+=4){const rgb=[half(pixels[i]),half(pixels[i+1]),half(pixels[i+2])],max=Math.max(...rgb);radiance+=rgb.reduce((a,b)=>a+b,0);chroma+=max-Math.min(...rgb);peak+=max;}
   buffer.unmap();buffer.destroy();tex.destroy();return {radiance,chromaRatio:chroma/Math.max(peak,.00001)};
  };
  const lampsOff=await lightStats(false),lampsOn=await lightStats(true);
  // The requested smaller, desaturated lamps should still pulse visibly, with only
  // a subtle hue change. Guard against returning to the old highly colored glow.
  const musicLights={lampsOff,lampsOn,pass:lampsOn.radiance>lampsOff.radiance*1.2&&lampsOn.chromaRatio>lampsOff.chromaRatio+.003&&lampsOn.chromaRatio<.3};
  out.textContent=JSON.stringify({pass:radial>0&&attract<0&&repel>0&&cycles.every(c=>c.nonFinite===0&&c.recentBirths>0&&c.pauseUnchanged)&&!errors.length&&musicLights.pass,motion,cycles,musicLights,errors},null,2);
 }catch(error){out.textContent=JSON.stringify({pass:false,error:error.message,errors},null,2);}finally{e.dispose();}
};

import { ParticleEngine } from '../src/gpu.js';

// Actual compute/readback test. Two particle clouds surround independent hands;
// identical initial buffers let us subtract the sculpture's spring/flow acceleration.
document.querySelector('#run').onclick=async()=>{
  const output=document.querySelector('#result'), engine=new ParticleEngine(document.querySelector('canvas'));
  output.textContent='running';
  const errors=[];engine.onError=e=>errors.push(e);
  try {
    engine.count=32768; await engine.init();
    const count=engine.count, seed=new Float32Array(count*16), centers=[-.75,.75];
    for(let i=0;i<count;i++){
      const o=i*16, angle=(i%1024)/1024*Math.PI*2, radius=.22;
      seed[o]=centers[i%2]+Math.cos(angle)*radius;seed[o+1]=Math.sin(angle)*radius;
      seed[o+3]=1;seed[o+11]=1;
    }
    const read=async()=>{
      const staging=engine.device.createBuffer({size:seed.byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const commands=engine.device.createCommandEncoder();commands.copyBufferToBuffer(engine.buffer,0,staging,0,seed.byteLength);engine.device.queue.submit([commands.finish()]);
      await staging.mapAsync(GPUMapMode.READ);const data=new Float32Array(staging.getMappedRange().slice(0));staging.unmap();staging.destroy();return data;
    };
    const run=async forces=>{
      engine.time=0;engine.clock=0;engine.tracked=[];engine.lastCount=count;
      engine.device.queue.writeBuffer(engine.buffer,0,seed);
      engine.frame(1/60,[0,0,0,0],forces,false);
      return read();
    };
    const baseline=await run([]), mixed=await run([[-.75,0,16,.65],[.75,0,-16,.65]]);
    const reversed=await run([[-.75,0,-16,.65],[.75,0,16,.65]]);
    const compare=data=>{
      const groups=[{radial:0,samples:0},{radial:0,samples:0}];let nonFinite=0;
      for(let i=0;i<count;i++){
        const o=i*16,g=i%2,dx=seed[o]-centers[g],dy=seed[o+1],r=Math.hypot(dx,dy);
        if(!Array.from(data.subarray(o,o+16)).every(Number.isFinite)){nonFinite++;continue;}
        // Exclude particles freshly emitted by the field; compare the surrounding cloud.
        if(Math.hypot(data[o]-baseline[o],data[o+1]-baseline[o+1])>.08)continue;
        groups[g].radial+=((data[o+4]-baseline[o+4])*dx+(data[o+5]-baseline[o+5])*dy)/r;groups[g].samples++;
      }
      return {radialVelocityChange:groups.map(g=>g.radial/g.samples),samples:groups.map(g=>g.samples),nonFinite};
    };
    const a=compare(mixed),b=compare(reversed);
    const signedPass=!errors.length&&!a.nonFinite&&!b.nonFinite&&a.radialVelocityChange[0]<-.05&&a.radialVelocityChange[1]>.1&&b.radialVelocityChange[0]>.1&&b.radialVelocityChange[1]<-.05;
    engine.persistent=true;
    seed.fill(0);
    for(let i=0;i<count;i++){seed[i*16+10]=1;seed[i*16+11]=1;}
    engine.device.queue.writeBuffer(engine.buffer,0,seed);
    for(let step=0;step<60;step++)engine.frame(1/60,[0,0,0,0],[],false);
    const separated=await read();let meanRadius=0,nonFinite=0;
    for(let i=0;i<count;i++){const o=i*16;meanRadius+=Math.hypot(separated[o],separated[o+1]);for(let j=0;j<16;j++)if(!Number.isFinite(separated[o+j]))nonFinite++;}
    meanRadius/=count;
    engine.explode(0,0);engine.frame(1/60,[.8,.5,.4,.7],[[.3,0,16,.95]],false);
    const burst=await read();let largestStep=0;
    for(let i=0;i<count;i++){const o=i*16;largestStep=Math.max(largestStep,Math.hypot(burst[o]-separated[o],burst[o+1]-separated[o+1],burst[o+2]-separated[o+2]));}
    const persistent={meanRadiusAfterCoincidentStart:meanRadius,nonFinite,largestStepAfterBurst:largestStep,pass:meanRadius>.005&&nonFinite===0&&largestStep<.15};
    const pass=signedPass&&persistent.pass&&!errors.length;
    output.textContent=JSON.stringify({pass,method:'Actual WebGPU compute/readback: signed forces, separation of coincident particles, persistent burst without teleportation',leftClosedRightOpen:a,leftOpenRightClosed:b,persistent,errors},null,2);
  }catch(error){output.textContent=JSON.stringify({pass:false,error:error.message,errors},null,2);}finally{engine.dispose();}
};

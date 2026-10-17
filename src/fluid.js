import code from './fluid.wgsl?raw';
// Velocity/pressure work stays on a bounded MAC grid; dye has 4× the linear
// resolution. The final pass is native resolution and uses limited MacCormack
// advection to avoid the blur of repeatedly resampling a coarse density field.
export class FluidSmoke {
  constructor(engine){this.engine=engine;this.device=engine.device;this.textures=[];this.index=0;this.pressureIndex=0;}
  async init(){
    const module=await this.engine.module('fluid.wgsl',code);
    const names=['advectVelocity','curl','confine','divergence','pressure','project','dyeForward','dyeBackward','dyeCorrect'];
    this.pipelines=Object.fromEntries(await Promise.all(names.map(async entryPoint=>[entryPoint,await this.device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}})])));
    this.render=await this.device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'fluidVertex'},fragment:{module,entryPoint:'fluidFragment',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
  }
  allocate(aspect,reset=false){
    // Square world-space cells, bounded width on ultrawide displays.
    const h=192,w=Math.max(64,Math.min(512,Math.round(h*aspect/8)*8));
    if(!reset&&this.size?.[0]===w&&this.size?.[1]===h)return;
    this.textures.forEach(t=>t.destroy());this.textures=[];this.size=[w,h];this.dyeSize=[w*4,h*4];this.index=0;this.pressureIndex=0;
    const make=(size,format)=>{const t=this.device.createTexture({size,format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});this.textures.push(t);return {texture:t,view:t.createView()};};
    this.vel=Array.from({length:3},()=>make(this.size,'rgba16float'));
    this.dye=Array.from({length:4},()=>make(this.dyeSize,'rgba16float'));
    this.pressure=Array.from({length:2},()=>make(this.size,'r32float'));
    this.div=make(this.size,'r32float');this.curl=make(this.size,'r32float');
    const group=(pipeline,items)=>this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:items.map(([binding,resource])=>({binding,resource}))});
    const U=[0,{buffer:this.engine.uniform}],S=[5,this.engine.sampler];
    this.groups={};
    const P=this.pipelines;
    this.groups.advect=this.dye.slice(0,2).map(d=>group(P.advectVelocity,[U,[1,d.view],[2,this.vel[0].view],S,[6,this.vel[1].view]]));
    this.groups.curl=group(P.curl,[U,[1,this.vel[1].view],[7,this.curl.view]]);
    this.groups.confine=group(P.confine,[U,[1,this.curl.view],[2,this.vel[1].view],[6,this.vel[2].view]]);
    this.groups.div=group(P.divergence,[U,[1,this.vel[2].view],[7,this.div.view]]);
    this.groups.pressure=this.pressure.map((p,i)=>group(P.pressure,[U,[1,p.view],[3,this.div.view],[7,this.pressure[1-i].view]]));
    this.groups.project=this.pressure.map(p=>group(P.project,[U,[1,p.view],[2,this.vel[2].view],[6,this.vel[0].view]]));
    this.groups.forward=this.dye.slice(0,2).map(d=>group(P.dyeForward,[U,[1,d.view],[2,this.vel[0].view],S,[6,this.dye[2].view]]));
    this.groups.backward=group(P.dyeBackward,[U,[1,this.dye[2].view],[2,this.vel[0].view],S,[6,this.dye[3].view]]);
    this.groups.correct=this.dye.slice(0,2).map((d,i)=>group(P.dyeCorrect,[U,[1,d.view],[2,this.vel[0].view],[3,this.dye[2].view],[4,this.dye[3].view],S,[6,this.dye[1-i].view]]));
    this.groups.render=this.dye.slice(0,2).map(d=>group(this.render,[U,[1,d.view],S]));
  }
  dispatch(encoder,name,group,size=this.size){
    const pass=encoder.beginComputePass();pass.setPipeline(this.pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(size[0]/8),Math.ceil(size[1]/8));pass.end();
  }
  step(encoder){
    const g=this.groups;
    this.dispatch(encoder,'advectVelocity',g.advect[this.index]);
    this.dispatch(encoder,'curl',g.curl);this.dispatch(encoder,'confine',g.confine);this.dispatch(encoder,'divergence',g.div);
    for(let i=0;i<32;i++){this.dispatch(encoder,'pressure',g.pressure[this.pressureIndex]);this.pressureIndex=1-this.pressureIndex;}
    this.dispatch(encoder,'project',g.project[this.pressureIndex]);
    this.dispatch(encoder,'dyeForward',g.forward[this.index],this.dyeSize);
    this.dispatch(encoder,'dyeBackward',g.backward,this.dyeSize);
    this.dispatch(encoder,'dyeCorrect',g.correct[this.index],this.dyeSize);
    this.index=1-this.index;
  }
  draw(encoder,view){this.engine.screenPass(encoder,this.render,this.groups.render[this.index],view);}
}

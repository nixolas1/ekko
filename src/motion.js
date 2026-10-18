const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Short-horizon trajectory prediction plus a cubic correction at each observation.
// Sampling is a pure function of time, independent of display FPS. New observations
// replace predictions without a position jump; stale input settles at a bounded end.
export class MotionTrack {
  constructor({interval=16,minDuration=16,maxPrediction=.12,predict=true}={}){
    Object.assign(this,{initialInterval:interval,minDuration,maxPrediction,predict});this.clear();
  }
  clear(){this.interval=this.initialInterval;this.target=null;this.at=null;this.history=[];}
  update(values,time,captured=time){
    if(!Number.isFinite(time)||!Number.isFinite(captured)||!values.every(Number.isFinite)||
      this.at!==null&&(time<=this.at||captured<=this.captured))return;
    const current=this.target?this.sample(time):null;
    if(this.at!==null){const gap=time-this.at;this.interval=gap>this.interval?gap:this.interval*.7+gap*.3;}
    this.duration=Math.max(this.minDuration,this.interval*.65);
    this.target=values.slice();this.at=time;this.captured=Math.min(time,captured);
    this.history.push({values:values.slice(),time:this.captured});if(this.history.length>64)this.history.shift();
    this.velocity=values.map(()=>0);this.turn=0;
    const n=this.history.length;
    if(this.predict&&n>=3){
      // Coalesced mouse reports can be less than a millisecond apart. Estimate
      // derivatives over at least 4 ms instead of amplifying quantization noise.
      const c=this.history[n-1],b=this.history.findLast(p=>p.time<=c.time-4);
      const a=b&&this.history.findLast(p=>p.time<=b.time-4);
      if(a&&b){
        const dt=c.time-b.time,previousDt=b.time-a.time;
        const vx=(c.values[0]-b.values[0])/dt,vy=(c.values[1]-b.values[1])/dt;
        const px=(b.values[0]-a.values[0])/previousDt,py=(b.values[1]-a.values[1])/previousDt;
        const speed=Math.hypot(vx,vy),previousSpeed=Math.hypot(px,py);
        const angle=Math.atan2(px*vy-py*vx,px*vx+py*vy),ratio=speed/Math.max(previousSpeed,1e-10);
        // Do not predict jitter, reversals or a sudden acceleration/deceleration.
        if(Math.abs(angle)<Math.PI/3&&ratio>.5&&ratio<2&&speed*dt>1e-6){
          const confidence=Math.min(1,80/dt),turn=2*angle/(dt+previousDt);
          // Secants lag the current tangent by half a turn on a curved path.
          const half=turn*dt/2,cs=Math.cos(half),sn=Math.sin(half);
          this.velocity[0]=(vx*cs-vy*sn)*confidence;this.velocity[1]=(vx*sn+vy*cs)*confidence;
          this.turn=turn;
        }
        // Predict orientation independently, including rotation in place. Finger
        // deformation is deliberately never extrapolated.
        if(values.length>2){
          const av=(c.values[2]-b.values[2])/dt,pav=(b.values[2]-a.values[2])/previousDt;
          const ratio=Math.abs(av)/Math.max(Math.abs(pav),1e-10);
          if(av*pav>0&&ratio>.5&&ratio<2)this.velocity[2]=clamp(av,-.006,.006)*Math.min(1,80/dt);
        }
      }
    }
    this.offset=values.map(()=>0);this.tangent=values.map(()=>0);
    if(current){
      const base=this.base(time),next=this.base(time+.1);
      this.offset=current.position.map((v,i)=>v-base[i]);
      this.tangent=current.velocity.map((v,i)=>(v-(next[i]-base[i])/.1)*this.duration);
      // Bound correction momentum after a sharp reversal or a bad sample.
      const length=Math.hypot(...this.tangent),limit=Math.max(Math.hypot(...this.offset)*2,1e-6);
      if(length>limit)this.tangent=this.tangent.map(v=>v*limit/length);
    }
  }
  base(time){
    const age=Math.max(0,time-this.captured+8);
    let h=age<=40?age:40+20*(1-Math.exp(-(age-40)/20));
    const [vx=0,vy=0]=this.velocity,speed=Math.hypot(vx,vy);
    const distanceHorizon=this.maxPrediction/Math.max(speed,1e-12),softStart=distanceHorizon*.7;
    if(h>softStart)h=softStart+distanceHorizon*.3*(1-Math.exp(-(h-softStart)/(distanceHorizon*.3)));
    const angle=this.turn*h;
    const a=Math.abs(this.turn)>1e-8?Math.sin(angle)/this.turn:h;
    const b=Math.abs(this.turn)>1e-8?(1-Math.cos(angle))/this.turn:0;
    return this.target.map((v,i)=>v+(i===0?vx*a-vy*b:i===1?vx*b+vy*a:i===2?clamp(this.velocity[i]*h,-.2,.2):0));
  }
  position(time){
    const t=clamp((time-this.at)/this.duration,0,1),u=1-t;
    return this.base(time).map((v,i)=>v+this.offset[i]*u*u*(1+2*t)+this.tangent[i]*t*u*u);
  }
  sample(time){
    if(!this.target)return null;
    const position=this.position(time),next=this.position(time+.1);
    return {position,velocity:position.map((v,i)=>(next[i]-v)/.1)};
  }
}

// Interpolate the palm's translation and unwrapped rotation separately from the
// finger pose. A rotating hand therefore keeps its shape instead of collapsing
// as opposite landmark coordinates are blended together.
export class HandMotion {
  constructor(){this.motion=new MotionTrack({interval:33,minDuration:20});this.angle=null;}
  update(points,time,aspect=1,captured=time){
    if(this.motion.at!==null&&(time<=this.motion.at||captured<=this.motion.captured))return;
    const origin=points[9],dx=(origin.x-points[0].x)*aspect,dy=origin.y-points[0].y;
    let angle=Math.hypot(dx,dy)>1e-6?Math.atan2(dy,dx):this.angle??0;
    if(this.angle!==null)angle=this.angle+Math.atan2(Math.sin(angle-this.angle),Math.cos(angle-this.angle));
    this.angle=angle;this.aspect=aspect;
    const c=Math.cos(angle),s=Math.sin(angle),local=points.flatMap(p=>{
      const x=(p.x-origin.x)*aspect,y=p.y-origin.y;
      return [x*c+y*s,-x*s+y*c,p.z||0];
    });
    this.motion.update([origin.x*aspect,origin.y,angle,...local],time,captured);
  }
  sample(time){
    const sample=this.motion.sample(time);if(!sample)return null;
    const [x,y,angle,...local]=sample.position,c=Math.cos(angle),s=Math.sin(angle),points=[];
    for(let i=0;i<local.length;i+=3)points.push({x:(x+local[i]*c-local[i+1]*s)/this.aspect,y:y+local[i]*s+local[i+1]*c,z:local[i+2]});
    return points;
  }
}

import { openness } from './gestures.js';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
// Stable hand identities, adaptive sample filtering and bounded latency compensation.
// sample() runs at display cadence, smoothly approaching a short predicted endpoint.
export class HandForces {
  constructor(){this.states=new Map();this.current=[];this.seen=0;}
  update(data,time,mapPoint){
    const captured=Number.isFinite(data.timestamp)?Math.min(time,data.timestamp):time;
    const found=new Set();
    data.hands.forEach((hand,index)=>{
      const id=data.handIds?.[index]??index;found.add(id);
      const [x,y]=mapPoint(hand[9]);if(!Number.isFinite(x)||!Number.isFinite(y))return;
      const level=openness(hand,data.aspect||1),old=this.states.get(id);
      const dt=old?clamp((captured-old.captured)/1000,.008,.2):.05;
      const rawVx=old?clamp((x-old.rawX)/dt,-6,6):0,rawVy=old?clamp((y-old.rawY)/dt,-6,6):0;
      const speed=Math.hypot(rawVx,rawVy),alpha=1-Math.exp(-dt/(.018/(1+speed*3)));
      const px=old?old.x+(x-old.x)*alpha:x,py=old?old.y+(y-old.y)*alpha:y;
      // Stops and reversals damp the old prediction immediately instead of overshooting.
      const velocityAlpha=old&&(rawVx*old.vx+rawVy*old.vy<0||speed<.08)?1:1-Math.exp(-dt/.025);
      const vx=old?old.vx+(rawVx-old.vx)*velocityAlpha:0,vy=old?old.vy+(rawVy-old.vy)*velocityAlpha:0;
      const open=old?old.open+(level-old.open)*(1-Math.exp(-dt/.035)):level;
      const mode=open<.38?1:open>.62?-1:(old?.mode??1);
      this.states.set(id,{id,x:px,y:py,rawX:x,rawY:y,vx,vy,open,mode,strength:mode*(12+Math.abs(open-.5)*12),captured,time,renderX:old?.renderX??px,renderY:old?.renderY??py,renderAt:old?.renderAt??time});
    });
    for(const [id,state] of this.states)if(!found.has(id)&&time-state.time>120)this.states.delete(id);
    this.seen=time;this.current=[...found].map(id=>this.states.get(id)).filter(Boolean);
    for(const [id,state] of this.states)if(!found.has(id))this.current.push(state);
    return this.current;
  }
  sample(time){
    const result=[];
    for(const s of this.current){
      const age=Math.max(0,time-s.time);if(age>=300)continue;
      const horizon=clamp((time-s.captured)/1000+.012,0,.075);
      const distance=Math.hypot(s.vx,s.vy)*horizon,limit=Math.min(1,.16/Math.max(distance,.001));
      const tx=s.x+s.vx*horizon*limit,ty=s.y+s.vy*horizon*limit;
      const dt=clamp((time-s.renderAt)/1000,0,.1),a=1-Math.exp(-dt/.009);
      // A new observation at the same timestamp must still be reflected immediately.
      if(time===s.time){s.renderX=tx;s.renderY=ty;}else{s.renderX+=(tx-s.renderX)*a;s.renderY+=(ty-s.renderY)*a;}
      s.renderAt=time;
      result.push({...s,x:s.renderX,y:s.renderY,strength:s.strength*clamp((300-age)/125,0,1)});
    }
    return result;
  }
  clear(){this.states.clear();this.current=[];this.seen=0;}
}

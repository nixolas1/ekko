import { openness, fingerGesture } from './gestures.js';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const FINGER=['point','wand','vortex'];
// Signed force of each finger gesture; fist/open palm keep the openness-scaled 12..18.
const TARGET={point:0,wand:14,vortex:16};
const DEFAULTS={
  enter:180,            // ms a point, pinch or vortex must hold before activation
  exit:100,             // ms to leave a finger gesture
  weightTau:.03,        // s; gesture weights settle in ~100 ms
};
// Stable hand identities, adaptive sample filtering and bounded latency compensation.
// sample() runs at display cadence, smoothly approaching a short predicted endpoint.
// Finger gestures are debounced per hand; the filtered/predicted position always follows
// the palm, and fingertip anchors are blended on top by gesture weight, so anchor changes
// never show up as velocity.
export class HandForces {
  constructor(options={}){this.options={...DEFAULTS,...options};this.states=new Map();this.current=[];this.seen=0;}
  update(data,time,mapPoint){
    const o=this.options,aspect=data.aspect||1;
    const captured=Number.isFinite(data.timestamp)?Math.min(time,data.timestamp):time;
    const found=new Set();
    (data.hands||[]).forEach((hand,index)=>{
      const id=data.handIds?.[index]??index;
      const shape=fingerGesture(hand,aspect);if(!shape)return;
      const [x,y]=mapPoint(hand[9]);if(!Number.isFinite(x)||!Number.isFinite(y))return;
      found.add(id);
      // A state past the 120 ms expiry is stale even if no empty update has removed it yet.
      let old=this.states.get(id);if(old&&time-old.time>120)old=undefined;
      const level=openness(hand,aspect);
      const dt=old?clamp((captured-old.captured)/1000,.008,.2):.05;
      const rawVx=old?clamp((x-old.rawX)/dt,-6,6):0,rawVy=old?clamp((y-old.rawY)/dt,-6,6):0;
      const speed=Math.hypot(rawVx,rawVy),alpha=1-Math.exp(-dt/(.018/(1+speed*3)));
      const px=old?old.x+(x-old.x)*alpha:x,py=old?old.y+(y-old.y)*alpha:y;
      // Stops and reversals damp the old prediction immediately instead of overshooting.
      const velocityAlpha=old&&(rawVx*old.vx+rawVy*old.vy<0||speed<.08)?1:1-Math.exp(-dt/.025);
      const vx=old?old.vx+(rawVx-old.vx)*velocityAlpha:0,vy=old?old.vy+(rawVy-old.vy)*velocityAlpha:0;
      const open=old?old.open+(level-old.open)*(1-Math.exp(-dt/.035)):level;
      const mode=open<.38?1:open>.62?-1:(old?.mode??1);
      // Fingertip anchors relative to the raw palm, refreshed only while that count is visible.
      const anchor=1-Math.exp(-dt/.02),tip=i=>mapPoint(hand[i]);
      let {pointDX=0,pointDY=0,wandDX=0,wandDY=0,vortexDX=0,vortexDY=0,vortexRadius=.4}=old||{};
      if(shape.gesture==='point'){const [tx,ty]=tip(8);const a=old?.pointSeen?anchor:1;pointDX+=(tx-x-pointDX)*a;pointDY+=(ty-y-pointDY)*a;}
      if(shape.gesture==='wand'){const [ax,ay]=tip(4),[bx,by]=tip(8);const a=old?.wandSeen?anchor:1;wandDX+=((ax+bx)/2-x-wandDX)*a;wandDY+=((ay+by)/2-y-wandDY)*a;}
      if(shape.gesture==='vortex'){const [ax,ay]=tip(shape.tips[0]),[bx,by]=tip(shape.tips[1]);if([ax,ay,bx,by].every(Number.isFinite)){
        const a=old?.vortexSeen?anchor:1,radius=clamp(Math.hypot(ax-bx,ay-by)*1.8,.22,.8);
        vortexDX+=((ax+bx)/2-x-vortexDX)*a;vortexDY+=((ay+by)/2-y-vortexDY)*a;vortexRadius+=(radius-vortexRadius)*(old?.vortexSeen?1-Math.exp(-dt/.05):1);}}
      // Debounce per hand; unsupported poses settle to no force.
      let {candidate=shape.gesture,since=captured,stable=null}=old||{};
      if(old&&shape.gesture!==candidate){candidate=shape.gesture;since=captured;}
      if(candidate!==stable&&captured-since>=(FINGER.includes(candidate)?o.enter:o.exit))stable=candidate;
      this.states.set(id,{id,x:px,y:py,rawX:x,rawY:y,vx,vy,open,mode,palmStrength:mode*(12+Math.abs(open-.5)*12),captured,time,
        renderX:old?.renderX??px,renderY:old?.renderY??py,renderAt:old?.renderAt??time,
        fingers:shape.count,candidate,since,stable,pointDX,pointDY,wandDX,wandDY,vortexDX,vortexDY,vortexRadius,
        pointSeen:old?.pointSeen||shape.gesture==='point',wandSeen:old?.wandSeen||shape.gesture==='wand',vortexSeen:old?.vortexSeen||shape.gesture==='vortex',
        wandWeight:old?.wandWeight??0,vortexWeight:old?.vortexWeight??0,pointWeight:old?.pointWeight??0,weightAt:old?.weightAt??time});
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
      // Each weight approaches 1 (active gesture) or 0, so their sum never exceeds 1.
      const k=1-Math.exp(-Math.max(0,time-s.weightAt)/1000/this.options.weightTau);s.weightAt=Math.max(s.weightAt,time);
      for(const g of FINGER)s[g+'Weight']+=((s.stable===g?1:0)-s[g+'Weight'])*k;
      const wand=s.wandWeight,vortex=s.vortexWeight,point=s.pointWeight,rest=Math.max(0,1-wand-vortex-point);
      const finger=FINGER.includes(s.stable),gesture=finger?s.stable:s.stable==='none'?'none':s.mode>0?'pull':'push';
      const palmActive=s.stable==='fist'||s.stable==='open'||!s.stable&&['fist','open'].includes(s.candidate);
      const strength=(palmActive?s.palmStrength:0)*rest+TARGET.wand*wand+TARGET.vortex*vortex;
      result.push({...s,x:s.renderX+point*s.pointDX+wand*s.wandDX+vortex*s.vortexDX,y:s.renderY+point*s.pointDY+wand*s.wandDY+vortex*s.vortexDY,
        mode:finger?Math.sign(TARGET[gesture]):s.mode,gesture,wand,vortex,point:point*clamp((300-age)/125,0,1),vortexRadius:s.vortexRadius,
        strength:strength*clamp((300-age)/125,0,1)});
    }
    return result;
  }
  clear(){this.states.clear();this.current=[];this.seen=0;}
}

// Negative radius marks a cursor obstacle in the shared GPU force buffer.
// Each pointing hand gets its own obstacle, independent of the mouse cursor.
export function handForce(hand,persistent,pullPower,pushPower){
  if(hand.gesture==='point')return [hand.x,hand.y,(hand.point||0)*pushPower,-.18,0,0,hand.id,0,0];
  const wand=hand.wand||0,vortex=hand.vortex||0;
  const radius=(persistent?.95:.65)*Math.max(0,1-wand-vortex)+.22*wand+(hand.vortexRadius||.35)*vortex;
  return [hand.x,hand.y,hand.strength*(hand.strength<0?pushPower:pullPower),radius,wand,vortex,hand.id,hand.vx,hand.vy];
}

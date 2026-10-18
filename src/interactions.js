import { openness, fingerGesture } from './gestures.js';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const FINGER=['wand','vortex','shockwave'];
// Signed force of each finger gesture; fist/open palm keep the openness-scaled 12..18.
const TARGET={wand:14,vortex:16,shockwave:-18};
const DEFAULTS={
  enter:180,            // ms a one/two/three-finger count must hold before its gesture starts
  exit:100,             // ms a fist/open palm must hold to leave a finger gesture
  cooldown:400,         // ms between shockwave bursts of one hand (re-arming also needs a held gesture)
  reacquire:1000,       // ms after a hand was last seen in shockwave during which a reacquired hand cannot burst
  reacquireDistance:.35,// world units around that spot (covers identity churn)
  burstStrength:1.2,
  weightTau:.03,        // s; gesture weights settle in ~100 ms
};
// Stable hand identities, adaptive sample filtering and bounded latency compensation.
// sample() runs at display cadence, smoothly approaching a short predicted endpoint.
// Finger gestures are debounced per hand; the filtered/predicted position always follows
// the palm, and fingertip anchors are blended on top by gesture weight, so anchor changes
// never show up as velocity.
export class HandForces {
  constructor(options={}){this.options={...DEFAULTS,...options};this.states=new Map();this.current=[];this.seen=0;this.bursts=[];this.memory=new Map();}
  update(data,time,mapPoint){
    const o=this.options,aspect=data.aspect||1;
    const captured=Number.isFinite(data.timestamp)?Math.min(time,data.timestamp):time;
    const found=new Set();
    for(const [id,m] of this.memory)if(captured-m.time>=o.reacquire)this.memory.delete(id);
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
      let {wandDX=0,wandDY=0,vortexDX=0,vortexDY=0,vortexRadius=.4}=old||{};
      if(shape.count===1){const [tx,ty]=tip(shape.tips[0]);if(Number.isFinite(tx)&&Number.isFinite(ty)){const a=old?.wandSeen?anchor:1;wandDX+=(tx-x-wandDX)*a;wandDY+=(ty-y-wandDY)*a;}}
      if(shape.count===2){const [ax,ay]=tip(shape.tips[0]),[bx,by]=tip(shape.tips[1]);if([ax,ay,bx,by].every(Number.isFinite)){
        const a=old?.vortexSeen?anchor:1,radius=clamp(Math.hypot(ax-bx,ay-by)*1.8,.22,.8);
        vortexDX+=((ax+bx)/2-x-vortexDX)*a;vortexDY+=((ay+by)/2-y-vortexDY)*a;vortexRadius+=(radius-vortexRadius)*(old?.vortexSeen?1-Math.exp(-dt/.05):1);}}
      // Debounce: a raw class becomes the stable gesture only after holding steadily.
      // `armed` allows one shockwave burst; it is set by a held fist/wand/vortex (raising
      // three fingers), not by an open palm (a flaky pinky), and is consumed by the burst.
      let {candidate=shape.gesture,since=captured,stable=null,lastBurst=-Infinity}=old||{};
      let armed=old?old.armed:!this.#recentShock(id,x,y,captured,time);
      if(old&&shape.gesture!==candidate){candidate=shape.gesture;since=captured;}
      const held=captured-since;
      if(candidate!==stable&&held>=(FINGER.includes(candidate)?o.enter:o.exit)){
        if(candidate==='shockwave'&&armed&&captured-lastBurst>=o.cooldown){this.bursts.push({x,y,id,strength:o.burstStrength});lastBurst=captured;}
        if(candidate==='shockwave')armed=false;
        stable=candidate;
      }
      if(stable==='open')armed=false;
      else if(stable&&stable!=='shockwave'&&candidate===stable&&held>=o.enter)armed=true;
      if(stable==='shockwave')this.memory.set(id,{x,y,time:captured});
      this.states.set(id,{id,x:px,y:py,rawX:x,rawY:y,vx,vy,open,mode,palmStrength:mode*(12+Math.abs(open-.5)*12),captured,time,
        renderX:old?.renderX??px,renderY:old?.renderY??py,renderAt:old?.renderAt??time,
        fingers:shape.count,candidate,since,stable,armed,lastBurst,wandDX,wandDY,vortexDX,vortexDY,vortexRadius,
        wandSeen:old?.wandSeen||shape.count===1,vortexSeen:old?.vortexSeen||shape.count===2,
        wandWeight:old?.wandWeight??0,vortexWeight:old?.vortexWeight??0,shockwaveWeight:old?.shockwaveWeight??0,weightAt:old?.weightAt??time});
    });
    for(const [id,state] of this.states)if(!found.has(id)&&time-state.time>120)this.states.delete(id);
    this.seen=time;this.current=[...found].map(id=>this.states.get(id)).filter(Boolean);
    for(const [id,state] of this.states)if(!found.has(id))this.current.push(state);
    return this.current;
  }
  // A newly created hand state near (or with the id of) a hand recently held in shockwave is
  // an occlusion/reacquire, not a deliberate raise. A different hand that is still tracked
  // is not churn, so a second hand raised beside it can still burst.
  #recentShock(id,x,y,captured,time){
    const live=key=>time-(this.states.get(key)?.time??-Infinity)<=120;
    for(const [key,m] of this.memory)if(captured-m.time<this.options.reacquire&&(key===id||!live(key)&&Math.hypot(m.x-x,m.y-y)<this.options.reacquireDistance))return true;
    return false;
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
      const wand=s.wandWeight,vortex=s.vortexWeight,shockwave=s.shockwaveWeight,rest=Math.max(0,1-wand-vortex-shockwave);
      const finger=FINGER.includes(s.stable),gesture=finger?s.stable:s.mode>0?'pull':'push';
      const strength=s.palmStrength*rest+TARGET.wand*wand+TARGET.vortex*vortex+TARGET.shockwave*shockwave;
      result.push({...s,x:s.renderX+wand*s.wandDX+vortex*s.vortexDX,y:s.renderY+wand*s.wandDY+vortex*s.vortexDY,
        mode:finger?Math.sign(TARGET[gesture]):s.mode,gesture,wand,vortex,shockwave,vortexRadius:s.vortexRadius,
        strength:strength*clamp((300-age)/125,0,1)});
    }
    return result;
  }
  // World-space shockwave entries since the last call, each delivered exactly once.
  drainBursts(){const bursts=this.bursts;this.bursts=[];return bursts;}
  clear(){this.states.clear();this.current=[];this.seen=0;this.bursts=[];this.memory.clear();}
}

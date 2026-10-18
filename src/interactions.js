import {clampPointSize} from './force-controls.js';
import { HandMotion } from './motion.js';
import { openness, fingerGesture } from './gestures.js';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const FINGER=['point','wand','vortex'];
// Signed force of each finger gesture; fist/open palm keep the openness-scaled 12..18.
const TARGET={point:0,wand:14,vortex:16};
const expires=s=>Math.min(s.time+Math.max(300,s.motion.motion.interval*3),s.missingAt==null?Infinity:s.missingAt+300);
const DEFAULTS={
  enter:180,            // ms a point, pinch or vortex must hold before activation
  exit:100,             // ms to leave a finger gesture
  weightTau:.03,        // s; gesture weights settle in ~100 ms
};
// Classify real observations; sample one shared, rotation-aware trajectory for
// both the visible hand and its interaction anchor at display cadence.
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
      let old=this.states.get(id);
      if(old?.missingAt!=null&&time-old.missingAt>=300)old=undefined;
      if(old&&captured<=old.captured)return;
      const motion=old?.motion||new HandMotion();motion.update(hand,time,aspect,captured);
      const level=openness(hand,aspect);
      const dt=old?Math.max((captured-old.captured)/1000,.008):.05;
      const rawVx=old?clamp((x-old.rawX)/dt,-6,6):0,rawVy=old?clamp((y-old.rawY)/dt,-6,6):0;
      const speed=Math.hypot(rawVx,rawVy);
      // Physical velocity remains based on observed palm movement, so gesture
      // anchors and visual prediction cannot inject artificial force impulses.
      const velocityAlpha=old&&(rawVx*old.vx+rawVy*old.vy<0||speed<.08)?1:1-Math.exp(-dt/.025);
      const vx=old?old.vx+(rawVx-old.vx)*velocityAlpha:0,vy=old?old.vy+(rawVy-old.vy)*velocityAlpha:0;
      const open=old?old.open+(level-old.open)*(1-Math.exp(-dt/.035)):level;
      const mode=open<.38?1:open>.62?-1:(old?.mode??1);
      let vortexRadius=old?.vortexRadius??.4;
      if(shape.gesture==='vortex'){
        const [ax,ay]=mapPoint(hand[shape.tips[0]]),[bx,by]=mapPoint(hand[shape.tips[1]]);
        const radius=clamp(Math.hypot(ax-bx,ay-by)*1.8,.22,.8);
        vortexRadius+=(radius-vortexRadius)*(old?1-Math.exp(-dt/.05):1);
      }
      // Debounce per hand; unsupported poses settle to no force.
      let {candidate=shape.gesture,since=captured,stable=null}=old||{};
      if(old&&shape.gesture!==candidate){candidate=shape.gesture;since=captured;}
      if(candidate!==stable&&captured-since>=(FINGER.includes(candidate)?o.enter:o.exit))stable=candidate;
      this.states.set(id,{id,motion,mapPoint,missingAt:null,x,y,rawX:x,rawY:y,vx,vy,open,mode,palmStrength:mode*(12+Math.abs(open-.5)*12),captured,time,
        renderX:old?.renderX??x,renderY:old?.renderY??y,renderAt:old?.renderAt??time,
        vortexTips:shape.gesture==='vortex'?shape.tips:old?.vortexTips||[8,12],fingers:shape.count,candidate,since,stable,vortexRadius,
        wandWeight:old?.wandWeight??0,vortexWeight:old?.vortexWeight??0,pointWeight:old?.pointWeight??0,weightAt:old?.weightAt??time});
    });
    for(const [id,state] of this.states)if(!found.has(id)){
      state.missingAt??=time;
      if(time>=expires(state))this.states.delete(id);
    }
    this.seen=time;this.current=[...found].map(id=>this.states.get(id)).filter(Boolean);
    for(const [id,state] of this.states)if(!found.has(id))this.current.push(state);
    return this.current;
  }
  sample(time){
    const result=[];
    for(const s of this.current){
      const remaining=expires(s)-time;if(remaining<=0)continue;
      const landmarks=s.motion.sample(time),palm=s.mapPoint(landmarks[9]);
      s.renderX=palm[0];s.renderY=palm[1];s.renderAt=time;
      const pointAnchor=s.mapPoint(landmarks[8]),thumb=s.mapPoint(landmarks[4]);
      const tips=s.vortexTips;
      const va=s.mapPoint(landmarks[tips[0]]),vb=s.mapPoint(landmarks[tips[1]]);
      const fade=clamp(remaining/125,0,1);
      // Each weight approaches 1 (active gesture) or 0, so their sum never exceeds 1.
      const k=1-Math.exp(-Math.max(0,time-s.weightAt)/1000/this.options.weightTau);s.weightAt=Math.max(s.weightAt,time);
      for(const g of FINGER)s[g+'Weight']+=((s.stable===g?1:0)-s[g+'Weight'])*k;
      const wand=s.wandWeight,vortex=s.vortexWeight,point=s.pointWeight,rest=Math.max(0,1-wand-vortex-point);
      const finger=FINGER.includes(s.stable),gesture=finger?s.stable:s.stable==='none'?'none':s.mode>0?'pull':'push';
      const palmActive=s.stable==='fist'||s.stable==='open'||!s.stable&&['fist','open'].includes(s.candidate);
      const strength=(palmActive?s.palmStrength:0)*rest+TARGET.wand*wand+TARGET.vortex*vortex;
      result.push({...s,x:s.renderX+point*(pointAnchor[0]-palm[0])+wand*((thumb[0]+pointAnchor[0])/2-palm[0])+vortex*((va[0]+vb[0])/2-palm[0]),y:s.renderY+point*(pointAnchor[1]-palm[1])+wand*((thumb[1]+pointAnchor[1])/2-palm[1])+vortex*((va[1]+vb[1])/2-palm[1]),
        mode:finger?Math.sign(TARGET[gesture]):s.mode,gesture,wand,vortex,point:point*fade,vortexRadius:s.vortexRadius,
        strength:strength*fade});
    }
    return result;
  }
  clear(){this.states.clear();this.current=[];this.seen=0;}
}

// Negative radius marks a cursor obstacle in the shared GPU force buffer.
// Each pointing hand gets its own obstacle, independent of the mouse cursor.
export function handForce(hand,persistent,pullPower,pushPower,pointSize=1){
  if(hand.gesture==='point')return [hand.x,hand.y,(hand.point||0)*pushPower,-.18*clampPointSize(pointSize),0,0,hand.id,0,0];
  const wand=hand.wand||0,vortex=hand.vortex||0;
  const radius=(persistent?.95:.65)*Math.max(0,1-wand-vortex)+.22*wand+(hand.vortexRadius||.35)*vortex;
  return [hand.x,hand.y,hand.strength*(hand.strength<0?pushPower:pullPower),radius,wand,vortex,hand.id,hand.vx,hand.vy];
}

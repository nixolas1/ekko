import test from 'node:test';
import assert from 'node:assert/strict';
import {MotionTrack,HandMotion} from '../src/motion.js';
import {HandForces} from '../src/interactions.js';
import {GestureTracker} from '../src/gestures.js';
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const close=(a,b,eps=1e-8)=>assert(distance(a,b)<eps,`${a} != ${b}`);
import {hand} from './motion-fixtures.js';

test('sparse and irregular observations never jump at arrival and animate between them',()=>{
 for(const gaps of [[16,16,16],[33,40,25],[100,300,80],[500,500,500],[1000,1000,1000]]){
  const m=new MotionTrack();m.update([0,0],0);let t=0;
  gaps.forEach((gap,i)=>{
   t+=gap;const before=m.sample(t).position;m.update([i+1,(i+1)*.2],t);
   close(m.sample(t).position,before);
   const frames=Array.from({length:8},(_,n)=>m.sample(t+(n+1)*gap/10).position);
   assert(frames.every(p=>p.every(Number.isFinite)));
   assert(distance(frames[0],frames[7])>.01);
  });
 }
});

test('circle prediction preserves curvature and reduces error versus smoothing alone',()=>{
 for(const interval of [16,33,100]){
  const predictive=new MotionTrack(),plain=new MotionTrack({predict:false});let a=0,b=0;
  for(let t=0;t<4000;t++){
   const real=[.5*Math.cos(t/800),.5*Math.sin(t/800)];
   if(t%interval===0){predictive.update(real,t);plain.update(real,t);}
   if(t>1000){const p=predictive.sample(t).position;a+=distance(p,real);b+=distance(plain.sample(t).position,real);
    assert(Math.abs(Math.hypot(...p)-.5)<.004,'circle must not shrink into chords or spiral outward');}
  }
  assert(a<b*.6,`${interval} ms input: predicted ${a}, plain ${b}`);
 }
});

test('stops, reversals and long stalls have bounded prediction and settle',()=>{
 const m=new MotionTrack();for(let t=0;t<=200;t+=20)m.update([t*.001,0],t);
 assert(distance(m.sample(10000).position,[.2,0])<=.120001);
 close(m.sample(2000).position,m.sample(10000).position);
 let before=m.sample(220).position;m.update([.2,0],220);close(m.sample(220).position,before);
 close(m.sample(400).position,[.2,0]);assert.deepEqual(m.velocity,[0,0]);
 before=m.sample(420).position;m.update([-.2,0],420);close(m.sample(420).position,before);
 for(let t=420;t<700;t++)assert(Math.abs(m.sample(t).position[0])<=.21);
 close(m.sample(1000).position,[-.2,0]);
});

test('display sampling cadence cannot change the trajectory; stale input is ignored',()=>{
 const a=new MotionTrack(),b=new MotionTrack();
 for(let t=0;t<=200;t+=25){a.update([t*.001,Math.sin(t/200)],t);b.update([t*.001,Math.sin(t/200)],t);
  for(let frame=t;frame<t+25;frame+=4)a.sample(frame);
  close(a.sample(t+24).position,b.sample(t+24).position);}
 const before=a.sample(230).position;
 a.update([99,99],100);a.update([NaN,0],240);a.update([99,99],240,100);close(a.sample(230).position,before);
 a.clear();assert.equal(a.sample(300),null);a.update([5,6],400);close(a.sample(400).position,[5,6]);
});

test('rotating the palm preserves shape and takes the short route across the angle wrap',()=>{
 const m=new HandMotion();m.update(hand(.5,Math.PI-.1),0);
 const origin=m.sample(0),lengths=origin.map(p=>Math.hypot(p.x-origin[9].x,p.y-origin[9].y));
 m.update(hand(.5,-Math.PI+.1),100);
 for(let t=100;t<=200;t+=5){const points=m.sample(t);
  points.forEach((p,i)=>assert(Math.abs(Math.hypot(p.x-points[9].x,p.y-points[9].y)-lengths[i])<1e-8));
  assert(distance([points[0].x,points[0].y],[origin[0].x,origin[0].y])<.05);
 }
 // A rigid hand turning in place has angular prediction even with no translation.
 const turn=new HandMotion();for(let t=0;t<=200;t+=25)turn.update(hand(.5,t*.001),t);
 assert(turn.motion.velocity[2]>0);
});

test('slow hand streams keep motion and identity; explicit loss still expires',()=>{
 const forces=new HandForces(),tracker=new GestureTracker(),map=p=>[p.x,p.y];
 let id;
 for(let t=0;t<=4000;t+=1000){const points=hand(.5+t*.00001);tracker.update([points],t,1,1000);
  if(t>=1000)assert.equal(tracker.ids[0],id);id=tracker.ids[0];
  const before=forces.states.get(id)?.motion.sample(t);
  forces.update({hands:[points],handIds:[id],timestamp:t},t,map);
  if(before)close(forces.states.get(id).motion.sample(t).flatMap(p=>[p.x,p.y]),before.flatMap(p=>[p.x,p.y]));
  if(t>=2000)assert.equal(forces.sample(t+900).length,1);
 }
 forces.update({hands:[]},4100,map);assert.deepEqual(forces.sample(4401),[]);
});


test('high-frequency coalesced cursor samples retain prediction without amplifying noise',()=>{
 const m=new MotionTrack({maxPrediction:24});
 for(let t=0;t<50;t++)m.update([t*.2,t*.1],t);
 assert(m.velocity[0]>0&&m.velocity[1]>0);
 assert(distance(m.sample(60).position,[12,6])<3);
});

test('camera capture timestamps compensate processing latency within the prediction bound',()=>{
 const m=new MotionTrack();
 for(let t=0;t<=300;t+=25)m.update([t*.001,0],t+35,t);
 const displayed=m.sample(345).position;
 assert(Math.abs(displayed[0]-.345)<.015,`displayed ${displayed[0]} should follow the current trajectory`);
 assert(distance(m.sample(10000).position,[.3,0])<=.120001);
});

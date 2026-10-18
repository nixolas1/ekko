import test from 'node:test';import assert from 'node:assert/strict';import { HandForces } from '../src/interactions.js';
const hand=(x,open)=>Array.from({length:21},(_,i)=>{if(i===0)return{x,y:.8,z:0};if(i===9)return{x,y:.6,z:0};if([8,12,16,20].includes(i))return{x,y:open?.3:.75,z:0};if([6,10,14,18].includes(i))return{x,y:.6,z:0};return{x:x+.02,y:.65,z:0};});
const map=p=>[1-2*p.x,1-2*p.y];
test('two simultaneous hands independently attract and repel and keep identity when reordered',()=>{const f=new HandForces();f.update({hands:[hand(.2,false),hand(.8,true)],handIds:[4,9],aspect:1},100,map);assert(f.sample(100)[0].strength>0);assert(f.sample(100)[1].strength<0);f.update({hands:[hand(.79,true),hand(.21,false)],handIds:[9,4],aspect:1},150,map);assert.equal(f.sample(150)[0].id,9);assert(f.sample(150)[0].strength<0);assert(f.sample(150)[1].strength>0);});
test('opening switches to sustained repulsion promptly, then disappears when lost',()=>{const f=new HandForces();f.update({hands:[hand(.5,false)],handIds:[1]},100,map);f.update({hands:[hand(.5,true)],handIds:[1]},170,map);assert(f.sample(170)[0].strength<0);f.update({hands:[hand(.5,true)],handIds:[1]},240,map);assert(f.sample(240)[0].strength<0);assert.deepEqual(f.sample(541),[]);f.update({hands:[],handIds:[]},550,map);assert.equal(f.states.size,0);});
test('position follows mirrored movement quickly and generates finite bounded velocity',()=>{const f=new HandForces();f.update({hands:[hand(.2,false)],handIds:[1]},100,map);f.update({hands:[hand(.4,false)],handIds:[1]},150,map);const before=f.sample(150)[0];assert.equal(before.x,.6);const s=f.sample(200)[0];assert(s.x<.3);assert(s.vx<0);assert(Math.abs(s.vx)<=6);f.clear();assert.deepEqual(f.sample(160),[]);});
test('prediction advances a moving hand between observations but stays bounded and stops on a stationary sample',()=>{
  const f=new HandForces();f.update({hands:[hand(.6,false)],handIds:[1],timestamp:50},100,map);
  f.update({hands:[hand(.5,false)],handIds:[1],timestamp:100},150,map);
  const start=f.sample(150)[0],next=f.sample(180)[0];
  assert(next.x>=start.x);assert(next.x-f.states.get(1).x<=.161);
  f.update({hands:[hand(.5,false)],handIds:[1],timestamp:150},200,map);
  assert.equal(f.sample(200)[0].vx,0);assert.equal(f.sample(200)[0].vy,0);
});
test('brief detection loss is bridged, then force fades and expires without drifting indefinitely',()=>{
  const f=new HandForces();f.update({hands:[hand(.5,false)],handIds:[1]},100,map);
  f.update({hands:[],handIds:[]},150,map);assert.equal(f.sample(150).length,1);
  assert(f.sample(330)[0].strength<f.sample(150)[0].strength);
  assert.deepEqual(f.sample(401),[]);
});

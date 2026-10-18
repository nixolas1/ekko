import test from 'node:test';
import assert from 'node:assert/strict';
import {Emitters} from '../src/emitters.js';
import {settingsFromURL,settingsURL} from '../src/url-settings.js';
const hand=(id,x=0,y=0,aim=[1,0])=>({id,x,y,gesture:'point',emitDirection:aim});
test('gesture-relative depth controls each source independently; mouse power stays neutral',()=>{
 const e=new Emitters();
 const near={...hand(2),pointDepthScale:4},far={...hand(4),pointDepthScale:.25};
 for(const hands of [[near,far],[far,near]]){
  const sources=e.sample(hands,{active:true,x:0,y:0},100);
  assert.deepEqual(sources.map(s=>[s.id,s.power]),[[2,4],[4,.25],[-1,1]]);
 }
 for(const [value,wanted] of [[undefined,1],[NaN,1],[Infinity,1],[-5,.25],[10,4]]){
  assert.equal(e.sample([{...hand(2),pointDepthScale:value}],null,200)[0].power,wanted);
 }
});
test('sources span bass through treble, keeping identities when hands cross',()=>{
 const e=new Emitters();
 assert.deepEqual(e.sample([hand(2)],null,0).map(s=>s.band),[0]);
 const two=e.sample([hand(4),hand(2)],null,20);
 assert.deepEqual(two.map(s=>[s.id,s.band]),[[2,0],[4,.5]]);
 assert.deepEqual(e.sample([hand(4,-1),hand(2,1)],null,40).map(s=>[s.id,s.band]),[[2,0],[4,.5]]);
 assert.deepEqual(e.sample([hand(4),hand(2)],{active:true,x:0,y:0},60).map(s=>[s.id,s.band]),[[2,0],[4,.5],[-1,1]]);
 assert.deepEqual(e.sample(Array.from({length:8},(_,i)=>hand(i)),{active:true,x:0,y:0},80).map(s=>s.band),[0,.125,.25,.375,.5,.625,.75,.875,1]);
 assert.equal(e.sample([],null,100).length,0);assert.equal(e.states.size,0);
});
test('cursor keeps its aim while stationary, resets after leaving, ignores tiny jitter',()=>{
 const e=new Emitters(),pointer=(x,y)=>({x,y,active:true});
 assert.deepEqual(e.sample([],pointer(0,0),0)[0].direction,[0,1]);
 const aimed=e.sample([],pointer(.3,0),500)[0].direction;
 assert(aimed[0]>.99);
 assert.deepEqual(e.sample([],pointer(.301,0),600)[0].direction,aimed);
 assert.deepEqual(e.sample([],pointer(.301,0),700)[0].direction,aimed);
 e.sample([],null,800);assert.deepEqual(e.sample([],pointer(.3,0),900)[0].direction,[0,1]);
});
test('hand aiming uses normalized screen-space finger direction with safe foreshortening',()=>{
 const e=new Emitters();assert.deepEqual(e.sample([hand(1,0,0,[0,-.1])],null,0)[0].direction,[Math.cos(-Math.PI/2),-1]);
 const source=e.sample([hand(1,0,0,[0,0])],null,100)[0];assert(source.direction[1]<-.99);
});
test('new mode and tuning survive share link round-trip',()=>{
 const s=settingsFromURL('https://example.com/?mode=hand-fire&glow=2&emission=1.5');
 assert.equal(s.physicsMode,'hand-fire');assert.equal(s.modeSettings['hand-fire'].glow,2);
 assert.deepEqual(settingsFromURL(settingsURL('https://example.com/',s)).modeSettings['hand-fire'],s.modeSettings['hand-fire']);
});

test('only pointing hands and a hovering mouse emit; all other gestures stop their sources',()=>{
 const e=new Emitters();
 for(const gesture of ['pull','push','wand','vortex','none'])assert.equal(e.sample([{...hand(1),gesture}],null,0).length,0);
 assert.equal(e.sample([hand(1)],null,100).length,1);
 assert.equal(e.sample([{...hand(1),gesture:'wand'}],null,200).length,0);
 assert.equal(e.sample([],{active:true,held:true,x:0,y:0},300).length,0);
 assert.equal(e.sample([],{active:false,x:0,y:0},400).length,0);
});

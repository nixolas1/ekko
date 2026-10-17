import test from 'node:test';
import assert from 'node:assert/strict';
import {WingFlaps,FlightWorld} from '../src/flight.js';
test('a raised then lowered hand pair makes one flap; tracking reacquisition does not',()=>{
 const w=new WingFlaps(),hands=y=>[{id:1,y},{id:2,y:y+.01}];
 assert.equal(w.update(hands(0),1/30),false);
 assert.equal(w.update(hands(.15),1/30),false);
 assert.equal(w.update(hands(.23),1/30),false);
 assert.equal(w.update(hands(.13),1/30),true);
 for(let i=0;i<20;i++)assert.equal(w.update(hands(.13),1/30),false);
 w.update([],1/30);assert.equal(w.update(hands(-.6),1/30),false);
});
test('flight waits for a flap, gains altitude then falls; roofs and oncoming birds collide',()=>{
 const w=new FlightWorld(()=>.5);w.update(.03);assert.equal(w.y,.42);assert.equal(w.distance,0);
 assert(w.flap());const y=w.y;for(let i=0;i<10;i++)w.update(1/60);assert(w.y<y);assert(w.distance>0);
 w.buildings=[{x:.3,w:.3,h:.65}];w.y=.6;w.update(1/60,1.5);assert(w.crash>0);
 for(let i=0;i<90;i++)w.update(1/60);assert.equal(w.started,false);assert.equal(w.distance,0);
 w.flap();w.birds=[{x:1.5*.27,y:w.y,phase:-w.time*2}];w.update(1/60,1.5);assert(w.crash>0);
});
test('flap cooldown prevents key repeat from producing unbounded lift',()=>{const w=new FlightWorld();assert(w.flap());assert.equal(w.flap(),false);assert.equal(w.vy,-.34);});

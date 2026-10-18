import test from 'node:test';import assert from 'node:assert/strict';import {mouseHandForce,MOUSE_HAND_ID} from '../src/mouse-hand.js';
const held={x:.3,y:-.4,active:true,held:true};

test('plain hold pushes like an open hand, Command-hold gathers like a fist',()=>{
 assert.deepEqual(mouseHandForce(held,false,1,1),[.3,-.4,-18,.65,0,0,-1,0,0]);
 assert.deepEqual(mouseHandForce({...held,metaKey:true},false,1,1),[.3,-.4,18,.65,0,0,-1,0,0]);
 assert.equal(mouseHandForce({...held,metaKey:false},false,2,.5)[2],-9,'push uses push power only');
 assert.equal(mouseHandForce({...held,metaKey:true},false,2,.5)[2],36,'pull uses pull power only');
});

test('hover, release and inactive pointers leave only the mouse obstacle',()=>{
 assert.equal(mouseHandForce({...held,held:false},false,1,1),null);
 assert.equal(mouseHandForce({...held,active:false},false,1,1),null);
 assert.equal(mouseHandForce({...held,metaKey:true,held:false},false,1,1),null);
 assert.equal(mouseHandForce(null,false,1,1),null);assert.equal(mouseHandForce(undefined,false,1,1),null);
});

test('invalid coordinates produce no force',()=>{
 for(const bad of [NaN,Infinity,-Infinity,undefined,'0.2',null]){
  assert.equal(mouseHandForce({...held,x:bad},false,1,1),null);assert.equal(mouseHandForce({...held,y:bad},false,1,1),null);
 }
});

test('powers clamp to 0..3, default to 1, and zero means no force',()=>{
 assert.equal(mouseHandForce(held,false,1,0)[2],-0);assert.equal(Math.abs(mouseHandForce({...held,metaKey:true},false,0,1)[2]),0);
 assert.equal(mouseHandForce(held,false,1,9)[2],-54);assert.equal(mouseHandForce({...held,metaKey:true},false,9,1)[2],54);
 assert.equal(Math.abs(mouseHandForce(held,false,1,-2)[2]),0);
 assert.equal(mouseHandForce(held,false)[2],-18);assert.equal(mouseHandForce({...held,metaKey:true},false,NaN)[2],18);
});

test('radius matches hands, id is the reserved mouse id and no motion is invented',()=>{
 assert.equal(mouseHandForce(held,true,1,1)[3],.95);assert.equal(mouseHandForce(held,false,1,1)[3],.65);
 const force=mouseHandForce({...held,vx:5,vy:-3,metaKey:true},true,1,1);
 assert.equal(force.length,9);assert.equal(MOUSE_HAND_ID,-1);assert.equal(force[6],-1);
 assert.deepEqual([force[4],force[5],force[7],force[8]],[0,0,0,0],'no wand, vortex or velocity');
});

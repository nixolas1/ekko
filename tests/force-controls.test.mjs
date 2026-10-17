import test from 'node:test';
import assert from 'node:assert/strict';
import {forceFromSlider,sliderFromForce,clampForce} from '../src/force-controls.js';
test('gentle force has fine slider control without losing the strong-force range',()=>{
 const p=sliderFromForce(.05);assert(p>200&&p<300);
 assert(forceFromSlider(p+1)-forceFromSlider(p)<.001);
 for(const force of [0,.005,.025,.05,.075,.1,.5,1,2,3])assert(Math.abs(forceFromSlider(sliderFromForce(force))-force)<1e-6);
 assert.equal(forceFromSlider(1000),3);assert.equal(forceFromSlider(0),0);
});
test('force inputs remain bounded',()=>{
 assert.equal(clampForce(-1),0);assert.equal(clampForce(10),3);assert.equal(clampForce(NaN),0);
});

import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {EMISSION_BANDS_HZ,RING_BANDS_HZ} from '../src/audio-controls.js';
// GPU behaviour is measured by tests/fluid.html ("Test smoke music response"); these
// checks guard the rising-smoke shader wiring that can be verified without WebGPU.
const shader=readFileSync(new URL('../src/fluid.wgsl',import.meta.url),'utf8');
const body=name=>{const start=shader.indexOf(`fn ${name}(`);assert(start>=0,`${name} missing`);return shader.slice(start,shader.indexOf('\n}',start));};

test('smoke lane attacks reuse the matching low ring bands',()=>{
 for(let i=0;i<4;i++)assert.deepEqual(RING_BANDS_HZ[i],EMISSION_BANDS_HZ[i]);
 assert.equal(RING_BANDS_HZ[4][0],EMISSION_BANDS_HZ[4][0]);
 assert.match(body('laneAttack'),/if\(i<5u\)\{return ringAttack\(i\);\}/);
});
test('silence keeps the gray baseline and no music jet',()=>{
 assert.match(body('laneStrength'),/if\(params\.simulation\.y<\.5\)\{return \.7;\}/);
 assert.match(body('laneJet'),/if\(params\.simulation\.y<\.5\)\{return vec2f\(0\);\}/);
});
test('lanes run bass-left to treble-right and bass gets the strongest kick',()=>{
 assert.match(body('laneX'),/\(f32\(i\)\/6\.0-\.5\)\*width\*2\.0/);
 assert.match(body('laneBass'),/select\(select\(1\.0,1\.6,i==1u\),2\.4,i==0u\)/);
 assert.match(body('laneJet'),/laneAttack\(i\)\*laneBass\(i\)/);
});
test('rising-smoke velocity applies the upward lane jet; the ring path is unchanged',()=>{
 const advect=body('advectVelocity');
 assert.match(advect,/if\(ringMode\(\)\)\{v\+=nozzleVelocity\(q\)\*params\.clock\.y;\}\s*else \{v \+= \(.*\*src\.a\+laneJet\(q\)\)\*params\.clock\.y;\}/);
 assert.doesNotMatch(body('nozzleVelocity'),/lane/);
});

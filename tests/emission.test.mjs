import test from 'node:test';
import assert from 'node:assert/strict';
import {emissionLevels,EMISSION_BANDS_HZ,bandRange} from '../src/audio-controls.js';
import {normalizeSettings} from '../src/preferences.js';

test('each isolated frequency band activates only its own emission lane',()=>{
 for(let lane=0;lane<7;lane++){
  const bins=new Uint8Array(512),[lo,hi]=bandRange(...EMISSION_BANDS_HZ[lane],48000,1024);
  bins.fill(255,lo,hi);
  const levels=emissionLevels(bins,48000);
  assert(levels[lane]>.9);
  levels.forEach((value,i)=>{if(i!==lane)assert.equal(value,0,`lane ${lane} leaked into ${i}`);});
 }
 assert.deepEqual([...emissionLevels(new Uint8Array(512),48000)],Array(7).fill(0));
});
test('three-million count and all seven palettes survive settings normalization',()=>{
 for(let palette=0;palette<7;palette++){
  const s=normalizeSettings({count:3145728,palette});assert.equal(s.count,3145728);assert.equal(s.palette,palette);
 }
});

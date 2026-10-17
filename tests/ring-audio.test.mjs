import test from 'node:test';import assert from 'node:assert/strict';
import {RING_BANDS_HZ,ringLevels,RingSpectrum,bandRange,ANALYSER} from '../src/audio-controls.js';
test('nine ring bands isolate ascending tones at 44.1, 48 and 96 kHz',()=>{
 for(const rate of [44100,48000,96000])for(let i=0;i<9;i++){
  const bins=new Uint8Array(ANALYSER.fftSize/2),[a,b]=bandRange(...RING_BANDS_HZ[i],rate,ANALYSER.fftSize);bins.fill(255,a,b);
  const levels=ringLevels(bins,rate);assert(levels[i]>.9);for(let j=0;j<9;j++)if(i!==j)assert.equal(levels[j],0,`${rate} band ${i} leaked into ${j}`);
 }
});
test('individual note attacks decay while a held note stays active; reset clears all bands',()=>{
 const r=new RingSpectrum(),bins=new Uint8Array(512);bins[2]=255;r.update(bins,48000,1024,1.2,1/60);
 assert(r.attacks[0]>.9);assert(r.levels[0]>.7);
 for(let i=0;i<120;i++)r.update(bins,48000,1024,1.2,1/60);
 assert(r.attacks[0]<.001);assert(r.levels[0]>.8);assert(r.levels.slice(1).every(x=>x===0));
 bins.fill(0);for(let i=0;i<60;i++)r.update(bins,48000,1024,1.2,1/60);assert(r.levels[0]<.001);
 r.reset();assert(r.levels.every(x=>x===0));assert(r.attacks.every(x=>x===0));
});

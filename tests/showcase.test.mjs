import test from 'node:test';
import assert from 'node:assert/strict';
import {SHOWCASE_CHAPTERS,ShowcaseTimeline,showcaseSample,showcaseHandPose} from '../src/showcase.js';
import {createShowcaseScore} from '../src/showcase-music.js';
import {fingerGesture} from '../src/gestures.js';
import {mouseHandForce} from '../src/mouse-hand.js';

test('tour visits every mode once, completes, and can repeat',()=>{
 const tour=new ShowcaseTimeline();tour.start();const visited=[tour.chapter.mode];
 for(let i=0;i<1900;i++){const event=tour.advance(.1);if(event.changed)visited.push(tour.chapter.mode);}
 assert.equal(new Set(visited).size,9);assert.equal(visited.length,9);assert(tour.complete);
 const end=tour.elapsed;tour.advance(.1);assert.equal(tour.elapsed,end);
 tour.loop=true;tour.seek(8);tour.elapsed=19.99;assert(tour.advance(.05).changed);assert.equal(tour.index,0);assert(!tour.complete);
});
test('pause, invalid time, stop and hidden-tab gaps cannot advance a lesson unexpectedly',()=>{
 const tour=new ShowcaseTimeline();tour.start();tour.paused=true;tour.advance(5);assert.equal(tour.elapsed,0);
 tour.paused=false;tour.advance(NaN);tour.advance(-1);assert.equal(tour.elapsed,0);
 tour.advance(30);assert.equal(tour.elapsed,.1);tour.stop();tour.advance(.1);assert.equal(tour.elapsed,.1);
});
test('gather release and shockwave fire once per crossing, including after replay',()=>{
 const tour=new ShowcaseTimeline();tour.start();
 for(const [index,time] of [[3,10],[8,9]]){
  tour.seek(index);tour.elapsed=time-.04;assert.equal(tour.advance(.05).bursts.length,1);assert.equal(tour.advance(.05).bursts.length,0);
  tour.seek(index);tour.elapsed=time-.04;assert.equal(tour.advance(.05).bursts.length,1);
 }
});
test('teaching poses are classified as the gestures they demonstrate',()=>{
 for(const [name,expected] of Object.entries({gather:'fist',push:'open',wand:'wand',vortex:'vortex',shockwave:'shockwave'})){
  assert.equal(fingerGesture(showcaseHandPose(name)).gesture,expected,name);
 }
});
test('displayed motion stays on screen and uses the real mouse force semantics',()=>{
 for(const aspect of [.46,1,16/9])for(const chapter of SHOWCASE_CHAPTERS)for(const time of [0,4,8,12,19]){
  const sample=showcaseSample(chapter,time,aspect);
  for(const point of [...sample.hands,...(sample.pointer?[sample.pointer]:[])]){assert(Number.isFinite(point.x));assert(Math.abs(point.x)<aspect);assert(Math.abs(point.y)<1);}
 }
 const cursor=SHOWCASE_CHAPTERS.find(c=>c.control==='cursor');
 assert(mouseHandForce(showcaseSample(cursor,5).pointer,false,1,1)[2]<0);
 assert(mouseHandForce(showcaseSample(cursor,12).pointer,false,1,1)[2]>0);
 assert.equal(mouseHandForce(showcaseSample(SHOWCASE_CHAPTERS[0],5).pointer,false,1,1),null);
});
test('built-in score is a valid non-silent PCM WAV with a quiet loop seam',async()=>{
 const file=createShowcaseScore(),data=new DataView(await file.arrayBuffer());
 assert.equal(file.type,'audio/wav');assert.equal(data.getUint32(4,true),file.size-8);
 assert.equal(data.getUint16(20,true),1);assert.equal(data.getUint16(22,true),1);assert.equal(data.getUint32(24,true),44100);assert.equal(data.getUint16(34,true),16);
 assert.equal(data.getUint32(40,true),file.size-44);
 let sum=0,peak=0;for(let i=44;i<data.byteLength;i+=2){const n=data.getInt16(i,true)/32768;sum+=n*n;peak=Math.max(peak,Math.abs(n));}
 assert(Math.sqrt(sum/((file.size-44)/2))>.05);assert(peak<.99);
 assert(Math.abs(data.getInt16(44,true))<100);assert(Math.abs(data.getInt16(data.byteLength-2,true))<100);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioInput} from '../src/audio.js';
import {requestTabAudio} from '../src/audio-controls.js';
import {normalizeSettings} from '../src/preferences.js';
import {settingsFromURL,settingsURL} from '../src/url-settings.js';

const track=kind=>({kind,readyState:'live',enabled:true,onended:null,stop(){this.readyState='ended';}});
class Stream {
  constructor(tracks=[track('audio'),track('video')]){this.tracks=tracks;}
  getTracks(){return this.tracks;}
  getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}
  getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}
}
function setup(){
  const originals=['navigator','AudioContext','MediaStream'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  class Node {constructor(){this.connected=[];this.gain={value:1};}connect(node){this.connected.push(node);}disconnect(){this.connected=[];}}
  class Context {
    constructor(){this.state='suspended';this.sampleRate=48000;this.destination=new Node();}
    createAnalyser(){const n=new Node();n.getByteFrequencyData=bins=>bins.fill(190);return n;}
    createGain(){return new Node();}
    createMediaStreamSource(stream){const n=new Node();n.stream=stream;return n;}
    async resume(){this.state='running';}
  }
  const stream=new Stream(),calls=[];
  const mediaDevices={getDisplayMedia(options){calls.push(options);return Promise.resolve(stream);}};
  for(const [key,value] of Object.entries({navigator:{mediaDevices},AudioContext:Context,MediaStream:Stream}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  return {stream,calls,mediaDevices,restore(){for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}};
}
test('tab capture opens picker synchronously, analyses real input, never duplicates playback, and releases both tracks',async()=>{
 const f=setup();try{
  const audio=new AudioInput(),pending=audio.tabAudio();
  assert.equal(f.calls.length,1,'picker must open before any await');
  assert.equal(f.calls[0].audio.suppressLocalAudioPlayback,false);
  assert.equal(f.calls[0].video.displaySurface,'browser');
  assert.equal(await pending,true);assert.equal(audio.mode,'tab');assert.equal(audio.synthetic,false);
  assert.deepEqual(audio.source.connected,[audio.analyser]);assert.equal(audio.mute.gain.value,0);
  assert.equal(audio.source.stream.getVideoTracks().length,0);
  assert.equal(f.calls[0].video.frameRate,1);
  for(let t=0;t<1;t+=1/60)audio.sample(t);
  assert(audio.bands.every(v=>v>0));assert(audio.ringSpectrum.levels.every(v=>v>0));
  audio.stop();assert(f.stream.getTracks().every(t=>t.readyState==='ended'));assert.equal(audio.mode,'demo');
 }finally{f.restore();}
});
test('missing audio cleans up capture and explains Share tab audio',async()=>{
 const stream=new Stream([track('video')]);
 await assert.rejects(requestTabAudio({getDisplayMedia:async()=>stream}),e=>e.code==='no-tab-audio'&&/Share tab audio/.test(e.message));
 assert.equal(stream.getTracks()[0].readyState,'ended');
});
test('unsupported capture and cancelled picker give actionable errors',async()=>{
 await assert.rejects(requestTabAudio({}),e=>e.code==='unsupported');
 await assert.rejects(requestTabAudio({getDisplayMedia:async()=>{throw Object.assign(new Error(),{name:'NotAllowedError'});}}),e=>e.code==='capture-cancelled');
});
test('a pending picker cannot resurrect capture after stop or a newer source selection',async()=>{
 const f=setup();try{
  let resolve;f.mediaDevices.getDisplayMedia=()=>new Promise(r=>resolve=r);
  const audio=new AudioInput(),pending=audio.tabAudio();audio.stop();resolve(f.stream);
  assert.equal(await pending,false);assert.equal(audio.stream,null);assert(f.stream.getTracks().every(t=>t.readyState==='ended'));
 }finally{f.restore();}
});
test('ending either capture track disconnects analysis and releases all remaining tracks',async()=>{
 for(const kind of ['audio','video']){
  const f=setup();try{
   const audio=new AudioInput();await audio.tabAudio();const reasons=[];audio.onchange=(mode,reason)=>reasons.push(reason);
   f.stream.getTracks().find(t=>t.kind===kind).onended();
   assert.equal(audio.mode,'demo');assert.equal(audio.stream,null);assert.match(reasons[0],/sharing ended/);
   assert(f.stream.getTracks().every(t=>t.readyState==='ended'));
  }finally{f.restore();}
 }
});
test('context or source setup failure does not leak granted capture',async()=>{
 const f=setup();try{
  const audio=new AudioInput();audio.context=async()=>{throw new Error('audio unavailable');};
  await assert.rejects(audio.tabAudio(),/audio unavailable/);
  assert(f.stream.getTracks().every(t=>t.readyState==='ended'));assert.equal(audio.stream,null);
 }finally{f.restore();}
});
test('tab preference and share link restore selection only, never playing state',()=>{
 const saved=normalizeSettings({audio:{kind:'tab',playing:true}});assert.equal(saved.audio.kind,'tab');assert.equal(saved.audio.playing,false);
 const parsed=settingsFromURL(settingsURL('https://example.test',saved));assert.equal(parsed.audio.kind,'tab');assert.equal(parsed.audio.playing,false);
});

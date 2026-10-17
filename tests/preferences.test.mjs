import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeSettings,loadSettings,saveSettings,SETTINGS_KEY} from '../src/preferences.js';
test('settings and exact music playhead round-trip; invalid values cannot corrupt GPU settings',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const settings={count:1048576,autoCount:true,resolution:'native',pullPower:1.4,pushPower:1.4,maxHands:2,palette:2,effect:3,persistent:true,physicsMode:'ring',gain:2.1,paused:null,immersive:true,audio:{kind:'reference',track:'mitis-wilderness',position:81.375,playing:false,name:'MitiS'}};
 assert(saveSettings(settings,storage));assert.deepEqual(loadSettings(storage),normalizeSettings(settings));
 values.set(SETTINGS_KEY,'{bad');assert.equal(loadSettings(storage).count,524288);
 const invalid=normalizeSettings({count:1e9,gain:Infinity,audio:{position:-100,kind:'untrusted'}});
 assert.equal(invalid.count,524288);assert.equal(invalid.audio.position,0);assert.equal(invalid.audio.kind,'demo');
});
test('blocked browser storage leaves the visualizer usable',()=>{const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};assert.equal(loadSettings(blocked).persistent,true);assert.equal(saveSettings({},blocked),false);});

test('reload remembers the music playhead but never autoplay, including old saved preferences',()=>{const s=normalizeSettings({physicsMode:'flight',audio:{kind:'file',position:123.45,playing:true}});assert.equal(s.audio.playing,false);assert.equal(s.audio.position,123.45);assert.equal(s.physicsMode,'smoke');assert.equal(normalizeSettings({physicsMode:'bad'}).physicsMode,'smoke');});

test("scene pause is never restored and hand forces are linked",()=>{const s=normalizeSettings({paused:true,pullPower:.025,pushPower:2});assert.equal(s.paused,null);assert.equal(s.pushPower,.025);});

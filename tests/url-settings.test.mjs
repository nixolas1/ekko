import test from 'node:test';import assert from 'node:assert/strict';
import {settingsFromURL,settingsURL,syncSettingsURL} from '../src/url-settings.js';
import {normalizeSettings} from '../src/preferences.js';
test('full share link restores all controls and song without autoplay',()=>{
 const s=normalizeSettings({physicsMode:'duet',count:3145728,autoCount:false,resolution:'4k',pullPower:.025,pushPower:2.7,maxHands:8,palette:3,effect:2,persistent:false,gain:2.3,paused:true,immersive:true,audio:{kind:'reference',track:'aqua-doctor-jones',position:52.4,playing:true}});
 assert.deepEqual(settingsFromURL(settingsURL('https://ekko-three.vercel.app/?utm_source=friend#view',s)),s);
 assert.match(settingsURL('https://ekko-three.vercel.app/?utm_source=friend#view',s),/utm_source=friend/);
});
test('partial links win over storage; malformed values leave saved preferences intact',()=>{
 const saved=normalizeSettings({palette:2,pullPower:.05,physicsMode:'duet',gain:2,audio:{kind:'file',position:44}});
 const actual=settingsFromURL('https://ekko-three.vercel.app/?mode=ring&song=mitis-shattered&pull=NaN&palette=90&gain=&auto=maybe&t=-1',saved);
 assert.equal(actual.physicsMode,'ring');assert.equal(actual.palette,2);assert.equal(actual.pullPower,.05);assert.equal(actual.gain,2);
 assert.equal(actual.audio.track,'mitis-shattered');assert.equal(actual.audio.kind,'reference');assert.equal(actual.audio.position,0);assert.equal(actual.audio.playing,false);
 assert.deepEqual(settingsFromURL('https://ekko-three.vercel.app/?mode=nope&song=unknown',saved),saved);
});
test('live updates replace history only when changed, preserving the existing history state',()=>{
 const location={href:'https://ekko-three.vercel.app/'},calls=[],history={state:{a:1},replaceState(state,title,url){calls.push({state,title,url});location.href=url;}};
 const s=normalizeSettings();syncSettingsURL(s,location,history);syncSettingsURL(s,location,history);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].state,{a:1});
 syncSettingsURL({...s,pullPower:.007,pushPower:.007},location,history);assert.equal(calls.length,2);assert.match(location.href,/force=0.007/);
});

test('old force links migrate to one force; pause URLs cannot freeze a fresh session',()=>{
 const s=settingsFromURL('https://ekko-three.vercel.app/?push=0.025&paused=1&playing=1');assert.equal(s.pullPower,.025);assert.equal(s.pushPower,.025);assert.equal(s.paused,null);assert.equal(s.audio.playing,false);
 const link=settingsURL('https://ekko-three.vercel.app/?pull=1&push=2&paused=1&playing=1',s);assert.match(link,/force=0.025/);assert.doesNotMatch(link,/pull=|push=|paused=|playing=/);
});

test('per-mode tuning survives links without changing other modes',()=>{
 const saved=normalizeSettings({modeSettings:{smoke:{speed:.5}}});
 const parsed=settingsFromURL('https://example.test/?mode=fluid-ring&speed=1.8&glow=2&turbulence=.3&emission=1.5',saved);
 assert.deepEqual(parsed.modeSettings['fluid-ring'],{speed:1.8,glow:2,turbulence:.3,emission:1.5,spectrumEmission:1,visibility:1});
 assert.equal(parsed.modeSettings.smoke.speed,.5);
 const again=settingsFromURL(settingsURL('https://example.test/',parsed),saved);
 assert.deepEqual(again.modeSettings['fluid-ring'],parsed.modeSettings['fluid-ring']);
});

test('particle visibility is independent per mode, bounded and linkable',()=>{
 const saved=normalizeSettings({physicsMode:'persistent',modeSettings:{persistent:{visibility:2.5},sculpture:{visibility:.5}}});
 const parsed=settingsFromURL(settingsURL('https://example.test',saved),saved);
 assert.equal(parsed.modeSettings.persistent.visibility,2.5);assert.equal(parsed.modeSettings.sculpture.visibility,.5);
 const next=settingsFromURL('https://example.test/?mode=sculpture&visibility=3',parsed);
 assert.equal(next.modeSettings.sculpture.visibility,3);assert.equal(next.modeSettings.persistent.visibility,2.5);
 assert.equal(settingsFromURL('https://example.test/?visibility=100',saved).modeSettings.persistent.visibility,2.5);
});

test('hand overlay is opt-in, saved in links, and keeps music paused',()=>{
 assert.equal(normalizeSettings().showHands,false);
 const on=settingsFromURL('https://example.test/?showHands=1');assert.equal(on.showHands,true);assert.equal(on.audio.playing,false);
 assert.equal(settingsFromURL(settingsURL('https://example.test/',on)).showHands,true);
 assert.equal(settingsFromURL('https://example.test/?showHands=0',on).showHands,false);
 assert.equal(settingsFromURL('https://example.test/?showHands=invalid',on).showHands,true);
});


test('smoke open boundaries default off, persist, and round-trip in links',()=>{
 assert.equal(normalizeSettings().modeSettings.smoke.openBoundaries,false);
 assert.equal(normalizeSettings({modeSettings:{smoke:{openBoundaries:'true'}}}).modeSettings.smoke.openBoundaries,false);
 const on=settingsFromURL('https://example.test/?mode=smoke&openBoundaries=1');
 assert.equal(on.modeSettings.smoke.openBoundaries,true);
 assert.equal(settingsFromURL(settingsURL('https://example.test',on)).modeSettings.smoke.openBoundaries,true);
 assert.equal(settingsFromURL('https://example.test/?openBoundaries=0',on).modeSettings.smoke.openBoundaries,false);
 assert.equal(settingsFromURL('https://example.test/?openBoundaries=invalid',on).modeSettings.smoke.openBoundaries,true);
 const ring=settingsFromURL('https://example.test/?mode=fluid-ring&openBoundaries=0',on);
 assert.equal(ring.modeSettings.smoke.openBoundaries,true);
 assert.equal(new URL(settingsURL('https://example.test/?openBoundaries=1',ring)).searchParams.has('openBoundaries'),false);
});


test('spectrum emission is per-mode, bounded, and preserved in share links',()=>{
 const saved=normalizeSettings({physicsMode:'spectral',modeSettings:{spectral:{spectrumEmission:1.8},smoke:{spectrumEmission:0}}});
 const parsed=settingsFromURL(settingsURL('https://example.test',saved),saved);
 assert.equal(parsed.modeSettings.spectral.spectrumEmission,1.8);assert.equal(parsed.modeSettings.smoke.spectrumEmission,0);
 assert.equal(settingsFromURL('https://example.test/?spectrumEmission=0',saved).modeSettings.spectral.spectrumEmission,0);
 assert.equal(settingsFromURL('https://example.test/?spectrumEmission=3',saved).modeSettings.spectral.spectrumEmission,1.8);
 assert.equal(normalizeSettings({modeSettings:{smoke:{spectrumEmission:99}}}).modeSettings.smoke.spectrumEmission,2);
});

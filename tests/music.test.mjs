import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync,statSync} from 'node:fs';
import {LOCAL_TRACKS,DEFAULT_TRACK_ID,resolveTrackId,trackById,trackFileName,loadTrackFile} from '../src/music.js';
import {normalizeSettings} from '../src/preferences.js';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');

test('library has stable unique ids, local sources and the original reference track',()=>{
 const ids=LOCAL_TRACKS.map(t=>t.id);assert.equal(new Set(ids).size,ids.length);
 assert.ok(ids.includes('mitis-endeavors'));assert.ok(LOCAL_TRACKS.filter(t=>t.artist==='MitiS').length>=3);
 for(const t of LOCAL_TRACKS){assert.match(t.src,/^\/audio\/[\w.-]+\.webm$/);assert.ok(!/[\\/:*?"<>|]/.test(trackFileName(t)));}
});

test('every library file is present locally (public/audio is git-ignored local demo data)',()=>{
 for(const t of LOCAL_TRACKS){const file=new URL(`public${t.src}`,root);assert.ok(existsSync(file),`${t.src} missing`);assert.ok(statSync(file).size>500_000,`${t.src} suspiciously small`);
  assert.equal(readFileSync(file).subarray(0,4).toString('hex'),'1a45dfa3',`${t.src} is not WebM/Matroska`);}
});

test('old saves without a track id restore the former fixed reference track; unknown ids cannot inject paths',()=>{
 assert.equal(normalizeSettings({audio:{kind:'reference',position:12}}).audio.track,DEFAULT_TRACK_ID);
 assert.equal(normalizeSettings({audio:{kind:'reference',track:'../../etc/passwd'}}).audio.track,DEFAULT_TRACK_ID);
 const s=normalizeSettings({audio:{kind:'reference',track:'aqua-doctor-jones',position:42.5,playing:true}});
 assert.equal(s.audio.track,'aqua-doctor-jones');assert.equal(s.audio.position,42.5);assert.equal(s.audio.playing,false,'reload never autoplays');
 assert.equal(resolveTrackId(undefined),DEFAULT_TRACK_ID);assert.equal(trackById('nope'),null);
});

test('removed Country Roads tracks are gone from the library and saved ids fall back to Endeavors',()=>{
 for(const id of ['country-roads-dance','country-roads-real-hypha']){assert.equal(trackById(id),null);assert.equal(normalizeSettings({audio:{kind:'reference',track:id}}).audio.track,DEFAULT_TRACK_ID);}
 assert.ok(!LOCAL_TRACKS.some(t=>/country/i.test(`${t.id} ${t.title} ${t.src}`)));
 assert.doesNotMatch(read('index.html'),/data-track-credit="country-roads/);
 for(const f of ['hermes-house-band-country-roads-dance.webm','real-hypha-country-roads-remix.webm'])assert.ok(!existsSync(new URL(`public/audio/${f}`,root)),`${f} must not ship from public/`);
 for(const id of ['mitis-endeavors','mitis-shattered','mitis-wilderness','aqua-doctor-jones','polyphony-mc-nugget-yodel'])assert.ok(trackById(id),`${id} kept`);
});

test('loadTrackFile fetches the local path and reports a missing file in Norwegian',async()=>{
 const t=trackById('mitis-shattered'),calls=[];
 const file=await loadTrackFile(t,async url=>{calls.push(url);return {ok:true,blob:async()=>new Blob([new Uint8Array(8)],{type:'audio/webm'})};});
 assert.deepEqual(calls,['/audio/mitis-shattered.webm']);assert.equal(file.type,'audio/webm');assert.equal(file.size,8);
 await assert.rejects(loadTrackFile(t,async()=>({ok:false})),/finnes ikke lokalt/);
});

test('main.js: selection loads paused, only the explicit Play click autoplays, stop still cancels loads',()=>{
 const main=read('src/main.js'),html=read('index.html');
 assert.match(main,/\$\('track-select'\)\.onchange=[\s\S]*?loadLibraryTrack\(e\.target\.value\)/);
 assert.doesNotMatch(main,/loadLibraryTrack\(e\.target\.value,\s*\{[^}]*autoplay:\s*true/);
 assert.equal([...main.matchAll(/autoplay:true/g)].length,1,'exactly one autoplay site (the Play button)');
 assert.match(main,/\$\('track-play'\)\.onclick=[\s\S]*?loadLibraryTrack\(id,\{autoplay:true\}\)/);
 assert.match(main,/sound\.file\(file,\{autoplay:false,position:previous\.position\}\)/,'reload restores paused at the saved playhead');
 assert.match(main,/async function loadLibraryTrack[\s\S]*?const revision=\+\+audioRevision[\s\S]*?if\(revision!==audioRevision\)return false/);
 assert.match(main,/\$\('stop-audio'\)\.onclick=\(\)=>\{audioRevision\+\+/);
 for(const t of LOCAL_TRACKS)assert.match(html,new RegExp(`data-track-credit="${t.id}"`),`credit link for ${t.id}`);
 assert.match(html,/id="audio-file"/);assert.match(html,/id="microphone"/);
});

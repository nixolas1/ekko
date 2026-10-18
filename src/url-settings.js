import {normalizeSettings,MODE_TUNING} from './preferences.js';
import {LOCAL_TRACKS} from './music.js';
// Only explicit, valid link values override device preferences. No playback or
// camera permission can be requested by a URL. Unknown query keys are preserved.
const fields={optimizeDenseGlow:['optimizeDenseGlow','boolean'],showHands:['showHands','boolean'],mode:['physicsMode','string'],count:['count','number'],auto:['autoCount','boolean'],resolution:['resolution','string'],force:['pullPower','number'],pointSize:['pointSize','number'],hands:['maxHands','number'],palette:['palette','number'],effect:['effect','number'],persistent:['persistent','boolean'],gain:['gain','number'],immersive:['immersive','boolean']};
export function settingsFromURL(href,saved={}){
  const base=normalizeSettings(saved),out={...base,audio:{...base.audio}},q=new URL(href).searchParams;
  if(!q.has('force')){const legacy=q.get('pull')??q.get('push');if(legacy!==null)q.set('force',legacy);}
  for(const [key,[field,type]] of Object.entries(fields)){
    if(!q.has(key)||q.get(key)==='')continue;
    const raw=q.get(key),v=type==='number'?Number(raw):type==='boolean'?(raw==='1'?true:raw==='0'?false:null):raw;
    if(v===null||(type==='number'&&!Number.isFinite(v)))continue;
    // Reject out-of-range/unknown values instead of silently replacing preferences.
    if(normalizeSettings({...out,[field]:v})[field]===v)out[field]=v;
  }
  const song=q.get('song');
  if(LOCAL_TRACKS.some(t=>t.id===song))out.audio={...out.audio,kind:'reference',track:song,position:0};
  if(['reference','demo','mic','tab','file','youtube'].includes(q.get('source')))out.audio.kind=q.get('source');
  const youtube=q.get('youtube');if(youtube&&/^[A-Za-z0-9_-]{11}$/.test(youtube))out.audio={...out.audio,kind:'youtube',youtube};
  const t=Number(q.get('t'));if(q.has('t')&&q.get('t')!==''&&Number.isFinite(t)&&t>=0)out.audio.position=t;
  for(const [key,[lo,hi]] of Object.entries(MODE_TUNING)){
    const raw=q.get(key),v=Number(raw);if(raw!==null&&raw!==''&&Number.isFinite(v)&&v>=lo&&v<=hi)out.modeSettings[out.physicsMode][key]=v;
  }
  if(out.physicsMode==='smoke'&&['0','1'].includes(q.get('openBoundaries')))out.modeSettings.smoke.openBoundaries=q.get('openBoundaries')==='1';
  out.pushPower=out.pullPower;out.audio.playing=false;out.paused=null;return out;
}
export function settingsURL(href,settings){
  const url=new URL(href),s=normalizeSettings(settings);
  for(const [key,[field,type]] of Object.entries(fields)){
    if(s[field]===null){url.searchParams.delete(key);continue;}
    url.searchParams.set(key,type==='boolean'?(s[field]?'1':'0'):String(s[field]));
  }
  for(const key of Object.keys(MODE_TUNING))url.searchParams.set(key,String(s.modeSettings[s.physicsMode][key]));
  if(s.physicsMode==='smoke')url.searchParams.set('openBoundaries',s.modeSettings.smoke.openBoundaries?'1':'0');else url.searchParams.delete('openBoundaries');
  for(const obsolete of ['pull','push','paused','playing'])url.searchParams.delete(obsolete);
  if(s.audio.kind==='youtube'&&s.audio.youtube)url.searchParams.set('youtube',s.audio.youtube);else url.searchParams.delete('youtube');
  url.searchParams.set('song',s.audio.track);url.searchParams.set('source',s.audio.kind);
  url.searchParams.set('t',String(Math.round(s.audio.position*10)/10));
  return url.href;
}
export function syncSettingsURL(settings,location=globalThis.location,history=globalThis.history){
  const next=settingsURL(location.href,settings);
  if(next!==location.href)history.replaceState(history.state,'',next);
  return next;
}

// A slider can emit dozens of changes per second. Keep the URL live without
// exceeding browsers' history-update rate limits; Copy link flushes immediately.
export function createURLWriter(write=syncSettingsURL){
 let pending=null,timer=null,last=0;
 function flush(){clearTimeout(timer);timer=null;if(!pending)return;const next=pending;pending=null;last=Date.now();try{write(next);}catch{/* Storage/URL restrictions must never interrupt controls. */}}
 function update(settings){pending=settings;if(Date.now()-last>=400)flush();else if(!timer)timer=setTimeout(flush,400-(Date.now()-last));}
 update.flush=flush;return update;
}

import {clampPointSize} from './force-controls.js';
import { resolveTrackId } from './music.js';
export const SETTINGS_KEY='ekko:settings:v1';
const counts=[32768,65536,131072,262144,524288,1048576,2097152,3145728];
export function normalizeSettings(value={}){
  const s=value&&typeof value==='object'?value:{};
  const force=Number.isFinite(s.pullPower)?s.pullPower:Number.isFinite(s.pushPower)?s.pushPower:1;
  const audio=s.audio&&typeof s.audio==='object'?s.audio:{};
  return {
    count:counts.includes(s.count)?s.count:524288,
    autoCount:s.autoCount!==false,
    resolution:['native','4k','auto'].includes(s.resolution)?s.resolution:'native',
    pullPower:Math.max(0,Math.min(3,force)),
    pushPower:Math.max(0,Math.min(3,force)),
    pointSize:clampPointSize(s.pointSize),
    showHands:s.showHands===true,
    maxHands:[2,4,8].includes(s.maxHands)?s.maxHands:2,
    palette:[0,1,2,3,4,5,6].includes(s.palette)?s.palette:0,
    effect:[0,1,2,3,4].includes(s.effect)?s.effect:0,
    persistent:typeof s.persistent==='boolean'?s.persistent:true,
    physicsMode:['fluid-ring','plume-glow','smoke','ring','spectral','plume','duet','hand-fire','persistent','sculpture'].includes(s.physicsMode)?s.physicsMode:'smoke',
    modeSettings:normalizeModeSettings(s.modeSettings),
    gain:Number.isFinite(s.gain)?Math.max(.3,Math.min(3,s.gain)):1.2,
    paused:null,
    immersive:s.immersive===true,
    // track: stable local-library id. Older saves without one meant the single fixed reference track (Endeavors).
    audio:{youtube:typeof audio.youtube==='string'&&/^[A-Za-z0-9_-]{11}$/.test(audio.youtube)?audio.youtube:'',kind:['reference','file','mic','tab','demo','youtube'].includes(audio.kind)?audio.kind:'demo',track:resolveTrackId(audio.track),position:Number.isFinite(audio.position)?Math.max(0,audio.position):0,playing:false,name:typeof audio.name==='string'?audio.name:''}
  };
}
export function loadSettings(storage){try{storage??=globalThis.localStorage;return normalizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY)||'{}'));}catch{return normalizeSettings();}}
export function saveSettings(settings,storage){try{storage??=globalThis.localStorage;storage.setItem(SETTINGS_KEY,JSON.stringify(normalizeSettings(settings)));return true;}catch{return false;}}
// File bytes stay on this device. localStorage only holds the lightweight selection/playhead.
function musicDatabase(){return new Promise((resolve,reject)=>{
  const request=indexedDB.open('ekko-local-music',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('files');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
export async function cacheMusicFile(file){
  const db=await musicDatabase();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(file,'last');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export async function loadMusicFile(){
  const db=await musicDatabase();
  try{return await new Promise((resolve,reject)=>{const request=db.transaction('files').objectStore('files').get('last');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}
}

export const MODE_TUNING={speed:[.25,2],glow:[0,3],turbulence:[0,2],emission:[0,3],spectrumEmission:[0,2],visibility:[.25,4]};
export function normalizeModeSettings(value={}){
 const result={};
 for(const mode of ['fluid-ring','plume-glow','smoke','ring','spectral','plume','duet','hand-fire','persistent','sculpture']){
  result[mode]={};for(const [key,[lo,hi]] of Object.entries(MODE_TUNING)){
   const n=value?.[mode]?.[key];result[mode][key]=Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):1;
  }
 }
 result.smoke.openBoundaries=value?.smoke?.openBoundaries===true;
 return result;
}

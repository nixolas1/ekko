import './style.css';
import { ParticleEngine } from './gpu';
import { AudioInput } from './audio';
import { Tracking } from './tracking';
import { HandForces } from './interactions';
import {forceFromSlider,sliderFromForce,clampForce} from './force-controls';
import { FlightGame } from './flight';
import { AdaptiveQuality } from './performance';
import { loadSettings, saveSettings, cacheMusicFile, loadMusicFile } from './preferences';
import { LOCAL_TRACKS, loadTrackFile, resolveTrackId, trackById, trackLabel } from './music';
const $=id=>document.getElementById(id), settings=loadSettings();
const engine=new ParticleEngine($('scene')), sound=new AudioInput(), handForces=new HandForces();
Object.assign(engine,{count:settings.count,palette:settings.palette,effect:settings.effect,persistent:settings.persistent,resolution:settings.resolution});
sound.gain=settings.gain;
let physicsMode=settings.physicsMode;
const flight=new FlightGame($('flight-scene'));
let paused=settings.paused??matchMedia('(prefers-reduced-motion: reduce)').matches;
let pullPower=settings.pullPower,pushPower=settings.pushPower;
const adaptiveQuality=new AdaptiveQuality();let autoCount=settings.autoCount;
let ready=false,trackingData=null,trackingTime=0,cameraStarting=false,noticeTimer;
let audioSelection={...settings.audio,playing:false},restoring=true,shuttingDown=false,audioRevision=0;
function notice(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,9000);}
function gpuError(message){ready=false;$('gpu-error').hidden=false;$('gpu-error-message').textContent=message;$('gpu-status').textContent='WebGPU utilgjengelig';}
engine.onError=gpuError;
function persist(){
  if(restoring||shuttingDown)return;
  if(sound.mode==='file'&&sound.element)audioSelection={...audioSelection,position:sound.element.currentTime,playing:!sound.element.paused};
  saveSettings({resolution:engine.resolution,pullPower,pushPower,count:autoCount?settings.count:engine.count,autoCount,maxHands:tracker.options.maxHands,palette:engine.palette,effect:engine.effect,persistent:engine.persistent,physicsMode,gain:sound.gain,paused,immersive:document.body.classList.contains('immersive'),audio:{...audioSelection,track:audioSelection.kind==='reference'?audioSelection.track:$('track-select').value||audioSelection.track}});
}
const handMarkers=Array.from({length:8},()=>{const node=document.createElement('div');node.className='hand-marker';node.hidden=true;node.innerHTML='<span></span>';$('hand-indicators').append(node);return node;});
const bars=Array.from({length:36},()=>{const bar=document.createElement('i');$('spectrum').append(bar);return bar;});
function mapPoint(p){const aspect=innerWidth/innerHeight,cameraAspect=($('camera').videoWidth||640)/($('camera').videoHeight||480);return [(1-2*p.x)*Math.min(aspect,cameraAspect),(1-2*p.y)*Math.min(1,aspect/cameraAspect)];}
const tracker=new Tracking($('camera'),data=>{
  trackingData=data;trackingTime=performance.now();handForces.update(data,trackingTime,mapPoint);
  $('camera-count').textContent=`${data.hands.length} hender`;
  for(const point of data.bursts){const [x,y]=mapPoint(point);engine.explode(x,y);}
  drawSkeleton(data);
},status=>{ $('tracking-status').textContent=status;if(status.startsWith('Sporing stoppet')){resetCamera();notice(status);} },{maxHands:settings.maxHands});
function drawSkeleton(data){
  const canvas=$('skeleton'),video=$('camera');canvas.width=canvas.clientWidth*2;canvas.height=canvas.clientHeight*2;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  const ratio=Math.min(canvas.width/(video.videoWidth||640),canvas.height/(video.videoHeight||480));
  const w=(video.videoWidth||640)*ratio,h=(video.videoHeight||480)*ratio,ox=(canvas.width-w)/2,oy=(canvas.height-h)/2;
  const xy=p=>[ox+(1-p.x)*w,oy+p.y*h];
  const edges=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
  ctx.strokeStyle='#87f1e6';ctx.lineWidth=2;
  for(const hand of data.hands){ctx.beginPath();for(const [a,b] of edges){ctx.moveTo(...xy(hand[a]));ctx.lineTo(...xy(hand[b]));}ctx.stroke();}
}
function resetCamera(){trackingData=null;handForces.clear();$('camera-button').innerHTML='Aktiver kamera <span>↗</span>';$('camera-placeholder').hidden=false;$('camera-count').textContent=`Opptil ${tracker.options.maxHands} hender`;$('tracking-hz').textContent='—';$('skeleton').getContext('2d').clearRect(0,0,$('skeleton').width,$('skeleton').height);}
async function toggleCamera(){
  if(tracker.active){tracker.stop();resetCamera();$('tracking-status').textContent='Kamera av';return;}
  if(cameraStarting)return;cameraStarting=true;$('camera-button').disabled=true;$('tracking-status').textContent='Venter på kamera …';
  try{await tracker.start();$('camera-placeholder').hidden=true;$('camera-button').innerHTML='Stopp kamera <span>×</span>';}
  catch(error){resetCamera();$('tracking-status').textContent='Kamera utilgjengelig';notice(`Kamera kunne ikke starte: ${error.message}`);}
  finally{cameraStarting=false;$('camera-button').disabled=false;}
}
$('camera-button').onclick=toggleCamera;
for(const [id,get,set] of [['pull-power',()=>pullPower,v=>pullPower=v],['push-power',()=>pushPower,v=>pushPower=v]]){
  const sync=(editingExact=false)=>{
    $(id).value=String(sliderFromForce(get()));
    $(id+'-value').textContent=get().toFixed(3)+'×';
    if(!editingExact)$(id+'-exact').value=get().toFixed(3);
    $(id).setAttribute('aria-valuetext',get().toFixed(3)+'×');
  };
  sync();
  $(id).oninput=e=>{set(forceFromSlider(e.target.value));sync();persist();};
  $(id+'-exact').oninput=e=>{if(!Number.isFinite(e.target.valueAsNumber))return;set(clampForce(e.target.valueAsNumber));sync(true);persist();};
  $(id+'-exact').onchange=()=>sync();
}
$('resolution').value=engine.resolution;$('resolution').onchange=e=>{engine.resolution=e.target.value;engine.renderScale=1;engine.resize(true);adaptiveQuality.reset();persist();};
$('max-hands').value=String(settings.maxHands);$('max-hands').onchange=async e=>{tracker.options.maxHands=Number(e.target.value);persist();if(tracker.active){tracker.stop();resetCamera();await toggleCamera();}};
function audioUI(){
  const mode=sound.mode;$('audio-status').textContent=mode==='demo'?'Demo':mode==='mic'?'Mikrofon':sound.element?.paused?'Lydfil · pauset':'Lydfil';
  $('microphone').textContent=mode==='mic'?'◉ Stopp mikrofon':'◎ Mikrofon';$('play-audio').hidden=mode!=='file';
  $('play-audio').textContent=sound.element?.paused?'Fortsett lydfil':'Pause lydfil';
  const selected=$('track-select').value,loaded=loadedTrack()===selected,playing=loaded&&!sound.element.paused;
  $('track-play').textContent=playing?'Ⅱ Pause valgt låt':'▶ Spill valgt låt';
  $('track-state').textContent=loaded?(playing?'Spiller':'Lastet · pauset'):'Ikke lastet';
  for(const link of document.querySelectorAll('[data-track-credit]'))link.hidden=link.dataset.trackCredit!==selected;
}
// Library track currently held by the audio element, or null when another source (or nothing) is loaded.
function loadedTrack(){return audioSelection.kind==='reference'&&sound.mode==='file'&&sound.element?audioSelection.track:null;}
for(const track of LOCAL_TRACKS)$('track-select').append(new Option(trackLabel(track),track.id));
$('track-select').value=resolveTrackId(audioSelection.track);
sound.onchange=(_mode,reason)=>{audioUI();if(reason){audioSelection={kind:'demo',position:0,playing:false};notice(reason);persist();}};
function attachAudio(){
  for(const event of ['play','pause','seeked'])sound.element?.addEventListener(event,()=>{audioUI();persist();});
  audioUI();persist();
}
// Loads a library track. Only an explicit Play click passes autoplay; selection and reload always load paused.
// Stop/demo/mic/upload bump audioRevision (and AudioInput's op), so a superseded load resolves false and stays silent.
async function loadLibraryTrack(id,{autoplay=false,position=0}={}){
  const revision=++audioRevision,track=trackById(resolveTrackId(id));
  if(autoplay)await sound.context(); // resume inside the click gesture, before the fetch
  if(revision!==audioRevision)return false;
  const file=await loadTrackFile(track);if(revision!==audioRevision)return false;
  if(!await sound.file(file,{autoplay,position}))return false;
  audioSelection={kind:'reference',track:track.id,name:file.name,position:sound.element.currentTime,playing:autoplay};attachAudio();
  return true;
}
$('microphone').onclick=async()=>{
  audioRevision++;if(sound.mode==='mic'){sound.stop();audioSelection={kind:'demo',position:0,playing:false};audioUI();persist();return;}
  $('microphone').disabled=true;try{if(await sound.microphone()){audioSelection={kind:'mic',position:0,playing:false};persist();}}catch(error){notice(error.message);}finally{$('microphone').disabled=false;audioUI();}
};
$('track-select').onchange=async e=>{
  audioUI();
  try{await loadLibraryTrack(e.target.value);}catch(error){notice(error.message);}finally{audioUI();}
};
$('track-play').onclick=async()=>{
  const id=$('track-select').value,button=$('track-play');
  try{
    if(loadedTrack()===id){if(sound.element.paused)await playAudio();else sound.element.pause();}
    else{button.disabled=true;await loadLibraryTrack(id,{autoplay:true});}
  }catch(error){notice(error.message);}finally{button.disabled=false;audioUI();persist();}
};
$('file-button').onclick=()=>$('audio-file').click();
$('audio-file').onchange=async e=>{
  const file=e.target.files[0],revision=++audioRevision;e.target.value='';if(!file)return;
  try{if(await sound.file(file)){audioSelection={kind:'file',name:file.name,position:0,playing:true};attachAudio();
    try{await cacheMusicFile(file);}catch{if(revision===audioRevision)notice('Lydfilen spiller, men nettleseren kunne ikke lagre den til neste lasting.');}
  }}catch(error){notice(error.message);}
};
$('stop-audio').onclick=()=>{audioRevision++;if(sound.element){audioSelection={...audioSelection,position:sound.element.currentTime,playing:false};}sound.silence();audioSelection.playing=false;audioUI();persist();};
$('demo-audio').onclick=()=>{audioRevision++;sound.stop();audioSelection={kind:'demo',position:0,playing:false};audioUI();persist();};
async function playAudio(){const revision=++audioRevision;await sound.context();if(revision!==audioRevision)return;await sound.element?.play();audioUI();persist();}
$('play-audio').onclick=async()=>{if(!sound.element)return;try{if(sound.element.paused)await playAudio();else sound.element.pause();}catch(e){notice(e.message);}audioUI();persist();};
async function restoreAudio(){
  const previous={...audioSelection},revision=audioRevision;
  try{
    if(previous.kind==='reference'||previous.kind==='file'){
      const file=previous.kind==='reference'?await loadTrackFile(trackById(resolveTrackId(previous.track))):await loadMusicFile();
      if(revision!==audioRevision)return;if(!file)throw new Error('Den lagrede lydfilen finnes ikke lenger. Velg filen på nytt.');
      if(await sound.file(file,{autoplay:false,position:previous.position})){attachAudio();
        // Reload/HMR restores the playhead only. Playback always needs an explicit click.
      }
    }
    // A saved microphone choice never prompts or records automatically.
  }catch(error){if(revision===audioRevision)notice(error.message);}
  finally{restoring=false;audioUI();persist();}
}
$('sensitivity').value=String(sound.gain);$('sensitivity-value').textContent=`${sound.gain.toFixed(1)}×`;
$('sensitivity').oninput=e=>{sound.gain=Number(e.target.value);$('sensitivity-value').textContent=`${sound.gain.toFixed(1)}×`;persist();};
const modeNames={plume:'Røyklys',duet:'Ild og is',smoke:'Røyk',ring:'Røykring',spectral:'Spektralrøyk',persistent:'Airbender',sculpture:'Lysformer',flight:'Flaksefugl'};
function modeUI(){
  engine.persistent=physicsMode==='persistent';engine.flowMode=({smoke:1,ring:2,spectral:3,plume:4,duet:5})[physicsMode]||0;
  document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===physicsMode)));
  $('physics-mode').value=physicsMode;$('effect').hidden=physicsMode!=='sculpture';$('effect-label').hidden=physicsMode!=='sculpture';
  $('mode-description').textContent={plume:'Tynne røykseil med fargede lyspulser fra valgt palett. Hendene samler, bøyer og skyver strømmen.',duet:'Varme oransje og isblå virvler. Foldede lysstrømmer som formes av hendene og musikken.',spectral:'Volumetrisk røyk. Bass skyter mot venstre, mellomtoner opp og diskant mot høyre. Hendene former strømmen.',smoke:'Røyken stiger og virvler. Samle den i neven, og skyv den med åpen hånd.',ring:'En ring sender røyk utover. Hendene bøyer strømmene og lager virvler.',persistent:'Samle lyset i neven. Åpne hånden og send det av gårde.',sculpture:'Musikken former lyset. Hendene trekker og skyver.',flight:'Du er en partikkel med flygedrømmer. Løft begge hender, slå dem ned og fly over hustakene — under fuglene. ↑ eller klikk flakser også.'}[physicsMode];
  const flying=physicsMode==='flight';$('flight-scene').hidden=!flying;$('flight-hud').hidden=!flying;
  document.body.classList.toggle('flight-mode',flying);$('particles').disabled=flying;if(flying)flight.reset();countUI();
}
function selectMode(mode){physicsMode=mode;adaptiveQuality.reset();modeUI();persist();}
$('physics-mode').onchange=e=>{selectMode(e.target.value);e.target.blur();};
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>selectMode(button.dataset.mode));
modeUI();
$('effect').value=String(engine.effect);$('effect').onchange=e=>{engine.effect=Number(e.target.value);persist();};
function countUI(){$('particles').value=autoCount?'auto':String(engine.count);$('particle-label').textContent=physicsMode==='flight'?'1 partikkel · store drømmer':`${engine.count.toLocaleString('nb-NO')} ${autoCount?'· auto':'partikler'}`;}
$('particles').onchange=e=>{autoCount=e.target.value==='auto';if(!autoCount)engine.count=Number(e.target.value);adaptiveQuality.reset();countUI();persist();};countUI();
function paletteUI(){document.querySelectorAll('[data-palette]').forEach(b=>{const active=Number(b.dataset.palette)===engine.palette;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});}
document.querySelectorAll('[data-palette]').forEach(button=>button.onclick=()=>{engine.palette=Number(button.dataset.palette);paletteUI();persist();});paletteUI();
function pauseUI(){$('pause').textContent=paused?'▶':'Ⅱ';$('pause').setAttribute('aria-label',paused?'Start partikler':'Sett partikler på pause');}
$('pause').onclick=()=>{paused=!paused;pauseUI();persist();};pauseUI();
$('burst').onclick=()=>{if(paused){paused=false;pauseUI();}engine.explode();persist();};
function setImmersive(active){document.body.classList.toggle('immersive',active);engine.fill=active?1:0;persist();}
async function toggleFullscreen(){
  if(document.fullscreenElement||document.body.classList.contains('immersive')){if(document.fullscreenElement)await document.exitFullscreen();setImmersive(false);}
  else {setImmersive(true);try{await document.documentElement.requestFullscreen();}catch{setImmersive(false);notice('Nettleseren tillot ikke fullskjerm. Trykk H for å skjule kontrollene.');}}
}
addEventListener('dblclick',event=>{
  if(event.target.closest('button,input,select,textarea,a,.panel,video'))return;
  event.preventDefault();void toggleFullscreen();
});
$('immersive').onclick=toggleFullscreen;$('fullscreen').onclick=toggleFullscreen;
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)setImmersive(false);});
setImmersive(settings.immersive);
addEventListener('keydown',e=>{
  if(e.repeat||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)||document.activeElement.isContentEditable)return;
  if(e.code==='ArrowUp'&&physicsMode==='flight'){e.preventDefault();flight.flap();}
  if(e.code==='Space'){e.preventDefault();void toggleFullscreen();}
  if(e.key.toLowerCase()==='m'){e.preventDefault();if(sound.mode==='file'&&sound.element)$('play-audio').click();else $('track-play').click();}
  if(e.key.toLowerCase()==='b')$('burst').click();
  if(e.key.toLowerCase()==='h')setImmersive(!document.body.classList.contains('immersive'));
  if(e.key==='Escape')setImmersive(false);
});
let resizePending=false;addEventListener('resize',()=>{resizePending=true;});
const saveTimer=setInterval(persist,1000);
function teardown(){persist();shuttingDown=true;clearInterval(saveTimer);clearTimeout(noticeTimer);cancelAnimationFrame(raf);tracker.stop();sound.stop();sound.ctx?.close();engine.dispose();}
addEventListener('pagehide',teardown,{once:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)persist();});
let last=0,lastUI=0,frames=[],raf=0;
function frame(now){
  raf=requestAnimationFrame(frame);if(!ready||document.hidden){last=now;return;}if(resizePending){engine.resize();resizePending=false;}
  const dt=last?(now-last)/1000:1/60;last=now;
  const hands=tracker.active?handForces.sample(now):[];
  handMarkers.forEach((node,index)=>{const hand=hands[index];node.hidden=!hand;if(hand){node.style.left=`${(hand.x/(innerWidth/innerHeight)+1)*50}%`;node.style.top=`${(1-hand.y)*50}%`;node.classList.toggle('repel',hand.mode<0);node.firstChild.textContent=hand.mode<0?'Skyv':'Trekk';}});
  engine.musicActive=sound.mode==='mic'||(sound.mode==='file'&&!!sound.element&&!sound.element.paused);
  const audio=sound.sample(now/1000);engine.musicTransient=sound.transient;engine.emissionBands=sound.emissionBands;audio[3]=Math.max(audio[3],sound.transient*.8);
  // Hands are the only force sources in every mode. No body joints or invisible demo attractor.
  const forces=hands.map(hand=>[hand.x,hand.y,hand.strength*(hand.strength<0?pushPower:pullPower),engine.persistent?.95:.65]);
  if(autoCount&&!paused&&physicsMode!=='flight'){const quality=adaptiveQuality.update(dt,engine.count,engine.renderScale,tracker.active&&tracker.backend==='GPU'?tracker.ms:0);if(quality){engine.count=quality.count;engine.renderScale=engine.resolution==='auto'?quality.scale:1;countUI();}}
  if(physicsMode==='flight'){flight.frame(dt,hands,paused,document.body.classList.contains('immersive'));}else engine.frame(dt,audio,forces,paused);frames.push(dt*1000);if(frames.length>90)frames.shift();
  if(now-lastUI>150){
    lastUI=now;if(physicsMode==='flight'){$('flight-score').textContent=`${Math.floor(flight.distance)} m`; $('flight-message').textContent=flight.message;} $('track-time').hidden=sound.mode!=='file';
    if(sound.element){const format=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;$('track-time').textContent=`${format(sound.element.currentTime)} / ${Number.isFinite(sound.element.duration)?format(sound.element.duration):'…'}`;}
    const mean=frames.reduce((a,b)=>a+b,0)/frames.length;$('fps').textContent=paused?'pause':String(Math.round(1000/mean));$('frame-ms').textContent=mean.toFixed(1);
    $('tracking-hz').textContent=tracker.active&&now-trackingTime<500?tracker.hz.toFixed(1):'—';
    $('tracking-detail').textContent=tracker.active?`${Math.round(tracker.ms)} ms analyse · ${Math.round(tracker.latency||0)} ms forsinkelse · ${tracker.backend||'…'} · kamera ${Math.round(tracker.cameraFps||0)} Hz`:'—';
    $('mode-label').textContent=`${modeNames[physicsMode]} · ${sound.mode==='demo'?'syntetisk puls':sound.mode==='mic'?'mikrofon':'lydfil'}`;
    bars.forEach((bar,i)=>bar.style.height=`${Math.max(5,sound.bins[i*8]/255*100)}%`);
  }
}
void restoreAudio();
try{await engine.init();adaptiveQuality.maxCount=engine.capacity;engine.count=Math.min(engine.count,engine.capacity);for(const option of $('particles').options){if(option.value!=='auto')option.disabled=Number(option.value)>engine.capacity;}countUI();ready=true;$('gpu-error').hidden=true;$('gpu-error-message').textContent='';$('gpu-status').textContent='WebGPU aktiv';void toggleCamera();raf=requestAnimationFrame(frame);}catch(error){gpuError(error.message);}
if(import.meta.hot)import.meta.hot.dispose(teardown);

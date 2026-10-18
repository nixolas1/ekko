import './style.css';
import { ParticleEngine } from './gpu';
import { AudioInput } from './audio';
import { Tracking } from './tracking';
import { HandForces } from './interactions';
import {forceFromSlider,sliderFromForce} from './force-controls';
import { AdaptiveQuality } from './performance';
import { loadSettings, saveSettings, cacheMusicFile, loadMusicFile } from './preferences';
import {shortcutAction} from './shortcuts';
import {settingsFromURL,createURLWriter} from './url-settings';
import {parseYouTubeVideoId,importYouTubeAudio} from './youtube';
import { LOCAL_TRACKS, loadTrackFile, resolveTrackId, trackById, trackLabel } from './music';
const $=id=>document.getElementById(id), settings=settingsFromURL(location.href,loadSettings());
const writeURL=createURLWriter();
const engine=new ParticleEngine($('scene')), sound=new AudioInput(), handForces=new HandForces();
Object.assign(engine,{count:settings.count,palette:settings.palette,effect:settings.effect,persistent:settings.persistent,resolution:settings.resolution});
sound.gain=settings.gain;
let physicsMode=settings.physicsMode;
const modeSettings=settings.modeSettings;
// Playback and scene pause are session-only; links never restore a frozen scene.
let paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
let pullPower=settings.pullPower,pushPower=settings.pullPower;
const adaptiveQuality=new AdaptiveQuality();let autoCount=settings.autoCount;
let ready=false,trackingData=null,trackingTime=0,cameraStarting=false,noticeTimer;
let audioSelection={...settings.audio,playing:false},restoring=true,shuttingDown=false,audioRevision=0,pendingTrack=null,transportBusy=false,transportToken=0;
function notice(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,9000);}
function gpuError(message){ready=false;$('gpu-error').hidden=false;$('gpu-error-message').textContent=message;$('gpu-status').textContent='WebGPU unavailable';}
engine.onError=gpuError;
function persist(){
  if(restoring||shuttingDown)return;
  if(sound.mode==='file'&&sound.element)audioSelection={...audioSelection,position:sound.element.currentTime,playing:!sound.element.paused};
  const current={resolution:engine.resolution,pullPower,pushPower,count:autoCount?settings.count:engine.count,autoCount,maxHands:tracker.options.maxHands,palette:engine.palette,effect:engine.effect,persistent:engine.persistent,physicsMode,modeSettings,gain:sound.gain,paused,immersive:document.body.classList.contains('immersive'),audio:{...audioSelection,track:audioSelection.kind==='reference'?audioSelection.track:$('track-select').value||audioSelection.track}};
  if(pendingTrack)current.audio={...current.audio,kind:'reference',track:pendingTrack,position:0};
  saveSettings(current);writeURL(current);
}
const handMarkers=Array.from({length:8},()=>{const node=document.createElement('div');node.className='hand-marker';node.hidden=true;node.innerHTML='<span></span>';$('hand-indicators').append(node);return node;});
const bars=Array.from({length:4},()=>{const bar=document.createElement('i');$('spectrum').append(bar);return bar;});
function mapPoint(p){const aspect=innerWidth/innerHeight,cameraAspect=($('camera').videoWidth||640)/($('camera').videoHeight||480);return [(1-2*p.x)*Math.min(aspect,cameraAspect),(1-2*p.y)*Math.min(1,aspect/cameraAspect)];}
const tracker=new Tracking($('camera'),data=>{
  trackingData=data;trackingTime=performance.now();handForces.update(data,trackingTime,mapPoint);
  $('camera-count').textContent=`${data.hands.length} hands`;
  for(const point of data.bursts){const [x,y]=mapPoint(point);engine.explode(x,y);}
  drawSkeleton(data);
},status=>{ $('tracking-status').textContent=status;if(status.startsWith('Tracking stopped')){resetCamera();notice(status);} },{maxHands:settings.maxHands});
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
function resetCamera(){trackingData=null;handForces.clear();$('camera-button').innerHTML='Enable camera';$('camera-placeholder').hidden=false;$('camera-count').textContent=`Up to ${tracker.options.maxHands} hands`;$('tracking-hz').textContent='—';$('skeleton').getContext('2d').clearRect(0,0,$('skeleton').width,$('skeleton').height);}
async function toggleCamera(){
  if(tracker.active){tracker.stop();resetCamera();$('tracking-status').textContent='Camera off';return;}
  if(cameraStarting)return;cameraStarting=true;$('camera-button').disabled=true;$('tracking-status').textContent='Waiting for camera…';
  try{await tracker.start();$('camera-placeholder').hidden=true;$('camera-button').innerHTML='Stop camera';}
  catch(error){resetCamera();$('tracking-status').textContent='Camera unavailable';notice(`Could not start the camera: ${error.message}`);}
  finally{cameraStarting=false;$('camera-button').disabled=false;}
}
$('camera-button').onclick=toggleCamera;
$('copy-link').onclick=async()=>{persist();writeURL.flush();try{await navigator.clipboard.writeText(location.href);notice('Link copied: mode, song, position and settings. Music opens paused.');}catch{notice('Copy the address bar to share these settings.');}};
function forceUI(){
  $('force-power').value=String(sliderFromForce(pullPower));
  $('force-power-value').textContent=pullPower.toFixed(3)+'×';
  $('force-power').setAttribute('aria-valuetext',pullPower.toFixed(3)+'×');
}
forceUI();$('force-power').oninput=e=>{pullPower=pushPower=forceFromSlider(e.target.value);forceUI();persist();};
$('resolution').value=engine.resolution;$('resolution').onchange=e=>{engine.resolution=e.target.value;engine.renderScale=1;engine.resize(true);adaptiveQuality.reset();persist();};
$('max-hands').value=String(settings.maxHands);$('max-hands').onchange=async e=>{tracker.options.maxHands=Number(e.target.value);persist();if(tracker.active){tracker.stop();resetCamera();await toggleCamera();}};
function audioUI(){
  const mic=audioSelection.kind==='mic',tab=audioSelection.kind==='tab',file=audioSelection.kind==='file',youtube=audioSelection.kind==='youtube';
  const sharing=tab&&transportBusy&&sound.mode!=='tab';
  const playing=sound.mode==='file'&&!!sound.element&&!sound.element.paused;
  $('audio-status').textContent=tab?(sharing?'Choose a tab…':sound.mode==='tab'?'Tab connected':'Tab disconnected'):mic?(sound.mode==='mic'?'Listening':'Mic off'):playing?'Playing':'Paused';
  $('track-select').hidden=mic||tab||file||youtube;
  $('youtube-panel').hidden=!youtube;$('youtube-button').setAttribute('aria-pressed',String(youtube));
  $('library').setAttribute('aria-pressed',String(!mic&&!tab&&!file&&!youtube));
  $('tab-audio').setAttribute('aria-pressed',String(tab));
  $('microphone').setAttribute('aria-pressed',String(mic));
  $('file-button').setAttribute('aria-pressed',String(file));
  $('track-play').setAttribute('aria-label',tab?(sharing?'Cancel tab sharing request':sound.mode==='tab'?'Stop sharing tab audio':'Share tab audio'):mic?(sound.mode==='mic'?'Pause microphone':'Start microphone'):(playing?'Pause music':'Play music'));
  $('track-play').innerHTML=(tab?(sharing?'× Cancel request':sound.mode==='tab'?'■ Stop sharing':'↗ Share tab'):mic?(sound.mode==='mic'?'Ⅱ Pause input':'▶ Start microphone'):(playing?'Ⅱ Pause':'▶ Play'))+' <kbd>Space</kbd>';
  const loaded=file||youtube?sound.mode==='file':loadedTrack()===$('track-select').value;
  $('track-state').textContent=tab?(sound.mode==='tab'?'Live spectrum from your shared tab':'Choose a tab playing music or video'):mic?'Live audio input':file||youtube?(audioSelection.name||'Audio file'):loaded?'Ready':'Choose a song';
  for(const link of document.querySelectorAll('[data-track-credit]'))link.hidden=mic||tab||file||youtube||link.dataset.trackCredit!==$('track-select').value;
  $('audio-source-note').textContent=tab?(sound.mode==='tab'?'Play or pause the video in its own tab. EKKO analyses audio locally; nothing is recorded or uploaded. Stop sharing disconnects EKKO only.':'Open your video in another tab. Select Share tab, choose that tab and enable “Share tab audio”. Use desktop Chrome or Edge. Refresh requires sharing again.'):youtube?'Import audio for full frequency response. Music opens paused.':mic?'Microphone sound drives the visuals. It is never played back or recorded.':file?'Your file stays on this device. Choose Audio file again to replace it.':'Choose a song to start playing. Opening or refreshing the page keeps music paused.';
}
// Library track currently held by the audio element, or null when another source (or nothing) is loaded.
function loadedTrack(){return audioSelection.kind==='reference'&&sound.mode==='file'&&sound.element?audioSelection.track:null;}
for(const track of LOCAL_TRACKS)$('track-select').append(new Option(trackLabel(track),track.id));
$('track-select').value=resolveTrackId(audioSelection.track);
sound.onchange=(_mode,reason)=>{if(reason){if(!['tab','mic'].includes(audioSelection.kind))audioSelection={kind:'demo',position:0,playing:false};notice(reason);persist();}audioUI();};
function attachAudio(){
  for(const event of ['play','pause','seeked'])sound.element?.addEventListener(event,()=>{audioUI();persist();});
  audioUI();persist();
}
// Loads a library track. Explicit song selection and Play start playback; reload always loads paused.
// Stop/demo/mic/upload bump audioRevision (and AudioInput's op), so a superseded load resolves false and stays silent.
async function loadLibraryTrack(id,{autoplay=false,position=0}={}){
  const revision=++audioRevision,track=trackById(resolveTrackId(id));sound.cancelPending();
  if(autoplay)await sound.context(); // resume inside the click gesture, before the fetch
  if(revision!==audioRevision)return false;
  const file=await loadTrackFile(track);if(revision!==audioRevision)return false;
  if(!await sound.file(file,{autoplay,position})||revision!==audioRevision)return false;
  audioSelection={kind:'reference',track:track.id,name:file.name,position:sound.element.currentTime,playing:autoplay};attachAudio();
  return true;
}
async function toggleMicrophone(){
  audioRevision++;
  if(sound.mode==='mic'){sound.stop();audioSelection={...audioSelection,kind:'mic',playing:false};audioUI();persist();return;}
  $('microphone').disabled=true;
  try{if(await sound.microphone()){audioSelection={...audioSelection,kind:'mic',position:0,playing:false};persist();}}
  catch(error){notice(error.message);}finally{$('microphone').disabled=false;audioUI();}
}
$('microphone').onclick=()=>{if(audioSelection.kind==='mic')return;audioRevision++;sound.stop();audioSelection={...audioSelection,kind:'mic',position:0,playing:false};audioUI();persist();};
$('tab-audio').onclick=()=>{if(audioSelection.kind==='tab')return;audioRevision++;sound.stop();pendingTrack=null;transportToken++;transportBusy=false;audioSelection={...audioSelection,kind:'tab',youtube:'',position:0,playing:false};audioUI();persist();};
$('library').onclick=async()=>{if(loadedTrack()===$('track-select').value)return;try{await loadLibraryTrack($('track-select').value);}catch(error){notice(error.message);}finally{audioUI();persist();}};
$('track-select').onchange=async e=>{
  const selection=e.target.value;e.target.blur();pendingTrack=selection;persist();audioUI();
  try{await loadLibraryTrack(selection,{autoplay:true});}catch(error){if(pendingTrack===selection&&loadedTrack())$('track-select').value=loadedTrack();notice(error.message);}finally{if(pendingTrack===selection)pendingTrack=null;audioUI();persist();}
};
async function toggleAudio(){
  const id=$('track-select').value;
  if(pendingTrack){audioRevision++;sound.stop();audioSelection={...audioSelection,kind:'reference',track:pendingTrack,position:0,playing:false};pendingTrack=null;audioUI();persist();return;}
  if(transportBusy){transportToken++;audioRevision++;sound.silence();transportBusy=false;audioUI();persist();return;}
  const token=++transportToken;transportBusy=true;
  try{
    if(audioSelection.kind==='tab'){
      audioRevision++;
      audioUI();
      if(sound.mode==='tab')sound.stop();else await sound.tabAudio();
      return;
    }
    if(audioSelection.kind==='mic'){await toggleMicrophone();return;}
    if(sound.mode==='file'&&sound.element){
      if(sound.element.paused)await playAudio();else{audioRevision++;sound.silence();}
    }else if(audioSelection.kind==='file'){notice('Choose your audio file again to play it.');$('audio-file').click();}
    else if(audioSelection.kind==='youtube'){await loadYouTube();}
    else{await loadLibraryTrack(id,{autoplay:true});}
  }catch(error){notice(error.message);}finally{if(token===transportToken){transportBusy=false;audioUI();persist();}}
}
$('track-play').onclick=toggleAudio;
// Known music-video links reuse the recordings already hosted with permission.
const youtubeLibrary={'fpViZkhpPHk':'mitis-endeavors','lI5m0-oc9lI':'mitis-shattered','waOuUycRRYs':'mitis-wilderness','-1jPUB7gRyg':'aqua-doctor-jones','Jo2PuYWaNH8':'polyphony-mc-nugget-yodel'};
let youtubeAbort=null;
$('youtube-button').onclick=()=>{if(audioSelection.kind==='youtube')return;audioRevision++;sound.stop();audioSelection={...audioSelection,kind:'youtube',position:0,playing:false};$('youtube-url').value=audioSelection.youtube||'';audioUI();persist();};
async function loadYouTube({position=0}={}){
 const revision=++audioRevision;sound.stop();youtubeAbort?.abort();youtubeAbort=new AbortController();const controller=youtubeAbort;
 const input=$('youtube-url').value;$('youtube-load').disabled=true;$('youtube-status').textContent='Preparing audio…';
 try{
  const videoId=parseYouTubeVideoId(input),known=youtubeLibrary[videoId];
  const result=known?{file:await loadTrackFile(trackById(known)),videoId}:await importYouTubeAudio(input,{signal:controller.signal,onProgress:(received,total)=>{
    if(revision===audioRevision)$('youtube-status').textContent=total?`Downloading audio · ${Math.round(received/total*100)}%`:`Downloading audio · ${(received/1048576).toFixed(1)} MB`;
  }});
  if(revision!==audioRevision)return;
  if(await sound.file(result.file,{autoplay:false,position})&&revision===audioRevision){
   audioSelection={kind:'youtube',youtube:videoId,track:known||audioSelection.track,name:result.title||result.file.name,position,playing:false};attachAudio();
   $('youtube-status').textContent='Ready — full audio analysis. Press Play.';
  }
 }catch(error){if(revision===audioRevision&&error.name!=='AbortError'){$('youtube-status').textContent=error.message;notice(error.message);}}
 finally{if(youtubeAbort===controller)$('youtube-load').disabled=false;if(revision===audioRevision){audioUI();persist();}}
}
$('youtube-load').onclick=()=>loadYouTube();
$('youtube-url').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();void loadYouTube();}};
$('file-button').onclick=()=>$('audio-file').click();
$('audio-file').onchange=async e=>{
  const file=e.target.files[0],revision=++audioRevision;e.target.value='';if(!file)return;
  try{if(await sound.file(file,{autoplay:false})){audioSelection={kind:'file',name:file.name,position:0,playing:false};attachAudio();
    try{await cacheMusicFile(file);}catch{if(revision===audioRevision)notice('Your file is loaded, but could not be saved for the next visit.');}
  }}catch(error){notice(error.message);}
};
async function playAudio(){const revision=++audioRevision;sound.cancelPending();await sound.context();if(revision!==audioRevision)return;await sound.element?.play();audioUI();persist();}
async function restoreAudio(){
  const previous={...audioSelection},revision=audioRevision;
  try{
    if(previous.kind==='youtube'&&previous.youtube){$('youtube-url').value=previous.youtube;await loadYouTube({position:previous.position});}
    if(previous.kind==='reference'||previous.kind==='file'){
      const file=previous.kind==='reference'?await loadTrackFile(trackById(resolveTrackId(previous.track))):await loadMusicFile();
      if(revision!==audioRevision)return;if(!file)throw new Error('The saved audio file is unavailable. Choose it again.');
      if(await sound.file(file,{autoplay:false,position:previous.position})){attachAudio();
        // Reload/HMR restores the playhead only. Playback always needs an explicit click.
      }
    }
    // Saved microphone/tab choices never prompt or capture automatically.
  }catch(error){if(revision===audioRevision)notice(error.message);}
  finally{restoring=false;audioUI();persist();}
}
$('sensitivity').value=String(sound.gain);$('sensitivity-value').textContent=`${sound.gain.toFixed(1)}×`;
$('sensitivity').oninput=e=>{sound.gain=Number(e.target.value);$('sensitivity-value').textContent=`${sound.gain.toFixed(1)}×`;persist();};
const modeNames={'fluid-ring':'Fluid ring','plume-glow':'Smoke light · lasting glow',plume:'Smoke light · original',duet:'Fire & ice',smoke:'Fluid smoke',ring:'Particle ring',spectral:'Spectral smoke',persistent:'Airbender',sculpture:'Light shapes'};
function modeUI(){
  engine.persistent=physicsMode==='persistent';engine.flowMode=({'fluid-ring':6,'plume-glow':7,smoke:1,ring:2,spectral:3,plume:4,duet:5})[physicsMode]||0;
  document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===physicsMode)));
  $('effect').hidden=physicsMode!=='sculpture';$('effect-label').hidden=physicsMode!=='sculpture';
  $('mode-description').textContent={'fluid-ring':'Nine outward smoke jets. Bass starts at the upper left; higher frequencies follow clockwise.','plume-glow':'Always-smoking ribbons. Notes light up new smoke; each patch carries its glow, then fades.',plume:'The original luminous smoke ribbons, with music-driven flashes.',duet:'Twin streams of warm and cool light, shaped by your hands and music.',spectral:'A full-circle smoke ring. Bass starts at the upper left; higher frequencies follow clockwise.',smoke:'Bass hits fire upward from the left; higher notes feed the lanes to the right. Stir the smoke with your hands.',ring:'Outward-flowing particles accelerate with bass intensity. Bend the streams with your hands.',persistent:'Gather light in a closed hand. Open your hand to send it flying.',sculpture:'Music shapes the light. Your hands pull and push it.'}[physicsMode];
  $('particles').disabled=['smoke','fluid-ring'].includes(physicsMode);countUI();modeSettingsUI();
}
function modeSettingsUI(){
 engine.modeSettings=modeSettings[physicsMode];
 $('mode-settings-label').textContent=modeNames[physicsMode]+' settings';
 for(const key of ['speed','glow','turbulence','emission','visibility']){
  const value=engine.modeSettings[key];$('mode-'+key).value=value;$('mode-'+key+'-value').textContent=value.toFixed(2)+'×';
 }
 $('mode-turbulence-control').hidden=!['smoke','fluid-ring'].includes(physicsMode);
 $('mode-emission-control').hidden=!['smoke','fluid-ring','plume','plume-glow'].includes(physicsMode);
 $('mode-visibility-control').hidden=!['persistent','sculpture'].includes(physicsMode);
}
for(const key of ['speed','glow','turbulence','emission','visibility'])$('mode-'+key).oninput=e=>{modeSettings[physicsMode][key]=Number(e.target.value);modeSettingsUI();engine.dirty=true;persist();};
const settingsPanel=document.querySelector('.panel');
let pointerIdleTimer,settingsPeekTimer;
function setSettingsPeek(open){
 clearTimeout(settingsPeekTimer);settingsPeekTimer=null;
 open=open&&document.body.classList.contains('immersive');
 document.body.classList.toggle('settings-peek',open);
 settingsPanel.inert=document.body.classList.contains('immersive')&&!open;
 if(settingsPanel.inert&&settingsPanel.contains(document.activeElement))document.activeElement.blur();
 if(open)engine.mouse=[0,0,.18,0];
}
function updateSettingsPeek(e){
 if(!document.body.classList.contains('immersive'))return;
 if(e.clientX>=innerWidth-20){setSettingsPeek(true);return;}
 if(!document.body.classList.contains('settings-peek'))return;
 // Use the final panel bounds, not its animated position, so the pointer can
 // travel directly from the edge into controls while the drawer is sliding in.
 if(e.clientX>=innerWidth-settingsPanel.offsetWidth-36||e.buttons){clearTimeout(settingsPeekTimer);settingsPeekTimer=null;return;}
 if(!settingsPeekTimer)settingsPeekTimer=setTimeout(()=>{setSettingsPeek(false);settingsPeekTimer=null;},240);
}
function updatePointer(e){
 clearTimeout(pointerIdleTimer);
 document.body.classList.remove('pointer-idle');
 updateSettingsPeek(e);
 const overSettings=document.body.classList.contains('settings-peek')&&e.clientX>=innerWidth-settingsPanel.offsetWidth-36;
 const active=!overSettings&&!e.target.closest('button,input,select,textarea,a,.panel,header,footer,video');
 engine.mouse=[(2*e.clientX/innerWidth-1)*(innerWidth/innerHeight),1-2*e.clientY/innerHeight,.18,active?1:0];
 const dot=$('mouse-dot');dot.style.left=`${e.clientX}px`;dot.style.top=`${e.clientY}px`;dot.hidden=e.pointerType==='touch'||overSettings;
 pointerIdleTimer=setTimeout(clearPointer,5000);
}
addEventListener('pointermove',updatePointer);
addEventListener('pointerdown',updatePointer);
addEventListener('pointerup',updateSettingsPeek);
function clearPointer(){clearTimeout(pointerIdleTimer);engine.mouse=[0,0,.18,0];$('mouse-dot').hidden=true;document.body.classList.add('pointer-idle');}
pointerIdleTimer=setTimeout(clearPointer,5000);
document.addEventListener('pointerleave',clearPointer);
addEventListener('blur',clearPointer);
function selectMode(mode){physicsMode=mode;adaptiveQuality.reset();modeUI();persist();}
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=e=>{selectMode(button.dataset.mode);if(e.detail)button.blur();});
modeUI();
$('effect').value=String(engine.effect);$('effect').onchange=e=>{engine.effect=Number(e.target.value);persist();};
function countUI(){$('particles').value=autoCount?'auto':String(engine.count);$('particle-label').textContent=['smoke','fluid-ring'].includes(physicsMode)?'Fluid simulation':`${engine.count.toLocaleString('en-GB')} ${autoCount?'· auto':'particles'}`;}
$('particles').onchange=e=>{autoCount=e.target.value==='auto';if(!autoCount)engine.count=Number(e.target.value);adaptiveQuality.reset();countUI();persist();};countUI();
function paletteUI(){document.querySelectorAll('[data-palette]').forEach(b=>{const active=Number(b.dataset.palette)===engine.palette;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});}
document.querySelectorAll('[data-palette]').forEach(button=>button.onclick=()=>{engine.palette=Number(button.dataset.palette);paletteUI();persist();});paletteUI();
function pauseUI(){$('pause').textContent=paused?'Resume scene':'Freeze scene';$('pause').setAttribute('aria-label',paused?'Resume scene':'Freeze scene');}
$('pause').onclick=()=>{paused=!paused;pauseUI();persist();};pauseUI();
$('burst').onclick=()=>{if(paused){paused=false;pauseUI();}engine.explode();persist();};
function setImmersive(active){document.body.classList.toggle('immersive',active);setSettingsPeek(false);engine.fill=active?1:0;persist();}
async function toggleFullscreen(){
  if(document.fullscreenElement||document.body.classList.contains('immersive')){if(document.fullscreenElement)await document.exitFullscreen();setImmersive(false);}
  else {setImmersive(true);try{await document.documentElement.requestFullscreen();}catch{setImmersive(false);notice('Fullscreen was blocked. Press H to hide the controls.');}}
}
addEventListener('dblclick',event=>{
  if(event.target.closest('button,input,select,textarea,a,.panel,video'))return;
  event.preventDefault();void toggleFullscreen();
});
$('immersive').onclick=toggleFullscreen;
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)setImmersive(false);});
setImmersive(settings.immersive);
addEventListener('keydown',e=>{
  const action=shortcutAction(e,document.activeElement);if(!action)return;
  e.preventDefault();
  if(action==='music')void toggleAudio();
  if(action==='fullscreen')void toggleFullscreen();
  if(action==='burst')$('burst').click();
  if(action==='hide')setImmersive(!document.body.classList.contains('immersive'));
  if(action==='escape')setImmersive(false);
});
let resizePending=false;addEventListener('resize',()=>{resizePending=true;});
const saveTimer=setInterval(persist,1000);
function teardown(){youtubeAbort?.abort();persist();writeURL.flush();shuttingDown=true;clearInterval(saveTimer);clearTimeout(noticeTimer);clearTimeout(pointerIdleTimer);clearTimeout(settingsPeekTimer);cancelAnimationFrame(raf);tracker.stop();sound.stop();sound.ctx?.close();engine.dispose();}
addEventListener('pagehide',teardown,{once:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)persist();});
let last=0,lastUI=0,frames=[],raf=0;
function frame(now){
  raf=requestAnimationFrame(frame);if(!ready||document.hidden){last=now;return;}if(resizePending){engine.resize();resizePending=false;}
  const dt=last?(now-last)/1000:1/60;last=now;
  const hands=tracker.active?handForces.sample(now):[];
  handMarkers.forEach((node,index)=>{const hand=hands[index];node.hidden=!hand;if(hand){node.style.left=`${(hand.x/(innerWidth/innerHeight)+1)*50}%`;node.style.top=`${(1-hand.y)*50}%`;node.classList.toggle('repel',hand.mode<0);node.firstChild.textContent=hand.mode<0?'Push':'Pull';}});
  engine.musicActive=sound.mode==='mic'||sound.mode==='tab'||(sound.mode==='file'&&!!sound.element&&!sound.element.paused);
  const audio=sound.sample(now/1000);engine.audioResponse=sound.gain;engine.musicTransient=sound.transient;engine.emissionBands=sound.emissionBands;engine.ringBands=sound.ringSpectrum.levels;engine.ringAttacks=sound.ringSpectrum.attacks;audio[3]=Math.max(audio[3],sound.transient*.8);
  // Hand pull/push is separate from the mouse obstacle; body joints never attract.
  const forces=hands.map(hand=>[hand.x,hand.y,hand.strength*(hand.strength<0?pushPower:pullPower),engine.persistent?.95:.65]);
  if(autoCount&&!paused&&!['smoke','fluid-ring'].includes(physicsMode)){const quality=adaptiveQuality.update(dt,engine.count,engine.renderScale,tracker.active&&tracker.backend==='GPU'?tracker.ms:0);if(quality){engine.count=quality.count;engine.renderScale=engine.resolution==='auto'?quality.scale:1;countUI();}}
  engine.frame(dt,audio,forces,paused);frames.push(dt*1000);if(frames.length>90)frames.shift();
  if(now-lastUI>150){
    lastUI=now; $('track-time').hidden=sound.mode!=='file';
    if(sound.element){const format=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;$('track-time').textContent=`${format(sound.element.currentTime)} / ${Number.isFinite(sound.element.duration)?format(sound.element.duration):'…'}`;}
    const mean=frames.reduce((a,b)=>a+b,0)/frames.length;$('fps').textContent=paused?'paused':String(Math.round(1000/mean));$('frame-ms').textContent=mean.toFixed(1);
    $('tracking-hz').textContent=tracker.active&&now-trackingTime<500?tracker.hz.toFixed(1):'—';
    $('tracking-detail').textContent=tracker.active?`${Math.round(tracker.ms)} ms analysis · ${Math.round(tracker.latency||0)} ms latency · ${tracker.backend||'…'} · camera ${Math.round(tracker.cameraFps||0)} Hz`:'—';
    $('mode-label').textContent=`${modeNames[physicsMode]} · ${sound.mode==='demo'?'silent demo':sound.mode==='mic'?'microphone':sound.mode==='tab'?'tab audio':'audio'}`;
    const levels=sound.mode==='demo'?audio:[sound.emissionBands[0],(sound.emissionBands[1]+sound.emissionBands[2])*.5,(sound.emissionBands[3]+sound.emissionBands[4])*.5,(sound.emissionBands[5]+sound.emissionBands[6])*.5];
    bars.forEach((bar,i)=>bar.style.height=`${Math.max(5,(engine.musicActive?levels[i]:0)*100)}%`);
  }
}
void restoreAudio();
try{await engine.init();adaptiveQuality.maxCount=engine.capacity;engine.count=Math.min(engine.count,engine.capacity);for(const option of $('particles').options){if(option.value!=='auto')option.disabled=Number(option.value)>engine.capacity;}countUI();ready=true;$('gpu-error').hidden=true;$('gpu-error-message').textContent='';$('gpu-status').textContent='WebGPU active';void toggleCamera();raf=requestAnimationFrame(frame);}catch(error){gpuError(error.message);}
if(import.meta.hot)import.meta.hot.dispose(teardown);

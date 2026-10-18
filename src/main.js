import './style.css';
import './showcase.css';
import {SHOWCASE_CHAPTERS,ShowcaseTimeline,showcaseSample} from './showcase';
import {ShowcaseView} from './showcase-view';
import {createShowcaseScore} from './showcase-music';
import { ParticleEngine } from './gpu';
import { AudioInput } from './audio';
import { Tracking } from './tracking';
import { HandForces, handForce } from './interactions';
import { HandOverlay } from './hand-overlay';
import { MotionTrack } from './motion';
import { Emitters } from './emitters';
import { mouseHandForce } from './mouse-hand';
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
let showHands=settings.showHands;
const handOverlay=new HandOverlay($('hand-demo'));handOverlay.setEnabled(showHands);
const showcase=new ShowcaseTimeline(),showcaseSound=new AudioInput();
let showcaseSnapshot=null,showcaseRun=0,showcaseStarting=false,showcaseScore=null,showcaseSource=null,showcaseMuted=false,showcaseAudioFailed=false;
const showcaseView=new ShowcaseView(showcaseAction);
const pointerMotion=new MotionTrack({maxPrediction:24});
const mouseHand={x:0,y:0,active:false,held:false,metaKey:false};
const modeSettings=settings.modeSettings;
const emitters=new Emitters();
const emitterMarkers=Array.from({length:9},()=>{const node=document.createElement("div");node.className="emitter-marker";node.hidden=true;node.setAttribute("aria-hidden","true");node.innerHTML="<i>↑</i><span></span>";document.body.append(node);return node;});
// Playback and scene pause are session-only; links never restore a frozen scene.
let paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
let pullPower=settings.pullPower,pushPower=settings.pullPower,pointSize=settings.pointSize;
const adaptiveQuality=new AdaptiveQuality();let autoCount=settings.autoCount;
let ready=false,trackingData=null,trackingTime=0,cameraStarting=false,noticeTimer;
let audioSelection={...settings.audio,playing:false},restoring=true,shuttingDown=false,audioRevision=0,pendingTrack=null,transportBusy=false,transportToken=0;
function notice(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,9000);}
function gpuError(message){if(showcaseSnapshot)stopShowcase();ready=false;$('showcase-start').disabled=true;$('gpu-error').hidden=false;$('gpu-error-message').textContent=message;$('gpu-status').textContent='WebGPU unavailable';}
engine.onError=gpuError;
function persist(){
  if(restoring||shuttingDown||showcaseSnapshot)return;
  if(sound.mode==='file'&&sound.element)audioSelection={...audioSelection,position:sound.element.currentTime,playing:!sound.element.paused};
  const current={resolution:engine.resolution,pullPower,pushPower,pointSize,count:autoCount?settings.count:engine.count,autoCount,showHands,maxHands:tracker.options.maxHands,palette:engine.palette,effect:engine.effect,persistent:engine.persistent,physicsMode,modeSettings,gain:sound.gain,paused,immersive:document.body.classList.contains('immersive'),audio:{...audioSelection,track:audioSelection.kind==='reference'?audioSelection.track:$('track-select').value||audioSelection.track}};
  if(pendingTrack)current.audio={...current.audio,kind:'reference',track:pendingTrack,position:0};
  saveSettings(current);writeURL(current);
}
const handMarkers=Array.from({length:8},()=>{const node=document.createElement('div');node.className='hand-marker';node.hidden=true;node.innerHTML='<span></span>';$('hand-indicators').append(node);return node;});
const bars=Array.from({length:4},()=>{const bar=document.createElement('i');$('spectrum').append(bar);return bar;});
function mapPoint(p){const aspect=innerWidth/innerHeight,cameraAspect=($('camera').videoWidth||640)/($('camera').videoHeight||480);return [(1-2*p.x)*Math.min(aspect,cameraAspect),(1-2*p.y)*Math.min(1,aspect/cameraAspect)];}
const gestureLabels={point:'Cursor',wand:'Pinch · Wand',vortex:'Vortex',none:'No gesture',pull:'Gather',push:'Push'};
const tracker=new Tracking($('camera'),data=>{
  if(showcaseSnapshot)return; // Real camera data never drives a simulated demonstration.
  trackingData=data;trackingTime=performance.now();handForces.update(data,trackingTime,mapPoint);
  $('camera-count').textContent=`${data.hands.length} hands`;
  for(const point of data.bursts){const [x,y]=mapPoint(point);engine.explode(x,y);}
  handOverlay.update(data,handForces.states,trackingTime);
},status=>{ $('tracking-status').textContent=status;if(status.startsWith('Tracking stopped')){resetCamera();notice(status);} },{maxHands:settings.maxHands});
function drawSkeleton(data){
  const canvas=$('skeleton'),video=$('camera');canvas.width=canvas.clientWidth*2;canvas.height=canvas.clientHeight*2;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  const ratio=Math.min(canvas.width/(video.videoWidth||640),canvas.height/(video.videoHeight||480));
  const w=(video.videoWidth||640)*ratio,h=(video.videoHeight||480)*ratio,ox=(canvas.width-w)/2,oy=(canvas.height-h)/2;
  const xy=p=>[ox+(1-p.x)*w,oy+p.y*h];
  const edges=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
  ctx.strokeStyle='#87f1e6';ctx.lineWidth=2;
  data.hands.forEach((hand,index)=>{
    ctx.beginPath();for(const [a,b] of edges){ctx.moveTo(...xy(hand[a]));ctx.lineTo(...xy(hand[b]));}ctx.stroke();
    const state=handForces.states.get(data.handIds?.[index]??index),[x,y]=xy(hand[0]);
    ctx.font='18px sans-serif';ctx.textAlign='center';ctx.fillStyle='#e8f9ff';
    ctx.fillText(gestureLabels[state?.stable]||(state?(state.mode>0?'Gather':'Push'):'Tracking'),Math.max(45,Math.min(canvas.width-45,x)),Math.max(20,Math.min(canvas.height-8,y+25)));
  });
}
function resetCamera(){trackingData=null;handForces.clear();handOverlay.clear();$('camera-button').innerHTML='Enable camera';$('camera-placeholder').hidden=false;$('camera-count').textContent=`Up to ${tracker.options.maxHands} hands`;$('tracking-hz').textContent='—';$('skeleton').getContext('2d').clearRect(0,0,$('skeleton').width,$('skeleton').height);}
async function toggleCamera(){
  if(tracker.active){tracker.stop();resetCamera();$('tracking-status').textContent='Camera off';return;}
  if(cameraStarting)return;cameraStarting=true;$('camera-button').disabled=true;$('tracking-status').textContent='Waiting for camera…';
  try{await tracker.start();$('camera-placeholder').hidden=true;$('camera-button').innerHTML='Stop camera';}
  catch(error){resetCamera();$('tracking-status').textContent='Camera unavailable';notice(`Could not start the camera: ${error.message}`);}
  finally{cameraStarting=false;$('camera-button').disabled=false;}
}
$('camera-button').onclick=toggleCamera;
$('show-hands').checked=showHands;
$('show-hands').onchange=e=>{showHands=e.target.checked;handOverlay.setEnabled(showHands);persist();};
$('copy-link').onclick=async()=>{persist();writeURL.flush();try{await navigator.clipboard.writeText(location.href);notice('Link copied: mode, song, position and settings. Music opens paused.');}catch{notice('Copy the address bar to share these settings.');}};
function forceUI(){
  $('force-power').value=String(sliderFromForce(pullPower));
  $('force-power-value').textContent=pullPower.toFixed(3)+'×';
  $('force-power').setAttribute('aria-valuetext',pullPower.toFixed(3)+'×');
}
forceUI();$('force-power').oninput=e=>{pullPower=pushPower=forceFromSlider(e.target.value);forceUI();persist();};
function pointSizeUI(){
  $('point-size').value=String(pointSize);
  $('point-size-value').textContent=pointSize.toFixed(2)+'×';
  $('point-size').setAttribute('aria-valuetext',pointSize.toFixed(2)+'×');
}
pointSizeUI();$('point-size').oninput=e=>{pointSize=Number(e.target.value);pointSizeUI();persist();};
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
// Known music-video links reuse the installed library recordings.
const youtubeLibrary=Object.fromEntries(LOCAL_TRACKS.filter(track=>track.youtube).map(track=>[track.youtube,track.id]));
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
  finally{restoring=false;$('showcase-start').disabled=!ready;audioUI();persist();}
}
$('sensitivity').value=String(sound.gain);$('sensitivity-value').textContent=`${sound.gain.toFixed(1)}×`;
$('sensitivity').oninput=e=>{sound.gain=Number(e.target.value);$('sensitivity-value').textContent=`${sound.gain.toFixed(1)}×`;persist();};
const modeNames={'fluid-ring':'Fluid ring','plume-glow':'Smoke light · lasting glow',plume:'Smoke light · original',duet:'Fire & ice','hand-fire':'Hand fire & ice',smoke:'Fluid smoke',ring:'Particle ring',spectral:'Spectral smoke',persistent:'Airbender',sculpture:'Light shapes'};
function modeUI(){
  engine.persistent=physicsMode==='persistent';engine.flowMode=({'fluid-ring':6,'plume-glow':7,smoke:1,ring:2,spectral:3,plume:4,duet:5,'hand-fire':8})[physicsMode]||0;
  document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===physicsMode)));
  $('effect').hidden=physicsMode!=='sculpture';$('effect-label').hidden=physicsMode!=='sculpture';
  $('mode-description').textContent={'fluid-ring':'Nine outward smoke jets. Bass starts at the upper left; higher frequencies follow clockwise.','plume-glow':'Always-smoking ribbons. Notes light up new smoke; each patch carries its glow, then fades.',plume:'The original luminous smoke ribbons, with music-driven flashes.',duet:'Twin streams of warm and cool light, shaped by your hands and music.','hand-fire':'Point to cast jets of light, sparks and rolling smoke. Move closer to unleash more particles; pull back to soften the stream. Each new pointing gesture resets your power. Two hands take bass and mid. Mids and treble get extra particles, and bass hits widen every stream.',spectral:'A full-circle smoke ring. Bass starts at the upper left; higher frequencies follow clockwise.',smoke:'Bass hits fire upward from the left; higher notes feed the lanes to the right. Stir the smoke with your hands.',ring:'Outward-flowing particles accelerate with bass intensity. Bend the streams with your hands.',persistent:'Gather light in a closed hand. Open your hand to send it flying.',sculpture:'Music shapes the light. Your hands pull and push it.'}[physicsMode];
  const movementHelp=$('movement-help');movementHelp.dataset.defaultText??=movementHelp.textContent;
  movementHelp.textContent=physicsMode==='hand-fire'?'Point to aim your blast. Move closer for more power or farther away for less; start a new pointing gesture to reset. Fists gather, open palms push, pinches form a Wand and two fingers stir a Vortex. The mouse emits while active, stopping after 5 seconds idle; click and hold to push, or Command-hold to gather.':movementHelp.dataset.defaultText;
  $('particles').disabled=['smoke','fluid-ring'].includes(physicsMode);countUI();modeSettingsUI();
}
function modeSettingsUI(){
 engine.modeSettings=modeSettings[physicsMode];
 $('mode-settings-label').textContent=modeNames[physicsMode]+' settings';
 for(const key of ['speed','glow','turbulence','emission','spectrumEmission','visibility']){
  const value=engine.modeSettings[key];$('mode-'+key).value=value;$('mode-'+key+'-value').textContent=key==='spectrumEmission'&&value===0?'Off':value.toFixed(2)+'×';
 }
 $('mode-turbulence-control').hidden=!['smoke','fluid-ring','hand-fire'].includes(physicsMode);
 $('mode-emission-control').hidden=!['smoke','fluid-ring','plume','plume-glow','spectral','ring','duet','hand-fire'].includes(physicsMode);
 $('mode-spectrumEmission-control').hidden=$('mode-emission-control').hidden;
 $('mode-open-boundaries-control').hidden=physicsMode!=='smoke';
 $('mode-open-boundaries').checked=engine.modeSettings.openBoundaries===true;
 $('mode-visibility-control').hidden=!['persistent','sculpture'].includes(physicsMode);
}
for(const key of ['speed','glow','turbulence','emission','spectrumEmission','visibility'])$('mode-'+key).oninput=e=>{modeSettings[physicsMode][key]=Number(e.target.value);modeSettingsUI();engine.dirty=true;persist();};
$('mode-open-boundaries').onchange=e=>{modeSettings.smoke.openBoundaries=e.target.checked;engine.dirty=true;persist();};
const settingsPanel=document.querySelector('.panel');
let pointerIdleTimer,settingsPeekTimer;
function setSettingsPeek(open){
 clearTimeout(settingsPeekTimer);settingsPeekTimer=null;
 open=open&&document.body.classList.contains('immersive');
 document.body.classList.toggle('settings-peek',open);
 settingsPanel.inert=document.body.classList.contains('immersive')&&!open;
 if(settingsPanel.inert&&settingsPanel.contains(document.activeElement))document.activeElement.blur();
 if(open){engine.mouse=[0,0,.18,0];mouseHand.active=false;mouseHand.held=false;}
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
 if(showcaseSnapshot)return;
 clearTimeout(pointerIdleTimer);
 document.body.classList.remove('pointer-idle');
 updateSettingsPeek(e);
 const overSettings=document.body.classList.contains('settings-peek')&&e.clientX>=innerWidth-settingsPanel.offsetWidth-36;
 const active=!overSettings&&!e.target.closest('button,input,select,textarea,a,.panel,header,footer,video');
 const now=performance.now();
 const samples=e.getCoalescedEvents?.()||[];
 for(const sample of [...samples,e]){
  const timestamp=Number.isFinite(sample.timeStamp)&&Math.abs(now-sample.timeStamp)<1000?sample.timeStamp:now;
  pointerMotion.update([sample.clientX,sample.clientY],timestamp);
 }
 const [px,py]=pointerMotion.sample(now).position;
 mouseHand.x=(2*px/innerWidth-1)*(innerWidth/innerHeight);mouseHand.y=1-2*py/innerHeight;
 mouseHand.active=active;mouseHand.metaKey=e.metaKey;
 if(!active||!(e.buttons&1))mouseHand.held=false;
 if(e.type==='pointerdown'&&e.button===0&&active){
  mouseHand.held=true;
  if(!e.metaKey&&pushPower>0)engine.explode((2*e.clientX/innerWidth-1)*(innerWidth/innerHeight),1-2*e.clientY/innerHeight,pushPower);
 }
 engine.mouse=[mouseHand.x,mouseHand.y,.18,active&&!mouseHand.held?1:0];
 const dot=$('mouse-dot');dot.style.left=`${px}px`;dot.style.top=`${py}px`;dot.hidden=e.pointerType==='touch'||overSettings;
 pointerIdleTimer=setTimeout(clearPointer,5000);
}
addEventListener('pointermove',updatePointer);
addEventListener('pointerdown',updatePointer);
addEventListener('pointerup',updatePointer);
addEventListener('pointercancel',clearPointer);
addEventListener('keyup',e=>{if(e.key==='Meta')mouseHand.metaKey=false;});
function clearPointer(){pointerMotion.clear();clearTimeout(pointerIdleTimer);mouseHand.active=false;mouseHand.held=false;mouseHand.metaKey=false;engine.mouse=[0,0,.18,0];$('mouse-dot').hidden=true;document.body.classList.add('pointer-idle');}
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
  if(showcaseSnapshot)return;
  if(event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||event.button!==0)return;
  if(event.target.closest('button,input,select,textarea,a,.panel,video'))return;
  event.preventDefault();void toggleFullscreen();
});
$('immersive').onclick=toggleFullscreen;
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&!showcaseSnapshot)setImmersive(false);});
setImmersive(settings.immersive);
addEventListener('keydown',e=>{
  if(showcaseSnapshot){
    if(e.key==='Escape'){e.preventDefault();stopShowcase();return;}
    if(e.code==='Space'&&!e.target.closest('button,input')){e.preventDefault();showcaseAction('pause');}
    if(e.key==='ArrowRight'||e.key.toLowerCase()==='n'){e.preventDefault();showcaseAction('next');}
    if(e.key==='ArrowLeft'){e.preventDefault();showcaseAction('previous');}
    return;
  }
  if(e.key==='Meta')mouseHand.metaKey=true;
  const controlsHidden=document.body.classList.contains('immersive')&&!document.body.classList.contains('settings-peek');
  const action=shortcutAction(e,document.activeElement,controlsHidden);if(!action)return;
  e.preventDefault();
  if(action==='music')void toggleAudio();
  if(action==='fullscreen')void toggleFullscreen();
  if(action==='next-mode'){const modes=[...document.querySelectorAll('[data-mode]')].map(b=>b.dataset.mode);selectMode(modes[(modes.indexOf(physicsMode)+1)%modes.length]);}
  if(action==='next-song'){
    const select=$('track-select');select.selectedIndex=(select.selectedIndex+1)%select.options.length;
    select.dispatchEvent(new Event('change'));
  }
  if(action.startsWith('palette-'))document.querySelector(`[data-palette="${action.slice(8)}"]`)?.click();
  if(action==='force-down'||action==='force-up'){
    const slider=$('force-power');
    // Use the same cubic scale as the slider, with finer changes at low forces.
    slider.value=Number(slider.value)+(action==='force-up'?10:-10);
    slider.dispatchEvent(new Event('input'));notice(`Hand force · ${$('force-power-value').textContent}`);
  }
  if(action==='particles-down'||action==='particles-up'){
    const select=$('particles');
    if(select.disabled){notice('This mode uses a fluid simulation; particle count does not apply.');return;}
    const counts=[...select.options].filter(o=>o.value!=='auto'&&!o.disabled).map(o=>Number(o.value));
    const count=action==='particles-up'?counts.find(n=>n>engine.count)??counts.at(-1):counts.findLast(n=>n<engine.count)??counts[0];
    select.value=String(count);select.dispatchEvent(new Event('change'));notice(`${count.toLocaleString('en-GB')} particles`);
  }
  if(action==='burst')$('burst').click();
  if(action==='hide')setImmersive(!document.body.classList.contains('immersive'));
  if(action==='escape')setImmersive(false);
});
// Tour settings are temporary. Only the explicit Try action saves a chapter.
function applyShowcaseChapter(){
  const chapter=showcase.chapter;physicsMode=chapter.mode;engine.palette=chapter.palette;engine.effect=0;
  modeSettings[physicsMode]={speed:1,glow:1.6,turbulence:1.15,emission:1.65,spectrumEmission:1,visibility:1};
  engine.dirty=true;adaptiveQuality.reset();modeUI();paletteUI();
  // Drop queued input from the preceding chapter, especially when paused/skipping.
  engine.pending.length=0;engine.mouse=[0,0,.18,0];
}
async function playShowcaseMusic(token){
  showcaseStarting=true;showcaseAudioFailed=false;showcaseView.message('Preparing music…');
  try{
    const source=showcaseSource;
    // Resume in the initiating click, before decoding/generating the score.
    const resumed=source.context();
    if(source===showcaseSound&&!showcaseScore)showcaseScore=createShowcaseScore();
    await resumed;if(token!==showcaseRun)return;
    if(source===showcaseSound){
      if(!await source.file(showcaseScore,{autoplay:true}))return;
      if(showcaseMuted)source.source.disconnect(source.ctx.destination);
    }
    else if(source.element)await source.element.play();
    if(token!==showcaseRun)return;
    if(showcase.paused||showcase.complete)source.element?.pause();
    showcaseView.muted(showcaseMuted);showcaseView.message('');
  }catch(error){
    if(token===showcaseRun){showcaseAudioFailed=true;showcaseView.message('Music could not start. Select Retry music, or continue watching without sound.');showcaseView.root.querySelector('[data-tour=mute]').textContent='Retry music';}
  }finally{if(token===showcaseRun)showcaseStarting=false;}
}
async function startShowcase(){
  if(!ready||restoring||showcaseSnapshot)return;
  if(transportBusy||pendingTrack){notice('Wait for the current audio load, then start the tour.');return;}
  persist();writeURL.flush();
  showcaseSnapshot={mode:physicsMode,palette:engine.palette,effect:engine.effect,tuning:structuredClone(modeSettings),count:engine.count,autoCount,renderScale:engine.renderScale,paused,pullPower,pushPower,immersive:document.body.classList.contains('immersive'),url:location.href,
    element:sound.element,audioPosition:sound.element?.currentTime||0,audioPlaying:!!sound.element&&!sound.element.paused};
  showcaseSource=['file','mic','tab'].includes(sound.mode)?sound:showcaseSound;
  showcaseSound.gain=2;showcaseMuted=false;showcaseAudioFailed=false;
  const live=['mic','tab'].includes(showcaseSource.mode);
  showcaseView.root.querySelector('.showcase-music').textContent=showcaseSource===showcaseSound?'Original score · First light':live?'Your live audio · playback stays in its source':'Your selected music';
  const mute=showcaseView.root.querySelector('[data-tour=mute]');mute.disabled=live;showcaseView.muted(false);if(live)mute.textContent='Live audio';
  showcase.start();showcaseView.show();clearPointer();handOverlay.setEnabled(false);
  document.body.classList.add('showcase-active');document.querySelector('header').inert=true;document.querySelector('footer').inert=true;
  setImmersive(true);paused=false;pullPower=pushPower=.65;autoCount=true;engine.count=Math.min(524288,engine.capacity);engine.fill=1;
  applyShowcaseChapter();showcaseView.render(showcase,showcaseSample(showcase.chapter,0));
  await playShowcaseMusic(++showcaseRun);
}
function stopShowcase(keepMode=false,resumeAudio=true){
  if(!showcaseSnapshot)return;
  const saved=showcaseSnapshot,chosen={mode:physicsMode,palette:engine.palette,effect:engine.effect,tuning:{...modeSettings[physicsMode]}};
  ++showcaseRun;showcaseStarting=false;showcase.stop();showcaseView.hide();
  if(showcaseMuted&&showcaseSource===sound&&sound.source)sound.source.connect(sound.ctx.destination);
  showcaseSound.stop();showcaseSource=null;
  Object.assign(modeSettings,saved.tuning);physicsMode=saved.mode;engine.palette=saved.palette;engine.effect=saved.effect;
  if(keepMode){physicsMode=chosen.mode;engine.palette=chosen.palette;engine.effect=chosen.effect;modeSettings[physicsMode]=chosen.tuning;}
  engine.count=saved.count;engine.renderScale=saved.renderScale;autoCount=saved.autoCount;paused=keepMode?false:saved.paused;pullPower=saved.pullPower;pushPower=saved.pushPower;
  engine.pending.length=0;clearPointer();handForces.clear();handOverlay.clear();handOverlay.setEnabled(showHands);
  document.body.classList.remove('showcase-active');document.querySelector('header').inert=false;document.querySelector('footer').inert=false;
  setImmersive(keepMode?false:saved.immersive);modeUI();paletteUI();pauseUI();forceUI();$('effect').value=String(engine.effect);adaptiveQuality.reset();engine.dirty=true;
  if(saved.element&&saved.element===sound.element){
    sound.element.pause();sound.element.currentTime=saved.audioPosition;
    if(saved.audioPlaying&&resumeAudio)void sound.element.play().catch(()=>notice('Press Space to resume your music.'));
  }
  history.replaceState(history.state,'',saved.url);showcaseSnapshot=null;
  if(resumeAudio){if(!saved.immersive||keepMode)$('showcase-start').focus();else document.activeElement?.blur();audioUI();persist();}
}
function showcasePlaybackFailed(){
  if(!showcase.active)return;showcaseAudioFailed=true;showcaseView.message('Music could not resume. Select Retry music to try again.');showcaseView.root.querySelector('[data-tour=mute]').textContent='Retry music';
}
function showcaseAction(action,value){
  if(!showcase.active)return;
  if(action==='exit'||action==='try'){stopShowcase(action==='try');return;}
  if(action==='loop'){showcase.loop=value;return;}
  if(action==='mute'){
    if(showcaseAudioFailed){void playShowcaseMusic(showcaseRun);return;}
    if(!showcaseSource?.element)return;
    // Disconnect only the audible destination; the analyser must keep receiving
    // music when muted so visuals do not collapse into silence.
    showcaseMuted=!showcaseMuted;
    if(showcaseMuted)showcaseSource.source.disconnect(showcaseSource.ctx.destination);else showcaseSource.source.connect(showcaseSource.ctx.destination);
    showcaseView.muted(showcaseMuted);return;
  }
  if(action==='pause'){
    if(showcase.complete)return;showcase.paused=!showcase.paused;
    if(showcase.paused)showcaseSource?.element?.pause();
    else if(showcaseSource?.element)void showcaseSource.element.play().catch(showcasePlaybackFailed);
  }else if(['next','previous','chapter'].includes(action)){
    if(action==='next'&&!showcase.complete&&showcase.index===SHOWCASE_CHAPTERS.length-1&&!showcase.loop){showcase.complete=true;showcase.elapsed=showcase.chapter.duration;showcaseSource?.element?.pause();}
    else{
      showcase.seek(action==='chapter'?value:action==='previous'?showcase.index-1:showcase.complete||showcase.index===SHOWCASE_CHAPTERS.length-1?0:showcase.index+1);
      applyShowcaseChapter();
      if(!showcase.paused&&!showcaseStarting&&showcaseSource?.element)void showcaseSource.element.play().catch(showcasePlaybackFailed);
    }
  }
  showcaseView.render(showcase,showcaseSample(showcase.chapter,showcase.elapsed,innerWidth/innerHeight));
}
$('showcase-start').onclick=startShowcase;

let resizePending=false;addEventListener('resize',()=>{resizePending=true;});
const saveTimer=setInterval(persist,1000);
function teardown(){if(showcaseSnapshot)stopShowcase(false,false);showcaseSound.stop();showcaseSound.ctx?.close();showcaseView.dispose();youtubeAbort?.abort();persist();writeURL.flush();shuttingDown=true;clearInterval(saveTimer);clearTimeout(noticeTimer);clearTimeout(pointerIdleTimer);clearTimeout(settingsPeekTimer);cancelAnimationFrame(raf);tracker.stop();sound.stop();sound.ctx?.close();engine.dispose();}
addEventListener('pagehide',teardown,{once:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(showcase.active&&!showcase.paused&&!showcase.complete)showcaseAction('pause');persist();}});
let last=0,lastUI=0,frames=[],raf=0;
function frame(now){
  raf=requestAnimationFrame(frame);handOverlay.render(now,tracker.active);
  if(!showcase.active){
    const pointer=pointerMotion.sample(now);
    if(pointer){const [x,y]=pointer.position;
      mouseHand.x=(2*x/innerWidth-1)*(innerWidth/innerHeight);mouseHand.y=1-2*y/innerHeight;
      engine.mouse=[mouseHand.x,mouseHand.y,.18,mouseHand.active&&!mouseHand.held?1:0];
      $('mouse-dot').style.left=`${x}px`;$('mouse-dot').style.top=`${y}px`;
    }
    if(tracker.active&&trackingData){
      const states=handForces.sample(now);
      drawSkeleton({hands:states.map(s=>s.motion.sample(now)),handIds:states.map(s=>s.id)});
    }
  }
  if(!ready||document.hidden){last=now;return;}if(resizePending){engine.resize();resizePending=false;}
  const dt=last?(now-last)/1000:1/60;last=now;
  let demo=null;
  if(showcase.active){
    const event=showcaseStarting?{changed:false,bursts:[]}:showcase.advance(dt);
    if(event.changed)applyShowcaseChapter();
    demo=showcaseSample(showcase.chapter,showcase.elapsed,innerWidth/innerHeight);
    for(const _ of event.bursts){const hand=demo.hands[0];if(hand)engine.explode(hand.x,hand.y,1.2);}
    if(showcase.complete)showcaseSource?.element?.pause();
    showcaseView.render(showcase,demo);
    const pointer=demo.pointer;engine.mouse=pointer&&!pointer.held?[pointer.x,pointer.y,.18,1]:[0,0,.18,0];
  }
  const hands=demo?demo.hands:tracker.active?handForces.sample(now):[];
  handMarkers.forEach((node,index)=>{const hand=hands[index];node.hidden=!hand||(physicsMode==='hand-fire'&&hand.gesture==='point');if(hand){node.style.left=`${(hand.x/(innerWidth/innerHeight)+1)*50}%`;node.style.top=`${(1-hand.y)*50}%`;node.classList.toggle('repel',hand.mode<0);node.firstChild.textContent=gestureLabels[hand.gesture]||'Gather';}});
  const activeSound=showcase.active?showcaseSource||showcaseSound:sound;
  engine.musicActive=activeSound.mode==='mic'||activeSound.mode==='tab'||(activeSound.mode==='file'&&!!activeSound.element&&!activeSound.element.paused);
  const audio=activeSound.sample(now/1000);engine.audioResponse=activeSound.gain;engine.musicTransient=activeSound.transient;engine.emissionBands=activeSound.emissionBands;engine.ringBands=activeSound.ringSpectrum.levels;engine.ringAttacks=activeSound.ringSpectrum.attacks;audio[3]=Math.max(audio[3],activeSound.transient*.8);
  // Hand pull/push is separate from the mouse obstacle; body joints never attract.
  const forces=hands.filter(hand=>physicsMode!=='hand-fire'||hand.gesture!=='point').map(hand=>handForce(hand,engine.persistent,pullPower,pushPower,pointSize));
  const mouseForce=mouseHandForce(demo?demo.pointer:mouseHand,engine.persistent,pullPower,pushPower);if(mouseForce)forces.push(mouseForce);
  engine.emitters=emitters.sample(physicsMode==='hand-fire'?hands:[],physicsMode==='hand-fire'?mouseHand:null,now);
  if(physicsMode==='hand-fire')engine.mouse=[0,0,.18,0];
  emitterMarkers.forEach((node,i)=>{const source=engine.emitters[i];node.hidden=!source;if(source){node.style.left=`${(source.x/(innerWidth/innerHeight)+1)*50}%`;node.style.top=`${(1-source.y)*50}%`;node.style.setProperty('--aim',`${Math.atan2(source.direction[0],source.direction[1])}rad`);node.style.setProperty('--source-color',`hsl(${30+source.band*200} 90% 78%)`);node.lastChild.textContent=source.band===0?'Bass':source.band===1?'Treble':'Mid';}});
  const scenePaused=showcase.active?(showcase.paused||showcase.complete||showcaseStarting):paused;
  if(autoCount&&!scenePaused&&!['smoke','fluid-ring'].includes(physicsMode)){const quality=adaptiveQuality.update(dt,engine.count,engine.renderScale,tracker.active&&tracker.backend==='GPU'?tracker.ms:0);if(quality){engine.count=quality.count;engine.renderScale=engine.resolution==='auto'?quality.scale:1;countUI();}}
  engine.frame(dt,audio,forces,scenePaused);frames.push(dt*1000);if(frames.length>90)frames.shift();
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
try{await engine.init();adaptiveQuality.maxCount=engine.capacity;engine.count=Math.min(engine.count,engine.capacity);for(const option of $('particles').options){if(option.value!=='auto')option.disabled=Number(option.value)>engine.capacity;}countUI();ready=true;$('gpu-error').hidden=true;$('gpu-error-message').textContent='';$('gpu-status').textContent='WebGPU active';$('showcase-start').disabled=restoring;void toggleCamera();raf=requestAnimationFrame(frame);}catch(error){gpuError(error.message);}
if(import.meta.hot)import.meta.hot.dispose(teardown);

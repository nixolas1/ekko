import {ParticleEngine} from '../gpu.js';
import {AudioInput} from '../audio.js';
import {createShowcaseScore} from '../showcase-music.js';
import {mouseHandForce} from '../mouse-hand.js';
import {validateDocument} from './schema.js';
const canvas=document.querySelector('canvas'),engine=new ParticleEngine(canvas),sound=new AudioInput();
const send=(type,data={})=>parent.postMessage({ekkoPreview:true,type,...data},location.origin);
let ready=false,playing=false,paused=false,last=0,raf=0,capture=null,compiling=false,visible=true,current=null,score=null;
const pointer={x:0,y:0,active:false,held:false,metaKey:false};
engine.fill=1;engine.count=131072;engine.resolution='auto';engine.renderScale=.8;
engine.onError=message=>{playing=false;send('error',{message});};
function pointerEvent(e){const rect=canvas.getBoundingClientRect();pointer.x=(2*(e.clientX-rect.left)/rect.width-1)*rect.width/rect.height;pointer.y=1-2*(e.clientY-rect.top)/rect.height;pointer.active=true;pointer.held=!!(e.buttons&1);pointer.metaKey=e.metaKey;}
for(const name of ['pointermove','pointerdown','pointerup'])canvas.addEventListener(name,pointerEvent);
canvas.addEventListener('pointerleave',()=>{pointer.active=false;pointer.held=false;});
addEventListener('blur',()=>{pointer.active=false;pointer.held=false;});
canvas.addEventListener('dblclick',()=>engine.explode(pointer.x,pointer.y));
addEventListener('resize',()=>{if(ready)engine.resize();});
async function run(document,id){
 if(compiling){send('result',{id,ok:false,message:'A shader is already compiling. Try again in a moment.'});return;}
 compiling=true;
 try{
  const doc=validateDocument(document);if(!ready){await engine.init();ready=true;}
  await engine.compileRemix(doc.code);
  engine.persistent=doc.mode==='persistent';engine.flowMode=({'fluid-ring':6,'plume-glow':7,smoke:1,ring:2,spectral:3,plume:4,duet:5})[doc.mode]||0;
  engine.palette=doc.settings.palette;engine.effect=doc.settings.effect;engine.count=Math.min(doc.settings.count,engine.capacity);engine.modeSettings={...doc.settings};engine.dirty=true;engine.pending.length=0;
  current=doc;playing=true;paused=false;documentError('');send('result',{id,ok:true});
 }catch(e){send('result',{id,ok:false,message:e.message});}finally{compiling=false;}
}
function documentError(message){document.querySelector('#error').textContent=message;}
addEventListener('message',async e=>{
 if(e.origin!==location.origin||e.source!==parent||!e.data?.ekkoStudio)return;
 const {type,id}=e.data;
 try{
  if(type==='run')await run(e.data.document,id);
  if(type==='pause'){paused=e.data.paused;if(paused){sound.element?.pause();send('audio',{playing:false});}send('paused',{paused});}
  if(type==='audio'){
   if(sound.element&&!sound.element.paused){sound.element.pause();send('audio',{playing:false});return;}
   await sound.context();if(!score)score=createShowcaseScore();
   if(sound.element)await sound.element.play();else await sound.file(score);
   send('audio',{playing:true});
  }
  if(type==='file'){await sound.context();await sound.file(e.data.file);send('audio',{playing:true});}
  if(type==='capture'){if(!playing)throw new Error('Run the scene before capturing its preview.');capture=id;}
  if(type==='visible'){visible=e.data.visible;if(!visible){sound.element?.pause();send('audio',{playing:false});}}
 }catch(error){send(type==='capture'?'capture':'error',{id,message:error.message});}
});
function frame(now){
 raf=requestAnimationFrame(frame);const dt=last?Math.min((now-last)/1000,.05):1/60;last=now;
 if(!ready||!playing||document.hidden||!visible)return;
 const audio=sound.sample(now/1000);engine.musicActive=!!sound.element&&!sound.element.paused;engine.audioResponse=sound.gain;engine.musicTransient=sound.transient;engine.emissionBands=sound.emissionBands;engine.ringBands=sound.ringSpectrum.levels;engine.ringAttacks=sound.ringSpectrum.attacks;
 engine.mouse=pointer.active&&!pointer.held?[pointer.x,pointer.y,.18,1]:[0,0,.18,0];
 const force=mouseHandForce(pointer,engine.persistent,.65,.65);engine.frame(dt,audio,force?[force]:[],paused);
 if(capture){const id=capture;capture=null;try{const out=document.createElement('canvas');out.width=480;out.height=270;out.getContext('2d').drawImage(canvas,0,0,480,270);send('capture',{id,thumbnail:out.toDataURL('image/webp',.65)});}catch(e){send('capture',{id,message:e.message});}}
}
raf=requestAnimationFrame(frame);send('ready');
addEventListener('pagehide',()=>{cancelAnimationFrame(raf);engine.dispose();sound.stop();sound.ctx?.close();});

import {LOCAL_TRACKS,loadTrackFile} from '../src/music.js';
import {AudioInput} from '../src/audio.js';
import {normalizeSettings} from '../src/preferences.js';
document.querySelector('#run').onclick=async()=>{
 const out=document.querySelector('#result'),audio=new AudioInput(),tracks=[];out.textContent='running';
 try{
  for(const track of LOCAL_TRACKS){
   const file=await loadTrackFile(track);
   const restored=normalizeSettings({audio:{kind:'reference',track:track.id,position:37.25,playing:true}}).audio;
   const loaded=await audio.file(file,{autoplay:restored.playing,position:restored.position});
   const element=audio.element;
   tracks.push({id:track.id,loaded,duration:element.duration,paused:element.paused,position:element.currentTime,pass:loaded&&element.paused&&element.duration>60&&Math.abs(element.currentTime-37.25)<.1});
   audio.silence();
  }
  out.textContent=JSON.stringify({pass:tracks.every(t=>t.pass),tracks},null,2);
 }catch(error){out.textContent=JSON.stringify({pass:false,error:error.message,tracks},null,2);}finally{audio.stop();await audio.ctx?.close();}
};

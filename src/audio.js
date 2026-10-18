import { ANALYSER, RingSpectrum, AudioError, TransientDetector, checkAudioFile, demoFrame, followEnvelope, microphoneError, playbackError, requestMicrophone, requestTabAudio, resumeContext, sanitizeGain, softLimit, spectralLevels, emissionLevels, whenLoaded } from './audio-controls.js';

// Attack/release (seconds) per band: bass snaps up and lets go slowly, highs flicker faster.
const ATTACK = [0.012, 0.015, 0.01, 0.014];
const RELEASE = [0.2, 0.14, 0.09, 0.16];

// Sources: 'demo' (synthetic, silent), 'mic' (analysed only, never routed to the speakers), 'file' (audible).
// Extra, optional surface: .transient (0..1 onset envelope), .error (last failure message or null),
// .onchange(mode, reason) callback fired when the source changes on its own (device unplugged, decode failure).
export class AudioInput {
  constructor(){
    this.mode='demo';this.gain=1.2;this.bands=[0,0,0,0];this.bins=new Uint8Array(512);
    this.emissionBands=new Float32Array(7);this._emissionRaw=new Float32Array(7);
    this.ringSpectrum=new RingSpectrum();this.transient=0;this.error=null;this.onchange=null;
    this.ctx=null;this.element=null;this.stream=null;this.source=null;this.url=null;
    this._op=0;this._env=[0,0,0,0];this._levels=[0,0,0,0];this._detector=new TransientDetector();this._time=null;
  }
  get synthetic(){return this.mode==='demo';}
  async context(resume=true){
    if(!this.ctx||this.ctx.state==='closed'){
      const Ctor=globalThis.AudioContext||globalThis.webkitAudioContext;
      if(!Ctor)throw new AudioError('unsupported','This browser does not support Web Audio.');
      const ctx=new Ctor({latencyHint:'interactive'});
      const analyser=ctx.createAnalyser();
      analyser.fftSize=ANALYSER.fftSize;analyser.smoothingTimeConstant=ANALYSER.smoothing;analyser.minDecibels=ANALYSER.minDb;analyser.maxDecibels=ANALYSER.maxDb;
      // Zero-gain tail keeps the analyser pulled by every engine without ever making the mic audible.
      const mute=ctx.createGain();mute.gain.value=0;analyser.connect(mute);mute.connect(ctx.destination);
      this.ctx=ctx;this.analyser=analyser;this.mute=mute;
    }
    if(resume)await resumeContext(this.ctx);
    return this.ctx;
  }
  // Tears down whatever is attached without touching mode or the operation counter.
  _release(){
    const {stream,source,element,url}=this;
    this.stream=this.source=this.element=this.url=null;
    stream?.getTracks().forEach(t=>{t.onended=null;try{t.stop();}catch{}});
    try{source?.disconnect();}catch{}
    if(element){element.onerror=null;try{element.pause();element.removeAttribute('src');element.load?.();}catch{}}
    if(url)URL.revokeObjectURL(url);
  }
  _setMode(mode,reason){
    const changed=this.mode!==mode;this.mode=mode;
    this.ringSpectrum.reset();this.emissionBands.fill(0);this._env.fill(0);this._levels.fill(0);this._detector.reset();this.transient=0;this._time=null;
    if(changed&&this.onchange){try{this.onchange(mode,reason);}catch{}}
  }
  // Source died by itself (unplugged device, decode error): fall back to demo and say why.
  _fail(message){this._op++;this._release();this._setMode('demo',message);this.error=message;}
  // Any call that supersedes an in-flight microphone()/file() makes that call clean up after itself and resolve false.
  cancelPending(){this._op++;}
  stop(){this._op++;this._release();this.error=null;this._setMode('demo');}
  // Silence immediately and invalidate pending source loads, keeping a loaded file's playhead.
  silence(){
    if(!this.element){this.stop();return;}
    this._op++;this.element.pause();this.error=null;this._setMode('file');
  }
  async microphone(){
    const op=++this._op;
    try{
      const ctx=await this.context();if(op!==this._op)return false;
      const stream=await requestMicrophone(globalThis.navigator?.mediaDevices);
      if(op!==this._op){stream.getTracks().forEach(t=>t.stop());return false;}
      let source;
      try{source=ctx.createMediaStreamSource(stream);}catch(error){stream.getTracks().forEach(t=>t.stop());throw microphoneError(error);}
      this._release();
      this.stream=stream;this.source=source;source.connect(this.analyser);
      stream.getTracks().forEach(t=>{t.onended=()=>{if(this.stream===stream)this._fail('The microphone disconnected');};});
      this.error=null;this._setMode('mic');
      return true;
    }catch(error){if(op!==this._op)return false;this.error=error.message;throw error;}
  }
  async tabAudio(){
    const op=++this._op;
    let stream,source;
    const discard=()=>{try{source?.disconnect();}catch{}stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});};
    try{
      // Resume Web Audio in the same user gesture as the picker, not after it closes.
      const context=this.context();context.catch(()=>{});
      // Start the picker before any await, preserving transient user activation.
      stream=await requestTabAudio(globalThis.navigator?.mediaDevices);
      if(op!==this._op){discard();return false;}
      const ctx=await context;
      if(op!==this._op){discard();return false;}
      if(!stream.getAudioTracks().some(t=>t.readyState==='live'))throw new AudioError('capture-ended','Tab sharing ended. Select Share tab to reconnect.');
      // Keep the required low-rate display track alive, but never render or record it.
      // Disabling it can stall Chrome's capture source when sharing the same tab again.
      source=ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      source.connect(this.analyser); // Original tab plays the sound; never duplicate it here.
      this._release();this.stream=stream;this.source=source;
      stream.getTracks().forEach(t=>{t.onended=()=>{if(this.stream===stream)this._fail('Tab sharing ended. Select Share tab to reconnect.');};});
      this.error=null;this._setMode('tab');return true;
    }catch(error){
      discard();if(op!==this._op)return false;
      this.error=error.message;throw error;
    }
  }
  async file(file,{autoplay=true,position=0}={}){
    const op=++this._op;
    let element=null,url=null,source=null;
    const discard=()=>{try{source?.disconnect();}catch{}if(element){element.onerror=null;try{element.pause();element.removeAttribute('src');element.load?.();}catch{}}if(url)URL.revokeObjectURL(url);};
    try{
      checkAudioFile(file);
      const ctx=await this.context(autoplay);if(op!==this._op)return false;
      url=URL.createObjectURL(file);
      element=new Audio();element.preload='auto';element.loop=true;element.src=url;
      await whenLoaded(element);if(op!==this._op){discard();return false;}
      source=ctx.createMediaElementSource(element);
      // Commit: only now is the previous source released, so a bad file leaves the old one playing.
      this._release();
      this.element=element;this.url=url;this.source=source;
      source.connect(this.analyser);source.connect(ctx.destination);
      element.onerror=()=>{if(this.element===element)this._fail('Audio playback failed.');};
      if(Number.isFinite(position)&&position>0)element.currentTime=Math.min(position,Number.isFinite(element.duration)?Math.max(0,element.duration-.01):position);
      if(autoplay)await element.play();
      if(op!==this._op)return false;
      this.error=null;this._setMode('file');
      return true;
    }catch(error){
      if(op!==this._op){discard();return false;}
      const failure=playbackError(error,file);
      if(this.element===element&&element)this._fail(failure.message);else{discard();this.error=failure.message;}
      throw failure;
    }
  }
  sample(time){
    const t=Number.isFinite(time)?time:(this._time??0)+1/60;
    const dt=this._time===null?1/60:Math.min(0.25,Math.max(0,t-this._time));this._time=t;
    let levels=this._levels,transient;
    if(this.mode==='demo'||!this.analyser){
      const demo=demoFrame(t,this.bins);levels=demo.levels;transient=demo.transient;
      for(let i=0;i<4;i++)this._env[i]=levels[i];
    }else{
      this.analyser.getByteFrequencyData(this.bins);
      spectralLevels(this.bins,this.ctx.sampleRate,this.analyser.fftSize,levels);
      transient=this._detector.update(levels,dt);
      for(let i=0;i<4;i++)this._env[i]=followEnvelope(this._env[i],levels[i],dt,ATTACK[i],RELEASE[i]);
    }
    if(this.mode!=='demo'&&this.analyser){
      this.ringSpectrum.update(this.bins,this.ctx.sampleRate,this.analyser.fftSize,this.gain,dt);
      emissionLevels(this.bins,this.ctx.sampleRate,this.analyser.fftSize,this._emissionRaw);
      for(let i=0;i<7;i++)this.emissionBands[i]=followEnvelope(this.emissionBands[i],softLimit(this._emissionRaw[i]*sanitizeGain(this.gain)),dt,.008,.075);
    }else {this.emissionBands.fill(0);this.ringSpectrum.reset();}
    this.transient=transient;
    const gain=sanitizeGain(this.gain);
    this.bands=this._env.map(v=>softLimit(v*gain));
    return this.bands.slice();
  }
}

// The tour is a deterministic timeline, separate from saved preferences and real
// tracking. The same sampled positions feed both the simulation and the overlay.
export const SHOWCASE_CHAPTERS = [
  {mode:'fluid-ring',name:'Fluid ring',title:'Hear the colour move.',description:'Nine frequency bands feed nine jets. Bass starts at the upper left; the higher notes travel clockwise.',hint:'The cursor gently parts the smoke. No click needed.',control:'hover',palette:3,duration:20},
  {mode:'plume',name:'Smoke light · Original',title:'Pinch to draw light.',description:'Touch thumb and index fingertips for Wand. A small core follows your pinch and pulls luminous ribbons along with it.',hint:'Pinch · Wand',control:'wand',palette:3,duration:20},
  {mode:'duet',name:'Fire & ice',title:'Hold a vortex in each hand.',description:'Raise two fingers to stir an orbit. Spread your fingertips to widen it. Both hands act independently.',hint:'Two fingers · Vortex',control:'vortex',palette:6,duration:20},
  {mode:'persistent',name:'Airbender',title:'Gather. Then let go.',description:'Close your hand to gather the cloud. Open your palm to push it away and release a burst.',hint:'A fist gathers · an open palm pushes',control:'gather',palette:0,duration:20},
  {mode:'smoke',name:'Fluid smoke',title:'Stir the rising smoke.',description:'Heat lifts the smoke; bass notes fire the left-hand jets. Sweep an open palm through the plume to bend its flow.',hint:'Open palm · Push',control:'push',palette:3,duration:20},
  {mode:'spectral',name:'Spectral smoke',title:'Step inside the spectrum.',description:'Fine filaments carry the detail, while a soft volume catches the light. Two fingers fold the ring into an orbit.',hint:'Two fingers · Vortex',control:'vortex',palette:3,duration:20},
  {mode:'plume-glow',name:'Smoke light · Lasting glow',title:'Let a note leave a trace.',description:'Each note lights new smoke. That patch carries its glow as it rises, even after the note has ended.',hint:'Pinch · Wand',control:'wand',palette:2,duration:20},
  {mode:'ring',name:'Particle ring',title:'Your mouse is a hand, too.',description:'Click and hold to push. Command-click and hold to gather. Follow the pointer and watch the streams change direction.',hint:'Click to push · Command-click to gather',control:'cursor',palette:4,duration:20},
  {mode:'sculpture',name:'Light shapes',title:'Point and part the light.',description:'Raise your index finger to gently repel nearby light, just like the mouse cursor. Move your fingertip through the strands.',hint:'Point · Cursor obstacle',control:'point',palette:4,duration:20},
];

export class ShowcaseTimeline {
  constructor(){this.active=false;this.index=0;this.elapsed=0;this.paused=false;this.complete=false;this.loop=false;}
  get chapter(){return SHOWCASE_CHAPTERS[this.index];}
  start(){this.active=true;this.index=0;this.elapsed=0;this.paused=false;this.complete=false;}
  stop(){this.active=false;}
  seek(index){this.index=Math.max(0,Math.min(SHOWCASE_CHAPTERS.length-1,index));this.elapsed=0;this.complete=false;}
  advance(dt){
    if(!this.active||this.paused||this.complete)return {changed:false,bursts:[]};
    const before=this.elapsed;
    // Limit hidden-tab/resume gaps; never fast-forward through several lessons.
    this.elapsed+=Math.min(.1,Math.max(0,Number.isFinite(dt)?dt:0));
    const bursts=[];
    const trigger=this.chapter.control==='gather'?10:null;
    if(trigger!==null&&before<trigger&&this.elapsed>=trigger)bursts.push(trigger);
    if(this.elapsed<this.chapter.duration)return {changed:false,bursts};
    if(this.index+1<SHOWCASE_CHAPTERS.length){this.seek(this.index+1);return {changed:true,bursts:[]};}
    if(this.loop){this.seek(0);return {changed:true,bursts:[]};}
    this.elapsed=this.chapter.duration;this.complete=true;return {changed:false,bursts:[]};
  }
}

function movingHand(id,gesture,t,aspect,side=1){
  const span=Math.min(aspect,.95);
  const x=span*(side*.30+.22*Math.sin(t*.45+id));
  const y=.15+.24*Math.sin(t*.37+id*.8);
  return {id:100+id,gesture,x,y,vx:span*.22*.45*Math.cos(t*.45+id),vy:.24*.37*Math.cos(t*.37+id*.8),
    strength:gesture==='push'?-7:gesture==='gather'?11:8,
    wand:gesture==='wand'?1:0,vortex:gesture==='vortex'?1:0,point:gesture==='point'?1:0,
    vortexRadius:.25+.19*(.5+.5*Math.sin(t*.55)),mode:gesture==='push'?-1:1};
}
export function showcaseSample(chapter,time,aspect=16/9){
  const t=Math.max(0,time),control=chapter.control;
  const sample={hands:[],pointer:null,label:chapter.hint};
  // First three seconds let the viewer see the undisturbed mode and read its cue.
  if(t<3){sample.label='Watch the music shape the scene';return sample;}
  if(control==='hover'||control==='cursor'){
    const gather=control==='cursor'&&t>=11;
    sample.pointer={x:Math.min(aspect,.95)*.65*Math.sin((t-3)*.42),y:.14+.33*Math.cos((t-3)*.42),active:true,held:control==='cursor',metaKey:gather};
    sample.label=control==='hover'?'Move the mouse · gentle repulsion':gather?'Command + hold · Gather':'Click + hold · Push';
  }else if(control==='vortex'){
    sample.hands=[movingHand(0,'vortex',t,aspect,-1),movingHand(1,'vortex',t,aspect,1)];
  }else{
    const gesture=control==='gather'?(t<10?'gather':'push'):control;
    sample.hands=[movingHand(0,gesture,t,aspect,0)];
    if(control==='gather')sample.label=t<10?'Closed fist · Gather':'Open palm · Push and release';
  }
  return sample;
}

// Normalised hand pose for the teaching overlay. These landmarks have the same
// finger ordering as MediaPipe; extended tips match the gesture being applied.
export function showcaseHandPose(gesture,spread=.5){
  const count={gather:0,point:1,wand:1,vortex:2,push:4}[gesture]??0;
  const points=Array.from({length:21},()=>({x:0,y:0,z:0}));
  points[0]={x:0,y:.55,z:0};
  [[-.32,.36],[-.53,.17],[-.66,.02],[-.73,-.12]].forEach(([x,y],i)=>points[i+1]={x,y,z:0});
  [5,9,13,17].forEach((base,finger)=>{
    const x=(finger-1.4)*(.23+(gesture==='vortex'?spread*.13:0));
    const top=[-.73,-.86,-.72,-.65][finger];
    points[base]={x,y:0,z:0};
    points[base+1]={x,y:-.26,z:0};
    points[base+2]={x,y:finger<count?top*.8:-.10,z:0};
    points[base+3]={x,y:finger<count?top:.20,z:0};
  });
  if(gesture==='wand'){
    // Bend the index toward the thumb and visibly join their tips.
    points[7]={x:-.4,y:-.48,z:0};points[8]={x:-.54,y:-.4,z:0};
    points[3]={x:-.65,y:-.23,z:0};points[4]={...points[8]};
  }
  return points;
}

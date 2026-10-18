import {SHOWCASE_CHAPTERS,showcaseHandPose} from './showcase.js';
const EDGES=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const COLORS={wand:'#e6faff',vortex:'#c2abff',point:'#bceefa',gather:'#8be7ed',push:'#f2cf91'};
export class ShowcaseView {
  constructor(onAction){
    this.root=document.createElement('section');this.root.className='showcase';this.root.hidden=true;
    this.root.setAttribute('role','dialog');this.root.setAttribute('aria-modal','true');this.root.setAttribute('aria-label','EKKO guided tour');
    this.root.innerHTML=`<canvas class="showcase-gestures" aria-label="Animated demonstrations of simulated hands and cursor movement"></canvas>
      <div class="showcase-top"><div><span class="showcase-wordmark">ekko</span><span class="showcase-tag">Guided tour · simulated controls</span></div><button type="button" data-tour="exit">Exit tour <span aria-hidden="true">×</span></button></div>
      <div class="showcase-lesson">
        <div class="showcase-chapters" aria-label="Tour chapters"></div>
        <div class="showcase-heading" aria-live="polite" aria-atomic="true"><p class="showcase-mode"></p><h1></h1><p class="showcase-description"></p></div>
        <p class="showcase-cue"></p>
        <div class="showcase-actions"><button type="button" data-tour="previous" aria-label="Previous chapter">Back</button><button type="button" data-tour="pause">Pause</button><button type="button" data-tour="next" aria-label="Next chapter">Next</button><button type="button" data-tour="try">Try this mode</button></div>
        <div class="showcase-options"><label><input type="checkbox" data-tour="loop"> Repeat tour</label><button type="button" data-tour="mute" aria-pressed="false">Mute music</button><span class="showcase-music">Original score · First light</span></div>
        <p class="showcase-message" role="status" hidden></p>
      </div>`;
    document.body.append(this.root);
    this.canvas=this.root.querySelector('canvas');this.ctx=this.canvas.getContext('2d');
    this.chapterButtons=SHOWCASE_CHAPTERS.map((chapter,index)=>{
      const button=document.createElement('button');button.type='button';button.dataset.chapter=index;button.setAttribute('aria-label',`${index+1}. ${chapter.name}`);button.title=chapter.name;
      button.innerHTML='<span></span>';this.root.querySelector('.showcase-chapters').append(button);return button;
    });
    this.root.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;if(button.dataset.chapter!==undefined)onAction('chapter',Number(button.dataset.chapter));else onAction(button.dataset.tour);});
    this.root.querySelector('[data-tour=loop]').addEventListener('change',e=>onAction('loop',e.target.checked));
    this.root.addEventListener('keydown',e=>{
      if(e.key!=='Tab')return;
      const controls=[...this.root.querySelectorAll('button:not(:disabled),input')];
      const first=controls[0],last=controls.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    });
    this.key='';
  }
  show(){this.root.hidden=false;this.key='';this.root.querySelector('[data-tour=exit]').focus();this.message('');}
  hide(){this.root.hidden=true;this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);}
  message(text){const node=this.root.querySelector('.showcase-message');node.textContent=text;node.hidden=!text;}
  muted(muted){const button=this.root.querySelector('[data-tour=mute]');button.textContent=muted?'Unmute music':'Mute music';button.setAttribute('aria-pressed',String(muted));}
  render(timeline,sample){
    const chapter=timeline.chapter,key=`${timeline.index}|${timeline.complete}`;
    this.root.dataset.chapter=timeline.index;this.root.dataset.paused=String(timeline.paused);this.root.dataset.complete=String(timeline.complete);
    if(key!==this.key){
      this.key=key;
      this.root.querySelector('.showcase-mode').textContent=`${timeline.index+1} / ${SHOWCASE_CHAPTERS.length} — ${chapter.name}`;
      this.root.querySelector('h1').textContent=timeline.complete?'Now make it yours.':chapter.title;
      this.root.querySelector('.showcase-description').textContent=timeline.complete?'You have seen all nine modes. Take over this scene, replay the tour, or exit to your previous setup.':chapter.description;
    }
    this.root.querySelector('.showcase-cue').textContent=timeline.complete?'Choose Try this mode to take control':sample.label;
    this.root.querySelector('[data-tour=previous]').disabled=timeline.index===0;
    const pause=this.root.querySelector('[data-tour=pause]');pause.textContent=timeline.paused?'Resume':'Pause';pause.disabled=timeline.complete;
    this.root.querySelector('[data-tour=next]').textContent=timeline.complete?'Replay':'Next';
    this.root.querySelector('[data-tour=next]').setAttribute('aria-label',timeline.complete?'Replay tour':'Next chapter');
    this.chapterButtons.forEach((button,i)=>{
      button.setAttribute('aria-current',i===timeline.index?'step':'false');
      button.firstChild.style.transform=`scaleX(${i<timeline.index?1:i===timeline.index?timeline.elapsed/chapter.duration:0})`;
    });
    this.draw(sample,timeline.elapsed);
  }
  draw(sample,time){
    const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,2),ctx=this.ctx;
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const screen=(x,y)=>[w/2+x*h/2,h/2-y*h/2];
    ctx.lineJoin='round';ctx.lineCap='round';
    for(const hand of sample.hands){
      const [x,y]=screen(hand.x,hand.y),scale=Math.min(56,w*.075),color=COLORS[hand.gesture];
      const points=showcaseHandPose(hand.gesture,(hand.vortexRadius-.25)/.19);
      const anchor=hand.gesture==='point'?points[8]:hand.gesture==='wand'?{x:(points[4].x+points[8].x)/2,y:(points[4].y+points[8].y)/2}:hand.gesture==='vortex'?{x:(points[8].x+points[12].x)/2,y:(points[8].y+points[12].y)/2}:points[9];
      const xy=p=>[x+(p.x-anchor.x)*scale,y+(p.y-anchor.y)*scale];
      ctx.beginPath();[0,5,9,13,17].forEach((index,i)=>i?ctx.lineTo(...xy(points[index])):ctx.moveTo(...xy(points[index])));ctx.closePath();ctx.fillStyle='#080a14b8';ctx.fill();
      ctx.beginPath();for(const [a,b] of EDGES){ctx.moveTo(...xy(points[a]));ctx.lineTo(...xy(points[b]));}
      ctx.strokeStyle='#080a14';ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
      for(const p of points){ctx.beginPath();ctx.arc(...xy(p),2.3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
      ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();
      this.label(x,y+(points[0].y-anchor.y+.35)*scale,`Simulated · ${hand.gesture==='point'?'Cursor':hand.gesture==='wand'?'Pinch · Wand':hand.gesture==='gather'?'Gather':hand.gesture[0].toUpperCase()+hand.gesture.slice(1)}`,color);
    }
    if(sample.pointer){
      const p=sample.pointer,[x,y]=screen(p.x,p.y);
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+5,y+25);ctx.lineTo(x+12,y+17);ctx.lineTo(x+23,y+15);ctx.closePath();
      ctx.fillStyle=p.held?'#f2cf91':'#e6faff';ctx.strokeStyle='#080a14';ctx.lineWidth=3;ctx.fill();ctx.stroke();
      if(p.held){ctx.beginPath();ctx.arc(x,y,25+4*Math.sin(time*4),0,Math.PI*2);ctx.strokeStyle='#f2cf9180';ctx.lineWidth=2;ctx.stroke();}
      this.label(x,y+48,p.held?(p.metaKey?'Simulated · ⌘ + hold':'Simulated · click + hold'):'Simulated cursor','#e6faff');
    }
  }
  label(x,y,text,color){
    const ctx=this.ctx;ctx.font='500 12px "DM Sans", sans-serif';const width=ctx.measureText(text).width+20;
    x=Math.max(width/2+8,Math.min(innerWidth-width/2-8,x));
    ctx.fillStyle='#080a14e8';ctx.fillRect(x-width/2,y-13,width,26);ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(text,x,y+4);
  }
  dispose(){this.root.remove();}
}

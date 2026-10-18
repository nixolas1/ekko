import {extendedFingers} from './gestures.js';

const EDGES=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const POWERS={point:['Cursor','#bceefa'],none:['No gesture','#a1a8bd'],wand:['Pinch · Wand','#e6faff'],vortex:['Vortex','#c2abff'],pull:['Gather','#8be7ed'],push:['Push','#f2cf91']};
// A separate, transparent camera-landmark view for presentations. It uses the
// existing tracking results, never another camera stream or inference pass.
export class HandOverlay {
  constructor(root){
    this.root=root;this.canvas=root.querySelector('canvas');this.ctx=this.canvas.getContext('2d');
    this.status=root.querySelector('[data-hand-status]');this.labels=root.querySelector('[data-hand-labels]');
    this.note=root.querySelector('[data-hand-note]');this.hands=new Map();this.enabled=false;this.lastFrame=0;this.lastSeen=-Infinity;this.labelKey='';this.view=null;
  }
  setEnabled(enabled){this.enabled=!!enabled;this.root.hidden=!this.enabled;this.lastFrame=0;}
  update(data,states,time){
    const next=new Map();this.aspect=data.aspect||4/3;
    for(const [index,points] of (data.hands||[]).entries()){
      const fingers=extendedFingers(points,this.aspect);if(!fingers)continue;
      const id=data.handIds?.[index]??index,state=states.get(id),old=this.hands.get(id);
      const gesture=POWERS[state?.stable]?state.stable:state?.mode<0?'push':'pull';
      next.set(id,{target:points,points:old?.points||points.map(p=>({...p})),gesture,fingers});
    }
    this.hands=next;this.lastSeen=time;
  }
  clear(){this.hands.clear();this.view=null;this.lastSeen=-Infinity;this.lastFrame=0;}
  render(time,cameraActive){
    if(!this.enabled||time-this.lastFrame<1000/30)return;
    const dt=Math.min((time-this.lastFrame)/1000,.1);this.lastFrame=time;
    const live=cameraActive&&time-this.lastSeen<350;
    const hands=live?[...this.hands.values()].sort((a,b)=>b.target[9].x-a.target[9].x):[];
    this.status.textContent=!cameraActive?'Camera off':hands.length?`${hands.length} tracked`:'No hands';
    this.root.dataset.live=String(hands.length>0);
    this.note.hidden=hands.length>0;
    this.note.textContent=cameraActive?'Bring your hands into view':'Enable camera in Movement';
    const key=hands.map(h=>h.gesture).join('|');
    if(key!==this.labelKey){
      this.labels.replaceChildren(...hands.map((h,i)=>{
        const label=document.createElement('span'),[name,color]=POWERS[h.gesture];label.style.setProperty('--hand-color',color);
        label.textContent=`${i+1} · ${name}`;return label;
      }));this.labelKey=key;
    }
    const w=this.canvas.clientWidth,h=this.canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,2);
    if(!w||!h)return;
    const width=Math.round(w*dpr),height=Math.round(h*dpr);
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    const ctx=this.ctx;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const aspect=this.aspect||4/3,all=hands.flatMap(hand=>hand.target);
    // Frame the hands rather than the whole camera image, so fingers remain legible.
    // Smooth the shared crop to preserve relative hand positions without zoom jitter.
    if(!all.length){this.view=null;return;}
    const xs=all.map(p=>(1-p.x)*aspect),ys=all.map(p=>p.y);
    const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
    const target=[(x0+x1)/2,(y0+y1)/2,Math.max(.38,x1-x0+.14),Math.max(.4,y1-y0+.12)];
    if(!this.view)this.view=target;else{const a=1-Math.exp(-dt/.12);this.view=this.view.map((v,i)=>v+(target[i]-v)*a);}
    const [cx,cy,vw,vh]=this.view,fit=Math.min((w-16)/vw,(h-12)/vh);
    const xy=p=>[w/2+((1-p.x)*aspect-cx)*fit,h/2+(p.y-cy)*fit];
    for(const hand of hands){
      const a=1-Math.exp(-dt/.025);
      hand.points.forEach((p,i)=>{p.x+=(hand.target[i].x-p.x)*a;p.y+=(hand.target[i].y-p.y)*a;});
      const points=hand.points,[,color]=POWERS[hand.gesture];
      ctx.beginPath();[0,5,9,13,17].forEach((i,k)=>{const p=xy(points[i]);k?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();
      ctx.fillStyle=color+'18';ctx.fill();
      ctx.beginPath();for(const [a,b] of EDGES){ctx.moveTo(...xy(points[a]));ctx.lineTo(...xy(points[b]));}
      ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=color;ctx.lineWidth=2;ctx.shadowColor=color;ctx.shadowBlur=7;ctx.stroke();ctx.shadowBlur=0;
      points.forEach((p,i)=>{
        const tip=[8,12,16,20].indexOf(i),active=hand.gesture==='wand'?(i===4||i===8):tip>=0&&hand.fingers[tip];
        ctx.beginPath();ctx.arc(...xy(p),active?3.4:i===0?3:1.8,0,Math.PI*2);
        ctx.fillStyle=active?'#f6fbff':color;ctx.fill();
        if(active){ctx.beginPath();ctx.arc(...xy(p),5.8,0,Math.PI*2);ctx.strokeStyle=color+'70';ctx.lineWidth=1;ctx.stroke();}
      });
    }
  }
}

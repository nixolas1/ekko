// The world uses viewport-height units, so physics and collisions don't change with resolution.
export class WingFlaps {
  constructor(){this.reset();}
  reset(){this.ids='';this.last=null;this.peak=0;this.trough=0;this.armed=false;this.cooldown=0;}
  update(hands,dt){
    this.cooldown=Math.max(0,this.cooldown-dt);
    const selected=hands.slice(0,2),ids=selected.map(h=>h.id).sort().join('|');
    if(!selected.length){this.reset();return false;}
    const y=selected.reduce((sum,h)=>sum+h.y,0)/selected.length;
    if(this.last===null||ids!==this.ids){this.ids=ids;this.last=this.peak=this.trough=y;this.armed=false;return false;}
    this.trough=Math.min(this.trough,y);this.peak=Math.max(this.peak,y);
    if(y-this.trough>.07){this.armed=true;this.peak=y;this.trough=y;}
    const speed=(y-this.last)/Math.max(dt,1/120);this.last=y;
    if(this.armed&&this.peak-y>.065&&speed<-.35&&this.cooldown===0){this.armed=false;this.trough=y;this.peak=y;this.cooldown=.18;return true;}
    return false;
  }
}
export class FlightWorld {
  constructor(random=Math.random){this.random=random;this.reset();}
  reset(){this.y=.42;this.vy=0;this.distance=0;this.time=0;this.started=false;this.crash=0;this.flapTime=0;this.cooldown=0;this.buildings=[];this.birds=[];this.nextBuilding=0;this.nextBird=2;this.message='Løft hendene og slå dem ned · ↑ eller klikk flakser også';}
  flap(){if(this.crash>0||this.cooldown>0)return false;this.started=true;this.vy=-.34;this.flapTime=.28;this.cooldown=.13;return true;}
  update(dt,width=1.5){
    dt=Math.min(.04,Math.max(0,dt));this.time+=dt;this.flapTime=Math.max(0,this.flapTime-dt);this.cooldown=Math.max(0,this.cooldown-dt);
    if(this.crash>0){this.crash-=dt;if(this.crash<=0)this.reset();return;}
    if(!this.started)return;
    const speed=.32+Math.min(.16,this.distance/1500),px=width*.27,r=.012;
    this.distance+=speed*dt*50;this.vy+=.58*dt;this.y+=this.vy*dt;
    if(this.y<.06){this.y=.06;this.vy=Math.max(0,this.vy);}
    this.nextBuilding-=dt;this.nextBird-=dt;
    if(this.nextBuilding<=0){this.buildings.push({x:width+.1,w:.17+this.random()*.22,h:.17+this.random()*.24,seed:this.random()});this.nextBuilding=.8+this.random()*.6;}
    if(this.nextBird<=0){this.birds.push({x:width+.15,y:.17+this.random()*.16,phase:this.random()*6.28});this.nextBird=1.8+this.random()*2.1;}
    for(const b of this.buildings)b.x-=speed*dt;
    for(const b of this.birds)b.x-=(speed+.25)*dt;
    this.buildings=this.buildings.filter(b=>b.x+b.w>-.2);this.birds=this.birds.filter(b=>b.x>-.2);
    const roof=this.buildings.some(b=>px+r>b.x&&px-r<b.x+b.w&&this.y+r>1-b.h);
    const bird=this.birds.some(b=>Math.abs(px-b.x)<.055&&Math.abs(this.y-(b.y+Math.sin(this.time*2+b.phase)*.018))<.035);
    if(roof||bird||this.y> .97){this.crash=1.4;this.message=bird?'Poff! Vikeplikt for fugl. Prøv igjen …':'Poff! Partikler er dårlige taktekkere. Prøv igjen …';}
    else this.message='Over hustakene. Under fuglene. Flaks!';
  }
}
export class FlightGame extends FlightWorld {
  constructor(canvas){super();this.canvas=canvas;this.ctx=canvas.getContext('2d');this.wings=new WingFlaps();this.trail=[];canvas.addEventListener('pointerdown',()=>this.flap());}
  reset(){super.reset();this.wings?.reset();this.trail=[];}
  frame(dt,hands,paused,immersive){
    const canvas=this.canvas,ratio=Math.min(devicePixelRatio,1.5),w=innerWidth,h=innerHeight;
    if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}
    const usable=w>760&&!immersive?w-360:w,width=Math.max(.6,usable/h),px=width*.27;
    if(!paused){if(this.wings.update(hands,dt))this.flap();this.update(dt,width);this.trail.push({x:px,y:this.y,life:1});for(const p of this.trail){p.x-=dt*.35;p.life-=dt*1.7;}this.trail=this.trail.filter(p=>p.life>0).slice(-90);}
    const c=this.ctx;c.setTransform(ratio,0,0,ratio,0,0);c.fillStyle='#080d1b';c.fillRect(0,0,w,h);
    const sky=c.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#0a1028');sky.addColorStop(.65,'#19314a');sky.addColorStop(1,'#55404c');c.fillStyle=sky;c.fillRect(0,0,w,h);
    c.fillStyle='#9cece9';for(let i=0;i<70;i++){const x=((i*137.7-this.distance*1.3)%w+w)%w,y=(Math.sin(i*43.1)*.5+.5)*h*.6;c.globalAlpha=.15+(i%4)*.08;c.fillRect(x,y,1.5,1.5);}c.globalAlpha=1;
    c.fillStyle='#e7dfba';c.beginPath();c.arc(usable*.76,h*.2,h*.035,0,Math.PI*2);c.fill();
    // Slow skyline behind the collidable foreground roofs.
    for(let i=0;i<30;i++){const bw=h*.11,x=((i*bw-this.distance*2)%(w+bw*2)+w+bw*2)%(w+bw*2)-bw,bh=h*(.09+(Math.sin(i*9)*.5+.5)*.14);c.fillStyle='#172537';c.fillRect(x,h-bh,bw-2,bh);}
    for(const b of this.buildings){const x=b.x*h,y=(1-b.h)*h,bw=b.w*h,bh=b.h*h;c.fillStyle='#101a2b';c.fillRect(x,y,bw,bh);c.fillStyle='#7194a1';c.fillRect(x,y,bw,2);for(let row=0;row<Math.floor(bh/22)-1;row++)for(let col=0;col<Math.floor(bw/19)-1;col++){c.fillStyle=Math.sin(row*7+col*3+b.seed*100)>.1?'#e5ba6b66':'#334359';c.fillRect(x+9+col*19,y+12+row*22,5,8);}}
    for(const b of this.birds){const x=b.x*h,y=(b.y+Math.sin(this.time*2+b.phase)*.018)*h,wing=Math.sin(this.time*10+b.phase)*.026*h;c.strokeStyle='#c3ccd8';c.lineWidth=2;c.beginPath();c.moveTo(x-.04*h,y+wing);c.quadraticCurveTo(x-.02*h,y-.01*h,x,y);c.quadraticCurveTo(x+.02*h,y-.01*h,x+.04*h,y+wing);c.stroke();c.fillStyle='#9ae1e8';c.beginPath();c.arc(x,y,2.5,0,7);c.fill();}
    for(const p of this.trail){c.globalAlpha=p.life*.6;c.fillStyle='#79efe7';c.beginPath();c.arc(p.x*h,p.y*h,Math.max(1,p.life*3),0,7);c.fill();}c.globalAlpha=1;
    const x=px*h,y=this.y*h;
    if(this.crash>0){for(let i=0;i<28;i++){const a=i*2.399,r=(1.4-this.crash)*h*.22;c.globalAlpha=Math.min(1,this.crash);c.fillStyle=i%2?'#ffb97e':'#8df5f1';c.fillRect(x+Math.cos(a)*r,y+Math.sin(a)*r,3,3);}c.globalAlpha=1;}
    else{const wing=(this.flapTime/.28-.5)*h*.035;c.strokeStyle='#96f3efaa';c.lineWidth=1.4;c.beginPath();c.moveTo(x-h*.045,y-wing);c.quadraticCurveTo(x-h*.02,y-h*.012,x,y);c.quadraticCurveTo(x+h*.02,y-h*.012,x+h*.045,y-wing);c.stroke();const glow=c.createRadialGradient(x,y,0,x,y,18);glow.addColorStop(0,'#adfff0aa');glow.addColorStop(1,'#adfff000');c.fillStyle=glow;c.fillRect(x-18,y-18,36,36);c.fillStyle='#e6fff5';c.beginPath();c.arc(x,y,4,0,7);c.fill();}
  }
}

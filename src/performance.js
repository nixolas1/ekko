// A slow feedback loop avoids changing particle count on every noisy frame.
// Downshift quickly when frames miss 60 Hz; only probe upward after sustained headroom.
export class AdaptiveQuality {
  constructor(){this.maxCount=3145728;this.reset();}
  reset(){this.samples=[];this.elapsed=0;this.stable=0;this.poor=0;this.cooldown=1.5;}
  update(dt,count,scale=1,trackingMs=0){
    if(!Number.isFinite(dt)||dt<=0||dt>.25){this.reset();return null;}
    this.samples.push(dt*1000);this.elapsed+=dt;this.cooldown=Math.max(0,this.cooldown-dt);
    if(this.elapsed<.75||this.samples.length<20)return null;
    const values=this.samples.sort((a,b)=>a-b),mean=values.reduce((a,b)=>a+b,0)/values.length;
    const p95=values[Math.floor((values.length-1)*.95)],span=this.elapsed;
    this.samples=[];this.elapsed=0;
    const trackingBusy=trackingMs>28&&count>131072;
    if(mean>17.25||p95>21||trackingBusy){
      this.stable=0;this.poor+=span;
      if(this.cooldown||(p95<=21&&this.poor<1.3))return null;this.cooldown=1.5;this.poor=0;
      if(count>32768)return {count:Math.max(32768,Math.floor(count*(mean>23?.5:.75)/16384)*16384),scale};
      if(scale>.6)return {count,scale:Math.max(.6,Math.round((scale-.1)*100)/100)};
    }else if(mean<16.95&&p95<18.5&&trackingMs<23){
      this.poor=0;
      this.stable+=span;
      if(this.stable>=12&&!this.cooldown){
        this.stable=0;this.cooldown=2;
        if(scale<1)return {count,scale:Math.min(1,Math.round((scale+.05)*100)/100)};
        if(count<this.maxCount)return {count:Math.min(this.maxCount,Math.ceil(count*1.125/16384)*16384),scale};
      }
    }else {this.stable=0;this.poor=0;}
    return null;
  }
}

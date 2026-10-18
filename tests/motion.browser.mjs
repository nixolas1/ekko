import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-gpu']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.EKKO_TEST_URL||'http://127.0.0.1:5173');
 await page.waitForFunction(()=>document.querySelector('#gpu-status').textContent==='WebGPU active');
 await page.keyboard.press('h');
 const result=await page.evaluate(async()=>{
  const scene=document.querySelector('#scene'),dot=document.querySelector('#mouse-dot');
  const move=x=>scene.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:350,pointerType:'mouse',bubbles:true}));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  move(250);await wait(200);const initial=parseFloat(dot.style.left);
  move(700);const atArrival=parseFloat(dot.style.left),positions=[];
  const start=performance.now();
  while(performance.now()-start<600){await new Promise(requestAnimationFrame);positions.push(parseFloat(dot.style.left));}
  return {initial,atArrival,positions,end:parseFloat(dot.style.left),visible:getComputedStyle(dot).display!=='none'&&!dot.hidden};
 });
 assert.equal(result.initial,250);assert(Math.abs(result.atArrival-250)<.1,'new event must not snap the displayed cursor');
 assert(result.visible);assert(result.positions.filter(x=>x>251&&x<699).length>=3,'must render multiple intermediate positions');
 assert(Math.abs(result.end-700)<.1);assert(result.positions.every(x=>Number.isFinite(x)&&x>=249&&x<=701));
 // Exercise the real overlay at a deliberately sparse 2 Hz input rate.
 const overlay=await page.evaluate(async()=>{
  const {HandOverlay}=await import('/src/hand-overlay.js');
  const {HandForces}=await import('/src/interactions.js');
  const root=document.querySelector('#hand-demo'),view=new HandOverlay(root),forces=new HandForces();view.setEnabled(true);
  const {hand}=await import('/tests/motion-fixtures.js');
  for(const [time,x,a] of [[100,.4,0],[600,.5,.3],[1100,.6,.6]]){
   const data={hands:[hand(x,a)],handIds:[1],aspect:4/3,timestamp:time};
   forces.update(data,time,p=>[p.x,p.y]);view.update(data,forces.states,time);
  }
  view.render(1120,true);const first=view.hands.get(1).points[0];
  view.render(1128,true);const second=view.hands.get(1).points[0];
  const live=root.dataset.live,changed=Math.hypot(second.x-first.x,second.y-first.y)>0;
  view.render(1500,true);
  return {live,changed,stillLive:root.dataset.live,shared:view.hands.get(1).motion===forces.states.get(1).motion};
 });
 assert.deepEqual(overlay,{live:'true',changed:true,stillLive:'true',shared:true});
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'/tmp/ekko-motion-browser.png'});
 console.log(JSON.stringify({pass:true,intermediateFrames:result.positions.filter(x=>x>251&&x<699).length,overlay,errors}));
}finally{await browser.close();}

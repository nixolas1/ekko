import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('test-results',{recursive:true});
const base=process.env.EKKO_TEST_URL||'http://127.0.0.1:5174';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-gpu','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
// Synthetic landmarks are fed through the actual Tracking -> HandForces -> overlay path.
const mockWorker=`
function hand(x,up,pinch=false){
 const y=.8,palm=.14,points=Array.from({length:21},()=>({x,y,z:0}));
 const put=(i,dx,dy)=>points[i]={x:x+dx*palm,y:y+dy*palm,z:0};
 put(0,0,0);put(1,-.4,-.3);put(2,-.6,-.5);put(3,-.7,-.7);put(4,-.8,-.9);
 [[5,-.3],[9,0],[13,.3],[17,.55]].forEach(([m,dx],k)=>{const b=m===9?1:.92;put(m,dx,-b);put(m+1,dx,-b-.45);put(m+2,dx,-b-(up[k]?.75:.05));put(m+3,dx,-b-(up[k]?1:-.35));});if(pinch)points[4]={...points[8]};return points;
}
onmessage=({data:d})=>{if(d.type==='init')postMessage({type:'ready',backend:'Synthetic QA'});if(d.type==='frame'){d.bitmap.close();setTimeout(()=>postMessage({type:'result',hands:[hand(.28,d.qaGesture==='three'?[1,1,1,0]:[1,0,0,0],d.qaGesture==='pinch'),hand(.72,[1,1,0,0])],poses:[],width:640,height:480,timestamp:d.timestamp,ms:1,backend:'Synthetic QA'}),25);}};
`;
let p;const errors=[];
try{
 p=await browser.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/tracking-worker.js',r=>r.fulfill({contentType:'text/javascript',body:mockWorker}));
 await p.addInitScript(()=>{window.qaGesture='point';const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(d,...args){return post.call(this,{...d,qaGesture:window.qaGesture},...args);};window.burstCount=0;window.inputEvents=[];for(const t of ['pointerdown','pointerup','keydown','keyup','blur','dblclick'])addEventListener(t,e=>window.inputEvents.push({type:t,key:e.key,meta:e.metaKey,buttons:e.buttons,target:e.target.tagName}));const write=GPUQueue.prototype.writeBuffer;GPUQueue.prototype.writeBuffer=function(b,o,d,...args){if(d instanceof Float32Array&&d.length===356){window.u=Array.from(d);window.burstCount+=d[148];}return write.call(this,b,o,d,...args);};});
 await p.goto(base+'/?mode=persistent&force=1&count=131072&auto=0');await p.waitForFunction(()=>window.u);
 assert(await p.locator('#hand-demo').isHidden());
 await p.waitForFunction(()=>document.querySelector('#camera-button').textContent==='Stop camera');await p.locator('#camera-button').click();await p.waitForFunction(()=>u[11]===0);
 await p.keyboard.press('h');await p.mouse.move(400,300);await p.waitForFunction(()=>u[351]===1);
 const burst=await p.evaluate(()=>burstCount);await p.mouse.down();await p.waitForFunction(()=>u[11]===1&&u[18]===-18&&u[351]===0);
 await p.waitForFunction(n=>burstCount>n,burst);await p.mouse.up();await p.waitForFunction(()=>u[11]===0&&u[351]===1);
 const beforeCmd=await p.evaluate(()=>burstCount);await p.keyboard.down('Meta');await p.mouse.down();await p.waitForFunction(()=>u[11]===1&&u[18]===18&&u[351]===0);assert.equal(await p.evaluate(()=>burstCount),beforeCmd);
 await p.keyboard.up('Meta');await p.waitForFunction(()=>u[18]===-18);await p.mouse.up();await p.waitForFunction(()=>u[11]===0);
 await p.mouse.down();await p.waitForFunction(()=>u[11]===1);await p.waitForFunction(()=>u[11]===0&&u[351]===0,{},{timeout:7000});assert(await p.locator('#mouse-dot').isHidden());await p.mouse.up();
 const modes=await p.locator('[data-mode]').evaluateAll(bs=>bs.map(b=>b.dataset.mode));let mode='persistent';
 for(let i=0;i<modes.length;i++){await p.keyboard.press('n');mode=modes[(modes.indexOf(mode)+1)%modes.length];await p.waitForFunction(m=>document.querySelector(`[data-mode="${m}"]`).getAttribute('aria-pressed')==='true',mode);}
 const transport=await p.locator('#track-play').textContent();await p.keyboard.press('m');assert.equal(await p.locator('#track-play').textContent(),transport);
 await p.keyboard.press('h');await p.locator('#show-hands').check();await p.waitForFunction(()=>location.search.includes('showHands=1'));
 assert(await p.locator('#hand-demo').isVisible());await p.locator('#show-hands').uncheck();assert(await p.locator('#hand-demo').isHidden());await p.locator('#show-hands').check();assert.equal(await p.locator('[data-hand-status]').textContent(),'Camera off');
 await p.locator('#camera-button').click();await p.waitForFunction(()=>document.querySelector('[data-hand-labels]').textContent.includes('Vortex'),{},{timeout:15000});
 assert.match(await p.locator('[data-hand-labels]').textContent(),/Cursor/);assert.equal(await p.locator('[data-hand-status]').textContent(),'2 tracked');
 await p.waitForFunction(()=>u[19]<0&&u[186]===0&&u[190]===0&&u[191]>.95);
 const gesturesBurst=await p.evaluate(()=>burstCount);
 await p.evaluate(()=>window.qaGesture='pinch');
 await p.waitForFunction(()=>u[186]>.99&&u[19]>0&&document.querySelector('[data-hand-labels]').textContent.includes('Pinch · Wand'));
 await p.evaluate(()=>window.qaGesture='three');
 await p.waitForFunction(()=>Math.abs(u[18])<.001&&u[186]<.001&&document.querySelector('[data-hand-labels]').textContent.includes('No gesture'));
 assert.equal(await p.evaluate(()=>burstCount),gesturesBurst,'pinching and three fingers never burst');
 await p.evaluate(()=>window.qaGesture='point');await p.waitForFunction(()=>u[19]<0&&document.querySelector('[data-hand-labels]').textContent.includes('Cursor'));
 await p.screenshot({path:'test-results/hands-normal.png'});
 await p.keyboard.press('h');await p.mouse.move(400,300);await p.waitForFunction(()=>getComputedStyle(document.querySelector('.panel')).visibility==='hidden');await p.waitForTimeout(300);await p.screenshot({path:'test-results/hands-immersive.png'});
 const bounds=await p.locator('#hand-demo').boundingBox();assert(bounds.x+bounds.width<=1440&&bounds.y+bounds.height<=900);
 await p.mouse.move(1439,150);await p.waitForFunction(()=>document.body.classList.contains('settings-peek'));await p.waitForTimeout(350);
 const panel=await p.locator('.panel').boundingBox(),overlay=await p.locator('#hand-demo').boundingBox();assert(overlay.x+overlay.width<panel.x,'overlay clears settings drawer');
 await p.locator('#camera-button').click();await p.waitForFunction(()=>document.querySelector('[data-hand-status]').textContent==='Camera off');assert.equal(await p.locator('[data-hand-labels]').textContent(),'');
 await p.reload();await p.waitForFunction(()=>window.u);assert(await p.locator('#show-hands').isChecked());await p.waitForFunction(()=>document.querySelector('[data-hand-labels]').textContent.includes('Vortex'));
 await p.setViewportSize({width:390,height:844});await p.mouse.move(100,200);await p.waitForTimeout(400);await p.screenshot({path:'test-results/hands-mobile.png'});
 const mobile=await p.locator('#hand-demo').boundingBox();assert(mobile.x>=0&&mobile.x+mobile.width<=390);
 assert.deepEqual(errors,[]);console.log('PASS: pointing, pinch Wand, removed three-finger effect, no accidental gesture bursts, primary push, Command gather, modifier switching, release, inactivity, N wraparound, M ignored, overlay tracking/fullscreen/persistence, drawer clearance, camera stop, mobile bounds.');
}catch(e){console.log(await p.evaluate(()=>({u:window.u?.slice(8,20),events:window.inputEvents,body:document.body.className})));throw e;}finally{await browser.close();}

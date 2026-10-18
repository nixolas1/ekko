import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-gpu']});
const base=process.env.EKKO_TEST_URL||'http://127.0.0.1:5173';
const errors=[];let p;
try{
 p=await browser.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{
  window.tourAudio=[];const AudioOriginal=window.Audio;window.Audio=function(...args){const audio=new AudioOriginal(...args);window.tourAudio.push(audio);return audio;};
  const write=GPUQueue.prototype.writeBuffer;GPUQueue.prototype.writeBuffer=function(b,o,d,...args){if(d instanceof Float32Array&&d.length===356)window.u=Array.from(d);return write.call(this,b,o,d,...args);};
 });
 await p.goto(base+'/?mode=ring&palette=2&count=131072&auto=0&glow=1.1&force=.4');
 await p.waitForFunction(()=>!document.querySelector('#showcase-start').disabled);
 await p.waitForTimeout(1100);
 const before=await p.evaluate(()=>({url:location.href,settings:JSON.parse(localStorage.getItem('ekko:settings:v1'))}));
 await p.locator('#showcase-start').click();
 await p.waitForFunction(()=>window.tourAudio.some(a=>!a.paused&&a.currentTime>.1));
 assert(await p.locator('.showcase').isVisible());
 const modes=['fluid-ring','plume','duet','persistent','smoke','spectral','plume-glow','ring','sculpture'];
 for(let i=0;i<9;i++){
  await p.locator(`button[data-chapter="${i}"]`).click();await p.waitForTimeout(4300);
  assert.equal(await p.locator('[data-mode][aria-pressed=true]').getAttribute('data-mode'),modes[i]);
  const inputs=await p.evaluate(()=>({forces:u[11],hover:u[351],strength:u[18]}));
  assert(i===0?inputs.hover===1:inputs.forces>=1,JSON.stringify({i,inputs}));
  if([1,2,5,7].includes(i))await p.screenshot({path:`test-results/showcase-${modes[i]}.jpg`,type:'jpeg',quality:92});
  console.log('chapter',i,modes[i],inputs);
 }
 await p.locator('[data-tour=next]').click();assert.equal(await p.locator('.showcase').getAttribute('data-complete'),'true');
 await p.locator('[data-tour=next]').click();assert.equal(await p.locator('.showcase').getAttribute('data-chapter'),'0');
 await p.locator('[data-tour=pause]').click();
 const paused=await p.evaluate(()=>({time:tourAudio.at(-1).currentTime,progress:document.querySelector('button[data-chapter="0"] span').style.transform}));
 await p.waitForTimeout(600);assert.equal(await p.evaluate(()=>tourAudio.at(-1).currentTime),paused.time);assert.equal(await p.locator('button[data-chapter="0"] span').getAttribute('style'),`transform: ${paused.progress};`);
 await p.locator('[data-tour=pause]').click();
 await p.locator('[data-tour=mute]').click();assert.equal(await p.locator('[data-tour=mute]').getAttribute('aria-pressed'),'true');
 assert(await p.evaluate(()=>!tourAudio.at(-1).paused));
 await p.keyboard.press('Escape');assert(await p.locator('.showcase').isHidden());
 const after=await p.evaluate(()=>({url:location.href,settings:JSON.parse(localStorage.getItem('ekko:settings:v1'))}));
 assert.deepEqual(after,before);
 assert(await p.evaluate(()=>tourAudio.every(a=>a.paused)));
 await p.locator('#showcase-start').click();await p.locator('button[data-chapter="2"]').click();
 await p.waitForTimeout(4500);await p.setViewportSize({width:390,height:844});await p.waitForTimeout(350);
 await p.screenshot({path:'test-results/showcase-mobile.jpg',type:'jpeg',quality:92});
 const bounds=await p.locator('.showcase-lesson').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=844,JSON.stringify(bounds));
 await p.locator('[data-tour=try]').click();assert(await p.locator('.showcase').isHidden());assert.equal(await p.locator('[data-mode][aria-pressed=true]').getAttribute('data-mode'),'duet');
 await p.locator('#showcase-start').click();await p.keyboard.press('Escape');await p.waitForTimeout(500);assert(await p.evaluate(()=>tourAudio.every(a=>a.paused)));
 assert.deepEqual(errors,[]);console.log('PASS: nine actual GPU modes, demo inputs, music, pause, completion/replay, mute, settings restoration, mobile, Try mode and early exit.');
}finally{await browser.close();}

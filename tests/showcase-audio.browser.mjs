import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {createShowcaseScore} from '../src/showcase-music.js';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-gpu']});
const base=process.env.EKKO_TEST_URL||'http://127.0.0.1:5173';
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.audioElements=[];const Original=window.Audio;window.Audio=function(...args){const a=new Original(...args);audioElements.push(a);return a;};});
 await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#showcase-start').disabled);
 const score=createShowcaseScore();await page.locator('#audio-file').setInputFiles({name:'tour-test.wav',mimeType:'audio/wav',buffer:Buffer.from(await score.arrayBuffer())});
 await page.waitForFunction(()=>audioElements.some(a=>a.readyState>=2));
 await page.evaluate(()=>{window.selectedAudio=audioElements.at(-1);selectedAudio.pause();selectedAudio.currentTime=4;});
 await page.waitForTimeout(100);
 for(const playing of [false,true]){
  if(playing)await page.locator('#track-play').click();
  const before=await page.evaluate(()=>({time:selectedAudio.currentTime,count:audioElements.length}));
  await page.locator('#showcase-start').click();await page.waitForTimeout(500);
  assert.match(await page.locator('.showcase-music').textContent(),/Your selected music/);
  assert(await page.evaluate(()=>!selectedAudio.paused));
  assert.equal(await page.evaluate(()=>audioElements.length),before.count);
  await page.locator('[data-tour=mute]').click();await page.locator('[data-tour=exit]').click();
  assert.equal(await page.evaluate(()=>selectedAudio.paused),!playing);
  assert(Math.abs(await page.evaluate(()=>selectedAudio.currentTime)-before.time)<.5);
 }
 // A blocked audio start must leave the tour usable and offer a working retry.
 await page.evaluate(()=>{selectedAudio.pause();window.oldPlay=selectedAudio.play.bind(selectedAudio);selectedAudio.play=()=>Promise.reject(new DOMException('Blocked','NotAllowedError'));});
 await page.locator('#showcase-start').click();await page.waitForFunction(()=>document.querySelector('[data-tour=mute]').textContent==='Retry music');
 await page.evaluate(()=>selectedAudio.play=oldPlay);await page.locator('[data-tour=mute]').click();
 await page.waitForFunction(()=>!selectedAudio.paused&&document.querySelector('.showcase-message').hidden);
 await page.setViewportSize({width:844,height:390});
 await page.keyboard.press('ArrowRight');assert.equal(await page.locator('.showcase').getAttribute('data-chapter'),'1');
 const box=await page.locator('.showcase-lesson').boundingBox();assert(box.y>=70&&box.y+box.height<=390);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('.showcase').getAttribute('data-paused'),'true');assert(await page.evaluate(()=>selectedAudio.paused));
 await page.evaluate(()=>{delete document.hidden;});
 await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);console.log('PASS: existing music reused, paused/playing position restored, muted source restored, audio rejection and retry.');
}finally{await browser.close();}

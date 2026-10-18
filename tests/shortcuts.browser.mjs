import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-gpu']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.EKKO_TEST_URL||'http://127.0.0.1:5173')+'/?mode=persistent&force=1&count=65536&auto=0');
 await page.waitForFunction(()=>document.querySelector('#gpu-status').textContent==='WebGPU active');
 const force=()=>page.locator('#force-power').inputValue();
 const palette=()=>page.locator('[data-palette][aria-pressed="true"]').getAttribute('data-palette');
 const mode=()=>page.locator('[data-mode][aria-pressed="true"]').getAttribute('data-mode');
 const initialForce=await force(),initialPalette=await palette();
 await page.keyboard.press('2');await page.keyboard.press('ArrowRight');
 assert.equal(await force(),initialForce);assert.equal(await palette(),initialPalette);
 await page.locator('#immersive').click();await page.mouse.move(400,300);
 await page.waitForFunction(()=>!!document.fullscreenElement&&document.body.classList.contains('immersive'));
 await page.keyboard.press('ArrowRight');assert.equal(Number(await force()),Number(initialForce)+10);
 await page.keyboard.press('ArrowLeft');assert.equal(await force(),initialForce);
 await page.keyboard.press('ArrowUp');assert.equal(await page.locator('#particles').inputValue(),'131072');
 await page.keyboard.press('ArrowDown');assert.equal(await page.locator('#particles').inputValue(),'65536');
 const originalTrack=await page.locator('#track-select').inputValue();
 for(const digit of [7,2,5,1,6,3,4]){await page.keyboard.press(String(digit));assert.equal(Number(await palette()),digit-1);}
 assert.equal(await mode(),'persistent');assert.equal(await page.locator('#track-select').inputValue(),originalTrack);
 await page.keyboard.press('Numpad2');assert.equal(Number(await palette()),3);
 await page.keyboard.press('n');assert.equal(await mode(),'sculpture');
 const track=await page.locator('#track-select').inputValue();await page.keyboard.press('.');
 assert.notEqual(await page.locator('#track-select').inputValue(),track);
 await page.waitForFunction(()=>document.querySelector('#audio-status').textContent==='Playing');
 await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('#audio-status').textContent==='Paused');
 // Open the drawer: shortcuts stop, and focused selects retain native navigation.
 await page.mouse.move(1439,150);await page.waitForFunction(()=>document.body.classList.contains('settings-peek'));
 const before=await palette();await page.keyboard.press('2');assert.equal(await palette(),before);
 await page.locator('#particles').selectOption('auto');
 await page.mouse.move(400,300);await page.waitForFunction(()=>!document.body.classList.contains('settings-peek'));
 await page.keyboard.press('ArrowDown');assert.notEqual(await page.locator('#particles').inputValue(),'auto');
 // Wrap to a fluid mode, where the particle selector is deliberately disabled.
 await page.keyboard.press('n');assert.equal(await mode(),'fluid-ring');
 const count=await page.locator('#particles').inputValue();await page.keyboard.press('ArrowUp');
 assert.equal(await page.locator('#particles').inputValue(),count);
 assert.match(await page.locator('#notice').textContent(),/fluid simulation/);
 assert.deepEqual(errors,[]);
 console.log('PASS: fullscreen, menu gating, force and count changes, manual override, fluid mode guard, top-row and numpad distinction, next mode, next song playback.');
}finally{await browser.close();}

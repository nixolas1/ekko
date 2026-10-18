import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-gpu']});
try{
 const page=await browser.newPage({viewport:{width:800,height:600}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto((process.env.EKKO_TEST_URL||'http://127.0.0.1:5173')+'/tests/hand-powers.html');
 const result=await page.evaluate(()=>window.runHandPowers());
 assert.deepEqual(errors,[]);assert(result.pass,JSON.stringify(result,null,2));
 console.log('PASS: pointing matches mouse obstacle output in all nine GPU modes; Wand, Vortex, Push and palm burst remain functional.');
}finally{await browser.close();}

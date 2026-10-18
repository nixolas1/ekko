import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {starter} from '../src/remix/schema.js';
const base=process.env.EKKO_TEST_URL||'http://127.0.0.1:5173';
if(!process.env.DATABASE_URL)throw new Error('Run with --env-file=.env.local for real Neon verification.');
const sql=neon(process.env.DATABASE_URL),created=[];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-gpu']});
try{
 const p=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/remix/');assert.equal(await p.locator('#templates .scene-card').count(),9);
 await p.goto(base+'/remix/edit/?template=plume');await p.waitForTimeout(700);
 async function run(){await p.locator('#run').click();await p.waitForFunction(()=>!document.querySelector('#run').disabled);assert.match(await p.locator('#diagnostics').textContent(),/Compiled successfully/);}
 await run();await p.locator('#music').click();await p.waitForFunction(()=>document.querySelector('#music').textContent==='Pause music');
 const valid=await p.locator('#code').inputValue();
 await p.locator('#code').fill(valid.replace('return rgb;','return missingColor;'));await p.locator('#run').click();await p.waitForFunction(()=>!document.querySelector('#run').disabled);assert.match(await p.locator('#diagnostics').textContent(),/Line.*missingColor/);assert(await p.locator('#preview-cover').isHidden());
 await p.waitForTimeout(500);assert.match(await p.evaluate(()=>JSON.parse(localStorage.getItem('ekko:remix:drafts:v1'))[0].document.code),/missingColor/);
 await p.locator('#code').fill(valid.replace('return rgb;','return rgb * vec3f(0.6, 0.9, 1.0);'));await run();
 await p.locator('#title').fill('QA remix '+Date.now());
 const saved=p.waitForResponse(r=>r.url().includes('/api/remixes')&&r.request().method()==='POST');await p.locator('#save-cloud').click();const response=await saved;assert.equal(response.status(),201,await response.text());const first=await response.json();created.push(first.id);
 assert(first.thumbnail.startsWith('data:image/webp;base64,'));assert(first.thumbnail.length>1000);assert.equal(first.visibility,'unlisted');await p.waitForURL('**/remix/'+first.id+'/');
 const listing=await (await fetch(base+'/api/remixes')).json();assert(!listing.items.some(i=>i.id===first.id));
 const bad=await fetch(base+'/api/remixes?id='+first.id,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+'y'.repeat(43)},body:JSON.stringify({document:first.document,expectedRevision:1})});assert.equal(bad.status,403);
 await p.locator('#description').fill('A verified live WebGPU test scene.');const update=p.waitForResponse(r=>r.url().includes('/api/remixes?id=')&&r.request().method()==='PUT');await p.locator('#save-cloud').click();assert.equal((await update).status(),200);
 const conflict=await fetch(base+'/api/remixes?id='+first.id,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+first.editKey},body:JSON.stringify({document:first.document,expectedRevision:1})});assert.equal(conflict.status,409);
 const history=await (await fetch(base+'/api/remixes?id='+first.id+'&action=history')).json();assert.equal(history.items.length,2);
 await p.locator('#publish').click();const publication=p.waitForResponse(r=>r.request().method()==='PUT');await p.locator('#confirm-publish').click();assert.equal((await publication).status(),200);
 assert((await (await fetch(base+'/api/remixes')).json()).items.some(i=>i.id===first.id));
 // A fresh browser can view but does not receive edit credentials or auto-run WGSL.
 const viewer=await browser.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto(base+'/remix/'+first.id+'/');await viewer.waitForSelector('#code');assert(await viewer.locator('#preview-cover').isVisible());assert(await viewer.locator('#private-link').isHidden());
 await viewer.goto(base+'/remix/'+first.id+'/#edit='+first.editKey);await viewer.waitForFunction(()=>!location.hash);assert.equal(new URL(viewer.url()).hash,'');assert(await viewer.locator('#private-link').isVisible());await viewer.close();
 const unlisting=p.waitForResponse(r=>r.request().method()==='PUT');await p.locator('#unlist').click();assert.equal((await unlisting).status(),200);assert(!(await (await fetch(base+'/api/remixes')).json()).items.some(i=>i.id===first.id));assert(await p.locator('#unlist').isHidden());
 await p.locator('#ask-ai').click();assert.match(await p.locator('#agent-brief').inputValue(),/remix-guide.md/);assert(!(await p.locator('#agent-brief').inputValue()).includes(first.editKey));await p.locator('dialog .close').click();
 await p.screenshot({path:'test-results/remix-editor-verified.png'});
 // Exercise replacement bindings for every base mode, including fluid and volume targets.
 for(const mode of ['duet','spectral','fluid-ring','smoke','plume-glow','ring','persistent','sculpture']){await p.locator('#mode').selectOption(mode);await run();await p.waitForTimeout(300);assert.match(await p.locator('#diagnostics').textContent(),/Compiled successfully/,mode);}
 // A procedural image can ignore the base scene; pipeline bindings must still work.
 await p.locator('#code').fill(valid.replace('return rgb;','return vec3f(uv.x, uv.y, 0.5 + 0.5 * sin(t));'));await run();await p.waitForTimeout(300);assert.match(await p.locator('#diagnostics').textContent(),/Compiled successfully/);
 await p.locator('#code').fill(valid);await run();
 await p.setViewportSize({width:390,height:844});await p.waitForTimeout(350);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:'test-results/remix-mobile.png'});
 await p.goto(base+'/remix/agent/');assert(await p.locator('#copy-guide').isVisible());
 // Agent API: create an unlisted fork, preserve lineage, return a usable private link.
 const agent=await fetch(base+'/api/remixes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document:{...starter('duet'),title:'QA agent fork'},parentId:first.id,parentRevision:1})});assert.equal(agent.status,201);const fork=await agent.json();created.push(fork.id);assert.equal(fork.parentId,first.id);assert.equal(fork.parentRevision,1);assert.equal(fork.visibility,'unlisted');
 assert.deepEqual(errors,[]);console.log('PASS: nine GPU modes, invalid-code recovery, unfinished local drafts, real Neon create/revisions/conflict/ownership, publish/list, private links, agent fork, mobile and AI guide.');
}finally{
 await browser.close();
 if(created.length){await sql`DELETE FROM ekko_remixes WHERE id=ANY(${created}::uuid[])`;console.log('Removed only the test-created remix records.');}
}

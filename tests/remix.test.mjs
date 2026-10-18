import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {starter,DEFAULT_CODE,validateDocument,validateCode,MODES} from '../src/remix/schema.js';
import {remixSources} from '../src/remix/shader.js';
import {saveDraft,drafts,saveKey,keys} from '../src/remix/drafts.js';
import {createRemixHandler} from '../server/remix-handler.js';
const id='e836d93d-9c2d-4f5d-895d-d9b44632312d';
function storage(){const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};}
async function call(handler,{method='GET',url='/api/remixes',body,headers={}}={}){
 const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);Object.assign(req,{method,url,headers:{host:'localhost',...(body?{'content-type':'application/json'}:{}),...headers},socket:{remoteAddress:'test'}});
 let value;const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){value=JSON.parse(v);}};
 await handler(req,res);return {status:res.statusCode,body:value,headers:res.headers};
}
test('all starter modes validate, documents are bounded and extra fields do not escape',()=>{
 for(const mode of MODES)assert.equal(validateDocument(starter(mode)).mode,mode);
 const doc=starter();assert.throws(()=>validateDocument({...doc,title:''}));assert.throws(()=>validateDocument({...doc,mode:'hacked'}));assert.throws(()=>validateDocument({...doc,settings:{speed:NaN}}));assert.throws(()=>validateDocument({...doc,code:'x'.repeat(12001)}));
 assert.throws(()=>validateDocument({...doc,settings:{palette:1.5}}));
 assert.equal(validateDocument({...doc,editKey:'secret'}).editKey,undefined);
});
test('shader surface excludes unbounded execution, bindings, globals and cross-hook calls',()=>{
 assert.equal(validateCode(DEFAULT_CODE),DEFAULT_CODE);
 for(const code of [DEFAULT_CODE+'\nvar secret: f32;',DEFAULT_CODE.replace('return rgb;','loop { } return rgb;'),DEFAULT_CODE.replace('return rgb;','return lightRamp(rgb,rgb,rgb,rgb,t);'),DEFAULT_CODE.replace('return rgb;','return params.sound.xyz;'),DEFAULT_CODE.replace('return rgb;','return remixForce(rgb,t,audio,pointer);'),DEFAULT_CODE+'\n@compute fn extra() {}'])assert.throws(()=>validateCode(code));
 assert.doesNotThrow(()=>validateCode(DEFAULT_CODE.replace('return rgb;','if (audio.x > 0.5) { return rgb * 1.2; } return rgb;')));
});
test('compiler wraps all four particle stores and final composite only',()=>{
 const source=readFileSync('src/particles.wgsl','utf8')+'\n'+readFileSync('src/reference-simulation.wgsl','utf8');
 const post=readFileSync('src/post-shader.wgsl','utf8');const result=remixSources(DEFAULT_CODE,source,post);
 assert.equal((result.compute.match(/particles\[id\] = applyRemix\(/g)||[]).length,4);
 assert.match(result.post,/clamp\(remixColor/);assert.throws(()=>remixSources(DEFAULT_CODE,source,''));
});
test('local drafts preserve unfinished shader code; keys stay out of documents',()=>{
 const s=storage();const doc={...starter(),code:'unfinished shader'};saveDraft({localId:'one',document:doc},s);assert.equal(drafts(s)[0].document.code,doc.code);
 saveKey(id,'x'.repeat(43),s);assert.equal(keys(s)[id],'x'.repeat(43));assert(!JSON.stringify(drafts(s)).includes('x'.repeat(43)));
 assert.throws(()=>saveKey(id,'bad',s));
});
test('schema stays available without a database; cloud failure is explicit',async()=>{
 const handler=createRemixHandler({getStore:()=>null});assert.equal((await call(handler,{url:'/api/remixes?action=schema'})).status,200);assert.equal((await call(handler)).status,503);
});
test('API validates origin, content, thumbnails, parent revisions and method before writing',async()=>{
 let writes=0;const handler=createRemixHandler({getStore:()=>({rateLimit:async()=>true,create:async()=>{writes++;return {};}})}),body={document:starter()};
 for(const args of [
  {method:'DELETE'},
  {method:'POST',body:null,headers:{'content-type':'application/json'}},
  {method:'POST',body,headers:{origin:'https://foreign.test'}},
  {method:'POST',body,headers:{'content-type':'text/plain'}},
  {method:'POST',body:{...body,thumbnail:'data:image/svg+xml,<svg/>'}},
  {method:'POST',body:{...body,parentId:id,parentRevision:'invalid'}},
  {method:'POST',body:{...body,document:{...starter(),code:'x'.repeat(12001)}}},
 ])assert((await call(handler,args)).status>=400);
 assert.equal(writes,0);
});
test('anonymous create defaults unlisted, exposes a key once, and checks revision ownership',async()=>{
 let created;const store={rateLimit:async()=>true,create:async data=>{created=data;return {...data,id,revision:1,editKey:'x'.repeat(43)};},update:async(_id,key,data)=>key==='x'.repeat(43)?data.expectedRevision===1?{item:{id,revision:2}}:{error:'conflict'}:{error:'forbidden'}};
 const handler=createRemixHandler({getStore:()=>store});const first=await call(handler,{method:'POST',body:{document:starter()}});assert.equal(first.status,201);assert.equal(created.visibility,'unlisted');assert.match(first.body.editUrl,/#edit=/);
 const put=key=>({method:'PUT',url:'/api/remixes?id='+id,headers:{authorization:'Bearer '+key},body:{document:starter(),expectedRevision:1}});
 assert.equal((await call(handler,put('y'.repeat(43)))).status,403);const result=await call(handler,put('x'.repeat(43)));assert.equal(result.status,200);assert.equal(result.body.editKey,undefined);
 const stale=put('x'.repeat(43));stale.body.expectedRevision=2;assert.equal((await call(handler,stale)).status,409);
});
test('save limits reject requests without storing a scene',async()=>{
 const handler=createRemixHandler({getStore:()=>({rateLimit:async()=>false})});const response=await call(handler,{method:'POST',body:{document:starter()}});assert.equal(response.status,429);assert.equal(response.headers['Retry-After'],'3600');
});

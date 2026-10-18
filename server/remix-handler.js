import {validateDocument,DEFAULT_CODE,MODES,MODE_NAMES} from '../src/remix/schema.js';
import {neonStore} from './remix-store.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error=(status,message)=>Object.assign(new Error(message),{status});
function thumbnail(value=''){
 if(value==='')return '';
 if(typeof value!=='string'||value.length>110000||!/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(value))throw error(400,'Preview must be a WebP image under 80 KB.');
 const bytes=Buffer.from(value.split(',')[1],'base64');
 if(bytes.length>80000||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw error(400,'Invalid WebP preview.');
 return value;
}
async function readBody(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw error(415,'Send application/json.');
 if(Number(req.headers['content-length'])>160000)throw error(413,'Request is too large.');
 if(req.body){const s=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(Buffer.byteLength(s)>160000)throw error(413,'Request is too large.');return typeof req.body==='string'?JSON.parse(s):req.body;}
 let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>160000)throw error(413,'Request is too large.');}return JSON.parse(text);
}
export function createRemixHandler({getStore=()=>process.env.DATABASE_URL?neonStore(process.env.DATABASE_URL):null,logger=console}={}){
 return async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const reply=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  try{
   const url=new URL(req.url,'http://localhost'),id=url.searchParams.get('id'),action=url.searchParams.get('action');
   if(req.method==='GET'&&action==='schema')return reply(200,{version:1,modes:MODES.map((mode,i)=>({id:mode,name:MODE_NAMES[i]})),defaultCode:DEFAULT_CODE,guide:'/remix-guide.md',openapi:'/remix-openapi.json',maxCodeCharacters:12000,maxRevision:100});
   if(!['GET','POST','PUT'].includes(req.method)){res.setHeader('Allow','GET, POST, PUT');throw error(405,'Method not allowed.');}
   if(id&&!UUID.test(id))throw error(400,'Invalid remix id.');
   const store=getStore();if(!store)throw error(503,'Cloud sharing is not configured. Local drafts and exports still work.');
   if(req.method==='GET'){
    if(id){
     const revision=url.searchParams.get('revision');if(revision&&(!/^\d+$/.test(revision)||+revision<1||+revision>100))throw error(400,'Invalid revision.');
     const item=await store.get(id,revision?+revision:null);if(!item)throw error(404,'Remix not found.');
     if(action==='history')return reply(200,{items:await store.history(id)});
     return reply(200,item);
    }
    const offset=url.searchParams.get('offset')||'0';if(!/^\d+$/.test(offset)||+offset>10000)throw error(400,'Invalid gallery page.');
    return reply(200,await store.list(+offset));
   }
   const origin=req.headers.origin;
   if(origin&&new URL(origin).host!==req.headers.host)throw error(403,'Use the same-origin editor or an API client.');
   const input=await readBody(req);if(!input||typeof input!=='object'||Array.isArray(input))throw error(400,'Expected a JSON object.');let document;try{document=validateDocument(input.document);}catch(e){throw error(400,e.message);}
   const visibility=input.visibility??'unlisted';if(!['unlisted','public'].includes(visibility))throw error(400,'Choose public or unlisted.');
   const image=thumbnail(input.thumbnail);
   // The platform overwrites x-real-ip. Never accept a client-supplied forwarding
   // chain as an identity. Local development uses the actual socket address.
   const ip=process.env.VERCEL?String(req.headers['x-real-ip']||'unknown'):req.socket?.remoteAddress||'local';
   if(!await store.rateLimit(ip)){res.setHeader('Retry-After','3600');throw error(429,'Too many saves. Keep a local draft and try again later.');}
   if(req.method==='POST'){
    let parentId=input.parentId??null,parentRevision=input.parentRevision??null;
    if(parentRevision!==null&&(!Number.isInteger(parentRevision)||parentRevision<1||parentRevision>100))throw error(400,'Invalid parent revision.');
    if(parentId){if(!UUID.test(parentId))throw error(400,'Invalid parent id.');const parent=await store.get(parentId,parentRevision);if(!parent)throw error(404,'Original remix not found.');parentRevision=parent.revision;}
    else parentRevision=null;
    const item=await store.create({document,thumbnail:image,visibility,parentId,parentRevision});
    return reply(201,{...item,url:`/remix/${item.id}/`,editUrl:`/remix/${item.id}/#edit=${item.editKey}`});
   }
   if(!id)throw error(400,'A remix id is required.');
   const key=String(req.headers.authorization||'').replace(/^Bearer /,'');if(!/^[\w-]{43}$/.test(key))throw error(403,'Open your private editing link or remix this scene into a new draft.');
   if(!Number.isInteger(input.expectedRevision)||input.expectedRevision<1||input.expectedRevision>=100)throw error(400,'Supply the current revision (under 100); fork to continue after revision 100.');
   const result=await store.update(id,key,{document,thumbnail:image,visibility,expectedRevision:input.expectedRevision});
   if(result.error)throw error(result.error==='forbidden'?403:409,result.error==='forbidden'?'This editing key does not own the remix.':'A newer revision exists. Reload or fork your work before saving.');
   return reply(200,{...result.item,url:`/remix/${id}/`});
  }catch(e){
   const status=e.status||(e instanceof SyntaxError?400:500);
   if(status===500)logger.error('Remix API failed:',e.code||e.name); // Never log credentials or request bodies.
   reply(status,{error:status===500?'Cloud storage is temporarily unavailable. Your local draft is safe.':e.message});
  }
 };
}

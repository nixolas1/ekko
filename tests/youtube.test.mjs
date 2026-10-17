import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {parseYouTubeVideoId,youtubeImportUrl,importYouTubeAudio,YouTubeImportError,MAX_YOUTUBE_BYTES} from '../src/youtube.js';

const ID='fpViZkhpPHk';
const VALID=[
 [ID,ID],[`https://www.youtube.com/watch?v=${ID}`,ID],[`https://youtube.com/watch?v=${ID}&t=42s&list=PLx`,ID],[`www.youtube.com/watch?v=${ID}`,ID],
 [`https://m.youtube.com/watch?v=${ID}`,ID],[`https://music.youtube.com/watch?v=${ID}`,ID],[`https://youtu.be/${ID}?si=tracking`,ID],
 [`https://www.youtube.com/shorts/${ID}`,ID],[`https://www.youtube.com/live/${ID}`,ID],[`https://www.youtube.com/embed/${ID}`,ID],
 [`https://www.youtube-nocookie.com/embed/${ID}`,ID],[`  HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}  `,ID],['https://youtu.be/-1jPUB7gRyg','-1jPUB7gRyg'],
];
const INVALID=[
 ['','missing-url'],['   ','missing-url'],[`https://evil.example/watch?v=${ID}`,'not-youtube'],[`https://youtube.com.evil.example/watch?v=${ID}`,'not-youtube'],
 [`https://evilyoutube.com/watch?v=${ID}`,'not-youtube'],['http://169.254.169.254/latest/meta-data','not-youtube'],['http://localhost:3000/','bad-url'],['http://127.0.0.1/','not-youtube'],
 [`https://user:pw@www.youtube.com/watch?v=${ID}`,'bad-url'],[`https://www.youtube.com:8443/watch?v=${ID}`,'bad-url'],[`ftp://www.youtube.com/watch?v=${ID}`,'bad-url'],
 [`javascript:alert(1)//www.youtube.com/watch?v=${ID}`,'bad-url'],['https://www.youtube.com/playlist?list=PL123','bad-url'],
 [`https://www.youtube.com/watch?v=${ID}&v=lI5m0-oc9lI`,'bad-url'],['https://www.youtube.com/watch?v=short','bad-url'],[`https://www.youtube.com/watch?v=${ID}x`,'bad-url'],
 [`https://www.youtube.com/channel/${ID}`,'bad-url'],[`https://youtu.be/${ID}/extra`,'bad-url'],[`https://www.youtube-nocookie.com/shorts/${ID}`,'bad-url'],
 [`https://www.youtube.com/watch?v=${ID}`.padEnd(2100,'x'),'bad-url'],
];

test('accepts single-video YouTube links and bare ids',()=>{for(const [input,id] of VALID)assert.equal(parseYouTubeVideoId(input),id,input);});

test('rejects other hosts, credentials, odd ports, playlists and malformed ids with a clear code',()=>{
 for(const [input,code] of INVALID)assert.throws(()=>parseYouTubeVideoId(input),e=>e instanceof YouTubeImportError&&e.code===code&&e.message.length>0,input.slice(0,80));
 assert.throws(()=>parseYouTubeVideoId(null),{code:'missing-url'});
});

test('only the canonical watch URL is sent to the import endpoint',()=>{
 assert.equal(youtubeImportUrl(`https://youtu.be/${ID}?si=secret&list=PLx`),`/api/youtube?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`)}`);
});

test('the server-side parser in api/youtube.py agrees with the browser parser',t=>{
 const py=spawnSync('python3',['-I','-c',`
import sys,json,importlib.util
spec=importlib.util.spec_from_file_location('yt',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
out=[]
for s in json.load(sys.stdin):
  try: out.append(['ok',m.parse_video_id(s)])
  except m.ImportFailure as e: out.append(['err',e.code])
print(json.dumps({'parse':out,
 'media':[m.is_media_url(u) for u in ['https://rr3---sn-x.googlevideo.com/videoplayback?a=1','http://rr3---sn-x.googlevideo.com/v','https://googlevideo.com.evil.example/v','https://evil.example/?h=.googlevideo.com','https://u@rr3.googlevideo.com/v','https://rr3.googlevideo.com:8080/v']],
 'classify':[m.classify(s).code for s in ["Sign in to confirm you're not a bot. Use --cookies","Sign in to confirm your age. This video may be inappropriate for some users.","Private video. Sign in if you've been granted access","Video unavailable. This content isn't available.","This video is DRM protected","HTTP Error 500"]],
 'allowed':sorted(m.allowed_ids())}))
`,fileURLToPath(new URL('../api/youtube.py',import.meta.url))],{input:JSON.stringify([...VALID,...INVALID].map(([s])=>s)),encoding:'utf8',env:{PATH:process.env.PATH,EKKO_YOUTUBE_ALLOWED_IDS:'fpViZkhpPHk,lI5m0-oc9lI,waOuUycRRYs,-1jPUB7gRyg,Jo2PuYWaNH8'}});
 if(py.error){t.skip('python3 not available');return;}
 assert.equal(py.status,0,py.stderr);
 const result=JSON.parse(py.stdout);
 assert.deepEqual(result.parse,[...VALID.map(([,id])=>['ok',id]),...INVALID.map(([,code])=>['err',code])]);
 assert.deepEqual(result.media,[true,false,false,false,false,false],'media is only fetched from https googlevideo hosts');
 assert.deepEqual(result.classify,['youtube-blocked','age-restricted','unavailable','unavailable','drm','extract-failed']);
 assert.deepEqual(result.allowed,['-1jPUB7gRyg','Jo2PuYWaNH8','fpViZkhpPHk','lI5m0-oc9lI','waOuUycRRYs'],'configured allowlist is respected');
});

const audioResponse=(bytes,headers={},{length=bytes.length,status=200}={})=>new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.subarray(i,i+3));c.close();}}),
 {status,headers:{'content-type':'audio/mp4',...(length===null?{}:{'content-length':String(length)}),...headers}});

test('imports streamed audio as a File for AudioInput.file(), without playing it',async()=>{
 const bytes=new Uint8Array(20).map((_,i)=>i);let requested,progress=[];
 const result=await importYouTubeAudio(`https://youtu.be/${ID}`,{onProgress:(r,t)=>progress.push([r,t]),fetchImpl:async(url,init)=>{requested={url,init};
  return audioResponse(bytes,{'x-ekko-title':'Particle tests %2815%29 3D: Music%2FVisualizer','x-ekko-channel':'MatthiasM.de','x-ekko-duration':'218'});}});
 assert.equal(requested.url,`/api/youtube?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`)}`);assert.equal(requested.init.credentials,'same-origin');
 assert.ok(result.file instanceof File);assert.equal(result.file.type,'audio/mp4');assert.equal(result.file.size,20);
 assert.deepEqual(new Uint8Array(await result.file.arrayBuffer()),bytes);
 assert.equal(result.file.name,'Particle tests (15) 3D MusicVisualizer.m4a');
 assert.deepEqual([result.videoId,result.title,result.channel,result.duration],[ID,'Particle tests (15) 3D: Music/Visualizer','MatthiasM.de',218]);
 assert.deepEqual(progress.at(-1),[20,20]);
});

test('server errors surface their JSON message and code',async()=>{
 const json=(status,body)=>async()=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8'}});
 for(const [status,code] of [[403,'not-allowed'],[503,'youtube-blocked'],[404,'unavailable'],[413,'too-long']])
  await assert.rejects(importYouTubeAudio(ID,{fetchImpl:json(status,{error:`message for ${code}`,code})}),{name:'YouTubeImportError',code,status,message:`message for ${code}`});
});

test('a static host without the function, network failures and bad bodies fail clearly',async()=>{
 await assert.rejects(importYouTubeAudio(ID,{fetchImpl:async()=>new Response('<!doctype html>',{status:404,headers:{'content-type':'text/html'}})}),{code:'no-api'});
 await assert.rejects(importYouTubeAudio(ID,{fetchImpl:async()=>new Response('<!doctype html>',{status:200,headers:{'content-type':'text/html'}})}),{code:'no-api'});
 await assert.rejects(importYouTubeAudio(ID,{fetchImpl:async()=>{throw new TypeError('Failed to fetch');}}),{code:'network'});
 await assert.rejects(importYouTubeAudio(ID,{fetchImpl:async()=>audioResponse(new Uint8Array(0),{},{length:null})}),{code:'empty'});
 await assert.rejects(importYouTubeAudio(ID,{fetchImpl:async()=>audioResponse(new Uint8Array(10),{},{length:30})}),{code:'truncated'});
 await assert.rejects(importYouTubeAudio('https://example.com/a.mp3',{fetchImpl:async()=>assert.fail('must not fetch')}),{code:'not-youtube'});
 const abort=Object.assign(new Error('aborted'),{name:'AbortError'});
 await assert.rejects(importYouTubeAudio(ID,{fetchImpl:async()=>{throw abort;}}),e=>e===abort);
});

test('downloads are bounded by declared and streamed size',async()=>{
 assert.equal(MAX_YOUTUBE_BYTES,40*1024*1024);
 await assert.rejects(importYouTubeAudio(ID,{fetchImpl:async()=>audioResponse(new Uint8Array(4),{},{length:MAX_YOUTUBE_BYTES+1})}),{code:'too-large'});
 await assert.rejects(importYouTubeAudio(ID,{maxBytes:10,fetchImpl:async()=>audioResponse(new Uint8Array(20),{},{length:null})}),{code:'too-large'});
});

// Opt-in end-to-end check against a running endpoint (vercel dev, a deployment, or a local handler), e.g.
// EKKO_YOUTUBE_LIVE=http://127.0.0.1:8765 node --test tests/youtube.test.mjs
test('live: the permitted reference video returns real AAC/Opus bytes',{skip:!process.env.EKKO_YOUTUBE_LIVE&&'set EKKO_YOUTUBE_LIVE to a base URL'},async()=>{
 const base=process.env.EKKO_YOUTUBE_LIVE.replace(/\/$/,'');
 const {file,title,duration}=await importYouTubeAudio(`https://www.youtube.com/watch?v=${ID}`,{endpoint:`${base}/api/youtube`});
 const head=new Uint8Array(await file.slice(0,12).arrayBuffer());
 const mp4=String.fromCharCode(...head.subarray(4,8))==='ftyp',webm=head[0]===0x1a&&head[1]===0x45&&head[2]===0xdf&&head[3]===0xa3;
 assert.ok(mp4||webm,'container magic');assert.ok(file.size>1_000_000,`only ${file.size} bytes`);assert.match(title,/Particle tests/);assert.equal(duration,218);
});

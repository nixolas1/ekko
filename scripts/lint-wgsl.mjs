import {mkdtempSync,readFileSync,readdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
// Match ParticleEngine.module: common prefix, then each complete shader module.
const bundles=[['particles.wgsl','reference-simulation.wgsl'],...['fluid.wgsl','render.wgsl','reference-render.wgsl','post-shader.wgsl','volume.wgsl'].map(name=>[name])];
// Naga accepts mixed logical precedence that browser Tint rejects. WGSL requires
// explicit grouping, so enforce that rule before semantic validation as well.
export function validateLogicalGrouping(code,name){
 const tokens=/\/\*|\*\/|\/\/[^\n]*|&&|\|\||==|!=|<=|>=|[()[\]{},;=]|[^\s]/g;
 const stack=[new Set()];let depth=0;
 for(const match of code.matchAll(tokens)){
  const token=match[0];
  if(token==='/*'){depth++;continue;}if(token==='*/'&&depth){depth--;continue;}if(depth||token.startsWith('//'))continue;
  if(token==='('||token==='['){stack.push(new Set());continue;}
  if(token===')'||token===']'){if(stack.length>1)stack.pop();continue;}
  if(/[{},;=]/.test(token)&&token.length===1){stack.at(-1).clear();continue;}
  if(token==='&&'||token==='||'){
   const group=stack.at(-1);group.add(token);
   if(group.size>1)throw new Error(`WGSL validation failed\n${name}:${code.slice(0,match.index).split('\n').length}: mixed && and || require parentheses.`);
  }
 }
}
export function validateWGSL(sourceDir=join(root,'src')){
 const covered=new Set(['common-shader.wgsl',...bundles.flat()]);
 for(const name of readdirSync(sourceDir).filter(name=>name.endsWith('.wgsl'))){if(!covered.has(name))throw new Error(`Add ${name} to the WGSL validation bundles.`);}
 const temp=mkdtempSync(join(tmpdir(),'ekko-wgsl-')),maps=new Map();
 try{
  const paths=bundles.map(parts=>{
   const files=['common-shader.wgsl',...parts],map=[];let line=1;
   const code=files.map(name=>{const text=readFileSync(join(sourceDir,name),'utf8');validateLogicalGrouping(text,join(sourceDir,name));map.push({name,start:line});line+=text.split('\n').length;return text;}).join('\n');
   const path=join(temp,parts[0]);writeFileSync(path,code);maps.set(path,map);return path;
  });
  const cli=fileURLToPath(import.meta.resolve('naga-wasi-cli/bin/naga.mjs'));
  const result=spawnSync(process.execPath,['--no-warnings',cli,'--bulk-validate',...paths.map(path=>basename(path))],{cwd:temp,encoding:'utf8',timeout:30000});
  if(result.error)throw result.error;
  if(result.status!==0){
   let diagnostic=(result.stderr||'')+(result.stdout||'');
   for(const [path,map] of maps){
    diagnostic=diagnostic.replaceAll(new RegExp(basename(path).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':(\\d+):(\\d+)','g'),(_,line,column)=>{
     const source=map.findLast(item=>item.start<=Number(line));return `${join(sourceDir,source.name)}:${Number(line)-source.start+1}:${column}`;
    }).replaceAll(path,join(sourceDir,map.at(-1).name));
   }
   throw new Error(`WGSL validation failed\n${diagnostic.trim()}`);
  }
  return bundles.length;
 }finally{rmSync(temp,{recursive:true,force:true});}
}
export function wgslValidationPlugin(){
 let sourceDir;
 return {name:'validate-wgsl',apply:'serve',configResolved(config){sourceDir=join(config.root,'src');},buildStart(){validateWGSL(sourceDir);},handleHotUpdate(ctx){
  if(ctx.file.endsWith('.wgsl'))validateWGSL(sourceDir);
 }};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(`WGSL: ${validateWGSL()} shader modules validated.`);}catch(error){console.error(error.message);process.exitCode=1;}
}

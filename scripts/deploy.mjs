// Production releases need the hosted library, which intentionally stays out of Git.
import {execFileSync, spawnSync} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LOCAL_TRACKS} from '../src/music.js';

export async function copyLibrary(root, destination) {
  // Validate the complete library before copying any files or starting a deploy.
  const files=LOCAL_TRACKS.map(track=>join('public',track.src.slice(1)));
  for(const file of files){
    const path=join(root,file);
    const info=await stat(path).catch(()=>null);
    if(!info?.isFile()||info.size===0)throw new Error(`Missing library asset: ${file}. Restore all library songs before deploying.`);
  }
  for(const file of files){
    await mkdir(join(destination,'public/audio'),{recursive:true});
    await copyFile(join(root,file),join(destination,file));
  }
  return files;
}

async function deploy(){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const status=execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'});
  if(status.trim())throw new Error('Commit tracked changes before deploying; releases use the current Git commit.');
  const project=await readFile(join(root,'.vercel/project.json'));
  const release=await mkdtemp(join(tmpdir(),'ekko-release-'));
  try{
    execFileSync('tar',['-x','-C',release],{input:execFileSync('git',['archive','HEAD'],{cwd:root,maxBuffer:64*1024*1024})});
    const files=await copyLibrary(root,release);
    await mkdir(join(release,'.vercel'),{recursive:true});
    await writeFile(join(release,'.vercel/project.json'),project);
    console.log(`Deploying committed source with ${files.length} validated library files.`);
    const result=spawnSync('vercel',['deploy',release,'--prod','--yes'],{cwd:root,stdio:'inherit'});
    if(result.error)throw result.error;
    if(result.status!==0)throw new Error(`Vercel deployment failed (${result.status??result.signal}).`);
  }finally{await rm(release,{recursive:true,force:true});}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  deploy().catch(error=>{console.error(error.message);process.exitCode=1;});
}

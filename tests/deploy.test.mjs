import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {copyLibrary} from '../scripts/deploy.mjs';
import {LOCAL_TRACKS} from '../src/music.js';

test('release package includes every Git-ignored library file and excludes unrelated audio',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ekko-library-test-')),destination=join(root,'release');
 try{
  await mkdir(join(root,'public/audio'),{recursive:true});
  for(const track of LOCAL_TRACKS)await writeFile(join(root,'public',track.src),track.id);
  await writeFile(join(root,'public/audio/unlisted.webm'),'unlisted');
  const files=await copyLibrary(root,destination);assert.equal(files.length,LOCAL_TRACKS.length);
  for(const track of LOCAL_TRACKS)assert.equal(await readFile(join(destination,'public',track.src),'utf8'),track.id);
  await assert.rejects(stat(join(destination,'public/audio/unlisted.webm')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('missing or empty songs prevent a release before any library files are copied',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ekko-library-test-')),destination=join(root,'release');
 try{
  await mkdir(join(root,'public/audio'),{recursive:true});
  for(const track of LOCAL_TRACKS.slice(0,-1))await writeFile(join(root,'public',track.src),track.id);
  await assert.rejects(copyLibrary(root,destination),/Missing library asset/);
  await assert.rejects(stat(destination),{code:'ENOENT'});
  await writeFile(join(root,'public',LOCAL_TRACKS.at(-1).src),'');
  await assert.rejects(copyLibrary(root,destination),/Missing library asset/);
  await assert.rejects(stat(destination),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});

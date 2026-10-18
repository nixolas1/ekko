import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,appendFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateWGSL,validateLogicalGrouping} from '../scripts/lint-wgsl.mjs';
test('all assembled WGSL modules pass syntax and semantic validation',()=>assert.equal(validateWGSL(),6));
for(const [name,code] of [['mixed boolean operators','fn broken() -> bool { return true || false && true; }'],['wrong return type','fn broken() -> f32 { return vec2f(0); }']]){
 test(`WGSL validator rejects ${name} and maps the error to its source file`,()=>{
  const temp=mkdtempSync(join(tmpdir(),'ekko-invalid-shader-'));
  try{cpSync(new URL('../src',import.meta.url),temp,{recursive:true});appendFileSync(join(temp,'reference-simulation.wgsl'),'\n'+code+'\n');assert.throws(()=>validateWGSL(temp),error=>error.message.includes('WGSL validation failed')&&error.message.includes('reference-simulation.wgsl:'));}
  finally{rmSync(temp,{recursive:true,force:true});}
 });
}

test('logical grouping respects parentheses, separate expressions and nested comments',()=>{
 for(const code of ['return (a || b) && c;', 'return a || (b && c);', 'let x=a || b; let y=a && b;', 'f(a || b, c && d);', '/* a || /* nested */ b && c */ return a && b;', '// a || b && c\nreturn a && b;'])assert.doesNotThrow(()=>validateLogicalGrouping(code,'fixture.wgsl'));
 assert.throws(()=>validateLogicalGrouping('return a && b || c;','fixture.wgsl'),/require parentheses/);
});

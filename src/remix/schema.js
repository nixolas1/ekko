// Shared by the editor, HTTP API and GPU compiler. Keep documents portable:
// a remix is text plus settings, independent of browser/GPU resource handles.
export const VERSION=1;
export const MODES=['plume','plume-glow','duet','spectral','fluid-ring','smoke','ring','persistent','sculpture'];
export const MODE_NAMES=['Smoke light','Lasting glow','Fire & ice','Spectral smoke','Fluid ring','Fluid smoke','Particle ring','Airbender','Light shapes'];
export const DEFAULT_CODE=`// Add a drift to particle modes. Fluid modes use their own velocity grid.
// p: world position; t: seconds; audio: bass, mid, high, overall energy.
// pointer: world x, y, radius, active (0 or 1).
fn remixForce(p: vec3f, t: f32, audio: vec4f, pointer: vec4f) -> vec3f {
  return vec3f(0.0);
}

// Recolour the finished scene, or draw something entirely new with uv and t.
// rgb: scene colour; uv: 0..1 screen coordinates (top left is 0,0).
fn remixColor(rgb: vec3f, uv: vec2f, t: f32, audio: vec4f, pointer: vec4f) -> vec3f {
  return rgb;
}
`;
export function validateCode(source){
 if(typeof source!=='string'||source.length>12000)throw new Error('Shader code must be text, up to 12,000 characters.');
 const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
 // The editable surface is two straight-line hooks, not a replacement for the
 // renderer's bindings or dispatch sizes. No loops, pointers or texture access.
 if(/[^\x09\x0a\x0d\x20-\x7e]/.test(code))throw new Error('Use ASCII characters in WGSL code (comments may use any language).');
 if(/@|\b(loop|for|while|continuing|discard|struct|alias|enable|requires|diagnostic|override|array|ptr|atomic|workgroup)\b|\b(texture\w*|atomic\w*|subgroup\w*)\s*\(/.test(code))throw new Error('Use the two supplied functions without loops, arrays, bindings, pointers or texture operations.');
 const names=[...code.matchAll(/\bfn\s+(\w+)/g)].map(m=>m[1]);
 if(names.length!==2||!names.includes('remixForce')||!names.includes('remixColor'))throw new Error('Keep exactly two functions: remixForce and remixColor.');
 // Do not allow one hook to call another or engine functions/globals. This also
 // bounds call depth and avoids letting edited code mutate particle storage.
 const allowedCalls=new Set(['vec2f','vec3f','vec4f','f32','i32','u32','bool','abs','acos','asin','atan','atan2','ceil','clamp','cos','cosh','cross','degrees','distance','dot','exp','exp2','floor','fract','inverseSqrt','length','log','log2','max','min','mix','normalize','pow','radians','reflect','refract','round','saturate','select','sign','sin','sinh','smoothstep','sqrt','step','tan','tanh','trunc']);
 const calls=[...code.replace(/\bfn\s+\w+\s*\(/g,'(').matchAll(/\b(\w+)\s*\(/g)].map(m=>m[1]);
 if(calls.some(n=>!allowedCalls.has(n)&&n!=='if'&&n!=='switch'))throw new Error('Use WGSL math built-ins inside the hooks; custom helper calls are not supported.');
 if(/\b(params|particles|density|tex0|tex1|samp|volumeMix|TAU)\b/.test(code))throw new Error('Read scene data through the function arguments.');
 // Require only two complete top-level function bodies; disallow injected globals.
 const top=code.replace(/\bfn\s+(remixForce|remixColor)\s*\([^)]*\)\s*->\s*vec3f\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g,'').trim();
 if(top)throw new Error('Keep all code inside the two vec3f functions (one level of if/switch blocks is supported).');
 return source;
}
export function validateDocument(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected a remix document.');
 const text=(key,max,required=false)=>{if(typeof input[key]!=='string'||input[key].trim().length>max||(required&&!input[key].trim()))throw new Error(`${key} must be ${required?'non-empty ':''}text, up to ${max} characters.`);return input[key].trim();};
 const title=text('title',80,true),description=text('description',600),author=text('author',60);
 if(input.version!==VERSION)throw new Error('Unsupported document version.');
 if(!MODES.includes(input.mode))throw new Error('Choose a supported base mode.');
 const settings={};const ranges={palette:[0,6,3],effect:[0,3,0],speed:[.25,2,1],glow:[0,3,1.6],turbulence:[0,3,1.1],emission:[0,3,1.5],visibility:[.25,4,1],count:[32768,524288,131072]};
 for(const [key,[lo,hi,fallback]] of Object.entries(ranges)){const n=input.settings?.[key]??fallback;if(!Number.isFinite(n)||n<lo||n>hi)throw new Error(`${key} must be between ${lo} and ${hi}.`);if(['palette','effect','count'].includes(key)&&!Number.isInteger(n))throw new Error(`${key} must be an integer.`);settings[key]=n;}
 const code=validateCode(input.code);
 return {version:VERSION,title,description,author,mode:input.mode,settings,code};
}
export function starter(mode='plume'){return validateDocument({version:1,title:MODE_NAMES[MODES.indexOf(mode)]+' remix',description:'',author:'',mode,settings:{},code:DEFAULT_CODE});}

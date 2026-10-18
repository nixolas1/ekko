import {validateCode} from './schema.js';
export function remixSources(source,compute,post){
 validateCode(source);
 const helper=`\nfn applyRemix(particle: Particle) -> Particle {
 var p = particle;
 let drift = clamp(remixForce(p.position.xyz, params.clock.x, params.sound, params.mouse), vec3f(-4.0), vec3f(4.0));
 p.position = vec4f(p.position.xyz + drift * params.clock.y, p.position.w);
 return p;
}\n`;
 // Only particle stores are wrapped; the fluid solver keeps its own grid physics.
 const customized=compute.replace(/particles\[id\] = (simulateReference\(id, p\)|simulateSmoke\(id, p\)|simulateAccretion\(id, p\)|Particle\([^;]+\));/g,'particles[id] = applyRemix($1);');
 const original='return vec4f(max(color * vignette + background * vignette + dither, vec3f(0.0)), 1.0);';
 if(!post.includes(original)||customized===compute)throw new Error('The renderer hook layout changed. Update remixSources before compiling.');
 return {compute:source+'\n'+helper+customized,post:source+'\n'+post.replace(original,'return vec4f(clamp(remixColor(max(color * vignette + background * vignette + dither, vec3f(0.0)), input.uv, params.clock.x, params.sound, params.mouse), vec3f(0.0), vec3f(1.0)), 1.0);')};
}

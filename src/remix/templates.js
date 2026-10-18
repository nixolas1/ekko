import {starter,DEFAULT_CODE} from './schema.js';
const images={
 plume:new URL('../../docs/images/smoke-light.jpg',import.meta.url).href,
 duet:new URL('../../docs/images/fire-and-ice.jpg',import.meta.url).href,
 spectral:new URL('../../docs/images/spectral-smoke.jpg',import.meta.url).href,
 'fluid-ring':new URL('../../docs/images/fluid-ring.jpg',import.meta.url).href,
 'plume-glow':new URL('../../docs/images/remix-plume-glow.jpg',import.meta.url).href,
 ring:new URL('../../docs/images/remix-ring.jpg',import.meta.url).href,
 persistent:new URL('../../docs/images/remix-persistent.jpg',import.meta.url).href,
 sculpture:new URL('../../docs/images/remix-sculpture.jpg',import.meta.url).href,
 smoke:new URL('../../docs/images/fluid-smoke.jpg',import.meta.url).href,
};
const tint=DEFAULT_CODE.replace('return rgb;','let tint = 0.7 + 0.3 * cos(vec3f(0.0, 2.1, 4.2) + t * 0.3 + uv.x * 3.0);\n  return rgb * tint * (1.0 + audio.x * 0.4);');
const drift=DEFAULT_CODE.replace('return vec3f(0.0);','return vec3f(sin(p.y * 4.0 + t), cos(p.x * 3.0 - t), 0.0) * 0.35;');
export const TEMPLATES=[
 {id:'plume',title:'A river of light',description:'Draw luminous ribbons through a rising plume.',image:images.plume,document:{...starter('plume'),title:'A river of light'}},
 {id:'duet',title:'Fire meets ice',description:'Twin vortex fields. One warm, one glacial.',image:images.duet,document:{...starter('duet'),title:'Fire meets ice',settings:{...starter('duet').settings,palette:6}}},
 {id:'spectral',title:'The whole spectrum',description:'Fine filaments and light suspended in a volume.',image:images.spectral,document:{...starter('spectral'),title:'The whole spectrum'}},
 {id:'fluid-ring',title:'Sound in every direction',description:'Nine fluid jets, one for each part of the spectrum.',image:images['fluid-ring'],document:{...starter('fluid-ring'),title:'Sound in every direction'}},
 {id:'smoke',title:'Slow combustion',description:'Stir a fluid simulation with buoyant coloured smoke.',image:images.smoke,document:{...starter('smoke'),title:'Slow combustion'}},
 {id:'plume-glow',title:'After the note',description:'Glowing patches keep travelling after a note ends.',image:images['plume-glow'],document:{...starter('plume-glow'),title:'After the note',code:tint}},
 {id:'ring',title:'Colour in orbit',description:'Recolour outward particle streams with a few lines.',image:images.ring,document:{...starter('ring'),title:'Colour in orbit',code:tint}},
 {id:'persistent',title:'A little turbulence',description:'Add your own drifting field to a persistent cloud.',image:images.persistent,document:{...starter('persistent'),title:'A little turbulence',code:drift}},
 {id:'sculpture',title:'Moving geometry',description:'Bend geometric strands with a custom drift function.',image:images.sculpture,document:{...starter('sculpture'),title:'Moving geometry',code:drift}},
];
export const cover=mode=>images[mode]||images.plume;

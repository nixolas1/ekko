const clamp=(v,lo,hi)=>Number.isFinite(v)?Math.min(hi,Math.max(lo,v)):lo;
// Cubic travel reserves most of the slider for gentle forces; the full 3x range remains available.
export const forceFromSlider=value=>Math.round(3*(clamp(Number(value),0,1000)/1000)**3*1e6)/1e6;
export const sliderFromForce=value=>1000*Math.cbrt(clamp(Number(value),0,3)/3);
export const clampForce=value=>clamp(Number(value),0,3);

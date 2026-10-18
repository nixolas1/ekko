// Primary mouse button acts as a stationary hand: plain hold pushes like an open
// hand, Command-hold gathers like a closed fist. Plain hover stays the separate
// mouse obstacle, so no force is produced unless the button is held.
// No artificial motion is added: velocity and wand/vortex weights are always zero,
// so the force only reflects where the pointer is, never a synthetic swirl or drift.
export const MOUSE_HAND_ID=-1; // reserved; tracked hands use non-negative ids
const STRENGTH=18;
const power=(value)=>Number.isFinite(value)?Math.max(0,Math.min(3,value)):1;

export function mouseHandForce(pointer,persistent,pullPower,pushPower){
 if(!pointer?.active||!pointer.held||!Number.isFinite(pointer.x)||!Number.isFinite(pointer.y))return null;
 const strength=pointer.metaKey?STRENGTH*power(pullPower):-STRENGTH*power(pushPower);
 return [pointer.x,pointer.y,strength,persistent?.95:.65,0,0,MOUSE_HAND_ID,0,0];
}

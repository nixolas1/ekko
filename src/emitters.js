// Source identity keeps spectrum assignments steady when tracking order changes.
// Direction lives separately from interaction forces: an emitter never pushes itself.
export class Emitters {
 constructor(){this.states=new Map();}
 sample(hands,pointer,time){
  const inputs=hands.filter(h=>h.gesture==='point').map(h=>({id:h.id,x:h.x,y:h.y,aim:h.emitDirection,
   power:Number.isFinite(h.pointDepthScale)?Math.max(.25,Math.min(4,h.pointDepthScale)):1}));
  if(pointer?.active&&!pointer.held)inputs.push({id:-1,x:pointer.x,y:pointer.y,power:1});
  const live=new Set(),result=[];
  for(const input of inputs.slice(0,9)){
   if(!Number.isFinite(input.x)||!Number.isFinite(input.y))continue;
   live.add(input.id);
   const old=this.states.get(input.id);
   let direction=old?.direction||[0,1];
   const aim=input.aim||(old?[input.x-old.anchor[0],input.y-old.anchor[1]]:null);
   const length=aim?Math.hypot(...aim):0;
   const moved=length>(input.aim?.015:.012);
   if(moved){
    const angle=Math.atan2(aim[1],aim[0]),previous=Math.atan2(direction[1],direction[0]);
    const delta=Math.atan2(Math.sin(angle-previous),Math.cos(angle-previous));
    const blend=old?1-Math.exp(-Math.max(0,time-old.time)/65):1;
    direction=[Math.cos(previous+delta*blend),Math.sin(previous+delta*blend)];
   }
   const state={...input,direction,time,anchor:!old||moved?[input.x,input.y]:old.anchor};
   this.states.set(input.id,state);result.push(state);
  }
  for(const id of this.states.keys())if(!live.has(id))this.states.delete(id);
  // Hands get first choice of bands; a hovering mouse cannot steal bass or mid.
  // Tracking IDs keep the assignments steady when hands cross.
  result.sort((a,b)=>(a.id===-1)-(b.id===-1)||a.id-b.id);
  return result.map((source,index)=>({...source,band:index/Math.max(2,result.length-1)}));
 }
}

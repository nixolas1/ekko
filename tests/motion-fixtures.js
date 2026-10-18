// A rigid open hand, rotated around its middle MCP (landmark 9).
export function hand(x=.5,angle=0){
 const local=Array.from({length:21},()=>[0,0]);
 local[0]=[0,.12];local[1]=[-.04,.09];local[2]=[-.065,.065];local[3]=[-.085,.04];local[4]=[-.1,.01];
 for(const [base,dx,dy] of [[5,-.035,.01],[9,0,0],[13,.035,.01],[17,.065,.025]])
  for(let joint=0;joint<4;joint++)local[base+joint]=[dx,dy-joint*.035];
 return local.map(([dx,dy])=>({x:x+dx*Math.cos(angle)-dy*Math.sin(angle),y:.5+dx*Math.sin(angle)+dy*Math.cos(angle),z:0}));
}

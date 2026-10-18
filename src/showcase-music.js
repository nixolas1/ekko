// An original, generated instrumental loop: no download or library recording is
// required. Feed the WAV through AudioInput so the real analyser drives the show.
export function createShowcaseScore(){
  const rate=44100,beat=60/110,duration=beat*32,count=Math.ceil(rate*duration);
  const buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+count*2,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  text(36,'data');view.setUint32(40,count*2,true);
  const chords=[[40,55,59,64],[36,55,60,64],[43,55,59,62],[38,54,57,62]];
  const hz=note=>440*2**((note-69)/12),tau=Math.PI*2;
  let seed=42,previousNoise=0;
  for(let i=0;i<count;i++){
    const t=i/rate,b=t/beat,phase=t%beat,chord=chords[Math.floor(b/8)%4];
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const noise=seed/2147483648-1,high=noise-previousNoise;previousNoise=noise;
    const eighth=t%(beat/2),sixteenth=t%(beat/4),note=chord[1+Math.floor(b*2)%3]+12;
    const kick=.30*Math.sin(tau*(48*phase+9*(1-Math.exp(-phase*30))))*Math.exp(-phase*13);
    const snare=Math.floor(b)%2===1?noise*.12*Math.exp(-phase*24):0;
    const hat=high*.045*Math.exp(-sixteenth*100);
    const bass=.16*Math.sin(tau*hz(chord[0])*phase)*(1-Math.exp(-phase*70))*Math.exp(-phase*3);
    const arpPhase=tau*hz(note)*eighth;
    const arp=(Math.sin(arpPhase)+.3*Math.sin(arpPhase*2)+.12*Math.sin(arpPhase*4))*.09*(1-Math.exp(-eighth*160))*Math.exp(-eighth*9);
    const local=t%(beat*8),padEnvelope=Math.min(1,local/.25,(beat*8-local)/.25);
    const pad=chord.slice(1).reduce((sum,n)=>sum+Math.sin(tau*hz(n)*local)+.3*Math.sin(tau*hz(n)*2*local),0)*.022*padEnvelope;
    const fade=Math.min(1,t/.025,(duration-t)/.025);
    view.setInt16(44+i*2,Math.round(Math.tanh((kick+snare+hat+bass+arp+pad)*1.3)*.78*fade*32767),true);
  }
  return new File([buffer],'EKKO — First light.wav',{type:'audio/wav'});
}

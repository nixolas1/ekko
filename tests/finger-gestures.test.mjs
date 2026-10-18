import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureTracker, extendedFingers, fingerGesture, openness, validHand } from '../src/gestures.js';
import { HandForces, handForce } from '../src/interactions.js';

// ---- synthetic landmarks ---------------------------------------------------------
// Built in isotropic palm units around the wrist (fingers pointing up), optionally
// rotated and mirrored, then normalized for a frame of the given aspect.
// `up` = extended [index, middle, ring, pinky]; `spread` widens extended fingertips.
const FINGERS = [[5, -.3], [9, 0], [13, .3], [17, .55]];
function hand({ up = [1, 1, 1, 1], x = .5, y = .6, palm = .12, aspect = 1, angle = 0, mirror = false, spread = 1 } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  const c = Math.cos(angle), s = Math.sin(angle);
  const put = (i, ux, uy) => {
    if (mirror) ux = -ux;
    const rx = ux * c - uy * s, ry = ux * s + uy * c;
    points[i] = { x: x + rx * palm / aspect, y: y + ry * palm, z: 0 };
  };
  put(0, 0, 0);
  put(1, -.4, -.3); put(2, -.6, -.5); put(3, -.7, -.7); put(4, -.8, -.9);
  FINGERS.forEach(([mcp, dx], k) => {
    const base = mcp === 9 ? 1 : .92;
    put(mcp, dx, -base);
    if (up[k]) { put(mcp + 1, dx, -base - .45); put(mcp + 2, dx * spread, -base - .75); put(mcp + 3, dx * spread, -base - 1); }
    else { put(mcp + 1, dx, -base - .35); put(mcp + 2, dx, -base - .05); put(mcp + 3, dx, -base + .35); }
  });
  return points;
}
const ONE = [1, 0, 0, 0], TWO = [1, 1, 0, 0], THREE = [1, 1, 1, 0], FIST = [0, 0, 0, 0], OPEN = [1, 1, 1, 1];
const combos = Array.from({ length: 16 }, (_, n) => [0, 1, 2, 3].map(b => (n >> b) & 1));

// Same mapping shape as main.js mapPoint with a matching camera/screen aspect.
const mapFor = aspect => p => [(1 - 2 * p.x) * aspect, 1 - 2 * p.y];
const map = mapFor(1);
const STEP = 33; // ~30 Hz tracking
// Feeds frames (a single hand, an array of hands, or {hands, ids}) and samples every
// frame. Returns per-frame samples and the timestamp after the final frame.
function feed(forces, frames, { start = 1000, step = STEP, aspect = 1 } = {}) {
  const samples = [];
  frames.forEach((frame, i) => {
    if (Array.isArray(frame) && frame.length === 21 && 'x' in frame[0]) frame = [frame];
    const t = start + i * step, hands = Array.isArray(frame) ? frame : frame.hands;
    const handIds = Array.isArray(frame) ? hands.map((_, k) => k + 1) : frame.ids;
    forces.update({ hands, handIds, aspect, timestamp: t }, t, mapFor(aspect));
    samples.push(forces.sample(t));
  });
  return { samples, end: start + frames.length * step };
}
const repeat = (value, n) => Array.from({ length: n }, () => value);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ---- classification ----------------------------------------------------------------
test('every finger combination is counted, with the thumb ignored', () => {
  const names = ['fist', 'point', 'vortex', 'none', 'open'];
  for (const up of combos) {
    const n = up.reduce((a, b) => a + b, 0), shape = fingerGesture(hand({ up }));
    assert.equal(shape.count, n, `combo ${up}`);
    assert.equal(shape.gesture, n===1&&!up[0]?'none':names[n]);
    assert.deepEqual(shape.tips, [8, 12, 16, 20].filter((_, k) => up[k]));
    assert.equal(openness(hand({ up })), n / 4);
  }
});

test('counting is invariant to rotation, mirroring, frame aspect and hand size', () => {
  for (const aspect of [1, 4 / 3, 16 / 9])
    for (const angle of [0, .7, Math.PI / 2, Math.PI, -2.1])
      for (const mirror of [false, true])
        for (const palm of [.06, .15])
          for (const up of [FIST, ONE, [0, 1, 0, 0], TWO, [0, 1, 1, 0], THREE, OPEN])
            assert.deepEqual(extendedFingers(hand({ up, aspect, angle, mirror, palm, x: .5, y: .5 }), aspect), up.map(Boolean), `${aspect} ${angle} ${mirror} ${palm} ${up}`);
});

test('curled and hooked fingers do not count; incomplete or non-finite hands are rejected', () => {
  assert.equal(fingerGesture(hand({ up: FIST })).count, 0);
  const hooked = hand({ up: TWO }); // middle finger bent toward the camera: tip stays at the PIP
  hooked[12] = { ...hooked[10], y: hooked[10].y - .01 };
  assert.equal(fingerGesture(hooked).count, 1);
  const nan = hand(); nan[8] = { x: NaN, y: .2, z: 0 };
  const inf = hand(); inf[0] = { x: .5, y: Infinity, z: 0 };
  const badZ = hand(); badZ[12].z = Infinity;
  for (const bad of [nan, inf, badZ, hand().slice(0, 20), null, undefined, [], 'hand']) {
    assert.equal(validHand(bad), false);
    assert.equal(extendedFingers(bad), null);
    assert.equal(fingerGesture(bad), null);
  }
});

// ---- GestureTracker palm burst vs three fingers ------------------------------------
const track = (frames, step = 66) => { const g = new GestureTracker(), out = []; frames.forEach((h, i) => out.push(...g.update([h], 1000 + i * step))); return out; };

test('palm burst needs all four long fingers: fist -> three fingers never fires it', () => {
  assert.equal(track([...repeat(hand({ up: FIST }), 3), ...repeat(hand({ up: THREE }), 10)]).length, 0);
  assert.equal(track([...repeat(hand({ up: FIST }), 3), ...repeat(hand({ up: [0, 1, 1, 1] }), 10)]).length, 0);
  assert.equal(track([...repeat(hand({ up: FIST }), 3), ...repeat(hand({ up: OPEN }), 3)]).length, 1);
});

test('a held partial pose disarms the fist before a later open palm', () => {
  assert.equal(track([...repeat(hand({ up: FIST }), 3), ...repeat(hand({ up: THREE }), 4), ...repeat(hand({ up: OPEN }), 4)]).length, 0);
  // Passing through a partial count briefly while opening still fires.
  assert.equal(track([...repeat(hand({ up: FIST }), 3), hand({ up: TWO }), hand({ up: THREE }), ...repeat(hand({ up: OPEN }), 3)]).length, 1);
});

// ---- New gesture mapping and transitions -------------------------------------------
function pinch(options={}){
  const h=hand({up:ONE,...options});
  h[4]={...h[8]};
  return h;
}

test('pinch wins over raised fingers across rotation, aspect, mirroring and scale',()=>{
  for(const aspect of [1,4/3,16/9])for(const angle of [0,.7,Math.PI])for(const mirror of [false,true])for(const palm of [.06,.15])for(const up of [ONE,TWO,THREE,OPEN]){
    const h=pinch({aspect,angle,mirror,palm,up});
    assert.equal(fingerGesture(h,aspect).gesture,'wand');
    assert.equal(fingerGesture(hand({aspect,angle,mirror,palm,up:FIST}),aspect).gesture,'fist');
  }
  const tucked=hand({up:FIST});tucked[4]={...tucked[8]};
  assert.equal(fingerGesture(tucked).gesture,'fist','thumb touching a curled index is still a fist');
  const apart=pinch();apart[4].z+=.08;
  assert.equal(fingerGesture(apart).gesture,'point','depth separation is not a pinch');
});

test('point, pinch and vortex debounce independently and settle to their effects',()=>{
  for(const [h,gesture] of [[hand({up:ONE}),'point'],[pinch(),'wand'],[hand({up:TWO}),'vortex']]){
    const {samples}=feed(new HandForces(),repeat(h,14));
    assert.notEqual(samples[4][0].gesture,gesture);
    assert.equal(samples[6][0].gesture,gesture);
    const last=samples.at(-1)[0];assert(last[gesture]>.99);
    const force=handForce(last,false,1,1);
    if(gesture==='point'){
      assert.equal(force[3],-.18);assert(near(force[2],1,.01));
      assert.deepEqual(force.slice(4,6),[0,0]);assert.deepEqual(force.slice(7),[0,0]);
    }else assert(near(force[2],gesture==='wand'?14:16,.1));
  }
});

test('three fingers settle to no effect, even after Wand or a fist',()=>{
  for(const initial of [pinch(),hand({up:FIST}),hand({up:OPEN}),hand({up:TWO})]){
    const {samples}=feed(new HandForces(),[...repeat(initial,12),...repeat(hand({up:THREE}),30)]);
    const last=samples.at(-1)[0];assert.equal(last.gesture,'none');assert(Math.abs(last.strength)<1e-6);
    assert(Math.abs(handForce(last,false,1,1)[2])<1e-6);
  }
});

test('pinch release and pointing do not arm an open-palm burst',()=>{
  for(const h of [pinch(),pinch({up:THREE}),hand({up:ONE}),hand({up:THREE})]){
    assert.equal(track([...repeat(h,8),...repeat(hand({up:OPEN}),4)]).length,0);
    assert.equal(track([...repeat(hand({up:FIST}),3),...repeat(h,8),...repeat(hand({up:OPEN}),4)]).length,0);
  }
});

test('point anchors at index tip and pinch at thumb/index midpoint without false velocity',()=>{
  const midpoint=h=>{const a=map(h[4]),b=map(h[8]);return [(a[0]+b[0])/2,(a[1]+b[1])/2];};
  for(const [h,gesture,anchor] of [[hand({up:ONE,angle:.4}),'point',h=>map(h[8])],[pinch({angle:.4}),'wand',midpoint],[hand({up:TWO,angle:.4}),'vortex',h=>{const a=map(h[8]),b=map(h[12]);return [(a[0]+b[0])/2,(a[1]+b[1])/2];}]]){
    const {samples}=feed(new HandForces(),[...repeat(hand({up:FIST,angle:.4}),4),...repeat(h,20)]);
    const s=samples.at(-1)[0],[x,y]=anchor(h);assert.equal(s.gesture,gesture);assert(Math.hypot(s.x-x,s.y-y)<.001);
    assert(samples.every(frame=>Math.hypot(frame[0].vx,frame[0].vy)<1e-9));
  }
});

test('point to pinch to vortex weights stay bounded, noisy pinch cannot activate',()=>{
  const f=new HandForces(),sequence=[...repeat(hand({up:ONE}),12),...repeat(pinch(),12),...repeat(hand({up:TWO}),12),...repeat(hand({up:FIST}),12)];
  for(const frame of feed(f,sequence).samples){const s=frame[0];assert(s.point+s.wand+s.vortex<=1+1e-9);assert(Number.isFinite(s.strength));}
  const noisy=Array.from({length:30},(_,i)=>i%2?pinch():hand({up:ONE}));
  const samples=feed(new HandForces(),[...repeat(hand({up:ONE}),12),...noisy]).samples;
  assert(samples.slice(12).every(frame=>frame[0].gesture==='point'));
});

test('two hands retain independent point and pinch forces when detection order changes',()=>{
  const a=hand({up:ONE,x:.25}),b=pinch({x:.75});
  const frames=Array.from({length:20},(_,i)=>i%2?{hands:[a,b],ids:[4,9]}:{hands:[b,a],ids:[9,4]});
  const byId=Object.fromEntries(feed(new HandForces(),frames).samples.at(-1).map(s=>[s.id,s]));
  assert.equal(byId[4].gesture,'point');assert.equal(byId[9].gesture,'wand');
  assert.equal(handForce(byId[4],true,1,0)[2],0,'force slider can disable pointing');
  assert.equal(handForce(byId[9],true,0,1)[2],0,'force slider can disable pinching');
});

test('lost pointing hands fade and expire, and clear removes all state',()=>{
  const f=new HandForces(),{end}=feed(f,repeat(hand({up:ONE}),12));
  const last=end-STEP;assert(f.sample(last+220)[0].point<.7);assert.deepEqual(f.sample(last+301),[]);
  f.clear();assert.equal(f.states.size,0);assert.deepEqual(f.sample(end),[]);
});

test('fist and open palm retain their pull and push strengths',()=>{
  for(const [up,gesture,strength] of [[FIST,'pull',18],[OPEN,'push',-18]]){
    const s=feed(new HandForces(),repeat(hand({up}),12)).samples.at(-1)[0];
    assert.equal(s.gesture,gesture);assert.equal(s.strength,strength);
  }
});

test('spreading two fingers controls vortex radius within its bounds',()=>{
  const radius=spread=>feed(new HandForces(),repeat(hand({up:TWO,spread}),14)).samples.at(-1)[0].vortexRadius;
  assert(radius(3)>radius(.3));assert(near(radius(.05),.22));assert(near(radius(20),.8));
});

test('invalid hand landmarks produce no forces',()=>{
  const bad=pinch();bad[4].x=NaN;
  const f=new HandForces();feed(f,repeat([bad,hand().slice(0,12)],12));assert.equal(f.states.size,0);
});

test('pointing size follows camera distance relative to gesture start and composes with the slider',()=>{
  for(const aspect of [1,4/3,16/9])for(const initial of [.06,.12,.2]){
    const f=new HandForces();let time=1000;
    const move=(palm,n=30)=>{const run=feed(f,repeat(hand({up:ONE,palm,aspect}),n),{start:time,aspect});time=run.end;return run.samples.at(-1)[0];};
    assert(near(move(initial).pointDepthScale,1));
    const closer=move(initial*1.6);
    assert(near(closer.pointDepthScale,1.6**2,.001));
    assert(near(handForce(closer,false,1,1,1.5)[3],-.18*1.5*1.6**2,.001));
    assert(near(move(initial*.65).pointDepthScale,.65**2,.001));
    assert(near(move(initial).pointDepthScale,1,.001));
    assert(near(move(initial*4).pointDepthScale,4,.001));
    assert(near(move(initial*.1).pointDepthScale,.25,.001));
  }
});

test('pointing reference starts before debounce, smooths depth changes, and ignores rotation and translation',()=>{
  const f=new HandForces(),first=hand({up:ONE,palm:.1});
  const initial=feed(f,[first,...repeat(hand({up:ONE,palm:.15}),30)]);
  assert(near(initial.samples.at(-1)[0].pointDepthScale,1.5**2,.001));
  const moved=feed(f,repeat(hand({up:ONE,palm:.15,x:.4,y:.5,angle:1,mirror:true}),20),{start:initial.end});
  assert(near(moved.samples.at(-1)[0].pointDepthScale,1.5**2,.001));
  const step=feed(f,[hand({up:ONE,palm:.2})],{start:moved.end}).samples[0][0];
  assert(step.pointDepthScale>1.5**2&&step.pointDepthScale<3,'depth changes are smoothed');
});

test('pointing depth reference survives brief noise but resets after a new gesture or tracking loss',()=>{
  for(const interruption of ['gesture','missing','stalled']){
    const f=new HandForces();
    let run=feed(f,[...repeat(hand({up:ONE,palm:.1}),12),...repeat(hand({up:ONE,palm:.16}),30)]);
    run=feed(f,[hand({up:TWO,palm:.16}),...repeat(hand({up:ONE,palm:.16}),12)],{start:run.end});
    assert(near(run.samples.at(-1)[0].pointDepthScale,1.6**2,.001));
    if(interruption==='gesture')run=feed(f,repeat(hand({up:FIST,palm:.16}),12),{start:run.end});
    else if(interruption==='missing')run=feed(f,repeat([],12),{start:run.end});
    else run.end+=1000;
    const restarted=feed(f,repeat(hand({up:ONE,palm:.16}),15),{start:run.end}).samples.at(-1)[0];
    assert(near(restarted.pointDepthScale,1),interruption);
  }
});

test('two pointing hands keep independent depth references when detections reorder',()=>{
  const f=new HandForces();
  const initial=feed(f,repeat({hands:[hand({up:ONE,palm:.1}),hand({up:ONE,palm:.2})],ids:[4,9]},12));
  const frames=Array.from({length:30},(_,i)=>{
    const a=hand({up:ONE,palm:.15}),b=hand({up:ONE,palm:.12});
    return i%2?{hands:[a,b],ids:[4,9]}:{hands:[b,a],ids:[9,4]};
  });
  const byId=Object.fromEntries(feed(f,frames,{start:initial.end}).samples.at(-1).map(s=>[s.id,s]));
  assert(near(byId[4].pointDepthScale,1.5**2,.001));assert(near(byId[9].pointDepthScale,.6**2,.001));
});

test('fist and open palm scale force with gesture-relative depth and preserve the force slider',()=>{
  for(const up of [FIST,OPEN])for(const aspect of [1,16/9]){
    const f=new HandForces();let time=1000;
    const move=palm=>{const run=feed(f,repeat(hand({up,palm,aspect}),30),{start:time,aspect});time=run.end;return run.samples.at(-1)[0];};
    const sign=up===FIST?1:-1;
    assert(near(move(.1).strength,sign*18));
    const nearHand=move(.2);
    assert(near(nearHand.strength,sign*72,.01));
    assert(near(handForce(nearHand,true,.5,.5)[2],sign*36,.01));
    assert.equal(Math.abs(handForce(nearHand,true,0,0)[2]),0);
    assert(near(move(.05).strength,sign*4.5,.01));
    assert(near(move(.1).strength,sign*18,.01));
  }
});

test('changing palm gesture and reacquiring a hand resets depth; brief pose noise does not',()=>{
  const f=new HandForces();
  let run=feed(f,[...repeat(hand({up:FIST,palm:.1}),12),...repeat(hand({up:FIST,palm:.2}),30)]);
  run=feed(f,[hand({up:OPEN,palm:.2}),...repeat(hand({up:FIST,palm:.2}),12)],{start:run.end});
  assert(near(run.samples.at(-1)[0].strength,72,.01));
  run=feed(f,repeat(hand({up:OPEN,palm:.2}),20),{start:run.end});
  assert(near(run.samples.at(-1)[0].strength,-18,.01));
  run=feed(f,repeat(hand({up:OPEN,palm:.1}),30),{start:run.end});
  assert(near(run.samples.at(-1)[0].strength,-4.5,.01));
  run=feed(f,repeat([],12),{start:run.end});
  run=feed(f,repeat(hand({up:OPEN,palm:.1}),15),{start:run.end});
  assert(near(run.samples.at(-1)[0].strength,-18,.01));
});

test('fist and palm keep separate depth references when hand order swaps',()=>{
  const f=new HandForces();
  const initial=feed(f,repeat({hands:[hand({up:FIST,palm:.1}),hand({up:OPEN,palm:.2})],ids:[4,9]},12));
  const frames=Array.from({length:30},(_,i)=>{
    const a=hand({up:FIST,palm:.2}),b=hand({up:OPEN,palm:.1});
    return i%2?{hands:[a,b],ids:[4,9]}:{hands:[b,a],ids:[9,4]};
  });
  const byId=Object.fromEntries(feed(f,frames,{start:initial.end}).samples.at(-1).map(s=>[s.id,s]));
  assert(near(byId[4].strength,72,.01));assert(near(byId[9].strength,-4.5,.01));
});

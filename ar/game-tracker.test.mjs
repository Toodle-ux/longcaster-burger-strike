import test from 'node:test';
import assert from 'node:assert/strict';
await import('./coarse-model.js');
await import('./attack-region.js');
await import('./pose-tracker-game.js');
await import('./visual-tracker.js');
await import('./game-tracker.js');

const input={width:200,height:200,data:new Uint8ClampedArray(200*200*4)};
const box={x:60,y:40,width:80,height:40};
const detection={box,contour:[],sesame:{strong:false}};
function fixture(){
  const state={found:true,geometry:true,exposed:true,box:{...box},detection,center:{x:.5,y:.5},elevation:10};
  const visual={reset(){},update(){return {targetFound:state.found,state:state.found?'tracking':'lost',reason:'test',targetBounds:state.box};}};
  const geometry={reset(){},update(_,stamp,options){
    state.cap=options.capObservation;
    if(!state.geometry)return BurgerPose.empty(stamp,'weak-model-fit');
    return {...BurgerPose.empty(stamp),tracking:'found',targetFound:true,evidenceTimestampMs:stamp,
      pose:{center:{...state.center},scalePerSourceWidth:.02,elevationDegrees:state.elevation,rollDegrees:0},
      coreCenter:{x:.5,y:.5},coreBounds:{x:.48,y:.48,width:.04,height:.04},
      attackRegion:{center:{x:.5,y:.5},radiusMm:2,radiusX:.04,radiusY:.04},
      modelAttackability:state.exposed?'exposed':'blocked',reason:'current-model-fit'};
  }};
  return {state,tracker:new BurgerGameTracker.Tracker({visual,geometry,detect:()=>state.detection})};
}
test('game adapter preserves core offset and exposure while using the visual anchor',()=>{
  const {state,tracker}=fixture();state.box={...box,x:70};
  const r=tracker.update(input,0);
  assert.equal(r.tracking,'found');assert.deepEqual(r.coreCenter,{x:.55,y:.5});
  assert.notEqual(r.coreCenter.y,(state.box.y+state.box.height/2)/input.height);
  assert.equal(r.modelAttackability,'unknown');assert.equal(r.attackRegion.radiusMm,2);
  assert.deepEqual(r.attackRegion.center,r.coreCenter);assert.equal(r.evidenceTimestampMs,0);
  tracker.update(input,90);assert.equal(tracker.update(input,180).modelAttackability,'exposed');
  state.exposed=false;assert.equal(tracker.update(input,200).modelAttackability,'blocked');
});

test('a core branch jump is held without permission; repeated new evidence accepts a real view change',()=>{
  const {state,tracker}=fixture();tracker.update(input,0);tracker.update(input,90);tracker.update(input,180);
  state.center={x:.65,y:.5};state.elevation=50;
  let r=tracker.update(input,230);
  assert.equal(r.coreCenter,null);assert.equal(r.modelAttackability,'unknown');
  assert.equal(r.displayPose.center.x,.5);assert.equal(r.evidenceTimestampMs,180);
  tracker.update(input,320);r=tracker.update(input,410);
  assert.equal(r.coreCenter.x,.65);assert.equal(r.modelAttackability,'unknown');
  tracker.update(input,500);assert.equal(tracker.update(input,590).modelAttackability,'exposed');
});

test('alternating core estimates cannot move or indefinitely renew a held marker',()=>{
  const {state,tracker}=fixture();state.exposed=false;tracker.update(input,0);
  let r;
  for(let time=50;time<=550;time+=50){
    state.center={x:time%100?.65:.35,y:.5};r=tracker.update(input,time);
    assert.equal(r.coreCenter,null);assert.equal(r.modelAttackability,'unknown');
    if(time<500)assert.equal(r.displayPose.center.x,.5);
  }
  assert.equal(r.displayPose,null);assert.equal(r.evidenceTimestampMs,null);
});

test('uncertainty revokes attacks immediately and interrupts exposure confirmation',()=>{
  const {state,tracker}=fixture();tracker.update(input,0);tracker.update(input,90);
  assert.equal(tracker.update(input,180).modelAttackability,'exposed');
  state.geometry=false;assert.equal(tracker.update(input,200).modelAttackability,'unknown');
  state.geometry=true;assert.equal(tracker.update(input,250).modelAttackability,'unknown');
  tracker.update(input,340);assert.equal(tracker.update(input,430).modelAttackability,'exposed');
  state.exposed=false;assert.equal(tracker.update(input,450).modelAttackability,'blocked');
  state.exposed=true;assert.equal(tracker.update(input,500).modelAttackability,'unknown');
});

test('image translation and zoom follow immediately without a false core branch change',()=>{
  const {state,tracker}=fixture();tracker.update(input,0);tracker.update(input,90);tracker.update(input,180);
  state.box={x:64,y:36,width:96,height:48};const r=tracker.update(input,220);
  assert.equal(r.modelAttackability,'exposed');assert.equal(r.coreCenter.x,.56);
  assert.equal(r.coreCenter.y,.54);assert.equal(r.attackRegion.radiusX,.048);
});

test('a single exposed frame between blocked observations never enables attacks',()=>{
  const {state,tracker}=fixture();state.exposed=false;tracker.update(input,0);
  state.exposed=true;assert.equal(tracker.update(input,50).modelAttackability,'unknown');
  state.exposed=false;assert.equal(tracker.update(input,100).modelAttackability,'blocked');
  state.exposed=true;assert.equal(tracker.update(input,150).modelAttackability,'unknown');
});
test('visual recognition alone and mismatched detections cannot grant a core or an attack',()=>{
  const {state,tracker}=fixture();state.geometry=false;
  let r=tracker.update(input,0);
  assert.equal(r.visual.targetFound,true);assert.equal(r.coreCenter,null);assert.equal(r.modelAttackability,'unknown');
  state.geometry=true;state.detection={...detection,box:{...box,x:150}};
  r=tracker.update(input,33);
  assert.equal(state.cap,null);assert.equal(r.coreCenter,null);assert.equal(r.attackRegion,null);
  assert.equal(r.modelAttackability,'unknown');assert.equal(r.targetFound,false);
});
test('tracked display hold expires from the last geometry evidence and loss clears identity',()=>{
  const {state,tracker}=fixture();tracker.update(input,0);state.geometry=false;
  state.box={...box,x:68};let r=tracker.update(input,100);
  assert.equal(r.displayStatus,'held');assert.equal(r.displayPose.center.x,.54);
  assert.equal(r.coreCenter,null);assert.equal(r.attackRegion,null);assert.equal(r.modelAttackability,'unknown');
  assert.equal(r.evidenceTimestampMs,0);
  for(const stamp of [200,300,400,500])r=tracker.update(input,stamp);
  assert.equal(r.displayPose,null);assert.equal(r.evidenceTimestampMs,null);
  state.geometry=true;tracker.update(input,600);state.found=false;
  assert.equal(tracker.update(input,633).displayPose,null);
  state.found=true;state.geometry=false;assert.equal(tracker.update(input,666).displayPose,null);
});
test('a source gap or frame-size change cannot inherit geometry display',()=>{
  for(const change of ['gap','size']){
    const {state,tracker}=fixture();tracker.update(input,0);state.geometry=false;
    const r=tracker.update(change==='size'?{...input,width:100}:input,change==='gap'?400:33);
    assert.equal(r.displayPose,null);assert.equal(r.coreCenter,null);
  }
});

test('real detector and model keep an overhead cap blocked, and blank input loses the core',()=>{
  const width=240,height=180,data=new Uint8ClampedArray(width*height*4);
  const spots=[[-12,-9],[0,-14],[12,-6],[-10,8],[3,10],[14,11]];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=x-120,v=y-90;let c=[110,110,110];
    if(Math.hypot(u,v)<28)c=[180,90,25];
    if(spots.some(([sx,sy])=>Math.hypot(u-sx,v-sy)<1.8))c=[235,222,182];
    data.set([...c,255],(y*width+x)*4);
  }
  const tracker=new BurgerGameTracker.Tracker();let r;
  for(const time of [0,50,100,150])r=tracker.update({width,height,data},time);
  assert.equal(r.visual.targetFound,true);assert.equal(r.tracking,'found');
  assert.equal(r.modelAttackability,'blocked');assert.ok(r.attackRegion);
  assert.ok(Math.hypot(r.coreCenter.x-.5,r.coreCenter.y-.5)<.02);
  data.fill(110);r=tracker.update({width,height,data},200);
  assert.equal(r.coreCenter,null);assert.equal(r.modelAttackability,'unknown');assert.equal(r.displayPose,null);
});

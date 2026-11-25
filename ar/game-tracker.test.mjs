import test from 'node:test';
import assert from 'node:assert/strict';
await import('./coarse-model.js');
await import('./attack-region-game.js');
await import('./pose-tracker-game.js');
await import('./visual-tracker.js');
await import('./game-tracker.js');
const {permission,observation}=await import('../recognition.mjs');

const input={width:200,height:200,data:new Uint8ClampedArray(200*200*4)};
const box={x:60,y:40,width:80,height:40};
const detection={box,contour:[],sesame:{strong:false}};
function fixture(){
  const state={found:true,geometry:true,exposed:true,box:{...box},detection,center:{x:.5,y:.5},elevation:10,scale:.02};
  const visual={reset(){},update(){return {targetFound:state.found,state:state.found?'tracking':'lost',reason:'test',targetBounds:state.box,
    inlierPoints:state.inliers??0,lastDetectionAgeMs:state.detectionAge??0};}};
  const geometry={reset(){},update(_,stamp,options){
    state.cap=options.capObservation;
    state.recovery=options.contourRecovery;
    if(!state.geometry)return BurgerPose.empty(stamp,'weak-model-fit');
    const pose={center:{...state.center},scalePerSourceWidth:state.scale,elevationDegrees:state.elevation,rollDegrees:0};
    const core=BurgerAttackRegion.coreCenter(pose,input.width,input.height);
    return {...BurgerPose.empty(stamp),tracking:'found',targetFound:true,evidenceTimestampMs:stamp,
      pose,
      coreCenter:core,coreBounds:{x:.48,y:.48,width:.04,height:.04},
      attackRegion:{center:core,radiusMm:2,radiusX:state.scale*2,radiusY:state.scale*2},
      modelAttackability:state.unknown?'unknown':state.exposed?'exposed':'blocked',reason:'current-model-fit'};
  }};
  return {state,tracker:new BurgerGameTracker.Tracker({visual,geometry,detect:()=>state.detection})};
}
test('game adapter keeps the fresh model on its contour even when the texture ROI differs',()=>{
  const {state,tracker}=fixture();state.box={...box,x:70};
  const r=tracker.update(input,0);
  assert.equal(r.tracking,'found');assert.deepEqual(r.pose.center,{x:.5,y:.5});assert.ok(r.coreCenter.y>r.pose.center.y);
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

test('three fresh consistent models can confirm across brief misses; misses never score or renew hold',()=>{
  const {state,tracker}=fixture();tracker.update(input,0);
  state.center={x:.65,y:.5};state.elevation=50;
  assert.equal(tracker.update(input,100).stabilization.pendingFrames,1);
  state.geometry=false;let r=tracker.update(input,160);
  assert.equal(r.coreCenter,null);assert.equal(permission(r,0),'unknown');assert.equal(r.evidenceTimestampMs,0);
  state.geometry=true;assert.equal(tracker.update(input,220).stabilization.pendingFrames,2);
  state.geometry=false;assert.equal(tracker.update(input,280).coreCenter,null);
  state.geometry=true;r=tracker.update(input,340);
  assert.equal(r.coreCenter.x,.65);assert.equal(r.evidenceTimestampMs,340);
  assert.equal(r.modelAttackability,'unknown','position confirmation does not bypass exposure confirmation');
});

test('expired or conflicting confirmation votes cannot accumulate across missing frames',()=>{
  for(const change of ['gap','conflict','identity','detection']){
    const {state,tracker}=fixture();tracker.update(input,0);state.center={x:.65,y:.5};state.elevation=50;
    tracker.update(input,100);state.geometry=false;tracker.update(input,200);
    let time=300;
    if(change==='gap'){tracker.update(input,300);time=400;}
    if(change==='conflict'){state.center={x:.35,y:.5};}
    if(change==='identity'){state.found=false;tracker.update(input,250);state.found=true;}
    if(change==='detection'){state.detection={...detection,box:{...box,x:150}};tracker.update(input,250);state.detection=detection;}
    state.geometry=true;const r=tracker.update(input,time);
    if(change==='identity')assert.equal(r.modelAttackability,'unknown');
    else {assert.equal(r.stabilization.pendingFrames,1,change);assert.equal(r.coreCenter,null,change);}
  }
});

test('local contour search needs live texture identity and cannot override a conflicting detection',()=>{
  const {state,tracker}=fixture();let calls=0;
  tracker.recover=()=>{calls++;return {...detection,method:'tracked-colour-cap'};};
  state.detection=null;tracker.update(input,0);assert.equal(calls,0);
  state.inliers=8;state.detectionAge=200;let r=tracker.update(input,50);
  assert.equal(calls,1);assert.equal(r.stabilization.capMethod,'tracked-colour-cap');
  assert.equal(r.modelAttackability,'unknown');
  state.geometry=false;r=tracker.update(input,100);assert.equal(calls,2);assert.equal(r.coreCenter,null);
  state.detectionAge=3100;tracker.update(input,150);assert.equal(calls,2);
  state.detectionAge=0;state.detection={...detection,box:{...box,x:150}};tracker.update(input,200);assert.equal(calls,2);
  state.detection=null;state.found=false;tracker.update(input,250);assert.equal(calls,2);
});

test('recovered outline is measured from current pixels and still needs boundaries and filling',()=>{
  const width=240,height=180,box={x:85,y:48,width:70,height:34};
  function image({filling=true,cap=true}={}){
    const data=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      let c=[110,110,110];
      if(filling&&Math.abs(x-120)<34&&y>=82&&y<=97)c=[60,25,15];
      if(filling&&((x-120)/35)**2+((y-104)/9)**2<1)c=[40,170,25];
      if(cap&&((x-120)/35)**2+((y-65)/17)**2<1)c=[190,90,25];
      if(cap&&[[100,62],[109,57],[108,70]].some(([a,b])=>Math.hypot(x-a,y-b)<2))c=[235,222,182];
      data.set([...c,255],(y*width+x)*4);
    }
    return {width,height,data};
  }
  assert.equal(BurgerPose.detectCap(image()),null,'lopsided sesame remains invalid for global acquisition');
  const found=BurgerPose.recoverCap(image(),box);
  assert.ok(found);assert.ok(found.boundary.supported);assert.ok(found.contour.length>=6);
  assert.ok(found.box.x>=84&&found.box.x<=87);
  for(const frame of [image({filling:false}),image({cap:false})])assert.equal(BurgerPose.recoverCap(frame,box),null);
  assert.equal(BurgerPose.recoverCap(image(),{...box,x:5}),null);
  assert.equal(BurgerPose.recoverCap(image(),null),null);
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

test('brief misses revoke attacks but fresh same-target exposed evidence can resume',()=>{
  const {state,tracker}=fixture();tracker.update(input,0);tracker.update(input,90);
  assert.equal(tracker.update(input,180).modelAttackability,'exposed');
  state.geometry=false;assert.equal(tracker.update(input,200).modelAttackability,'unknown');
  state.geometry=true;const resumed=tracker.update(input,250);
  assert.equal(resumed.modelAttackability,'exposed');assert.equal(resumed.stabilization.reason,'exposure-resumed');
  tracker.update(input,340);assert.equal(tracker.update(input,430).modelAttackability,'exposed');
  state.exposed=false;assert.equal(tracker.update(input,450).modelAttackability,'blocked');
  state.exposed=true;assert.equal(tracker.update(input,500).modelAttackability,'unknown');
});

test('first exposure, expired evidence, conflicting poses and identity changes require confirmation',()=>{
  for(const change of ['first','expired','conflict','identity','branch']){
    const {state,tracker}=fixture();tracker.update(input,0);tracker.update(input,90);
    if(change!=='first')tracker.update(input,180);
    let stamp=250;
    if(change==='conflict'){state.unknown=true;tracker.update(input,200);state.unknown=false;}
    if(change==='identity'){state.found=false;tracker.update(input,200);state.found=true;}
    if(change==='branch'){state.center={x:.65,y:.5};tracker.update(input,200);state.center={x:.5,y:.5};}
    if(change==='expired'||change==='first'){
      state.geometry=false;tracker.update(input,200);
      if(change==='expired'){tracker.update(input,350);stamp=450;}
      state.geometry=true;
    }
    assert.equal(tracker.update(input,stamp).modelAttackability,'unknown',change);
  }
});

test('image translation and zoom follow immediately without a false core branch change',()=>{
  const {state,tracker}=fixture();tracker.update(input,0);tracker.update(input,90);tracker.update(input,180);
  state.box={x:64,y:36,width:96,height:48};state.detection={...detection,box:state.box};
  state.center={x:.56,y:.54};state.scale=.024;const r=tracker.update(input,220);
  assert.equal(r.modelAttackability,'exposed');assert.equal(r.coreCenter.x,.56);
  assert.equal(r.pose.center.y,.54);assert.ok(Math.abs(r.coreCenter.y-(.54+.024*Math.cos(10*Math.PI/180)))<1e-10);assert.equal(r.attackRegion.radiusX,.048);
});

test('a single exposed frame between blocked observations never enables attacks',()=>{
  const {state,tracker}=fixture();state.exposed=false;tracker.update(input,0);
  state.exposed=true;assert.equal(tracker.update(input,50).modelAttackability,'unknown');
  state.exposed=false;assert.equal(tracker.update(input,100).modelAttackability,'blocked');
  state.exposed=true;assert.equal(tracker.update(input,150).modelAttackability,'unknown');
});

test('current blocked evidence survives position confirmation, never authorizes hits or renews position',()=>{
  const {state,tracker}=fixture();state.exposed=false;tracker.update(input,0);
  state.center={x:.65,y:.5};state.elevation=60;const r=tracker.update(input,50);
  assert.equal(r.coreCenter,null);assert.equal(r.attackRegion,null);
  assert.equal(r.evidenceTimestampMs,0);assert.equal(r.occlusion.timestampMs,50);
  assert.equal(permission(r,0),'blocked');assert.equal(permission(r,251),'unknown');
  assert.equal(observation(r,0,251).state,'unknown');
  assert.equal(permission({...r,occlusion:{state:'blocked',timestampMs:0}},0),'unknown');
  state.geometry=false;const missing=tracker.update(input,100);
  assert.equal(permission(missing,0),'unknown');assert.equal(missing.occlusion,undefined);
});

test('exposed geometry never bypasses pending position, and visual loss clears negative evidence',()=>{
  const {state,tracker}=fixture();state.exposed=false;tracker.update(input,0);
  state.center={x:.65,y:.5};state.exposed=true;const r=tracker.update(input,50);
  assert.equal(permission(r,0),'unknown');assert.equal(r.occlusion,undefined);
  state.found=false;assert.equal(permission(tracker.update(input,100),0),'unknown');
});

test('small contour outliers require a prior lock; broad or extreme mismatch is rejected',()=>{
  const good={contourMaxError:.15,contourError:.018,contourOutlierFraction:.08};
  assert.equal(BurgerPose.supportsContour(good,true),true);
  assert.equal(BurgerPose.supportsContour(good,false),false);
  for(const bad of [{contourOutlierFraction:.2},{contourMaxError:.25},{contourError:.04}])
    assert.equal(BurgerPose.supportsContour({...good,...bad},true),false);
});

test('game contour recovery requires recent geometry of the same tracked target',()=>{
  const {state,tracker}=fixture();tracker.update(input,0);assert.equal(state.recovery,false);
  tracker.update(input,50);assert.equal(state.recovery,true);
  state.geometry=false;
  for(const time of [150,250,350,450,550])tracker.update(input,time);
  assert.equal(state.recovery,false);
  state.geometry=true;tracker.update(input,600);
  state.detection={...detection,box:{...box,x:150}};tracker.update(input,650);
  assert.equal(state.recovery,false);
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

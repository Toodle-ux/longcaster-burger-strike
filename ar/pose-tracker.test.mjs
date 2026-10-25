import assert from 'node:assert/strict';
import test from 'node:test';
await import('./coarse-model.js');
await import('./attack-region.js');
await import('./pose-tracker.js');

// A known overhead silhouette with separated sesame spots, no visible filling.
// This checks state/geometry contracts; it is not a real-camera accuracy test.
function overhead({dx=0,seeds=true,cap=true}={}){
  const width=240,height=180,data=new Uint8ClampedArray(width*height*4);
  const spots=[[-12,-9],[0,-14],[12,-6],[-10,8],[3,10],[14,11]];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const px=x-120-dx,py=y-90;
    let c=[110,110,110];
    if(cap&&Math.hypot(px,py)<28)c=[180,90,25];
    if(cap&&seeds&&spots.some(([sx,sy])=>Math.hypot(px-sx,py-sy)<1.8))c=[235,222,182];
    data.set([...c,255],(y*width+x)*4);
  }
  return {data,width,height};
}

test('overhead sesame cap localizes the centre without visible filling',()=>{
  const t=new BurgerPose.Tracker({mode:'table'}),r=t.update(overhead(),0,{temporal:false});
  assert.equal(r.targetFound,true);assert.ok(r.pose.elevationDegrees>=60);
  assert.ok(Math.hypot(r.coreCenter.x-.5,(r.coreCenter.y-.5)*180/240)<.02);
  assert.equal(r.modelAttackability,'blocked');assert.equal(r.attackability,'unknown');
  assert.equal(r.debug.capOnly,true);
});

test('featureless orange circle and empty background cannot initialize a target',()=>{
  for(const input of [overhead({seeds:false}),overhead({cap:false})]){
    const r=new BurgerPose.Tracker({mode:'table'}).update(input,0);
    assert.equal(r.targetFound,false);assert.equal(r.displayPose,null);assert.equal(r.modelAttackability,'unknown');
  }
});

test('brief image-supported hold never grants permission or renews evidence',()=>{
  const t=new BurgerPose.Tracker({mode:'table'});
  for(const stamp of [0,100,200])t.update(overhead(),stamp);
  // A colour dropout removes recognition cues but preserves the luminance
  // texture needed to verify a short translation of the already locked cap.
  const shifted=overhead({dx:6});
  for(let i=0;i<shifted.data.length;i+=4){const gray=(shifted.data[i]+2*shifted.data[i+1]+shifted.data[i+2])/4;shifted.data.fill(gray,i,i+3);}
  const r=t.update(shifted,300);
  assert.equal(r.tracking,'unknown');assert.equal(r.displayStatus,'held');
  assert.equal(r.displayMotion,'image-translation');assert.ok(r.displayPose.center.x>.51);
  assert.equal(r.evidenceTimestampMs,200);assert.equal(r.coreCenter,null);assert.equal(r.attackRegion,null);
  assert.equal(r.modelAttackability,'unknown');assert.equal(r.attackability,'unknown');
  const frozen=t.missing(600);assert.deepEqual(frozen.displayPose,r.displayPose);
  assert.equal(frozen.evidenceTimestampMs,200);
  const expired=t.missing(701);assert.equal(expired.displayPose,null);assert.equal(expired.tracking,'lost');
  t.update(overhead(),800);t.reset();assert.equal(t.missing(850).displayPose,null);
});

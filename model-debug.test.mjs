import test from 'node:test';
import assert from 'node:assert/strict';
import {modelSnapshot,screenPose} from './model-debug.mjs';
const pose={center:{x:.5,y:.5},scalePerSourceWidth:.01,elevationDegrees:23,rollDegrees:4};
const measured={type:'camera',diagnostics:{live:true,resultAgeMs:10,frameAgeMs:10},
  result:{pose,bunContour:[{x:.2,y:.3}],elevationRangeDegrees:[20,25]},
  displayPose:{...pose,center:{x:.6,y:.6}},displayStatus:'measured',state:'unknown'};
test('debug shows the actual accepted pose, not the smoothed gameplay position',()=>{
  const result=modelSnapshot(measured);assert.equal(result.pose,pose);
  assert.equal(result.status,'measured');assert.deepEqual(result.range,[20,25]);
  assert.equal(result.contour,measured.result.bunContour);assert.equal(result.state,'unknown');
});
test('held geometry is distinguished; expired, paused and missing geometry is cleared',()=>{
  const held=modelSnapshot({...measured,displayStatus:'held',diagnostics:{live:true,resultAgeMs:300,frameAgeMs:300}});
  assert.equal(held.pose,measured.displayPose);assert.equal(held.held,true);assert.equal(held.contour,null);assert.equal(held.range,null);
  assert.equal(modelSnapshot({...measured,displayPose:null,displayStatus:'none'}).pose,null);
  assert.equal(modelSnapshot({...measured,diagnostics:{live:false}}).pose,null);
  assert.equal(modelSnapshot({...measured,type:'demo'}).pose,null);
});
test('model uses the same cover/contain image transform across portrait and landscape',()=>{
  const camera=screenPose(pose,720,1280,844,390,'camera');
  assert.equal(camera.x,422);assert.equal(camera.y,195);assert.ok(Math.abs(camera.scale-8.44)<1e-10);
  const video=screenPose(pose,720,1280,844,390,'video');
  assert.equal(video.x,422);assert.equal(video.y,195);assert.ok(Math.abs(video.scale-2.19375)<1e-10);
  const portrait=screenPose(pose,720,1280,402,693,'camera');
  assert.equal(portrait.x,201);assert.equal(portrait.y,346.5);assert.ok(Math.abs(portrait.scale-4.02)<1e-10);
  assert.equal(camera.elevation,23);assert.equal(camera.roll,4);
});

test('debug core cross and normalized gameplay core agree without shifting model contours',()=>{
  for(const type of ['camera','video'])for(const [width,height] of [[402,780],[844,390]]){
    const transform=screenPose(pose,720,1280,width,height,type);
    const cross=BurgerAttackRegion.projectCore(transform);
    const normalized=BurgerAttackRegion.coreCenter(pose,720,1280);
    const coreTransform=screenPose({...pose,center:normalized},720,1280,width,height,type);
    assert.ok(Math.abs(cross.x-coreTransform.x)<1e-10);
    assert.ok(Math.abs(cross.y-coreTransform.y)<1e-10);
    assert.ok(cross.y>transform.y);
    assert.deepEqual(pose.center,{x:.5,y:.5});
  }
});

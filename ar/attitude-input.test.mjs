import assert from 'node:assert/strict';
import test from 'node:test';
await import('./attitude-input.js');

test('permission, actual events, invalid readings, stale data and stop are distinguishable',async()=>{
  let time=0;
  const target=new EventTarget();Object.assign(target,{isSecureContext:true,DeviceOrientationEvent:{requestPermission:async()=>'granted'},screen:{orientation:{angle:0}}});
  const reader=BurgerAttitudeInput.createReader({target,now:()=>time});
  await reader.enable();assert.equal(reader.snapshot().permission,'granted');assert.equal(reader.snapshot().state,'waiting');
  time=3001;assert.equal(reader.snapshot().state,'no-data');
  const invalid=new Event('deviceorientation');target.dispatchEvent(invalid);assert.equal(reader.snapshot().eventCount,1);assert.equal(reader.snapshot().validCount,0);
  const valid=new Event('deviceorientation');Object.assign(valid,{beta:45,gamma:0});target.dispatchEvent(valid);
  assert.equal(reader.snapshot().state,'receiving');time+=151;assert.equal(reader.snapshot().state,'stale');
  reader.clearSample();assert.equal(reader.snapshot().enabled,true);assert.equal(reader.snapshot().sample,null);
  reader.stop();target.dispatchEvent(valid);assert.equal(reader.snapshot().eventCount,2);assert.equal(reader.snapshot().state,'disabled');
});

test('denial and cancelled pending permission never start listening',async()=>{
  let resolve;
  const target=new EventTarget();Object.assign(target,{isSecureContext:true,DeviceOrientationEvent:{requestPermission:()=>new Promise(r=>resolve=r)}});
  const reader=BurgerAttitudeInput.createReader({target,now:()=>0});
  let request=reader.enable();resolve('denied');await request;assert.equal(reader.snapshot().permission,'denied');assert.equal(reader.snapshot().enabled,false);
  request=reader.enable();reader.stop();resolve('granted');await request;assert.equal(reader.snapshot().enabled,false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
await import('./table-attitude.js');
const {estimate,candidate}=BurgerTableAttitude;
const context={source:'camera',facingMode:'environment',mode:'table'};
const sample=(beta=90,gamma=0)=>({beta,gamma,screenAngle:0,receivedAtMs:1000});

test('rear camera elevation follows gravity and is independent of screen rotation',()=>{
  for(const [beta,gamma,expected] of [[90,0,0],[45,0,45],[0,0,90],[0,90,0]]){
    for(const screenAngle of [0,90,180,270]){
      const h=estimate({...sample(beta,gamma),screenAngle},1050,context);
      assert.equal(h.available,true);assert.ok(Math.abs(h.elevationDegrees-expected)<1e-6);
    }
  }
});

test('missing, stale, replay, handheld and unconfirmed cameras fall back to vision',()=>{
  for(const [s,time,c] of [[null,1050,context],[sample(),1151,context],[sample(),999,context],
    [sample(),1050,{...context,source:'video'}],[sample(),1050,{...context,mode:'handheld'}],
    [sample(),1050,{...context,facingMode:'user'}],[sample(),1050,{...context,facingMode:undefined}],
    [sample(120),1050,context]]){
    const h=estimate(s,time,c);assert.equal(h.available,false);
    assert.equal(candidate(h,90,{x:.5,y:.5},720,1280,time).penalty,0);
  }
});

test('soft aid is bounded, central only and expires even if a worker keeps its hint',()=>{
  const h=estimate(sample(),1050,context);
  assert.equal(candidate(h,10,{x:.5,y:.5},720,1280,1050).penalty,0);
  assert.equal(candidate(h,90,{x:.5,y:.5},720,1280,1050).penalty,.12);
  assert.equal(candidate(h,90,{x:.5,y:.8},720,1280,1050).used,false);
  assert.equal(candidate(h,90,null,720,1280,1050).used,false);
  assert.equal(candidate(h,90,{x:.5,y:.5},720,1280,1151).penalty,0);
});

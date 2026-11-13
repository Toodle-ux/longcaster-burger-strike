import assert from 'node:assert/strict';
import test from 'node:test';
await import('./table-attitude.js');
const {estimate,constraint}=BurgerTableAttitude;
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
    assert.equal(constraint(h,{x:.5,y:.5},720,1280,time).used,false);
  }
});

test('gravity constraint is central only and expires even if a worker keeps its hint',()=>{
  const h=estimate(sample(),1050,context);
  assert.equal(constraint(h,{x:.5,y:.5},720,1280,1050).used,true);
  assert.ok(Math.abs(constraint(h,{x:.5,y:.5},720,1280,1050).elevationDegrees)<1e-6);
  assert.equal(constraint(h,{x:.5,y:.8},720,1280,1050).used,false);
  assert.equal(constraint(h,null,720,1280,1050).used,false);
  assert.equal(constraint(h,{x:.5,y:.5},720,1280,1151).used,false);
});

test('projected model up follows gravity, including screen rotation and lateral tilt',async()=>{
  await import('./coarse-model.js');
  for(const screenAngle of [0,90,180,270])for(const [beta,gamma] of [[60,25],[45,-20],[0,0]]){
    const h=estimate({...sample(beta,gamma),screenAngle},1050,context);
    const p=BurgerModel.project([0,1,0],{x:0,y:0,scale:1,elevation:h.elevationDegrees,roll:h.rollDegrees});
    assert.ok(Math.abs(p.x-h.gravity.right)<.025);assert.ok(Math.abs(p.y+h.gravity.up)<.025);
  }
});

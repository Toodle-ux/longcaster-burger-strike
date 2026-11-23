import test from 'node:test';
import assert from 'node:assert/strict';
import {Mission} from './engine.mjs';
test('missing or blocked targets permit firing, consume ammo, and cannot score',()=>{
  for(const [tracked,exposed] of [[false,true],[false,false],[true,false]]){
    const m=new Mission();m.tracked=tracked;m.setExposure(exposed);
    const shot=m.fire(0);assert.ok(shot);assert.equal(m.ammo,7);
    assert.equal(m.resolve(shot.id),'miss');assert.equal(m.score,0);
  }
});
test('two independent reload slots and finite ammo still limit free firing',()=>{
  const m=new Mission();m.tracked=false;
  for(let time=0;time<12000;time+=3000){
    assert.ok(m.fire(time));assert.ok(m.fire(time));assert.equal(m.fire(time+1),null);
  }
  assert.equal(m.ammo,0);assert.equal(m.fire(15000),null);
});
test('an exposed core scores 400 once; shots after destruction remain misses',()=>{
  const m=new Mission(),a=m.fire(0),b=m.fire(10);
  assert.equal(m.resolve(a.id),'destroyed');assert.equal(m.resolve(b.id),null);
  assert.equal(m.score,400);const c=m.fire(3000);assert.ok(c);
  assert.equal(m.resolve(c.id),'miss');assert.equal(m.score,400);
});

import test from 'node:test';
import assert from 'node:assert/strict';
await import('./coarse-model.js');
await import('./attack-region-game.js');
test('visible rim above 15 percent cannot authorize a blocked centre ray',()=>{
  const r=BurgerAttackRegion.atElevation(40);
  assert.ok(r.fillingFraction>=.15);assert.equal(r.centerSurface,'bun');assert.equal(r.status,'blocked');
});
test('level shots reach filling, overhead shots hit bun, and mixed views remain unknown',()=>{
  assert.equal(BurgerAttackRegion.atElevation(0).status,'exposed');
  assert.equal(BurgerAttackRegion.atElevation(90).status,'blocked');
  assert.equal(BurgerAttackRegion.evaluate([30,40]).status,'unknown');
  assert.equal(BurgerAttackRegion.RULE.radiusMm,2);assert.equal(BurgerAttackRegion.RULE.minFillingFraction,.15);
});

test('core moves one model millimetre down, including rotated and overhead views',()=>{
  for(const elevation of [0,30,90])for(const roll of [0,30,-30]){
    const transform={x:120,y:80,scale:5,elevation,roll};
    const core=BurgerAttackRegion.projectCore(transform),e=elevation*Math.PI/180,r=roll*Math.PI/180;
    assert.ok(Math.abs(core.x-(120+5*Math.cos(e)*Math.sin(r)))<1e-10);
    assert.ok(Math.abs(core.y-(80+5*Math.cos(e)*Math.cos(r)))<1e-10);
    const normalized=BurgerAttackRegion.coreCenter({center:{x:.3,y:.1},scalePerSourceWidth:5/400,
      elevationDegrees:elevation,rollDegrees:roll},400,800);
    assert.ok(Math.abs(normalized.x-core.x/400)<1e-10);
    assert.ok(Math.abs(normalized.y-core.y/800)<1e-10);
  }
  // The calibrated point is below the old origin, so the occlusion boundary
  // also moves. A centre ray through bun still blocks despite a visible rim.
  assert.equal(BurgerAttackRegion.atElevation(36).status,'exposed');
  assert.equal(BurgerAttackRegion.atElevation(40).status,'blocked');
});

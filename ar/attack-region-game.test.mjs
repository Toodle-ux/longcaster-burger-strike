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

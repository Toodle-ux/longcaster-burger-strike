import test from 'node:test';
import assert from 'node:assert/strict';
await import('./core-display.js');
test('display convergence depends on elapsed time, not display refresh rate',()=>{
  function run(hz){const d=new BurgerCoreDisplay();d.step({x:0,y:0},0);let p;for(let n=1;n<=hz/5;n++)p=d.step({x:20,y:10},n*1000/hz);return p;}
  const a=run(30),b=run(60);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-8);
  assert.ok(a.x>17&&a.x<20);
});
test('subpixel jitter stays still and loss clears without a display tail',()=>{
  const d=new BurgerCoreDisplay();d.step({x:100,y:100},0);
  for(let n=1;n<20;n++)assert.deepEqual(d.step({x:100+(n%2?.2:-.2),y:100},n*16),{x:100,y:100});
  assert.equal(d.step(null,400),null);assert.deepEqual(d.step({x:300,y:200},416),{x:300,y:200});
});

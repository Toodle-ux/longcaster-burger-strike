import test from 'node:test';
import assert from 'node:assert/strict';
await import('./core-display-game.js');
test('small display jitter stays still without modifying measured points',()=>{
  const d=new BurgerCoreDisplay();d.step({x:100,y:100},0);
  for(let n=1;n<30;n++){
    const measured={x:100+(n%2?1:-1),y:100};
    assert.deepEqual(d.step(measured,n*16),{x:100,y:100});
    assert.equal(measured.x,100+(n%2?1:-1));
  }
});
test('real slow movement still follows; loss and reset remove old display coordinates',()=>{
  const d=new BurgerCoreDisplay();d.step({x:0,y:0},0);let p;
  for(let n=1;n<=30;n++)p=d.step({x:n,y:0},n*33);
  assert.ok(p.x>26&&p.x<=30);
  assert.equal(d.step(null,1100),null);assert.deepEqual(d.step({x:300,y:200},1120),{x:300,y:200});
  d.reset();assert.deepEqual(d.step({x:10,y:20},1140),{x:10,y:20});
});

import test from 'node:test';
import assert from 'node:assert/strict';
await import('./coarse-model.js');await import('./pose-tracker-game.js');
const contour=[{x:60,y:20},{x:140,y:20},{x:140,y:50},{x:60,y:50}];
function frame({lower=false,tray=false,thin=false,reversed=false,green=true}={}){
 const width=200,height=150,data=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<width*height;i++)data.set([110,110,110,255],i*4);
 const rect=(x0,x1,y0,y1,c)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)data.set([...c,255],(y*width+x)*4);};
 rect(60,140,reversed?77:58,reversed?91:69,[60,25,15]);
 if(green)rect(60,140,reversed?58:77,thin?77:reversed?69:91,[40,170,25]);
 if(lower)rect(60,140,94,98,[190,100,25]);
 if(tray)rect(15,185,94,120,[190,100,25]);
 return {width,height,data};
}
test('visible filling survives a missing lower bun; a bounded bun is optional support',()=>{
 const absent=BurgerPose.observeLayers(frame(),contour),visible=BurgerPose.observeLayers(frame({lower:true}),contour);
 assert.ok(absent.dark.y<absent.green.y);assert.equal(absent.lower,null);assert.ok(visible.lower);
 assert.deepEqual(absent.dark,visible.dark);assert.deepEqual(absent.green,visible.green);
});
test('tray colour cannot stand in for a hidden lower bun',()=>{
 const absent=BurgerPose.observeLayers(frame(),contour),tray=BurgerPose.observeLayers(frame({tray:true}),contour);
 assert.equal(tray.lower,null);assert.deepEqual(absent.dark,tray.dark);assert.deepEqual(absent.green,tray.green);
});
test('thin HUD lines, reversed colour order and absent filling provide no layer constraint',()=>{
 for(const options of [{thin:true},{reversed:true},{green:false}])assert.equal(BurgerPose.observeLayers(frame(options),contour),null);
 assert.equal(BurgerPose.observeLayers(frame(),null),null);
});

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

test('local cap refinement follows the shaded outer rim, including when the image rotates',()=>{
 for(const angle of [0,.25]){
  const width=200,height=150,data=new Uint8ClampedArray(width*height*4),c=Math.cos(angle),s=Math.sin(angle);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const dx=x-100,dy=y-65,u=dx*c+dy*s,v=-dx*s+dy*c;
   const inside=(u/42)**2+(v/25)**2<=1;
   data.set([...(inside?(v< -14?[160,100,112]:[190,90,30]):[210,215,213]),255],(y*width+x)*4);
  }
  const point=(u,v)=>({x:100+u*c-v*s,y:65+u*s+v*c});
  const contour=Array.from({length:32},(_,i)=>{const t=i*Math.PI/16;return point(40*Math.cos(t),Math.max(-14,24*Math.sin(t)));});
  const xs=contour.map(p=>p.x),ys=contour.map(p=>p.y);
  const observation={contour,box:{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}};
  const refined=BurgerPose.refineCap({width,height,data},observation);
  assert.ok(refined.refinement);
  const local=refined.contour.map(p=>({u:(p.x-100)*c+(p.y-65)*s,v:-(p.x-100)*s+(p.y-65)*c}));
  assert.ok(Math.min(...local.map(p=>p.v))< -21,'recover the crown rather than the internal colour boundary');
  assert.ok(local.every(p=>(p.u/46)**2+(p.v/29)**2<1.1),'stay near the actual outline');
  data.fill(110);
  assert.equal(BurgerPose.refineCap({width,height,data},observation),observation,'no image boundary cannot manufacture a measured contour');
 }
});

test('a colour proposal outside the real edge can shrink to current image boundaries',()=>{
 const width=200,height=150,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)
  data.set([...((x-100)**2/42**2+(y-65)**2/25**2<=1?[190,90,30]:[210,215,213]),255],(y*width+x)*4);
 const contour=Array.from({length:32},(_,i)=>({x:100+50*Math.cos(i*Math.PI/16),y:65+30*Math.sin(i*Math.PI/16)}));
 const observed={contour,box:{x:50,y:35,width:100,height:60}},r=BurgerPose.refineCap({width,height,data},observed);
 assert.ok(r.refinement);assert.ok(r.box.width>80&&r.box.width<90);
 assert.ok(r.box.height>47&&r.box.height<56);
});

test('visible layer sides do not bridge an adjacent disconnected dark cup',()=>{
 const input=frame();
 for(let y=58;y<=69;y++)for(let x=148;x<=170;x++)input.data.set([60,25,15,255],(y*input.width+x)*4);
 const layers=BurgerPose.observeLayers(input,contour);
 assert.equal(layers.sides.length,2);
 assert.deepEqual(layers.sides.map(s=>[s.left,s.right]),[[60,140],[60,140]]);
});

test('disconnected orange islands inside a cap bounding box cannot enter its contour',()=>{
 const width=240,height=180,data=new Uint8ClampedArray(width*height*4);
 const spots=[[-16,-14],[0,-18],[15,-10],[-12,12],[5,15],[19,14]];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=x-100,v=y-75;let rgb=[110,110,110];
  if(Math.hypot(u,v)<40)rgb=[180,75,25];
  if(spots.some(([sx,sy])=>Math.hypot(u-sx,v-sy)<2))rgb=[235,222,182];
  data.set([...rgb,255],(y*width+x)*4);
 }
 const clean=BurgerPose.detectCap({width,height,data});assert.ok(clean);
 for(const [cx,cy] of [[63,38],[137,38],[63,112],[137,112]])
  for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++)data.set([180,75,25,255],(y*width+x)*4);
 const cluttered=BurgerPose.detectCap({width,height,data});
 assert.deepEqual(cluttered.contour,clean.contour);assert.deepEqual(cluttered.box,clean.box);
});

test('a one-mask lateral background attachment does not enlarge the cap',()=>{
 const width=320,height=200,data=new Uint8ClampedArray(width*height*4);
 const spots=[[-16,-14],[0,-18],[15,-10],[-12,12],[5,15],[19,14]];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=x-130,v=y-85;let rgb=[110,110,110];
  if(Math.hypot(u,v)<40)rgb=[180,75,25];
  if(spots.some(([sx,sy])=>Math.hypot(u-sx,v-sy)<2))rgb=[235,222,182];
  data.set([...rgb,255],(y*width+x)*4);
 }
 const input={width,height,data},clean=BurgerPose.detectCap(input);assert.ok(clean);
 for(let y=77;y<=92;y++)for(let x=167;x<=190;x++)
  if(Math.hypot(x-130,y-85)>=40)data.set([180,112,25,255],(y*width+x)*4);
 const attached=BurgerPose.detectCap(input);assert.ok(attached);
 assert.deepEqual(attached.box,clean.box);
 assert.deepEqual(attached.contour,clean.contour);
});

import assert from 'node:assert/strict';
import test from 'node:test';
await import('./visual-tracker.js');
// Analytic textured target supplies known motion; detector jitter is injected
// separately. These tests verify tracking mechanics, not burger recognition.
function frame(i,{absent=false}={}){
  const width=240,height=180,data=new Uint8ClampedArray(width*height*4),scale=1+i*.006,cx=115+i*1.5,cy=85+i*.5;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=(x-cx)/scale,v=(y-cy)/scale;
    let c=80;
    if(!absent&&Math.abs(u)<38&&Math.abs(v)<28)c=(125+37*Math.sin(u*.45)*Math.sin(v*.6)+28*Math.cos(u*.21+v*.31))*(.85+.15*Math.cos(i*.3));
    data.set([c,c,c,255],4*(y*width+x));
  }
  return {input:{data,width,height},box:{x:cx-38*scale,y:cy-28*scale,width:76*scale,height:56*scale},center:{x:cx,y:cy},scale};
}

test('unsmoothed image track follows translation/zoom despite brightness and detector jitter',()=>{
  const tracker=new BurgerVisual.Tracker({detect:()=>null});let origin=null,maxError=0,n=0;
  for(let i=0;i<35;i++){
    const f=frame(i),jitter=i<2?0:Math.sin(i*2)*4,detection={box:{...f.box,x:f.box.x+jitter,y:f.box.y-jitter},contour:[]};
    const r=tracker.update(f.input,i*33,{detection});
    if(r.targetFound){
      origin??={x:r.anchor.x-f.center.x,y:r.anchor.y-f.center.y};
      maxError=Math.max(maxError,Math.hypot(r.anchor.x-f.center.x-origin.x,r.anchor.y-f.center.y-origin.y));n++;
      assert.equal(r.attackability,'unknown');assert.equal(r.coreCenter,null);
    }
  }
  assert.ok(n>=30,`only ${n} tracked`);assert.ok(maxError<2,`drift ${maxError}`);
});

test('no texture/evidence cannot silently retain a fresh target or cross a source gap',()=>{
  const tracker=new BurgerVisual.Tracker({detect:()=>null});
  for(let i=0;i<4;i++){const f=frame(i);tracker.update(f.input,i*33,{detection:{box:f.box,contour:[]}});}
  const missing=tracker.update(frame(4,{absent:true}).input,132,{detection:null});
  assert.equal(missing.targetFound,false);assert.equal(missing.anchor,null);assert.equal(missing.attackability,'unknown');
  const f=frame(0),gap=tracker.update(f.input,1000,{detection:{box:f.box,contour:[]}});
  assert.equal(gap.state,'candidate');assert.equal(gap.targetFound,false);
});

test('repeated in-plane motion does not inflate the tracked width',()=>{
  // A static repeated frame must keep both coordinates and scale, rather than
  // growing its box through enclosing-rectangle or integer-rounding feedback.
  const tracker=new BurgerVisual.Tracker({detect:()=>null}),f=frame(0);let first,last;
  for(let i=0;i<30;i++){
    const r=tracker.update(f.input,i*33,{detection:{box:f.box,contour:[]}});
    if(r.targetFound){first??=r;last=r;}
  }
  assert.ok(Math.abs(last.targetBounds.width/first.targetBounds.width-1)<.02);
  assert.ok(Math.hypot(last.anchor.x-first.anchor.x,last.anchor.y-first.anchor.y)<1);
});

test('image-only continuation expires without detector verification',()=>{
  const tracker=new BurgerVisual.Tracker({detect:()=>null}),f=frame(0);
  tracker.update(f.input,0,{detection:{box:f.box,contour:[]}});
  assert.equal(tracker.update(f.input,33,{detection:{box:f.box,contour:[]}}).targetFound,true);
  let last;
  for(let t=66;t<1100;t+=33)last=tracker.update(f.input,t,{detection:null});
  assert.equal(last.targetFound,false);assert.equal(last.anchor,null);
});

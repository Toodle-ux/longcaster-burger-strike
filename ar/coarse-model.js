/* Review geometry only: millimetres, +Y up, filling centre at (0,0,0).
 * Rotational symmetry deliberately omits yaw, sesame and individual leaves.
 * A known centre in this model is NOT evidence of a measured camera pose.
 * Classic script keeps the local photo review usable from file:// without a CDN.
 */
(() => {
  const colors = {upper:[255,183,92],filling:[88,212,186],lower:[230,207,136]};
  const presets = {
    // User-selected manual candidate, 2026-10-21. Keep geometry shared across
    // images; the exported per-photo position/angle is not a calibrated pose.
    // These fitted dimensions do not replace the earlier physical measurements.
    candidate:Object.freeze({upperHeight:6.5,fillingHeight:13.8,lowerHeight:2.4,upperDiameter:21.4,fillingDiameter:22.1,lowerDiameter:22.1}),
    // Photo estimates are editable hypotheses, not measurements or fitted pose.
    photo:{upperHeight:6,fillingHeight:14,lowerHeight:3,upperDiameter:20,fillingDiameter:22,lowerDiameter:20},
    // Only total=23, filling=18 and bottom diameter=20 were reported. The 3.5/1.5
    // split of the remaining 5 mm and the two other diameters are assumptions.
    measured:{upperHeight:3.5,fillingHeight:18,lowerHeight:1.5,upperDiameter:20,fillingDiameter:22,lowerDiameter:20}
  };
  const radians = degrees => degrees*Math.PI/180;
  function rotate([x,y,z], pose) {
    const a=radians(pose.elevation), b=radians(pose.roll);
    const vertical=y*Math.cos(a)-z*Math.sin(a);
    return [x*Math.cos(b)-vertical*Math.sin(b),x*Math.sin(b)+vertical*Math.cos(b),y*Math.sin(a)+z*Math.cos(a)];
  }
  function project(point, pose) {
    const [x,y,z]=rotate(point,pose);
    return {x:pose.x+x*pose.scale,y:pose.y-y*pose.scale,z};
  }
  function mesh(dimensions) {
    const d=dimensions, half=d.fillingHeight/2, vertices=[], faces=[], edges=new Map(), rings=[];
    function revolve(profile, part) {
      const start=vertices.length, segments=64;
      for(const [radius,y] of profile)for(let i=0;i<segments;i++) {
        const t=i*Math.PI*2/segments;vertices.push([radius*Math.cos(t),y,radius*Math.sin(t)]);
      }
      for(let row=0;row<profile.length-1;row++)for(let i=0;i<segments;i++) {
        const next=(i+1)%segments;
        const ids=[start+row*segments+i,start+(row+1)*segments+i,start+(row+1)*segments+next,start+row*segments+next];
        const face=faces.length;faces.push({ids,part});
        for(let j=0;j<4;j++) {
          const a=ids[j],b=ids[(j+1)%4],key=[Math.min(a,b),Math.max(a,b)].join(':');
          if(!edges.has(key))edges.set(key,{a,b,faces:[],part});edges.get(key).faces.push(face);
        }
      }
    }
    const r=d.upperDiameter/2,h=d.upperHeight;
    const crown=[[0,half],[r*.94,half],[r,half+h*.16]];
    for(let i=1;i<=12;i++) {
      const t=i/12*Math.PI/2;crown.push([r*Math.cos(t),half+h*(.16+.84*Math.sin(t))]);
    }
    revolve(crown,'upper');
    revolve([[0,-half],[d.fillingDiameter/2,-half],[d.fillingDiameter/2,half],[0,half]],'filling');
    const rb=d.lowerDiameter/2,y=-half,hl=d.lowerHeight;
    revolve([[0,y-hl],[rb*.86,y-hl],[rb*.98,y-hl*.78],[rb,y-hl*.35],[rb*.97,y],[0,y]],'lower');
    rings.push({radius:r*.94,y:half,part:'upper'},{radius:rb*.97,y:-half,part:'lower'});
    return {vertices,faces,edges:[...edges.values()],rings};
  }
  function normal(points) {
    // Some pole quads have one collapsed edge; choose the non-degenerate triangle.
    const a=points[1].map((v,i)=>v-points[0][i]);
    let b=points[2].map((v,i)=>v-points[0][i]);
    let n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    if(Math.hypot(...n)<1e-8) {
      b=points[3].map((v,i)=>v-points[0][i]);
      const c=points[2].map((v,i)=>v-points[0][i]);
      n=[c[1]*b[2]-c[2]*b[1],c[2]*b[0]-c[0]*b[2],c[0]*b[1]-c[1]*b[0]];
    }
    const length=Math.hypot(...n)||1;return n.map(v=>v/length);
  }
  function path(ctx, points, close=true) {
    ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(close)ctx.closePath();
  }
  function draw(ctx, model, pose, {opacity=.38,wire=false,core=true,markerSize=9,labels=true,uiScale=1}={}) {
    const projected=model.vertices.map(p=>project(p,pose));
    const faces=model.faces.map((face,index)=>{
      const n=rotate(normal(face.ids.map(i=>model.vertices[i])),pose);
      return {...face,index,visible:n[2]>1e-7,normal:n,depth:face.ids.reduce((sum,i)=>sum+projected[i].z,0)/4};
    });
    // Composite the opaque surfaces first, then blend the whole model with the
    // photograph: hidden rear surfaces must not shine through as extra layers.
    const layer=document.createElement('canvas');layer.width=ctx.canvas.width;layer.height=ctx.canvas.height;
    const paint=layer.getContext('2d');
    if(!wire)for(const face of faces.filter(f=>f.visible).sort((a,b)=>a.depth-b.depth)) {
      const light=.78+.22*Math.max(0,face.normal[0]*-.35+face.normal[1]*.45+face.normal[2]*.82);
      paint.fillStyle=`rgb(${colors[face.part].map(v=>Math.round(v*light)).join(',')})`;
      path(paint,face.ids.map(i=>projected[i]));paint.fill();
      paint.lineWidth=.6;paint.strokeStyle=paint.fillStyle;paint.stroke();
    }
    ctx.save();ctx.globalAlpha=opacity;ctx.drawImage(layer,0,0);ctx.restore();
    // The outline view intentionally includes hidden layer rims as dashed lines,
    // useful when checking where the filling stops underneath the bun.
    ctx.save();ctx.lineWidth=1.2*uiScale;
    for(const edge of model.edges) {
      if(edge.faces.length===2&&faces[edge.faces[0]].visible===faces[edge.faces[1]].visible)continue;
      if(!edge.faces.some(i=>faces[i].visible))continue;
      ctx.strokeStyle=`rgb(${colors[edge.part].join(',')})`;path(ctx,[projected[edge.a],projected[edge.b]],false);ctx.stroke();
    }
    for(const ring of model.rings)for(const rear of [true,false]) {
      ctx.strokeStyle=`rgba(${colors[ring.part].join(',')},${rear?.5:.95})`;ctx.setLineDash(rear?[4*uiScale,5*uiScale]:[]);
      for(let i=0;i<64;i++) {
        const t=(i+.5)*Math.PI*2/64;
        const isRear=rotate([Math.cos(t),0,Math.sin(t)],pose)[2]<0;
        if(isRear!==rear)continue;
        const points=[i,i+1].map(j=>project([ring.radius*Math.cos(j*Math.PI*2/64),ring.y,ring.radius*Math.sin(j*Math.PI*2/64)],pose));
        path(ctx,points,false);ctx.stroke();
      }
    }
    ctx.restore();
    if(core) {
      const p=project([0,0,0],pose),s=markerSize*uiScale;
      ctx.save();ctx.lineWidth=4*uiScale;ctx.strokeStyle='#10251d';
      const cross=()=>{ctx.beginPath();ctx.moveTo(p.x-s,p.y);ctx.lineTo(p.x+s,p.y);ctx.moveTo(p.x,p.y-s);ctx.lineTo(p.x,p.y+s);ctx.stroke();};
      cross();ctx.lineWidth=1.5*uiScale;ctx.strokeStyle='#fff';cross();ctx.beginPath();ctx.arc(p.x,p.y,2*uiScale,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();
      if(labels) {ctx.font=`${12*uiScale}px system-ui`;ctx.fillStyle='#10251ddd';ctx.fillRect(p.x+s+5*uiScale,p.y-14*uiScale,66*uiScale,24*uiScale);ctx.fillStyle='#fff';ctx.fillText('夹心中心',p.x+s+12*uiScale,p.y+3*uiScale);}
      ctx.restore();
    }
  }
  globalThis.BurgerModel={presets,mesh,project,draw};
})();

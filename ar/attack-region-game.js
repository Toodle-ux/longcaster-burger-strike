/* Geometry-only gameplay rule. Load coarse-model.js first. No image evidence,
 * hand/prop occlusion, temporal permission or score handling belongs here.
 * The core sits 1 mm below the filling origin; its orthographic footprint is a
 * radius-2 mm disk. Trace that disk through the SAME mesh used for fitting.
 * A ray reaching filling counts as exposed, even though the core is internal.
 * 15% is an initial gameplay tolerance, NOT a recognition confidence threshold.
 */
(() => {
  const RULE=Object.freeze({radiusMm:2,minFillingFraction:.15,maxBlockedFillingFraction:.02,sampleStepMm:.25});
  const model=globalThis.BurgerModel,mesh=model.mesh(model.presets.game),cache=new Map();
  // Gameplay calibration in model millimetres (+Y is up), not screen pixels.
  // Keep fitting the unchanged mesh at its origin; all core consumers share this offset.
  const CORE=Object.freeze([0,-1,0]);
  // A source transform can also be transported to the preview canvas. Focal
  // length and principal point then follow the same cover/contain mapping.
  function sourceTransform(pose,width,height){
    return {x:pose.center.x*width,y:pose.center.y*height,scale:pose.scalePerSourceWidth*width,
      elevation:pose.elevationDegrees,roll:pose.rollDegrees,...(pose.focalPerSourceWidth?
        {focal:pose.focalPerSourceWidth*width,principalX:width/2,principalY:height/2}:{})};
  }
  function projector(t){
    if(!t.focal)return point=>model.project(point,t);
    const f=t.focal,tx=(t.x-t.principalX)/f,ty=(t.y-t.principalY)/f,z=f/t.scale;
    const inv=1/Math.hypot(tx,ty,1),rx=tx*inv,ry=ty*inv,rz=inv,h=Math.hypot(rx,rz);
    const a=t.elevation*Math.PI/180,b=t.roll*Math.PI/180;
    const ca=Math.cos(a),sa=Math.sin(a),cr=Math.cos(b),sr=Math.sin(b);
    return ([x,y,front])=>{
      const vertical=y*ca-front*sa,u=x*cr-vertical*sr,v=-x*sr-vertical*cr,depth=y*sa+front*ca;
      const X=tx*z+u*rz/h-v*rx*ry/h-depth*rx;
      const Y=ty*z+v*h-depth*ry,Z=z-u*rx/h-v*ry*rz/h-depth*rz;
      return {x:t.principalX+f*X/Z,y:t.principalY+f*Y/Z,z:1/Z};
    };
  }
  const projectCore=transform=>projector(transform)(CORE);
  function coreCenter(pose,width,height){
    const p=projectCore(sourceTransform(pose,width,height));
    return {x:p.x/width,y:p.y/height};
  }
  function atCameraPose(pose,width,height){
    const transform=sourceTransform(pose,width,height),project=projector(transform),core=project(CORE);
    // The radius-2 mm sample disk is in the image-parallel plane through
    // the model's core. Reciprocal depth is linear across a projected triangle.
    const scale=transform.focal*core.z;
    const points=mesh.vertices.map(point=>{
      const q=project(point);return {x:(q.x-core.x)/scale,y:(q.y-core.y)/scale,z:q.z};
    });
    return {evidence:sampleDisk(points,pose.elevationDegrees),scale};
  }

  function atElevation(elevation) {
    if(!Number.isFinite(elevation)||elevation< -90||elevation>90)throw new RangeError('Elevation must be -90..90 degrees');
    // No quantisation here: callers can also inspect the rule between the
    // tracker's 10-degree pose templates. Normal tracking uses only 17 entries.
    if(cache.has(elevation))return cache.get(elevation);
    const transform={x:0,y:0,scale:1,elevation,roll:0},core=projectCore(transform);
    const vertices=mesh.vertices.map(p=>{const q=model.project(p,transform);return {...q,x:q.x-core.x,y:q.y-core.y};});
    const result=sampleDisk(vertices,elevation);cache.set(elevation,result);return result;
  }
  function sampleDisk(vertices,elevation){
    const step=RULE.sampleStepMm,half=Math.ceil(RULE.radiusMm/step),n=half*2+1;
    const depth=new Float64Array(n*n).fill(-Infinity),material=new Uint8Array(n*n);
    for(const face of mesh.faces)for(const ids of [[0,1,2],[0,2,3]]) {
      const [a,b,c]=ids.map(i=>vertices[face.ids[i]]),den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
      if(Math.abs(den)<1e-9)continue;
      const x0=Math.max(0,Math.ceil(Math.min(a.x,b.x,c.x)/step+half)),x1=Math.min(n-1,Math.floor(Math.max(a.x,b.x,c.x)/step+half));
      const y0=Math.max(0,Math.ceil(Math.min(a.y,b.y,c.y)/step+half)),y1=Math.min(n-1,Math.floor(Math.max(a.y,b.y,c.y)/step+half));
      for(let iy=y0;iy<=y1;iy++)for(let ix=x0;ix<=x1;ix++) {
        const x=(ix-half)*step,y=(iy-half)*step;
        if(x*x+y*y>RULE.radiusMm**2)continue;
        const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den,w=1-u-v;
        if(u< -1e-8||v< -1e-8||w< -1e-8)continue;
        const z=u*a.z+v*b.z+w*c.z,k=iy*n+ix;
        if(z>depth[k]){depth[k]=z;material[k]=face.part==='filling'?2:1;}
      }
    }
    const samples=[];let filling=0,bun=0;
    for(let iy=0;iy<n;iy++)for(let ix=0;ix<n;ix++) {
      const x=(ix-half)*step,y=(iy-half)*step;if(x*x+y*y>RULE.radiusMm**2)continue;
      const m=material[iy*n+ix];filling+=m===2;bun+=m===1;
      samples.push(Object.freeze({x,y,surface:m===2?'filling':m===1?'bun':'unknown'}));
    }
    const fillingFraction=filling/samples.length,bunFraction=bun/samples.length;
    const center=material[half*n+half];
    // A visible rim cannot authorize a shot through the bun at the core centre.
    const status=filling+bun!==samples.length?'unknown':center===1?'blocked':
      center===2&&fillingFraction>=RULE.minFillingFraction?'exposed':'unknown';
    const result=Object.freeze({elevationDegrees:elevation,fillingFraction,bunFraction,status,
      centerSurface:center===2?'filling':center===1?'bun':'unknown',samples:Object.freeze(samples)});
    return result;
  }
  function evaluate(elevations) {
    if(!elevations.length)return {status:'unknown',fillingFractionRange:null,centerSurface:'unknown'};
    const values=[...new Set(elevations)].map(atElevation),first=values[0];
    return {status:values.every(v=>v.status===first.status)?first.status:'unknown',
      fillingFractionRange:[Math.min(...values.map(v=>v.fillingFraction)),Math.max(...values.map(v=>v.fillingFraction))],
      centerSurface:values.every(v=>v.centerSurface===first.centerSurface)?first.centerSurface:'unknown'};
  }
  globalThis.BurgerAttackRegion={RULE,CORE,projector,projectCore,coreCenter,atElevation,atCameraPose,evaluate};
})();

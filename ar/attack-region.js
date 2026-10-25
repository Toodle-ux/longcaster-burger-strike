/* Geometry-only gameplay rule. Load coarse-model.js first. No image evidence,
 * hand/prop occlusion, temporal permission or score handling belongs here.
 * The sphere stays at the filling origin; its orthographic footprint is a
 * radius-2 mm disk. Trace that disk through the SAME mesh used for fitting.
 * A ray reaching filling counts as exposed, even though the core is internal.
 * 15% is an initial gameplay tolerance, NOT a recognition confidence threshold.
 */
(() => {
  const RULE=Object.freeze({radiusMm:2,minFillingFraction:.15,maxBlockedFillingFraction:.02,sampleStepMm:.25});
  const model=globalThis.BurgerModel,mesh=model.mesh(model.presets.candidate),cache=new Map();
  function atElevation(elevation) {
    if(!Number.isFinite(elevation)||elevation< -90||elevation>90)throw new RangeError('Elevation must be -90..90 degrees');
    // No quantisation here: callers can also inspect the rule between the
    // tracker's 10-degree pose templates. Normal tracking uses only 17 entries.
    if(cache.has(elevation))return cache.get(elevation);
    const step=RULE.sampleStepMm,half=Math.ceil(RULE.radiusMm/step),n=half*2+1;
    const depth=new Float64Array(n*n).fill(-Infinity),material=new Uint8Array(n*n);
    const vertices=mesh.vertices.map(p=>model.project(p,{x:0,y:0,scale:1,elevation,roll:0}));
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
    const status=filling+bun!==samples.length?'unknown':fillingFraction>=RULE.minFillingFraction?'exposed':fillingFraction<=RULE.maxBlockedFillingFraction?'blocked':'unknown';
    const center=material[half*n+half];
    const result=Object.freeze({elevationDegrees:elevation,fillingFraction,bunFraction,status,
      centerSurface:center===2?'filling':center===1?'bun':'unknown',samples:Object.freeze(samples)});
    cache.set(elevation,result);return result;
  }
  function evaluate(elevations) {
    if(!elevations.length)return {status:'unknown',fillingFractionRange:null,centerSurface:'unknown'};
    const values=[...new Set(elevations)].map(atElevation),first=values[0];
    return {status:values.every(v=>v.status===first.status)?first.status:'unknown',
      fillingFractionRange:[Math.min(...values.map(v=>v.fillingFraction)),Math.max(...values.map(v=>v.fillingFraction))],
      centerSurface:values.every(v=>v.centerSurface===first.centerSurface)?first.centerSurface:'unknown'};
  }
  globalThis.BurgerAttackRegion={RULE,atElevation,evaluate};
})();

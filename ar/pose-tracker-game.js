/* Fixed-shape, local-only experiment. Load coarse-model.js first; optional
 * attack-region.js enables the radius-2 mm geometric preview. Without it the
 * new preview fields stay unknown. Actual attackability still stays unknown.
 * Fits orthographic projections of the selected mesh to colour/layer evidence.
 * This is NOT calibrated 6-DoF pose, a trained burger recognizer or a hand mask.
 * Geometry is never resized per part. Pose/scale are the only fit variables.
 * API: new BurgerPose.Tracker().update({data,width,height}, monotonicMs).
 * Output coordinates use the unmirrored source frame, before CSS cropping.
 * attackability stays unknown in this alignment-only stage, including holds.
 * Local replay uses the SAME clips as development, not independent validation.
 * Output counts and temporal smoothness are NOT recognition accuracy.
 * 2026-10-21, 640x360 at 10 Hz, found/held/lost: plain 207/35/47,
 * desk 236/72/45. Consecutive accepted >25% shrink events: desk 9 -> 0,
 * but rejected frames become unknown/lost; this is NOT a pose accuracy gain.
 * Partial finger occlusion can still cause undersized/inverted fits; steep
 * tilts, blur and fast motion can lose or shift the centre. No iPhone live test.
 * timestampMs is source time (video media time, monotonic time for a camera).
 * displayPose is smoothed/held for <=500 ms for UI only. Integrators must consume
 * tracking, evidenceTimestampMs, poseStatus and attackability separately.
 * displayStatus=held carries no coreCenter/pose. Use displayOpacity to fade
 * the last-known marker; call missing(now) if the source stops delivering frames.
 * Tracker({mode:'table'}) adds observed cap contour fitting, upright geometry
 * and a limited camera roll search. It is NOT a measured table plane or IMU pose.
 * 2026-10-23 new table clip, 134 frames at 10 Hz: 70 oblique-top / 64 unknown
 * view classifications; 106 measured poses / 24 held / 4 lost. Development
 * clip, not held-out accuracy. 0s/2s: old 0/0 degrees -> about 50/40 degrees.
 * Reported wood candidate at 1.1-1.7s rejected at 10/30 Hz after requiring
 * cap/filling size and position agreement and rejecting clipped/bridged caps.
 * Weak boundaries (~4s), glare, distant targets and camera motion
 * still fail. Near-level reference photo gives a 10-20 degree range (unknown),
 * not a verified level-view success. No calibrated angles or iPhone live test.
 * 2026-10-25: independent sesame-cap evidence now supports overhead views
 * without visible filling. Cap-only evidence never enables an exposed state.
 * A held display may translate from the last measured image for <=250 ms,
 * then freeze/fade until 500 ms; displayMotion identifies this UI-only cue.
 * Original top photos 209/210 give blocked, bottom photo 212 remains lost.
 * Old table replay: 111 found / 23 held of 134 frames. New phone SCREEN
 * recording (browser chrome cropped, HUD still present): 304 found / 95 held /
 * 108 lost of 507 frames at 10 Hz. These are development output counts, not
 * accuracy. Multiple burgers and distant/blurred views still lose or swap
 * candidates. Screen recordings cannot validate raw phone camera throughput.
 * 2026-11-12: rank close current-frame fits with a bounded stable-pose prior.
 * No extra attack dwell and no changes to geometry or the 2 mm / 15% rule.
 * New screen-recording 6-18s replay: 22 -> 16 state switches, exposed outputs
 * 90 -> 95 of 120; tracking found remains 111. This is not accuracy, and
 * false blocks/pose jumps remain. Real side -> top photo transition revokes
 * exposed immediately. Diagnostic candidate scores are not probabilities.
 */
(() => {
  const modelAPI=globalThis.BurgerModel,geometry=modelAPI.presets.candidate;
  const DEG=Math.PI/180,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const wrap=a=>((a+180)%360+360)%360-180;
  const HOLD_MS=500;
  // Bounds are experimental rates, not physical guarantees. Scale is px/mm,
  // NOT the projected bounding-box size, which changes when the burger tilts.
  function continuity(p,reference,dtMs) {
    if(!reference)return {cost:0,allowed:true};
    const dt=Math.max(0,dtMs)/1000;
    const size=Math.abs(Math.log(p.scale/reference.scale))/(.08+.8*dt);
    const position=Math.hypot(p.x-reference.x,p.y-reference.y)/(reference.scale*geometry.fillingDiameter*(.12+2*dt));
    return {cost:.055*Math.min(size,3)+.035*Math.min(position,3),allowed:size<=1&&position<=1,size,position};
  }
  const merit=(p,e,reference,dtMs)=>e.rankingScore-continuity(p,reference,dtMs).cost-
    (reference ? .02*Math.min(2,Math.abs(p.t-reference.t)/3) : 0);
  const NONE=0,GREEN=1,YELLOW=2,BUN=3,DARK=4,WHITE=5;
  function hull(points) {
    points.sort((a,b)=>a.x-b.x||a.y-b.y);
    const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),chain=[];
    for(const p of points){while(chain.length>1&&cross(chain.at(-2),chain.at(-1),p)<=0)chain.pop();chain.push(p);}
    const lower=chain.length;
    for(let i=points.length-2;i>=0;i--){const p=points[i];while(chain.length>lower&&cross(chain.at(-2),chain.at(-1),p)<=0)chain.pop();chain.push(p);}
    chain.pop();return chain;
  }
  function bounds(points){const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};}
  function supportsContour(e,locked){
    return e.contourMaxError<.13||locked&&e.contourError<.025&&
      e.contourMaxError<.2&&e.contourOutlierFraction<=.1;
  }
  function edgeDistance(p,polygon) {
    let best=Infinity;
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dy=b.y-a.y;
      const t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
      // One square root per point, not per polygon edge. Same distance metric.
      const ex=p.x-a.x-t*dx,ey=p.y-a.y-t*dy;
      best=Math.min(best,ex*ex+ey*ey);
    }
    return Math.sqrt(best);
  }
  function sesameEvidence(frame,cap,whiteComponents) {
    const w=cap.right-cap.left+1,h=cap.bottom-cap.top+1,cx=(cap.left+cap.right)/2,cy=(cap.top+cap.bottom)/2;
    const spots=whiteComponents.filter(q=>{
      if(q.count>w*h*.025||q.count<1||((q.x-cx)/(w*.43))**2+((q.y-cy)/(h*.43))**2>1)return false;
      const x=Math.round(q.x),y=Math.round(q.y),d=Math.max(2,Math.round(w*.06)),k=y*frame.w+x;
      return x>d&&y>d&&x<frame.w-d&&y<frame.h-d&&[k-d,k+d,k-d*frame.w,k+d*frame.w].filter(j=>frame.labels[j]===BUN).length>=3;
    });
    // Several separated pale islands surrounded by orange; a single glare,
    // HUD line or pale table edge is not evidence of a sesame bun.
    const spread=spots.length?bounds(spots):null;
    return {count:spots.length,offsetX:spots.length?Math.abs(spots.reduce((s,p)=>s+p.x,0)/spots.length-cx)/w:0,
      spanX:spread?(spread.right-spread.left)/w:0,
      strong:spots.length>=3&&spots.reduce((s,p)=>s+p.count,0)>=5&&
      spread.right-spread.left>w*.22&&spread.bottom-spread.top>h*.18};
  }
  function capObservation(input,frame,selection) {
    // Red-orange crown proposal, separate from broad BUN material scoring.
    // This empirical colour test can fail on reddish wood, shadows or glare.
    // Convex completion bridges sesame holes; it is an observed candidate,
    // not a model silhouette or a guaranteed complete segmentation.
    const data=input.data,greens=components(frame,GREEN,5),whites=components(frame,WHITE,1);
    const side=sideCapObservation(input,frame,selection,greens,whites);
    if(side)return side;
    // Start broad to retain the orange rim. Tighten only when it merges with
    // the wooden background; a single strict threshold clips the crown and
    // can itself turn an oblique view into a falsely shallow one.
    for(const redRatio of [1.48,1.65,1.8,1.95]){
    const labels=new Uint8Array(frame.labels.length);
    for(let i=0;i<labels.length;i++){
      const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
      if(r>85&&r>g*redRatio&&g>b*1.3&&g>32)labels[i]=BUN;
    }
    const candidates=[];
    for(const q of components({...frame,labels},BUN,35).slice(0,30)){
      const w=q.right-q.left+1,h=q.bottom-q.top+1;
      if(w<20||w>frame.w*.4||h/w<.22||h/w>1.25||q.count/(w*h)<.42)continue;
      // A complete cap cannot run out of the frame. Large wood patches used
      // to borrow a small nearby lettuce component as supporting evidence.
      if(q.left<=1||q.top<=1||q.right>=frame.w-2||q.bottom>=frame.h-2)continue;
      if(selection&&Math.hypot(q.x-selection.x*frame.w,q.y-selection.y*frame.h)>w*1.5)continue;
      const green=greens.find(g=>{
        const gw=g.right-g.left+1;
        return gw>=w*.4&&gw<=w*1.6&&Math.abs(g.x-q.x)<w*.5&&g.y>q.y&&g.y-q.y<w*1.2&&g.count>5;
      });
      const sesame=sesameEvidence(frame,q,whites);
      // A connected orange background/drink can borrow the burger's sesame.
      // Reject a lopsided cluster, then retry the stricter colour proposals;
      // never crop an invented bun out of an oversized connected component.
      if(sesame.count>=3&&(sesame.offsetX>.12||sesame.spanX<.28))continue;
      // Overhead views hide the filling. They may propose a cap independently;
      // acceptance still requires a rounded complete contour and a top-view fit.
      if(!green&&!(h/w>=.65&&sesame.strong))continue;
      const points=[];let white=0;
      for(let y=q.top;y<=q.bottom;y++)for(let x=q.left;x<=q.right;x++){
        const k=y*frame.w+x;
        if(frame.labels[k]===WHITE)white++;
        if(labels[k]===BUN&&(labels[k-1]!==BUN||labels[k+1]!==BUN||labels[k-frame.w]!==BUN||labels[k+frame.w]!==BUN))points.push({x,y});
      }
      if(white<3||points.length<6)continue;
      const outline=hull(points);
      // Long straight bridges in the crown are usually convex completion
      // across attached background. Allow a flat lower rim in a side view.
      const bridges=outline.filter((p,i)=>{
        const next=outline[(i+1)%outline.length];
        return Math.hypot(p.x-next.x,p.y-next.y)>w*.45&&(p.y+next.y)/2<q.bottom-h*.2;
      });
      // A shallow real crown can have a long, almost flat top. Only accept
      // that exception when the image supports the boundary AND filling;
      // a convex bridge across orange background must still be rejected.
      if(bridges.length&&!(green&&h/w<.6&&
        confirmCap(input,{x:q.left,y:q.top,width:w,height:h}).supported&&
        bridges.every(p=>supportedTopEdge(frame,p,outline[(outline.indexOf(p)+1)%outline.length],q))))continue;
      candidates.push({points:outline,...q,width:w,green,redRatio,sesame});
    }
    candidates.sort((a,b)=>b.count-a.count);
    // Do not choose between two similarly large orange/green objects.
    if(candidates.length>1&&candidates[1].count>candidates[0].count*.7)return null;
    if(candidates.length)return candidates[0];
    }
    return null;
  }
  function supportedTopEdge(frame,a,b,box){
    const w=box.right-box.left+1,h=box.bottom-box.top+1,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
    if(Math.abs(dy)>Math.abs(dx)*.35||(a.y+b.y)/2>box.top+h*.45)return false;
    const d=Math.max(2,w*.035),nx=-dy/length,ny=dx/length;
    let supported=0;
    for(let i=1;i<=7;i++){
      const x=a.x+dx*i/8,y=a.y+dy*i/8;
      const inside=Math.round(y+ny*d)*frame.w+Math.round(x+nx*d);
      const outside=Math.round(y-ny*d)*frame.w+Math.round(x-nx*d);
      const warm=v=>v===BUN||v===YELLOW||v===WHITE;
      if(warm(frame.labels[inside])&&!warm(frame.labels[outside])&&
        Math.abs(frame.gray[inside]-frame.gray[outside])>=18)supported++;
    }
    return supported>=5;
  }
  // Side-view proposal: yellow rim and orange crown belong to one silhouette.
  // Pale holes are allowed inside it, but a coloured rectangle alone is not
  // evidence: require an observed boundary on all sides and filling below.
  function sideCapObservation(input,frame,selection,greens,whites){
    const warm=v=>v===BUN||v===YELLOW,labels=Uint8Array.from(frame.labels,v=>warm(v)?BUN:NONE),candidates=[];
    const regions=components({...frame,labels},BUN,35).slice(0,30);
    for(const source of regions){
      const q={...source},w=q.right-q.left+1;
      // Warm cheese can touch the crown at its sides. Split only at an
      // observed dark rim spanning the central width, never a fixed model cut.
      if(w>=20&&w<=frame.w*.4&&(q.bottom-q.top+1)/w<.6){
        let previousDark=false;
        for(let y=q.top+Math.ceil(w*.22);y<=q.bottom;y++){
          let dark=0,n=0;
          for(let x=q.left+Math.ceil(w*.15);x<=q.right-w*.15;x++){n++;if(frame.labels[y*frame.w+x]===DARK)dark++;}
          const isDark=dark/n>=.65;
          if(isDark&&previousDark){q.bottom=y-2;q.y=(q.top+q.bottom)/2;break;}
          previousDark=isDark;
        }
      }
      const h=q.bottom-q.top+1;
      if(w<20||w>frame.w*.4||h/w<.22||h/w>=.6)continue;
      // A cheese strip under a larger crown is not a second, shallow crown.
      // Use actual neighbouring components, not an assumed table/horizon.
      if(regions.some(p=>p!==source&&p.right-p.left+1>=w*.65&&p.right-p.left+1<=w*1.6&&
        p.bottom-p.top+1>=w*.22&&Math.abs(p.x-q.x)<w*.3&&p.top<q.top-w*.15&&
        p.bottom<=q.top+w*.15&&q.top-p.bottom<w*.2))continue;
      if(q.left<4||q.top<4||q.right>=frame.w-4||q.bottom>=frame.h-4)continue;
      if(selection&&Math.hypot(q.x-selection.x*frame.w,q.y-selection.y*frame.h)>w*1.5)continue;
      const green=greens.find(g=>g.right-g.left+1>=w*.5&&g.right-g.left+1<=w*1.5&&Math.abs(g.x-q.x)<w*.3&&g.y>q.bottom&&g.y-q.bottom<w*.7);
      if(!green||!confirmCap(input,{x:q.left,y:q.top,width:w,height:h}).supported)continue;
      const points=[];let pale=0,red=0;q.count=0;
      for(let y=q.top;y<=q.bottom;y++)for(let x=q.left;x<=q.right;x++){
        const k=y*frame.w+x;
        if(frame.labels[k]===WHITE)pale++;
        if(labels[k]===BUN)q.count++;
        const r=input.data[k*4],g=input.data[k*4+1],b=input.data[k*4+2];
        if(r>85&&r>g*1.48&&g>b*1.3&&g>32)red++;
        if(labels[k]===BUN&&(labels[k-1]!==BUN||labels[k+1]!==BUN||labels[k-frame.w]!==BUN||labels[k+frame.w]!==BUN))points.push({x,y});
      }
      if(pale<3||red<w*h*.1||(q.count+pale)/(w*h)<.4||points.length<6)continue;
      const outline=hull(points),sesame=sesameEvidence(frame,q,whites);
      // A plain rectangular rim is insufficient; retain observed shoulder
      // segments without imposing a particular dome height at shallow angles.
      if(outline.length<6)continue;
      if(sesame.count>=3&&(sesame.offsetX>.12||sesame.spanX<.28))continue;
      const edge=sideBoundaryEvidence(input,frame,outline,q);
      if(!edge.supported)continue;
      candidates.push({...q,points:outline,width:w,green,sesame,method:'side-outline',edge});
    }
    candidates.sort((a,b)=>b.count-a.count);
    if(candidates.length>1&&candidates[1].count>candidates[0].count*.7)return null;
    return candidates[0]??null;
  }
  function sideBoundaryEvidence(input,frame,outline,box){
    const w=box.right-box.left+1,h=box.bottom-box.top+1,d=Math.max(2,w*.025),total=[0,0,0,0],good=[0,0,0,0];
    for(let i=0;i<outline.length;i++){
      const a=outline[i],b=outline[(i+1)%outline.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
      const nx=-dy/length,ny=dx/length,steps=Math.max(1,Math.ceil(length/Math.max(3,w*.06)));
      const side=Math.abs(nx)>Math.abs(ny)?nx>0?0:1:ny>0?2:3;
      for(let s=0;s<steps;s++){
        const x=a.x+dx*(s+.5)/steps,y=a.y+dy*(s+.5)/steps;
        const ix=Math.round(x+nx*d),iy=Math.round(y+ny*d),ox=Math.round(x-nx*d),oy=Math.round(y-ny*d);
        total[side]++;
        if(ix<0||iy<0||ox<0||oy<0||ix>=frame.w||ox>=frame.w||iy>=frame.h||oy>=frame.h)continue;
        const inside=iy*frame.w+ix,outside=oy*frame.w+ox,label=frame.labels[inside];
        const contrast=Math.hypot(...[0,1,2].map(c=>input.data[inside*4+c]-input.data[outside*4+c]));
        if((label===BUN||label===YELLOW||label===WHITE)&&contrast>=40)good[side]++;
      }
    }
    const fractions=good.map((v,i)=>v/Math.max(1,total[i]));
    // A side wall may blend into the background while the top, bottom and
    // opposite wall remain clear. This exception is only used by the side
    // proposal, which also requires aligned filling and consecutive detections
    // before tracking. A missing top/bottom edge cannot use this exception.
    const strong=fractions.every(v=>v>=.55);
    const oneWeakSide=fractions[2]>=.65&&fractions[3]>=.65&&
      Math.min(fractions[0],fractions[1])>=.25&&Math.max(fractions[0],fractions[1])>=.65&&
      fractions.reduce((s,v)=>s+v,0)/4>=.7;
    return {supported:strong||oneWeakSide,partialBoundary:!strong&&oneWeakSide,fractions};
  }
  function classify(r,g,b) {
    const hi=Math.max(r,g,b),lo=Math.min(r,g,b),delta=hi-lo,s=delta/Math.max(1,hi);
    if(r>155&&g>140&&b>95&&lo/hi>.51&&s<.5)return WHITE;
    if(hi<22||delta<9)return NONE;
    let hue=(hi===r?(g-b)/delta:hi===g?2+(b-r)/delta:4+(r-g)/delta)*60;
    if(hue<0)hue+=360;
    if(hue>=62&&hue<=160&&s>.35&&g>40)return GREEN;
    if(hue>=39&&hue<65&&s>.54&&hi>65)return YELLOW;
    if(hue>=9&&hue<42&&s>.57&&hi>75)return BUN;
    if((hue<43||hue>345)&&hi<140&&s>.18)return DARK;
    return NONE;
  }
  function frameData({data,width,height}) {
    const labels=new Uint8Array(width*height),gray=new Uint8Array(width*height);
    for(let i=0;i<labels.length;i++) {
      const r=data[i*4],g=data[i*4+1],b=data[i*4+2];labels[i]=classify(r,g,b);gray[i]=(r+2*g+b)/4;
    }
    return {labels,gray,w:width,h:height};
  }
  function components(frame,label,minimum) {
    const {labels,w,h}=frame,seen=new Uint8Array(w*h),queue=new Int32Array(w*h),out=[];
    for(let i=0;i<labels.length;i++) {
      if(seen[i]||labels[i]!==label)continue;
      let head=0,tail=1,sx=0,sy=0,xx=0,yy=0,xy=0,left=w,right=0,top=h,bottom=0;queue[0]=i;seen[i]=1;
      while(head<tail) {
        const p=queue[head++],x=p%w,y=(p/w)|0;sx+=x;sy+=y;xx+=x*x;yy+=y*y;xy+=x*y;
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
          const nx=x+dx,ny=y+dy,j=ny*w+nx;
          if(nx<0||ny<0||nx>=w||ny>=h||seen[j]||labels[j]!==label)continue;seen[j]=1;queue[tail++]=j;
        }
      }
      if(tail>=minimum)out.push({x:sx/tail,y:sy/tail,count:tail,left,right,top,bottom,
        xx:xx/tail-(sx/tail)**2,yy:yy/tail-(sy/tail)**2,xy:xy/tail-sx*sy/tail**2});
    }
    return out.sort((a,b)=>b.count-a.count);
  }
  let templates;
  const templateOf=p=>p.template??templates[p.t];
  function buildTemplates(elevations=Array.from({length:17},(_,i)=>-70+i*10)) {
    // Rasterize nearest surfaces with a tiny software z-buffer. Labels and
    // silhouettes come from the SAME mesh rendered by the review/overlay page.
    const mesh=modelAPI.mesh(geometry),N=65,step=.55;
    const output=[];
    for(const elevation of elevations) {
      const pose={x:0,y:0,scale:1,elevation,roll:0},points=mesh.vertices.map(p=>modelAPI.project(p,pose));
      const depth=new Float32Array(N*N).fill(-Infinity),material=new Uint8Array(N*N),worldY=new Float32Array(N*N);
      for(const face of mesh.faces)for(const indices of [[0,1,2],[0,2,3]]) {
        const ids=indices.map(i=>face.ids[i]),[a,b,c]=ids.map(i=>points[i]);
        const den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-8)continue;
        const minX=clamp(Math.floor(Math.min(a.x,b.x,c.x)/step+32),0,64),maxX=clamp(Math.ceil(Math.max(a.x,b.x,c.x)/step+32),0,64);
        const minY=clamp(Math.floor(Math.min(a.y,b.y,c.y)/step+32),0,64),maxY=clamp(Math.ceil(Math.max(a.y,b.y,c.y)/step+32),0,64);
        for(let iy=minY;iy<=maxY;iy++)for(let ix=minX;ix<=maxX;ix++) {
          const x=(ix-32)*step,y=(iy-32)*step;
          const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den,t=1-u-v;
          if(u<0||v<0||t<0)continue;const z=u*a.z+v*b.z+t*c.z,k=iy*N+ix;
          if(z<=depth[k])continue;depth[k]=z;material[k]=face.part==='upper'?1:face.part==='filling'?2:3;
          worldY[k]=u*mesh.vertices[ids[0]][1]+v*mesh.vertices[ids[1]][1]+t*mesh.vertices[ids[2]][1];
        }
      }
      const samples=[],groups=[0,0,0,0],anchors={green:{x:0,y:0,n:0},bun:{x:0,y:0,n:0}};
      for(let y=2;y<N-2;y+=3)for(let x=2;x<N-2;x+=3) {
        const k=y*N+x,m=material[k];
        const neighbour=[material[k-2],material[k+2],material[k-2*N],material[k+2*N]];
        if(!m&&!neighbour.some(Boolean))continue;
        // Exclude edge pixels from material tests; the irregular real toy has
        // lettuce protrusions and boundaries unlike this deliberately coarse mesh.
        if(m&&neighbour.some(n=>n!==m))continue;
        const p={x:(x-32)*step,y:(y-32)*step,m,band:worldY[k]>geometry.fillingHeight*.22?0:worldY[k]<-geometry.fillingHeight*.1?2:1};samples.push(p);groups[m]++;
        const anchor=m===1?anchors.bun:m===2&&worldY[k]<-1.5?anchors.green:null;
        if(anchor){anchor.x+=p.x;anchor.y+=p.y;anchor.n++;}
      }
      for(const a of Object.values(anchors)){a.x/=a.n||1;a.y/=a.n||1;}
      // Thin lower bun: dense interior samples, kept separate from mandatory
      // material evidence. Its absence behind a tray must not lower confidence.
      const lowerSamples=[];
      for(let y=1;y<N-1;y++)for(let x=2;x<N-2;x+=3){
        const k=y*N+x;
        if(material[k]===3&&[k-1,k+1,k-N,k+N].every(i=>material[i]===3))
          lowerSamples.push({x:(x-32)*step,y:(y-32)*step});
      }
      const layerAnchors=[1,2].map(band=>{
        const points=samples.filter(p=>p.m===2&&p.band===band&&Math.abs(p.x)<geometry.upperDiameter*.23);
        return points.length>=3?{x:points.reduce((s,p)=>s+p.x,0)/points.length,
          y:points.reduce((s,p)=>s+p.y,0)/points.length}:null;
      });
      const upperIds=new Set(mesh.faces.filter(f=>f.part==='upper').flatMap(f=>f.ids));
      output.push({elevation,samples,groups,anchors,layerAnchors,lowerSamples,upperHull:hull([...upperIds].map(i=>({x:points[i].x,y:points[i].y}))),centerMaterial:material[32*N+32]===2?'filling':'bun'});
    }
    return output;
  }
  const palette=[
    [1,0,0,0,.6,1],          // outside: do not punish skin/background indiscriminately
    [0,0,.55,1,.25,.4],     // upper bun: allow seeds/highlights
    [0,1,.9,.08,.7,.08],    // filling: dark brown alone cannot initialize a target
    [0,0,.8,1,.15,.25]      // lower bun
  ];
  // Weak colour order for this single toy style; these are image cues inside
  // the filling, not additional geometry or a learned material classifier.
  const fillingBands=[[0,.15,1,.25,.3,.1],[0,.15,.3,.15,1,.1],[0,1,.25,.05,.25,.1]];
  // Current visible bands only, not a hidden-bottom estimate or meat detector.
  // Broad dark-above-green support prevents a thin HUD line or side decoration
  // from becoming a layer measurement. Unavailable evidence is neutral.
  function visibleLayers(frame){
    if(!frame.cap)return null;
    const b=bounds(frame.cap.points),w=b.right-b.left;
    const left=Math.max(0,Math.ceil(b.left+w*.27)),right=Math.min(frame.w-1,Math.floor(b.right-w*.27));
    const top=Math.ceil(b.bottom+w*.015),bottom=Math.min(frame.h-1,Math.floor(b.bottom+w*.8));
    const rows=[];
    for(let y=top;y<=bottom;y++){
      let green=0,dark=0,warm=0;
      for(let x=left;x<=right;x++){
        const v=frame.labels[y*frame.w+x];green+=v===GREEN;dark+=v===DARK;warm+=v===BUN||v===YELLOW;
      }
      const n=right-left+1;rows.push({y,green:green/n,dark:dark/n,warm:warm/n});
    }
    const runs=(key,threshold,minHeight,start,end)=>{
      const found=[];let run=[];
      const finish=()=>{if(run.length>=Math.max(3,w*minHeight)){
        const weight=run.reduce((s,r)=>s+r[key],0);
        found.push({top:run[0].y,bottom:run.at(-1).y,y:run.reduce((s,r)=>s+r.y*r[key],0)/weight,
          support:weight/run.length});}run=[];};
      for(const r of rows){if(r.y>=start&&r.y<=end&&r[key]>=threshold)run.push(r);else finish();}finish();return found;
    };
    const green=runs('green',.4,.04,top+w*.04,bottom)[0];
    if(!green)return null;
    const dark=runs('dark',.35,.025,top,green.top-1).sort((a,b)=>(b.bottom-b.top)*b.support-(a.bottom-a.top)*a.support)[0];
    if(!dark||green.y-dark.y<w*.06)return null;
    const lowerEnd=Math.min(bottom,green.bottom+w*.14);
    const lower=runs('warm',.6,.025,green.bottom+1,lowerEnd).find(run=>{
      // An open-ended warm strip or one extending beyond the burger can be
      // the tray. Without both boundaries, there is no lower-bun observation.
      if(run.bottom>=Math.floor(lowerEnd)-1)return false;
      const cy=Math.round(run.y),cx=(b.left+b.right)/2;
      for(const sign of [-1,1]){
        let warm=0;
        for(let i=0;i<5;i++){
          const x=Math.round(cx+sign*w*(.62+i*.025)),v=frame.labels[cy*frame.w+x];
          if(x<0||x>=frame.w)return false;
          warm+=v===BUN||v===YELLOW;
        }
        if(warm>=3)return false;
      }
      return true;
    })??null;
    return {dark,green,lower,width:w};
  }
  function evaluate(frame,p) {
    const template=templateOf(p),c=Math.cos(p.roll*DEG),s=Math.sin(p.roll*DEG),sum=[0,0,0,0],count=[0,0,0,0];
    let greens=0,darks=0,buns=0;
    for(const q of template.samples) {
      const x=Math.round(p.x+p.scale*(q.x*c+q.y*s)),y=Math.round(p.y+p.scale*(-q.x*s+q.y*c));
      const label=x<0||y<0||x>=frame.w||y>=frame.h?NONE:frame.labels[y*frame.w+x];
      sum[q.m]+=q.m===2?.55*palette[2][label]+.45*fillingBands[q.band][label]:palette[q.m][label];count[q.m]++;
      if(q.m===2&&label===GREEN)greens++;
      if(q.m===2&&label===DARK)darks++;
      if(q.m===1&&label===BUN)buns++;
    }
    const fraction=sum.map((v,i)=>v/(count[i]||1));
    const weights=[.23,.34,.35,.08];let score=0,total=0;
    for(let i=0;i<4;i++)if(count[i]){score+=fraction[i]*weights[i];total+=weights[i];}
    let contourError=null,contourMaxError=null,capHeightError=null,contourOutlierFraction=null;
    score=score/total-(count[1]<3?.4:0);
    if(frame.cap){
      const projected=template.upperHull.map(q=>({x:p.x+p.scale*(q.x*c+q.y*s),y:p.y+p.scale*(-q.x*s+q.y*c)}));
      const observed=frame.cap.points;
      const aBox=bounds(projected),bBox=bounds(observed);
      capHeightError=Math.abs((aBox.bottom-aBox.top)-(bBox.bottom-bBox.top))/frame.cap.width;
      const a=observed.map(q=>edgeDistance(q,projected)),b=projected.map(q=>edgeDistance(q,observed));
      contourError=(a.reduce((s,x)=>s+x,0)/a.length+b.reduce((s,x)=>s+x,0)/b.length)/(2*frame.cap.width);
      contourMaxError=Math.max(...a,...b)/frame.cap.width;
      // Count outliers separately in each direction: many good template points
      // must not hide a substantial missing section of the observed outline.
      contourOutlierFraction=Math.max(...[a,b].map(errors=>errors.filter(e=>e/frame.cap.width>.1).length/errors.length));
      score=.45*score+.55*Math.max(0,1-contourError*8);
    }
    let layerError=null,layerBonus=0,lowerBonus=0;
    if(frame.layers&&template.layerAnchors.every(Boolean)){
      const predicted=template.layerAnchors.map(q=>p.y+p.scale*(-q.x*s+q.y*c));
      layerError=(Math.abs(predicted[0]-frame.layers.dark.y)+Math.abs(predicted[1]-frame.layers.green.y))/(2*frame.layers.width);
      // The stylised layers are irregular: do not chase sub-band pixel noise.
      // Only use their positions to rank materially different model fits.
      layerBonus=.06*clamp((.12-layerError)/.08,0,1);
      if(frame.layers.lower&&template.lowerSamples.length){
        let supported=0;
        for(const q of template.lowerSamples){
          const x=Math.round(p.x+p.scale*(q.x*c+q.y*s)),y=Math.round(p.y+p.scale*(-q.x*s+q.y*c));
          if(x<0||x>=frame.w||y<frame.layers.lower.top||y>frame.layers.lower.bottom)continue;
          const label=frame.labels[y*frame.w+x];supported+=label===BUN||label===YELLOW;
        }
        lowerBonus=.01*supported/template.lowerSamples.length;
      }
    }
    return {score,rankingScore:score+layerBonus+lowerBonus,layerEvidence:frame.layers??null,layerError,layerBonus,lowerBonus,
      lowerSampleCount:template.lowerSamples.length,contourError,contourMaxError,capHeightError,contourOutlierFraction,
      upper:fraction[1],filling:fraction[2],lower:fraction[3],outside:fraction[0],greens,darks,buns,fillSamples:count[2]};
  }
  // The detected cap fixes translation and scale for EACH orientation. Colour
  // evidence may select a view, but cannot slide/shrink the model off the bun.
  function alignCap(frame,p) {
    if(!frame.table||!frame.cap)return p;
    const c=Math.cos(p.roll*DEG),s=Math.sin(p.roll*DEG);
    const box=bounds(templateOf(p).upperHull.map(q=>({x:q.x*c+q.y*s,y:-q.x*s+q.y*c})));
    const observed=bounds(frame.cap.points),scale=(observed.right-observed.left)/(box.right-box.left);
    return {...p,scale,x:(observed.left+observed.right-scale*(box.left+box.right))/2,
      y:(observed.top+observed.bottom-scale*(box.top+box.bottom))/2};
  }
  function refine(frame,start,previous,dtMs,stable=null) {
    let p=alignCap(frame,frame.table&&!frame.attitude?.used?
      {...start,t:Math.round(start.t),template:undefined}:{...start}),e=evaluate(frame,p);
    let score=merit(p,e,previous,dtMs);
    const diameter=p.scale*geometry.fillingDiameter;
    for(const fraction of [1,.5])for(let pass=0;pass<2;pass++) {
      for(const [key,step] of [['x',Math.max(1,diameter*.07)*fraction],['y',Math.max(1,diameter*.07)*fraction],['scale',p.scale*.07*fraction],['roll',6*fraction],['t',1]]) {
        if(frame.table&&['x','y','scale'].includes(key))continue;
        if(frame.attitude?.used&&(key==='roll'||key==='t'))continue;
        let best=p,bestEvidence=e,bestScore=score;
        for(const sign of [-1,1]) {
          let q={...p,[key]:p[key]+sign*step};q.roll=wrap(q.roll);
          if(q.t<0||q.t>=templates.length||q.scale<.55||q.scale>frame.w/28)continue;
          if(frame.table&&!frame.attitude?.used&&(q.t<7||Math.abs(q.roll)>45))continue;
          q=alignCap(frame,q);
          const qe=evaluate(frame,q),qs=merit(q,qe,previous,dtMs);
          if(qs>bestScore){best=q;bestEvidence=qe;bestScore=qs;}
        }
        p=best;e=bestEvidence;score=bestScore;
      }
    }
    // Refit the actual mesh between ten-degree search seeds. Do not average
    // exposed/blocked states or interpolate a core outside its current contour.
    if(frame.table&&!frame.attitude?.used){
      const base=templateOf(p).elevation;
      // Use the same bounded preference as final candidate selection. Current
      // contour/material gates still reject an unsupported previous angle.
      const fineMerit=(q,qe)=>merit(q,qe,previous,dtMs)-(stable?
        .035*Math.min(2,Math.abs(q.t-stable.t)):0);
      score=fineMerit(p,e);
      for(const step of [3,1])for(let pass=0;pass<2;pass++){
        let best=p,bestEvidence=e,bestScore=score;
        for(const sign of [-1,1]){
          const angle=templateOf(p).elevation+step*sign;
          if(angle<0||angle>90||Math.abs(angle-base)>5)continue;
          const q=alignCap(frame,{...p,t:(angle+70)/10,template:fineTemplate(angle)});
          const qe=evaluate(frame,q),qs=fineMerit(q,qe);
          if(qs>bestScore){best=q;bestEvidence=qe;bestScore=qs;}
        }
        p=best;e=bestEvidence;score=bestScore;
      }
    }
    return {...p,e,merit:merit(p,e,previous,dtMs)};
  }
  const fineTemplates=new Map();
  function fineTemplate(angle){
    if(angle%10===0)return templates[(angle+70)/10];
    if(!fineTemplates.has(angle))fineTemplates.set(angle,buildTemplates([angle])[0]);
    return fineTemplates.get(angle);
  }
  function fromAnchor(component,kind,t,roll,scale) {
    const a=templates[t].anchors[kind],c=Math.cos(roll*DEG),s=Math.sin(roll*DEG);
    return {x:component.x-scale*(a.x*c+a.y*s),y:component.y-scale*(-a.x*s+a.y*c),scale,roll:wrap(roll),t};
  }
  function seeds(frame,selection) {
    const green=components(frame,GREEN,7).slice(0,12),buns=components(frame,BUN,14).slice(0,35),out=[];
    for(const g of green) {
      const diameter=Math.max(g.right-g.left+1,g.bottom-g.top+1);
      if(diameter<12||diameter>Math.min(frame.w,frame.h)*.65||g.count<diameter*1.1)continue;
      if(selection&&Math.hypot(g.x-selection.x*frame.w,g.y-selection.y*frame.h)>diameter*1.8)continue;
      const major=.5*Math.atan2(2*g.xy,g.xx-g.yy)/DEG;
      const nearby=buns.filter(b=>Math.hypot(b.x-g.x,b.y-g.y)<diameter*1.5&&b.count>g.count*.18&&b.count<g.count*8);
      const rolls=[-major,180-major,...nearby.slice(0,3).map(b=>Math.atan2(-(b.x-g.x),-(b.y-g.y))/DEG)];
      for(const roll of rolls)for(const t of [3,5,7,9,11,13,15]) {
        if(templates[t].anchors.green.n<2)continue;
        out.push(fromAnchor(g,'green',t,roll,diameter/geometry.fillingDiameter));
      }
      // A finger can split the green band into small components. Let a nearby
      // cap propose its own scale rather than shrinking the burger to one leaf.
      for(const b of nearby.slice(0,3)) {
        const bw=Math.max(b.right-b.left+1,b.bottom-b.top+1);
        if(bw<diameter*.9||bw>diameter*2.3)continue;
        const roll=Math.atan2(-(b.x-g.x),-(b.y-g.y))/DEG;
        for(const t of [5,7,9,11,13])out.push(fromAnchor(b,'bun',t,roll,bw/geometry.upperDiameter));
      }
    }
    // A top view can have no visible filling. Require several seed-like islands
    // inside a compact orange cap, rather than accepting every orange object.
    const whiteComponents=components(frame,WHITE,1);
    for(const b of buns.slice(0,15)) {
      const bw=b.right-b.left+1,bh=b.bottom-b.top+1,diameter=Math.max(bw,bh);
      if(diameter<20||diameter>Math.min(frame.w,frame.h)*.55||Math.min(bw,bh)/diameter<.65||b.count/(bw*bh)<.48)continue;
      const spots=whiteComponents.filter(q=>{
        if(q.count>bw*bh*.025||((q.x-b.x)/(bw*.4))**2+((q.y-b.y)/(bh*.4))**2>1)return false;
        const x=Math.round(q.x),y=Math.round(q.y),d=Math.max(2,Math.round(diameter*.05)),i=y*frame.w+x;
        return x>d&&y>d&&x<frame.w-d&&y<frame.h-d&&[i-d,i+d,i-d*frame.w,i+d*frame.w].filter(j=>frame.labels[j]===BUN).length>=3;
      });
      if(spots.length<3||spots.reduce((sum,q)=>sum+q.count,0)<5)continue;
      if(selection&&Math.hypot(b.x-selection.x*frame.w,b.y-selection.y*frame.h)>diameter*1.5)continue;
      for(const t of [12,14,16])for(const roll of [0,90,180,-90])out.push({...fromAnchor(b,'bun',t,roll,diameter/geometry.upperDiameter),topSeed:true,freshTop:true});
    }
    return out;
  }
  function translation(previous,frame,p) {
    // Sparse normalized patch correlation, not optical flow or new recognition.
    // Every translated pose must still pass independent current-frame model fit.
    const points=[],r=p.scale*geometry.fillingDiameter*.47;
    for(let y=-r;y<=r;y+=Math.max(2,r/4))for(let x=-r;x<=r;x+=Math.max(2,r/4)) {
      const xx=Math.round(p.x+x),yy=Math.round(p.y+y);if(xx<0||yy<0||xx>=frame.w||yy>=frame.h)continue;
      points.push({x:xx,y:yy,value:previous.gray[yy*frame.w+xx]});
    }
    const mean=points.reduce((sum,q)=>sum+q.value,0)/points.length;
    let variance=0;for(const q of points){q.value-=mean;variance+=q.value*q.value;}
    if(variance<points.length*36)return null;
    const correlation=(dx,dy)=>{
      let sum=0,sum2=0,dot=0;
      for(const q of points) {
        const x=q.x+dx,y=q.y+dy;if(x<0||y<0||x>=frame.w||y>=frame.h)return -1;
        const v=frame.gray[y*frame.w+x];sum+=v;sum2+=v*v;dot+=v*q.value;
      }
      return dot/Math.sqrt(variance*Math.max(1,sum2-sum*sum/points.length));
    };
    let best={dx:0,dy:0,score:-1};const radius=Math.min(28,Math.ceil(r*.65));
    for(let dy=-radius;dy<=radius;dy+=3)for(let dx=-radius;dx<=radius;dx+=3) {
      const score=correlation(dx,dy);if(score>best.score)best={dx,dy,score};
    }
    const coarse=best;
    for(let dy=coarse.dy-2;dy<=coarse.dy+2;dy++)for(let dx=coarse.dx-2;dx<=coarse.dx+2;dx++) {
      const score=correlation(dx,dy);if(score>best.score)best={dx,dy,score};
    }
    return best.score>.72?{...p,x:p.x+best.dx,y:p.y+best.dy,correlation:best.score}:null;
  }
  function empty(timestampMs,reason='no-supported-target') {
    return {timestampMs,evidenceTimestampMs:null,tracking:'lost',targetFound:false,coreCenter:null,coreBounds:null,pose:null,displayPose:null,
      displayStatus:'none',displayAgeMs:null,displayOpacity:0,displayMotion:null,
      bunContour:null,viewClass:'unknown',elevationRangeDegrees:null,
      attackRegion:null,modelAttackability:'unknown',modelFillingFractionRange:null,
      poseStatus:'unknown',attackability:'unknown',reason,experimental:true,projection:'orthographic-approximation'};
  }
  class Tracker {
    constructor({mode='handheld'}={}){templates??=buildTemplates();this.mode=mode;this.reset();}
    reset(){this.last=null;this.lock=null;this.previous=null;this.lastTime=-Infinity;this.selection=null;this.streak=0;this.stableSince=null;this.frameAttitude=null;}
    select(x,y){this.reset();this.selection={x,y};}
    missing(timestampMs,reason='short-gap-display-only',{frame}={}) {
      this.streak=0;this.stableSince=null;
      const out=empty(timestampMs,reason),age=this.lock?timestampMs-this.lock.time:Infinity;
      // A held estimate never refreshes its own evidence time or becomes a
      // measurement. Keep no fresh core/pose/attack permission on missing input.
      if(age>=0&&age<=HOLD_MS) {
        let display=this.lock.heldDisplay??this.lock.display,displayMotion='stationary';
        // At most 250 ms of image-supported translation from the last measured
        // anchor. Never chain predictions, extrapolate velocity, refresh the
        // evidence time, change scale/tilt, or enable attacks from this estimate.
        if(frame&&this.lock.frame&&age<=250){
          const move=translation(this.lock.frame,frame,this.lock.raw);
          const dx=move?move.x-this.lock.raw.x:0,dy=move?move.y-this.lock.raw.y:0;
          if(move?.correlation>.9&&Math.hypot(dx,dy)<=this.lock.raw.scale*geometry.fillingDiameter*.45){
            const anchor=this.lock.display;
            display={...anchor,center:{x:anchor.center.x+dx/frame.w,y:anchor.center.y+dy/frame.h}};
            this.lock.heldDisplay=display;
            displayMotion='image-translation';
          }
        }
        Object.assign(out,{tracking:'unknown',displayPose:display,evidenceTimestampMs:this.lock.time,
          displayStatus:'held',displayAgeMs:age,displayMotion,displayOpacity:.85*Math.min(1,(HOLD_MS-age)/350)});
      }else{this.last=null;this.lock=null;this.previous=null;}
      return out;
    }
    update(input,timestampMs,options={}) {
      this.frameAttitude=null;
      const out=this.fit(input,timestampMs,options);
      const hint=this.mode==='table'?options.tableAttitude:null;
      out.attitudeAssist={hint:hint??null,...(this.frameAttitude??globalThis.BurgerTableAttitude?.constraint(hint,
        null,input.width,input.height,timestampMs))};
      return out;
    }
    fit(input,timestampMs,{temporal=true,tableAttitude=null,capObservation:observedCap=undefined,contourRecovery=false}={}) {
      if(!Number.isFinite(timestampMs)||input.data.length!==input.width*input.height*4)throw new TypeError('RGBA frame and monotonic timestamp required');
      if(!temporal||timestampMs<=this.lastTime||timestampMs-this.lastTime>HOLD_MS||this.previous&&
        (this.previous.w!==input.width||this.previous.h!==input.height)) {
        const selection=this.selection;this.reset();this.selection=selection;
      }
      // A stale anchor must not trap a new target at its old position/size.
      if(this.last&&timestampMs-(this.lock??this.last).time>HOLD_MS){this.last=null;this.lock=null;this.previous=null;this.streak=0;this.stableSince=null;}
      this.lastTime=timestampMs;const frame=frameData(input);frame.table=this.mode==='table';
      // The game adapter may supply this frame's shared detector observation.
      // A tracked/predicted contour must NEVER be supplied as fresh geometry.
      frame.cap=frame.table?(observedCap===undefined?capObservation(input,frame,this.selection):
        observedCap?{points:observedCap.contour,width:observedCap.box.width,sesame:observedCap.sesame}:null):null;
      if(frame.table&&!frame.cap)return this.missing(timestampMs,'no-complete-cap',{frame});
      frame.layers=visibleLayers(frame);
      const contour=frame.cap?.points.map(p=>({x:p.x/frame.w,y:p.y/frame.h}))??null;
      const hypotheses=frame.table?[]:seeds(frame,this.selection);
      let reference=this.last?.raw;
      if(frame.table){
        const observed=bounds(frame.cap.points);
        frame.attitude=globalThis.BurgerTableAttitude?.constraint(tableAttitude,
          {x:(observed.left+observed.right)/2/frame.w,y:(observed.top+observed.bottom)/2/frame.h},frame.w,frame.h,timestampMs);
        this.frameAttitude=frame.attitude;
        const orientations=[];
        if(frame.attitude?.used){
          const elevation=frame.attitude.elevationDegrees;
          // Fit a freshly projected template at the measured angle, not a
          // visual 10-degree candidate with its drawn rotation overwritten.
          const template=buildTemplates([elevation])[0];
          orientations.push({t:Math.round((elevation+70)/10),template,roll:frame.attitude.rollDegrees});
          if(reference)reference={...reference,...orientations[0]};
        }else{
          if(reference?.template)reference={...reference,t:Math.round(reference.t),template:undefined};
          for(let t=7;t<templates.length;t++)for(const roll of [-30,-15,0,15,30])orientations.push({t,roll});
        }
        for(const orientation of orientations){
          const {roll}=orientation,c=Math.cos(roll*DEG),s=Math.sin(roll*DEG),box=bounds(templateOf(orientation).upperHull.map(p=>({x:p.x*c+p.y*s,y:-p.x*s+p.y*c})));
          const scale=(observed.right-observed.left)/(box.right-box.left);
          hypotheses.push({...orientation,scale,x:(observed.left+observed.right-scale*(box.left+box.right))/2,y:(observed.top+observed.bottom-scale*(box.top+box.bottom))/2});
        }
      }
      const dtMs=this.last?timestampMs-this.last.time:0;
      let motion=null;
      if(reference&&this.previous) {
        motion=translation(this.previous,frame,reference);hypotheses.push(motion??reference);
      }
      // Keep distinct position/orientation hypotheses; nearby pixels alone do
      // not establish which surface is in front of the hidden geometric centre.
      const prior=frame.table?null:reference;
      const ranked=hypotheses.map(p=>alignCap(frame,p)).map(p=>({...p,e:evaluate(frame,p)})).sort((a,b)=>merit(b,b.e,prior,dtMs)-merit(a,a.e,prior,dtMs));
      // Always refine the previous model too; a tiny isolated green patch must
      // not evict it from the short list before continuity can be considered.
      const starts=reference?[motion??reference]:[];
      for(const p of ranked) {
        if(starts.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<p.scale*3&&Math.abs(p.t-q.t)<3&&Math.abs(wrap(p.roll-q.roll))<20))continue;
        starts.push(p);if(starts.length>=5)break;
      }
      const fitted=starts.map(p=>refine(frame,p,prior,dtMs,this.lock?.raw)).sort((a,b)=>b.merit-a.merit);
      const isSupported=q=>{
        if(frame.table){
          const layered=q.e.greens>=2&&q.e.darks>=2;
          // Keep the existing contour gates after fine fitting; a closer angle
          // must not rescue an incomplete silhouette or free its translation.
          const top=frame.cap.sesame.strong&&templateOf(q).elevation>=50&&q.e.upper>.68&&q.e.contourError<.035;
          const contourOK=supportsContour(q.e,!!this.lock||contourRecovery);
          return q.e.score>.65&&q.e.contourError<.055&&contourOK&&q.e.capHeightError<.065&&q.e.upper>.45&&(layered||top);
        }
        const freshTop=hypotheses.some(p=>p.freshTop&&Math.hypot(p.x-q.x,p.y-q.y)<q.scale*8&&Math.abs(Math.log(p.scale/q.scale))<.3);
        // A small upside-down model on one green leaf can score highly. Require
        // both green and dark filling evidence, or fresh sesame-cap evidence.
        const layered=q.e.greens>=3&&q.e.darks>=Math.max(3,q.e.fillSamples*.06)&&q.e.filling>.38;
        return q.e.score>.59&&q.e.upper>.35&&q.e.buns>=3&&(layered||(freshTop&&templateOf(q).elevation>=60&&q.e.upper>.68));
      };
      const visuallySupported=fitted.filter(isSupported);
      // Tentative observations also have to agree with the preceding frame.
      // If they fail before a stable lock exists, restart acquisition without
      // holding them. Otherwise the third frame could still suddenly halve.
      const guard=this.lock??this.last;
      const supportedFits=visuallySupported.filter(p=>!guard||continuity(p,guard.raw,timestampMs-guard.time).allowed);
      // Fresh image fits are computed independently above. Only resolve close
      // alternatives against the last stable pose; never rescue a failed fit.
      // Costs are bounded, so clearly better current evidence can change view.
      const stableReference=frame.table&&!frame.attitude?.used?this.lock?.raw:null;
      const selectionMerit=p=>p.e.rankingScore-(stableReference?
        .035*Math.min(2,Math.abs(p.t-stableReference.t))+
        .01*Math.min(2,Math.abs(wrap(p.roll-stableReference.roll))/15):0);
      supportedFits.sort((a,b)=>selectionMerit(b)-selectionMerit(a));
      const supported=supportedFits.length>0,best=supportedFits[0]??visuallySupported[0]??fitted[0];
      if(!supported) {
        const reason=visuallySupported.length?'continuity-rejected':best?'weak-model-fit':'no-supported-target';
        const out=this.missing(timestampMs,reason,{frame});
        out.bunContour=contour;out.debug=best?{fit:best.e,continuity:continuity(best,reference,dtMs)}:null;return out;
      }
      // Near the symmetry axis, in-plane rotation is unobservable and irrelevant.
      const competing=supportedFits.find(p=>p!==best&&(Math.abs(p.t-best.t)>=2||(Math.min(Math.cos(templateOf(p).elevation*DEG),Math.cos(templateOf(best).elevation*DEG))>.25&&Math.abs(wrap(p.roll-best.roll))>20)||Math.abs(Math.log(p.scale/best.scale))>.2)&&Math.hypot(p.x-best.x,p.y-best.y)<best.scale*22);
      const ambiguous=!!competing&&selectionMerit(best)-selectionMerit(competing)<.045;
      const distant=supportedFits.find(p=>p!==best&&Math.hypot(p.x-best.x,p.y-best.y)>best.scale*22&&best.e.score-p.e.score<.04);
      if(distant){this.reset();return empty(timestampMs,'multiple-targets');}
      const continuous=reference&&continuity(best,reference,dtMs).allowed;
      // Tilt can be ambiguous while centre/scale still agree. Only spatial
      // disagreement disqualifies a candidate as a future hold anchor.
      const placementUncertain=supportedFits.some(p=>p!==best&&best.merit-p.merit<.035&&
        (Math.hypot(p.x-best.x,p.y-best.y)>best.scale*geometry.fillingDiameter*.2||Math.abs(Math.log(p.scale/best.scale))>.18));
      if(this.lock&&placementUncertain)return {...this.missing(timestampMs,'uncertain-placement',{frame}),bunContour:contour};
      const steady=best.e.score>=.63&&!placementUncertain;
      this.streak=steady?(continuous?this.streak+1:1):0;
      if(!steady)this.stableSince=null;else if(!continuous||this.stableSince===null)this.stableSince=timestampMs;
      const raw={x:best.x,y:best.y,scale:best.scale,roll:best.roll,t:best.t,template:best.template,topSeed:best.topSeed};
      const toPose=p=>({center:{x:p.x/frame.w,y:p.y/frame.h},scalePerSourceWidth:p.scale/frame.w,
        elevationDegrees:templateOf(p).elevation,rollDegrees:p.roll});
      const pose=toPose(raw),display={...pose,center:{...pose.center}};
      // Smooth only the display position/scale, never permission or evidence.
      if(continuous&&temporal) {
        const old=this.last.display,a=1-Math.exp(-dtMs/78);
        display.center={x:old.center.x+(pose.center.x-old.center.x)*a,y:old.center.y+(pose.center.y-old.center.y)*a};
        display.scalePerSourceWidth=old.scalePerSourceWidth+(pose.scalePerSourceWidth-old.scalePerSourceWidth)*a;
        // Do not blend a freshly constrained orientation with an old visual
        // guess: then even a fixed sensor would appear to drift off the table.
        if(!frame.attitude?.used){
          display.rollDegrees=old.rollDegrees+wrap(pose.rollDegrees-old.rollDegrees)*a;
          display.elevationDegrees=old.elevationDegrees+(pose.elevationDegrees-old.elevationDegrees)*(1-Math.exp(-dtMs/167));
        }
      }
      this.last={raw,display,time:timestampMs,frame};this.previous=frame;this.selection=null;
      if(temporal&&steady&&(this.lock||this.streak>=3&&timestampMs-this.stableSince>=120))this.lock=this.last;
      // A display neighbourhood only, NOT a calibrated confidence interval or
      // a hittable filling mask. poseStatus carries unresolved fit ambiguity.
      const radius=best.scale*(ambiguous?3:1.5);
      // A cap-only observation must not manufacture certainty by discarding
      // shallower contour fits solely because their filling was not detected.
      const capOnly=frame.table&&!(best.e.greens>=2&&best.e.darks>=2);
      const plausibleFits=(capOnly?fitted:supportedFits).filter(p=>capOnly?
        best.e.score-p.e.score<.045:selectionMerit(best)-selectionMerit(p)<.045);
      const possibleAngles=frame.table?plausibleFits.map(p=>templateOf(p).elevation):[];
      const angleRange=possibleAngles.length?[Math.min(...possibleAngles),Math.max(...possibleAngles)]:null;
      const regionAPI=globalThis.BurgerAttackRegion;
      const regionEvidence=regionAPI?.evaluate(plausibleFits.map(p=>templateOf(p).elevation));
      return {...empty(timestampMs),evidenceTimestampMs:timestampMs,tracking:'found',targetFound:true,
        coreCenter:pose.center,coreBounds:{x:(best.x-radius)/frame.w,y:(best.y-radius)/frame.h,width:2*radius/frame.w,height:2*radius/frame.h},
        pose,displayPose:display,poseStatus:ambiguous?'ambiguous':'approximate',reason:ambiguous?'competing-poses':'current-model-fit',
        displayStatus:'measured',displayAgeMs:0,displayOpacity:1,
        // Only current measurements get a region. A frozen display marker is
        // not a fresh target and missing() clears this preview immediately.
        attackRegion:regionAPI?{center:{...pose.center},radiusMm:regionAPI.RULE.radiusMm,
          radiusX:best.scale*regionAPI.RULE.radiusMm/frame.w,radiusY:best.scale*regionAPI.RULE.radiusMm/frame.h}:null,
        modelAttackability:placementUncertain||capOnly&&regionEvidence?.status==='exposed'?'unknown':regionEvidence?.status??'unknown',
        modelFillingFractionRange:regionEvidence?.fillingFractionRange??null,
        bunContour:contour,elevationRangeDegrees:angleRange,
        viewClass:angleRange?(angleRange[0]>=30?'oblique-top':angleRange[1]<=10?'side':'unknown'):null,
        // Geometric self-occlusion only. Fingers are absent from the mesh.
        modelCenterSurface:ambiguous&&templateOf(competing).centerMaterial!==templateOf(best).centerMaterial?'unknown':templateOf(best).centerMaterial,
        debug:{fit:best.e,competingScore:competing?.e.score??null,hypotheses:hypotheses.length,motionCorrelation:motion?.correlation??null,
          candidates:visuallySupported.map(p=>({elevationDegrees:templateOf(p).elevation,rollDegrees:p.roll,score:p.e.score,
            selectionScore:selectionMerit(p),continuous:supportedFits.includes(p),
            center:{x:p.x/frame.w,y:p.y/frame.h},scalePerSourceWidth:p.scale/frame.w})),
          capOnly,sesame:frame.cap?.sesame??null,
          streak:this.streak,holdReady:!!this.lock,placementUncertain,continuity:continuity(best,reference,dtMs)}};
    }
  }
  // Independent image observation for the visual tracking experiment. This
  // cap centre is NOT the hidden filling centre and conveys no attack state.
  function detectCap(input){
    const frame=frameData(input),cap=capObservation(input,frame,null);
    if(!cap)return null;
    const box=bounds(cap.points);
    return {box:{x:box.left,y:box.top,width:box.right-box.left,height:box.bottom-box.top},
      contour:cap.points,sesame:cap.sesame,hasFilling:!!cap.green,method:cap.method??'colour-cap',boundary:cap.edge??null};
  }
  // Confirmation only: requires a previously tracked cap box. It neither
  // initializes a target nor infers the hidden core/attackable state.
  function confirmCap(input,box){
    const {data,width,height}=input;
    const read=(x,y)=>{
      x=Math.round(x);y=Math.round(y);
      if(x<0||y<0||x>=width||y>=height)return NONE;
      const k=(y*width+x)*4;return classify(data[k],data[k+1],data[k+2]);
    };
    let warm=0,capN=0,green=0,dark=0;const greenColumns=new Set(),darkColumns=new Set();
    for(let y=0;y<10;y++)for(let x=0;x<20;x++){
      const u=(x+.5)/20,v=(y+.5)/10;
      if(((u-.5)/.46)**2+((v-.5)/.46)**2>1)continue;
      const label=read(box.x+u*box.width,box.y+v*box.height);
      capN++;if(label===BUN||label===YELLOW)warm++;
    }
    // Several columns must contain filling, not a small green patch beside a
    // glass. A cap-only overhead view cannot use this side-view fallback.
    for(let y=0;y<12;y++)for(let x=0;x<20;x++){
      const label=read(box.x+(.1+.8*(x+.5)/20)*box.width,
        box.y+box.height+(y+.5)/12*box.width*.6),column=Math.floor(x/5);
      if(label===GREEN){green++;greenColumns.add(column);}
      if(label===DARK){dark++;darkColumns.add(column);}
    }
    return {supported:warm/capN>=.3&&green>=5&&dark>=15&&greenColumns.size>=2&&darkColumns.size>=3,
      warmFraction:warm/capN,greenFraction:green/240,darkFraction:dark/240};
  }
  globalThis.BurgerPose={Tracker,empty,geometry,classify,HOLD_MS,detectCap,confirmCap,supportsContour,
    observeLayers:(input,contour)=>visibleLayers({...frameData(input),cap:contour?{points:contour}:null})};
})();

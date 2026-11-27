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
  const modelAPI=globalThis.BurgerModel,geometry=modelAPI.presets.game;
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
    return {centers:spots.map(p=>({x:p.x,y:p.y})),count:spots.length,offsetX:spots.length?Math.abs(spots.reduce((s,p)=>s+p.x,0)/spots.length-cx)/w:0,
      spanX:spread?(spread.right-spread.left)/w:0,
      strong:spots.length>=3&&spots.reduce((s,p)=>s+p.count,0)>=5&&
      spread.right-spread.left>w*.22&&spread.bottom-spread.top>h*.18};
  }
  function nearTrackedCap(q,box){
    const w=q.right-q.left+1,h=q.bottom-q.top+1;
    return w>=box.width*.75&&w<=box.width*1.3&&
      Math.hypot((q.left+q.right)/2-box.x-box.width/2,(q.top+q.bottom)/2-box.y-box.height/2)<box.width*.25&&
      h>=box.height*.55&&h<=box.height*1.6;
  }
  // A colour proposal can stop inside a red/yellow gradient. Search only near
  // its existing boundary for a sustained warm-to-background image edge.
  // No model angle, predicted silhouette or previous-frame pixels are used.
  // Choose a connected image edge around the crown. A short run of tray rim
  // can share the bun colour, but it cannot support a full crown boundary.
  function chordOutline(input,box){
    const {width,height,data}=input,w0=box.width,h0=box.height;
    if(w0<24||h0<w0*.62)return null;
    const x0=Math.max(0,Math.floor(box.x-w0*.20)),y0=Math.max(0,Math.floor(box.y-h0*.20));
    const w=Math.min(width,Math.ceil(box.x+w0*1.20))-x0,h=Math.min(height,Math.ceil(box.y+h0*1.20))-y0;
    const mask=new Uint8Array(w*h),queue=new Int32Array(w*h);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const k=((y0+y)*width+x0+x)*4,r=data[k],g=data[k+1],b=data[k+2];
      if(r>85&&r>g*1.48&&g>b*1.3&&g>32)mask[y*w+x]=1;
    }
    // Only exterior pixels connect to the crop border. Sesame holes stay inside.
    let head=0,tail=1;queue[0]=0;mask[0]=2;
    while(head<tail){
      const i=queue[head++],x=i%w;
      for(const j of [x?i-1:-1,x<w-1?i+1:-1,i-w,i+w]){
        if(j>=0&&j<mask.length&&mask[j]===0){mask[j]=2;queue[tail++]=j;}
      }
    }
    let cx=box.x+w0/2-x0,cy=box.y+h0/2-y0,rx=w0/2,ry=h0/2;
    if(mask[Math.round(cy)*w+Math.round(cx)]===2)return null;
    const median=xs=>xs.sort((a,b)=>a-b)[xs.length>>1];
    const edges=(vertical,extent)=>{
      const a=vertical?cy:cx,b=vertical?cx:cy,ra=vertical?ry:rx,rb=vertical?rx:ry;
      const n=vertical?h:w,m=vertical?w:h,inside=(j,i)=>mask[vertical?j*w+i:i*w+j]!==2;
      const left=[],right=[],pts=[];
      for(let i=Math.max(1,Math.ceil(b-rb*extent));i<=Math.min(m-2,Math.floor(b+rb*extent));i++){
        let l=Math.round(a),r=l;if(l<1||l>=n-1||!inside(l,i))continue;
        while(l>0&&inside(l-1,i))l--;
        while(r<n-1&&inside(r+1,i))r++;
        const shift=ra*(1-Math.sqrt(Math.max(0,1-((i-b)/rb)**2)));
        left.push(l-shift);right.push(r+shift);
        pts.push(vertical?{x:i,y:l}:{x:l,y:i},vertical?{x:i,y:r}:{x:r,y:i});
      }
      return left.length>=5?{l:median(left),r:median(right),pts}:null;
    };
    for(let pass=0;pass<3;pass++){
      const a=edges(false,.72),b=edges(true,.72);if(!a||!b)return null;
      cx=(a.l+a.r)/2;cy=(b.l+b.r)/2;rx=(a.r-a.l)/2;ry=(b.r-b.l)/2;
    }
    if(rx<=0||ry<=0||2*rx<w0*.64||2*ry<h0*.64)return null;
    // The fitted ellipse only identifies consistent pixels. The emitted outline
    // is the hull of measured row/column endpoints, never an ellipse template.
    const a=edges(false,.98),b=edges(true,.98);if(!a||!b)return null;
    const sectors=new Uint8Array(24),picked=[];
    for(const q of [...a.pts,...b.pts]){
      const x=(q.x-cx)/rx,y=(q.y-cy)/ry;
      if(Math.abs(Math.hypot(x,y)-1)>.065)continue;
      sectors[Math.floor((Math.atan2(y,x)+2*Math.PI)%(2*Math.PI)*24/(2*Math.PI))]=1;
      picked.push({x:q.x+x0,y:q.y+y0});
    }
    if(sectors.reduce((s,v)=>s+v,0)<19)return null;
    const contour=hull(picked),bb=bounds(contour);
    return {contour,box:{x:bb.left,y:bb.top,width:bb.right-bb.left,height:bb.bottom-bb.top}};
  }

  // A short protrusion can follow the tray or the drink. Fit a smooth radial
  // profile to the other rays, then look again for an actual edge in the image.
  const crownAngles=Array.from({length:48},(_,i)=>{
    const a=i*Math.PI/24;
    return [1,Math.cos(a),Math.sin(a),Math.cos(2*a),Math.sin(2*a)];
  });
  function remeasureSide(indices,strength,bins,first,step){
    const original=indices.map(i=>first+i*step);
    let adjusted=original.slice(),profile;
    for(let pass=0;pass<8;pass++){
      const coefficients=[0,0,0,0,0];
      for(let i=0;i<48;i++)for(let k=0;k<5;k++)coefficients[k]+=adjusted[i]*crownAngles[i][k];
      profile=crownAngles.map(row=>row.reduce((sum,a,k)=>sum+a*coefficients[k]*(k?2:1)/48,0));
      adjusted=original.map((r,i)=>profile[i]+clamp(r-profile[i],-.03,.03));
    }
    const residual=original.map((r,i)=>r-profile[i]);
    for(let i=0;i<48;i++){
      if(Math.abs(crownAngles[i][1])<.55||residual[i]<.025)continue;
      let peak=0;
      for(let j=-2;j<=2;j++)peak=Math.max(peak,residual[(i+j+48)%48]);
      if(peak<.08)continue;
      let winner=indices[i],best=-Infinity;
      for(let b=0;b<indices[i];b++){
        const diff=Math.abs(first+b*step-profile[i]),edge=strength[i*bins+b];
        if(diff>.06||edge<.32)continue;
        const score=edge-3*diff;
        if(score>best){winner=b;best=score;}
      }
      indices[i]=winner;
    }
  }


  function traceCrown(input,observation,tracked=false){
    if(!observation?.contour?.length)return null;
    const {width,height,data}=input,box=observation.box,w=box.width,h=box.height;
    if(w<20||h<8)return null;
    // The median of orange pixels near mid-height resists a narrow lateral
    // attachment. The colour test only locates the interior of the search.
    const columns=[];
    for(let y=Math.ceil(box.y+h*.25);y<box.y+h*.68;y+=3){
      for(let x=Math.ceil(box.x);x<box.x+w;x+=3){
        const k=(y*width+x)*4,r=data[k],g=data[k+1],b=data[k+2];
        if(r>85&&r>g*1.48&&g>b*1.3&&g>32)columns.push(x);
      }
    }
    columns.sort((a,b)=>a-b);
    const cx=!tracked&&columns.length?columns[columns.length>>1]:box.x+w/2,cy=box.y+h/2;
    const rays=48,bins=50,first=.49,step=.025;
    const scores=new Float32Array(rays*bins),strength=new Float32Array(rays*bins);
    // A sesame highlight can make a stronger edge than the crown against wood.
    // Use the same red-orange evidence as the proposal to account for material
    // on both sides of the edge, including lower-light pixels at the rim.
    const crown=k=>{
      const r=data[k],g=data[k+1],b=data[k+2];
      return clamp((r/Math.max(1,g)-1.34)/.38,0,1)*
        clamp((r-b)/Math.max(16,r)*3.8,0,1)*clamp((r-40)/45,0,1);
    };
    const dir=[],d=Math.max(1.15,w*.012);
    const pixel=(x,y)=>(Math.round(y)*width+Math.round(x))*4;
    for(let j=0;j<rays;j++){
      const a=j*2*Math.PI/rays,c=Math.cos(a),s=Math.sin(a),dx=c*w/2,dy=s*h/2;
      const norm=Math.hypot(c/w,s/h),nx=c/w/norm,ny=s/h/norm;
      let expected=1;
      if(Array.isArray(tracked)){
        for(let m=0;m<tracked.length;m++){
          const p=tracked[m],q=tracked[(m+1)%tracked.length],vx=q.x-p.x,vy=q.y-p.y;
          const den=dx*vy-dy*vx;if(Math.abs(den)<1e-7)continue;
          const x=p.x-cx,y=p.y-cy,r=(x*vy-y*vx)/den,u=(x*dy-y*dx)/den;
          if(r>0&&u>=0&&u<=1){expected=r;break;}
        }
      }
      dir.push({dx,dy});let region=0;
      for(let i=0;i<bins;i++){
        const r=first+i*step,x=cx+r*dx,y=cy+r*dy,k=j*bins+i;
        if(x<4*d||y<4*d||x>=width-4*d||y>=height-4*d){scores[k]=-2;continue;}
        const u=pixel(x-nx*d,y-ny*d),v=pixel(x+nx*d,y+ny*d);
        const u2=pixel(x-nx*d*2.7,y-ny*d*2.7),v2=pixel(x+nx*d*2.7,y+ny*d*2.7);
        const delta=(l,m)=>Math.hypot(data[l]-data[m],data[l+1]-data[m+1],data[l+2]-data[m+2]);
        const warm=(k)=>data[k]>68&&data[k]>1.12*data[k+1]&&data[k]>data[k+2]*1.12;
        const edge=Math.min(1,delta(u,v)/105)*.65+Math.min(1,delta(u2,v2)/135)*.35;
        const interior=(Number(warm(u))+Number(warm(u2)))*.5;
        const inside=(crown(u)+crown(u2))*.5,outside=(crown(v)+crown(v2))*.5;
        region+=step*(crown(pixel(x,y))-.5)*3.6;
        strength[k]=Math.max(edge*interior,inside-outside);
        // A verified feature track supplies a short-lived search neighbourhood.
        // The edge itself and its support on each side always come from this frame.
        const shapeCost=tracked?3.6*Math.max(0,Math.abs(r-expected)-.045):0;
        scores[k]=-shapeCost+edge*interior*.75+.43*(inside-outside)+region-.22*Math.abs(r-1)-.22*(1-interior);
      }
    }
    // A cyclic chain discourages isolated distant edges. Every point stays on
    // a measured ray. Two passes carry support across the angular wrap.
    let prior=new Float32Array(bins),next=new Float32Array(bins);
    const back=new Uint8Array(2*rays*bins);
    for(let j=0;j<2*rays;j++){
      for(let i=0;i<bins;i++){
        let best=-Infinity,index=i;
        for(let b=Math.max(0,i-5);b<=Math.min(bins-1,i+5);b++){
          const delta=Math.abs(i-b),val=prior[b]-.065*delta-.012*delta*delta;
          if(val>best){best=val;index=b;}
        }
        next[i]=scores[j%rays*bins+i]+best;
        back[j*bins+i]=index;
      }
      [prior,next]=[next,prior];
    }
    let idx=prior.indexOf(Math.max(...prior)),indices=[];
    for(let j=2*rays-1;j>=rays;j--){indices[j-rays]=idx;idx=back[j*bins+idx];}
    const arcs=[0,0,0,0],points=[];
    for(let j=0;j<rays;j++){
      const i=indices[j],r=first+i*step;
      if(strength[j*bins+i]>.28)arcs[Math.floor((j+6)%rays/12)]++;
      points.push({x:cx+r*dir[j].dx,y:cy+r*dir[j].dy});
    }
    const support=arcs.reduce((a,b)=>a+b);
    if(support<rays*.66||Math.min(...arcs)<4)return null;
    const contour=hull(points),b=bounds(contour);
    let sideEdges=null;
    if(!tracked&&h>w*.56){
      const other=indices.slice();
      remeasureSide(other,strength,bins,first,step);
      if(other.some((k,i)=>k!==indices[i])){
        const candidate=hull(other.map((k,i)=>({x:cx+(first+k*step)*dir[i].dx,y:cy+(first+k*step)*dir[i].dy})));
        const bb=bounds(candidate);
        const left=bb.left-b.left,right=b.right-bb.right;
        if(Math.max(left,right)>Math.max(2,w*.025)){
          // Independent scanline endpoints must also place this side inside
          // the original hull. An irregular but corroborated outer edge stays.
          const chord=chordOutline(input,{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top});
          if(chord){
            const extremes=bounds(chord.contour);
            const old=left>right?b.left:b.right,next=left>right?bb.left:bb.right;
            const observed=left>right?extremes.left:extremes.right;
            if(Math.abs(observed-next)<Math.abs(observed-old))
              sideEdges={source:contour,contour:candidate,width:bb.right-bb.left};
          }
        }
      }
    }
    return {...observation,contour,sideEdges,box:{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top},
      refinement:{supportedFraction:support/rays,method:'closed-edge'}};
  }


  function verifyChords(input,observation,tracked){
      const box=observation.box;
      const residual=q=>Math.abs(Math.log(q.width/tracked.width))+
        Math.hypot(q.x+q.width/2-tracked.x-tracked.width/2,q.y+q.height/2-tracked.y-tracked.height/2)/tracked.width;
      const before=residual(box);
      if(before<.065)return observation;
      if(!observation.sesame?.strong)return observation;
      const measured=chordOutline(input,box);if(!measured)return observation;
      const q=measured.box;
      const disagreement=Math.max(Math.abs(q.x-box.x),Math.abs(q.y-box.y),
        Math.abs(q.x+q.width-box.x-box.width),Math.abs(q.y+q.height-box.y-box.height));
      if(disagreement<box.width*.027||q.width>box.width*1.025||residual(q)+.025>=before)return observation;
      const frame=frameData(input),boundary=bounds(measured.contour);
      const sesame=sesameEvidence(frame,boundary,components(frame,WHITE,1));
      if(!sesame.strong||sesame.offsetX>.12||sesame.spanX<.28)return observation;
      return {...observation,...measured,sesame,method:'measured-chord-contour'};
    }
  function localBoundary(input,frame,candidate){
    const poly=candidate.contour,w=candidate.box.width,d=Math.max(2,w*.025),limit=Math.max(1,Math.round(w*.035));
    const points=[];let changed=0;
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
      const nx=-dy/length,ny=dx/length,steps=Math.max(1,Math.ceil(length/Math.max(3,w*.04)));
      for(let j=0;j<steps;j++){
        const x=a.x+dx*j/steps,y=a.y+dy*j/steps;
        const evidence=k=>{
          const sample=v=>{
            const xx=Math.round(x+nx*v),yy=Math.round(y+ny*v);
            return xx>=0&&yy>=0&&xx<frame.w&&yy<frame.h?yy*frame.w+xx:-1;
          };
          const u=sample(k+d),v=sample(k-d);
          if(u<0||v<0||![BUN,WHITE,YELLOW].includes(frame.labels[u]))return 0;
          const difference=(m,n)=>Math.hypot(input.data[4*m]-input.data[4*n],
            input.data[4*m+1]-input.data[4*n+1],input.data[4*m+2]-input.data[4*n+2]);
          const near=sample(k-1),far=sample(k+1);
          if(near<0||far<0)return 0;
          const contrast=difference(u,v);
          return contrast>=40&&difference(near,far)>=contrast*.22?contrast:0;
        };
        let offset=0;
        if(!evidence(0)){
          let best=0;
          for(let k=-limit;k<=limit;k++){
            const s=evidence(k)-Math.abs(k)*3;
            if(s>best){best=s;offset=k;}
          }
        }
        if(offset)changed++;
        points.push({x:x+offset*nx,y:y+offset*ny});
      }
    }
    if(changed<3)return null;
    const contour=hull(points),b=bounds(contour);
    if(!sideBoundaryEvidence(input,frame,contour,b).supported)return null;
    return {...candidate,contour,sideEdges:null,box:{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top}};
  }

  function measureNormalEdges(input,frame,candidate){
    const poly=candidate.contour,w=candidate.box.width,reach=Math.min(9,Math.round(w*.085));
    if(reach<3)return null;
    const stations=[],N=reach*2+1,rgba=input.data,d=Math.max(2,w*.025);
    const read=(x,y)=>{
      const xx=Math.floor(x),yy=Math.floor(y),j=(yy*frame.w+xx)*4,u=x-xx,v=y-yy;
      return [0,1,2].map(k=>(rgba[j+k]*(1-u)+rgba[j+4+k]*u)*(1-v)+
        (rgba[j+4*frame.w+k]*(1-u)+rgba[j+4*frame.w+4+k]*u)*v);
    };
    for(let j=0;j<poly.length;j++){
      const a=poly[j],b=poly[(j+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy);
      if(!L)continue;
      const nx=-dy/L,ny=dx/L,count=Math.max(1,Math.ceil(L/3.5));
      for(let i=0;i<count;i++){
        const t=(i+.5)/count,x=a.x+t*dx,y=a.y+t*dy;
        if(x<reach+2*d+1||x>=frame.w-reach-2*d-1||y<reach+2*d+1||y>=frame.h-reach-2*d-1)return null;
        const score=[];
        for(let k=-reach;k<=reach;k++){
          const at=j=>read(x+nx*(k+j),y+ny*(k+j)),inner=at(d),outer=at(-d),far=at(-2*d);
          const label=classify(...inner),diff=inner.map((u,i)=>u-outer[i]),strength=Math.hypot(...diff);
          const contrast=diff.reduce((sum,u,i)=>sum+u*(inner[i]-far[i]),0)/Math.max(1,strength);
          const hit=label===BUN||label===YELLOW||label===WHITE;
          score.push((hit?Math.min(1.5,strength/65,Math.max(0,contrast)/65):0)-.018*Math.abs(k));
        }
        stations.push({x,y,nx,ny,score});
      }
    }
    const path=[],M=stations.length;
    let last=new Float32Array(N);
    for(let j=0;j<2*M;j++){
      const next=new Float32Array(N),back=new Uint8Array(N);
      for(let i=0;i<N;i++){
        let best=-Infinity;
        for(let k=Math.max(0,i-3);k<=Math.min(N-1,i+3);k++){
          const value=last[k]-.10*Math.abs(k-i);
          if(value>best){best=value;back[i]=k;}
        }
        next[i]=best+stations[j%M].score[i];
      }
      path.push(back);last=next;
    }
    let k=last.indexOf(Math.max(...last));const points=[];
    for(let i=M-1;i>=0;i--){
      const q=stations[i],s=k-reach;
      points.push({x:q.x+q.nx*s,y:q.y+q.ny*s});k=path[M+i][k];
    }
    const contour=hull(points),b=bounds(contour);
    if(!sideBoundaryEvidence(input,frame,contour,b).supported)return null;
    return {...candidate,contour,sideEdges:null,box:{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top}};
  }
  function findCurrentOutline(input,observed,transported,measureEdge=localBoundary){
    const b=bounds(transported),w=b.right-b.left;
    const box={x:b.left,y:b.top,width:w,height:b.bottom-b.top};
    const error=q=>Math.max(Math.abs(q.x-b.left),Math.abs(q.y-b.top),
      Math.abs(q.x+q.width-b.right),Math.abs(q.y+q.height-b.bottom));
    const initial=observed?error(observed.box):Infinity;
    if(initial<w*.045)return null;
    // The last contour supplies search locations. No previous pixels or
    // predicted point can pass the current image's four boundary-arc checks.
    let candidate=traceCrown(input,{...observed,box,contour:transported},transported);
    if(!candidate||candidate.refinement.supportedFraction<.83||error(candidate.box)+w*.018>=initial)return null;
    const frame=frameData(input);let bb=bounds(candidate.contour);
    if((!observed||shallowAttachment(observed,transported))&&!sideBoundaryEvidence(input,frame,candidate.contour,bb).supported){
      const corrected=measureEdge(input,frame,candidate);
      if(corrected&&error(corrected.box)+w*.018<initial){candidate=corrected;bb=bounds(candidate.contour);}
    }
    const sesame=sesameEvidence(frame,bb,components(frame,WHITE,1));
    if(!sesame.strong||sesame.offsetX>.12||sesame.spanX<.28)return null;
    if(!observed&&(!sideBoundaryEvidence(input,frame,candidate.contour,bb).supported||
      !confirmCap(input,candidate.box).supported))return null;
    return {...candidate,sesame,method:'current-edges-on-track'};
  }
  function refineCap(input,observation){
    if(observation?.refinement?.method==='closed-edge')return observation;
    const traced=traceCrown(input,observation);if(traced)return traced;
    if(!observation?.contour||observation.contour.length<6)return observation;
    const {data,width,height}=input,outline=observation.contour,w=observation.box.width;
    const read=(x,y)=>{
      x=Math.round(x);y=Math.round(y);
      if(x<0||y<0||x>=width||y>=height)return null;
      const k=(y*width+x)*4;return [data[k],data[k+1],data[k+2]];
    };
    // The crown's shaded red rim can fall outside the saturated orange class.
    // This broader chroma test is local edge support, never a new detector seed.
    const warm=p=>p&&([BUN,YELLOW].includes(classify(...p))||
      p[0]>75&&p[0]>p[1]*1.18&&p[0]>p[2]*1.15&&p[0]-Math.min(p[1],p[2])>30);
    const points=[];let supported=0,travel=0;
    for(let i=0;i<outline.length;i++){
      const a=outline[i],b=outline[(i+1)%outline.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
      if(!length)continue;
      const nx=dy/length,ny=-dx/length,steps=Math.max(1,Math.ceil(length/Math.max(2,w/24)));
      // Do not walk down through the cheese to its unrelated lower edge.
      const reach=Math.max(2,Math.round(w*(ny>.35?.04:.14))),d=Math.max(1,w*.015);
      for(let j=0;j<steps;j++){
        const x=a.x+dx*(j+.5)/steps,y=a.y+dy*(j+.5)/steps;
        let best=null;
        // A merged colour proposal can be too wide as well as too small.
        // Measure both sides of its boundary instead of only expanding it.
        for(let offset=-Math.max(2,Math.round(w*.16));offset<=reach;offset++){
          const px=x+nx*offset,py=y+ny*offset;
          const inside=[1,2,3].map(n=>read(px-nx*d*n,py-ny*d*n));
          const outside=[1,2,3].map(n=>read(px+nx*d*n,py+ny*d*n));
          if(inside.filter(warm).length<2||outside.some(p=>!p||warm(p)))continue;
          const contrast=Math.hypot(...inside[0].map((v,k)=>v-outside[0][k]));
          if(contrast<40)continue;
          const score=contrast-2*Math.abs(offset);
          if(!best||score>best.score)best={x:px,y:py,score,offset};
        }
        if(best){points.push({x:best.x,y:best.y});supported++;travel+=Math.abs(best.offset);}
        else points.push({x,y});
      }
    }
    if(supported<points.length*.6)return observation;
    const contour=hull(points),box=bounds(contour),rw=box.right-box.left,rh=box.bottom-box.top;
    if(rw<w*.75||rw>w*1.2||rh<observation.box.height*.7||rh>observation.box.height*1.4)return observation;
    return {...observation,contour,box:{x:box.left,y:box.top,width:rw,height:rh},
      refinement:{supportedFraction:supported/points.length,meanTravelPx:travel/supported}};
  }
  // Component membership depends only on the current pixels. The independent
  // detection still re-evaluates sesame, filling, competing objects and fit.
  const currentRegions=Symbol('current colour components');
  function capRegions(input,frame,redRatio=null){
    const cache=input[currentRegions];
    if(cache?.has(redRatio))return cache.get(redRatio);
    const labels=new Uint8Array(frame.labels.length),data=input.data;
    if(redRatio===null){
      for(let i=0;i<labels.length;i++){
        const q=frame.labels[i];labels[i]=q===BUN||q===YELLOW?BUN:NONE;
      }
    }else{
      for(let i=0;i<labels.length;i++){
        const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
        if(r>85&&r>g*redRatio&&g>b*1.3&&g>32)labels[i]=BUN;
      }
    }
    const regions=components({...frame,labels},BUN,35,true).slice(0,30);
    cache?.set(redRatio,regions);return regions;
  }
  function capObservation(input,frame,selection,recoveryBox=null,eligibleWhites=null) {
    // Red-orange crown proposal, separate from broad BUN material scoring.
    // This empirical colour test can fail on reddish wood, shadows or glare.
    // Convex completion bridges sesame holes; it is an observed candidate,
    // not a model silhouette or a guaranteed complete segmentation.
    const greens=components(frame,GREEN,5),whites=eligibleWhites??components(frame,WHITE,1);
    const side=sideCapObservation(input,frame,selection,greens,whites,recoveryBox);
    if(side)return side;
    // Start broad to retain the orange rim. Tighten only when it merges with
    // the wooden background; a single strict threshold clips the crown and
    // can itself turn an oblique view into a falsely shallow one.
    const proposals=[];
    for(const redRatio of [1.48,1.65,1.8,1.95]){
    const candidates=[];
    for(const q of capRegions(input,frame,redRatio)){
      const w=q.right-q.left+1,h=q.bottom-q.top+1;
      if(w<20||w>frame.w*.4||h/w<.22||h/w>1.25||q.count/(w*h)<.42)continue;
      // A complete cap cannot run out of the frame. Large wood patches used
      // to borrow a small nearby lettuce component as supporting evidence.
      if(q.left<=1||q.top<=1||q.right>=frame.w-2||q.bottom>=frame.h-2)continue;
      if(recoveryBox&&!nearTrackedCap(q,recoveryBox))continue;
      if(selection&&Math.hypot(q.x-selection.x*frame.w,q.y-selection.y*frame.h)>w*1.5)continue;
      const green=greens.find(g=>{
        const gw=g.right-g.left+1;
        return gw>=w*.4&&gw<=w*1.6&&Math.abs(g.x-q.x)<w*.5&&g.y>q.y&&g.y-q.y<w*1.2&&g.count>5;
      });
      const sesame=sesameEvidence(frame,q,whites);
      const localFilling=recoveryBox&&confirmCap(input,{x:q.left,y:q.top,width:w,height:h}).supported;
      // A connected orange background/drink can borrow the burger's sesame.
      // Reject a lopsided cluster, then retry the stricter colour proposals;
      // never crop an invented bun out of an oversized connected component.
      if(!recoveryBox&&sesame.count>=3&&(sesame.offsetX>.12||sesame.spanX<.28))continue;
      // Overhead views hide the filling. They may propose a cap independently;
      // acceptance still requires a rounded complete contour and a top-view fit.
      if(recoveryBox?!localFilling:!green&&!(h/w>=.65&&sesame.strong))continue;
      // Only pixels of this connected component belong to its silhouette.
      // Other orange islands inside its bounding rectangle may be tray/cheese.
      const points=q.rows.flatMap(r=>[{x:r.left,y:r.y},{x:r.right,y:r.y}]);let white=0;
      for(let y=q.top;y<=q.bottom;y++)for(let x=q.left;x<=q.right;x++){
        const k=y*frame.w+x;
        if(frame.labels[k]===WHITE)white++;
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
      if(!recoveryBox&&bridges.length&&!(green&&h/w<.6&&
        confirmCap(input,{x:q.left,y:q.top,width:w,height:h}).supported&&
        bridges.every(p=>supportedTopEdge(frame,p,outline[(outline.indexOf(p)+1)%outline.length],q))))continue;
      const edge=recoveryBox?sideBoundaryEvidence(input,frame,outline,q):null;
      // Existing texture identity can replace sesame distribution only when
      // CURRENT boundaries and filling support the whole observed cap.
      if(recoveryBox&&!edge.supported)continue;
      candidates.push({points:outline,...q,width:w,green:green||localFilling,redRatio,sesame,
        ...(recoveryBox?{method:'tracked-colour-cap',edge}:{})});
    }
    candidates.sort((a,b)=>b.count-a.count);
    // Do not choose between two similarly large orange/green objects.
    if(candidates.length>1&&candidates[1].count>candidates[0].count*.7)continue;
    if(candidates.length)proposals.push(candidates[0]);
    }
    // A broad mask can join bun and tray. Prefer an object whose extent
    // persists across the existing colour masks over a one-mask merge.
    // Among equally persistent proposals retain the fullest measured cap.
    const overlap=(a,b)=>{
      const area=q=>(q.right-q.left+1)*(q.bottom-q.top+1);
      const intersection=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)+1)*
        Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)+1);
      return intersection/(area(a)+area(b)-intersection);
    };
    // Hue gradients mostly shorten the lower crown vertically. A large lateral
    // extension seen only in a broad mask is often attached tray/wood, and must
    // not gain scale support merely because its bounding rectangle overlaps.
    for(const q of proposals)q.maskSupport=proposals.filter(p=>p!==q&&overlap(p,q)>.65&&
      Math.min(p.width,q.width)/Math.max(p.width,q.width)>.85).length;
    proposals.sort((a,b)=>Number(b.maskSupport>0)-Number(a.maskSupport>0)||b.count-a.count);
    return proposals[0]??null;
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
  function sideCapObservation(input,frame,selection,greens,whites,recoveryBox=null){
    const candidates=[],regions=capRegions(input,frame);
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
      if(recoveryBox&&!nearTrackedCap(q,recoveryBox))continue;
      if(selection&&Math.hypot(q.x-selection.x*frame.w,q.y-selection.y*frame.h)>w*1.5)continue;
      const green=greens.find(g=>g.right-g.left+1>=w*.5&&g.right-g.left+1<=w*1.5&&Math.abs(g.x-q.x)<w*.3&&g.y>q.bottom&&g.y-q.bottom<w*.7);
      if((!green&&!recoveryBox)||!confirmCap(input,{x:q.left,y:q.top,width:w,height:h}).supported)continue;
      const rows=source.rows.filter(r=>r.y<=q.bottom);
      const points=rows.flatMap(r=>[{x:r.left,y:r.y},{x:r.right,y:r.y}]);
      let pale=0,red=0;q.count=rows.reduce((n,r)=>n+r.count,0);
      for(let y=q.top;y<=q.bottom;y++)for(let x=q.left;x<=q.right;x++){
        const k=y*frame.w+x;
        if(frame.labels[k]===WHITE)pale++;
        const r=input.data[k*4],g=input.data[k*4+1],b=input.data[k*4+2];
        if(r>85&&r>g*1.48&&g>b*1.3&&g>32)red++;
      }
      if(pale<3||red<w*h*.1||(q.count+pale)/(w*h)<.4||points.length<6)continue;
      const outline=hull(points),sesame=sesameEvidence(frame,q,whites);
      // A plain rectangular rim is insufficient; retain observed shoulder
      // segments without imposing a particular dome height at shallow angles.
      if(outline.length<6)continue;
      if(!recoveryBox&&sesame.count>=3&&(sesame.offsetX>.12||sesame.spanX<.28))continue;
      const edge=sideBoundaryEvidence(input,frame,outline,q);
      if(!edge.supported)continue;
      candidates.push({...q,points:outline,width:w,green:green||!!recoveryBox,sesame,method:recoveryBox?'tracked-side-outline':'side-outline',edge});
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
  const currentPixels=Symbol('current game image');
  function prepareFrame(input){
    // Own the cache for one update even when the caller reuses its RGBA buffer.
    return {...input,[currentPixels]:frameData(input),[currentRegions]:new Map()};
  }
  function frameData(input) {
    if(input[currentPixels])return {...input[currentPixels]};
    const {data,width,height}=input;
    const labels=new Uint8Array(width*height),gray=new Uint8Array(width*height);
    for(let i=0;i<labels.length;i++) {
      const r=data[i*4],g=data[i*4+1],b=data[i*4+2];labels[i]=classify(r,g,b);gray[i]=(r+2*g+b)/4;
    }
    return {labels,gray,w:width,h:height};
  }
  const sesameComponents=new WeakMap();
  function components(frame,label,minimum,captureRows=false) {
    const sesame=label===WHITE&&minimum===1&&!captureRows;
    if(sesame&&sesameComponents.has(frame.labels))return sesameComponents.get(frame.labels);
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
      if(tail>=minimum){
        let rows;
        if(captureRows){
          const byY=new Map();
          for(let j=0;j<tail;j++){
            const x=queue[j]%w,y=(queue[j]/w)|0,r=byY.get(y);
            if(r){r.left=Math.min(r.left,x);r.right=Math.max(r.right,x);r.count++;}
            else byY.set(y,{y,left:x,right:x,count:1});
          }
          rows=[...byY.values()];
        }
        out.push({x:sx/tail,y:sy/tail,count:tail,left,right,top,bottom,
          xx:xx/tail-(sx/tail)**2,yy:yy/tail-(sy/tail)**2,xy:xy/tail-sx*sy/tail**2,...(rows?{rows}:{})});
      }
    }
    out.sort((a,b)=>b.count-a.count);
    if(sesame)sesameComponents.set(labels,out);
    return out;
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
      // Integrate the visible material in the depth buffer. A sparse colour
      // sampling grid can miss a narrow band entirely at intermediate tilts.
      const area=[{x:0,y:0,n:0,cols:new Set()},{x:0,y:0,n:0,cols:new Set()}];
      for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++){
        const i=y*N+x,px=(x-32)*step;
        if(Math.abs(px)>=geometry.upperDiameter*.23||material[i]!==2||
          material[i-1]!==2||material[i+1]!==2||material[i-N]!==2||material[i+N]!==2||
          worldY[i]>geometry.fillingHeight*.22)continue;
        const a=area[worldY[i]<-geometry.fillingHeight*.1?1:0];
        a.x+=px;a.y+=(y-32)*step;a.n++;a.cols.add(x);
      }
      const layerAnchors=area.map(a=>a.n>=12&&a.cols.size>=6?{x:a.x/a.n,y:a.y/a.n}:null);
      const upperIds=new Set(mesh.faces.filter(f=>f.part==='upper').flatMap(f=>f.ids));
      const fillingIds=new Set(mesh.faces.filter(f=>f.part==='filling').flatMap(f=>f.ids));
      output.push({elevation,samples,groups,anchors,layerAnchors,lowerSamples,
        upperHull:hull([...upperIds].map(i=>({x:points[i].x,y:points[i].y}))),
        fillingHull:hull([...fillingIds].map(i=>({x:points[i].x,y:points[i].y}))),
        centerMaterial:material[32*N+32]===2?'filling':'bun'});
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
    // Measure visible layer sides independently of the cap's extent. A cup
    // or tray is not connected to the central dark/green strip of the burger.
    const sides=[];
    for(const [band,label] of [[dark,DARK],[green,GREEN]]){
      const columns=[],cx=(b.left+b.right)/2;
      for(let x=Math.max(0,Math.floor(cx-w*.7));x<Math.min(frame.w,Math.ceil(cx+w*.7));x++){
        let n=0;
        for(let y=band.top;y<=band.bottom;y++)n+=frame.labels[y*frame.w+x]===label;
        columns.push({x,hit:n>=Math.max(2,(band.bottom-band.top+1)*.3)});
      }
      const runs=[];let run=[],gap=0;
      const finish=()=>{if(run.length){runs.push(run);run=[];}gap=0;};
      for(const q of columns){if(q.hit){run.push(q.x);gap=0;}else if(++gap>Math.max(1,w*.025))finish();}finish();
      const central=runs.filter(r=>r[0]<cx+w*.1&&r.at(-1)>cx-w*.1).sort((a,b)=>b.length-a.length)[0];
      if(central&&central.at(-1)-central[0]>=w*.45)
        sides.push({left:central[0],right:central.at(-1),y:band.y,band:label===DARK?'dark':'green'});
    }
    return {dark,green,lower,width:w,sides};
  }
  function measuredBow(frame){
    if(!frame.layers||!frame.cap)return null;
    const box=bounds(frame.cap.points),w=box.right-box.left,cx=(box.left+box.right)/2;
    // Measure the current bun/cheese interface close to its observed
    // silhouette. A deeper edge may belong to another filling layer.
    const columns=Math.min(121,Math.round(.88*w)+1);
    const near=frontSeam(frame,.06,.94,columns,false,.08,3);
    const far=frontSeam(frame,.06,.94,columns,false,.08,4);
    if(!near||!far)return null;
    const shared=near.points.filter(p=>far.points.some(q=>q.x===p.x&&Math.abs(q.edgeY-p.edgeY)<=1));
    if(shared.length<24)return null;
    const groups=[-.35,0,.35].map(x=>shared.filter(q=>Math.abs((q.x-cx)/w-x)<.085));
    if(groups.some(q=>q.length<4))return null;
    const profile=groups.map(points=>({
      x:points.reduce((sum,q)=>sum+q.x,0)/points.length,
      y:points.reduce((sum,q)=>sum+q.edgeY,0)/points.length
    }));
    const [a,b,c]=profile;
    // The sag must be resolved independently of the edge aperture and
    // both shoulders must bracket the centre of the observed crease.
    if(Math.min(b.y-a.y,b.y-c.y)<4)return null;
    return profile;
  }
  function bowError(projected,observed){
    const offsets=[];
    for(const q of observed){
      let bottom=-Infinity;
      for(let i=0;i<projected.length;i++){
        const a=projected[i],b=projected[(i+1)%projected.length];
        if((a.x<=q.x)!==(b.x<=q.x))
          bottom=Math.max(bottom,a.y+(b.y-a.y)*(q.x-a.x)/(b.x-a.x));
      }
      if(!Number.isFinite(bottom))return 0;
      offsets.push(bottom-q.y);
    }
    // Compare both shoulders to the middle of the same raw crease. This
    // measures its curvature and tilt while cancelling vertical placement.
    return (Math.abs(offsets[0]-offsets[1])+Math.abs(offsets[2]-offsets[1]))/2;
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
    const materialScore=score;let contourScore=null,bowPenalty=0;
    if(frame.cap){
      const projected=template.upperHull.map(q=>({x:p.x+p.scale*(q.x*c+q.y*s),y:p.y+p.scale*(-q.x*s+q.y*c)}));
      const observed=frame.cap.points;
      if(frame.bow)bowPenalty=2.2*bowError(projected,frame.bow)/frame.cap.width;
      const aBox=bounds(projected),bBox=bounds(observed);
      capHeightError=Math.abs((aBox.bottom-aBox.top)-(bBox.bottom-bBox.top))/frame.cap.width;
      const a=observed.map(q=>edgeDistance(q,projected)),b=projected.map(q=>edgeDistance(q,observed));
      contourError=(a.reduce((s,x)=>s+x,0)/a.length+b.reduce((s,x)=>s+x,0)/b.length)/(2*frame.cap.width);
      contourMaxError=Math.max(...a,...b)/frame.cap.width;
      // Count outliers separately in each direction: many good template points
      // must not hide a substantial missing section of the observed outline.
      contourOutlierFraction=Math.max(...[a,b].map(errors=>errors.filter(e=>e/frame.cap.width>.1).length/errors.length));
      contourScore=Math.max(0,1-contourError*8);
      score=.45*score+.55*contourScore;
    }
    let layerError=null,layerBonus=0,lowerBonus=0,sideError=null;
    if(frame.layers&&template.layerAnchors.every(Boolean)){
      const predicted=template.layerAnchors.map(q=>p.y+p.scale*(-q.x*s+q.y*c));
      layerError=(Math.abs(predicted[0]-frame.layers.dark.y)+Math.abs(predicted[1]-frame.layers.green.y))/(2*frame.layers.width);
      // The stylised layers are irregular: do not chase sub-band pixel noise.
      // Only use their positions to rank materially different model fits.
      layerBonus=.06*clamp((.12-layerError)/.08,0,1);
      const fillingOutline=template.fillingHull.map(q=>({x:p.x+p.scale*(q.x*c+q.y*s),y:p.y+p.scale*(-q.x*s+q.y*c)}));
      const sideErrors=[];
      for(const side of frame.layers.sides??[]){
        const intersections=[];
        for(let i=0;i<fillingOutline.length;i++){
          const a=fillingOutline[i],b=fillingOutline[(i+1)%fillingOutline.length];
          if((a.y<=side.y&&b.y>side.y)||(b.y<=side.y&&a.y>side.y))
            intersections.push(a.x+(b.x-a.x)*(side.y-a.y)/(b.y-a.y));
        }
        // A visible filling band outside the projected filling is a mismatch,
        // not missing image evidence. Hidden lower-bun edges are never inferred.
        // A coloured patch need not reach the cylinder's silhouette: cheese,
        // shadow and another layer may cover its sides. Only penalize visible
        // filling outside the model, not a model wider than a colour patch.
        sideErrors.push(intersections.length>=2?
          (Math.max(0,Math.min(...intersections)-side.left)+Math.max(0,side.right-Math.max(...intersections)))/(2*frame.layers.width):.2);
      }
      if(sideErrors.length)sideError=sideErrors.reduce((a,b)=>a+b,0)/sideErrors.length;
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
    // Material still checks that this is a supported burger model. Once it is,
    // rank tabletop orientations by shape and layer positions, not by which
    // irregular patch of cheese happens to fall on a colour sample.
    const layerPenalty=layerError===null?0:.6*Math.max(0,layerError-.04);
    const sidePenalty=sideError===null?0:Math.max(0,sideError-.025);
    const rankingScore=frame.table&&contourScore!==null?.55*contourScore+layerBonus+lowerBonus-layerPenalty-sidePenalty:score+layerBonus+lowerBonus;
    // Each visible cheese strip supplies a lower bound on projected filling
    // beyond the crown. Hidden parts of the filling contribute no residual.
    let skirtPenalty=0;
    if(frame.skirt){
      for(const q of frame.skirt){
        const nx=q.dx*c-q.dy*s,ny=q.dx*s+q.dy*c;
        const extent=poly=>{
          let value=-Infinity;
          for(const z of poly)value=Math.max(value,z.x*nx+z.y*ny);
          return value;
        };
        const visible=p.scale*(extent(template.fillingHull)-extent(template.upperHull));
        skirtPenalty+=Math.max(0,q.thickness-.75-Math.max(0,visible));
      }
      skirtPenalty/=frame.cap.width*frame.skirt.length;
    }
    return {score,rankingScore:rankingScore-skirtPenalty-bowPenalty,bowPenalty,skirtPenalty,materialScore,contourScore,layerEvidence:frame.layers??null,layerError,layerBonus,lowerBonus,sideError,layerPenalty,sidePenalty,
      lowerSampleCount:template.lowerSamples.length,contourError,contourMaxError,capHeightError,contourOutlierFraction,
      upper:fraction[1],filling:fraction[2],lower:fraction[3],outside:fraction[0],greens,darks,buns,fillSamples:count[2]};
  }
  // The detected cap fixes translation and scale for EACH orientation. Colour
  // evidence may select a view, but cannot slide/shrink the model off the bun.
  const fitAxes=Array.from({length:12},(_,i)=>({x:Math.cos(i*Math.PI/12),y:Math.sin(i*Math.PI/12)}));
  function directionalBounds(poly,roll){
    const c=Math.cos(roll*DEG),s=Math.sin(roll*DEG);
    return fitAxes.map(n=>{
      const x=n.x*c-n.y*s,y=n.y*c+n.x*s;let lo=Infinity,hi=-Infinity;
      for(const p of poly){const z=p.x*x+p.y*y;lo=Math.min(lo,z);hi=Math.max(hi,z);}
      return {width:hi-lo,mid:(hi+lo)/2};
    });
  }
  function alignRoundCap(frame,p,registered){
    const t=templateOf(p),b=bounds(frame.cap.points),w=b.right-b.left;
    if(!frame.cap.sesame?.strong||t.elevation<60||b.bottom-b.top<w*.90)return registered;
    const seen=frame.cap.directions??=directionalBounds(frame.cap.points,0);
    const byRoll=t.capDirections??=new Map();
    if(!byRoll.has(p.roll))byRoll.set(p.roll,directionalBounds(t.upperHull,p.roll));
    const model=byRoll.get(p.roll);
    // Near a top view the current image measures the bun diameter in several
    // directions. One tangent on a tray edge should not set the entire scale.
    const scales=seen.map((q,i)=>q.width/model[i].width).sort((a,b)=>a-b);
    const medianScale=(scales[5]+scales[6])*.5;
    const scale=clamp(medianScale,registered.scale*.96,registered.scale*1.04);
    let x=0,y=0;
    for(let i=0;i<fitAxes.length;i++){
      const offset=seen[i].mid-scale*model[i].mid;
      x+=offset*fitAxes[i].x;y+=offset*fitAxes[i].y;
    }
    return {...p,scale,x:2*x/fitAxes.length,y:2*y/fitAxes.length};
  }


  function alignCap(frame,p) {
    if(!frame.table||!frame.cap)return p;
    const c=Math.cos(p.roll*DEG),s=Math.sin(p.roll*DEG);
    const box=bounds(templateOf(p).upperHull.map(q=>({x:q.x*c+q.y*s,y:-q.x*s+q.y*c})));
    const observed=bounds(frame.cap.points),scale=(observed.right-observed.left)/(box.right-box.left);
    return {...p,scale,x:(observed.left+observed.right-scale*(box.left+box.right))/2,
      y:(observed.top+observed.bottom-scale*(box.top+box.bottom))/2};
  }
  function frontSeam(frame,first=.17,last=.83,columns=13,distant=false,below=distant?.17:.075,aperture=null){
    if(!frame.cap)return null;
    const poly=frame.cap.points,b=bounds(poly),w=b.right-b.left;
    const d=aperture??(distant?3:Math.round(w*.035)),points=[];if(d<3)return null;
    for(let column=0;column<columns;column++){
      const x=Math.round(b.left+w*(first+(last-first)*column/(columns-1)));let low=-Infinity;
      for(let j=0;j<poly.length;j++){
        const a=poly[j],c=poly[(j+1)%poly.length];
        if((a.x<=x&&x<c.x)||(c.x<=x&&x<a.x))
          low=Math.max(low,a.y+(x-a.x)*(c.y-a.y)/(c.x-a.x));
      }
      if(!Number.isFinite(low))continue;
      let best=null;
      for(let y=Math.max(2*d,Math.ceil(low-.075*w));y<Math.min(frame.h-2*d,low+below*w);y++){
        const i=y*frame.w+x;
        if(frame.labels[i-d*frame.w]!==BUN||
          (frame.labels[i+d*frame.w]!==YELLOW&&frame.labels[i+2*d*frame.w]!==YELLOW))continue;
        const val=Math.min(frame.gray[i-d*frame.w]-frame.gray[i],frame.gray[i+d*frame.w]-frame.gray[i]);
        if(val>=(distant?30:15)&&(!best||val>best.val)){
          // Localise the upper edge of the dark crease, where the bun ends.
          let edgeY=y,drop=0;
          for(let yy=y-d;yy<=y;yy++){
            const iy=yy*frame.w+x,g=frame.gray[iy-frame.w]-frame.gray[iy+frame.w];
            if(g>drop){drop=g;edgeY=yy;}
          }
          best={x,y,val,edgeY};
        }
      }
      if(best)points.push(best);
    }
    if(points.length<8||points.at(-1).x-points[0].x<w*.45)return null;
    return {points,width:w};
  }
  // A similarly coloured object behind the crown can move differently from
  // the dark crease directly below the bun. Use that current crease only to
  // locate the next edge search. The fit still needs a fresh closed outline.
  function seamSearch(input,observed,transported){
    if(!observed||!transported)return transported;
    const b=bounds(transported),w=b.right-b.left,z=observed.box;
    if(w<36||b.bottom-b.top>w*.66||z.height<b.bottom-b.top+w*.065||
      Math.abs(z.width-w)>w*.13||z.y>b.top+w*.08)return transported;
    const frame=frameData(input);
    const seam=frontSeam({...frame,cap:{points:observed.contour,width:z.width}});
    if(!seam||seam.points.length<10)return transported;
    const dx=z.x+z.width/2-(b.left+b.right)/2,shifts=[];
    for(const p of seam.points){
      const x=p.x-dx;let low=-Infinity;
      for(let i=0;i<transported.length;i++){
        const a=transported[i],c=transported[(i+1)%transported.length];
        if((a.x<=x&&x<c.x)||(c.x<=x&&x<a.x))
          low=Math.max(low,a.y+(x-a.x)*(c.y-a.y)/(c.x-a.x));
      }
      if(Number.isFinite(low))shifts.push(p.edgeY-low);
    }
    if(shifts.length<9)return transported;
    shifts.sort((a,b)=>a-b);
    const dy=shifts[shifts.length>>1];
    if(dy<w*.025||dy>w*.20||Math.abs(dx)>w*.16||
      shifts[Math.floor(shifts.length*.8)]-shifts[Math.floor(shifts.length*.2)]>w*.055)return transported;
    return transported.map(p=>({x:p.x+dx,y:p.y+dy}));
  }
  function shallowAttachment(observed,transported){
    if(!observed||!transported)return false;
    const b=bounds(transported),w=b.right-b.left,z=observed.box;
    return w>=36&&b.bottom-b.top<=w*.66&&z.y<b.top-.075*w&&Math.abs(z.y+z.height-b.bottom)<=w*.16;
  }
  // When the background and bun touch, seed height from the sesame spots
  // and seam. The model only places search rays; all accepted endpoints and
  // the four boundary checks come from this image.
  function seededLayerOutline(input,observed,transported){
    if(!shallowAttachment(observed,transported))return null;
    const b=bounds(transported),w=b.right-b.left,f=frameData(input);
    const seed=sesameSeed(input,f,{x:b.left,y:b.top,width:w,height:b.bottom-b.top});
    if(!seed||seed.y<=b.top+.045*w||seed.y>=b.top+.20*w)return null;
    const seam=frontSeam({...f,cap:{points:observed.contour,width:observed.box.width}});
    if(!seam||seam.points.length<10||seam.points.at(-1).x-seam.points[0].x<w*.52)return null;
    const h=b.bottom-seed.y;
    // The crown is a surface of revolution. Its height at any elevation
    // is the span of the side section along that view's vertical direction.
    // Build a full material template only for the chosen search silhouette.
    const section=fineTemplate(0).upperHull,base=bounds(section),diameter=base.right-base.left;
    let bestAngle=0,error=Infinity;
    for(let angle=0;angle<=55;angle+=2){
      const c=Math.cos(angle*DEG),s=Math.sin(angle*DEG);
      let top=Infinity,bottom=-Infinity;
      for(const q of section){
        const y=q.y*c+q.x*s;top=Math.min(top,y);bottom=Math.max(bottom,y);
      }
      const delta=Math.abs((bottom-top)/diameter-h/w);
      if(delta<error){bestAngle=angle;error=delta;}
    }
    const outline=fineTemplate(bestAngle).upperHull,z=bounds(outline);
    const searches=[0,-.025,.025].map(shift=>outline.map(q=>({
      x:b.left+w*(shift+(q.x-z.left)/(z.right-z.left)),
      y:seed.y+h*(q.y-z.top)/(z.bottom-z.top)})));
    // Keep a supported ordinary registration first. Where the side is blurred,
    // test its current RGB transition along neighboring normals, then require
    // the same boundary, sesame, filling and pose checks.
    for(const measure of [localBoundary,measureNormalEdges])for(const search of searches){
      const found=findLayeredOutline(input,observed,search,measure);
      if(found)return {...found,method:'seam-seeded-current-outline'};
    }
    return null;
  }
  function findLayeredOutline(input,observed,transported,measureEdge){
    const old=bounds(transported),width=old.right-old.left;
    if(width<36||old.bottom-old.top>width*.66||observed&&!shallowAttachment(observed,transported))return null;
    const found=findCurrentOutline(input,observed,transported,measureEdge);if(!found)return null;
    const frame=frameData(input),b=bounds(found.contour);
    if(!sideBoundaryEvidence(input,frame,found.contour,b).supported||!confirmCap(input,found.box).supported)return null;
    const seam=frontSeam({...frame,cap:{points:found.contour,width:found.box.width}});
    if(!seam||seam.points.length<10||seam.points.at(-1).x-seam.points[0].x<width*.52)return null;
    return {...found,hasFilling:true,method:'current-layered-outline'};
  }
  // Fit the centre of the RGB transition on clean upper/side boundaries.
  // The two local colour plateaus define the edge, independently of exposure.
  function profileOutline(input,observation,inset=0){
    const poly=observation.contour,w=observation.box.width,W=input.width,H=input.height,rgba=input.data;
    if(w<40||poly.length<8)return observation;
    const reach=Math.max(4,Math.min(11,Math.round(w*.072))-inset),samples=[];
    const rgb=(x,y)=>{
      const x0=Math.floor(x),y0=Math.floor(y),i=4*(y0*W+x0),u=x-x0,v=y-y0;
      return [0,1,2].map(k=>(1-v)*(rgba[i+k]*(1-u)+rgba[i+4+k]*u)+v*(rgba[i+W*4+k]*(1-u)+rgba[i+W*4+4+k]*u));
    };
    const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],v=poly[(i+poly.length-1)%poly.length];
      const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),steps=Math.max(1,Math.ceil(len/Math.max(3,w*.042)));
      if(!len)continue;
      for(let k=0;k<steps;k++){
        const t=k/steps,x=a.x+dx*t,y=a.y+dy*t;
        let nx=dy/len,ny=-dx/len;
        if(!k){
          const px=a.x-v.x,py=a.y-v.y,pn=Math.hypot(px,py);
          if(pn){nx+=py/pn;ny-=px/pn;const L=Math.hypot(nx,ny);if(L){nx/=L;ny/=L;}}
        }
        const item={x,y,nx,ny,shift:null};samples.push(item);
        if(ny>.35||x<reach+4||x>=W-reach-4||y<reach+4||y>=H-reach-4)continue;
        const read=t=>rgb(x+t*nx,y+t*ny);
        const fg=read(-reach),bg=read(reach),fg2=read(-reach-2),bg2=read(reach+2),contrast=dist(fg,bg);
        if(contrast<48||dist(fg,fg2)>contrast*.30||dist(bg,bg2)>contrast*.25)continue;
        const delta=bg.map((c,i)=>c-fg[i]),D=contrast*contrast;
        let last=0,peak=0,edge=null,reversal=0,worstResidual=0;
        for(let step=-reach+1;step<=reach;step++){
          const col=read(step),z=col.reduce((sum,c,j)=>sum+(c-fg[j])*delta[j],0)/D;
          reversal+=Math.max(0,peak-z);peak=Math.max(peak,z);
          if(last<=.5&&z>.5)edge=step-1+(.5-last)/(z-last);
          if(z>.12&&z<.88)worstResidual=Math.max(worstResidual,dist(col,fg.map((c,i)=>c+z*delta[i])));
          last=z;
        }
        if(edge!==null&&Math.abs(edge)<=reach*.79&&reversal<.65&&worstResidual<contrast*.37)item.shift=edge;
      }
    }
    let changed=0;
    const corrected=samples.map((q,i)=>{
      const l=samples[(i+samples.length-1)%samples.length],r=samples[(i+1)%samples.length];
      if(q.shift===null||l.shift===null||r.shift===null||
        Math.max(Math.abs(q.shift-l.shift),Math.abs(q.shift-r.shift))>Math.max(2,w*.027))return {x:q.x,y:q.y};
      if(Math.abs(q.shift)>.5)changed++;
      return {x:q.x+q.nx*q.shift,y:q.y+q.ny*q.shift};
    });
    if(changed<5)return observation;
    const contour=hull(corrected),b=bounds(contour);
    return {...observation,contour,box:{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top}};
  }
  // A filling texture match can preserve identity only when the current
  // pixels also resolve the interface between the bun and that filling.
  function hasFrontCrease(input,observation){
    return withFrontEdge(frameData(input),observation)!==observation;
  }
  function withFrontEdge(frame,observation){
    if(!observation?.contour?.length)return observation;
    const z=observation.box,view={...frame,cap:{points:observation.contour,width:z.width}};
    let seam=frontSeam(view),measuredDistant=false,wideCrease=false;
    // On a small bun the orange region can stop on shading. The physical dark
    // crease is still resolved when a three-pixel aperture finds both flanks.
    const small=Math.round(z.width*.035)<3;
    if(!seam&&(small||z.height<=z.width*.62)&&visibleLayers(view)){
      // The measured outline can include the dark crease. Search inside it
      // on taller caps, where a deeper cheese edge belongs to another layer.
      const below=z.height<=z.width*.62?.17:0;
      let local=frontSeam(view,.16,.84,25,true,below);
      // A colour mask can end on shading even when the ordinary aperture
      // has rounded up to three pixels. Check the farther crease at two
      // apertures across both shoulders before it can extend the contour.
      if(!small&&local){
        const check=frontSeam(view,.16,.84,25,true,below,4);
        const shared=local.points.filter(p=>check?.points.some(q=>p.x===q.x&&Math.abs(p.edgeY-q.edgeY)<=1));
        local=shared.length>=15&&shared.at(-1).x-shared[0].x>=z.width*.52?{...local,points:shared}:null;
      }
      if(below===0&&local&&local.points.length<15){
        // A blurred crease can span the narrow sampling aperture. Read its
        // flanks farther apart and verify the same edge on the shared columns.
        const wide=frontSeam(view,.16,.84,25,true,below,5);
        if(wide){
          const shared=local.points.filter(a=>wide.points.some(b=>b.x===a.x&&Math.abs(b.edgeY-a.edgeY)<=1));
          // Both apertures must see one continuous interface. A wide sample
          // can otherwise bridge a missing shoulder to a different dark edge.
          const continuous=shared.every((q,i)=>!i||q.x-shared[i-1].x<=z.width*.16);
          if(continuous&&shared.length>=8&&shared.length>=local.points.length*.8){local=wide;wideCrease=true;}
        }
      }
      if(local&&local.points.length>=15){
        // Verify the same physical crease across both shoulders and the centre.
        // A highlight may erase a few columns without moving the remaining edge.
        const points=local.points,q=[.13,.50,.87].map(t=>points[Math.floor(t*(points.length-1))]);
        const inliers=(samples,anchors)=>samples.filter(p=>{
          const y=anchors.reduce((sum,a,k)=>{
            const b=anchors[(k+1)%3],c=anchors[(k+2)%3];
            return sum+a.edgeY*(p.x-b.x)*(p.x-c.x)/((a.x-b.x)*(a.x-c.x));
          },0);
          return Math.abs(p.edgeY-y)<=1.5;
        });
        let consistent=inliers(points,q);
        // Uneven contrast can put all three quantiles on the flat centre.
        // Retest the shoulders only if another aperture sees the same edges.
        if(small&&below>0&&consistent.length>=15&&consistent.length>=points.length*.8&&
          consistent.at(-1).x-consistent[0].x<z.width*.52){
          const check=frontSeam(view,.16,.84,25,true,below,4);
          const left=points[0],right=points.at(-1),cx=(left.x+right.x)/2;
          if(check&&[left,right].every(p=>check.points.some(b=>b.x===p.x&&Math.abs(b.edgeY-p.edgeY)<=1))){
            const mid=points.find(p=>p.x>=cx);
            if(mid!==right){
              const anchors=[left,mid,right],other=inliers(check.points,anchors);
              if(other.length>=15&&other.length>=check.points.length*.8&&
                other.at(-1).x-other[0].x>=z.width*.52&&
                other.every((p,i)=>!i||p.x-other[i-1].x<=z.width*.16))
                consistent=inliers(points,anchors);
            }
          }
        }
        if(consistent.length>=15&&consistent.length>=points.length*.8){
          seam={...local,points:consistent};measuredDistant=true;
        }
      }
    }
    if(!seam||seam.points.length<10)return observation;
    let a=seam.points;
    if(a.at(-1).x-a[0].x<z.width*.52)return observation;
    const left=a[0],right=a.at(-1),middle=a.slice(Math.floor(a.length/2)-1,Math.floor(a.length/2)+2);
    const rise=middle.map(q=>q.edgeY-left.edgeY-(right.edgeY-left.edgeY)*(q.x-left.x)/(right.x-left.x));
    // On a distant or nearly level rim, the measured curvature can be less
    // than the edge-sampling aperture. Its shoulder slope is then unresolved.
    if(z.height>z.width*.62&&Math.min(...rise)>=Math.max(5,2*Math.round(z.width*.035))){
      // A visible front crease can continue onto the two shoulders. Keep
      // extending only while each new edge stays on the same measured arc.
      const wider=frontSeam({...frame,cap:{points:observation.contour,width:z.width}},.045,.955,27);
      if(wider){
        a=a.slice();
        for(const dir of [-1,1]){
          const end=()=>dir<0?a[0]:a.at(-1);
          const more=wider.points.filter(p=>dir*(p.x-end().x)>z.width*.016);
          if(dir<0)more.reverse();
          for(const p of more){
            const q=end(),prev=dir<0?a[1]:a.at(-2),dx=p.x-q.x;
            if(Math.abs(dx)>z.width*.075||!prev||q.x===prev.x)break;
            const expected=q.edgeY+dx*(q.edgeY-prev.edgeY)/(q.x-prev.x);
            if(Math.abs(p.edgeY-expected)>Math.max(2,z.width*.022))break;
            if(dir<0)a.unshift(p);else a.push(p);
          }
        }
      }
    }
    // A narrow highlight can fall on two adjacent sample columns. Measure
    // the intervening pixels before rejecting an otherwise continuous crease.
    if(!measuredDistant&&a.some((q,i)=>i&&q.x-a[i-1].x>z.width*.16)){
      const dense=frontSeam(view,.17,.83,25);
      if(dense){
        const gaps=a.slice(1).map((q,i)=>[a[i].x,q.x]).filter(([l,r])=>r-l>z.width*.16);
        const extra=dense.points.filter(q=>gaps.some(([l,r])=>l<q.x&&q.x<r));
        a=[...a,...extra].sort((p,q)=>p.x-q.x);
      }
    }
    for(let i=1;i<a.length;i++){
      if(a[i].x-a[i-1].x>z.width*.16||Math.abs(a[i].edgeY-a[i-1].edgeY)>z.width*.13)return observation;
    }
    const pts=observation.contour.filter(q=>q.x<a[0].x||q.x>a.at(-1).x||q.y<z.y+z.height*.48);
    const contour=hull([...pts,...a.map(q=>({x:q.x,y:q.edgeY}))]),b=bounds(contour);
    return {...observation,contour,measuredDistant,wideCrease,box:{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top}};
  }
  // At steep angles the visible cheese can form a thin arc around the crown.
  // Its direction constrains where the filling can project beyond the cap.
  function cheeseArc(frame) {
    if(!frame.cap||frame.layers)return null;
    const pts=frame.cap.points,box=bounds(pts),width=frame.cap.width;
    if(box.bottom-box.top<width*.84)return null;
    const cx=(box.left+box.right)/2,cy=(box.top+box.bottom)/2;
    const label=(x,y)=>{x=Math.round(x);y=Math.round(y);return x>=0&&x<frame.w&&y>=0&&y<frame.h?frame.labels[y*frame.w+x]:NONE;};
    const arc=[],space=Math.max(1.2,width*.015);
    for(let i=0;i<48;i++){
      const theta=i*Math.PI/24,dx=Math.cos(theta),dy=Math.sin(theta);let rim=null;
      for(let j=0;j<pts.length;j++){
        const a=pts[j],b=pts[(j+1)%pts.length],x=a.x-cx,y=a.y-cy,vx=b.x-a.x,vy=b.y-a.y;
        const den=dx*vy-dy*vx;if(Math.abs(den)<1e-6)continue;
        const r=(x*vy-y*vx)/den,u=(x*dy-y*dx)/den;
        if(r>0&&u>=0&&u<=1){rim=r;break;}
      }
      if(rim===null)continue;
      const sample=r=>label(cx+dx*r,cy+dy*r);
      for(let r=rim-width*.12;r<rim+width*.035;r+=1){
        if(sample(r-2*space)===BUN&&sample(r-space)===BUN&&
          sample(r+space)===YELLOW&&sample(r+2*space)===YELLOW){
          let outer=r+2*space;
          while(outer+1<r+width*.18&&sample(outer+1)===YELLOW)outer++;
          arc.push({i,dx,dy,thickness:outer-r});break;
        }
      }
    }
    const contiguous=arc.filter(q=>[-1,1].every(s=>arc.some(t=>t.i===(q.i+s+48)%48)));
    // Require a quarter turn of corroborated measurements in total. Small
    // gaps between physical cheese segments do not erase adjacent evidence.
    if(contiguous.length<12)return null;
    const x=contiguous.reduce((s,q)=>s+q.dx,0)/contiguous.length,y=contiguous.reduce((s,q)=>s+q.dy,0)/contiguous.length;
    if(Math.hypot(x,y)<=.68)return null;
    return contiguous.filter((q,i)=>i%Math.max(1,Math.floor(contiguous.length/6))===0);
  }

  const flankProfiles=new Map();
  function flankProfile(elevation,roll){
    const key=elevation*100+roll;
    if(flankProfiles.has(key))return flankProfiles.get(key);
    const c=Math.cos(roll*DEG),s=Math.sin(roll*DEG);
    const rotated=fineTemplate(elevation).upperHull.map(p=>({x:p.x*c+p.y*s,y:p.y*c-p.x*s}));
    const bb=bounds(rotated),w=bb.right-bb.left,cx=(bb.left+bb.right)/2;
    const poly=rotated.map(p=>({x:(p.x-cx)/w,y:(p.y-bb.bottom)/w}));
    const lengths=poly.map((p,i)=>{const q=poly[(i+1)%poly.length];return Math.hypot(q.x-p.x,q.y-p.y);});
    const total=lengths.reduce((x,y)=>x+y,0),stations=[];
    let k=0,from=0;
    for(let i=0;i<64;i++){
      const at=(i+.5)*total/64;
      while(k+1<poly.length&&from+lengths[k]<at)from+=lengths[k++];
      const a=poly[k],b=poly[(k+1)%poly.length],nx=(a.y-b.y)/lengths[k],ny=(b.x-a.x)/lengths[k];
      stations.push({x:a.x+ny*(at-from),y:a.y-nx*(at-from),nx,ny,
        side:ny>Math.abs(nx)*.7?0:ny<-Math.abs(nx)*.7?3:nx>0?1:2});
    }
    const rim=stations.filter(q=>q.side===3).sort((a,b)=>a.x-b.x);
    const profile={poly,stations,rim,top:(bb.top-bb.bottom)/w};
    flankProfiles.set(key,profile);return profile;
  }
  // A low-view colour mask can absorb the backdrop. Register the two flanks
  // and the crest together at the independently measured front crease, then
  // trace and validate an actual current outline around that search position.
  function differentialRimMotion(input,tracked,before){
    const vision=globalThis.BurgerVisual,now=frameData(input),bb=bounds(tracked),w=bb.right-bb.left;
    if(!before?.gray||!vision?.motion||!before.cap||w<48)return false;
    const current={width:now.w,height:now.h,data:now.gray},previous={width:before.w,height:before.h,data:before.gray};
    const match=box=>{
      if(box.x<1||box.y<1||box.x+box.width>=now.w-1||box.y+box.height>=now.h-1)return null;
      const flow=vision.motion(current,previous,vision.features(current,box),box);
      return flow?.inliers>=7&&Math.abs(Math.log(flow.scale))<.12?flow.matrix:null;
    };
    const fg=match({x:bb.left+w*.12,y:bb.bottom+w*.12,width:w*.76,height:w*.45});
    if(!fg)return false;
    const bg=match({x:bb.left-w*.10,y:bb.top-w*.36,width:w*1.2,height:w*.35});
    if(!bg)return false;
    const x=(bb.left+bb.right)/2,y=bb.top;
    const dx=(bg.a-fg.a)*x-(bg.b-fg.b)*y+bg.x-fg.x;
    const dy=(bg.b-fg.b)*x+(bg.a-fg.a)*y+bg.y-fg.y;
    return dy>=Math.max(2,w*.035)&&dy<w*.32&&Math.abs(dx)<dy*2?{fg,bg}:null;
  }
  // Test whether a pale mark outside the measured rim follows the background.
  // The two predictions were estimated independently, outside this patch.
  function backgroundMark(frame,before,spot,motion){
    const x=Math.round(spot.x),y=Math.round(spot.y);
    const error=(m,dx,dy)=>{
      let e=0;
      for(let j=-4;j<=4;j++)for(let i=-4;i<=4;i++){
        const u=x+i,v=y+j,px=m.a*u-m.b*v+m.x+dx,py=m.b*u+m.a*v+m.y+dy;
        const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
        if(ix<0||iy<0||ix+1>=frame.w||iy+1>=frame.h)return Infinity;
        const n=iy*frame.w+ix,a=before.gray;
        const old=(1-fy)*(a[n]*(1-fx)+a[n+1]*fx)+fy*(a[n+before.w]*(1-fx)+a[n+before.w+1]*fx);
        e+=Math.abs(frame.gray[v*frame.w+u]-old);
      }
      return e/81;
    };
    // The two flow estimates come from regions on either side of the rim.
    // Give both the same small translation search at the disputed mark.
    const local=m=>{
      let best=Infinity;
      for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++)best=Math.min(best,error(m,i,j));
      return best;
    };
    const bg=local(motion.bg),fg=local(motion.fg);
    return bg<25&&fg>bg*1.8&&fg-bg>18;
  }
  function recheckLayeredDetection(input,frame,before,motion,observed,candidate,sesame){
    if(observed?.method!=='colour-cap'||!observed.hasFilling||!observed.sesame?.strong||
      sesame.count<3||sesame.spanX<.28||sesame.offsetX>.12)return false;
    const poly=candidate.contour,w=candidate.box.width;
    const inside=q=>poly.every((a,i)=>{const b=poly[(i+1)%poly.length];return (b.x-a.x)*(q.y-a.y)-(b.y-a.y)*(q.x-a.x)>=0;});
    const outside=observed.sesame.centers.filter(q=>!inside(q)&&edgeDistance(q,poly)>w*.035);
    if(!outside.some(q=>backgroundMark(frame,before,q,motion)))return false;
    const retained=components(frame,WHITE,1).filter(q=>{
      const b=observed.box;
      return q.x<b.x||q.x>b.x+b.width||q.y<b.y||q.y>b.y+b.height||inside(q);
    });
    const full=capObservation(input,frame,null,null,retained);
    if(!full?.green||full.sesame.count<3||full.sesame.spanX<.28||full.sesame.offsetX>.12)return false;
    const box=bounds(full.points),a=candidate.box;
    return Math.abs((box.left+box.right)/2-a.x-a.width/2)<w*.10&&
      Math.abs(box.bottom-(a.y+a.height))<w*.10&&Math.abs(Math.log((box.right-box.left)/w))<.16;
  }

  function coherentCrease(crease,cx,w){
    // Estimate the curve from the observed extent. A missing shoulder does
    // not move the other points onto a synthetic endpoint.
    const mean=a=>({x:a.reduce((s,p)=>s+p.x,0)/a.length,y:a.reduce((s,p)=>s+p.edgeY,0)/a.length});
    const groups=[crease.slice(0,4),crease.filter(q=>Math.abs(q.x-cx)<w*.13),crease.slice(-4)];
    if(groups.some(g=>g.length<3))return false;
    const abc=groups.map(mean),[a,b,c]=abc;
    if(b.x-a.x<w*.21||c.x-b.x<w*.21)return false;
    const sag=b.y-(a.y+(c.y-a.y)*(b.x-a.x)/(c.x-a.x));
    if(sag<.5||sag>w*.14||Math.abs(c.y-a.y)/(c.x-a.x)>.19)return false;
    const ok=crease.filter(p=>{
      let y=0;
      for(let i=0;i<3;i++){
        const q=abc[i],r=abc[(i+1)%3],s=abc[(i+2)%3];
        y+=q.y*(p.x-r.x)*(p.x-s.x)/((q.x-r.x)*(q.x-s.x));
      }
      return Math.abs(y-p.edgeY)<=1.35;
    });
    return ok.length>=18&&ok.length>=crease.length*.90;
  }

  function measuredFlanks(input,observed,tracked,before){
    const frame=frameData(input),b=bounds(tracked),w=b.right-b.left;
    if(w<48||w>frame.w*.3||b.bottom-b.top>w*.82)return null;
    if(observed&&(observed.method!=='colour-cap'||observed.box.height<observed.box.width*.59))return null;
    const view={...frame,cap:{points:tracked,width:w}},cx=(b.left+b.right)/2;
    const a=frontSeam(view,.045,.955,35,false,.22,3),z=frontSeam(view,.045,.955,35,false,.22,4);
    if(!a||!z)return null;
    const crease=a.points.filter(p=>z.points.some(q=>q.x===p.x&&Math.abs(q.edgeY-p.edgeY)<=1));
    if(crease.length<18||crease.at(-1).x-crease[0].x<w*.68)return null;
    const middle=crease.filter(q=>Math.abs(q.x-cx)<w*.16).map(q=>q.edgeY).sort((x,y)=>x-y);
    if(middle.length<5)return null;
    const bottom=middle[middle.length>>1];
    if(!coherentCrease(crease,cx,w))return null;
    const motion=differentialRimMotion(input,tracked,before);
    if(!motion)return null;
    const x0=Math.floor(cx-w*.69)-9,x1=Math.ceil(cx+w*.69)+9;
    const y0=Math.floor(bottom-w*.76)-9,y1=Math.ceil(bottom+w*.16)+9;
    if(x0<1||y0<1||x1>=frame.w-1||y1>=frame.h-1)return null;
    const W=x1-x0+1,H=y1-y0+1,rgb=input.data,blur=new Uint8Array(W*H*3);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=4*((y+y0)*frame.w+x+x0),k=(y*W+x)*3;
      for(let ch=0;ch<3;ch++){
        let sum=0;
        for(let dy=-1;dy<=1;dy++){const t=i+dy*4*frame.w+ch;sum+=rgb[t-4]+rgb[t]+rgb[t+4];}
        blur[k+ch]=Math.round(sum/9);
      }
    }
    const seed=sesameSeed(input,frame,{x:b.left,y:bottom-w*.73,width:w,height:w*.73});
    const at=(x,y)=>3*((Math.round(y)-y0)*W+Math.round(x)-x0);
    let best=null;
    const rank=(angle,roll,mid,span)=>{
      const profile=flankProfile(angle,roll),counts=[0,0,0,0],sums=[0,0,0,0];
      for(const q of profile.stations){
        const x=mid+q.x*span,y=bottom+q.y*span,nx=q.nx*3,ny=q.ny*3;
        const a=at(x-2*nx,y-2*ny),b=at(x-nx,y-ny),m=at(x,y),d=at(x+nx,y+ny),e=at(x+2*nx,y+2*ny);
        let length=0,dot=0,center=0;
        for(let ch=0;ch<3;ch++){
          const delta=blur[d+ch]-blur[b+ch];length+=delta*delta;dot+=delta*(blur[e+ch]-blur[a+ch]);
          const v=blur[m+ch]-(blur[b+ch]+blur[d+ch])/2;center+=v*v;
        }
        const norm=Math.sqrt(length),rise=dot/Math.max(1,norm);
        sums[q.side]+=clamp(Math.min(norm,rise)/65,0,1.35)*clamp(1-Math.sqrt(center)/Math.max(30,norm),.2,1);
        counts[q.side]++;
      }
      const [top,left,right,lip]=sums.map((v,i)=>v/Math.max(1,counts[i]));
      const score=.38*Math.min(left,right)+.29*top+.09*(left+right)+.15*lip-
        (seed?Math.min(.35,1.4*Math.abs(bottom+span*profile.top-seed.y)/w):0);
      if(!best||score>best.score)best={profile,angle,roll,mid,span,score,top,left,right};
    };
    for(const angle of [8,14,20,26])for(const roll of [-4,0,4])
      for(const width of [.94,1.02,1.10])for(const dx of [-.045,0,.045])rank(angle,roll,cx+w*dx,w*width);
    const coarse=best;
    for(const angle of [coarse.angle-2,coarse.angle,coarse.angle+2])
      for(const dw of [-.025,0,.025])for(const dx of [-.018,0,.018])rank(angle,coarse.roll,coarse.mid+w*dx,coarse.span+w*dw);
    if(best.top<.30||Math.min(best.left,best.right)<.42)return null;
    const search=best.profile.poly.map(q=>({x:best.mid+q.x*best.span,y:bottom+q.y*best.span})),bb=bounds(search);
    if(observed&&bb.top-observed.box.y<w*.06)return null;
    const box={x:bb.left,y:bb.top,width:bb.right-bb.left,height:bb.bottom-bb.top};
    const trace=traceCrown(input,{box,contour:search},search);
    if(!trace||trace.refinement.supportedFraction<.83)return null;
    const candidate=measureNormalEdges(input,frame,trace)??measureNormalEdges(input,frame,{box,contour:search});
    if(!candidate)return null;
    if(Math.abs(candidate.box.y-bb.top)>w*.075||Math.abs(candidate.box.width-box.width)>w*.10||
      Math.abs(candidate.box.y+candidate.box.height-bottom)>w*.055)return null;
    const actual=bounds(candidate.contour),sesame=sesameEvidence(frame,actual,components(frame,WHITE,1));
    if(sesame.offsetX>.12||sesame.spanX<.28||!confirmCap(input,candidate.box).supported)return null;
    if(!sesame.strong&&!recheckLayeredDetection(input,frame,before,motion,observed,candidate,sesame))return null;
    return {...candidate,sesame,hasFilling:true,method:'measured-flanks-and-crease'};
  }

  // Accept only distinct white components seen at the foreground motion in
  // both frames. The current set must cover the usual span of the crown.
  function pairedSurfaceMarks(frame,before,poly,matrix){
    if(!before?.cap?.points||!matrix)return null;
    const get=(f,shape)=>{
      const b=bounds(shape),w=b.right-b.left+1,h=b.bottom-b.top+1,d=Math.max(2,Math.round(w*.06));
      return components(f,WHITE,1).filter(q=>{
        if(q.count<2||q.count>w*h*.025||q.x<=b.left||q.x>=b.right||q.y<=b.top||q.y>=b.bottom)return false;
        if(!shape.every((a,i)=>{const z=shape[(i+1)%shape.length];return (z.x-a.x)*(q.y-a.y)-(z.y-a.y)*(q.x-a.x)>0;}))return false;
        return edgeDistance(q,shape)>=Math.max(2,Math.sqrt(q.count)*.6);
      }).map(q=>{
        const k=Math.round(q.y)*f.w+Math.round(q.x);
        // Separate the white component from the surrounding bun. Sampling a
        // complete ring avoids dependence on the four image-axis directions.
        const radius=Math.max(3,Math.sqrt(q.count/Math.PI)+w*.026);
        let orange=0;
        for(let i=0;i<16;i++){
          const angle=i*Math.PI/8,x=Math.round(q.x+radius*Math.cos(angle)),y=Math.round(q.y+radius*Math.sin(angle));
          if(f.labels[y*f.w+x]===BUN)orange++;
        }
        const surrounded=orange>=12||[k-d,k+d,k-d*f.w,k+d*f.w].filter(j=>f.labels[j]===BUN).length>=3;
        return {...q,surrounded};
      });
    };
    const now=get(frame,poly),old=get(before,before.cap.points),found=[];
    const predictions=now.map(q=>({q,x:matrix.a*q.x-matrix.b*q.y+matrix.x,y:matrix.b*q.x+matrix.a*q.y+matrix.y}));
    const read=(f,x,y)=>{
      const u=Math.floor(x),v=Math.floor(y),dx=x-u,dy=y-v,i=v*f.w+u;
      return (1-dy)*((1-dx)*f.gray[i]+dx*f.gray[i+1])+dy*((1-dx)*f.gray[i+f.w]+dx*f.gray[i+f.w+1]);
    };
    for(const {q,x:px,y:py} of predictions){
      const neighbors=old.filter(p=>Math.hypot(p.x-px,p.y-py)<2.5);
      if(neighbors.length!==1)continue;
      const p=neighbors[0];
      if(!(p.surrounded||q.surrounded)||Math.min(q.count,p.count)*3<Math.max(q.count,p.count)||
        predictions.some(t=>t.q!==q&&Math.hypot(t.x-p.x,t.y-p.y)<2.5))continue;
      const patch=[];
      let sumA=0,sqA=0;
      for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){
        const a=read(frame,q.x+x,q.y+y);patch.push(a);sumA+=a;sqA+=a*a;
      }
      let corr=-1;
      for(const dy of [-.5,0,.5])for(const dx of [-.5,0,.5]){
        let sumB=0,sqB=0,cross=0,k=0;
        for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){
          const a=patch[k++],b=read(before,p.x+dx+x,p.y+dy+y);
          sumB+=b;sqB+=b*b;cross+=a*b;
        }
        corr=Math.max(corr,(cross-sumA*sumB/49)/Math.sqrt(Math.max(1,(sqA-sumA*sumA/49)*(sqB-sumB*sumB/49))));
      }
      if(corr>=.8)found.push(q);
    }
    if(found.length<3)return null;
    const box=bounds(poly),w=box.right-box.left+1,h=box.bottom-box.top+1,spread=bounds(found);
    const offsetX=Math.abs(found.reduce((s,p)=>s+p.x,0)/found.length-(box.left+box.right)/2)/w,spanX=(spread.right-spread.left)/w;
    if(offsetX>.12||spanX<.28||spread.bottom-spread.top<=h*.18)return null;
    return {count:found.length,centers:found.map(p=>({x:p.x,y:p.y})),offsetX,spanX,strong:true};
  }

  // A fitted burger can remain visible while a small object covers the hit disk.
  // Look for the same filling material on both sides of the projected disk.
  function coreSurface(input,frame,core,pose,radiusMm,time,previous){
    const radius=pose.scalePerSourceWidth*frame.w*radiusMm,angle=pose.rollDegrees*DEG;
    const c=Math.cos(angle),s=Math.sin(angle),cx=core.x*frame.w,cy=core.y*frame.h;
    const at=(x,y)=>{
      const u=Math.round(cx+radius*(x*c+y*s)),v=Math.round(cy+radius*(y*c-x*s));
      return u>=0&&u<frame.w&&v>=0&&v<frame.h?v*frame.w+u:-1;
    };
    const rgb=input.data,colors=[],old=previous&&time-previous.time<=250?previous:null;
    let supported=0,stable=0,brightCount=0,brightMatches=0,bilateralBright=0;
    for(const y of [-.75,-.375,0,.375,.75]){
      const sides=[-1,1].map(side=>[1.75,2.25,2.75].flatMap(dx=>
        [-.8,-.4,0,.4,.8].map(dy=>at(side*dx,y+dy))));
      for(const x of [-.75,-.375,0,.375,.75]){
        if(x*x+y*y>1)continue;
        const i=at(x,y);
        if(i<0)return null;
        const k=4*i,r=rgb[k],g=rgb[k+1],b=rgb[k+2],prior=old?.colors[colors.length];
        colors.push([r,g,b]);
        if(prior&&(r-prior[0])**2+(g-prior[1])**2+(b-prior[2])**2<40**2)stable++;
        const label=frame.labels[i];
        if(label!==YELLOW&&label!==DARK&&label!==GREEN)continue;
        const bright=label===YELLOW||label===GREEN;
        if(bright)brightCount++;
        const matches=sides.filter(side=>side.some(j=>j>=0&&frame.labels[j]===label&&
          (r-rgb[4*j])**2+(g-rgb[4*j+1])**2+(b-rgb[4*j+2])**2<40**2)).length;
        if(bright&&matches)brightMatches++;
        if(matches===2){supported++;if(bright)bilateralBright++;}
      }
    }
    // A cup at one shoulder need not hide the disk. When most of the
    // disk is coloured filling, verify that filling continues to a visible flank.
    if(brightCount>colors.length/2&&brightMatches>=2)return {colors,time};
    if(supported>=2){
      if(bilateralBright)return {colors,time};
      // Cola and the patty can both look dark. Look for a second layer in
      // the central strip before treating a broad dark patch as visible filling.
      const columns=[-.65,0,.65].filter(x=>[0,.5,1,1.5,2,2.5,3].filter(y=>{
        const label=frame.labels[at(x,y)];
        return label===GREEN||label===YELLOW||label===BUN;
      }).length>=2);
      if(columns.length>=2)return {colors,time};
      if(columns.length){
        // A narrow cheese or lettuce stripe can pass between the sparse samples.
        // Require a contiguous run inside the disk along the projected filling.
        const vertical=Math.abs(s)>Math.abs(c),u=vertical?cy:cx,v=vertical?cx:cy;
        for(let line=Math.ceil(v-radius);line<=v+radius;line++){
          const half=Math.sqrt(Math.max(0,radius*radius-(line-v)**2));
          let run=0;
          for(let pixel=Math.ceil(u-half);pixel<=u+half;pixel++){
            const x=vertical?line:pixel,y=vertical?pixel:line;
            const label=x>=0&&x<frame.w&&y>=0&&y<frame.h?frame.labels[y*frame.w+x]:NONE;
            run=label===YELLOW||label===GREEN?run+1:0;
            if(run>=Math.max(3,radius/2))return {colors,time};
          }
        }
      }
    }
    // Dark cola can match the last patty colour. Reuse that measurement
    // only when coloured filling in the current disk continues to a flank.
    return brightMatches>0&&old&&stable>colors.length/2?old:null;
  }
  function registeredCrease(frame,tracked,cx,w){
    const view={...frame,cap:{points:tracked,width:w}};
    const a=frontSeam(view,.045,.955,35,false,.22,3),z=frontSeam(view,.045,.955,35,false,.22,4);
    if(!a||!z)return null;
    const crease=a.points.filter(p=>z.points.some(q=>q.x===p.x&&Math.abs(q.edgeY-p.edgeY)<=1));
    if(crease.length<20||crease.at(-1).x-crease[0].x<w*.70||!coherentCrease(crease,cx,w))return null;
    return crease;
  }
  // Estimate a common motion streak from the second moments of pale islands.
  // Apply it to the earlier template. Matching and edge checks read raw current pixels.
  function motionBlurReference(input,gray,box){
    const frame=frameData(input),w=box.width,h=box.height,cx=box.x+w/2,cy=box.y+h/2;
    const shapes=[];
    for(const q of components(frame,WHITE,1)){
      if(q.count<4||q.count>w*h*.025||((q.x-cx)/(.48*w))**2+((q.y-cy)/(.48*h))**2>=1)continue;
      const d=Math.hypot(q.xx-q.yy,2*q.xy),length=Math.sqrt(12*d);
      if(length>=3)shapes.push({angle:Math.atan2(2*q.xy,q.xx-q.yy)/2,length,anisotropy:d/(q.xx+q.yy)});
    }
    if(shapes.length<3)return null;
    const angle=Math.atan2(shapes.reduce((s,q)=>s+Math.sin(2*q.angle),0),
      shapes.reduce((s,q)=>s+Math.cos(2*q.angle),0))/2;
    const aligned=shapes.filter(q=>Math.cos(2*(q.angle-angle))>.85).sort((a,b)=>a.length-b.length);
    if(aligned.length<3||aligned.length<shapes.length*.75||
      aligned.reduce((s,q)=>s+q.anisotropy,0)<.55*aligned.length)return null;
    const length=aligned[Math.floor(aligned.length/2)].length;
    if(length>w*.15)return null;
    const radius=Math.ceil(length/2),offsets=[],data=gray.data.slice();
    for(let i=-radius;i<=radius;i++){
      const t=i*length/(2*radius);
      offsets.push(Math.round(t*Math.cos(angle))+Math.round(t*Math.sin(angle))*gray.width);
    }
    const left=Math.max(radius,Math.floor(box.x-w*.5)),right=Math.min(gray.width-radius,Math.ceil(box.x+w*1.5));
    const top=Math.max(radius,Math.floor(box.y-w*.5)),bottom=Math.min(gray.height-radius,Math.ceil(box.y+h+w*.85));
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
      const k=y*gray.width+x;
      let sum=0;
      for(const offset of offsets)sum+=gray.data[k+offset];
      data[k]=sum/offsets.length;
    }
    return {width:gray.width,height:gray.height,data};
  }
  // Register observed sesame patches first, then use their motion only to
  // seed a fresh crown boundary. Check the rim and filling on this frame.
  function crownPatchInside(p,poly){
    // The matcher rounds its centre and reads an 11 by 11 patch.
    return poly.every((a,i)=>{
      const b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y;
      return dx*(p.y-a.y)-dy*(p.x-a.x)>=5.5*(Math.abs(dx)+Math.abs(dy));
    });
  }
  function interiorCrownPoints(gray,cap){
    const z=bounds(cap.points),box={x:z.left,y:z.top,width:z.right-z.left,height:z.bottom-z.top};
    return globalThis.BurgerVisual.features(gray,box).filter(p=>crownPatchInside(p,cap.points)&&
      cap.sesame.centers.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=5)).map(p=>({...p,region:'surface'}));
  }
  function registeredSesameOutline(input,before,flow,motionBlurred){
    const marks=flow.points.filter(p=>p.region==='sesame');
    if(marks.length<5||flow.points.filter(p=>p.region==='filling').length<3)return null;
    const m=flow.matrix,poly=before.cap.points.map(p=>({x:m.a*p.x-m.b*p.y+m.x,y:m.b*p.x+m.a*p.y+m.y}));
    const b=bounds(poly),box={x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top};
    const found=traceCrown(input,{box,contour:poly},poly);
    if(!found||found.refinement.supportedFraction<.83)return null;
    const frame=frameData(input),edges=bounds(found.contour),w=found.box.width,cx=found.box.x+w/2;
    const surface=flow.points.filter(p=>p.region==='surface'&&crownPatchInside(p,found.contour));
    const points=surface.length>=3?marks.concat(surface):marks;
    const spread=bounds(points),mean=points.reduce((sum,q)=>sum+q.x,0)/points.length;
    if(spread.right-spread.left<w*.28||spread.bottom-spread.top<found.box.height*.18||Math.abs(cx-mean)>w*.12)return null;
    const sesame=sesameEvidence(frame,edges,components(frame,WHITE,1));
    const pairs=sesame.centers.filter(q=>marks.filter(p=>Math.hypot(p.x-q.x,p.y-q.y)<2.5).length===1);
    // The longer unfiltered streaks can shrink the absolute-white mask to
    // the central marks. Verify a distributed set of matched raw-image patches
    // as well as three distinct white components and the current crease.
    const unique=pairs.filter(q=>marks.some(p=>Math.hypot(p.x-q.x,p.y-q.y)<2.5&&
      pairs.every(r=>r===q||Math.hypot(p.x-r.x,p.y-r.y)>=2.5)));
    if((motionBlurred?marks.length<7:!sesame.strong)||unique.length<3||!sideBoundaryEvidence(input,frame,found.contour,edges).supported||
      !confirmCap(input,found.box).supported||!registeredCrease(frame,found.contour,cx,w))return null;
    return {...found,sesame,hasFilling:true,method:'registered-sesame-outline'};
  }
  // At a shallow view the lower edge of the bun meets the cheese along a
  // nearly circular rim. Match its observed bow before looking for the crest.
  // The rigid model places a search contour. Only current image edges may pass.
  function creaseRegistration(input,observed,tracked,before){
    const frame=frameData(input),b=bounds(tracked),w=b.right-b.left,cx=(b.right+b.left)/2;
    if(w<48||w>frame.w*.30||b.bottom-b.top>w*.72)return null;
    let motion;
    if(observed){
      if(observed.method!=='colour-cap')return null;
      // One flank disappears from the colour proposal while the other remains
      // at its texture-registered position. Check the crease before using it.
      const left=observed.box.x-b.left,right=b.right-observed.box.x-observed.box.width;
      if(Math.max(left,right)<.04*w||Math.abs(Math.min(left,right))>.035*w)return null;
    }else{
      motion=differentialRimMotion(input,tracked,before);
      if(!motion)return null;
    }
    const crease=registeredCrease(frame,tracked,cx,w);
    if(!crease)return null;
    const bottom=crease.filter(q=>Math.abs(q.x-cx)<.14*w).map(q=>q.edgeY).sort((a,b)=>a-b);
    if(bottom.length<5)return null;
    const y0=bottom[bottom.length>>1];
    if(cx<w*.65+5||cx+w*.65+5>=frame.w||y0<w*.82+5||y0+8>=frame.h)return null;
    const rgb=input.data,W=frame.w;
    const at=(x,y)=>4*(Math.round(y)*W+Math.round(x));
    const edge=(profile,mid,span,base)=>{
      const sum=[0,0,0,0],count=[0,0,0,0];
      for(const q of profile.stations){
        const x=mid+q.x*span,y=base+q.y*span,nx=3*q.nx,ny=3*q.ny;
        const p=at(x-nx,y-ny),r=at(x+nx,y+ny),f=at(x-2*nx,y-2*ny),g=at(x+2*nx,y+2*ny);
        let sq=0,dot=0;
        for(let c=0;c<3;c++){const d=rgb[r+c]-rgb[p+c];sq+=d*d;dot+=d*(rgb[g+c]-rgb[f+c]);}
        const len=Math.sqrt(sq);
        sum[q.side]+=clamp(Math.min(len,dot/Math.max(1,len))/65,0,1.35);count[q.side]++;
      }
      const [top,left,right,lip]=sum.map((v,i)=>v/Math.max(1,count[i]));
      return .38*Math.min(left,right)+.29*top+.09*(left+right)+.15*lip;
    };
    let best=null;
    for(let angle=6;angle<=30;angle+=2)for(const roll of [-4,0,4]){
      const profile=flankProfile(angle,roll),rim=profile.rim;
      if(rim.length<5)continue;
      for(const scale of [.96,1,1.04,1.08])for(const shift of [-.035,0,.035]){
        const mid=cx+w*shift,span=w*scale,ys=[];
        let first=Infinity,last=-Infinity,i=1;
        for(const q of crease){
          const x=(q.x-mid)/span;
          if(Math.abs(x)>.42||x<rim[0].x||x>rim.at(-1).x)continue;
          while(rim[i].x<x)i++;
          const a=rim[i-1],b=rim[i];
          ys.push(q.edgeY-span*(a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x)));
          if(ys.length===1)first=x;last=x;
        }
        if(ys.length<15||last-first<.65)continue;
        const sorted=ys.slice().sort((a,b)=>a-b),base=sorted[sorted.length>>1];
        const rmse=Math.sqrt(ys.reduce((s,y)=>s+Math.min(4,(y-base)**2),0)/ys.length);
        if(rmse>.85)continue;
        const contrast=edge(profile,mid,span,base),score=contrast-rmse;
        if(!best||score>best.score)best={profile,mid,span,base,rmse,contrast,score,angle,roll};
      }
    }
    if(!best||best.contrast<.48)return null;
    const {profile,mid,span,base}=best,search=profile.poly.map(q=>({x:mid+q.x*span,y:base+q.y*span}));
    const bb=bounds(search),box={x:bb.left,y:bb.top,width:bb.right-bb.left,height:bb.bottom-bb.top};
    if(observed&&(bb.top-observed.box.y<w*.055||Math.abs(bb.bottom-observed.box.y-observed.box.height)>w*.10))return null;
    const trace=traceCrown(input,{box,contour:search},search);
    if(!trace||trace.refinement.supportedFraction<.83)return null;
    let candidate;
    if(observed){
      candidate=localBoundary(input,frame,trace);
      const other=localBoundary(input,frame,{...trace,box,contour:search});
      if(!candidate||!other)return null;
      const u=candidate.box,v=other.box;
      if(Math.max(Math.abs(u.x-v.x),Math.abs(u.y-v.y),Math.abs(u.x+u.width-v.x-v.width),
        Math.abs(u.y+u.height-v.y-v.height))>w*.04)return null;
    }else{
      candidate=sideBoundaryEvidence(input,frame,trace.contour,bounds(trace.contour)).supported?
        trace:measureNormalEdges(input,frame,trace);
      if(!candidate)return null;
    }
    const actual=bounds(candidate.contour);
    if(Math.abs(actual.top-bb.top)>.075*w||Math.abs(actual.bottom-base)>.045*w||
      Math.abs(candidate.box.width-span)>.09*w)return null;
    const sesame=observed?sesameEvidence(frame,actual,components(frame,WHITE,1)):
      pairedSurfaceMarks(frame,before,candidate.contour,motion.fg);
    if(!sesame?.strong||sesame.offsetX>.12||sesame.spanX<.28||!confirmCap(input,candidate.box).supported)return null;
    return {...candidate,sesame,hasFilling:true,method:observed?'crease-registered-outline':'current-crease-and-sesame-pairs'};
  }


  function upperRim(input,cap){
    const points=cap.points,b=bounds(points),w=b.right-b.left,h=b.bottom-b.top;
    if(!cap.sesame?.strong||w<40||h<w*.92)return null;
    const at=(x,y)=>input.data[(y*input.width+x)*4];
    const samples=[],radius=Math.max(1,Math.round(w*.018));
    // Start inside the dome. If an orange tray rail crosses behind it, the
    // first supported brightness transition belongs to the contiguous bun.
    for(let i=0;i<=24;i++){
      const x=Math.round(b.left+w*(.13+i*.74/24));let top=Infinity;
      for(let j=0;j<points.length;j++){
        const a=points[j],q=points[(j+1)%points.length];
        if(Math.min(a.x,q.x)<=x&&x<Math.max(a.x,q.x))
          top=Math.min(top,a.y+(x-a.x)*(q.y-a.y)/(q.x-a.x));
      }
      if(!Number.isFinite(top)||top<5||top+w*.26>=input.height)continue;
      const ref=[.13,.16,.19,.22,.25].map(d=>at(x,Math.round(top+d*w))).sort((a,b)=>a-b)[2];
      let edge=null;
      for(let y=Math.floor(top+w*.13);y>=Math.max(radius+1,Math.ceil(top-w*.045));y--){
        const outside=at(x,y-radius),inside=at(x,y+radius);
        if(outside>ref*.84||inside<ref*.81||inside-outside<Math.max(15,ref*.085))continue;
        // Refine to the maximum local rise at this same interface.
        let best=0,pos=y;
        for(let k=y-radius;k<=y+radius;k++){
          const rise=at(x,k+1)-at(x,k-1);
          if(rise>best){best=rise;pos=k;}
        }
        edge={x,y:pos,shift:pos-top};break;
      }
      if(edge)samples.push(edge);
    }
    if(samples.length<14||samples.at(-1).x-samples[0].x<.57*w)return null;
    const good=samples.filter((q,i)=>i===0||i===samples.length-1||
      Math.abs(q.y-(samples[i-1].y+(samples[i+1].y-samples[i-1].y)*
        (q.x-samples[i-1].x)/(samples[i+1].x-samples[i-1].x)))<w*.035);
    if(good.length<14||good.some((q,i)=>i&&q.x-good[i-1].x>w*.18))return null;
    const other=points.filter(q=>q.x<good[0].x||q.x>good.at(-1).x||q.y>b.top+h*.5);
    const measured=hull([...other,...good.map(q=>({x:q.x,y:q.y}))]),box=bounds(measured);
    if(box.top-b.top<Math.max(1.5,.018*w))return null;
    return {...cap,points:measured,width:box.right-box.left};
  }

  function corroboratedProfile(input,observation){
    const candidate=profileOutline(input,observation);
    if(candidate===observation)return observation;
    const a=observation.box,b=candidate.box;
    if(Math.abs(a.y-b.y)>.75||Math.abs(a.y+a.height-b.y-b.height)>.75)return observation;
    const sides=[b.x-a.x,b.x+b.width-a.x-a.width];
    const bilateral=sides.every(dx=>Math.abs(dx)<.5);
    if(bilateral){
      // Opposite subpixel shifts can resolve nearly a full pixel of diameter.
      // Both flanks must repeat within a quarter pixel at a second aperture.
      if(sides[0]*sides[1]>=0||Math.abs(b.width-a.width)<.75||Math.round(a.width*.072)<6)return observation;
      const check=profileOutline(input,observation,2).box;
      if(Math.abs(check.x-b.x)>.25||Math.abs(check.x+check.width-b.x-b.width)>.25)return observation;
    }
    const confirms=box=>{
      const edges=[box.x-a.x,box.x+box.width-a.x-a.width];
      return sides.every((dx,i)=>!bilateral&&Math.abs(dx)<.5||Math.abs(dx-edges[i])<Math.abs(edges[i]));
    };
    if(!bilateral){
      const chord=chordOutline(input,a);
      if(!chord||!confirms(chord.box))return observation;
    }
    // The scanline and the midpoint can both follow a blurred band.
    // Check which flank the neighbouring raw RGB gradients support.
    const normal=measureNormalEdges(input,frameData(input),observation);
    return normal&&confirms(normal.box)?{...candidate,measuredFlanks:true}:observation;
  }
  function changingInclination(frame,anchor){
    const previous=anchor.frame.cap,current=frame.cap;
    if(!current?.sesame?.strong||!previous?.sesame?.strong)return null;
    const normalize=cap=>{
      const b=bounds(cap.points),w=b.right-b.left,h=b.bottom-b.top,cx=(b.left+b.right)/2,cy=(b.top+b.bottom)/2;
      return {aspect:h/w,spots:(cap.sesame.centers??[]).map(p=>({x:(p.x-cx)/w,y:(p.y-cy)/w}))};
    };
    const a=normalize(previous),b=normalize(current);
    if(a.spots.length<9||b.spots.length<9||Math.abs(Math.log(b.aspect/a.aspect))<.018)return null;
    const nearest=(p,list)=>{
      let best=null,dist=.052**2;
      for(const q of list){const d=(p.x-q.x)**2+(p.y-q.y)**2;if(d<dist){best=q;dist=d;}}
      return best;
    };
    const pairs=[];
    for(const p of a.spots){const q=nearest(p,b.spots);if(q&&nearest(q,a.spots)===p)pairs.push([p,q]);}
    if(pairs.length<9)return null;
    // Two sets of well-separated spot pairs measure stretch across and along
    // the cap. Translation cancels; their ratio also cancels image zoom.
    const lengths=[[],[]],roll=anchor.raw.roll*DEG,c=Math.cos(roll),s=Math.sin(roll);
    const diff=(p,q)=>[c*(p.x-q.x)-s*(p.y-q.y),s*(p.x-q.x)+c*(p.y-q.y)];
    for(let i=0;i<pairs.length;i++)for(let j=0;j<i;j++){
      const u=diff(pairs[i][0],pairs[j][0]),v=diff(pairs[i][1],pairs[j][1]);
      for(const k of [0,1])if(Math.abs(u[k])>.18&&Math.abs(u[1-k])<.32*Math.abs(u[k]))
        lengths[k].push(v[k]/u[k]);
    }
    if(lengths.some(z=>z.length<6))return null;
    const med=z=>z.sort((x,y)=>x-y)[Math.floor(z.length/2)];
    const stretch=med(lengths[1])/med(lengths[0]),aspect=b.aspect/a.aspect;
    if(!(stretch>.8&&stretch<1.2)||Math.abs(stretch-1)<.018||(stretch-1)*(aspect-1)<=0)return null;
    const e=templateOf(anchor.raw).elevation;
    if(e<30||e>76)return null;
    // Around the crown centre, spacing along the table plane foreshortens
    // with sin(elevation). Use only the change supported by the rim as well.
    const change=Math.sign(stretch-1)*Math.min(Math.abs(stretch-1),Math.abs(aspect-1));
    const predicted=Math.asin(clamp(Math.sin(e*DEG)*(1+change),0,1))/DEG;
    const delta=Math.round(clamp(predicted-e,-10,10));
    return Math.abs(delta)>=2?{...anchor.raw,t:(e+delta+70)/10,template:fineTemplate(e+delta)}:null;
  }

  function supportedTableFit(frame,p,e,locked){
    const layered=e.greens>=2&&e.darks>=2;
    const top=frame.cap.sesame.strong&&templateOf(p).elevation>=50&&e.upper>.68&&e.contourError<.035;
    return e.score>.65&&e.contourError<.055&&supportsContour(e,locked)&&e.capHeightError<.065&&e.upper>.45&&(layered||top);
  }
  function refine(frame,start,previous,dtMs,stable=null,visited=null) {
    let p=alignCap(frame,frame.table&&!frame.attitude?.used?
      {...start,t:Math.round(start.t),template:undefined}:{...start}),e=evaluate(frame,p);
    let score=merit(p,e,previous,dtMs);
    // Keep supported candidates visited during search. A later optimum in
    // layer alignment must not erase an earlier valid silhouette and turn
    // the entire search into "no model" when the final gates reject it.
    let supported=null;
    const remember=(q,qe)=>{
      if(!frame.table||!supportedTableFit(frame,q,qe,!!stable))return;
      if(visited)visited.set(templateOf(q).elevation+','+q.roll,{...q,e:qe});
      const m=merit(q,qe,previous,dtMs);
      if(!supported||m>supported.merit)supported={...q,e:qe,merit:m};
    };
    remember(p,e);
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
          remember(q,qe);
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
          remember(q,qe);
          if(qs>bestScore){best=q;bestEvidence=qe;bestScore=qs;}
        }
        p=best;e=bestEvidence;score=bestScore;
      }
    }
    // Preserve the fine search's stable-pose preference when its final fit is
    // valid. The remembered candidate is only a fallback for a failed fit.
    const result={...p,e,merit:merit(p,e,previous,dtMs)};
    return frame.table&&!supportedTableFit(frame,p,e,!!stable)?supported??result:result;
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
  // Compare measured movement of the two visible bands against an independent
  // patch match inside the filling. A background attachment can move the cap ROI.
  function fillingShift(before,now){
    const a=before?.layers,b=now.layers,vision=globalThis.BurgerVisual;
    if(!vision?.motion||!a||!b||!before.gray||Math.abs(Math.log(a.width/b.width))>=.1)return null;
    const offsets=[];
    for(const name of ['dark','green']){
      const p=a.sides.find(q=>q.band===name),q=b.sides.find(q=>q.band===name);
      if(!p||!q)return null;
      offsets.push({x:(q.left+q.right-p.left-p.right)/2,y:b[name].y-a[name].y});
    }
    const [u,v]=offsets,limit=b.width*.07;
    if(Math.hypot(u.x-v.x,u.y-v.y)>limit)return null;
    const left=Math.max(...a.sides.map(q=>q.left)),right=Math.min(...a.sides.map(q=>q.right));
    const box={x:left,y:a.dark.top,width:right-left,height:a.green.bottom-a.dark.top};
    if(box.width<a.width*.5||box.height<12)return null;
    const previous={data:before.gray,width:before.w,height:before.h},current={data:now.gray,width:now.w,height:now.h};
    const flow=vision.motion(previous,current,vision.features(previous,box),box);
    if(!flow||flow.inliers<7||Math.abs(Math.log(flow.scale))>=.1)return null;
    const x=left+box.width/2,y=box.y+box.height/2,m=flow.matrix;
    const dx=m.a*x-m.b*y+m.x-x,dy=m.b*x+m.a*y+m.y-y;
    if(offsets.some(q=>Math.hypot(dx-q.x,dy-q.y)>limit))return null;
    return {x:dx,y:dy};
  }
  class Tracker {
    constructor({mode='handheld'}={}){templates??=buildTemplates();this.mode=mode;this.reset();}
    reset(){this.gameGuard=null;this.last=null;this.lock=null;this.previous=null;this.lastTime=-Infinity;this.selection=null;this.streak=0;this.stableSince=null;this.frameAttitude=null;}
    // Keep the game's last confirmed measurement separate from tentative solver fits.
    confirmGameFit(timestampMs){
      if(this.last?.time===timestampMs)
        this.gameGuard={raw:this.last.raw,time:timestampMs,frame:{cap:this.last.frame.cap,coreSurface:this.last.frame.coreSurface}};
    }
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
    fit(input,timestampMs,{temporal=true,registeredToPending=false,recheckOcclusion=false,tableAttitude=null,capObservation:observedCap=undefined,contourRecovery=false,imageRoll=null,panSteps=[]}={}) {
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
      // Keep acquisition, optical-flow reseeding and its ROI independent of the
      // side edge that was remeasured for projection. Prefer corroborated chords.
      if(frame.cap&&observedCap?.sideEdges?.source===observedCap?.contour&&observedCap?.sideEdges){
        frame.cap={...frame.cap,points:observedCap.sideEdges.contour,width:observedCap.sideEdges.width};
      }
      if(frame.table&&!frame.cap)return this.missing(timestampMs,'no-complete-cap',{frame});
      // The photometric lip belongs to model fitting. Changing the measured
      // 3-D silhouette must not resize the visual tracker's search window.
      if(frame.cap){
        const b=bounds(frame.cap.points),z={x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top};
        const observed={contour:frame.cap.points,box:z};
        let aligned=withFrontEdge(frame,observed);
        // When the seam is blurred, measure the flanks at the midpoint of
        // their local foreground-to-background transition as well.
        if(aligned.measuredDistant&&aligned.wideCrease)aligned=profileOutline(input,aligned);
        else if(aligned!==observed&&observedCap?.method==='colour-cap'&&frame.cap.sesame?.strong)
          aligned=corroboratedProfile(input,aligned);
        if(aligned!==observed)frame.cap={...frame.cap,points:aligned.contour,width:aligned.box.width,measuredDistant:aligned.measuredDistant,measuredFlanks:aligned.measuredFlanks};
      }
      // A tray rail can prolong the upper contour as the camera tips down.
      // Use the current brightness edge only when the sesame spacing also
      // shows foreshortening relative to a recently confirmed steep view.
      if(frame.cap&&this.gameGuard&&timestampMs-this.gameGuard.time<=100&&
        templateOf(this.gameGuard.raw).elevation>=55){
        const rim=upperRim(input,frame.cap);
        const motion=rim&&changingInclination({...frame,cap:rim},this.gameGuard);
        if(motion&&motion.t<this.gameGuard.raw.t)frame.cap={...rim,measuredUpperRim:true};
      }
      frame.layers=visibleLayers(frame);
      // The bend of the front lip depends on its projected diameter.
      // Use it for ranking only when the raw flank profiles resolved that diameter.
      if(frame.cap?.measuredFlanks)frame.bow=measuredBow(frame);
      frame.skirt=cheeseArc(frame);
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
      const moving=frame.table&&!frame.attitude?.used&&this.lock&&this.gameGuard&&
        timestampMs-this.gameGuard.time<=200?changingInclination(frame,this.gameGuard):null;
      const visited=frame.table&&!frame.attitude?.used?new Map():null;
      const fitted=starts.map(p=>refine(frame,p,prior,dtMs,moving??this.lock?.raw,visited)).sort((a,b)=>b.merit-a.merit);
      // Refinement rounds its seeds to 10 degrees and can lose the exact last
      // orientation. Re-test that orientation on THIS contour/material evidence.
      // Translation and scale still follow the current cap immediately.
      if(frame.table&&!frame.attitude?.used&&this.lock){
        const p=alignCap(frame,this.lock.raw),e=evaluate(frame,p);
        fitted.push({...p,e,merit:merit(p,e,prior,dtMs)});
      }
      if(moving){
        const p=alignCap(frame,moving),e=evaluate(frame,p);
        fitted.push({...p,e,merit:merit(p,e,prior,dtMs)});
      }
      const isSupported=q=>{
        if(frame.table){
          // Keep the existing contour gates after fine fitting; a closer angle
          // must not rescue an incomplete silhouette or free its translation.
          return supportedTableFit(frame,q,q.e,!!this.lock||contourRecovery);
        }
        const freshTop=hypotheses.some(p=>p.freshTop&&Math.hypot(p.x-q.x,p.y-q.y)<q.scale*8&&Math.abs(Math.log(p.scale/q.scale))<.3);
        // A small upside-down model on one green leaf can score highly. Require
        // both green and dark filling evidence, or fresh sesame-cap evidence.
        const layered=q.e.greens>=3&&q.e.darks>=Math.max(3,q.e.fillSamples*.06)&&q.e.filling>.38;
        return q.e.score>.59&&q.e.upper>.35&&q.e.buns>=3&&(layered||(freshTop&&templateOf(q).elevation>=60&&q.e.upper>.68));
      };
      // The horizontal registration is the primary measurement. In a
      // rounded view, also test a full-perimeter registration when every
      // horizontal proposal fails the unchanged geometric and material gates.
      if(frame.table&&!frame.attitude?.used&&frame.cap.sesame?.strong&&!fitted.some(isSupported)){
        const b=bounds(frame.cap.points);
        if(b.bottom-b.top>frame.cap.width*.93){
          const rolls=[...new Set([this.lock?.raw.roll??0,-30,-15,0,15,30])];
          const angles=[...new Set([templateOf(this.lock?.raw??{t:14}).elevation,...[60,65,70,75,80,85,90]])];
          for(const angle of angles)for(const roll of rolls){
            if(angle<60)continue;
            const q={t:(angle+70)/10,template:fineTemplate(angle),roll};
            const initial=alignCap(frame,q),p=alignRoundCap(frame,q,initial);
            if(p===initial)continue;
            const e=evaluate(frame,p);
            e.registration='full-perimeter';
            fitted.push({...p,e,merit:merit(p,e,prior,dtMs)});
          }
        }
      }
      const visuallySupported=fitted.filter(isSupported);
      // Tentative observations also have to agree with the preceding frame.
      // If they fail before a stable lock exists, restart acquisition without
      // holding them. Otherwise the third frame could still suddenly halve.
      let guard=this.lock??this.last;
      // A provisional fit on an inflated tray edge must not veto a return to the
      // confirmed physical width. Use the usual guard for a genuinely new view.
      if(this.gameGuard&&guard&&guard.time>this.gameGuard.time&&timestampMs-this.gameGuard.time<=HOLD_MS&&
        frame.cap&&guard.frame.cap&&this.gameGuard.frame.cap){
        const width=frame.cap.width;
        if(Math.abs(Math.log(width/guard.frame.cap.width))>.1&&
          Math.abs(Math.log(width/this.gameGuard.frame.cap.width))<.1)guard=this.gameGuard;
      }
      let guardPose=guard?.raw;
      if(guard?.frame.cap&&frame.cap&&panSteps.length){
        let stamp=guard.time,dx=0,dy=0;
        for(const step of panSteps){
          if(step.from!==stamp)continue;
          dx+=step.x;dy+=step.y;stamp=step.to;
        }
        const a=bounds(guard.frame.cap.points),b=bounds(frame.cap.points),w=b.right-b.left;
        const observedX=(b.left+b.right-a.left-a.right)/2,observedY=(b.top+b.bottom-a.top-a.bottom)/2;
        // Both the measured boundaries and the independent image features must
        // account for the pan. The original position and scale limits now apply
        // in that measured frame of reference; scale remains independently tested.
        if(stamp===timestampMs&&Math.hypot(observedX-dx,observedY-dy)<w*.07&&
          Math.abs(Math.log(w/(a.right-a.left)))<.1)
          guardPose={...guardPose,x:guardPose.x+dx,y:guardPose.y+dy};
      }
      // A repaired outline may move its top even when the whole toy merely
      // translates. Test the old position/scale limits in the measured
      // filling frame only if all current fits failed the ordinary continuity test.
      if(observedCap?.method==='seam-seeded-current-outline'&&guard&&guardPose===guard.raw&&
        guard.time===this.gameGuard?.time&&timestampMs-guard.time<=250&&panSteps.length&&visuallySupported.length&&
        !visuallySupported.some(q=>continuity(q,guardPose,timestampMs-guard.time).allowed)){
        const move=fillingShift(guard.frame,frame);
        if(move)guardPose={...guard.raw,x:guard.raw.x+move.x,y:guard.raw.y+move.y};
      }
      const supportedFits=visuallySupported.filter(p=>!guard||continuity(p,guardPose,timestampMs-guard.time).allowed);
      // Fresh image fits are computed independently above. Only resolve close
      // alternatives against the last stable pose; never rescue a failed fit.
      // Costs are bounded, so clearly better current evidence can change view.
      const stableReference=frame.table&&!frame.attitude?.used?moving??this.lock?.raw:null;
      const selectionMerit=p=>p.e.rankingScore-(stableReference?
        .035*Math.min(2,Math.abs(p.t-stableReference.t))+
        .01*Math.min(2,Math.abs(wrap(p.roll-stableReference.roll))/15):0);
      // At steep views the crown silhouette can support several rolls. A
      // verified texture rotation supplies the observed relative roll for this
      // single frame pair. Image and projection use opposite angle signs.
      const expectedRoll=imageRoll&&this.last?.time===imageRoll.fromTime&&!frame.attitude?.used?
        this.last.raw.roll-imageRoll.degrees:null;
      const imageMerit=p=>selectionMerit(p)-(expectedRoll===null?0:
        .008*Math.min(1,Math.abs(wrap(p.roll-expectedRoll))/12));
      supportedFits.sort((a,b)=>imageMerit(b)-imageMerit(a));
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
      // A contour registered from the preceding pending box reuses that
      // observation. It can establish the current fit but cannot start the
      // sequence of independent observations that locks a future orientation.
      const steady=best.e.score>=.63&&!placementUncertain&&!registeredToPending;
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
      // Refinement can visit two supported views on opposite sides of the
      // bun/centre boundary, then return just the higher-scoring one.
      // Reuse those observations when testing agreement about the core.
      if(visited&&!capOnly){
        const cutoff=selectionMerit(best)-.045;
        for(const p of visited.values()){
          if(selectionMerit(p)>cutoff&&isSupported(p)&&
            (!guard||continuity(p,guardPose,timestampMs-guard.time).allowed))plausibleFits.push(p);
        }
      }
      // The temporal preference can keep refinement on the exposed side.
      // Test the nearest blocked orientation in the same five-degree fine
      // search range against current pixels before granting a shot.
      const regionAPI=globalThis.BurgerAttackRegion,chosen=templateOf(best).elevation;
      if(recheckOcclusion&&visited&&!capOnly&&regionAPI?.atElevation&&
        plausibleFits.every(q=>regionAPI.atElevation(templateOf(q).elevation).status==='exposed')&&
        regionAPI.atElevation(Math.min(90,chosen+5)).status==='blocked'){
        let angle=Math.ceil(chosen);
        while(angle<90&&regionAPI.atElevation(angle).status!=='blocked')angle++;
        for(const roll of new Set([best.roll,best.roll-3,best.roll+3,0])){
          const q=alignCap(frame,{...best,roll,t:(angle+70)/10,template:fineTemplate(angle)});
          q.e=evaluate(frame,q);
          if(best.e.rankingScore-q.e.rankingScore<.045&&isSupported(q)&&
            (!guard||continuity(q,guardPose,timestampMs-guard.time).allowed)){
            plausibleFits.push(q);break;
          }
        }
      }
      const possibleAngles=frame.table?plausibleFits.map(p=>templateOf(p).elevation):[];
      const angleRange=possibleAngles.length?[Math.min(...possibleAngles),Math.max(...possibleAngles)]:null;
      const regionEvidence=regionAPI?.evaluate(plausibleFits.map(p=>templateOf(p).elevation));
      const core=regionAPI?regionAPI.coreCenter(pose,frame.w,frame.h):pose.center;
      let attackability=placementUncertain||capOnly&&regionEvidence?.status==='exposed'?'unknown':regionEvidence?.status??'unknown';
      if(frame.table&&attackability==='exposed'){
        frame.coreSurface=coreSurface(input,frame,core,pose,regionAPI.RULE.radiusMm,timestampMs,this.gameGuard?.frame.coreSurface);
        if(!frame.coreSurface)attackability='unknown';
      }
      return {...empty(timestampMs),evidenceTimestampMs:timestampMs,tracking:'found',targetFound:true,
        coreCenter:core,coreBounds:{x:core.x-radius/frame.w,y:core.y-radius/frame.h,width:2*radius/frame.w,height:2*radius/frame.h},
        pose,displayPose:display,poseStatus:ambiguous?'ambiguous':'approximate',reason:ambiguous?'competing-poses':'current-model-fit',
        displayStatus:'measured',displayAgeMs:0,displayOpacity:1,
        // Only current measurements get a region. A frozen display marker is
        // not a fresh target and missing() clears this preview immediately.
        attackRegion:regionAPI?{center:{...core},radiusMm:regionAPI.RULE.radiusMm,
          radiusX:best.scale*regionAPI.RULE.radiusMm/frame.w,radiusY:best.scale*regionAPI.RULE.radiusMm/frame.h}:null,
        modelAttackability:attackability,
        modelFillingFractionRange:regionEvidence?.fillingFractionRange??null,
        bunContour:contour,measuredUpperRim:!!frame.cap?.measuredUpperRim,measuredDistant:!!frame.cap?.measuredDistant,elevationRangeDegrees:angleRange,
        viewClass:angleRange?(angleRange[0]>=30?'oblique-top':angleRange[1]<=10?'side':'unknown'):null,
        // Geometric self-occlusion only. Fingers are absent from the mesh.
        modelCenterSurface:regionEvidence?.centerSurface??'unknown',
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
  function sesameSeed(input,frame,box){
    const {x,y,width:w,height:h}=box;
    const whites=components(frame,WHITE,1),d=Math.max(2,Math.round(w*.05));
    const spots=whites.filter(q=>{
      if(q.x<x||q.x>x+w||q.y<y||q.y>y+h||q.count<2||q.count>w*h*.025)return false;
      const k=Math.round(q.y)*frame.w+Math.round(q.x);
      return [k-d,k+d,k-d*frame.w,k+d*frame.w].filter(j=>frame.labels[j]===BUN).length>=3;
    });
    if(spots.length<5)return null;
    const xs=spots.map(p=>p.x).sort((a,b)=>a-b),ys=spots.map(p=>p.y).sort((a,b)=>a-b);
    const q=(a,f)=>a[Math.round((a.length-1)*f)];
    if(q(xs,.9)-q(xs,.1)<w*.26)return null;
    const top=q(ys,.12)-w*.075,bottom=q(ys,.88)+w*.26;
    return {x:q(xs,.5)-w*.5,y:top,width:w,height:bottom-top};
  }
  function detectCap(input,recoveryBox=null){
    const frame=frameData(input),cap=capObservation(input,frame,null,recoveryBox);
    if(!cap&&!recoveryBox)return null;
    const b=cap?bounds(cap.points):null;
    const box=b?{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top}:recoveryBox;
    const observation={box,contour:cap?.points??[],sesame:cap?.sesame,hasFilling:!!cap?.green,
      method:cap?.method??'colour-cap',boundary:cap?.edge??null};
    const seed=sesameSeed(input,frame,box);
    // A compact seed cluster well below the top of the orange component
    // suggests that a second object is attached above the crown. Use those
    // spots only to initialize a new search for CURRENT image edges.
    if(seed&&(!cap||seed.y>box.y+box.width*.09)){
      const candidate=traceCrown(input,{...observation,box:seed,contour:[{x:seed.x,y:seed.y}]});
      if(candidate){
        const {x,y,width,height}=candidate.box,b={left:x,right:x+width,top:y,bottom:y+height};
        const edge=sideBoundaryEvidence(input,frame,candidate.contour,b);
        const sesame=sesameEvidence(frame,b,components(frame,WHITE,1));
        if(edge.supported&&sesame.strong&&confirmCap(input,candidate.box).supported&&
          (!recoveryBox||nearTrackedCap(b,recoveryBox)))
          return {...candidate,sesame,hasFilling:true,boundary:edge,method:'sesame-edge'};
      }
    }
    return cap?traceCrown(input,observation)??observation:null;
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
  globalThis.BurgerPose={Tracker,empty,geometry,classify,prepareFrame,HOLD_MS,detectCap,motionBlurReference,interiorCrownPoints,registeredSesameOutline,refineCap,verifyChords,creaseRegistration,measuredFlanks,findCurrentOutline,seededLayerOutline,findLayeredOutline,seamSearch,shallowAttachment,confirmCap,hasFrontCrease,supportsContour,
    recoverCap:(input,box)=>box?detectCap(input,box):null,
    observeLayers:(input,contour)=>visibleLayers({...frameData(input),cap:contour?{points:contour}:null})};
})();

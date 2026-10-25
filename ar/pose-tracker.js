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
  const merit=(p,e,reference,dtMs)=>e.score-continuity(p,reference,dtMs).cost-
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
  function edgeDistance(p,polygon) {
    let best=Infinity;
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dy=b.y-a.y;
      const t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
      best=Math.min(best,Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy));
    }
    return best;
  }
  function capObservation(input,frame,selection) {
    // Red-orange crown proposal, separate from broad BUN material scoring.
    // This empirical colour test can fail on reddish wood, shadows or glare.
    // Convex completion bridges sesame holes; it is an observed candidate,
    // not a model silhouette or a guaranteed complete segmentation.
    const data=input.data,greens=components(frame,GREEN,5);
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
      if(!green)continue;
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
      const bridge=outline.some((p,i)=>{
        const next=outline[(i+1)%outline.length];
        return Math.hypot(p.x-next.x,p.y-next.y)>w*.45&&(p.y+next.y)/2<q.bottom-h*.2;
      });
      if(bridge)continue;
      candidates.push({points:outline,...q,width:w,green,redRatio});
    }
    candidates.sort((a,b)=>b.count-a.count);
    // Do not choose between two similarly large orange/green objects.
    if(candidates.length>1&&candidates[1].count>candidates[0].count*.7)return null;
    if(candidates.length)return candidates[0];
    }
    return null;
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
  function buildTemplates() {
    // Rasterize nearest surfaces with a tiny software z-buffer. Labels and
    // silhouettes come from the SAME mesh rendered by the review/overlay page.
    const mesh=modelAPI.mesh(geometry),N=65,step=.55;
    const output=[];
    for(let elevation=-70;elevation<=90;elevation+=10) {
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
      const upperIds=new Set(mesh.faces.filter(f=>f.part==='upper').flatMap(f=>f.ids));
      output.push({elevation,samples,groups,anchors,upperHull:hull([...upperIds].map(i=>({x:points[i].x,y:points[i].y}))),centerMaterial:material[32*N+32]===2?'filling':'bun'});
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
  function evaluate(frame,p) {
    const template=templates[p.t],c=Math.cos(p.roll*DEG),s=Math.sin(p.roll*DEG),sum=[0,0,0,0],count=[0,0,0,0];
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
    let contourError=null,contourMaxError=null;
    score=score/total-(count[1]<3?.4:0);
    if(frame.cap){
      const projected=template.upperHull.map(q=>({x:p.x+p.scale*(q.x*c+q.y*s),y:p.y+p.scale*(-q.x*s+q.y*c)}));
      const observed=frame.cap.points;
      const a=observed.map(q=>edgeDistance(q,projected)),b=projected.map(q=>edgeDistance(q,observed));
      contourError=(a.reduce((s,x)=>s+x,0)/a.length+b.reduce((s,x)=>s+x,0)/b.length)/(2*frame.cap.width);
      contourMaxError=Math.max(...a,...b)/frame.cap.width;
      score=.45*score+.55*Math.max(0,1-contourError*8);
    }
    return {score,contourError,contourMaxError,upper:fraction[1],filling:fraction[2],lower:fraction[3],outside:fraction[0],greens,darks,buns,fillSamples:count[2]};
  }
  function refine(frame,start,previous,dtMs) {
    let p={...start},e=evaluate(frame,p);
    let score=merit(p,e,previous,dtMs);
    const diameter=p.scale*geometry.fillingDiameter;
    for(const fraction of [1,.5])for(let pass=0;pass<2;pass++) {
      for(const [key,step] of [['x',Math.max(1,diameter*.07)*fraction],['y',Math.max(1,diameter*.07)*fraction],['scale',p.scale*.07*fraction],['roll',6*fraction],['t',1]]) {
        let best=p,bestEvidence=e,bestScore=score;
        for(const sign of [-1,1]) {
          const q={...p,[key]:p[key]+sign*step};q.roll=wrap(q.roll);
          if(q.t<0||q.t>=templates.length||q.scale<.55||q.scale>frame.w/28)continue;
          if(frame.table&&(q.t<7||Math.abs(q.roll)>45))continue;
          const qe=evaluate(frame,q),qs=merit(q,qe,previous,dtMs);
          if(qs>bestScore){best=q;bestEvidence=qe;bestScore=qs;}
        }
        p=best;e=bestEvidence;score=bestScore;
      }
    }
    return {...p,e,merit:score};
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
      displayStatus:'none',displayAgeMs:null,displayOpacity:0,
      bunContour:null,viewClass:'unknown',elevationRangeDegrees:null,
      attackRegion:null,modelAttackability:'unknown',modelFillingFractionRange:null,
      poseStatus:'unknown',attackability:'unknown',reason,experimental:true,projection:'orthographic-approximation'};
  }
  class Tracker {
    constructor({mode='handheld'}={}){templates??=buildTemplates();this.mode=mode;this.reset();}
    reset(){this.last=null;this.lock=null;this.previous=null;this.lastTime=-Infinity;this.selection=null;this.streak=0;this.stableSince=null;}
    select(x,y){this.reset();this.selection={x,y};}
    missing(timestampMs,reason='short-gap-display-only') {
      this.streak=0;this.stableSince=null;
      const out=empty(timestampMs,reason),age=this.lock?timestampMs-this.lock.time:Infinity;
      // A held estimate never refreshes its own evidence time or becomes a
      // measurement. Keep no fresh core/pose/attack permission on missing input.
      if(age>=0&&age<=HOLD_MS) {
        Object.assign(out,{tracking:'unknown',displayPose:this.lock.display,evidenceTimestampMs:this.lock.time,
          displayStatus:'held',displayAgeMs:age,displayOpacity:.65*(1-age/HOLD_MS)});
      }else{this.last=null;this.lock=null;this.previous=null;}
      return out;
    }
    update(input,timestampMs,{temporal=true}={}) {
      if(!Number.isFinite(timestampMs)||input.data.length!==input.width*input.height*4)throw new TypeError('RGBA frame and monotonic timestamp required');
      if(!temporal||timestampMs<=this.lastTime||timestampMs-this.lastTime>HOLD_MS||this.previous&&
        (this.previous.w!==input.width||this.previous.h!==input.height)) {
        const selection=this.selection;this.reset();this.selection=selection;
      }
      // A stale anchor must not trap a new target at its old position/size.
      if(this.last&&timestampMs-(this.lock??this.last).time>HOLD_MS){this.last=null;this.lock=null;this.previous=null;this.streak=0;this.stableSince=null;}
      this.lastTime=timestampMs;const frame=frameData(input);frame.table=this.mode==='table';
      frame.cap=frame.table?capObservation(input,frame,this.selection):null;
      if(frame.table&&!frame.cap)return this.missing(timestampMs,'no-complete-cap');
      const contour=frame.cap?.points.map(p=>({x:p.x/frame.w,y:p.y/frame.h}))??null;
      const hypotheses=frame.table?[]:seeds(frame,this.selection),reference=this.last?.raw;
      if(frame.table){
        const observed=bounds(frame.cap.points);
        for(let t=7;t<templates.length;t++)for(const roll of [-30,-15,0,15,30]){
          const c=Math.cos(roll*DEG),s=Math.sin(roll*DEG),box=bounds(templates[t].upperHull.map(p=>({x:p.x*c+p.y*s,y:-p.x*s+p.y*c})));
          const scale=(observed.right-observed.left)/(box.right-box.left);
          hypotheses.push({t,roll,scale,x:(observed.left+observed.right-scale*(box.left+box.right))/2,y:(observed.top+observed.bottom-scale*(box.top+box.bottom))/2});
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
      const ranked=hypotheses.map(p=>({...p,e:evaluate(frame,p)})).sort((a,b)=>merit(b,b.e,prior,dtMs)-merit(a,a.e,prior,dtMs));
      // Always refine the previous model too; a tiny isolated green patch must
      // not evict it from the short list before continuity can be considered.
      const starts=reference?[motion??reference]:[];
      for(const p of ranked) {
        if(starts.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<p.scale*3&&Math.abs(p.t-q.t)<3&&Math.abs(wrap(p.roll-q.roll))<20))continue;
        starts.push(p);if(starts.length>=5)break;
      }
      const fitted=starts.map(p=>refine(frame,p,prior,dtMs)).sort((a,b)=>b.merit-a.merit);
      const isSupported=q=>{
        if(frame.table)return q.e.score>.65&&q.e.contourError<.055&&q.e.contourMaxError<.13&&q.e.upper>.45&&q.e.greens>=2&&q.e.darks>=2;
        const freshTop=hypotheses.some(p=>p.freshTop&&Math.hypot(p.x-q.x,p.y-q.y)<q.scale*8&&Math.abs(Math.log(p.scale/q.scale))<.3);
        // A small upside-down model on one green leaf can score highly. Require
        // both green and dark filling evidence, or fresh sesame-cap evidence.
        const layered=q.e.greens>=3&&q.e.darks>=Math.max(3,q.e.fillSamples*.06)&&q.e.filling>.38;
        return q.e.score>.59&&q.e.upper>.35&&q.e.buns>=3&&(layered||(freshTop&&templates[q.t].elevation>=60&&q.e.upper>.68));
      };
      const visuallySupported=fitted.filter(isSupported);
      // Tentative observations also have to agree with the preceding frame.
      // If they fail before a stable lock exists, restart acquisition without
      // holding them. Otherwise the third frame could still suddenly halve.
      const guard=this.lock??this.last;
      const supportedFits=visuallySupported.filter(p=>!guard||continuity(p,guard.raw,timestampMs-guard.time).allowed);
      const supported=supportedFits.length>0,best=supportedFits[0]??visuallySupported[0]??fitted[0];
      if(!supported) {
        const reason=visuallySupported.length?'continuity-rejected':best?'weak-model-fit':'no-supported-target';
        const out=this.missing(timestampMs,reason);
        out.bunContour=contour;out.debug=best?{fit:best.e,continuity:continuity(best,reference,dtMs)}:null;return out;
      }
      // Near the symmetry axis, in-plane rotation is unobservable and irrelevant.
      const competing=supportedFits.find(p=>p!==best&&(Math.abs(p.t-best.t)>=2||(Math.min(Math.cos(templates[p.t].elevation*DEG),Math.cos(templates[best.t].elevation*DEG))>.25&&Math.abs(wrap(p.roll-best.roll))>20)||Math.abs(Math.log(p.scale/best.scale))>.2)&&Math.hypot(p.x-best.x,p.y-best.y)<best.scale*22);
      const ambiguous=!!competing&&best.e.score-competing.e.score<.045;
      const distant=supportedFits.find(p=>p!==best&&Math.hypot(p.x-best.x,p.y-best.y)>best.scale*22&&best.e.score-p.e.score<.04);
      if(distant){this.reset();return empty(timestampMs,'multiple-targets');}
      const continuous=reference&&continuity(best,reference,dtMs).allowed;
      // Tilt can be ambiguous while centre/scale still agree. Only spatial
      // disagreement disqualifies a candidate as a future hold anchor.
      const placementUncertain=supportedFits.some(p=>p!==best&&best.merit-p.merit<.035&&
        (Math.hypot(p.x-best.x,p.y-best.y)>best.scale*geometry.fillingDiameter*.2||Math.abs(Math.log(p.scale/best.scale))>.18));
      if(this.lock&&placementUncertain)return {...this.missing(timestampMs,'uncertain-placement'),bunContour:contour};
      const steady=best.e.score>=.63&&!placementUncertain;
      this.streak=steady?(continuous?this.streak+1:1):0;
      if(!steady)this.stableSince=null;else if(!continuous||this.stableSince===null)this.stableSince=timestampMs;
      const raw={x:best.x,y:best.y,scale:best.scale,roll:best.roll,t:best.t,topSeed:best.topSeed};
      const toPose=p=>({center:{x:p.x/frame.w,y:p.y/frame.h},scalePerSourceWidth:p.scale/frame.w,
        elevationDegrees:templates[p.t].elevation,rollDegrees:p.roll});
      const pose=toPose(raw),display={...pose,center:{...pose.center}};
      // Smooth only the display position/scale, never permission or evidence.
      if(continuous&&temporal) {
        const old=this.last.display,a=1-Math.exp(-dtMs/78);
        display.center={x:old.center.x+(pose.center.x-old.center.x)*a,y:old.center.y+(pose.center.y-old.center.y)*a};
        display.scalePerSourceWidth=old.scalePerSourceWidth+(pose.scalePerSourceWidth-old.scalePerSourceWidth)*a;
        display.rollDegrees=old.rollDegrees+wrap(pose.rollDegrees-old.rollDegrees)*a;
        display.elevationDegrees=old.elevationDegrees+(pose.elevationDegrees-old.elevationDegrees)*(1-Math.exp(-dtMs/167));
      }
      this.last={raw,display,time:timestampMs};this.previous=frame;this.selection=null;
      if(temporal&&steady&&(this.lock||this.streak>=3&&timestampMs-this.stableSince>=120))this.lock=this.last;
      // A display neighbourhood only, NOT a calibrated confidence interval or
      // a hittable filling mask. poseStatus carries unresolved fit ambiguity.
      const radius=best.scale*(ambiguous?3:1.5);
      const possibleAngles=frame.table?supportedFits.filter(p=>best.e.score-p.e.score<.045).map(p=>templates[p.t].elevation):[];
      const angleRange=possibleAngles.length?[Math.min(...possibleAngles),Math.max(...possibleAngles)]:null;
      const regionAPI=globalThis.BurgerAttackRegion;
      const regionEvidence=regionAPI?.evaluate(supportedFits.filter(p=>best.e.score-p.e.score<.045).map(p=>templates[p.t].elevation));
      return {...empty(timestampMs),evidenceTimestampMs:timestampMs,tracking:'found',targetFound:true,
        coreCenter:pose.center,coreBounds:{x:(best.x-radius)/frame.w,y:(best.y-radius)/frame.h,width:2*radius/frame.w,height:2*radius/frame.h},
        pose,displayPose:display,poseStatus:ambiguous?'ambiguous':'approximate',reason:ambiguous?'competing-poses':'current-model-fit',
        displayStatus:'measured',displayAgeMs:0,displayOpacity:1,
        // Only current measurements get a region. A frozen display marker is
        // not a fresh target and missing() clears this preview immediately.
        attackRegion:regionAPI?{center:{...pose.center},radiusMm:regionAPI.RULE.radiusMm,
          radiusX:best.scale*regionAPI.RULE.radiusMm/frame.w,radiusY:best.scale*regionAPI.RULE.radiusMm/frame.h}:null,
        modelAttackability:placementUncertain?'unknown':regionEvidence?.status??'unknown',
        modelFillingFractionRange:regionEvidence?.fillingFractionRange??null,
        bunContour:contour,elevationRangeDegrees:angleRange,
        viewClass:angleRange?(angleRange[0]>=30?'oblique-top':angleRange[1]<=10?'side':'unknown'):null,
        // Geometric self-occlusion only. Fingers are absent from the mesh.
        modelCenterSurface:ambiguous&&templates[competing.t].centerMaterial!==templates[best.t].centerMaterial?'unknown':templates[best.t].centerMaterial,
        debug:{fit:best.e,competingScore:competing?.e.score??null,hypotheses:hypotheses.length,motionCorrelation:motion?.correlation??null,
          streak:this.streak,holdReady:!!this.lock,placementUncertain,continuity:continuity(best,reference,dtMs)}};
    }
  }
  globalThis.BurgerPose={Tracker,empty,geometry,classify,HOLD_MS};
})();

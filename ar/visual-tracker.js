/* Image-only prototype: detected bun -> textured feature patches -> robust
 * 2-D similarity transform. This is sparse normalized patch matching, NOT
 * Lucas-Kanade, SLAM, pose estimation, core localization or learned detection.
 * No smoothing/IMU. Output is in source pixels; lost/unknown never grants hits.
 * Intensity normalization tolerates affine brightness changes, not arbitrary
 * reflections or changing white balance. Detector limitations still apply.
 */
(() => {
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const centre=b=>({x:b.x+b.width/2,y:b.y+b.height/2});
  function gray(input){
    const data=new Float32Array(input.width*input.height);
    for(let i=0;i<data.length;i++)data[i]=(input.data[4*i]+2*input.data[4*i+1]+input.data[4*i+2])/4;
    return {data,width:input.width,height:input.height};
  }
  function features(frame,box){
    const out=[],{data:g,width:w,height:h}=frame,c=centre(box);
    // Stay inside the crown: including the nearby table makes a stationary
    // background look like a very stable burger track.
    for(let y=Math.max(5,Math.ceil(box.y+4));y<Math.min(h-5,box.y+box.height-4);y+=2)
    for(let x=Math.max(5,Math.ceil(box.x+4));x<Math.min(w-5,box.x+box.width-4);x+=2){
      if(((x-c.x)/(box.width*.48))**2+((y-c.y)/(box.height*.48))**2>1)continue;
      let xx=0,yy=0,xy=0;
      for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
        const k=(y+j)*w+x+i,dx=g[k+1]-g[k-1],dy=g[k+w]-g[k-w];xx+=dx*dx;yy+=dy*dy;xy+=dx*dy;
      }
      const quality=(xx+yy-Math.hypot(xx-yy,2*xy))/2;
      if(quality>180)out.push({x,y,quality});
    }
    out.sort((a,b)=>b.quality-a.quality);
    const picked=[],gap=Math.max(4,box.width*.09);
    for(const p of out)if(!picked.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<gap)){
      picked.push(p);if(picked.length===24)break;
    }
    return picked;
  }
  function patch(frame,p){
    const x=Math.round(p.x),y=Math.round(p.y);
    if(x<6||y<6||x>=frame.width-6||y>=frame.height-6)return null;
    const values=[];let mean=0;
    for(let j=-5;j<=5;j++)for(let i=-5;i<=5;i++){const v=frame.data[(y+j)*frame.width+x+i];values.push(v);mean+=v;}
    mean/=121;let variance=0;
    for(let i=0;i<121;i++){values[i]-=mean;variance+=values[i]**2;}
    return variance>121*16?{values,variance}:null;
  }
  function match(source,destination,p,prediction,radius){
    const template=patch(source,p);if(!template)return null;
    const score=(x,y)=>{
      if(x<6||y<6||x>=destination.width-6||y>=destination.height-6)return -1;
      let sum=0,sum2=0,dot=0,k=0;
      for(let j=-5;j<=5;j++)for(let i=-5;i<=5;i++){
        const v=destination.data[(y+j)*destination.width+x+i];sum+=v;sum2+=v*v;dot+=v*template.values[k++];
      }
      return dot/Math.sqrt(template.variance*Math.max(1,sum2-sum*sum/121));
    };
    const cx=Math.round(prediction.x),cy=Math.round(prediction.y);let best={x:cx,y:cy,score:score(cx,cy)};
    for(let dy=-radius;dy<=radius;dy+=2)for(let dx=-radius;dx<=radius;dx+=2){
      const s=score(cx+dx,cy+dy);if(s>best.score)best={x:cx+dx,y:cy+dy,score:s};
    }
    const coarse=best;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const s=score(coarse.x+dx,coarse.y+dy);if(s>best.score)best={x:coarse.x+dx,y:coarse.y+dy,score:s};
    }
    if(best.score<.83)return null;
    // Subpixel peak avoids rounding every feature to a new integer position.
    const offset=(left,right)=>clamp(.5*(left-right)/(left-2*best.score+right||1),-.5,.5);
    return {x:best.x+(p.x-Math.round(p.x))+offset(score(best.x-1,best.y),score(best.x+1,best.y)),
      y:best.y+(p.y-Math.round(p.y))+offset(score(best.x,best.y-1),score(best.x,best.y+1)),score:best.score};
  }
  const transform=(m,p)=>({x:m.a*p.x-m.b*p.y+m.x,y:m.b*p.x+m.a*p.y+m.y});
  function solve(pairs){
    const n=pairs.length,mean=key=>({x:pairs.reduce((s,p)=>s+p[key].x,0)/n,y:pairs.reduce((s,p)=>s+p[key].y,0)/n});
    const p=mean('from'),q=mean('to');let aa=0,bb=0,den=0;
    for(const v of pairs){const x=v.from.x-p.x,y=v.from.y-p.y,u=v.to.x-q.x,w=v.to.y-q.y;aa+=x*u+y*w;bb+=x*w-y*u;den+=x*x+y*y;}
    if(den<1)return null;const a=aa/den,b=bb/den;
    return {a,b,x:q.x-a*p.x+b*p.y,y:q.y-b*p.x-a*p.y};
  }
  function translationHint(previous,current,box){
    const samples=[],c=centre(box);
    // Include the crown edge for disambiguation; a grid wholly inside repeated
    // texture can prefer the neighbouring sesame/pattern period as a motion.
    for(let y=-.55;y<=.55;y+=.1)for(let x=-.55;x<=.55;x+=.1){
      const px=Math.round(c.x+x*box.width),py=Math.round(c.y+y*box.height);
      if(px<0||py<0||px>=previous.width||py>=previous.height)continue;
      samples.push({x:px,y:py,v:previous.data[py*previous.width+px]});
    }
    const n=samples.length,mean=samples.reduce((s,p)=>s+p.v,0)/n;let variance=0;
    for(const p of samples){p.v-=mean;variance+=p.v*p.v;}
    if(variance<n*16)return null;
    const score=(dx,dy)=>{
      let sum=0,sum2=0,dot=0;
      for(const p of samples){const x=p.x+dx,y=p.y+dy;if(x<0||y<0||x>=current.width||y>=current.height)return -1;
        const v=current.data[y*current.width+x];sum+=v;sum2+=v*v;dot+=v*p.v;}
      return dot/Math.sqrt(variance*Math.max(1,sum2-sum*sum/n));
    };
    let best={x:0,y:0,score:score(0,0)};const r=Math.round(clamp(box.width*.45,8,40));
    for(let y=-r;y<=r;y+=2)for(let x=-r;x<=r;x+=2){const s=score(x,y);if(s>best.score)best={x,y,score:s};}
    const coarse=best;
    for(let y=coarse.y-1;y<=coarse.y+1;y++)for(let x=coarse.x-1;x<=coarse.x+1;x++){const s=score(x,y);if(s>best.score)best={x,y,score:s};}
    return best.score>=.7?best:null;
  }
  function motion(previous,current,points,box){
    // A whole-crown motion estimate keeps similar sesame spots from competing
    // across the full search window. Local patches still verify each feature.
    const hint=translationHint(previous,current,box);
    const pairs=[],radius=hint?6:Math.round(clamp(box.width*.3,6,24));
    for(const p of points){
      const q=match(previous,current,p,hint?{x:p.x+hint.x,y:p.y+hint.y}:p,radius);if(!q)continue;
      // Search backwards independently. Seeding a tiny window at the known
      // original point falsely validates matches between similar sesame spots.
      const back=match(current,previous,q,hint?{x:q.x-hint.x,y:q.y-hint.y}:q,radius);
      if(back&&Math.hypot(back.x-p.x,back.y-p.y)<1.5)pairs.push({from:p,to:q});
    }
    if(pairs.length<5)return null;
    const tolerance=clamp(box.width*.025,1.4,3);let inliers=[];
    for(let i=0;i<pairs.length;i++)for(let j=i+1;j<pairs.length;j++){
      if(Math.hypot(pairs[i].from.x-pairs[j].from.x,pairs[i].from.y-pairs[j].from.y)<box.width*.2)continue;
      const m=solve([pairs[i],pairs[j]]);if(!m)continue;
      const scale=Math.hypot(m.a,m.b);if(scale<.8||scale>1.25)continue;
      const good=pairs.filter(v=>{const q=transform(m,v.from);return Math.hypot(q.x-v.to.x,q.y-v.to.y)<tolerance;});
      if(good.length>inliers.length)inliers=good;
    }
    if(inliers.length<5||inliers.length<pairs.length*.65)return null;
    const xs=inliers.map(p=>p.from.x),ys=inliers.map(p=>p.from.y);
    if(Math.max(...xs)-Math.min(...xs)<box.width*.3||Math.max(...ys)-Math.min(...ys)<box.height*.22)return null;
    const m=solve(inliers);return {matrix:m,matched:pairs.length,inliers:inliers.length,
      points:inliers.map(p=>p.to),scale:Math.hypot(m.a,m.b),rotation:Math.atan2(m.b,m.a)*180/Math.PI};
  }
  function movedBox(box,m){
    // Repeatedly enclosing a rotated rectangle would inflate its size even
    // when the object does not approach. Scale comes from feature distances.
    const p=transform(m,centre(box)),scale=Math.hypot(m.a,m.b),width=box.width*scale,height=box.height*scale;
    return {x:p.x-width/2,y:p.y-height/2,width,height};
  }
  function agrees(a,b){
    const p=centre(a),q=centre(b);
    return Math.hypot(p.x-q.x,p.y-q.y)<a.width*.22&&Math.abs(Math.log(b.width/a.width))<.22&&Math.abs(Math.log(b.height/a.height))<.35;
  }
  function verifies(a,b){
    const p=centre(a),q=centre(b);
    // The thresholded cap height can change with exposure. It may confirm
    // identity without replacing the independently tracked centre or scale.
    return Math.hypot(p.x-q.x,p.y-q.y)<a.width*.3&&Math.abs(Math.log(b.width/a.width))<.3;
  }
  function appearance(frame,box){
    const values=[];
    for(let y=0;y<10;y++)for(let x=0;x<16;x++){
      const u=(x+.5)/16,v=(y+.5)/10;
      if(((u-.5)/.45)**2+((v-.5)/.45)**2>1)continue;
      const px=Math.round(box.x+u*box.width),py=Math.round(box.y+v*box.height);
      if(px<0||py<0||px>=frame.width||py>=frame.height)return null;
      values.push(frame.data[py*frame.width+px]);
    }
    const mean=values.reduce((s,v)=>s+v,0)/values.length;
    const centred=values.map(v=>v-mean),norm=Math.hypot(...centred);
    return norm>values.length?centred.map(v=>v/norm):null;
  }
  const correlation=(a,b)=>a&&b?a.reduce((s,v,i)=>s+v*b[i],0):-1;
  class Tracker{
    constructor({detect=input=>globalThis.BurgerPose.detectCap(input),confirm=(input,box)=>globalThis.BurgerPose?.confirmCap?.(input,box)}={}){this.detect=detect;this.confirm=confirm;this.reset();}
    reset(){this.previous=null;this.box=null;this.points=[];this.time=-Infinity;this.confirmedAt=-Infinity;this.detectAt=-Infinity;this.pending=null;this.lastOutput=null;this.reference=null;this.localAt=-Infinity;}
    update(input,time,{detection:given}={}){
      if(time<=this.time||time-this.time>300||this.previous&&(this.previous.width!==input.width||this.previous.height!==input.height))this.reset();
      const frame=gray(input),run=given!==undefined||!this.box||time-this.detectAt>=250;
      const detection=run?(given===undefined?this.detect(input):given):null;
      if(run)this.detectAt=time;
      let state='lost',reason='no-detection',flow=null,localEvidence=null;
      if(this.box&&this.previous){
        flow=motion(this.previous,frame,this.points,this.box);
        if(flow){
          const predicted=movedBox(this.box,flow.matrix);
          const inside=predicted.x>=0&&predicted.y>=0&&predicted.x+predicted.width<input.width&&predicted.y+predicted.height<input.height;
          const verified=!!detection&&verifies(predicted,detection.box);
          if(run&&inside&&!verified&&time-this.confirmedAt<=3000){
            const appearanceScore=correlation(this.reference,appearance(frame,predicted));
            localEvidence={...this.confirm(input,predicted),appearanceScore};
            this.localAt=localEvidence.supported&&appearanceScore>=.8&&flow.inliers>=7?time:-Infinity;
          }
          // Local checks cannot renew the global identity indefinitely. They
          // require fresh layered appearance + flow and expire after 3 seconds
          // from the last full detection. Never freeze an old marker as evidence.
          const localFresh=time-this.localAt<=300&&time-this.confirmedAt<=3000;
          if(inside&&(verified||localFresh||!detection&&time-this.confirmedAt<=1000)){
            this.box=predicted;this.points=flow.points;
            if(verified){this.confirmedAt=time;this.reference=appearance(frame,predicted);this.localAt=-Infinity;}
            state='tracking';reason=verified?'image-track-verified':localFresh?'image-track-local':'image-track';
          }else reason=!inside?'out-of-frame':time-this.confirmedAt>1000?'detection-timeout':'detector-disagreement';
        }else reason='texture-track-failed';
        if(state!=='tracking'){this.box=null;this.points=[];this.pending=null;this.reference=null;this.localAt=-Infinity;state='unknown';}
      }
      if(!this.box&&detection){
        if(this.pending&&agrees(this.pending.box,detection.box)&&time-this.pending.time<=300){
          const selected=features(frame,detection.box);
          if(selected.length>=5){this.box={...detection.box};this.points=selected;this.confirmedAt=time;this.reference=appearance(frame,this.box);state='tracking';reason='acquired';}
          else {state='candidate';reason='not-enough-texture';}
        }else if(state!=='unknown'){state='candidate';reason='confirming-detection';}
        this.pending={box:detection.box,time};
      }
      if(this.box){
        // Replenish points in the current tracked ROI without snapping its
        // centre/size to the new colour mask. All coordinates stay unsmoothed.
        if(this.points.length<12||run)this.points=features(frame,this.box);
      }
      this.previous=frame;this.time=time;
      const out={timestampMs:time,state,reason,targetFound:state==='tracking',
        anchor:this.box?centre(this.box):null,targetBounds:this.box?{...this.box}:null,
        detection:run?detection:null,detectorRan:run,points:this.box?this.points:[],
        matchedPoints:flow?.matched??0,inlierPoints:flow?.inliers??0,
        scaleChange:flow?.scale??null,rotationChange:flow?.rotation??null,
        lastDetectionAgeMs:Number.isFinite(this.confirmedAt)?time-this.confirmedAt:null,
        localEvidence,lastLocalConfirmationAgeMs:Number.isFinite(this.localAt)?time-this.localAt:null,
        coreCenter:null,attackability:'unknown',experimental:true};
      this.lastOutput=out;return out;
    }
  }
  globalThis.BurgerVisual={Tracker,features,gray,motion};
})();

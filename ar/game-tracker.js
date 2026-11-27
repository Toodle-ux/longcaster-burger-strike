/* Game integration: vision-6 supplies identity and short display motion;
 * the CURRENT cap contour anchors the whole model and its fixed core. Load model,
 * attack-region, pose-tracker and visual-tracker before this module.
 * Visual acquisition alone never grants attacks. Current pose fits use only
 * CURRENT detector contours, never a propagated silhouette. No IMU required.
 */
(() => {
  const center=b=>({x:b.x+b.width/2,y:b.y+b.height/2});
  function sameTarget(a,b){
    const p=center(a),q=center(b);
    return Math.hypot(p.x-q.x,p.y-q.y)<a.width*.3&&Math.abs(Math.log(b.width/a.width))<.3;
  }
  // Apply the cap's measured image motion to the core offset, not vice versa.
  function relocate(pose,from,to,width,height){
    const a=center(from),b=center(to),scale=to.width/from.width;
    return {...pose,center:{x:(b.x+(pose.center.x*width-a.x)*scale)/width,
      y:(b.y+(pose.center.y*height-a.y)*scale)/height},scalePerSourceWidth:pose.scalePerSourceWidth*scale};
  }
  // Compare geometry in bun-local coordinates: real image translation/zoom
  // must not be mistaken for a changing internal core estimate.
  function localPose(pose,box,width,height){
    const c=center(box);
    return {x:(pose.center.x*width-c.x)/box.width,y:(pose.center.y*height-c.y)/box.width,
      scale:pose.scalePerSourceWidth*width/box.width,elevation:pose.elevationDegrees};
  }
  const agrees=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<=.06&&
    Math.abs(Math.log(a.scale/b.scale))<=.15&&Math.abs(a.elevation-b.elevation)<=10;
  const CONFIRM_MS=180,CONFIRM_FRAMES=3,CONFIRM_GAP_MS=250,CONFIRM_WINDOW_MS=500;
  function fillingPoints(gray,box,frame){
    const w=box.width,strip={x:box.x+w*.13,y:box.y+box.height+w*.055,width:w*.74,height:w*.37};
    return globalThis.BurgerVisual.features(gray,strip).filter(p=>{
      const label=frame.labels[p.y*frame.w+p.x];
      return label===1||label===2||label===4;
    }).map(p=>({...p,region:'filling'}));
  }
  // On motion blur a fully observed crown can lose its fine sesame matches.
  // Retry the same bidirectional matcher with texture from the visible filling.
  function retryLayerTrack(input,time,fromTime,box,gray,points,source,frame,observed){
    if(!gray||!points||!frame?.labels||!observed?.sesame?.strong||!observed.hasFilling||
      !globalThis.BurgerPose.confirmCap(input,observed.box).supported)return null;
    const vision=globalThis.BurgerVisual,w=box.width,fill=fillingPoints(gray,box,frame);
    if(fill.length<3)return null;
    const trial=new vision.Tracker({detect:source.detect,confirm:source.confirm});
    Object.assign(trial,{previous:gray,box,points:[...points,...fill],time:fromTime});
    const result=trial.update(input,time,{detection:observed});
    if(result.reason!=='image-track-verified'||result.inlierPoints<7)return null;
    const seen=observed.box,tracked=result.targetBounds,a=center(seen),b=center(tracked);
    if(Math.hypot(a.x-b.x,a.y-b.y)>w*.10||Math.abs(Math.log(seen.width/tracked.width))>.10)return null;
    return globalThis.BurgerPose.hasFrontCrease(input,observed)?trial:null;
  }
  class Tracker {
    constructor({detect=input=>globalThis.BurgerPose.detectCap(input),recover=(input,box)=>globalThis.BurgerPose.recoverCap(input,box),visual=null,geometry=null}={}){
      this.detect=detect;
      this.recover=recover;
      this.visual=visual??new globalThis.BurgerVisual.Tracker({detect:()=>this.observe()});
      this.geometry=geometry??new globalThis.BurgerPose.Tracker({mode:'table'});
      this.reset();
    }
    reset(){this.visual.reset();this.geometry.reset();this.anchor=null;this.pendingPose=null;
      this.exposure=null;this.confirmedExposure=null;this.blockedAt=null;this.panSteps=[];this.imageContour=null;this.sideEdgeAt=-Infinity;this.retryAt=-Infinity;this.lostReference=null;this.lastTime=-Infinity;this.size='';this.firstOutline=null;}
    observe(){if(this.detection===undefined)this.detection=this.detect(this.input);return this.detection;}
    update(input,timestampMs){
      input=globalThis.BurgerPose.prepareFrame?.(input)??input;
      const size=input.width+'x'+input.height;
      if(timestampMs<=this.lastTime||timestampMs-this.lastTime>300||this.size!==size)this.reset();
      const fromTime=this.lastTime,previousBox=this.visual.box;
      this.lastTime=timestampMs;this.size=size;this.input=input;this.detection=undefined;
      // The game already needs the current detector contour for its model. Give
      // the same observation to texture verification, including on a fast pan.
      const observed=this.observe(),pending=this.visual.pending;
      // The second full detection can join a tray rail while its predecessor
      // still has the physical diameter. Check current scan-line endpoints
      // against independent feature motion before the usual acquisition vote.
      if(observed?.sesame?.strong&&this.firstOutline&&!previousBox&&pending?.time===fromTime&&this.visual.previous&&
        Math.log(observed.box.width/pending.box.width)>.22){
        const before=this.visual.previous,points=globalThis.BurgerVisual.features(before,pending.box);
        const flow=globalThis.BurgerVisual.motion(before,globalThis.BurgerVisual.gray(input),points,pending.box);
        if(flow?.inliers>=7){
          const m=flow.matrix,c=center(pending.box),w=pending.box.width*flow.scale,h=pending.box.height*flow.scale;
          const tracked={x:m.a*c.x-m.b*c.y+m.x-w/2,y:m.b*c.x+m.a*c.y+m.y-h/2,width:w,height:h};
          if(sameTarget(tracked,observed.box)){
            const chords=globalThis.BurgerPose.verifyChords(input,observed,tracked);
            if(chords!==observed){
              const search=this.firstOutline.map(q=>({x:m.a*q.x-m.b*q.y+m.x,y:m.b*q.x+m.a*q.y+m.y}));
              const traced=globalThis.BurgerPose.findCurrentOutline(input,observed,search);
              // Both the radial edge search and independent scan-line endpoints
              // must place all four sides on the same current crown.
              if(traced){
                const a=traced.box,b=chords.box;
                const error=Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y),
                  Math.abs(a.x+a.width-b.x-b.width),Math.abs(a.y+a.height-b.y-b.height));
                if(error<tracked.width*.035)this.detection=traced;
              }
            }
          }
        }
      }
      const previousGray=this.visual.previous,previousPoints=this.visual.points;
      let visual=this.visual.update(input,timestampMs,{detection:this.detection});
      // Compare two full observations around one blurred frame. The reference
      // expires on this update even if the new detection cannot be registered.
      const lost=this.lostReference;
      this.lostReference=null;
      if(lost&&visual.reason==='acquired'&&timestampMs-lost.time<=CONFIRM_GAP_MS&&
        retryLayerTrack(input,timestampMs,lost.time,lost.box,lost.gray,lost.points,this.visual,lost.frame,observed)){
        this.confirmedExposure=lost.exposure;
        this.retryAt=timestampMs;
      }
      if(visual.reason==='texture-track-failed'&&previousBox&&this.anchor?.time===fromTime&&
        this.geometry.last?.time===fromTime&&this.visual instanceof globalThis.BurgerVisual.Tracker){
        const retry=retryLayerTrack(input,timestampMs,fromTime,previousBox,previousGray,previousPoints,this.visual,this.geometry.last.frame,observed);
        if(retry){this.visual=retry;visual=retry.lastOutput;this.retryAt=timestampMs;}
        else if(this.confirmedExposure?.time===fromTime&&observed&&!observed.sesame?.strong&&sameTarget(previousBox,observed.box)){
          this.lostReference={time:fromTime,box:previousBox,gray:previousGray,points:previousPoints,
            frame:this.geometry.last.frame,exposure:this.confirmedExposure};
        }
      }
      this.firstOutline=!visual.targetFound&&this.visual.pending?.time===timestampMs?this.detection?.contour:null;
      // Translation between texture frames is measured before changing the ROI.
      if(previousBox&&visual.targetFound&&visual.reason!=='acquired'&&visual.inlierPoints>=7&&
        Number.isFinite(visual.scaleChange)&&visual.targetBounds){
        const a=center(previousBox),b=center(visual.targetBounds);
        if(this.imageContour){
          const angle=visual.rotationChange*Math.PI/180,sc=visual.scaleChange,c=sc*Math.cos(angle),s=sc*Math.sin(angle);
          this.imageContour=this.imageContour.map(q=>({x:b.x+c*(q.x-a.x)-s*(q.y-a.y),y:b.y+s*(q.x-a.x)+c*(q.y-a.y)}));
        }
        this.panSteps=this.panSteps.filter(step=>timestampMs-step.from<=500);
        this.panSteps.push({from:fromTime,to:timestampMs,x:b.x-a.x,y:b.y-a.y});
      }else {this.panSteps=[];this.imageContour=null;}
      const base=globalThis.BurgerPose.empty(timestampMs,visual.reason);
      if(!visual.targetFound){
        // Do not retain a core over a different reacquired object.
        this.geometry.reset();this.retryAt=-Infinity;this.anchor=null;this.pendingPose=null;this.exposure=null;this.confirmedExposure=null;this.blockedAt=null;
        return {...base,visual,geometryState:'not-evaluated',integration:'vision-6-game'};
      }
      // Apply only the image motion measured before any feature-box reseed.
      // Changing the next search area must not zoom or translate an old model.
      const heldPose=this.anchor?relocate(this.anchor.displayPose,this.anchor.motionBox,
        visual.targetBounds,input.width,input.height):null;
      let observation=this.observe();
      // Texture tracking supplies a search region, never an invented contour.
      // Do not override a conflicting full detection or revive expired identity.
      const localSearch=!observation&&visual.inlierPoints>=7&&
        Number.isFinite(visual.lastDetectionAgeMs)&&visual.lastDetectionAgeMs<=3000;
      if(localSearch)observation=this.recover(input,visual.targetBounds);
      if(observation&&sameTarget(visual.targetBounds,observation.box))
        observation=globalThis.BurgerPose.refineCap(input,observation);
      if(observation?.refinement?.method==='closed-edge'&&this.anchor&&timestampMs-this.anchor.time<500&&
        visual.reason==='image-track-verified'&&visual.inlierPoints>=7)
        observation=globalThis.BurgerPose.verifyChords(input,observation,visual.targetBounds);
      if(this.imageContour&&this.anchor&&timestampMs-this.anchor.time<500&&visual.inlierPoints>=7&&
          observation&&(observation.box.height>observation.box.width||
            !observation.sideEdges&&timestampMs-this.sideEdgeAt<=250)&&
          sameTarget(visual.targetBounds,observation.box))
        observation=globalThis.BurgerPose.findCurrentOutline(input,observation,this.imageContour)??observation;
      // A fast view change can break the colour proposal on one frame.
      // Reacquire from a current closed boundary, two-sided contrast, sesame
      // and layered appearance before passing that contour to the usual fit.
      if(!observation&&this.imageContour&&this.anchor&&timestampMs-this.anchor.time<=250&&
        visual.inlierPoints>=7&&this.anchor.local.elevation>=45)
        observation=globalThis.BurgerPose.findCurrentOutline(input,null,this.imageContour);
      let layerSearch=this.imageContour;
      if(layerSearch&&this.anchor&&timestampMs-this.anchor.time<=250&&visual.inlierPoints>=7&&
        (!observation||sameTarget(visual.targetBounds,observation.box))){
        layerSearch=globalThis.BurgerPose.seamSearch?.(input,observation,layerSearch)??layerSearch;
        observation=globalThis.BurgerPose.findLayeredOutline?.(input,observation,layerSearch)??
          globalThis.BurgerPose.seededLayerOutline?.(input,observation,layerSearch)??observation;
      }
      // Texture acquisition only needs a verified search window. Keep its
      // measured image coordinates independent of the 3-D cap registration.
      const visualObservation=observation;
      const shallow=layerSearch&&this.anchor&&timestampMs-this.anchor.time<=250&&visual.inlierPoints>=7&&
        this.anchor.local.elevation<=36&&this.geometry.last?.time===this.anchor.time;
      if(shallow){
        const flanks=this.anchor.capMethod==='measured-flanks-and-crease';
        const same=observation&&sameTarget(visual.targetBounds,observation.box);
        if(same||!observation&&flanks){
          const saved=this.anchor.parallaxReference;
          const previous=saved&&saved.time>=timestampMs-250?saved.frame:this.geometry.last.frame;
          observation=globalThis.BurgerPose.measuredFlanks?.(input,observation,layerSearch,previous)??observation;
        }
        const freshRim=this.anchor.time===fromTime&&(flanks||this.anchor.capMethod==='crease-registered-outline');
        if(same&&observation?.method==='colour-cap'||!observation&&freshRim)
          observation=globalThis.BurgerPose.creaseRegistration?.(input,observation,layerSearch,this.geometry.last.frame)??observation;
      }
      // Surface correspondence measured on this frame shares pixels with its
      // preceding observation. Retain that independent reference for parallax
      // when the next full detector result arrives.
      if(!observation&&visual.targetFound&&previousGray&&previousBox&&
        this.confirmedExposure?.time===fromTime&&this.anchor?.time===fromTime&&this.anchor.local.elevation<=36&&
        this.anchor.capMethod!=='registered-sesame-outline'&&this.geometry.last?.time===fromTime){
        const before=this.geometry.last.frame,marks=before.cap?.sesame;
        if(marks?.strong&&marks.centers?.length>=5){
          const points=marks.centers.map(p=>({...p,region:'sesame'})).concat(fillingPoints(previousGray,previousBox,before));
          const weak=visual.inlierPoints<7;
          const reference=weak?globalThis.BurgerPose.motionBlurReference(input,previousGray,visual.targetBounds):previousGray;
          const flow=reference&&globalThis.BurgerVisual.motion(reference,this.visual.previous,points,previousBox);
          if(flow)observation=globalThis.BurgerPose.registeredSesameOutline(input,before,flow,weak);
          if(flow&&!weak&&!observation){
            // Bright sesame may cluster on the lit shoulder. Match independent
            // texture wholly inside both crown outlines to measure the other side.
            const extra=globalThis.BurgerPose.interiorCrownPoints(previousGray,before.cap);
            if(extra.length>=3){
              const retry=globalThis.BurgerVisual.motion(previousGray,this.visual.previous,points.concat(extra),previousBox);
              if(retry)observation=globalThis.BurgerPose.registeredSesameOutline(input,before,retry,false);
            }
          }
        }
      }
      const paired=observation?.method==='current-crease-and-sesame-pairs';
      const parallaxReference=paired&&this.geometry.last?{time:this.geometry.last.time,frame:this.geometry.last.frame}:null;
      const matched=observation&&sameTarget(visual.targetBounds,observation.box);
      // An unchanged feature ROI keeps its acquisition aspect as the view
      // changes. Re-seed only on a current, independently verified contour.
      // This affects next-frame texture search, never the accepted 3-D pose.
      let reseeded=false;
      if(visualObservation&&sameTarget(visual.targetBounds,visualObservation.box)&&visual.reason==='image-track-verified'&&visual.inlierPoints>=7&&
        visualObservation.sesame?.strong&&visualObservation.refinement?.supportedFraction>=.75&&this.visual.previous&&
        !(this.anchor&&timestampMs-this.anchor.time<=250&&globalThis.BurgerPose.shallowAttachment?.(visualObservation,layerSearch))){
        const fresh=globalThis.BurgerVisual.features(this.visual.previous,visualObservation.box,input);
        if(fresh.length>=7){
          this.visual.box={...visualObservation.box};this.visual.points=fresh;reseeded=true;
          visual.targetBounds={...visualObservation.box};visual.anchor=center(visualObservation.box);visual.points=fresh;
        }
      }
      if(this.anchor){
        this.anchor.displayPose=heldPose;
        this.anchor.motionBox={...visual.targetBounds};
      }
      if(observation&&!matched){this.confirmedExposure=null;this.pendingPose=null;}
      if(this.pendingPose&&(timestampMs-this.pendingPose.last>CONFIRM_GAP_MS||
        timestampMs-this.pendingPose.since>CONFIRM_WINDOW_MS))this.pendingPose=null;
      const fit=this.geometry.update(input,timestampMs,{capObservation:matched?observation:null,panSteps:this.panSteps,
        // After a texture failure, the recovered track retains the old pose
        // history. Independently check a competing occluded fit during the
        // same window used to confirm a reacquired core.
        recheckOcclusion:timestampMs-this.retryAt<=CONFIRM_WINDOW_MS||observation?.method==='registered-sesame-outline',
        registeredToPending:visual.reason==='acquired'&&observed!==this.detection,
        imageRoll:visual.reason==='image-track-verified'&&visual.inlierPoints>=7&&Number.isFinite(visual.rotationChange)?
          {fromTime,degrees:visual.rotationChange}:null,
        contourRecovery:!!matched&&!!this.anchor&&timestampMs-this.anchor.time<500});
      const continuingBlocked=this.blockedAt!==null&&timestampMs-this.blockedAt<=250;
      this.blockedAt=null;
      const result={...fit,displayPose:null,displayStatus:'none',displayOpacity:0,
        visual,geometryState:fit.reason,integration:'vision-6-game',
        stabilization:{rawState:fit.modelAttackability,reason:'no-current-geometry',capMethod:matched?observation.method:null,
          contourRefinement:matched?observation.refinement??null:null,localSearch}};
      if(fit.tracking==='found'&&fit.targetFound&&fit.pose&&fit.evidenceTimestampMs===timestampMs&&matched){
        // Current candidates can unanimously block a shot even while their
        // exact core location is being confirmed. This never grants a hit or
        // renews the last positional evidence used by the 500 ms display hold.
        if(fit.modelAttackability==='blocked'){
          // Continue a blocked run, rather than flashing isolated negative
          // estimates while position is pending. Both frames need real evidence.
          if(continuingBlocked)result.occlusion={state:'blocked',timestampMs};
          this.blockedAt=timestampMs;
        }
        // The texture ROI preserves its acquisition aspect ratio. It is NOT
        // the current bun silhouette after a view change: reanchoring a fresh
        // model to that ROI displaces its core and breaks model/image alignment.
        const pose=fit.pose;
        // Compare successive cores in the coordinate frame of the cap that
        // actually registered each projection. The feature ROI may include a tray edge.
        let poseBox=observation.box;
        // A resolved bun/cheese crease can also change the fitted cap height.
        // Compare the two measurements in the coordinate frame used by the fit.
        if((fit.measuredUpperRim||fit.measuredDistant||observation.sideEdges?.source===observation.contour&&observation.sideEdges)&&fit.bunContour?.length){
          const xs=fit.bunContour.map(q=>q.x*input.width),ys=fit.bunContour.map(q=>q.y*input.height);
          const x=Math.min(...xs),y=Math.min(...ys);
          poseBox={x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y};
        }
        const local=localPose(pose,poseBox,input.width,input.height);
        // An isolated competing pose cannot move the core or renew its hold.
        // A genuine new view is accepted after consistent CURRENT evidence.
        let accepted=!this.anchor||agrees(local,this.anchor.local);
        if(accepted)this.pendingPose=null;
        else {
          if(!this.pendingPose||!agrees(local,this.pendingPose.local))
            this.pendingPose={local,since:timestampMs,last:timestampMs,count:0};
          this.pendingPose.count++;this.pendingPose.last=timestampMs;
          accepted=this.pendingPose.count>=CONFIRM_FRAMES&&timestampMs-this.pendingPose.since>=CONFIRM_MS;
        }
        result.stabilization={...result.stabilization,
          reason:accepted?'current-geometry':'confirming-core',pendingFrames:this.pendingPose?.count??0};
        if(!accepted||fit.modelAttackability!=='exposed')this.confirmedExposure=null;
        if(accepted){
          this.geometry.confirmGameFit?.(timestampMs);
          const corrected=observation.sideEdges&&observation.sideEdges.source===observation.contour;
          if(corrected)this.sideEdgeAt=timestampMs;
          // A measured correction should seed the next current-edge search
          // at the bun, even if the optical-flow ROI still includes the tray.
          const trackSource=visualObservation??observation;
          const outline=trackSource.sideEdges&&trackSource.sideEdges.source===trackSource.contour?trackSource.sideEdges.contour:trackSource.contour;
          // A fit rescued by other cap diameters does not corroborate the
          // disputed tangent. Keep the verified texture-transported search
          // outline until the ordinary current-edge measurement agrees again.
          // A corrected 3-D fit cannot validate the colour outline that it
          // contradicted. Let the existing 2-D reseed decision govern a new
          // texture reference; otherwise continue its measured image motion.
          if(!paired&&observation.method!=='registered-sesame-outline'&&fit.debug?.fit?.registration!=='full-perimeter'&&(trackSource===observation||reseeded))
            this.imageContour=trackSource.sesame?.strong&&outline?.length>=8?outline:null;
          this.anchor={local,displayPose:pose,parallaxReference,capMethod:observation.method,
            motionBox:{...visual.targetBounds},time:timestampMs};
          this.pendingPose=null;
          // A missing frame revokes permission. A brief miss may retain identity,
          // but recovery still needs a NEW exposed model on the same contour.
          const resumed=fit.modelAttackability==='exposed'&&this.confirmedExposure&&
            timestampMs-this.confirmedExposure.time<=250&&agrees(local,this.confirmedExposure.local);
          if(fit.modelAttackability==='exposed'){
            this.exposure??={since:timestampMs,count:0};this.exposure.count++;
          } else this.exposure=null;
          const exposedReady=resumed||this.exposure&&this.exposure.count>=CONFIRM_FRAMES&&
            timestampMs-this.exposure.since>=CONFIRM_MS;
          const state=fit.modelAttackability==='exposed'&&!exposedReady?'unknown':fit.modelAttackability;
          if(fit.modelAttackability==='exposed'&&!exposedReady)result.stabilization.reason='confirming-exposure';
          if(state==='exposed'){
            if(resumed&&this.exposure.count===1)result.stabilization.reason='exposure-resumed';
            this.confirmedExposure={local,time:timestampMs};
          }
          return {...result,pose,coreCenter:fit.coreCenter,modelAttackability:state,
            displayPose:pose,displayStatus:'measured',displayOpacity:1,displayAgeMs:0,displayMotion:'current-contour'};
        }
      } else {
        // Only brief missing observations may preserve confirmation progress.
        // They add no votes, grant no attacks, and cannot renew the display hold.
        if(!['weak-model-fit','no-complete-cap'].includes(fit.reason))this.pendingPose=null;
        if(['uncertain-placement','continuity-rejected','multiple-targets'].includes(fit.reason))this.confirmedExposure=null;
      }
      this.exposure=null;
      // Image-supported short display only. Its age is measured from the last
      // geometry result and is never renewed by texture tracking or holding.
      const age=this.anchor?timestampMs-this.anchor.time:Infinity;
      const held=age>=0&&age<500;
      return {...result,tracking:'unknown',targetFound:false,pose:null,coreCenter:null,coreBounds:null,
        attackRegion:null,modelAttackability:'unknown',modelFillingFractionRange:null,
        evidenceTimestampMs:held?this.anchor.time:null,
        displayPose:held?heldPose:null,
        displayStatus:held?'held':'none',displayOpacity:held ? .85*Math.min(1,(500-age)/350) : 0,
        displayAgeMs:held?age:0,displayMotion:held?'visual-anchor-hold':null};
    }
  }
  globalThis.BurgerGameTracker={Tracker,relocate,sameTarget};
})();

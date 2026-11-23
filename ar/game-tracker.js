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
  const CONFIRM_MS=180,CONFIRM_FRAMES=3;
  class Tracker {
    constructor({detect=input=>globalThis.BurgerPose.detectCap(input),visual=null,geometry=null}={}){
      this.detect=detect;
      this.visual=visual??new globalThis.BurgerVisual.Tracker({detect:()=>this.observe()});
      this.geometry=geometry??new globalThis.BurgerPose.Tracker({mode:'table'});
      this.reset();
    }
    reset(){this.visual.reset();this.geometry.reset();this.anchor=null;this.pendingPose=null;
      this.exposure=null;this.lastTime=-Infinity;this.size='';}
    observe(){if(this.detection===undefined)this.detection=this.detect(this.input);return this.detection;}
    update(input,timestampMs){
      const size=input.width+'x'+input.height;
      if(timestampMs<=this.lastTime||timestampMs-this.lastTime>300||this.size!==size)this.reset();
      this.lastTime=timestampMs;this.size=size;this.input=input;this.detection=undefined;
      const visual=this.visual.update(input,timestampMs);
      const base=globalThis.BurgerPose.empty(timestampMs,visual.reason);
      if(!visual.targetFound){
        // Do not retain a core over a different reacquired object.
        this.geometry.reset();this.anchor=null;this.pendingPose=null;this.exposure=null;
        return {...base,visual,geometryState:'not-evaluated',integration:'vision-6-game'};
      }
      const observation=this.observe(),matched=observation&&sameTarget(visual.targetBounds,observation.box);
      const fit=this.geometry.update(input,timestampMs,{capObservation:matched?observation:null});
      const result={...fit,displayPose:null,displayStatus:'none',displayOpacity:0,
        visual,geometryState:fit.reason,integration:'vision-6-game',
        stabilization:{rawState:fit.modelAttackability,reason:'no-current-geometry'}};
      if(fit.tracking==='found'&&fit.targetFound&&fit.pose&&fit.evidenceTimestampMs===timestampMs&&matched){
        // The texture ROI preserves its acquisition aspect ratio. It is NOT
        // the current bun silhouette after a view change: reanchoring a fresh
        // model to that ROI displaces its core and breaks model/image alignment.
        const pose=fit.pose;
        const local=localPose(pose,observation.box,input.width,input.height);
        // An isolated competing pose cannot move the core or renew its hold.
        // A genuine new view is accepted after consistent CURRENT evidence.
        let accepted=!this.anchor||agrees(local,this.anchor.local);
        if(accepted)this.pendingPose=null;
        else {
          if(!this.pendingPose||!agrees(local,this.pendingPose.local))
            this.pendingPose={local,since:timestampMs,count:0};
          this.pendingPose.count++;
          accepted=this.pendingPose.count>=CONFIRM_FRAMES&&timestampMs-this.pendingPose.since>=CONFIRM_MS;
        }
        result.stabilization={rawState:fit.modelAttackability,
          reason:accepted?'current-geometry':'confirming-core',pendingFrames:this.pendingPose?.count??0};
        if(accepted){
          this.anchor={pose,local,box:{...visual.targetBounds},time:timestampMs};this.pendingPose=null;
          // Revocation is immediate. Reacquiring permission needs a continuous
          // run of exposed evidence; display holds never contribute to this run.
          if(fit.modelAttackability==='exposed'){
            this.exposure??={since:timestampMs,count:0};this.exposure.count++;
          } else this.exposure=null;
          const exposedReady=this.exposure&&this.exposure.count>=CONFIRM_FRAMES&&
            timestampMs-this.exposure.since>=CONFIRM_MS;
          const state=fit.modelAttackability==='exposed'&&!exposedReady?'unknown':fit.modelAttackability;
          if(fit.modelAttackability==='exposed'&&!exposedReady)result.stabilization.reason='confirming-exposure';
          return {...result,pose,coreCenter:pose.center,modelAttackability:state,
            displayPose:pose,displayStatus:'measured',displayOpacity:1,displayAgeMs:0,displayMotion:'current-contour'};
        }
      } else {
        this.pendingPose=null;
      }
      this.exposure=null;
      // Image-supported short display only. Its age is measured from the last
      // geometry result and is never renewed by texture tracking or holding.
      const age=this.anchor?timestampMs-this.anchor.time:Infinity;
      const held=age>=0&&age<500;
      return {...result,tracking:'unknown',targetFound:false,pose:null,coreCenter:null,coreBounds:null,
        attackRegion:null,modelAttackability:'unknown',modelFillingFractionRange:null,
        evidenceTimestampMs:held?this.anchor.time:null,
        displayPose:held?relocate(this.anchor.pose,this.anchor.box,visual.targetBounds,input.width,input.height):null,
        displayStatus:held?'held':'none',displayOpacity:held ? .85*Math.min(1,(500-age)/350) : 0,
        displayAgeMs:held?age:0,displayMotion:held?'visual-anchor-hold':null};
    }
  }
  globalThis.BurgerGameTracker={Tracker,relocate,sameTarget};
})();

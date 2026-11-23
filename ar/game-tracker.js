/* Game integration: vision-6 supplies image position/scale; the coarse model
 * still supplies the internal core offset and geometric exposure. Load model,
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
  class Tracker {
    constructor({detect=input=>globalThis.BurgerPose.detectCap(input),visual=null,geometry=null}={}){
      this.detect=detect;
      this.visual=visual??new globalThis.BurgerVisual.Tracker({detect:()=>this.observe()});
      this.geometry=geometry??new globalThis.BurgerPose.Tracker({mode:'table'});
      this.reset();
    }
    reset(){this.visual.reset();this.geometry.reset();this.anchor=null;this.lastTime=-Infinity;this.size='';}
    observe(){if(this.detection===undefined)this.detection=this.detect(this.input);return this.detection;}
    update(input,timestampMs){
      const size=input.width+'x'+input.height;
      if(timestampMs<=this.lastTime||timestampMs-this.lastTime>300||this.size!==size)this.reset();
      this.lastTime=timestampMs;this.size=size;this.input=input;this.detection=undefined;
      const visual=this.visual.update(input,timestampMs);
      const base=globalThis.BurgerPose.empty(timestampMs,visual.reason);
      if(!visual.targetFound){
        // Do not retain a core over a different reacquired object.
        this.geometry.reset();this.anchor=null;
        return {...base,visual,geometryState:'not-evaluated',integration:'vision-6-game'};
      }
      const observation=this.observe(),matched=observation&&sameTarget(visual.targetBounds,observation.box);
      const fit=this.geometry.update(input,timestampMs,{capObservation:matched?observation:null});
      const result={...fit,displayPose:null,displayStatus:'none',displayOpacity:0,
        visual,geometryState:fit.reason,integration:'vision-6-game'};
      if(fit.tracking==='found'&&fit.targetFound&&fit.pose&&fit.evidenceTimestampMs===timestampMs&&matched){
        const pose=relocate(fit.pose,observation.box,visual.targetBounds,input.width,input.height);
        const ratio=visual.targetBounds.width/observation.box.width;
        this.anchor={pose,box:{...visual.targetBounds},time:timestampMs};
        const bounds=fit.coreBounds?{x:pose.center.x-fit.coreBounds.width*ratio/2,
          y:pose.center.y-fit.coreBounds.height*ratio/2,width:fit.coreBounds.width*ratio,height:fit.coreBounds.height*ratio}:null;
        const region=fit.attackRegion?{...fit.attackRegion,center:{...pose.center},
          radiusX:fit.attackRegion.radiusX*ratio,radiusY:fit.attackRegion.radiusY*ratio}:null;
        return {...result,pose,coreCenter:pose.center,coreBounds:bounds,attackRegion:region,
          displayPose:pose,displayStatus:'measured',displayOpacity:1,displayAgeMs:0,displayMotion:'visual-anchor'};
      }
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

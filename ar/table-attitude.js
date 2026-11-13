/* Optional, local-only tabletop experiment. Browser orientation is a device
 * estimate, not a measured burger/table pose. No compass heading is needed.
 * receivedAtMs and frameTimeMs must share performance.now()'s clock. Arrival
 * timestamps are diagnostic approximations, not hardware camera/IMU sync.
 */
(() => {
  const MAX_AGE_MS=150, DEG=Math.PI/180;
  function estimate(sample,frameTimeMs,{source,facingMode,mode}={}) {
    const result={available:false,reason:'no-sample',frameTimeMs,sample:sample??null};
    if(source!=='camera')return {...result,reason:'not-live-camera'};
    if(mode!=='table')return {...result,reason:'not-table-mode'};
    if(facingMode!=='environment')return {...result,reason:'rear-camera-unconfirmed'};
    if(!sample||![sample.beta,sample.gamma,sample.receivedAtMs,frameTimeMs].every(Number.isFinite))return result;
    const ageMs=frameTimeMs-sample.receivedAtMs;
    if(ageMs<0||ageMs>MAX_AGE_MS)return {...result,reason:'stale-sample',ageMs};
    // Rear camera looks along -device Z. Horizontal table normal is Earth-up.
    const b=sample.beta*DEG,g=sample.gamma*DEG,a=(sample.screenAngle??0)*DEG;
    const x=-Math.cos(b)*Math.sin(g),y=Math.sin(b),z=Math.cos(b)*Math.cos(g);
    const right=x*Math.cos(a)-y*Math.sin(a),up=x*Math.sin(a)+y*Math.cos(a);
    const elevationDegrees=Math.asin(Math.max(-1,Math.min(1,z)))/DEG;
    // Model.project maps +Y to (-sin(roll), -cos(roll)) in screen pixels.
    // Its roll therefore has the opposite sign to atan2(screenRight, screenUp).
    // At the zenith roll is undefined for this rotationally symmetric model.
    const rollDegrees=Math.hypot(right,up)<.025?0:-Math.atan2(right,up)/DEG;
    if(elevationDegrees<0)return {...result,reason:'camera-points-up',ageMs,elevationDegrees};
    return {...result,available:true,reason:'available',ageMs,elevationDegrees,rollDegrees,gravity:{right,up,z}};
  }
  function constraint(hint,center,width,height,timestampMs) {
    const result={used:false,reason:hint?.reason??'disabled'};
    if(!hint?.available)return result;
    // A worker may receive an old hint: never let it outlive the source frame.
    if(!Number.isFinite(timestampMs)||timestampMs-hint.sample.receivedAtMs<0||timestampMs-hint.sample.receivedAtMs>MAX_AGE_MS)
      return {...result,reason:'stale-sample'};
    if(!center)return {...result,reason:'no-current-target'};
    // No camera intrinsics/FOV calibration yet. This first orthographic test
    // applies only near the optical centre, with the restriction shown in UI.
    const offset=Math.hypot((center.x-.5)*width,(center.y-.5)*height)/Math.min(width,height);
    if(offset>.15)return {...result,reason:'off-axis-target',offset};
    return {used:true,reason:'gravity-constrained',offset,elevationDegrees:hint.elevationDegrees,rollDegrees:hint.rollDegrees};
  }
  globalThis.BurgerTableAttitude={estimate,constraint,MAX_AGE_MS};
})();

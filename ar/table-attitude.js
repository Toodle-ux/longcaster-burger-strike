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
    // Elevation is independent of screen rotation; model roll is still visual.
    const elevationDegrees=Math.asin(Math.max(-1,Math.min(1,Math.cos(sample.beta*DEG)*Math.cos(sample.gamma*DEG))))/DEG;
    if(elevationDegrees<0)return {...result,reason:'camera-points-up',ageMs,elevationDegrees};
    return {...result,available:true,reason:'available',ageMs,elevationDegrees};
  }
  function candidate(hint,elevation,center,width,height,timestampMs) {
    const result={used:false,penalty:0,reason:hint?.reason??'disabled'};
    if(!hint?.available)return result;
    // A worker may receive an old hint: never let it outlive the source frame.
    if(!Number.isFinite(timestampMs)||timestampMs-hint.sample.receivedAtMs<0||timestampMs-hint.sample.receivedAtMs>MAX_AGE_MS)
      return {...result,reason:'stale-sample'};
    if(!center)return {...result,reason:'no-current-target'};
    // No camera intrinsics/FOV calibration yet. Use only near the optical
    // centre and a broad 15-degree dead band; do not pretend this is exact.
    const offset=Math.hypot((center.x-.5)*width,(center.y-.5)*height)/Math.min(width,height);
    if(offset>.15)return {...result,reason:'off-axis-target',offset};
    const errorDegrees=Math.abs(elevation-hint.elevationDegrees);
    return {used:true,reason:'soft-prior',offset,errorDegrees,
      penalty:.12*Math.min(1,Math.max(0,errorDegrees-15)/30)};
  }
  globalThis.BurgerTableAttitude={estimate,candidate,MAX_AGE_MS};
})();

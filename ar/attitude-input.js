/* Permission state is not evidence of live sensor data. Keep counters and
 * timestamps even for invalid events so a phone log explains silent fallback.
 * Starting/restarting a camera must not stop this independent reader.
 */
(() => {
  function createReader({target=globalThis,now=()=>performance.now()}={}) {
    let enabled=false,pending=false,generation=0,permission='not-requested',sample=null;
    let eventCount=0,validCount=0,lastEventMs=null,enabledAtMs=null,error=null;
    const listener=event=>{
      eventCount++;lastEventMs=now();
      if(![event.beta,event.gamma].every(Number.isFinite))return;
      validCount++;sample={beta:event.beta,gamma:event.gamma,
        screenAngle:target.screen?.orientation?.angle??target.orientation??0,receivedAtMs:lastEventMs};
    };
    function stop(){generation++;enabled=pending=false;sample=null;target.removeEventListener('deviceorientation',listener);}
    async function enable(){
      if(enabled||pending)return;
      const token=++generation,Sensor=target.DeviceOrientationEvent;
      error=null;
      if(!Sensor||!target.isSecureContext){permission='unsupported';return;}
      pending=true;
      try{
        // Called synchronously by a button click, before any camera await.
        const value=typeof Sensor.requestPermission==='function'?await Sensor.requestPermission():'not-required';
        if(token!==generation)return;
        permission=value;pending=false;
        if(value!=='granted'&&value!=='not-required')return;
        enabled=true;enabledAtMs=now();sample=null;
        target.addEventListener('deviceorientation',listener);
      }catch(e){if(token===generation){pending=false;permission='error';error=e.name;}}
    }
    function snapshot(){
      const time=now(),ageMs=sample?time-sample.receivedAtMs:null;
      const state=pending?'requesting':!enabled?'disabled':sample?
        ageMs<=150?'receiving':'stale':time-enabledAtMs>=3000?'no-data':'waiting';
      return {enabled,pending,permission,state,eventCount,validCount,lastEventMs,enabledAtMs,ageMs,error,sample};
    }
    return {enable,stop,snapshot,clearSample:()=>{sample=null;}};
  }
  globalThis.BurgerAttitudeInput={createReader};
})();

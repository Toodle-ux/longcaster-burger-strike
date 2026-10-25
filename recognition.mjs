// Tabletop geometry is experimental; fingers and props are not modelled.
export const MAX_EVIDENCE_AGE=250,DISPLAY_HOLD_MS=500;
export function permission(result,age) {
  if(!result||age<0||age>MAX_EVIDENCE_AGE||result.tracking!=='found'||!result.targetFound||
    !result.coreCenter||!result.attackRegion||result.evidenceTimestampMs!==result.timestampMs)return 'unknown';
  return ['exposed','blocked'].includes(result.modelAttackability)?result.modelAttackability:'unknown';
}
export function observation(result,age,frameAge,rate=1) {
  const fresh=age>=0&&age<=MAX_EVIDENCE_AGE&&frameAge<=MAX_EVIDENCE_AGE;
  const state=fresh?permission(result,age):'unknown';
  // Evidence age already includes the upstream hold. Add capture-to-now time,
  // not receipt-to-now, so a delayed Worker reply cannot restart the 500 ms hold.
  const evidenceAgeMs=result&&Number.isFinite(result.evidenceTimestampMs)?
    Math.max(0,result.timestampMs-result.evidenceTimestampMs,result.displayAgeMs??0)+Math.max(0,age)*Math.max(1,rate):Infinity;
  const visible=!!result?.displayPose&&evidenceAgeMs<DISPLAY_HOLD_MS&&
    (fresh||result.displayStatus==='held'||result.debug?.holdReady);
  const held=result?.displayStatus==='held'||!fresh;
  return {state,evidenceAgeMs,displayPose:visible?result.displayPose:null,
    displayStatus:visible?(held?'held':'measured'):'none',
    displayOpacity:!visible?0:held?Math.min(result.displayOpacity??1,.85*Math.min(1,(DISPLAY_HOLD_MS-evidenceAgeMs)/350)):result.displayOpacity??1};
}
export function sourcePoint(point,sourceWidth,sourceHeight,viewWidth,viewHeight,fit) {
  const scale=(fit==='cover'?Math.max:Math.min)(viewWidth/sourceWidth,viewHeight/sourceHeight);
  return {x:(viewWidth-sourceWidth*scale)/2+point.x*sourceWidth*scale,
    y:(viewHeight-sourceHeight*scale)/2+point.y*sourceHeight*scale};
}
export function setupRecognition({getSource,onResult}) {
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  let worker,failed=false,pending=null,generation=0,disposed=false,timer;
  let video=null,type='demo',result=null,capturedAt=-Infinity,lastCapture=-Infinity,lastStamp=-Infinity;
  let frameCallback=null,watchGeneration=0,usesFrameCallbacks=false,frameSerial=0,analyzedSerial=-1;
  let lastMediaTime=-1,lastFrameAt=-Infinity,frameIntervalMs=null,mediaIntervalMs=null,presentedFramesDelta=null,lastPresented=null;
  let processingMs=null,readbackMs=null,turnaroundMs=null,frameStaleEvents=0,resultExpiredEvents=0,wasFrameStale=false,wasExpired=false;
  const records=[];
  const finite=value=>Number.isFinite(value)?Math.round(value*10)/10:null;
  function record(event,extra={}) {
    records.push({event,timeMs:finite(performance.now()),source:type,mediaTime:finite(video?.currentTime),
      frameIntervalMs:finite(frameIntervalMs),mediaIntervalMs:finite(mediaIntervalMs),presentedFramesDelta,
      processingMs:finite(processingMs),readbackMs:finite(readbackMs),turnaroundMs:finite(turnaroundMs),...extra});
    if(records.length>600)records.shift();
  }
  try {
    worker=new Worker(new URL('./ar/worker.js?v=8',import.meta.url));
    worker.onmessage=({data})=>{
      const job=pending;pending=null;
      if(!job||data.generation!==generation||job.generation!==generation||disposed)return;
      if(data.error){result=null;record('analysis-error');publish();return;}
      result=data.result;capturedAt=job.capturedAt;readbackMs=job.readbackMs;
      processingMs=data.processingMs;turnaroundMs=performance.now()-capturedAt;
      record('result',{tracking:result.tracking,geometry:result.modelAttackability,reason:result.reason,
        evidenceAgeMs:finite(observation(result,turnaroundMs,0).evidenceAgeMs),displayMotion:result.displayMotion});
      publish();
    };
    worker.onerror=()=>{failed=true;pending=null;result=null;record('worker-error');publish();};
  } catch {failed=true;}
  function invalidate() {
    generation++;result=null;capturedAt=-Infinity;analyzedSerial=-1;lastStamp=-Infinity;
    lastFrameAt=-Infinity;lastMediaTime=-1;lastPresented=null;wasFrameStale=wasExpired=false;
  }
  function observeFrame(now,mediaTime,presented=null) {
    if(Number.isFinite(lastFrameAt))frameIntervalMs=now-lastFrameAt;
    if(lastMediaTime>=0)mediaIntervalMs=(mediaTime-lastMediaTime)*1000;
    presentedFramesDelta=presented!==null&&lastPresented!==null?presented-lastPresented:null;
    lastFrameAt=now;lastMediaTime=mediaTime;lastPresented=presented;frameSerial++;
    // Retain long callback gaps even if a later normal frame arrives before analysis.
    if(frameIntervalMs>MAX_EVIDENCE_AGE)record('frame-gap');
  }
  function watchFrames() {
    if(!usesFrameCallbacks||!video||disposed)return;
    const owner=video,token=watchGeneration;
    frameCallback=owner.requestVideoFrameCallback((now,metadata)=>{
      if(owner!==video||token!==watchGeneration||disposed)return;
      frameCallback=null;
      if(!document.hidden)observeFrame(now,metadata.mediaTime,metadata.presentedFrames);
      watchFrames();
    });
  }
  function stopFrames() {
    watchGeneration++;
    if(frameCallback!==null)video?.cancelVideoFrameCallback?.(frameCallback);
    frameCallback=null;
  }
  function changeSource() {
    const next=getSource();if(next.type===type&&next.video===video)return;
    stopFrames();
    for(const event of ['pause','seeking','loadedmetadata','emptied','ended'])video?.removeEventListener(event,invalidate);
    type=next.type;video=next.video;invalidate();frameSerial=0;
    frameIntervalMs=mediaIntervalMs=presentedFramesDelta=null;processingMs=readbackMs=turnaroundMs=null;
    frameStaleEvents=resultExpiredEvents=0;records.length=0;
    usesFrameCallbacks=typeof video?.requestVideoFrameCallback==='function';
    for(const event of ['pause','seeking','loadedmetadata','emptied','ended'])video?.addEventListener(event,invalidate);
    watchFrames();
  }
  function current() {
    changeSource();
    const now=performance.now(),age=now-capturedAt,frameAge=now-lastFrameAt;
    const live=type!=='demo'&&video&&!video.paused&&!video.ended&&!video.seeking&&!document.hidden;
    const view=observation(live?result:null,age,frameAge,video?.playbackRate??1);
    return {type,video,result,...view,failed,
      diagnostics:{live:!!live,frameClock:usesFrameCallbacks?'video-frame-callback':'currentTime-poll',
        frameIntervalMs:finite(frameIntervalMs),frameAgeMs:finite(frameAge),processingMs:finite(processingMs),
        readbackMs:finite(readbackMs),turnaroundMs:finite(turnaroundMs),resultAgeMs:finite(age),
        evidenceAgeMs:finite(view.evidenceAgeMs),frameStale:!!live&&Number.isFinite(lastFrameAt)&&frameAge>MAX_EVIDENCE_AGE,
        resultExpired:!!live&&!!result&&age>MAX_EVIDENCE_AGE,frameStaleEvents,resultExpiredEvents}};
  }
  function publish() {
    const snapshot=current(),d=snapshot.diagnostics;
    if(d.frameStale&&!wasFrameStale){frameStaleEvents++;record('frame-stale',{frameAgeMs:d.frameAgeMs});}
    if(d.resultExpired&&!wasExpired){resultExpiredEvents++;record('result-expired',{resultAgeMs:d.resultAgeMs});}
    wasFrameStale=d.frameStale;wasExpired=d.resultExpired;
    d.frameStaleEvents=frameStaleEvents;d.resultExpiredEvents=resultExpiredEvents;
    onResult(snapshot);
  }
  function tick() {
    if(disposed)return;
    changeSource();const now=performance.now();
    if(type!=='demo'&&video&&video.readyState>=2&&!video.paused&&!video.seeking&&!video.ended&&!document.hidden) {
      if(!usesFrameCallbacks&&video.currentTime!==lastMediaTime)observeFrame(now,video.currentTime);
      if(frameSerial!==analyzedSerial&&Number.isFinite(lastFrameAt)&&!pending&&!failed&&now-lastCapture>=100) {
        const stamp=type==='video'?video.currentTime*1000:now;
        if(stamp<=lastStamp||stamp-lastStamp>DISPLAY_HOLD_MS&&Number.isFinite(lastStamp)) {
          generation++;result=null;
        }
        lastStamp=stamp;analyzedSerial=frameSerial;lastCapture=now;
        const w=Math.min(video.videoWidth,640),h=Math.round(video.videoHeight*w/video.videoWidth);
        if(w&&h) {
          if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
          try {
            const start=performance.now();ctx.drawImage(video,0,0,w,h);const pixels=ctx.getImageData(0,0,w,h);
            pending={generation,capturedAt:start,readbackMs:performance.now()-start};
            worker.postMessage({generation,width:w,height:h,buffer:pixels.data.buffer,stamp},[pixels.data.buffer]);
          } catch {failed=true;pending=null;}
        }
      }
    }
    publish();timer=setTimeout(tick,50);
  }
  document.addEventListener('visibilitychange',invalidate);
  tick();
  return {current,reset:invalidate,
    diagnostics(){return {schema:'burger-runtime/v8',release:'v8',limits:{freshMs:MAX_EVIDENCE_AGE,displayHoldMs:DISPLAY_HOLD_MS},
      source:type,dimensions:video?{width:video.videoWidth,height:video.videoHeight}:null,
      snapshot:current().diagnostics,records:[...records]};},
    stop(){disposed=true;invalidate();stopFrames();clearTimeout(timer);},
    resume(){if(!disposed)return;disposed=false;invalidate();watchFrames();tick();}};
}

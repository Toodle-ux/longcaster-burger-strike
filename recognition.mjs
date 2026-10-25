// Experimental tabletop gameplay adapter. Upstream actual attackability stays
// unknown: its geometric model does not include fingers or other props.
export const MAX_EVIDENCE_AGE=600;
export function permission(result,age) {
  if(!result||age<0||age>MAX_EVIDENCE_AGE||result.tracking!=='found'||!result.targetFound||
    !result.coreCenter||!result.attackRegion||result.evidenceTimestampMs!==result.timestampMs)return 'unknown';
  return ['exposed','blocked'].includes(result.modelAttackability)?result.modelAttackability:'unknown';
}
export function sourcePoint(point,sourceWidth,sourceHeight,viewWidth,viewHeight,fit) {
  const scale=(fit==='cover'?Math.max:Math.min)(viewWidth/sourceWidth,viewHeight/sourceHeight);
  return {x:(viewWidth-sourceWidth*scale)/2+point.x*sourceWidth*scale,
    y:(viewHeight-sourceHeight*scale)/2+point.y*sourceHeight*scale};
}
export function setupRecognition({getSource,onResult}) {
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  let worker=null,failed=false,busy=false,generation=0,disposed=false,timer;
  let video=null,type='demo',lastTime=-1,lastFrameAt=-Infinity,result=null,capturedAt=-Infinity,pendingAt=0;
  try {
    worker=new Worker(new URL('./ar/worker.js?v=7',import.meta.url));
    worker.onmessage=({data})=>{
      busy=false;
      if(data.generation!==generation||disposed)return;
      if(data.error){result=null;return;}
      result=data.result;capturedAt=pendingAt;publish();
    };
    worker.onerror=()=>{failed=true;busy=false;result=null;publish();};
  } catch {failed=true;}
  function invalidate(){generation++;result=null;lastTime=-1;lastFrameAt=-Infinity;}
  function changeSource() {
    const next=getSource();if(next.type===type&&next.video===video)return;
    for(const event of ['pause','seeking','loadedmetadata','emptied','ended'])video?.removeEventListener(event,invalidate);
    type=next.type;video=next.video;invalidate();
    for(const event of ['pause','seeking','loadedmetadata','emptied','ended'])video?.addEventListener(event,invalidate);
  }
  function current() {
    changeSource();
    const live=type!=='demo'&&video&&!video.paused&&!video.ended&&!video.seeking&&!document.hidden;
    const age=performance.now()-capturedAt;
    const fresh=live&&performance.now()-lastFrameAt<=MAX_EVIDENCE_AGE;
    return {type,video,result:fresh&&age<=MAX_EVIDENCE_AGE?result:null,
      state:fresh?permission(result,age):'unknown',failed};
  }
  function publish(){onResult(current());}
  function tick() {
    if(disposed)return;
    changeSource();
    if(type!=='demo'&&video&&video.readyState>=2&&!video.paused&&!video.seeking&&!video.ended&&!document.hidden) {
      if(video.currentTime!==lastTime) {
        lastFrameAt=performance.now();
        if(!busy&&!failed) {
          if(lastTime>=0&&(video.currentTime<lastTime||video.currentTime-lastTime>.6))invalidate();
          lastTime=video.currentTime;
          const w=Math.min(video.videoWidth,640),h=Math.round(video.videoHeight*w/video.videoWidth);
          if(w&&h) {
            canvas.width=w;canvas.height=h;
            try {
              ctx.drawImage(video,0,0,w,h);const pixels=ctx.getImageData(0,0,w,h);
              busy=true;pendingAt=performance.now();
              worker.postMessage({generation,width:w,height:h,buffer:pixels.data.buffer,
                stamp:type==='video'?video.currentTime*1000:pendingAt},[pixels.data.buffer]);
            } catch {failed=true;busy=false;}
          }
        }
      }
    }
    publish();timer=setTimeout(tick,120);
  }
  document.addEventListener('visibilitychange',invalidate);
  tick();
  return {current,reset:invalidate,stop(){disposed=true;invalidate();clearTimeout(timer);},
    resume(){if(!disposed)return;disposed=false;invalidate();tick();}};
}

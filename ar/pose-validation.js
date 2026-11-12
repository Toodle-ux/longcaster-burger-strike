(() => {
  const $=id=>document.getElementById(id),api=globalThis.BurgerPose,modelAPI=globalThis.BurgerModel;
  let tracker=new api.Tracker({mode:'table'});
  const coreDisplay=new globalThis.BurgerCoreDisplay();
  const mesh=modelAPI.mesh(api.geometry),video=$('video'),still=$('still'),canvas=$('view'),paint=canvas.getContext('2d');
  const buffer=document.createElement('canvas'),pixels=buffer.getContext('2d',{willReadFrequently:true});
  let mode=null,stream=null,url=null,generation=0,source='',lastTime=-1,lastCompute=-Infinity,lastPaint=0,out=api.empty(0),elapsed=0;
  let records=[],marks=[],counts={found:0,unknown:0,lost:0},sourceSize=null,lastAnalyzedAt=0,lastSourceStamp=0;
  let frameCallback=null,frameSerial=0,analyzedSerial=-1,previousVideoFrame=null,frameTiming=null;
  let frameIntervals=[],analysisTimes=[],staleEvents=0,wasStale=false,previousAnalysis=null;
  let attitudeSample=null,attitudeEnabled=false,attitudePending=false,attitudeGeneration=0,attitudeState='未开启',attitudeHint=null;
  const attitudeReasons={'not-live-camera':'照片／录像不使用当前手机姿态','not-table-mode':'自由手持使用视觉判断',
    'rear-camera-unconfirmed':'后置摄像头方向未确认','no-sample':'尚未收到有效姿态','stale-sample':'姿态数据已过期',
    'camera-points-up':'镜头朝上，不适用桌面假设','off-axis-target':'目标偏离画面中央，使用视觉判断',
    'no-current-target':'暂无视觉目标','soft-prior':'姿态辅助选择视觉候选','available':'姿态可用','disabled':'使用视觉判断'};
  function onAttitude(event){
    if(![event.beta,event.gamma].every(Number.isFinite))return;
    attitudeSample={beta:event.beta,gamma:event.gamma,screenAngle:screen.orientation?.angle??window.orientation??0,receivedAtMs:performance.now()};
    attitudeState='已收到数据';
  }
  function disableAttitude(message='未开启'){
    attitudeGeneration++;attitudeEnabled=attitudePending=false;attitudeSample=attitudeHint=null;attitudeState=message;
    window.removeEventListener('deviceorientation',onAttitude);
    $('attitude').textContent='开启姿态辅助';$('attitude').setAttribute('aria-pressed','false');
  }
  $('attitude').onclick=async()=>{
    if(attitudeEnabled||attitudePending){disableAttitude();invalidate('no-supported-target');return;}
    const Sensor=window.DeviceOrientationEvent,token=++attitudeGeneration;
    if(!Sensor||!isSecureContext){disableAttitude('此浏览器或地址不支持');report();return;}
    attitudePending=true;attitudeState='等待授权';$('attitude').textContent='取消姿态辅助';report();
    try{
      // Must stay in this click handler for iOS permission's user gesture.
      const permission=typeof Sensor.requestPermission==='function'?await Sensor.requestPermission():'granted';
      if(token!==attitudeGeneration)return;
      if(permission!=='granted'){disableAttitude('未授权');report();return;}
      attitudePending=false;attitudeEnabled=true;attitudeState='等待数据';
      $('attitude').textContent='关闭姿态辅助';$('attitude').setAttribute('aria-pressed','true');
      window.addEventListener('deviceorientation',onAttitude);report();
    }catch{if(token===attitudeGeneration){disableAttitude('姿态不可用');report();}}
  };
  $('attitude-apply').onchange=()=>{invalidate('no-supported-target');lastTime=-1;};
  const usesFrameCallbacks=typeof video.requestVideoFrameCallback==='function';
  function observeFrame(now,metadata){
    frameCallback=null;
    if(previousVideoFrame){
      frameTiming={callbackIntervalMs:now-previousVideoFrame.now,
        mediaIntervalMs:(metadata.mediaTime-previousVideoFrame.mediaTime)*1000,
        presentedFramesDelta:metadata.presentedFrames-previousVideoFrame.presentedFrames};
      frameIntervals.push(frameTiming.callbackIntervalMs);if(frameIntervals.length>300)frameIntervals.shift();
    }
    previousVideoFrame={now,mediaTime:metadata.mediaTime,presentedFrames:metadata.presentedFrames};frameSerial++;
    watchFrames();
  }
  function watchFrames(){if(usesFrameCallbacks&&mode&&frameCallback===null)frameCallback=video.requestVideoFrameCallback(observeFrame);}
  function resetTiming(){
    if(frameCallback!==null)video.cancelVideoFrameCallback(frameCallback);
    frameCallback=null;frameSerial=0;analyzedSerial=-1;previousVideoFrame=null;frameTiming=null;
    frameIntervals=[];analysisTimes=[];staleEvents=0;wasStale=false;previousAnalysis=null;
  }
  const p95=values=>values.length?[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*.95)]:null;
  const reasons={'current-model-fit':'当前帧通过模型拟合；姿态为近似值','competing-poses':'多种倾角都能匹配，姿态不确定',
    'no-complete-cap':'未找到足够完整的上面包边界，倾角未知',
    'short-gap-display-only':'短暂缺少证据','weak-model-fit':'轮廓或分层证据不足','no-supported-target':'没有找到支持当前模型的目标',
    'continuity-rejected':'新候选的位置或大小跳变，暂不接受','uncertain-placement':'当前候选的中心或大小存在分歧',
    'multiple-targets':'多个位置的拟合分数接近，暂不选择','stopped':'已停止','paused':'暂停核对，实时跟踪已清除','stale':'画面未更新，结果已过期','hidden':'页面在后台'};
  function resetLog(){records=[];marks=[];counts={found:0,unknown:0,lost:0};$('marks').textContent='0 条人工核对';}
  function live(){return (mode==='video'||mode==='camera')&&!video.paused&&!document.hidden;}
  function report() {
    const assist=out.attitudeAssist,reason=assist?.reason??attitudeHint?.reason;
    $('attitude-status').textContent=`姿态：${attitudeState} · `+
      (!attitudeEnabled?'使用视觉判断':!$('attitude-apply').checked?'仅记录，使用视觉判断':attitudeReasons[reason]??'等待相机分析')+
      (Number.isFinite(attitudeHint?.elevationDegrees)?` · 镜头向下约 ${attitudeHint.elevationDegrees.toFixed(1)}° · 数据年龄 ${Math.round(attitudeHint.ageMs)} ms`:'');
    const found=out.tracking==='found',held=out.tracking==='unknown';
    $('tracking').textContent=found?(out.poseStatus==='ambiguous'?'找到候选 · 姿态不确定':live()?'正在匹配':'静态候选'):held?'未知 · 保留显示':'未找到／已停止';
    $('tracking').style.background=found&&out.poseStatus!=='ambiguous'?'#28614a':held||out.poseStatus==='ambiguous'?'#705b30':'#48534e';
    $('reason').textContent=(reasons[out.reason]??out.reason)+(held?`；${out.displayMotion==='image-translation'?'画面匹配辅助的短时位置':'保留最后位置'} ${Math.round(out.displayAgeMs)} / ${api.HOLD_MS} ms（不可攻击）`:'');
    const p=out.pose,score=out.debug?.fit?.score;
    $('pose-metrics').textContent=`${elapsed.toFixed(1)} ms / 分析帧`+(p?` · 倾角约 ${p.elevationDegrees}° · 旋转约 ${p.rollDegrees.toFixed(0)}°`:'')+
      (out.elevationRangeDegrees?` · 候选倾角 ${out.elevationRangeDegrees.join('–')}°`:'')+
      (score!==undefined?` · 拟合分数 ${score.toFixed(2)}（非准确率）`:'')+(out.viewClass?` · 视角：${{unknown:'不确定',side:'接近平视','oblique-top':'俯视／斜俯视'}[out.viewClass]}`:'')+(out.modelCenterSurface?` · 模型中心前：${{bun:'面包',filling:'夹心',unknown:'未知'}[out.modelCenterSurface]}（未检查手指）`:'');
    $('count').textContent=`本段分析 ${records.length} 帧：匹配 ${counts.found}／未知 ${counts.unknown}／丢失 ${counts.lost}。这是输出计数，不是准确率；录像不等于手机实时测试。`;
    $('output').textContent=JSON.stringify({...out,isLive:live()},null,2);
    $('timing').textContent=`近 ${analysisTimes.length} 次分析 P95：${p95(analysisTimes)?.toFixed(1)??'—'} ms · `+
      (usesFrameCallbacks?`浏览器视频帧通知间隔 P95：${p95(frameIntervals)?.toFixed(1)??'—'} ms`:'此浏览器无视频帧通知 API，使用播放时间兜底')+
      ` · 画面超时 ${staleEvents} 次。通知间隔含浏览器调度，不能直接等同摄像头硬件掉帧。`;
    const range=out.modelFillingFractionRange;
    $('region-status').textContent='小区域几何预览：'+({exposed:'通过',blocked:'面包遮挡',unknown:'未知'}[out.modelAttackability]??'未知')+
      (range?` · 候选姿态下夹心占比 ${range.map(v=>Math.round(v*100)+'%').join('–')}`:'')+' · 实际攻击许可：未知';
  }
  function draw() {
    // Keep the last unannotated frame available if decoding stops; otherwise
    // an old marker could remain painted even after its state has expired.
    const element=mode==='image'?still:video.readyState>=2?video:buffer;
    if(!mode||!(element.naturalWidth||element.videoWidth||element.width))return;
    paint.drawImage(element,0,0,canvas.width,canvas.height);
    if($('cap').checked&&out.bunContour?.length){
      paint.save();paint.strokeStyle='#ff66ec';paint.lineWidth=2*canvas.width/canvas.clientWidth;paint.beginPath();
      out.bunContour.forEach((p,i)=>i?paint.lineTo(p.x*canvas.width,p.y*canvas.height):paint.moveTo(p.x*canvas.width,p.y*canvas.height));
      paint.closePath();paint.stroke();paint.restore();
    }
    const pose=$('raw').checked?out.pose:out.displayPose;if(!pose||$('overlay').value==='none'){coreDisplay.reset();return;}
    paint.save();const held=out.displayStatus==='held';if(held)paint.globalAlpha=out.displayOpacity;
    const p={x:pose.center.x*canvas.width,y:pose.center.y*canvas.height,scale:pose.scalePerSourceWidth*canvas.width,elevation:pose.elevationDegrees,roll:pose.rollDegrees};
    if(!$('raw').checked){
      const ratio=canvas.width/canvas.clientWidth;
      const point=coreDisplay.step({x:p.x/ratio,y:p.y/ratio},performance.now());p.x=point.x*ratio;p.y=point.y*ratio;
    }else coreDisplay.reset();
    if(held||$('overlay').value==='core') {
      const x=p.x,y=p.y,r=8*canvas.width/canvas.clientWidth;paint.strokeStyle='#fff';paint.lineWidth=2*canvas.width/canvas.clientWidth;paint.beginPath();paint.moveTo(x-r,y);paint.lineTo(x+r,y);paint.moveTo(x,y-r);paint.lineTo(x,y+r);paint.stroke();
      if(held){paint.setLineDash([r*.5,r*.5]);paint.beginPath();paint.arc(x,y,r*1.8,0,Math.PI*2);paint.stroke();paint.font=`${r*1.5}px sans-serif`;paint.fillStyle='#fff';paint.fillText('短时位置 · 未知',x+r*2.5,y);}
    }else modelAPI.draw(paint,mesh,p,{opacity:.24,wire:$('overlay').value==='wire',markerSize:8,uiScale:canvas.width/canvas.clientWidth});
    // Show the actual projected 2 mm radius, not a fixed-size HUD circle.
    // Its colour comes from current, unsmoothed evidence across candidate poses.
    if(out.attackRegion&&!held){
      paint.strokeStyle={exposed:'#74ffc0',blocked:'#ff7979',unknown:'#ffe083'}[out.modelAttackability];
      paint.lineWidth=2*canvas.width/canvas.clientWidth;paint.setLineDash([]);paint.beginPath();
      paint.arc(p.x,p.y,pose.scalePerSourceWidth*canvas.width*out.attackRegion.radiusMm,0,Math.PI*2);paint.stroke();
    }
    paint.restore();
  }
  function analyze(element,temporal) {
    const w=element.videoWidth||element.naturalWidth,h=element.videoHeight||element.naturalHeight;if(!w||!h)return;
    // Match the replay benchmark resolution; preserve source aspect ratio.
    const bw=Math.min(w,640),bh=Math.round(h*bw/w),vw=Math.min(w,1280),vh=Math.round(h*vw/w);
    if(buffer.width!==bw||buffer.height!==bh){buffer.width=bw;buffer.height=bh;}
    if(canvas.width!==vw||canvas.height!==vh){canvas.width=vw;canvas.height=vh;}
    sourceSize={width:w,height:h};pixels.drawImage(element,0,0,bw,bh);
    const start=performance.now();lastAnalyzedAt=start;
    // Replay continuity follows source time, so 0.5x playback does not change
    // the apparent physical speed or double the number of seconds held in it.
    lastSourceStamp=mode==='video'?video.currentTime*1000:start;
    const image=pixels.getImageData(0,0,bw,bh),readbackMs=performance.now()-start;
    attitudeHint=globalThis.BurgerTableAttitude.estimate(attitudeEnabled?attitudeSample:null,start,
      {source:mode,facingMode:stream?.getVideoTracks()[0]?.getSettings().facingMode,mode:$('tracking-mode').value});
    out=tracker.update(image,lastSourceStamp,{temporal,tableAttitude:$('attitude-apply').checked?attitudeHint:null});elapsed=performance.now()-start;
    analysisTimes.push(elapsed);if(analysisTimes.length>300)analysisTimes.shift();
    records.push({mediaTime:mode==='video'?video.currentTime:null,processingMs:elapsed,readbackMs,
      analysisIntervalMs:previousAnalysis===null?null:start-previousAnalysis,frameTiming,staleEvents,isLive:temporal,
      attitudeInput:attitudeHint,attitudeApplied:$('attitude-apply').checked,...out});
    previousAnalysis=start;counts[out.tracking]++;
    $('empty').hidden=true;report();draw();
  }
  function invalidate(reason){tracker.reset();coreDisplay.reset();out=api.empty(performance.now(),reason);report();draw();}
  function stop() {
    disableAttitude();
    resetTiming();
    generation++;mode=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;video.removeAttribute('src');video.load();still.removeAttribute('src');
    if(url)URL.revokeObjectURL(url);url=null;lastTime=-1;lastCompute=-Infinity;$('playback').hidden=true;invalidate('stopped');paint.clearRect(0,0,canvas.width,canvas.height);$('empty').hidden=false;
  }
  $('file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;stop();resetLog();const token=generation;source=file.name;url=URL.createObjectURL(file);
    try {
      if(file.type.startsWith('image/')){mode='image';still.src=url;await still.decode();if(token!==generation)return;analyze(still,false);}
      else {
        mode='video';video.src=url;await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});if(token!==generation)return;
        $('seek').max=video.duration;$('seek').value=0;$('playback').hidden=false;video.playbackRate=Number($('speed').value);watchFrames();await video.play();
      }
      if(token===generation)$('notice').textContent='本机素材：'+file.name+'。尺寸固定；点击画面可限定目标搜索范围。';
    }catch{if(token===generation){stop();$('notice').textContent='素材无法解码，请尝试 JPEG、PNG 或 H.264 MP4。';}}
    event.target.value='';
  };
  $('camera').onclick=async()=>{
    stop();resetLog();const token=generation;
    if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){$('notice').textContent='此地址不能开启摄像头，需要 HTTPS；电脑可先回放本机视频。';return;}
    $('notice').textContent='等待摄像头权限…';
    try {
      const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
      if(token!==generation){media.getTracks().forEach(t=>t.stop());return;}stream=media;mode='camera';source='camera';video.srcObject=media;watchFrames();await video.play();
      if(token!==generation)return;media.getVideoTracks()[0].addEventListener('ended',()=>{if(stream===media)stop();});$('notice').textContent='摄像头已开启。先检查明显侧视的贴合情况，再测试旋转、遮挡和移出画面。';
    }catch(error){if(token===generation){stop();$('notice').textContent='摄像头未开启：'+error.name+'。可先打开本机视频。';}}
  };
  $('stop').onclick=stop;
  $('play').onclick=()=>{if(video.paused)video.play().catch(()=>{});else video.pause();};
  $('speed').onchange=()=>{video.playbackRate=Number($('speed').value);};
  $('seek').oninput=()=>{invalidate('paused');lastTime=-1;video.currentTime=Number($('seek').value);};
  video.addEventListener('pause',()=>{if(mode==='video')invalidate('paused');});
  video.addEventListener('seeked',()=>{if(mode==='video'&&video.paused){analyze(video,false);$('time').textContent=video.currentTime.toFixed(1)+' s';}});
  $('reset').onclick=()=>{invalidate('no-supported-target');lastTime=-1;if(mode==='image')analyze(still,false);};
  $('overlay').onchange=draw;$('raw').onchange=draw;
  $('cap').onchange=draw;
  $('tracking-mode').onchange=()=>{
    tracker=new api.Tracker({mode:$('tracking-mode').value});resetLog();invalidate('no-supported-target');lastTime=-1;
    if(mode==='image'||mode==='video'&&video.paused)analyze(mode==='image'?still:video,false);
  };
  canvas.onclick=event=>{
    if(!mode)return;const r=canvas.getBoundingClientRect(),s=Math.min(r.width/canvas.width,r.height/canvas.height);
    const x=(event.clientX-r.left-(r.width-canvas.width*s)/2)/(canvas.width*s),y=(event.clientY-r.top-(r.height-canvas.height*s)/2)/(canvas.height*s);
    if(x<0||x>1||y<0||y>1)return;tracker.select(x,y);out=api.empty(performance.now());lastTime=-1;
    if(mode==='image'||(mode==='video'&&video.paused))analyze(mode==='image'?still:video,false);
  };
  $('mark').onclick=()=>{marks.push({mediaTime:mode==='video'?video.currentTime:null,truth:$('truth').value,observation:out});$('marks').textContent=marks.length+' 条人工核对';};
  $('export').onclick=()=>{
    const result={schema:'burger-pose-validation/v2',source,sourceSize,geometry:api.geometry,projection:'orthographic-approximation',userAgent:navigator.userAgent,
      attitudeTiming:'performance-ms event arrival and image readback; not hardware synchronized',
      timestampClock:mode==='video'?'media-ms':'performance-ms',holdMs:api.HOLD_MS,
      trackingMode:$('tracking-mode').value,
      diagnostics:{usesFrameCallbacks,analysisP95Ms:p95(analysisTimes),videoCallbackP95Ms:p95(frameIntervals),staleEvents},
      attackRegionRule:globalThis.BurgerAttackRegion.RULE,
      camera:stream?.getVideoTracks()[0]?.getSettings()??null,counts,records,marks};
    const blobURL=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=blobURL;a.download='burger-pose-validation.json';a.click();setTimeout(()=>URL.revokeObjectURL(blobURL),1000);
  };
  $('fullscreen').onclick=async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.fullscreenEnabled)await document.documentElement.requestFullscreen();else $('notice').textContent='此浏览器不支持整页全屏，可继续在当前窗口测试。';}catch{$('notice').textContent='全屏请求未成功。';}
  };
  function tick(now) {
    if(live()) {
      const hasNewFrame=usesFrameCallbacks?frameSerial!==analyzedSerial:lastTime!==video.currentTime;
      if(video.readyState>=2&&!video.seeking&&now-lastCompute>=80&&hasNewFrame){lastCompute=now;lastTime=video.currentTime;analyzedSerial=frameSerial;analyze(video,true);if(mode==='video'){$('seek').value=video.currentTime;$('time').textContent=video.currentTime.toFixed(1)+' s';}}
      // Frame freshness and display retention are separate. A decoder/camera
      // stall downgrades to unknown; it cannot silently extend the hold forever.
      const stale=now-(usesFrameCallbacks?(previousVideoFrame?.now??lastAnalyzedAt):lastAnalyzedAt)>250;
      if(stale&&!wasStale)staleEvents++;wasStale=stale;
      if(stale&&out.displayPose){out=tracker.missing(lastSourceStamp+(now-lastAnalyzedAt)*(mode==='video'?video.playbackRate:1),'stale');report();}
      if(now-lastPaint>=33){lastPaint=now;draw();}
    }
    requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){attitudeSample=null;invalidate('hidden');}else{lastTime=-1;tracker.reset();}});
  window.addEventListener('pagehide',stop);window.addEventListener('resize',draw);report();requestAnimationFrame(tick);
})();

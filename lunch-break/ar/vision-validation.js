(() => {
  const $=id=>document.getElementById(id),video=$('video'),still=$('still'),canvas=$('view'),paint=canvas.getContext('2d');
  const buffer=document.createElement('canvas'),pixels=buffer.getContext('2d',{willReadFrequently:true});
  const tracker=new BurgerVisual.Tracker();let mode=null,stream=null,url=null,generation=0,rows=[],marks=[],out=null,source='';
  let serial=0,analyzed=-1,callback=null,lastMedia=-1,lastFrameAt=0,lastWork=0;
  const hasCallbacks=typeof video.requestVideoFrameCallback==='function';
  const reasons={'no-detection':'未检测到面包','confirming-detection':'等待连续检测确认','not-enough-texture':'纹理不足 · 请停稳，若模糊请稍微拉远',
    acquired:'检测初始化','image-track':'图像纹理跟踪','image-track-verified':'图像跟踪＋检测校验','image-track-local':'图像跟踪＋局部夹层确认',
    'texture-track-failed':'纹理匹配失败 · 请停稳并检查清晰度','detector-disagreement':'图像跟踪与检测不一致','detection-timeout':'检测确认已过期','out-of-frame':'目标移出画面'};
  function watch(){if(hasCallbacks&&mode&&callback===null)callback=video.requestVideoFrameCallback(now=>{callback=null;serial++;lastFrameAt=now;watch();});}
  function clear(){tracker.reset();out=null;$('state').textContent='等待重新定位';$('output').textContent='';}
  function draw(){
    const element=mode==='image'?still:video;if(!(element.naturalWidth||element.videoWidth))return;
    paint.drawImage(element,0,0,canvas.width,canvas.height);
    if(!out)return;const ratio=canvas.width/canvas.clientWidth;
    if(out.detection){paint.strokeStyle='#ff79df';paint.lineWidth=ratio;paint.beginPath();out.detection.contour.forEach((p,i)=>i?paint.lineTo(p.x,p.y):paint.moveTo(p.x,p.y));paint.closePath();paint.stroke();}
    if(out.targetBounds){const b=out.targetBounds;paint.strokeStyle='#77edc5';paint.lineWidth=2*ratio;paint.strokeRect(b.x,b.y,b.width,b.height);
      paint.strokeStyle='#fff';paint.beginPath();paint.moveTo(out.anchor.x-6*ratio,out.anchor.y);paint.lineTo(out.anchor.x+6*ratio,out.anchor.y);paint.moveTo(out.anchor.x,out.anchor.y-6*ratio);paint.lineTo(out.anchor.x,out.anchor.y+6*ratio);paint.stroke();
      for(const p of out.points){paint.fillStyle=p.region==='filling'?'#72ccff':'#fff';paint.beginPath();paint.arc(p.x,p.y,ratio,0,2*Math.PI);paint.fill();}}
  }
  function analyze(element,temporal=true){
    const w=element.videoWidth||element.naturalWidth,h=element.videoHeight||element.naturalHeight;if(!w||!h)return;
    const width=Math.min(w,640),height=Math.round(h*width/w);
    if(buffer.width!==width||buffer.height!==height){buffer.width=canvas.width=width;buffer.height=canvas.height=height;}
    const start=performance.now();pixels.drawImage(element,0,0,width,height);const input=pixels.getImageData(0,0,width,height),readbackMs=performance.now()-start;
    if(!temporal)tracker.reset();
    const stamp=mode==='video'?video.currentTime*1000:start;
    const detection=$('compare').checked||!temporal?BurgerPose.detectCap(input):undefined;
    out=tracker.update(input,stamp,{detection});
    const durationMs=performance.now()-start;
    rows.push({mediaTime:mode==='video'?video.currentTime:null,sourceSize:{width:w,height:h},analysisSize:{width,height},durationMs,readbackMs,
      frameSerial:serial,frameAgeMs:performance.now()-lastFrameAt,...out});
    // Confirmation is an internal step, not a change of tracking state.
    $('state').textContent=out.state==='tracking'?'正在跟踪':({candidate:'检测候选',unknown:'未知',lost:'丢失'}[out.state])+' · '+reasons[out.reason];
    $('metrics').textContent=`${durationMs.toFixed(1)} ms／分析 · 有效匹配点 ${out.inlierPoints} · 本段 ${rows.length} 次分析`+
      (out.lastDetectionAgeMs!==null?` · 上次检测确认 ${Math.round(out.lastDetectionAgeMs)} ms 前`:'');
    $('output').textContent=JSON.stringify(out,null,2);draw();
  }
  function stop(){
    generation++;if(callback!==null)video.cancelVideoFrameCallback(callback);callback=null;
    mode=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;video.removeAttribute('src');video.load();
    if(url)URL.revokeObjectURL(url);url=null;serial=0;analyzed=-1;lastMedia=-1;clear();
    $('play').hidden=$('seek').hidden=true;paint.clearRect(0,0,canvas.width,canvas.height);
  }
  function newLog(){rows=[];marks=[];$('marks').textContent='0 条人工备注';}
  $('file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;stop();newLog();const token=generation;source=file.name;url=URL.createObjectURL(file);
    try{if(file.type.startsWith('image/')){mode='image';still.src=url;await still.decode();if(token===generation)analyze(still,false);}
      else{mode='video';video.src=url;await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});if(token!==generation)return;
        $('seek').max=video.duration;$('play').hidden=$('seek').hidden=false;watch();await video.play();}
      if(token===generation)$('notice').textContent='本机素材：'+source;
    }catch{if(token===generation){stop();$('notice').textContent='素材无法读取，请使用 JPEG、PNG 或 H.264 MP4。';}}
    event.target.value='';
  };
  $('camera').onclick=async()=>{
    stop();newLog();const token=generation;
    if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){$('notice').textContent='摄像头需要 HTTPS 地址。';return;}
    try{const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
      if(token!==generation){media.getTracks().forEach(t=>t.stop());return;}stream=media;mode='camera';source='camera';video.srcObject=media;watch();await video.play();
      if(token===generation){media.getVideoTracks()[0].addEventListener('ended',()=>{if(stream===media)stop();});$('notice').textContent='相机开启。先静止观察，再缓慢拉近拉远；本页不读取手机姿态。';}
    }catch(e){if(token===generation){stop();$('notice').textContent='相机未开启：'+e.name;}}
  };
  $('stop').onclick=stop;$('reset').onclick=()=>{clear();if(mode==='image')analyze(still,false);};
  $('play').onclick=()=>video.paused?video.play().catch(()=>{}):video.pause();
  $('seek').oninput=()=>{clear();video.currentTime=Number($('seek').value);};
  video.addEventListener('pause',()=>{if(mode==='video'){clear();draw();}});
  video.addEventListener('seeked',()=>{if(mode==='video'&&video.paused)analyze(video,false);});
  $('compare').onchange=()=>{if(mode==='image')analyze(still,false);};
  $('mark').onclick=()=>{marks.push({truth:$('truth').value,recordIndex:rows.length-1,observation:out});$('marks').textContent=marks.length+' 条人工备注';};
  $('export').onclick=()=>{
    const result={schema:'burger-visual-validation/v1',implementation:'vision-6',source,userAgent:navigator.userAgent,coordinates:'analysis pixels; visual bun anchor, not core',
      camera:stream?.getVideoTracks()[0]?.getSettings()??null,records:rows,marks};
    const blob=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');
    a.href=blob;a.download='burger-visual-validation.json';a.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);
  };
  function tick(now){
    if((mode==='video'||mode==='camera')&&!video.paused&&!document.hidden){
      const fresh=hasCallbacks?serial!==analyzed:video.currentTime!==lastMedia;
      if(video.readyState>=2&&!video.seeking&&fresh&&now-lastWork>=25){lastWork=now;analyzed=serial;lastMedia=video.currentTime;if(!hasCallbacks)lastFrameAt=now;analyze(video);$('seek').value=video.currentTime;}
      if(now-lastFrameAt>250&&out){clear();$('state').textContent='画面未更新 · 未知';draw();}
    }
    requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clear();draw();}});
  window.addEventListener('pagehide',stop);requestAnimationFrame(tick);
})();

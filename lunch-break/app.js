import {t,setupLanguages} from './i18n.mjs?v=lunch1';
import {setupRecognition,sourcePoint,RUNTIME_RELEASE} from './recognition.mjs?v=158';
import './ar/core-display-game.js?v=158';
import {setupOrientation} from './orientation.mjs?v=lunch1';
import {setupLocalVideo} from './local-video.mjs?v=lunch1';
import {createModelDebug} from './model-debug.mjs?v=158';
import {Mission,DROP_INTERVAL_MS} from './engine.mjs?v=lunch1';
import {createEffects,TRAVEL_MS} from './effects.mjs?v=lunch1';
import {createAudio} from './audio.mjs?v=lunch1';

const $=id=>document.getElementById(id);
const field=$('mission'), target=$('target'), fireButton=$('squeeze');
const game=new Mission(), audio=createAudio(), coreDisplay=new globalThis.BurgerCoreDisplay();
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const debug=createModelDebug({canvas:$('model-debug'),info:$('model-debug-info'),toggle:$('model-debug-toggle'),t});
let active=false,stream=null,cameraPending=false,generation=0,cameraError='';
let recognition,orientation,frame=0,lastDiagnosticsPaint=-Infinity,viewport='',sourceVideo=null;
let visiblePoint=null,lastLock=false,pulse=0,heldBy=null,flashTimer=0,radioUntil=0,radioKey='',flashKey='';
let demoState='exposed',demoOffset={x:0,y:0},drag=null;
const arrivals=new Set(),effects=createEffects($('effects'),reduced,()=>visiblePoint);
function showText(node,value){if(node.textContent!==value)node.textContent=value;}
function source(){return stream?{type:'camera',video:$('camera')}:videoPlayer.hasSource()?{type:'video',video:$('local-video')}:{type:'demo',video:null};}
function sight(){return {x:field.clientWidth*.5,y:field.clientHeight*.515};}
function projected(p,view){
  if(!p || !view.video?.videoWidth)return null;
  return sourcePoint(p,view.video.videoWidth,view.video.videoHeight,field.clientWidth,field.clientHeight,view.type==='camera'?'cover':'contain');
}
function inside(p){return p&&p.x>=0&&p.y>=0&&p.x<=field.clientWidth&&p.y<=field.clientHeight;}
function demoPoint(){const p=sight();return {x:p.x+demoOffset.x,y:p.y+demoOffset.y};}
function positionDemo(){
  const p=sight(),w=field.clientWidth,h=field.clientHeight;
  if(!w||!h)return;
  // Patty centre in the cropped tabletop still. Overscan leaves space to pan the demo.
  const u=(1029-390)/1250,v=(558-35)/1045,roomX=Math.min(80,w*.18),roomY=28;
  const z=Math.max((p.x+roomX)/(1250*u),(w-p.x+roomX)/(1250*(1-u)),(p.y+roomY)/(1045*v),(h-p.y+roomY)/(1045*(1-v)));
  demoOffset.x=Math.max(-roomX,Math.min(roomX,demoOffset.x));
  demoOffset.y=Math.max(-roomY,Math.min(roomY,demoOffset.y));
  const a=demoPoint(),photo=$('demo-photo');
  photo.style.width=1250*z+'px';photo.style.height=1045*z+'px';
  photo.style.left=a.x-u*1250*z+'px';photo.style.top=a.y-v*1045*z+'px';
}
function aimAt(view){
  const p=sight();
  if(view.type==='demo'){
    if(demoState==='unknown')return 'unknown';
    return demoState==='exposed'&&Math.hypot(demoOffset.x,demoOffset.y)<=21?'hit':'miss';
  }
  if(view.state==='unknown')return 'unknown';
  if(view.state==='blocked')return 'miss';
  const region=view.result?.attackRegion,center=projected(view.result?.coreCenter,view);
  if(!region||!center||view.displayStatus!=='measured')return 'unknown';
  const edge=projected({x:view.result.coreCenter.x+region.radiusX,y:view.result.coreCenter.y+region.radiusY},view);
  const rx=edge.x-center.x,ry=edge.y-center.y;
  if(!(rx>0&&ry>0))return 'unknown';
  return ((p.x-center.x)/rx)**2+((p.y-center.y)/ry)**2<=1?'hit':'miss';
}
function stateMessage(view,aim){
  if(game.score)return '出餐完成。';
  if(game.finished)return '番茄酱用完了。';
  if(view.failed&&view.type!=='demo')return '识别暂不可用，请重开页面';
  if(view.video?.paused)return '视频已暂停';
  const state=view.type==='demo'?demoState:view.state;
  if(state==='blocked')return '面包挡住了夹层，请放低手机。';
  if(aim==='unknown'){
    if(view.displayStatus==='held'||view.displayPose||view.type==='demo')return '角度待确认，请稳一下。';
    if(view.diagnostics?.live&&!view.diagnostics.resultExpired&&view.result?.visual?.targetFound)return '汉堡已定位 · 核心待确认';
    return '寻找汉堡 · 请保持完整入镜';
  }
  return aim==='hit'?'夹层已露出。可以加酱。':'把准星移到 CORE 上。';
}
function showRadio(key,ms=0){radioKey=key;radioUntil=ms?performance.now()+ms:0;showText($('radio-text'),t(key));}
function flash(key=''){
  clearTimeout(flashTimer);flashKey=key;showText($('feedback'),key);
  $('feedback').classList.toggle('missed',key==='MISSED');
  if(key==='MISSED')flashTimer=setTimeout(()=>flash(),650);
}
function hud(view,now){
  const aim=aimAt(view),state=view.type==='demo'?demoState:view.state,locked=aim==='hit'&&!game.finished;
  target.classList.toggle('lock',locked);target.classList.toggle('blocked',state==='blocked');target.classList.toggle('uncertain',state==='unknown');
  target.classList.toggle('done',game.finished);target.classList.toggle('lost',!inside(visiblePoint));
  target.style.setProperty('--tracking-opacity',view.type==='demo'?(demoState==='unknown'?'.45':'1'):String(view.displayOpacity));
  if(inside(visiblePoint)){target.style.left=visiblePoint.x+'px';target.style.top=visiblePoint.y+'px';}
  const blip=$('blip');blip.style.visibility=inside(visiblePoint)&&!game.score?'visible':'hidden';
  if(visiblePoint)blip.setAttribute('transform','translate('+Math.max(4,Math.min(76,40+(visiblePoint.x/field.clientWidth-.5)*80))+' '+Math.max(4,Math.min(76,32+(visiblePoint.y/field.clientHeight-.515)*80))+')');
  if(locked&&!lastLock)audio.lock();lastLock=locked;
  const message=stateMessage(view,aim);
  if(now>=radioUntil)showRadio(message);
  showText($('recognition-status'),t(message));
  showText($('tracking-hint'),view.type==='demo'&&!game.finished?t('演示 · 拖动桌面调整瞄准'): '');
}
function renderAmounts(){
  showText($('ml'),String(game.ml));showText($('score'),String(game.score).padStart(6,'0'));
  fireButton.disabled=!game.ml||!!game.score;
  $('round-end').hidden=!game.finished;
}
function paint(now){
  frame=0;if(!active||document.hidden)return;
  const view=recognition.current(),key=[view.type,field.clientWidth,field.clientHeight,view.video?.videoWidth,view.video?.videoHeight].join('/');
  if(viewport!==key||sourceVideo!==view.video){viewport=key;sourceVideo=view.video;coreDisplay.reset();positionDemo();}
  if(view.type==='demo')visiblePoint=demoPoint();
  else{
    const pose=view.displayPose,cam=view.video;
    const point=pose?.center&&cam?.videoWidth?projected(globalThis.BurgerAttackRegion.coreCenter(pose,cam.videoWidth,cam.videoHeight),view):null;
    visiblePoint=coreDisplay.step(inside(point)?point:null,now);
    recognition.recordDisplay(visiblePoint,now,{width:field.clientWidth,height:field.clientHeight});
  }
  debug.render(view,field.clientWidth,field.clientHeight);hud(view,now);
  frame=requestAnimationFrame(paint);
}
function renderDiagnostics(d) {
  if(!d||!$('settings').open||performance.now()-lastDiagnosticsPaint<250)return;
  lastDiagnosticsPaint=performance.now();
  const ms=value=>value===null?'—':Math.round(value)+' ms';
  $('ar-diagnostics').textContent=[
    t('画面通知：{mode}',{mode:t(d.frameClock==='video-frame-callback'?'逐帧回调':'时间轮询（估计）')}),
    t('新帧间隔 {interval} · 距上帧 {age}',{interval:ms(d.frameIntervalMs),age:ms(d.frameAgeMs)}),
    t('像素读取 {read} · 识别计算 {compute}',{read:ms(d.readbackMs),compute:ms(d.processingMs)}),
    t('计算往返 {roundtrip} · 结果年龄 {age}',{roundtrip:ms(d.turnaroundMs),age:ms(d.resultAgeMs)}),
    t('画面超时 {frames} 次 · 结果过期 {results} 次',{frames:d.frameStaleEvents,results:d.resultExpiredEvents}),
    t(d.resultExpired?'当前结果已过期，无法命中':d.frameStale?'当前画面已超时，无法命中':''),
  ].filter(Boolean).join('\n');
}

function stopHold(){
  heldBy=null;clearInterval(pulse);pulse=0;game.stop();fireButton.setAttribute('aria-pressed','false');
}
function cancelDrops(){
  stopHold();for(const timer of arrivals)clearTimeout(timer);arrivals.clear();game.pending.clear();
}
function dispense(){
  if(!active||document.hidden||$('settings').open||!$('orientation-prompt').hidden){stopHold();return;}
  const drop=game.dispense(aimAt(recognition.current()));
  if(!drop){stopHold();return;}
  effects.launch();audio.squeeze();renderAmounts();
  if(!game.ml)stopHold();
  const timer=setTimeout(()=>{
    arrivals.delete(timer);
    const result=game.land(drop,aimAt(recognition.current()));
    if(!result)return;
    effects.impact(result);
    if(result==='served'){
      stopHold();flash('COMPLETE  +400');showRadio('出餐完成。',1000);audio.served();
    }else if(result==='miss'||result==='warn'){
      flash('MISSED');if(result==='warn')showRadio('喂，别把番茄酱挤得到处都是。',2200);
    }else if(result==='unknown'){flash();showRadio(stateMessage(recognition.current(),'unknown'),350);}
    else if(flashKey==='MISSED')flash();
    if(game.finished&&!game.score){flash('EMPTY');showRadio('番茄酱用完了。');}
    renderAmounts();
  },TRAVEL_MS);arrivals.add(timer);
}
function startHold(owner){
  if(!active||heldBy!==null||fireButton.disabled||$('settings').open||!$('orientation-prompt').hidden)return;
  heldBy=owner;game.start();fireButton.setAttribute('aria-pressed','true');
  dispense();if(heldBy!==null)pulse=setInterval(dispense,DROP_INTERVAL_MS);
}
fireButton.addEventListener('pointerdown',e=>{
  if(e.button!==0||heldBy!==null)return;
  e.preventDefault();fireButton.setPointerCapture(e.pointerId);startHold(e.pointerId);
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])fireButton.addEventListener(event,e=>{if(heldBy===e.pointerId)stopHold();});
fireButton.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('keydown',e=>{
  if(!active||e.repeat||!['Space','Enter'].includes(e.code)||$('settings').open||!$('orientation-prompt').hidden)return;
  if(document.activeElement!==fireButton&&(e.code==='Enter'||document.activeElement?.closest('button,input,summary,select,a')))return;
  e.preventDefault();startHold(e.code);
});
document.addEventListener('keyup',e=>{if(heldBy===e.code){e.preventDefault();stopHold();}});
fireButton.addEventListener('click',e=>{if(!e.detail&&heldBy===null&&!fireButton.disabled){startHold('assistive');stopHold();}});
const table=$('demo-area');
table.addEventListener('pointerdown',e=>{
  if(e.button!==0||drag)return;
  table.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX-demoOffset.x,y:e.clientY-demoOffset.y};
});
table.addEventListener('pointermove',e=>{
  if(drag?.id!==e.pointerId)return;
  demoOffset={x:e.clientX-drag.x,y:e.clientY-drag.y};positionDemo();
});
table.addEventListener('lostpointercapture',()=>{drag=null;});
table.addEventListener('keydown',e=>{
  const direction={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]}[e.key];
  if(direction){e.preventDefault();demoOffset.x+=direction[0];demoOffset.y+=direction[1];positionDemo();}
});
function resetRound(){
  cancelDrops();game.reset();effects.clear();flash();radioUntil=0;lastLock=false;
  demoOffset={x:0,y:0};demoState='exposed';positionDemo();syncDemoState();
  visiblePoint=null;viewport='';coreDisplay.reset();debug.clear();recognition?.reset();renderAmounts();
}
function syncDemoState(){for(const id of ['exposed','blocked','unknown'])$(id).setAttribute('aria-pressed',String(demoState===id));}
for(const id of ['exposed','blocked','unknown'])$(id).onclick=()=>{demoState=id;syncDemoState();radioUntil=0;$('settings').close();};
function showScreen(id){
  if($('brief-options').open)$('brief-options').close();
  for(const name of ['operation','brief','mission'])$(name).hidden=name!==id;
  window.scrollTo(0,0);
}
function enter(){
  if(!orientation)orientation=setupOrientation({button:$('orientation-toggle'),status:$('orientation-status'),rollGroup:$('attitude-roll'),pitchGroup:$('attitude-pitch'),reduced,getSource:source,prompt:$('orientation-prompt'),allow:$('orientation-allow'),skip:$('orientation-skip'),onHeading:showHeading});
  else orientation.resume();
  if(!recognition)recognition=setupRecognition({getSource:source,onResult:view=>{if(active)renderDiagnostics(view.diagnostics);}});
  else recognition.resume();
  active=true;showScreen('mission');$('settings').close();resetRound();updateSource();
  if(!frame)frame=requestAnimationFrame(paint);
}
function updateSource(){
  const type=source().type;
  field.classList.toggle('camera-live',type==='camera');field.classList.toggle('video-live',type==='video');
  $('simulation-controls').hidden=type!=='demo';
  showText($('camera-toggle'),t(cameraPending?'取消开启':stream?'关闭摄像头':'开启摄像头'));
  $('start').disabled=cameraPending;orientation?.refreshSource();
}
function cameraMessage(key){cameraError=key;showText($('camera-error'),t(key));if(active&&key)showRadio(key,3200);}
function stopCamera(){
  generation++;cameraPending=false;
  const old=stream;stream=null;if(old)for(const track of old.getTracks())track.stop();
  $('camera').srcObject=null;updateSource();
}
async function startCamera(){
  if(cameraPending){stopCamera();return;}
  if(!window.isSecureContext){cameraMessage('摄像头需要 HTTPS 安全网址；现在可以先体验演示。');return;}
  if(!navigator.mediaDevices?.getUserMedia){cameraMessage('当前浏览器无法开启摄像头，请使用手机系统浏览器，或先体验演示。');return;}
  cameraPending=true;const token=++generation;updateSource();cameraMessage('请在浏览器提示中允许摄像头；也可以先进入演示。');
  try{
    const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
    if(token!==generation){media.getTracks().forEach(track=>track.stop());return;}
    videoPlayer.clear();stream=media;$('camera').srcObject=media;await $('camera').play();
    if(token!==generation)return;
    media.getVideoTracks()[0].addEventListener('ended',()=>{if(stream===media){stopCamera();resetRound();cameraMessage('摄像头已中断，可点击“开启摄像头”重试。');}});
    cameraMessage('');enter();orientation.offer();
  }catch(error){
    if(token!==generation)return;
    stopCamera();
    const messages={NotAllowedError:'摄像头权限未开启。请在浏览器的网站权限中允许摄像头，再点击重试；也可以先体验演示。',NotFoundError:'没有找到可用摄像头，可以先体验演示。',NotReadableError:'摄像头暂时无法使用，请关闭其他占用摄像头的应用后重试。'};
    cameraMessage(messages[error.name]||'摄像头未能启动，请使用手机系统浏览器重试，或先体验演示。');
  }finally{if(token===generation){cameraPending=false;updateSource();}}
}
function leave(){
  active=false;cancelAnimationFrame(frame);frame=0;cancelDrops();effects.clear();debug.clear();
  $('settings').close();$('orientation-prompt').hidden=true;stopCamera();videoPlayer.clear();cameraMessage('');
  orientation?.stop();recognition?.stop();showScreen('brief');$('brief-title').focus({preventScroll:true});
}
const videoPlayer=setupLocalVideo({
  video:$('local-video'),input:$('video-file'),controls:$('video-controls'),playButton:$('video-play'),replayButton:$('video-replay'),closeButton:$('close-video'),time:$('video-time'),
  beforeSelect:stopCamera,onSource:present=>{if(present)enter();else{if(active)resetRound();updateSource();}},onMessage:cameraMessage
});
$('brief-button').onclick=()=>{showScreen('brief');$('brief-title').focus({preventScroll:true});};
$('home').onclick=()=>{stopCamera();cameraMessage('');showScreen('operation');$('brief-button').focus({preventScroll:true});};
$('start').onclick=startCamera;
$('demo').onclick=()=>{stopCamera();cameraMessage('');enter();};
$('camera-toggle').onclick=()=>{if(stream){stopCamera();resetRound();}else startCamera();};
$('more-options').onclick=()=>$('brief-options').showModal();
$('choose-video').onclick=()=>{$('brief-options').close();videoPlayer.choose();};
$('change-video').onclick=()=>videoPlayer.choose();
$('reset').onclick=$('again').onclick=()=>{$('settings').close();resetRound();};
$('leave').onclick=$('round-brief').onclick=leave;
$('open-settings').onclick=()=>{cancelDrops();renderAmounts();$('settings').showModal();};
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
function renderAudio(){for(const button of document.querySelectorAll('.sound-switch')){showText(button,t(audio.enabled?'关闭声音':'开启声音'));button.setAttribute('aria-pressed',String(audio.enabled));}}
for(const b of document.querySelectorAll('.sound-switch'))b.onclick=async()=>{try{await audio.toggle();renderAudio();}catch{cameraMessage('这个浏览器暂时无法播放声音。');}};
$('export-diagnostics').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(recognition.diagnostics(),null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='burger-runtime-'+RUNTIME_RELEASE+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{showRadio('此浏览器不支持网页全屏，横过手机即可体验。',2500);}};
document.addEventListener('fullscreenchange',()=>showText($('fullscreen'),t(document.fullscreenElement?'退出全屏':'全屏')));
function showHeading(degrees){
  const labels=document.querySelectorAll('.heading span');
  const value=source().type==='demo'?180:degrees;
  for(let i=0;i<labels.length;i++)showText(labels[i],Number.isFinite(value)?String(Math.round((value+(i-1)*30+360)%360/10)%36).padStart(2,'0'):'–');
}
setupLanguages(()=>{
  updateSource();renderAudio();orientation?.refreshLabels();videoPlayer.refreshLabels();showText($('camera-error'),t(cameraError));
  showText($('radio-text'),t(radioKey));showText($('fullscreen'),t(document.fullscreenElement?'退出全屏':'全屏'));
});
renderAudio();renderAmounts();updateSource();
window.addEventListener('blur',stopHold);
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelDrops();effects.clear();cancelAnimationFrame(frame);frame=0;}else if(active&&!frame){renderAmounts();frame=requestAnimationFrame(paint);}});
window.addEventListener('pagehide',()=>{if(active || cameraPending)leave();});

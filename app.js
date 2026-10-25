import {setupRecognition,sourcePoint} from './recognition.mjs?v=8';
import {createAudio} from './audio.mjs?v=7';
import {setupOrientation} from './orientation.mjs?v=7';
import {Mission} from './engine.mjs?v=4';
import {setupLocalVideo} from './local-video.mjs?v=5';
import {createEffects} from './effects.mjs?v=4';
const $ = id => document.getElementById(id);
const game = new Mission();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const effects = createEffects($('effects'), $('target'), reduced);
const shotTimers = new Set();
let active = false, stream = null, cameraPending = false, cameraGeneration = 0;
let orientationController,recognitionController;
let feedbackTimer,muted=true,voiceCount=0,targetVisible=true,lastRecognitionType='demo',lockAnnounced=false,lastDiagnosticsPaint=-Infinity;
const audio=createAudio();
function getSource(){return stream?{type:'camera',video:$('camera')}:localVideo.hasSource()?{type:'video',video:$('local-video')}:{type:'demo',video:null};}
function applyRecognition(observation) {
  const {type,video,result,state,failed,displayPose,displayOpacity,displayStatus}=observation;
  renderDiagnostics(observation.diagnostics);
  if(type!==lastRecognitionType){lastRecognitionType=type;reset();}
  const simulated=type==='demo';
  $('simulation-controls').hidden=!simulated;
  $('target').classList.toggle('uncertain',!simulated&&state==='unknown');
  if(simulated) {
    targetVisible=true;
    $('target').style.left='';$('target').style.top='';$('target').style.setProperty('--tracking-opacity','1');
    $('recognition-status').textContent='演示模式 · 手动切换核心状态';
    $('tracking-hint').textContent='演示模式 · 可在测试设置切换遮挡';
    render();return;
  }
  const center=displayPose?.center;
  $('target').style.setProperty('--tracking-opacity',String(displayOpacity));
  targetVisible=!!center;
  if(center&&video?.videoWidth) {
    const point=sourcePoint(center,video.videoWidth,video.videoHeight,$('app').clientWidth,$('app').clientHeight,type==='camera'?'cover':'contain');
    targetVisible=point.x>=0&&point.x<=$('app').clientWidth&&point.y>=0&&point.y<=$('app').clientHeight;
    $('target').style.left=point.x+'px';$('target').style.top=point.y+'px';
  }
  game.tracked=targetVisible&&state!=='unknown';game.setExposure(game.tracked&&state==='exposed');
  const message=failed?'识别暂不可用，请重开页面':video?.paused?'视频已暂停 · 暂停攻击':state==='exposed'?'核心露出 · 可攻击':state==='blocked'?'面包遮挡 · 请降低视角':targetVisible?(displayStatus==='held'?'短时保留位置 · 暂停攻击':'角度不确定 · 请缓慢移动手机'):'寻找汉堡 · 请保持完整入镜';
  $('recognition-status').textContent='桌面实验识别 · '+message;
  $('tracking-hint').textContent=game.destroyed?'核心已击破 · 重置后再试':message;
  render();
  // Selection persists through geometry uncertainty; only a current location
  // may announce the single target, once per sortie. Held positions stay silent.
  if(targetVisible&&displayStatus==='measured'&&result?.tracking==='found')announceLock();
}
function renderCooldown() {
  const now = performance.now();
  for (let slot=0; slot<2; slot++) {
    const progress=game.progress(slot, now);
    $(`slot-${slot}-fill`).setAttribute('y', 100-66*progress);
    $(`slot-${slot}-fill`).setAttribute('height', 66*progress);
  }
  $('fire').disabled = !game.canFire(now);
  const ready=game.readyAt.filter(time => time<=now).length;
  const status=`导弹就绪 ${ready}/2`;
  if ($('reload-status').textContent!==status) $('reload-status').textContent=status;
  $('fire').lastElementChild.textContent = game.destroyed ? '目标已击破' : !game.tracked ? '等待确认目标' : !game.ammo ? '弹药耗尽' : !ready ? '装填中' : '发射导弹';
}
function render() {
  $('ammo').textContent=String(game.ammo).padStart(2,'0');
  $('score').textContent=String(game.score).padStart(6,'0');
  $('target').classList.toggle('blocked',!game.exposed);
  $('target').classList.toggle('destroyed',game.destroyed);
  $('target').classList.toggle('lost',getSource().type==='demo'?!game.tracked:!targetVisible);
  $('exposed').setAttribute('aria-pressed',String(game.exposed));
  $('blocked').setAttribute('aria-pressed',String(!game.exposed));
  $('exposed').disabled=$('blocked').disabled=game.destroyed;
  $('tracking-toggle').setAttribute('aria-pressed',String(game.tracked));
  $('tracking-toggle').textContent=game.tracked?'目标可见':'目标丢失';
  $('reset').textContent=game.destroyed?'↻ 下一架次':'↻ 重置任务';
  renderCooldown();
}
function feedback(title='', detail='') {
  $('feedback').firstElementChild.textContent=title;
  $('feedback').lastElementChild.textContent=detail;
  $('feedback').classList.toggle('missed',title==='MISSED');
}
function announceLock() {
  if (game.destroyed || lockAnnounced) return;
  lockAnnounced=true;audio.effect('lock');
}
function renderDiagnostics(d) {
  if(!d||!$('settings').open||performance.now()-lastDiagnosticsPaint<250)return;
  lastDiagnosticsPaint=performance.now();
  const ms=value=>value===null?'—':Math.round(value)+' ms';
  $('ar-diagnostics').textContent=[
    `画面通知：${d.frameClock==='video-frame-callback'?'逐帧回调':'时间轮询（估计）'}`,
    `新帧间隔 ${ms(d.frameIntervalMs)} · 距上帧 ${ms(d.frameAgeMs)}`,
    `像素读取 ${ms(d.readbackMs)} · 识别计算 ${ms(d.processingMs)}`,
    `计算往返 ${ms(d.turnaroundMs)} · 结果年龄 ${ms(d.resultAgeMs)}`,
    `画面超时 ${d.frameStaleEvents} 次 · 结果过期 ${d.resultExpiredEvents} 次`,
    d.resultExpired?'当前结果已过期，不可攻击':d.frameStale?'当前画面已超时，不可攻击':'',
  ].filter(Boolean).join('\n');
}
function enter() {
  if (active) return;
  active=true;
  $('title-screen').hidden=$('brief').hidden=true;
  $('mission').hidden=false;
  $('app').classList.replace('briefing','playing');
  render(); if(getSource().type==='demo'&&game.tracked)announceLock();
}
function cameraMessage(message){$('camera-error').textContent=message;if(active)$('radio-text').textContent=message;}
function updateCamera(){const live=!!stream;$('app').classList.toggle('camera-live',live);$('camera-status').textContent=live?'● 摄像头已开启':localVideo.hasSource()?'● 本地视频':'● 演示背景';$('camera-toggle').textContent=cameraPending?'取消开启':live?'关闭摄像头':'开启摄像头';$('start').disabled=cameraPending;$('start').firstChild.textContent=cameraPending?'等待摄像头授权…':'开始任务 ';orientationController?.refreshSource();}
function stopCamera(){cameraGeneration++;cameraPending=false;const old=stream;stream=null;if(old)old.getTracks().forEach(t=>t.stop());$('camera').srcObject=null;updateCamera();}
async function startCamera(){if(cameraPending){stopCamera();return;}if(!window.isSecureContext){cameraMessage('摄像头需要 HTTPS 安全网址；现在可以先体验演示。');return;}if(!navigator.mediaDevices?.getUserMedia){cameraMessage('当前浏览器无法开启摄像头，请使用手机系统浏览器，或先体验演示。');return;}cameraPending=true;const generation=++cameraGeneration;updateCamera();cameraMessage('请在浏览器提示中允许摄像头；也可以先进入演示。');try{const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});if(generation!==cameraGeneration){media.getTracks().forEach(t=>t.stop());return;}localVideo.clear();stream=media;$('camera').srcObject=media;await $('camera').play();if(generation!==cameraGeneration)return;media.getVideoTracks()[0].addEventListener('ended',()=>{if(stream===media){stopCamera();cameraMessage('摄像头已中断，可点击“开启摄像头”重试。');}});cameraMessage('');enter();updateCamera();orientationController.offer();$('radio-text').textContent='将汉堡放在桌上，缓慢改变观察角度。';}catch(error){if(generation!==cameraGeneration)return;stopCamera();const messages={NotAllowedError:'摄像头权限未开启。请在浏览器的网站权限中允许摄像头，再点击重试；也可以先体验演示。',NotFoundError:'没有找到可用摄像头，可以先体验演示。',NotReadableError:'摄像头暂时无法使用，请关闭其他占用摄像头的应用后重试。'};cameraMessage(messages[error.name]||'摄像头未能启动，请使用手机系统浏览器重试，或先体验演示。');}finally{if(generation===cameraGeneration){cameraPending=false;updateCamera();}}}


const localVideo=setupLocalVideo({
  video:$('local-video'), input:$('video-file'), controls:$('video-controls'),
  playButton:$('video-play'), replayButton:$('video-replay'), closeButton:$('close-video'), time:$('video-time'),
  beforeSelect:() => {stopCamera(); reset();},
  onSource:present => {
    $('app').classList.toggle('video-live',present);
    updateCamera();
    if (present) {
      enter(); $('settings').open=false;
      cameraMessage('本地视频实验识别。请使用完整拍到桌面汉堡的视频。');
    }
  },
  onMessage:cameraMessage,
});
for (const id of ['choose-video','change-video']) $(id).addEventListener('click', () => {audio.unlock();localVideo.choose();});

function fire() {
  if (!active) return;
  if(recognitionController)applyRecognition(recognitionController.current());
  audio.unlock();
  const shot=game.fire(performance.now());
  if (!shot) return;
  clearTimeout(feedbackTimer);
  feedback();
  $('radio-text').textContent='导弹发射。';
  audio.effect('launch');
  render(); effects.launch(shot);
  const timer=setTimeout(() => {
    shotTimers.delete(timer);
    applyRecognition(recognitionController.current());
    // A paused, lost or newly occluded live target must not score from old evidence.
    if(getSource().type!=='demo'&&(!game.tracked||!game.exposed)) {
      const pending=game.pending.get(shot.id);if(pending)pending.hit=false;
    }
    const result=game.resolve(shot.id);
    if (!result) return;
    if (result==='destroyed') {
      clearTimeout(feedbackTimer);
      feedback('DESTROYED','核心击破 · +400');
      const voice=voiceCount++%2===0?'sandwich':'burger';
      $('radio-text').textContent=voice==='sandwich'?'办得到的人，学 Trigger 去做三明治。':'（Longcaster：汉堡通信）';
      audio.feedback(voice);
    } else {
      feedback('MISSED',game.ammo?'未确认命中 · 未得分':'弹药已耗尽 · 请重置任务');
      $('radio-text').textContent=getSource().type==='demo'?'面包挡住了核心。切换“核心露出”再试一次。':'请保持目标在画面内，找到核心露出的角度。';
      feedbackTimer=setTimeout(() => feedback(),1800);
    }
    render();
  },effects.travel);
  shotTimers.add(timer);
}
function reset() {
  for (const timer of shotTimers) clearTimeout(timer);
  shotTimers.clear(); clearTimeout(feedbackTimer); effects.clear();
  game.reset();lockAnnounced=false; audio.stop(); recognitionController?.reset(); feedback();
  if(getSource().type!=='demo'){game.tracked=false;game.exposed=false;targetVisible=false;}
  $('radio-text').textContent='目标已确认。准备好就开火。';
  render(); if(getSource().type==='demo'&&game.tracked)announceLock();
}
$('show-brief').addEventListener('click', () => {
  $('title-screen').hidden=true; $('brief').hidden=false;
});
$('start').addEventListener('click', () => {audio.unlock(); startCamera();});
$('demo').addEventListener('click', () => {audio.unlock();if(cameraPending) stopCamera(); enter();});
$('camera-toggle').addEventListener('click', () => {audio.unlock();stream?stopCamera():startCamera();});
$('fire').addEventListener('click',fire);
$('reset').addEventListener('click',reset);
$('tracking-toggle').addEventListener('click', () => {
  if(getSource().type!=='demo')return;
  game.tracked=!game.tracked;
  $('radio-text').textContent=game.tracked?'目标重新确认。':'目标丢失。将目标移回视野。';
  render(); if(game.tracked)announceLock();
});
for (const [id,value] of [['exposed',true],['blocked',false]]) {
  $(id).addEventListener('click', () => {
    if (getSource().type!=='demo'||!game.setExposure(value)) return;
    clearTimeout(feedbackTimer); feedback();
    $('radio-text').textContent=value?'核心露出，允许攻击。':'核心被面包遮挡，攻击不会得分。';
    render();
  });
}
for (const id of ['sound','mission-sound']) $(id).addEventListener('click', () => {
  muted=!muted;audio.setEnabled(!muted);
  for (const buttonId of ['sound','mission-sound']) {
    const button=$(buttonId);
    button.textContent=(buttonId==='sound'?'音效 ':'原作音频 ')+(muted?'OFF':'ON');
    button.setAttribute('aria-pressed',String(!muted));
  }
});
$('export-diagnostics').addEventListener('click',()=>{
  const data=recognitionController.diagnostics();
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='burger-runtime-v8.json';
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('fullscreen').addEventListener('click',async () => {
  try {
    if(document.fullscreenElement) await document.exitFullscreen();
    else if(document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else $('radio-text').textContent='此浏览器不支持网页全屏，横过手机即可体验。';
  } catch { $('radio-text').textContent='暂时无法全屏，横过手机即可体验。'; }
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').textContent=document.fullscreenElement?'退出全屏':'全屏';
});
document.addEventListener('keydown',e => {
  if(e.code==='Space' && active && !['BUTTON','INPUT','A','SUMMARY','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
    e.preventDefault(); fire();
  }
});
orientationController=setupOrientation({button:$('orientation-toggle'),status:$('orientation-status'),rollGroup:$('attitude-roll'),pitchGroup:$('attitude-pitch'),reduced,getSource,prompt:$('orientation-prompt'),allow:$('orientation-allow'),skip:$('orientation-skip')});
recognitionController=setupRecognition({getSource,onResult:applyRecognition});
// Only two cooldown indicators need updating, even when no camera is available.
setInterval(() => {if(active && !document.hidden) renderCooldown();},50);
window.addEventListener('pagehide', () => {
  orientationController.stop(); recognitionController.stop(); audio.stop(); stopCamera(); localVideo.clear(); reset();
});

window.addEventListener('pageshow', () => {orientationController.resume();recognitionController.resume();});

import {setupOrientation} from './orientation.mjs?v=4';
import {Mission} from './engine.mjs?v=4';
import {createEffects} from './effects.mjs?v=4';
const $ = id => document.getElementById(id);
const game = new Mission();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const effects = createEffects($('effects'), $('target'), reduced);
const shotTimers = new Set();
let active = false, stream = null, cameraPending = false, cameraGeneration = 0;
let feedbackTimer, muted = true, audio;
function tone(freq = 500, length = .1, type = 'sine') {
  if (muted) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, freq/3), audio.currentTime+length);
    gain.gain.setValueAtTime(.07, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime+length);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime+length);
  } catch {}
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
  $('fire').lastElementChild.textContent = game.destroyed ? '目标已击破' : !game.tracked ? '目标丢失' : !game.ammo ? '弹药耗尽' : !ready ? '装填中' : '发射导弹';
}
function render() {
  $('ammo').textContent=String(game.ammo).padStart(2,'0');
  $('score').textContent=String(game.score).padStart(6,'0');
  $('target').classList.toggle('blocked',!game.exposed);
  $('target').classList.toggle('destroyed',game.destroyed);
  $('target').classList.toggle('lost',!game.tracked);
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
function acquire() {
  if (game.destroyed || !game.tracked) return;
  const diamond=$('seek-diamond');
  diamond.classList.remove('acquiring');
  void diamond.offsetWidth;
  diamond.classList.add('acquiring');
}
function enter() {
  if (active) return;
  active=true;
  $('title-screen').hidden=$('brief').hidden=true;
  $('mission').hidden=false;
  $('app').classList.replace('briefing','playing');
  render(); acquire();
}
function cameraMessage(message){$('camera-error').textContent=message;if(active)$('radio-text').textContent=message;}
function updateCamera(){const live=!!stream;$('app').classList.toggle('camera-live',live);$('camera-status').textContent=live?'● 摄像头已开启':'● 演示背景';$('camera-toggle').textContent=cameraPending?'取消开启':live?'关闭摄像头':'开启摄像头';$('start').disabled=cameraPending;$('start').firstChild.textContent=cameraPending?'等待摄像头授权…':'开始任务 ';}
function stopCamera(){cameraGeneration++;cameraPending=false;const old=stream;stream=null;if(old)old.getTracks().forEach(t=>t.stop());$('camera').srcObject=null;updateCamera();}
async function startCamera(){if(cameraPending){stopCamera();return;}if(!window.isSecureContext){cameraMessage('摄像头需要 HTTPS 安全网址；现在可以先体验演示。');return;}if(!navigator.mediaDevices?.getUserMedia){cameraMessage('当前浏览器无法开启摄像头，请使用手机系统浏览器，或先体验演示。');return;}cameraPending=true;const generation=++cameraGeneration;updateCamera();cameraMessage('请在浏览器提示中允许摄像头；也可以先进入演示。');try{const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});if(generation!==cameraGeneration){media.getTracks().forEach(t=>t.stop());return;}stream=media;$('camera').srcObject=media;await $('camera').play();if(generation!==cameraGeneration)return;media.getVideoTracks()[0].addEventListener('ended',()=>{if(stream===media){stopCamera();cameraMessage('摄像头已中断，可点击“开启摄像头”重试。');}});cameraMessage('');enter();$('radio-text').textContent='将汉堡放在中央目标框内。当前由测试开关模拟核心状态。';}catch(error){if(generation!==cameraGeneration)return;stopCamera();const messages={NotAllowedError:'摄像头权限未开启。请在浏览器的网站权限中允许摄像头，再点击重试；也可以先体验演示。',NotFoundError:'没有找到可用摄像头，可以先体验演示。',NotReadableError:'摄像头暂时无法使用，请关闭其他占用摄像头的应用后重试。'};cameraMessage(messages[error.name]||'摄像头未能启动，请使用手机系统浏览器重试，或先体验演示。');}finally{if(generation===cameraGeneration){cameraPending=false;updateCamera();}}}

function fire() {
  if (!active) return;
  const shot=game.fire(performance.now());
  if (!shot) return;
  clearTimeout(feedbackTimer);
  feedback();
  $('radio-text').textContent='导弹发射。';
  tone(350,.3,'sawtooth');
  render(); effects.launch(shot);
  const timer=setTimeout(() => {
    shotTimers.delete(timer);
    const result=game.resolve(shot.id);
    if (!result) return;
    if (result==='destroyed') {
      clearTimeout(feedbackTimer);
      feedback('DESTROYED','核心击破 · +400');
      $('radio-text').textContent='漂亮，Trigger。午餐时间到了。';
      tone(130,.45,'triangle');
    } else {
      feedback('MISSED',game.ammo?'核心被遮挡 · 未得分':'弹药已耗尽 · 请重置任务');
      $('radio-text').textContent='面包挡住了核心。切换“核心露出”再试一次。';
      tone(140,.2);
      feedbackTimer=setTimeout(() => feedback(),1800);
    }
    render();
  },effects.travel);
  shotTimers.add(timer);
}
function reset() {
  for (const timer of shotTimers) clearTimeout(timer);
  shotTimers.clear(); clearTimeout(feedbackTimer); effects.clear();
  game.reset(); feedback();
  $('radio-text').textContent='目标已确认。准备好就开火。';
  render(); acquire();
}
$('show-brief').addEventListener('click', () => {
  $('title-screen').hidden=true; $('brief').hidden=false;
});
$('start').addEventListener('click', () => {tone(); startCamera();});
$('demo').addEventListener('click', () => {if(cameraPending) stopCamera(); enter();});
$('camera-toggle').addEventListener('click', () => stream?stopCamera():startCamera());
$('fire').addEventListener('click',fire);
$('reset').addEventListener('click',reset);
$('tracking-toggle').addEventListener('click', () => {
  game.tracked=!game.tracked;
  $('radio-text').textContent=game.tracked?'目标重新确认。':'目标丢失。将目标移回视野。';
  if (!game.tracked) $('seek-diamond').classList.remove('acquiring');
  render(); if(game.tracked) acquire();
});
for (const [id,value] of [['exposed',true],['blocked',false]]) {
  $(id).addEventListener('click', () => {
    if (!game.setExposure(value)) return;
    clearTimeout(feedbackTimer); feedback();
    $('radio-text').textContent=value?'核心露出，允许攻击。':'核心被面包遮挡，攻击不会得分。';
    render();
  });
}
for (const id of ['sound','mission-sound']) $(id).addEventListener('click', () => {
  muted=!muted;
  for (const buttonId of ['sound','mission-sound']) {
    const button=$(buttonId);
    button.textContent=(buttonId==='sound'?'音效 ':'合成音效 ')+(muted?'OFF':'ON');
    button.setAttribute('aria-pressed',String(!muted));
  }
  tone();
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
const stopOrientation=setupOrientation({button:$('orientation-toggle'),status:$('orientation-status'),rollGroup:$('attitude-roll'),pitchGroup:$('attitude-pitch'),reduced});
// Only two cooldown indicators need updating, even when no camera is available.
setInterval(() => {if(active && !document.hidden) renderCooldown();},50);
window.addEventListener('pagehide', () => {
  stopOrientation(); stopCamera(); reset();
});

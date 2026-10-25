import {attitude, smoothAngle} from './attitude.mjs';

// Recordings cannot use the viewing phone's attitude.
export function chooseDriver(source, enabled, age) {
  return source==='camera' && enabled && age>=0 && age<1500 ? 'sensor' : 'static';
}
export function setupOrientation({button,status,rollGroup,pitchGroup,reduced,getSource,prompt,allow,skip}) {
  for(let angle=-90;angle<=90;angle+=5) {
    const y=-angle*12,g=document.createElementNS('http://www.w3.org/2000/svg','g');
    const mark=angle===0?'center':angle>0?'pos':'neg';
    g.innerHTML=`<image class="hud-texture" href="./assets/hud/hud_pitch_mark_${mark}.png" x="-79" y="${y-1.6}" width="158" height="3.2"/>`+
      (angle===0?'':`<text x="-91" y="${y+3}" text-anchor="end">${angle}</text><text x="91" y="${y+3}">${angle}</text>`);
    pitchGroup.append(g);
  }
  let source='demo',enabled=false,pending=false,generation=0,listening=false,disposed=false;
  let sensor=null,sensorTime=-Infinity,lastDevice=null,reason='',frame,timer,lastDraw=0;
  let target={roll:0,pitch:0},current={...target};
  const screenAngle=()=>screen.orientation?.angle??window.orientation??0;
  function draw(value) {
    rollGroup.setAttribute('transform',`rotate(${value.roll})`);
    pitchGroup.setAttribute('transform',`translate(0 ${value.pitch*12})`);
  }
  function animate(now) {
    if(disposed)return;
    const t=reduced?1:1-Math.exp(-Math.min(now-lastDraw,100)/100);lastDraw=now;
    current.roll=smoothAngle(current.roll,target.roll,t);
    current.pitch+=(target.pitch-current.pitch)*t;
    draw(current);frame=requestAnimationFrame(animate);
  }
  function updateButton() {
    button.disabled=source!=='camera'||pending;
    button.textContent=source!=='camera'?'摄像头模式可启用':pending?'等待授权…':enabled?'关闭姿态感应':'开启姿态感应';
    button.setAttribute('aria-pressed',String(enabled&&source==='camera'));
    allow.disabled=pending;
  }
  function orientation(event) {
    if(source!=='camera'||!enabled||document.hidden)return;
    const value=attitude(event.beta,event.gamma,screenAngle());
    if(!value)return;
    lastDevice={beta:event.beta,gamma:event.gamma};sensor=value;sensorTime=performance.now();
  }
  function screenChanged() {if(lastDevice)sensor=attitude(lastDevice.beta,lastDevice.gamma,screenAngle());}
  function listen(yes) {
    if(yes===listening)return;listening=yes;
    const method=yes?'addEventListener':'removeEventListener';
    window[method]('deviceorientation',orientation);
    window[method]('orientationchange',screenChanged);
    screen.orientation?.[method]('change',screenChanged);
  }
  function refreshSource() {
    const next=getSource().type;if(next===source)return;
    generation++;pending=false;source=next;
    sensor=null;sensorTime=-Infinity;lastDevice=null;target={roll:0,pitch:0};
    prompt.hidden=true;listen(enabled&&source==='camera');updateButton();
  }
  function sample() {
    if(disposed)return;
    refreshSource();
    if(!document.hidden&&chooseDriver(source,enabled,performance.now()-sensorTime)==='sensor') {
      target={pitch:sensor.pitch,roll:sensor.roll??target.roll};status.textContent='姿态：手机传感器';
    } else {
      target={roll:0,pitch:0};
      status.textContent=source==='video'?'录像模式 · 静态 HUD':pending?'等待姿态权限':`${reason?reason+' · ':enabled&&source==='camera'?'等待传感器数据 · ':''}静态 HUD`;
    }
    timer=setTimeout(sample,100);
  }
  async function enable() {
    if(source!=='camera'||pending)return;
    const Sensor=window.DeviceOrientationEvent;
    prompt.hidden=true;
    if(!Sensor){reason='不支持姿态感应';updateButton();return;}
    const token=++generation;pending=true;reason='';updateButton();
    try {
      // Keep iOS permission inside the tap, before any unrelated await.
      const permission=typeof Sensor.requestPermission==='function'?await Sensor.requestPermission():'granted';
      if(token!==generation||disposed||source!=='camera')return;
      enabled=permission==='granted';reason=enabled?'':'未授权';pending=false;
      sensorTime=-Infinity;listen(enabled);updateButton();
    } catch {
      if(token!==generation)return;
      pending=enabled=false;reason='姿态权限未开启';listen(false);updateButton();
    }
  }
  button.addEventListener('click',()=>{
    if(enabled){generation++;enabled=false;sensorTime=-Infinity;reason='';listen(false);updateButton();}
    else enable();
  });
  allow.addEventListener('click',enable);
  skip.addEventListener('click',()=>{prompt.hidden=true;reason='已跳过姿态感应';});
  function offer() {
    refreshSource();if(source!=='camera'||enabled)return;
    prompt.hidden=false;allow.focus();
  }
  document.addEventListener('visibilitychange',()=>{sensorTime=-Infinity;lastDevice=null;});
  function stop(){disposed=true;generation++;pending=false;prompt.hidden=true;listen(false);clearTimeout(timer);cancelAnimationFrame(frame);draw({roll:0,pitch:0});}
  function resume(){if(!disposed)return;disposed=false;sensorTime=-Infinity;listen(enabled&&source==='camera');sample();frame=requestAnimationFrame(animate);}
  refreshSource();sample();frame=requestAnimationFrame(animate);
  return {stop,resume,refreshSource,offer};
}

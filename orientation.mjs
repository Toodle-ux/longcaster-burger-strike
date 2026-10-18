import {attitude, smoothAngle} from './attitude.mjs';

export function setupOrientation({button, status, rollGroup, pitchGroup, reduced}) {
  // 3 SVG units per degree. Horizontal bars represent angles relative to gravity.
  for (let angle = -90; angle <= 90; angle += 10) {
    const y = -angle * 3;
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const dash = angle < 0 ? 'stroke-dasharray="3 3"' : '';
    const width = angle === 0 ? 79 : 48;
    group.innerHTML = `<path d="M${-width} ${y + 4}v-4h${width - 18} M18 ${y}h${width - 18}v4" ${dash}/>` +
      (angle === 0 ? '' : `<text x="-66" y="${y + 3}" text-anchor="end">${angle}</text><text x="66" y="${y + 3}">${angle}</text>`);
    pitchGroup.append(group);
  }
  let listening = false, pending = false, generation = 0, timeout, frame;
  let latest = null, target = null, current = null, lastTime = 0;
  const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0;
  function draw(value) {
    rollGroup.setAttribute('transform', `rotate(${value.roll})`);
    pitchGroup.setAttribute('transform', `translate(0 ${value.pitch * 3})`);
  }
  function animate(time) {
    if (!listening || !target) return;
    const fraction = reduced ? 1 : 1 - Math.exp(-Math.min(time - lastTime, 100) / 70);
    lastTime = time;
    current.pitch += (target.pitch - current.pitch) * fraction;
    current.roll = smoothAngle(current.roll, target.roll ?? current.roll, fraction);
    draw(current);
    frame = requestAnimationFrame(animate);
  }
  function onOrientation(event) {
    const value = attitude(event.beta, event.gamma, screenAngle());
    if (!value) return;
    latest = {beta:event.beta, gamma:event.gamma};
    target = value;
    clearTimeout(timeout);
    status.textContent = '姿态：实时感应';
    if (!current) {
      current = {...value, roll:value.roll ?? 0};
      lastTime = performance.now();
      frame = requestAnimationFrame(animate);
    }
  }
  function screenChanged() {
    if (!latest) return;
    target = attitude(latest.beta, latest.gamma, screenAngle());
    current = {...target, roll:target.roll ?? 0};
  }
  function stop(message = '姿态：静态 HUD') {
    generation++;
    listening = pending = false;
    window.removeEventListener('deviceorientation', onOrientation);
    window.removeEventListener('orientationchange', screenChanged);
    screen.orientation?.removeEventListener('change', screenChanged);
    clearTimeout(timeout);
    cancelAnimationFrame(frame);
    latest = target = current = null;
    draw({pitch:0, roll:0});
    status.textContent = message;
    button.textContent = '开启姿态感应';
    button.setAttribute('aria-pressed', 'false');
  }
  button.addEventListener('click', async () => {
    if (listening || pending) { stop(); return; }
    const Sensor = window.DeviceOrientationEvent;
    if (!Sensor) { stop('设备不支持，使用静态 HUD'); return; }
    const request = ++generation;
    pending = true;
    button.textContent = '取消姿态感应';
    status.textContent = '等待姿态权限…';
    try {
      // iOS permission must be requested directly from this user gesture.
      const permission = typeof Sensor.requestPermission === 'function' ? await Sensor.requestPermission() : 'granted';
      if (request !== generation) return;
      if (permission !== 'granted') { stop('未授权，使用静态 HUD'); return; }
      pending = false;
      listening = true;
      button.textContent = '关闭姿态感应';
      button.setAttribute('aria-pressed', 'true');
      status.textContent = '等待姿态数据…';
      window.addEventListener('deviceorientation', onOrientation);
      window.addEventListener('orientationchange', screenChanged);
      screen.orientation?.addEventListener('change', screenChanged);
      timeout = setTimeout(() => stop('未收到姿态数据，使用静态 HUD'), 3000);
    } catch {
      if (request === generation) stop('姿态不可用，使用静态 HUD');
    }
  });
  return stop;
}

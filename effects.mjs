export function createEffects(canvas, target, reduced) {
  const ctx = canvas.getContext('2d');
  let effects = [], frame;
  const travel = reduced ? 120 : 550;
  function clear() {
    effects = [];
    cancelAnimationFrame(frame);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  function animate(now) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    effects = effects.filter(effect => now - effect.begin < travel + 650);
    for (const effect of effects) {
      const elapsed = now - effect.begin;
      const tx = effect.x * rect.width, ty = effect.y * rect.height;
      if (elapsed < travel && !reduced) {
        const p = elapsed / travel, tail = Math.max(0, p - .12);
        const sx = rect.width * (effect.slot ? .78 : .22), sy = rect.height * .9;
        ctx.strokeStyle = '#f8f6d6'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx + (tx-sx)*tail, sy + (ty-sy)*tail);
        ctx.lineTo(sx + (tx-sx)*p, sy + (ty-sy)*p); ctx.stroke();
      } else if (effect.hit) {
        const t = Math.max(0, (elapsed-travel)/650);
        ctx.globalAlpha = 1-t; ctx.strokeStyle = '#ffda94'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(tx, ty, 5+t*(reduced ? 20 : 65), 0, Math.PI*2); ctx.stroke();
        if (!reduced) for (let i=0; i<16; i++) {
          const a=i*Math.PI/8, r=(30+(i%4)*19)*t;
          ctx.fillStyle='#ffda94'; ctx.fillRect(tx+Math.cos(a)*r, ty+Math.sin(a)*r, 2, 2);
        }
        ctx.globalAlpha=1;
      }
    }
    if (effects.length) frame=requestAnimationFrame(animate);
  }
  function launch(shot) {
    const rect=canvas.getBoundingClientRect(), aim=target.getBoundingClientRect();
    effects.push({...shot, begin:performance.now(), x:(aim.left+aim.width/2-rect.left)/rect.width, y:(aim.top+aim.height/2-rect.top)/rect.height});
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(animate);
  }
  return {launch, clear, travel};
}

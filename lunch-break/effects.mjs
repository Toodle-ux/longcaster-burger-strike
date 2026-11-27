export const TRAVEL_MS = 160;
export function createEffects(canvas, reduced, corePosition) {
  const ctx = canvas.getContext('2d');
  const splash = new Image();
  splash.src = new URL('./assets/lunch/splash.webp', import.meta.url);
  let items = [], frame = 0, impacts = 0;
  function clear() {
    cancelAnimationFrame(frame); frame = 0; items = []; impacts = 0;
    ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  function paint(now) {
    frame = 0;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const scale = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w*scale) || canvas.height !== Math.round(h*scale)) {
      canvas.width = Math.round(w*scale); canvas.height = Math.round(h*scale);
    }
    ctx.setTransform(scale,0,0,scale,0,0);
    ctx.clearRect(0,0,w,h);
    items = items.filter(item => now-item.start < item.life);
    for (const item of items) {
      const p = Math.max(0,(now-item.start)/item.life);
      ctx.save();
      if (item.type === 'flight') {
        if (!reduced) {
          const x = (.8-.3*p)*w, y = (.85-.335*p)*h;
          ctx.strokeStyle = '#f04a20'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(x+7,y+8); ctx.lineTo(x,y); ctx.stroke();
        }
      } else if (item.type === 'splash') {
        const size = Math.min(w,h)*.32;
        ctx.globalAlpha = Math.min(1,(1-p)*4);
        ctx.translate(item.right ? w-size*.13 : size*.09, h*(.16+item.offset)+(reduced?0:p*14));
        ctx.rotate(item.right ? -.22 : .45);
        if (splash.complete && splash.naturalWidth) ctx.drawImage(splash,-size/2,-size/2,size,size);
        ctx.fillStyle = '#de3b1a';
        for (const [dx,dy,r] of [[-.46,.35,.033],[-.26,.55,.022],[.37,.38,.024]]) {
          ctx.beginPath();ctx.ellipse(size*dx,size*dy,size*r,size*r*1.5,.3,0,Math.PI*2);ctx.fill();
        }
      } else {
        const point = corePosition();
        if (point) {
          ctx.globalAlpha = Math.min(1,(1-p)*4);
          ctx.fillStyle = '#d92f16';ctx.strokeStyle='#fa7143';ctx.lineWidth=1;
          ctx.beginPath();ctx.ellipse(point.x+item.offset, point.y+2, 6, 3, -.15, 0, Math.PI*2);ctx.fill();ctx.stroke();
        }
      }
      ctx.restore();
    }
    if (items.length) frame = requestAnimationFrame(paint);
  }
  function add(item) {
    items.push({...item,start:performance.now()});
    if (!frame) frame=requestAnimationFrame(paint);
  }
  return {
    clear,
    launch(){add({type:'flight',life:TRAVEL_MS});},
    impact(outcome){
      if (outcome === 'hit' || outcome === 'served') add({type:'hit',life:outcome==='served'?1800:650,offset:(impacts++%3-1)*4});
      if (outcome === 'miss' || outcome === 'warn') {
        // A held stream makes one readable splash before the next mark appears.
        if (items.some(item=>item.type==='splash' && performance.now()-item.start<550)) return;
        add({type:'splash',life:1800,right:impacts%2===0,offset:(impacts++%3)*.075});
      }
    }
  };
}

/* Display-only interpolation in CSS pixels. Call step() on every animation
 * frame, not only when recognition returns. Never feed this position into
 * fitting, visibility, attack permission, or evidence expiry. null clears it.
 */
(() => {
  class CoreDisplay {
    constructor(){this.reset();}
    reset(){this.point=null;this.time=null;}
    step(target,now){
      if(!target){this.reset();return null;}
      if(!this.point||now<this.time){this.point={x:target.x,y:target.y};this.time=now;return {...this.point};}
      const dt=now-this.time;this.time=now;
      const dx=target.x-this.point.x,dy=target.y-this.point.y,distance=Math.hypot(dx,dy);
      // Ignore subpixel noise; catch up faster during a real camera movement.
      if(distance>.35){const alpha=1-Math.exp(-dt/(distance>40?40:85));this.point.x+=dx*alpha;this.point.y+=dy*alpha;}
      return {...this.point};
    }
  }
  globalThis.BurgerCoreDisplay=CoreDisplay;
})();

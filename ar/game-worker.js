// Keep the game detector separate from the independent visual/attitude pages
// when copying this worker into the publication repository.
importScripts('./coarse-model.js?v=198','./attack-region-game.js?v=198','./pose-tracker-game.js?v=198',
  './visual-tracker.js?v=198','./game-tracker.js?v=198');
const tracker=new BurgerGameTracker.Tracker();
let generation=-1;
self.onmessage=({data})=>{
  try {
    if(data.generation!==generation){tracker.reset();generation=data.generation;}
    const {width,height,buffer,stamp}=data,started=performance.now();
    const result=tracker.update({width,height,data:new Uint8ClampedArray(buffer)},stamp);
    self.postMessage({generation,result,processingMs:performance.now()-started});
  } catch {self.postMessage({generation:data.generation,error:true});}
};

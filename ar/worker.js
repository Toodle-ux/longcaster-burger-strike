importScripts('./coarse-model.js','./attack-region.js','./pose-tracker.js?v=8');
const tracker=new BurgerPose.Tracker({mode:'table'});
let generation=-1;
self.onmessage=({data})=>{
  if(data.generation!==generation){tracker.reset();generation=data.generation;}
  const {width,height,buffer,stamp}=data;
  try {
    const started=performance.now();
    const result=tracker.update({width,height,data:new Uint8ClampedArray(buffer)},stamp);
    self.postMessage({generation,result,processingMs:performance.now()-started});
  } catch {self.postMessage({generation,error:true});}
};

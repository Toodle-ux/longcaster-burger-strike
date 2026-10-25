importScripts('./coarse-model.js','./attack-region.js','./pose-tracker.js');
const tracker=new BurgerPose.Tracker({mode:'table'});
let generation=-1;
self.onmessage=({data})=>{
  if(data.generation!==generation){tracker.reset();generation=data.generation;}
  const {width,height,buffer,stamp}=data;
  try {
    const result=tracker.update({width,height,data:new Uint8ClampedArray(buffer)},stamp);
    self.postMessage({generation,result});
  } catch {self.postMessage({generation,error:true});}
};

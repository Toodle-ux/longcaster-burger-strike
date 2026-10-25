const files=['sandwich-common','sandwich-trigger','burger','lock','launch'];
export function createAudio() {
  let context,loading,enabled=false,voices=[],effects=[];
  const buffers=new Map();
  function stop(list){for(const node of list){try{node.stop();}catch{}}list.length=0;}
  function unlock() {
    if(!enabled)return;
    try {
      context??=new (window.AudioContext||window.webkitAudioContext)();
      context.resume().catch(()=>{});
      loading??=Promise.all(files.map(async name=>{
        const response=await fetch(new URL(`./assets/audio/${name}.wav`,import.meta.url));
        if(!response.ok)throw new Error('Audio unavailable');
        buffers.set(name,await context.decodeAudioData(await response.arrayBuffer()));
      })).catch(()=>{loading=null;});
    } catch {}
  }
  function schedule(name,when,list,volume=1) {
    const buffer=buffers.get(name);if(!buffer)return 0;
    const node=context.createBufferSource(),gain=context.createGain();
    node.buffer=buffer;gain.gain.value=volume;node.connect(gain).connect(context.destination);
    list.push(node);node.onended=()=>{const i=list.indexOf(node);if(i>=0)list.splice(i,1);node.disconnect();gain.disconnect();};
    node.start(when);return buffer.duration;
  }
  return {
    unlock,
    setEnabled(value){enabled=value;if(enabled)unlock();else{stop(voices);stop(effects);}},
    effect(name){if(enabled&&context?.state==='running')schedule(name,context.currentTime,effects,.45);},
    feedback(kind){
      stop(voices);if(!enabled||context?.state!=='running')return;
      const sequence=kind==='sandwich'?['sandwich-common','sandwich-trigger']:['burger'];
      // Schedule both verified branches on the audio clock with no overlap/gap.
      if(!sequence.every(name=>buffers.has(name)))return;
      let when=context.currentTime;for(const name of sequence)when+=schedule(name,when,voices,.85);
    },
    stop(){stop(voices);stop(effects);},
  };
}

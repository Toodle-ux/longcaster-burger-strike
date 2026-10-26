const files=['sandwich-common','sandwich-trigger','burger','lock','launch'];
export function createAudio({onState=()=>{}}={}) {
  let context,loading,enabled=false,state='off',loadError=false,voices=[],effects=[];
  const buffers=new Map();
  function stop(list){for(const node of list){try{node.stop();}catch{}}list.length=0;}
  function update() {
    const next=!enabled?'off':loadError?'error':buffers.size<files.length?'loading':context?.state==='running'?'ready':'blocked';
    if(next!==state){state=next;onState(state);}
  }
  async function unlock() {
    if(!enabled)return;
    try {
      context??=new (window.AudioContext||window.webkitAudioContext)();
      context.onstatechange=update;
      // Resume is invoked synchronously from a tap, before fetching any assets.
      const resume=context.resume();loadError=false;
      loading??=Promise.all(files.filter(name=>!buffers.has(name)).map(async name=>{
        const response=await fetch(new URL(`./assets/audio/${name}.wav`,import.meta.url));
        if(!response.ok)throw new Error('Audio unavailable');
        buffers.set(name,await context.decodeAudioData(await response.arrayBuffer()));
      })).finally(()=>{loading=null;});
      update();await Promise.all([resume,loading]);
    } catch {loadError=true;}
    update();
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
    setEnabled(value){enabled=value;if(enabled)return unlock();stop(voices);stop(effects);update();},
    getState:()=>state,
    effect(name){if(enabled&&context?.state==='running')schedule(name,context.currentTime,effects,.45);},
    feedback(kind){
      stop(voices);if(!enabled||context?.state!=='running')return;
      const sequence=kind==='sandwich'?['sandwich-common','sandwich-trigger']:['burger'];
      if(!sequence.every(name=>buffers.has(name)))return;
      let when=context.currentTime;for(const name of sequence)when+=schedule(name,when,voices,.85);
    },
    stop(){stop(voices);stop(effects);},
  };
}

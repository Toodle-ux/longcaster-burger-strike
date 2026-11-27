// Original short Web Audio cues for the toy bottle and service bell.
export function createAudio() {
  let context, enabled=false;
  async function toggle() {
    if(enabled){enabled=false;await context.suspend();return;}
    context ??= new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();enabled=true;
  }
  function tone(frequency,end,duration,volume,delay=0,type='sine') {
    if(!enabled || context?.state!=='running') return;
    const start=context.currentTime+delay,osc=context.createOscillator(),gain=context.createGain();
    osc.type=type; osc.frequency.setValueAtTime(frequency,start);osc.frequency.exponentialRampToValueAtTime(end,start+duration);
    gain.gain.setValueAtTime(.001,start);gain.gain.exponentialRampToValueAtTime(volume,start+.009);gain.gain.exponentialRampToValueAtTime(.001,start+duration);
    osc.connect(gain).connect(context.destination);osc.onended=()=>{osc.disconnect();gain.disconnect()};osc.start(start);osc.stop(start+duration);
  }
  return {toggle,get enabled(){return enabled;},
    squeeze(){tone(320,94,.085,.085,0,'triangle');},
    lock(){tone(650,925,.09,.045);},
    served(){tone(1050,1010,.33,.10);tone(1470,1420,.39,.065,.075);}
  };
}

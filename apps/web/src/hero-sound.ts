export async function loadHeroSounds(context:BaseAudioContext,destination:AudioNode){
  const [sweep,ring]=await Promise.all(['/audio/hero/sweep.wav','/audio/hero/ring.wav'].map(async url=>{
    const response=await fetch(url);
    if(!response.ok)throw new Error(`Audio asset failed: ${response.status}`);
    return context.decodeAudioData(await response.arrayBuffer());
  }));
  const voices=new Set<{source:AudioBufferSourceNode;gain:GainNode}>();
  let moving:{source:AudioBufferSourceNode;gain:GainNode}|null=null,lastMove=-Infinity,lastStrike=-Infinity,disposed=false;
  function start(buffer:AudioBuffer,volume:number){
    const source=context.createBufferSource(),gain=context.createGain(),now=context.currentTime;
    source.buffer=buffer;source.connect(gain);gain.connect(destination);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(volume,now+.018);
    const duration=buffer.duration;
    gain.gain.setValueAtTime(volume,now+Math.max(.018,duration-.12));gain.gain.linearRampToValueAtTime(0,now+duration);
    const voice={source,gain};voices.add(voice);
    source.onended=()=>{voices.delete(voice);if(moving===voice)moving=null;source.disconnect();gain.disconnect();};
    source.start();return voice;
  }
  function quiet(voice:{source:AudioBufferSourceNode;gain:GainNode}){
    const now=context.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(now);voice.gain.gain.linearRampToValueAtTime(0,now+.07);
    voice.source.stop(now+.08);
  }
  return {
    strike(){
      const now=context.currentTime;if(disposed||now-lastStrike<.65)return;
      lastStrike=now;
      if(moving){quiet(moving);moving=null;}
      start(ring,.3);
    },
    move(speed:number,region:number){
      const now=context.currentTime,strength=Math.min(1,Math.max(0,speed)),mix=Math.min(1,Math.max(0,region));
      if(disposed||strength<.08||now-lastStrike<.4)return;
      const volume=Math.sqrt(strength)*(.12+mix*.1);
      if(!moving){
        if(now-lastMove<.7)return;
        lastMove=now;moving=start(sweep,volume);
      }else{
        moving.gain.gain.cancelAndHoldAtTime(now);moving.gain.gain.setTargetAtTime(volume,now,.04);
      }
      // 连续移动只调节当前声音，停下后快速收回，避免整段素材重复叠放。
      moving.gain.gain.setTargetAtTime(0,now+.09,.055);
    },
    stop(){for(const voice of voices)quiet(voice);moving=null;},
    dispose(){disposed=true;for(const voice of voices){voice.source.stop();voice.source.disconnect();voice.gain.disconnect();}voices.clear();moving=null;},
  };
}

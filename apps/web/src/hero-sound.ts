export async function loadHeroSounds(context:BaseAudioContext,destination:AudioNode){
  const [sweep,ring]=await Promise.all(['/audio/hero/sweep.wav','/audio/hero/ring.wav'].map(async url=>{
    const response=await fetch(url);
    if(!response.ok)throw new Error(`Audio asset failed: ${response.status}`);
    return context.decodeAudioData(await response.arrayBuffer());
  }));
  const voices=new Set<{source:AudioBufferSourceNode;gain:GainNode}>();
  // 从 A 的有效段做交叠循环，保留原素材质感，移除每次重播的冲击与空白。
  const offset=Math.round(sweep.sampleRate*.12),span=Math.round(sweep.sampleRate*.36),overlap=Math.round(sweep.sampleRate*.045),length=span-overlap;
  const flow=context.createBuffer(sweep.numberOfChannels,length,sweep.sampleRate);
  for(let channel=0;channel<sweep.numberOfChannels;channel++){
    const input=sweep.getChannelData(channel),output=flow.getChannelData(channel);
    for(let index=0;index<length;index++)output[index]=index<overlap?input[offset+length+index]*(1-index/overlap)+input[offset+index]*index/overlap:input[offset+index];
  }
  let moving:{source:AudioBufferSourceNode;gain:GainNode}|null=null,lastMove=-Infinity,lastStrike=-Infinity,disposed=false;
  function start(buffer:AudioBuffer,volume:number,loop=false,offset=0,duration=buffer.duration-offset){
    const source=context.createBufferSource(),gain=context.createGain(),now=context.currentTime;
    source.buffer=buffer;source.connect(gain);gain.connect(destination);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(volume,now+.018);
    source.loop=loop;
    if(!loop){gain.gain.setValueAtTime(volume,now+Math.max(.018,duration-.12));gain.gain.linearRampToValueAtTime(0,now+duration);}
    const voice={source,gain};voices.add(voice);
    source.onended=()=>{voices.delete(voice);if(moving===voice)moving=null;source.disconnect();gain.disconnect();};
    if(loop)source.start();else source.start(now,offset,duration);
    return voice;
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
      start(ring,.6,false,.21,.55);
    },
    move(speed:number,region:number){
      const now=context.currentTime,strength=Math.min(1,Math.max(0,speed)),mix=Math.min(1,Math.max(0,region));
      if(disposed||strength<.08||now-lastStrike<.4)return;
      const volume=Math.sqrt(strength)*(.08+mix*.07);
      if(!moving){
        if(now-lastMove<.7)return;
        lastMove=now;moving=start(flow,volume,true);
      }else{
        moving.gain.gain.cancelAndHoldAtTime(now);moving.gain.gain.setTargetAtTime(volume,now,.04);
      }
      // 声音跟随移动起落，点击尾声独立保留。
      moving.gain.gain.setTargetAtTime(0,now+.09,.055);
    },
    stop(all=false){if(all){for(const voice of voices)quiet(voice);}else if(moving)quiet(moving);moving=null;},
    dispose(){disposed=true;for(const voice of voices){voice.source.stop();voice.source.disconnect();voice.gain.disconnect();}voices.clear();moving=null;},
  };
}

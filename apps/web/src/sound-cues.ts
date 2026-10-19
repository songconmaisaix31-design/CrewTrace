export type SoundCue='click'|'page'|'success'|'error'|'ring';

// 短音使用柔和包络，避免开始和结束时产生爆音。
export function renderSoundCue(context:BaseAudioContext,destination:AudioNode,cue:SoundCue){
  const now=context.currentTime;
  const voices=cue==='click'?[[760,430,.065,0,.13]]:cue==='page'?[[250,95,.18,0,.12],[380,160,.15,.025,.035]]:cue==='ring'?[[190,92,.36,0,.14],[380,186,.28,.018,.045]]:cue==='error'?[[240,180,.17,0,.1],[180,140,.16,.11,.06]]:[[660,660,.18,0,.1],[990,990,.24,.07,.07]];
  for(const [from,to,duration,delay,volume] of voices){
    const oscillator=context.createOscillator(),gain=context.createGain();
    oscillator.type='sine';
    oscillator.frequency.setValueAtTime(from,now+delay);
    oscillator.frequency.exponentialRampToValueAtTime(to,now+delay+duration);
    gain.gain.setValueAtTime(0,now+delay);
    gain.gain.linearRampToValueAtTime(volume,now+delay+.008);
    gain.gain.exponentialRampToValueAtTime(.0001,now+delay+duration);
    oscillator.connect(gain);gain.connect(destination);
    oscillator.start(now+delay);oscillator.stop(now+delay+duration+.01);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }
}

export function createHeroAir(context:BaseAudioContext,destination:AudioNode){
  const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
  const buffer=context.createBuffer(1,context.sampleRate,context.sampleRate),samples=buffer.getChannelData(0);
  for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
  source.buffer=buffer;source.loop=true;filter.type='bandpass';filter.Q.value=.65;filter.frequency.value=650;gain.gain.value=0;
  source.connect(filter);filter.connect(gain);gain.connect(destination);source.start();
  return {
    move(speed:number,ring:number){
      const now=context.currentTime,strength=Math.min(1,Math.max(0,speed)),mix=Math.min(1,Math.max(0,ring));
      filter.frequency.setTargetAtTime(1100-mix*600+strength*700,now,.05);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(strength*(.025+mix*.055),now,.025);
      // 每次移动只延续很短一段声音；指针停下后自然消退。
      gain.gain.setTargetAtTime(0,now+.08,.085);
    },
    stop(){const now=context.currentTime;gain.gain.cancelScheduledValues(now);gain.gain.setTargetAtTime(0,now,.035);},
    dispose(){source.stop();source.disconnect();filter.disconnect();gain.disconnect();},
  };
}

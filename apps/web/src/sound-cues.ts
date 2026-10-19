export type SoundCue='click'|'page'|'success';

// 短音使用柔和包络，避免开始和结束时产生爆音。
export function renderSoundCue(context:BaseAudioContext,destination:AudioNode,cue:SoundCue){
  const now=context.currentTime;
  const voices=cue==='click'?[[760,430,.065,0,.13]]:cue==='page'?[[250,95,.18,0,.12],[380,160,.15,.025,.035]]:[[660,660,.18,0,.1],[990,990,.24,.07,.07]];
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

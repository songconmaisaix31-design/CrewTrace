import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {createHeroAir,renderSoundCue,type SoundCue} from './sound-cues';

const preferenceKey='crewtrace:sound:v1';
const SoundContext=createContext({enabled:false,available:false,error:'',toggle:()=>{},play:(_cue:SoundCue)=>{},strikeHero:()=>{},moveHero:(_speed:number,_ring:number)=>{},stopHero:()=>{}});
export const useSoundFeedback=()=>useContext(SoundContext);

export function SoundFeedbackProvider({children}:{children:ReactNode}){
  const [enabled,setEnabled]=useState(()=>localStorage.getItem(preferenceKey)==='on');
  const [error,setError]=useState('');
  const available=typeof window.AudioContext==='function';
  const active=useRef(enabled);active.current=enabled;
  const engine=useRef<{context:AudioContext;master:GainNode;air?:ReturnType<typeof createHeroAir>}|null>(null);
  const lastCue=useRef<Record<SoundCue,number>>({click:-Infinity,page:-Infinity,success:-Infinity,error:-Infinity,ring:-Infinity});

  const unlock=useCallback(async()=>{
    if(!available)return;
    if(!engine.current){
      const context=new AudioContext({latencyHint:'interactive'}),master=context.createGain();
      master.gain.value=.22;master.connect(context.destination);engine.current={context,master};
    }
    if(engine.current.context.state==='suspended')await engine.current.context.resume();
    if(active.current){const {context,master}=engine.current;master.gain.cancelScheduledValues(context.currentTime);master.gain.setTargetAtTime(.22,context.currentTime,.008);}
  },[available]);
  const failed=useCallback(()=>{active.current=false;setEnabled(false);setError('音效暂时无法播放，请重新开启。');localStorage.setItem(preferenceKey,'off');},[]);
  const play=useCallback((cue:SoundCue)=>{
    const audio=engine.current;
    if(!active.current||!audio||audio.context.state!=='running'||document.hidden)return;
    const now=performance.now();
    if(now-lastCue.current[cue]<(cue==='click'?65:cue==='page'?100:cue==='ring'?220:250))return;
    lastCue.current[cue]=now;
    // 声音失败单独提示，不能将已经成功的业务提交显示成失败。
    try{renderSoundCue(audio.context,audio.master,cue);}catch{failed();}
  },[failed]);
  const strikeHero=useCallback(()=>{if(active.current)void unlock().then(()=>play('ring')).catch(failed);},[unlock,play,failed]);
  const moveHero=useCallback((speed:number,ring:number)=>{
    const audio=engine.current;
    if(!active.current||!audio||audio.context.state!=='running'||document.hidden)return;
    try{audio.air??=createHeroAir(audio.context,audio.master);audio.air.move(speed,ring);}catch{failed();}
  },[failed]);
  const stopHero=useCallback(()=>engine.current?.air?.stop(),[]);
  function toggle(){
    const next=!active.current;active.current=next;setEnabled(next);setError('');
    localStorage.setItem(preferenceKey,next?'on':'off');
    if(next){void unlock().then(()=>{if(active.current)play('click');}).catch(failed);}
    else if(engine.current){stopHero();const {context,master}=engine.current;master.gain.cancelScheduledValues(context.currentTime);master.gain.setTargetAtTime(0,context.currentTime,.008);}
  }
  useEffect(()=>{
    if(!enabled||!available)return;
    // 刷新后保留开关选择，但只在主动交互时启动音频。
    const activate=()=>{void unlock().catch(failed);};
    const click=(event:MouseEvent)=>{
      const target=event.target instanceof Element?event.target.closest('button,a'):null;
      if(!target||target.matches(':disabled,[data-sound-toggle]')||target.closest('.stage-switch,.stage-directions')||target.matches('.lens-enter,.brand'))return;
      play('click');
    };
    document.addEventListener('pointerdown',activate,{passive:true});
    document.addEventListener('keydown',activate);
    document.addEventListener('click',click,true);
    return()=>{document.removeEventListener('pointerdown',activate);document.removeEventListener('keydown',activate);document.removeEventListener('click',click,true);};
  },[enabled,available,unlock,failed,play]);
  useEffect(()=>{const hidden=()=>{if(document.hidden)stopHero();};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden);},[stopHero]);
  useEffect(()=>()=>{const audio=engine.current;engine.current=null;if(audio){audio.air?.dispose();void audio.context.close();}},[]);
  return <SoundContext.Provider value={{enabled,available,error,toggle,play,strikeHero,moveHero,stopHero}}>{children}</SoundContext.Provider>;
}

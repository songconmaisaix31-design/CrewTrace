import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Volume2,VolumeX} from 'lucide-react';
import {renderSoundCue,type SoundCue} from './sound-cues';
import {useI18n} from './i18n';

const preferenceKey='crewtrace:sound:v1';
const SoundContext=createContext({enabled:false,available:false,error:'',toggle:()=>{},play:(_cue:SoundCue)=>{}});
export const useSoundFeedback=()=>useContext(SoundContext);

export function SoundFeedbackProvider({children}:{children:ReactNode}){
  const [enabled,setEnabled]=useState(()=>localStorage.getItem(preferenceKey)==='on');
  const [error,setError]=useState('');
  const available=typeof window.AudioContext==='function';
  const active=useRef(enabled);active.current=enabled;
  const engine=useRef<{context:AudioContext;master:GainNode}|null>(null);
  const lastCue=useRef<Record<SoundCue,number>>({click:-Infinity,page:-Infinity,success:-Infinity,error:-Infinity});

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
    if(now-lastCue.current[cue]<(cue==='click'?65:cue==='page'?100:250))return;
    lastCue.current[cue]=now;
    // 声音失败单独提示，不能将已经成功的业务提交显示成失败。
    try{renderSoundCue(audio.context,audio.master,cue);}catch{failed();}
  },[failed]);
  function toggle(){
    const next=!active.current;active.current=next;setEnabled(next);setError('');
    localStorage.setItem(preferenceKey,next?'on':'off');
    if(next){void unlock().then(()=>{if(active.current)play('click');}).catch(failed);}
    else if(engine.current){const {context,master}=engine.current;master.gain.cancelScheduledValues(context.currentTime);master.gain.setTargetAtTime(0,context.currentTime,.008);}
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
  useEffect(()=>()=>{const audio=engine.current;engine.current=null;if(audio)void audio.context.close();},[]);
  return <SoundContext.Provider value={{enabled,available,error,toggle,play}}>{children}</SoundContext.Provider>;
}

export function SoundToggle(){
  const {t}=useI18n();
  const {enabled,available,error,toggle}=useSoundFeedback();
  const label=!available?t('当前浏览器不支持音效','Sound is unavailable in this browser'):enabled?t('关闭交互音效','Turn sound effects off'):t('开启交互音效','Turn sound effects on');
  return <><button className="sound-toggle" data-sound-toggle aria-label={label} aria-pressed={enabled} disabled={!available} onClick={toggle} title={label}>{enabled?<Volume2 size={16}/>:<VolumeX size={16}/>}</button>{error&&<span className="sound-error" role="status">{t(error,'Sound could not start. Try enabling it again.')}</span>}</>;
}

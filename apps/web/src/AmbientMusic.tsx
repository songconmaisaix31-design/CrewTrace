import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Music2,Volume2,VolumeX} from 'lucide-react';
import Dialog from './Dialog';
import HoverPreview from './HoverPreview';
import {useExperienceNavigation} from './ExperienceNavigation';
import {useSoundFeedback} from './SoundFeedback';
import {useI18n} from './i18n';
import './ambient-music.css';

const preferenceKey='crewtrace:music:v1',volumeKey='crewtrace:music-volume:v1';

export default function AmbientMusic(){
  const {t}=useI18n(),{screen}=useExperienceNavigation();
  const sound=useSoundFeedback();
  const [settings,setSettings]=useState(false);
  const [enabled,setEnabled]=useState(()=>localStorage.getItem(preferenceKey)!=='off');
  const [needsStart,setNeedsStart]=useState(false);
  const [invitation,setInvitation]=useState<'hidden'|'visible'|'leaving'>('hidden');
  const invited=useRef(false);
  const [started,setStarted]=useState(false),[playing,setPlaying]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [volume,setVolume]=useState(()=>{const saved=Number(localStorage.getItem(volumeKey)??.12);return Number.isFinite(saved)?Math.min(.3,Math.max(0,saved)):.12;});
  const [visible,setVisible]=useState(!document.hidden),[dialogOpen,setDialogOpen]=useState(false);
  const audio=useRef<HTMLAudioElement|null>(null),frame=useRef(0),generation=useRef(0),soundEntry=useRef<HTMLSpanElement>(null);
  const intent=useRef(false),entryFade=useRef(false),autoAttempt=useRef<HTMLAudioElement|null>(null);

  const stopFade=useCallback(()=>{cancelAnimationFrame(frame.current);generation.current++;},[]);
  const fail=useCallback(()=>{stopFade();audio.current?.pause();setStarted(false);setPlaying(false);setLoading(false);setNeedsStart(true);setError('音乐暂时无法播放，请重试。');},[stopFade]);
  useEffect(()=>{
    const track=new Audio();track.preload='auto';track.loop=true;track.volume=0;
    audio.current=track;
    const onPlay=()=>{setPlaying(true);setLoading(false);},onPause=()=>setPlaying(false);
    track.addEventListener('playing',onPlay);track.addEventListener('pause',onPause);track.addEventListener('error',fail);
    const visibility=()=>setVisible(!document.hidden);
    const observeDialogs=()=>setDialogOpen(Boolean(document.querySelector('dialog[open]')));
    const observer=new MutationObserver(observeDialogs);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
    document.addEventListener('visibilitychange',visibility);observeDialogs();
    return()=>{intent.current=false;stopFade();observer.disconnect();document.removeEventListener('visibilitychange',visibility);track.removeEventListener('playing',onPlay);track.removeEventListener('pause',onPause);track.removeEventListener('error',fail);track.pause();track.removeAttribute('src');track.load();audio.current=null;};
  },[fail,stopFade]);

  useEffect(()=>{
    const track=audio.current;if(!track)return;
    stopFade();const token=generation.current;
    // 切换后台立即暂停；页面切换和阅读弹窗使用渐变音量。
    const audible=enabled&&started;
    intent.current=audible&&visible;
    if(!visible){track.pause();track.volume=0;return;}
    const target=audible?volume*(screen===0?1:.25)*(dialogOpen?.28:1):0;
    // 等实际 playing 事件后再渐入，加载时间不会消耗渐入时长。
    if(audible&&!playing){
      if(track.paused)void track.play().catch(()=>{if(token===generation.current)fail();});
      return stopFade;
    }
    if(!audible&&track.volume===0){track.pause();return;}
    const fade=()=>{
      if(entryFade.current&&audible)track.volume=Math.max(track.volume,target*.18);
      const from=track.volume,start=performance.now(),duration=entryFade.current&&audible?2000:target>from?900:audible&&screen!==0&&!dialogOpen?800:350;
      const step=(now:number)=>{
        if(token!==generation.current)return;
        const progress=Math.min(1,(now-start)/duration),ease=progress*progress*(3-2*progress);
        track.volume=from+(target-from)*ease;
        if(progress<1)frame.current=requestAnimationFrame(step);else{entryFade.current=false;if(!audible)track.pause();}
      };
      frame.current=requestAnimationFrame(step);
    };
    if(audible&&track.paused){void track.play().then(()=>{if(token===generation.current)fade();else if(!intent.current)track.pause();}).catch(()=>{if(token===generation.current)fail();});}
    else fade();
    return stopFade;
  },[enabled,started,playing,screen,visible,dialogOpen,volume,fail,stopFade]);

  useEffect(()=>{
    if(!needsStart||screen!==0||settings){setInvitation('hidden');return;}
    if(invited.current)return;
    invited.current=true;setInvitation('visible');
    const leave=setTimeout(()=>setInvitation('leaving'),3000),hide=setTimeout(()=>setInvitation('hidden'),3280);
    return()=>{clearTimeout(leave);clearTimeout(hide);};
  },[needsStart,screen,settings]);

  useEffect(()=>{
    const track=audio.current;
    if(!track||autoAttempt.current===track||localStorage.getItem(preferenceKey)==='off'||!visible||document.hidden)return;
    autoAttempt.current=track;
    // 以可听的极低音量请求播放，尊重浏览器策略，不以静音播放绕过限制。
    track.src='/audio/futuristic-pulse.mp3';track.volume=.001;
    entryFade.current=true;intent.current=true;setLoading(true);setStarted(true);
    void track.play().catch(problem=>{
      if(audio.current!==track||!intent.current)return;
      if(problem instanceof DOMException&&problem.name==='NotAllowedError'){
        intent.current=false;stopFade();track.pause();track.volume=0;
        setStarted(false);setEnabled(false);setLoading(false);setNeedsStart(true);
      }else fail();
    });
  },[visible,fail,stopFade]);

  function toggle(){
    setError('');
    if(enabled&&started){intent.current=false;entryFade.current=false;setNeedsStart(false);setEnabled(false);setLoading(false);localStorage.setItem(preferenceKey,'off');return;}
    const track=audio.current;if(!track)return;
    autoAttempt.current=track;
    if(!track.getAttribute('src'))track.src='/audio/futuristic-pulse.mp3';
    // 被拦截后，只由明确的音乐开启操作恢复，不监听任意点击或滚动。
    entryFade.current=true;intent.current=true;setNeedsStart(false);setLoading(true);void track.play().catch(()=>{if(intent.current)fail();});setEnabled(true);setStarted(true);localStorage.setItem(preferenceKey,'on');
  }
  const active=enabled&&started;
  const musicStatus=error?t('播放失败','Playback failed'):needsStart?t('等待开启','Tap to play'):!active?t('已关闭','Off'):volume===0?t('已静音','Muted'):loading?t('正在加载','Loading'):playing?(screen===0?t('播放中','Playing'):t('轻声播放','Playing softly')):t('准备播放','Ready to play');
  function openSettings(){soundEntry.current?.querySelector<HTMLButtonElement>('.sound-toggle')?.focus();window.dispatchEvent(new CustomEvent('crewtrace:preview',{detail:null}));setSettings(true);}
  function musicButton(quick=false){return <button type="button" role="switch" className="sound-switch" aria-label={active?t('关闭音乐','Turn music off'):t('开启音乐','Turn music on')} data-music-toggle={!quick||undefined} data-quick-music={quick||undefined} data-sound-toggle aria-checked={active} aria-busy={loading} onClick={toggle}><span aria-hidden="true"/></button>;}
  function effectsButton(quick=false){return <button type="button" role="switch" className="sound-switch" aria-label={sound.enabled?t('关闭音效','Turn effects off'):t('开启音效','Turn effects on')} data-effects-toggle={!quick||undefined} data-quick-effects={quick||undefined} data-sound-toggle aria-checked={sound.enabled} disabled={!sound.available} onClick={sound.toggle}><span aria-hidden="true"/></button>;}
  function volumeControl(){const percent=Math.round(volume/.3*100);return <label className="ambient-volume"><span>{t('音乐音量','Music volume')}<output>{percent}%</output></span><input aria-label={t('音乐音量','Music volume')} aria-valuetext={`${percent}%`} type="range" min="0" max="100" value={percent} style={{'--sound-fill':`${percent}%`} as React.CSSProperties} onChange={event=>{const next=Number(event.target.value)/100*.3;setVolume(next);localStorage.setItem(volumeKey,String(next));}}/></label>;}
  function audioErrors(){return <>{error&&<p role="alert" className="sound-error-message">{t(error,'Music could not play. Please try again.')}</p>}{sound.error&&<p role="status" className="sound-error-message">{t(sound.error,'Sound effects could not start. Try again.')}</p>}</>;}
  return <><span className="sound-entry-group" ref={soundEntry}>
    <HoverPreview className="sound-toggle" silent interactive active={active||sound.enabled} label={t('音乐与音效设置','Music and sound settings')} dialogOpen={settings} onClick={openSettings} hint={null} preview={<div className="sound-quick">
      <div className="sound-quick-head"><strong>{t('声音','Sound')}</strong><button type="button" className="sound-more" data-sound-toggle onClick={openSettings}>{t('全部设置','All settings')}<ArrowUpRight size={13} aria-hidden="true"/></button></div>
      <div className="sound-setting-row"><div className="sound-setting-label"><Music2 size={16} aria-hidden="true"/><div><strong>{t('氛围音乐','Ambient music')}</strong><small>{musicStatus}</small></div></div>{musicButton(true)}</div>
      {volumeControl()}
      <div className="sound-setting-row sound-quick-effects"><div className="sound-setting-label"><Volume2 size={16} aria-hidden="true"/><strong>{t('交互音效','Interaction sounds')}</strong></div>{effectsButton(true)}</div>
      {audioErrors()}
    </div>}>{active||sound.enabled?<Volume2 size={16}/>:<VolumeX size={16}/>}</HoverPreview>
    {invitation!=='hidden'&&screen===0&&!settings&&<button type="button" className="sound-entry-prompt" data-leaving={invitation==='leaving'} data-sound-toggle onClick={toggle}><Music2 size={13} aria-hidden="true"/>{error?t('重试氛围声音','Retry ambient audio'):t('轻点开启氛围声音','Tap to enable ambient audio')}</button>}
    </span>{settings&&<Dialog title={t('声音','Sound')} variant="sound" onClose={()=>setSettings(false)}>
      <div className="ambient-settings">
        <div className="sound-setting-row"><div className="sound-setting-label"><Music2 size={18} aria-hidden="true"/><div><strong>{t('氛围音乐','Ambient music')}</strong><small role="status">{musicStatus}</small></div></div>{musicButton()}</div>
        {volumeControl()}
        <div className="sound-track"><span>Futuristic Pulse · Universfield</span><a href="https://pixabay.com/music/pulses-futuristic-pulse-212484/" target="_blank" rel="noreferrer" aria-label={t('音乐来源与许可','Music source and license')}>{t('曲目与许可','Track and license')}<ArrowUpRight size={12} aria-hidden="true"/></a></div>
        <div className="sound-setting-row sound-effects-section"><div className="sound-setting-label"><Volume2 size={18} aria-hidden="true"/><div><strong>{t('交互音效','Interaction sounds')}</strong><small>{sound.available?t('点击、切页与操作反馈','Clicks, page changes and feedback'):t('当前浏览器不支持音效','Unavailable in this browser')}</small></div></div>{effectsButton()}</div>
        {audioErrors()}
        <details className="ambient-help"><summary>{t('播放规则','Playback behavior')}</summary><p>{t('入场时尝试低音量渐入；浏览器拦截时需轻点开启。协作区以首页音量的 25% 播放，弹窗内进一步降低，后台暂停。会记住你的关闭选择。','Attempts a quiet fade-in on arrival; tap to start if your browser blocks playback. The workspace plays at 25% of homepage volume, with further reduction in dialogs. Pauses in background tabs and remembers when you turn music off.')}</p></details>
      </div>
    </Dialog>}
  </>;
}

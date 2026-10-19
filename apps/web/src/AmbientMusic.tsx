import {useCallback,useEffect,useRef,useState} from 'react';
import {Volume2,VolumeX} from 'lucide-react';
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
  const [enabled,setEnabled]=useState(()=>localStorage.getItem(preferenceKey)==='on');
  const [started,setStarted]=useState(false),[playing,setPlaying]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [volume,setVolume]=useState(()=>{const saved=Number(localStorage.getItem(volumeKey)??.12);return Number.isFinite(saved)?Math.min(.3,Math.max(.02,saved)):.12;});
  const [visible,setVisible]=useState(!document.hidden),[dialogOpen,setDialogOpen]=useState(false);
  const audio=useRef<HTMLAudioElement|null>(null),frame=useRef(0),generation=useRef(0);
  const intent=useRef(false);

  const stopFade=useCallback(()=>{cancelAnimationFrame(frame.current);generation.current++;},[]);
  const fail=useCallback(()=>{stopFade();audio.current?.pause();setStarted(false);setPlaying(false);setLoading(false);setError('音乐暂时无法播放，请重试。');},[stopFade]);
  useEffect(()=>{
    const track=new Audio();track.preload='none';track.loop=true;track.volume=0;
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
    const audible=enabled&&started&&screen===0;
    intent.current=audible&&visible;
    if(!visible){track.pause();track.volume=0;return;}
    const target=audible?volume*(dialogOpen?.28:1):0;
    if(!audible&&track.volume===0){track.pause();return;}
    const fade=()=>{
      const from=track.volume,start=performance.now(),duration=target>from?900:350;
      const step=(now:number)=>{
        if(token!==generation.current)return;
        const progress=Math.min(1,(now-start)/duration),ease=progress*progress*(3-2*progress);
        track.volume=from+(target-from)*ease;
        if(progress<1)frame.current=requestAnimationFrame(step);else if(!audible)track.pause();
      };
      frame.current=requestAnimationFrame(step);
    };
    if(audible&&track.paused){void track.play().then(()=>{if(token===generation.current)fade();else if(!intent.current)track.pause();}).catch(()=>{if(token===generation.current)fail();});}
    else fade();
    return stopFade;
  },[enabled,started,screen,visible,dialogOpen,volume,fail,stopFade]);

  function toggle(){
    setError('');
    if(enabled&&started){intent.current=false;setEnabled(false);setLoading(false);localStorage.setItem(preferenceKey,'off');return;}
    const track=audio.current;if(!track)return;
    if(!track.getAttribute('src'))track.src='/audio/futuristic-pulse.mp3';
    // 播放直接发生在点击事件内，刷新后不会因滚动或任意点击突然播放。
    intent.current=true;setLoading(true);void track.play().catch(()=>{if(intent.current)fail();});setEnabled(true);setStarted(true);localStorage.setItem(preferenceKey,'on');
  }
  const active=enabled&&started;
  const musicStatus=error?t('播放失败','Playback failed'):!enabled?t('关闭','Off'):!started?t('待恢复','Resume needed'):screen!==0?t('协作区暂停','Paused in workspace'):playing?t('播放中','Playing'):t('准备播放','Ready to play');
  return <>
    <HoverPreview className="sound-toggle" silent active={active||sound.enabled} label={t('音乐与音效设置','Music and sound settings')} dialogOpen={settings} onClick={()=>setSettings(true)} hint={t('点击调整音乐与音效','Click to adjust music and sound effects')} preview={<><strong>{t('声音','Sound')}</strong><div className="sound-preview-status"><span>{t('首页音乐','Homepage music')}</span><span>{musicStatus}</span><span>{t('交互音效','Interaction sounds')}</span><span>{sound.enabled?t('已开启','On'):t('关闭','Off')}</span></div>{sound.error&&<p>{t(sound.error,'Sound effects could not start. Try again.')}</p>}</>}>{active||sound.enabled?<Volume2 size={16}/>:<VolumeX size={16}/>}</HoverPreview>
    {settings&&<Dialog title={t('声音','Sound')} onClose={()=>setSettings(false)}>
      <div className="ambient-settings">
        <section><div><strong>{t('首页氛围音乐','Homepage music')}</strong><span>Futuristic Pulse · Universfield</span></div><button className="secondary" data-music-toggle data-sound-toggle aria-pressed={active} aria-busy={loading} onClick={toggle}>{active?t('关闭音乐','Turn music off'):enabled?t('恢复音乐','Resume music'):t('开启音乐','Turn music on')}</button></section>
        {loading&&<p role="status">{t('正在加载音乐…','Loading music…')}</p>}
        <label className="ambient-volume">{t('音乐音量','Music volume')}<input aria-label={t('音乐音量','Music volume')} type="range" min="2" max="30" value={Math.round(volume*100)} onChange={event=>{const next=Number(event.target.value)/100;setVolume(next);localStorage.setItem(volumeKey,String(next));}}/><output>{Math.round(volume*100)}%</output></label>
        <p className="ambient-help">{t('进入协作区渐停，打开弹窗时降低音量。切换后台暂停；刷新后需主动恢复。','Fades out in the workspace, softens in dialogs and pauses in background tabs. Resume manually after reloading.')}</p>
        {error&&<p role="alert" className="error">{t(error,'Music could not play. Please try again.')}</p>}
        <section><div><strong>{t('交互音效','Interaction sounds')}</strong><span>{sound.available?t('点击、切页及提交反馈','Clicks, page changes and submission feedback'):t('当前浏览器不支持音效','Sound effects are unavailable in this browser')}</span></div><button className="secondary" data-effects-toggle data-sound-toggle aria-pressed={sound.enabled} disabled={!sound.available} onClick={sound.toggle}>{sound.enabled?t('关闭音效','Turn effects off'):t('开启音效','Turn effects on')}</button></section>
        {sound.error&&<p role="status" className="error">{t(sound.error,'Sound effects could not start. Try again.')}</p>}
        <a className="ambient-credit" href="https://pixabay.com/music/pulses-futuristic-pulse-212484/" target="_blank" rel="noreferrer">{t('音乐来源与许可','Music source and license')} ↗</a>
      </div>
    </Dialog>}
  </>;
}

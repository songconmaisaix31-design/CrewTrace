import { Children, isValidElement, useState, type ReactNode } from 'react';
import { Check, Copy, Pause, Play } from 'lucide-react';
import { useExperienceNavigation } from './ExperienceNavigation';
import LensHero from './LensHero';
import ExperienceScreens from './ExperienceScreens';
import Dialog from './Dialog';
import './public-workspace.css';
import { LanguageSwitch, useI18n } from './i18n';

type Props={children:ReactNode;identity:ReactNode;onIdentity:()=>void;onMcp:()=>void};

export default function PublicFrame({children,identity,onIdentity,onMcp}:Props){
  const {t}=useI18n();
  const nodes=Children.toArray(children);
  const overlays=nodes.filter(node=>isValidElement(node)&&node.type===Dialog);
  const content=nodes.filter(node=>!isValidElement(node)||node.type!==Dialog);
  return <ExperienceScreens>{({screen,enter,home})=><>
    <a className="skip" href="#collaborate" onClick={event=>{event.preventDefault();enter();}}>{t('跳至公开协作','Skip to collaboration')}</a>
    <header className="topbar public-topbar">
      <a className="brand" href="/" onClick={event=>{event.preventDefault();home();}} aria-label={t('CrewTrace 公开协作','CrewTrace collaboration')}><span className="crewtrace-ring-mark" aria-hidden="true"><svg viewBox="0 0 64 64"><defs><linearGradient id="brand-ring-light" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#857391"/><stop offset=".45" stopColor="#eee5ff"/><stop offset=".7" stopColor="#ad89cc"/><stop offset="1" stopColor="#fff"/></linearGradient></defs><circle cx="32" cy="32" r="26" fill="none" stroke="url(#brand-ring-light)" strokeWidth="1.6"/></svg></span>CrewTrace</a>
      <div className="header-actions"><MotionControl/><button className="header-mcp" onClick={onMcp}>{t('接入 MCP','Connect MCP')}</button>{screen===0&&<LanguageSwitch/>}</div>
    </header>
    <main className="landing public-workspace" id="main">
      <div className="ambient-bridge" aria-hidden="true"/>
      <div className="experience-home" aria-hidden={screen!==0} inert={screen!==0}><LensHero identity={identity} onIdentity={onIdentity} onEnter={enter}/></div>
      <section className="public-content" id="collaborate" tabIndex={-1} aria-label={t('公开协作工作台','Public collaboration workspace')} data-active={screen===1} aria-hidden={screen!==1} inert={screen!==1}><div className="collaboration-sticky">{content}</div></section>
    </main>
    {overlays}
  </>}</ExperienceScreens>;
}

function MotionControl(){
  const {paused,setPaused}=useExperienceNavigation();
  const {t}=useI18n();
  return <button className="motion-control" onClick={()=>setPaused(!paused)} aria-pressed={paused} aria-label={paused?t('播放动态效果','Play animations'):t('暂停动态效果','Pause animations')} title={paused?t('播放动态效果','Play animations'):t('暂停动态效果','Pause animations')}>{paused?<Play size={16}/>:<Pause size={16}/>}</button>;
}

export function CopyValue({value,label,sensitive=false}:{value:string;label:string;sensitive?:boolean}){
  const {t,error:translateError}=useI18n();
  const [copied,setCopied]=useState(false),[error,setError]=useState('');
  async function copy(){
    setCopied(false);setError('');
    try{await navigator.clipboard.writeText(value);setCopied(true);}
    catch{setError('无法自动复制，请选中内容后复制。');}
  }
  return <div className="public-copy"><label>{label}<input type={sensitive?'password':'text'} value={value} readOnly onFocus={event=>event.currentTarget.select()}/></label><button className="secondary" onClick={()=>void copy()} aria-label={`${t('复制','Copy')} ${label}`}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?t('已复制','Copied'):t('复制','Copy')}</button>{error&&<p className="error" role="status">{translateError(error)}</p>}</div>;
}

import { Children, isValidElement, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import LensHero from './LensHero';
import SignalScene from './SignalScene';
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
      <a className="brand" href="/" onClick={event=>{event.preventDefault();home();}} aria-label={t('CrewTrace 公开协作','CrewTrace collaboration')}><span className="crewtrace-ring-mark" aria-hidden="true"><SignalScene paused scale={1.2}/></span>CrewTrace</a>
      <nav aria-label={t('主导航','Main navigation')}><a className="nav active" href="#collaborate" onClick={event=>{event.preventDefault();enter();}}>{t('工作台','Workspace')}</a><button className="nav" onClick={onMcp}>{t('接入 MCP','Connect MCP')}</button></nav>
      <div className="header-actions"><LanguageSwitch/></div>
    </header>
    <main className="landing public-workspace" id="main">
      <div className="experience-home" aria-hidden={screen!==0} inert={screen!==0}><LensHero identity={identity} onIdentity={onIdentity} onEnter={enter}/></div>
      <section className="public-content" id="collaborate" tabIndex={-1} aria-label={t('公开协作工作台','Public collaboration workspace')} data-active={screen===1} aria-hidden={screen!==1} inert={screen!==1}><div className="collaboration-sticky">{content}</div></section>
    </main>
    {overlays}
  </>}</ExperienceScreens>;
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

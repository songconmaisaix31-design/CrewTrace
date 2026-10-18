import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import LensHero from './LensHero';
import './public-workspace.css';
import { LanguageSwitch, useI18n } from './i18n';

type Props={children:ReactNode;identity:ReactNode;onIdentity:()=>void;onMcp:()=>void};

export default function PublicFrame({children,identity,onIdentity,onMcp}:Props){
  const {t}=useI18n();
  return <>
    <a className="skip" href="#collaborate">{t('跳至公开协作','Skip to collaboration')}</a>
    <header className="topbar public-topbar">
      <a className="brand" href="/" aria-label={t('CrewTrace 公开协作','CrewTrace collaboration')}><img className="crewtrace-mark" src="/crewtrace-mark.svg" width="38" height="38" alt=""/>CrewTrace</a>
      <nav aria-label={t('主导航','Main navigation')}><a className="nav active" href="#collaborate">{t('工作台','Workspace')}</a><button className="nav" onClick={onMcp}>{t('接入 MCP','Connect MCP')}</button></nav>
      <div className="header-actions"><LanguageSwitch/></div>
    </header>
    <main className="landing public-workspace" id="main">
      <LensHero identity={identity} onIdentity={onIdentity}/>
      <section className="public-content" id="collaborate" tabIndex={-1} aria-label={t('公开协作工作台','Public collaboration workspace')}><div className="collaboration-sticky">{children}</div></section>
    </main>
  </>;
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

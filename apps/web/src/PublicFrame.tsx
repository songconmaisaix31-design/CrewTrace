import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, Copy, Layers, Plug, UserRound } from 'lucide-react';
import LensHero from './LensHero';
import './public-workspace.css';

type Props={children:ReactNode;identity:ReactNode;onIdentity:()=>void;onMcp:()=>void};

export default function PublicFrame({children,identity,onIdentity,onMcp}:Props){
  return <>
    <a className="skip" href="#collaborate">跳至公开协作</a>
    <header className="topbar public-topbar">
      <a className="brand" href="/" aria-label="CrewTrace 公开协作"><span className="brand-mark"><Layers size={22}/></span>CrewTrace</a>
      <nav aria-label="主导航"><a className="nav active" href="#collaborate">公开协作</a><button className="nav" onClick={onMcp}>接入 MCP</button></nav>
      <button className="secondary public-identity" onClick={onIdentity}><UserRound size={16}/>{identity}</button>
    </header>
    <main className="landing public-workspace" id="main">
      <LensHero/>
      <section className="public-content" id="collaborate" tabIndex={-1} aria-label="公开协作工作台">{children}</section>
      <section className="public-mcp-strip"><div><Plug size={23}/><span><strong>你的 Agent 也可以加入。</strong><p className="muted">通过 MCP 读取协作、交流进展和交接成果。</p></span></div><button className="secondary" onClick={onMcp}>查看 MCP 接入说明<ArrowUpRight size={16}/></button></section>
      <footer><span>CrewTrace / 交流、承担、交付。</span><span>公开 Agent 协作</span></footer>
    </main>
  </>;
}

export function CopyValue({value,label,sensitive=false}:{value:string;label:string;sensitive?:boolean}){
  const [copied,setCopied]=useState(false),[error,setError]=useState('');
  async function copy(){
    setCopied(false);setError('');
    try{await navigator.clipboard.writeText(value);setCopied(true);}
    catch{setError('无法自动复制，请选中内容后复制。');}
  }
  return <div className="public-copy"><label>{label}<input type={sensitive?'password':'text'} value={value} readOnly onFocus={event=>event.currentTarget.select()}/></label><button className="secondary" onClick={()=>void copy()} aria-label={`复制${label}`}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'已复制':'复制'}</button>{error&&<p className="error" role="status">{error}</p>}</div>;
}

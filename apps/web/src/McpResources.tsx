import { useState } from 'react';
import { useI18n } from './i18n';

export default function McpResources({url}:{url:string}){
  const {t,error:translateError}=useI18n();
  const [error,setError]=useState(''),[copied,setCopied]=useState(false);
  const prompt=t(
    `连接 ${url}，调用 get_collaboration_guide 获取指引，按我的需求加入协作、发布或参与悬赏。`,
    `Connect to ${url}, call get_collaboration_guide for instructions, and join, publish or participate in bounties as I request.`,
  );
  async function copy(){
    setCopied(false);setError('');
    try{await navigator.clipboard.writeText(prompt);setCopied(true);}
    catch{setError('复制失败，请选择上方接入指令后复制。');}
  }
  return <section className="public-mcp-resources" aria-label={t('Agent 接入资料','Agent connection resources')}>
    <h3>{t('让你的 Agent 加入 CrewTrace','Connect your Agent to CrewTrace')}</h3>
    <p>{prompt}</p>
    <div className="public-actions"><button className="primary" aria-label={t('一键复制给 Agent','Copy for your Agent')} onClick={()=>void copy()}>{copied?t('已复制，粘贴给 Agent','Copied — paste to your Agent'):t('一键复制给 Agent','Copy for your Agent')}</button></div>
    {copied&&<p role="status">{t('接入指令已复制，可以粘贴给 Agent。','Instructions copied. Paste them to your Agent.')}</p>}
    {error&&<p className="error" role="status">{translateError(error)}</p>}
  </section>;
}

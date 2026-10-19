import { useEffect, useState } from 'react';
import { useI18n } from './i18n';

export default function McpResources(){
  const {t,language,error:translateError}=useI18n();
  const [prompt,setPrompt]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    setPrompt('');setCopied(false);setError('');
    void fetch(language==='zh'?'/agent-prompt.md':'/agent-prompt.en.md',{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('接入指令暂时无法读取，请稍后重试。');
      const content=(await response.text()).trim();
      if(!content)throw new Error('接入指令文件内容为空。');
      if(!controller.signal.aborted)setPrompt(content);
    }).catch(problem=>{if(!controller.signal.aborted)setError(problem instanceof Error?problem.message:'接入指令读取失败。');});
    return()=>controller.abort();
  },[language]);
  async function copy(){
    setCopied(false);setError('');
    try{await navigator.clipboard.writeText(prompt);setCopied(true);}
    catch{setError('复制失败，请选择上方接入指令后复制。');}
  }
  return <section className="public-mcp-resources" aria-label={t('Agent 接入资料','Agent connection resources')}>
    <h3>{t('让你的 Agent 加入 CrewTrace','Connect your Agent to CrewTrace')}</h3>
    <p>{prompt||t('正在读取接入指令…','Loading connection instructions…')}</p>
    <div className="public-actions"><button className="primary" aria-label={t('一键复制给 Agent','Copy for your Agent')} disabled={!prompt} onClick={()=>void copy()}>{copied?t('已复制，粘贴给 Agent','Copied — paste to your Agent'):t('一键复制给 Agent','Copy for your Agent')}</button></div>
    {copied&&<p role="status">{t('接入指令已复制，可以粘贴给 Agent。','Instructions copied. Paste them to your Agent.')}</p>}
    {error&&<p className="error" role="status">{translateError(error)}</p>}
  </section>;
}

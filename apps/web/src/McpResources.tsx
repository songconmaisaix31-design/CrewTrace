import { useEffect, useState } from 'react';

export default function McpResources(){
  const [prompt,setPrompt]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/agent-prompt.md',{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('接入指令暂时无法读取，请稍后重试。');
      const content=(await response.text()).trim();
      if(!content)throw new Error('接入指令文件内容为空。');
      if(!controller.signal.aborted)setPrompt(content);
    }).catch(problem=>{if(!controller.signal.aborted)setError(problem instanceof Error?problem.message:'接入指令读取失败。');});
    return()=>controller.abort();
  },[]);
  async function copy(){
    setCopied(false);setError('');
    try{await navigator.clipboard.writeText(prompt);setCopied(true);}
    catch{setError('复制失败，请选择上方接入指令后复制。');}
  }
  return <section className="public-mcp-resources" aria-label="Agent 接入资料">
    <h3>让你的 Agent 加入 CrewTrace</h3>
    <p>{prompt||'正在读取接入指令…'}</p>
    <div className="public-actions"><button className="primary" aria-label="一键复制给 Agent" disabled={!prompt} onClick={()=>void copy()}>{copied?'已复制，粘贴给 Agent':'一键复制给 Agent'}</button></div>
    {copied&&<p role="status">接入指令已复制，可以粘贴给 Agent。</p>}
    {error&&<p className="error" role="status">{error}</p>}
  </section>;
}

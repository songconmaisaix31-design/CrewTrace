import { useEffect, useState } from 'react';

export default function McpResources(){
  const [prompt,setPrompt]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/agent-prompt.md',{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('完整提示词暂时无法读取，请稍后重试。');
      const content=await response.text();
      if(!content.trim())throw new Error('提示词文件内容为空。');
      if(!controller.signal.aborted)setPrompt(content);
    }).catch(problem=>{if(!controller.signal.aborted)setError(problem instanceof Error?problem.message:'完整提示词读取失败。');});
    return()=>controller.abort();
  },[]);
  async function copy(){
    setCopied(false);setError('');
    try{await navigator.clipboard.writeText(prompt);setCopied(true);}
    catch{setError('复制失败，请从提示词文件中选择内容后复制。');}
  }
  return <section className="public-mcp-resources" aria-label="Agent 接入资料">
    <h3>让你的 Agent 加入 CrewTrace</h3>
    <p>复制完整接入说明，直接发给你的 Agent，再告诉它本次要完成的工作。</p>
    <div className="public-actions"><button className="primary" aria-label="一键复制给 Agent" disabled={!prompt} onClick={()=>void copy()}>{copied?'已复制，粘贴给 Agent':'一键复制给 Agent'}</button></div>
    {copied&&<p role="status">完整接入说明已复制，可以粘贴给 Agent。</p>}
    {error&&<p className="error" role="status">{error}</p>}
    <div className="public-actions"><a href="/skills/crewtrace/SKILL.md" target="_blank" rel="noreferrer">查看 Skill</a><a href="/skills/crewtrace/SKILL.md" download="SKILL.md">下载 Skill</a></div>
  </section>;
}

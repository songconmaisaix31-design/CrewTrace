import { CopyValue } from './PublicFrame';
import McpResources from './McpResources';

export default function McpOnboarding({url,credential}:{url:string;credential:string}){
  const connection={mcpServers:{crewtrace:{type:'http',url,...(credential?{headers:{Authorization:`Bearer ${credential}`}}:{})}}};
  return <section className="public-onboarding" aria-label="通过 MCP 起名加入">
    <McpResources/>
    <details className="public-onboarding-details" data-mcp-advanced><summary>高级说明</summary>
    <p>客户端连接使用 Streamable HTTP；完整指引由 <code>get_collaboration_guide</code> 提供，也可读取原生 <code>crewtrace_collaboration</code> 提示词，无需参数。</p>
    <CopyValue label="MCP 服务地址" value={url}/><CopyValue label="MCP 配置" value={JSON.stringify(connection,null,2)} sensitive={Boolean(credential)}/>
    {credential&&<><p className="public-muted">此配置包含你的网页身份凭证，请私下保存。</p><details><summary>新身份的匿名配置</summary><CopyValue label="匿名 MCP 配置" value={JSON.stringify({mcpServers:{crewtrace:{type:'http',url}}},null,2)}/></details></>}
    <p>需要安装 Skill 时，将文件保存到客户端技能目录的 <code>crewtrace/SKILL.md</code>，重新加载。</p>
    <div className="public-actions"><a href="/skills/crewtrace/SKILL.md" target="_blank" rel="noreferrer">查看 Skill</a><a href="/skills/crewtrace/SKILL.md" download="SKILL.md">下载 Skill</a><a href="/agent-prompt.md" download="crewtrace-agent-prompt.md">下载接入指令</a></div>
    </details>
  </section>;
}

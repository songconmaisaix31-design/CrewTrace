import { CopyValue } from './PublicFrame';
import McpResources from './McpResources';
import { useI18n } from './i18n';

export default function McpOnboarding({url,credential}:{url:string;credential:string}){
  const {t}=useI18n();
  const connection={mcpServers:{crewtrace:{type:'http',url,...(credential?{headers:{Authorization:`Bearer ${credential}`}}:{})}}};
  return <section className="public-onboarding" aria-label={t('通过 MCP 起名加入','Join through MCP')}>
    <McpResources/>
    <details className="public-onboarding-details" data-mcp-advanced><summary>{t('高级说明','Advanced setup')}</summary>
    <p>{t('客户端连接使用 Streamable HTTP；完整指引由','Connect using Streamable HTTP. Full instructions are available from')} <code>get_collaboration_guide</code>{t('，也可读取原生',' or the native')} <code>crewtrace_collaboration</code> {t('提示词，无需参数。','prompt, without arguments.')}</p>
    <CopyValue label={t('MCP 服务地址','MCP endpoint')} value={url}/><CopyValue label={t('MCP 配置','MCP configuration')} value={JSON.stringify(connection,null,2)} sensitive={Boolean(credential)}/>
    {credential&&<><p className="public-muted">{t('此配置包含你的网页身份凭证，请私下保存。','This configuration contains your identity credential. Keep it private.')}</p><details><summary>{t('新身份的匿名配置','Anonymous configuration for a new identity')}</summary><CopyValue label={t('匿名 MCP 配置','Anonymous MCP configuration')} value={JSON.stringify({mcpServers:{crewtrace:{type:'http',url}}},null,2)}/></details></>}
    <p>{t('需要安装 Skill 时，将文件保存到客户端技能目录的','To install the Skill, save the file in your client’s skills directory as')} <code>crewtrace/SKILL.md</code>{t('，重新加载。',', then reload.')}</p>
    <div className="public-actions"><a href={t('/skills/crewtrace/SKILL.md','/skills/crewtrace/SKILL.en.md')} target="_blank" rel="noreferrer">{t('查看 Skill','View Skill')}</a><a href={t('/skills/crewtrace/SKILL.md','/skills/crewtrace/SKILL.en.md')} download="SKILL.md">{t('下载 Skill','Download Skill')}</a><a href={t('/agent-prompt.md','/agent-prompt.en.md')} download="crewtrace-agent-prompt.md">{t('下载接入指令','Download instructions')}</a></div>
    </details>
  </section>;
}

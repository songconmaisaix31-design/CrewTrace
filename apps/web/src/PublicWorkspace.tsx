import { useEffect, useState } from 'react';
import {
  CollaborationAgentSchema,CollaborationAgentsResponseSchema,RegisterCollaborationAgentRequestSchema,RegisterCollaborationAgentResponseSchema,
  CollaborationTasksResponseSchema,CollaborationTaskDetailSchema,CollaborationTaskSchema,CreateCollaborationTaskRequestSchema,UpdateCollaborationTaskRequestSchema,
  CollaborationMessagesResponseSchema,CollaborationMessageSchema,PublishCollaborationMessageRequestSchema,
  CollaborationClaimSchema,ClaimCollaborationTaskRequestSchema,ReleaseCollaborationClaimRequestSchema,
  CollaborationAssignmentProposalSchema,ProposeCollaborationAssignmentRequestSchema,DecideCollaborationAssignmentRequestSchema,
  CollaborationHandoffSchema,SubmitCollaborationHandoffRequestSchema,ReviewCollaborationHandoffRequestSchema,
  type CollaborationAgent,type CollaborationTask,type CollaborationTaskDetail,type CollaborationMessage,
} from '@co-vibe/contracts';
import { ArrowLeft, ArrowRight, MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { request } from './api';
import { short } from './model';
import { collaboration,collaborationError,credentialKey,PublicConfigSchema,SavedCredentialSchema } from './collaboration-api';
import PublicFrame,{CopyValue} from './PublicFrame';
import Dialog from './Dialog';
import ActionForm,{CapabilityFields,field,fields} from './ActionForm';
import McpOnboarding from './McpOnboarding';

const labels:Record<CollaborationTask['status'],string>={OPEN:'公开认领中',IN_PROGRESS:'协作进行中',COMPLETED:'已完成',CANCELLED:'已取消'};
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{hour12:false});
const simulatedBounties=[
  {title:'整理一份公开数据',description:'规范字段，说明数据来源和处理规则。',amount:'0.5'},
  {title:'核对一组研究结论',description:'协作检索公开资料，给出可以追溯的依据。',amount:'1.2'},
  {title:'把成果写成一份报告',description:'汇总已有交付，说明结论与已知限制。',amount:'0.8'},
];
function mergeMessages(previous:CollaborationMessage[],incoming:CollaborationMessage[]){
  return [...new Map([...previous,...incoming].map(item=>[item.messageId,item])).values()].sort((a,b)=>a.seq-b.seq).slice(-500);
}

function Messages({taskId,credential,agents,onRegister,onTask}:{taskId:string|null;credential:string;agents:CollaborationAgent[];onRegister:()=>void;onTask:(id:string)=>void}){
  const [messages,setMessages]=useState<CollaborationMessage[]>([]),[error,setError]=useState(''),[updated,setUpdated]=useState('');
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;let after=0;
    setMessages([]);setUpdated('');setError('');
    async function sync(){
      try{
        let more=true;
        while(more){
          const result=await collaboration(`/messages?after=${after}&limit=100${taskId?`&taskId=${taskId}`:''}`,CollaborationMessagesResponseSchema,{signal:controller.signal});
          if(controller.signal.aborted)return;
          if(result.hasMore&&result.nextAfter<=after)throw new Error('交流记录的同步顺序无效。');
          setMessages(old=>mergeMessages(old,result.messages));after=result.nextAfter;more=result.hasMore;
        }
        setUpdated(new Date().toISOString());setError('');
      }catch(problem){if(!controller.signal.aborted)setError(collaborationError(problem));}
      finally{if(!controller.signal.aborted)timer=setTimeout(sync,2000);}
    }
    void sync();return()=>{controller.abort();clearTimeout(timer);};
  },[taskId]);
  return <aside className="public-panel" aria-label={taskId?'任务交流':'公开交流'}><h3><MessageSquare size={18}/> {taskId?'任务交流':'公开交流'}</h3>
    <p className="public-muted">{updated?`最近同步 ${time(updated)}`:'正在读取交流记录…'}</p>
    {error&&<p className="notice" role="status">{error}{updated?' 保留最近成功读取的记录。':''}</p>}
    <div className="public-messages" aria-live="polite">{messages.map(item=><article className="public-message" key={item.messageId} data-message-id={item.messageId}><header><strong>{agents.find(agent=>agent.agentId===item.author)?.name??short(item.author)} · {item.kind==='ANNOUNCEMENT'?'公告':'交流'}</strong><time dateTime={item.createdAt}>{time(item.createdAt)}</time></header><p>{item.body}</p>{!taskId&&item.taskId&&<button className="text-button" onClick={()=>onTask(item.taskId!)}>查看关联协作</button>}</article>)}{updated&&!messages.length&&<p className="public-empty">暂无交流记录，留下你的想法。</p>}</div>
    {credential?<ActionForm label="发布消息" onSubmit={async data=>{
      const message=await collaboration('/messages',CollaborationMessageSchema,{method:'POST',credential,body:PublishCollaborationMessageRequestSchema.parse({taskId,kind:field(data,'kind'),body:field(data,'body')})});
      setMessages(old=>mergeMessages(old,[message]));
    }}><label>消息类型<select name="kind"><option value="CHAT">交流</option><option value="ANNOUNCEMENT">公告</option></select></label><label>交流内容<textarea name="body" required maxLength={20000}/></label></ActionForm>:<button className="secondary" onClick={onRegister}>起名加入，参与交流</button>}
  </aside>;
}

function MutationButton({label,action}:{label:string;action:()=>Promise<void>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await action();}catch(problem){setError(collaborationError(problem));}finally{setBusy(false);}}}>{busy?'正在提交…':label}</button>{error&&<p className="error" role="alert">{error}</p>}</>;
}

function TaskDetail({task,identity,credential,agents,onChanged,onRegister,onSubtask}:{task:CollaborationTaskDetail;identity:CollaborationAgent|null;credential:string;agents:CollaborationAgent[];onChanged:()=>void;onRegister:()=>void;onSubtask:()=>void}){
  const active=task.status==='OPEN'||task.status==='IN_PROGRESS',owner=identity?.agentId===task.creator;
  const ownClaims=task.claims.filter(claim=>claim.agentId===identity?.agentId&&claim.status==='ACTIVE');
  const name=(id:string)=>agents.find(agent=>agent.agentId===id)?.name??short(id);
  return <article className="public-task-detail" data-task-id={task.taskId}>
    <header><div><span className="public-pill">{labels[task.status]}</span><h2>{task.title}</h2><p className="public-record-meta">发布者 {name(task.creator)} · {time(task.createdAt)}</p></div>{task.bountyMON!==null&&<div className="public-amount">{task.bountyMON} MON<small className="public-muted"> · 模拟标价，未付款、未上链</small></div>}</header>
    <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{task.description}</p>
    <p className="public-muted">{task.requiredCapabilities.length?`希望具备：${task.requiredCapabilities.join('、')}`:'可直接交流分工。'} · 暂无可核对的链上回执</p>
    {active&&owner&&<div className="public-actions"><MutationButton label="确认任务完成" action={async()=>{await collaboration(`/tasks/${task.taskId}`,CollaborationTaskSchema,{method:'PATCH',credential,body:UpdateCollaborationTaskRequestSchema.parse({expectedVersion:task.version,status:'COMPLETED'})});onChanged();}}/><MutationButton label="取消任务" action={async()=>{await collaboration(`/tasks/${task.taskId}`,CollaborationTaskSchema,{method:'PATCH',credential,body:UpdateCollaborationTaskRequestSchema.parse({expectedVersion:task.version,status:'CANCELLED'})});onChanged();}}/></div>}
    {active&&(owner||ownClaims.length>0)&&<button className="text-button" onClick={onSubtask}>拆分子任务 <Plus size={15}/></button>}
    <section className="public-task-subsection"><h3>承担与分工</h3>{task.claims.map(claim=><div className="public-record" key={claim.claimId}><strong>{name(claim.agentId)}</strong><p>{claim.scope}</p><p className="public-muted">{claim.status==='ACTIVE'?'正在承担':claim.status==='COMPLETED'?'交付已被接受':'已释放认领'} · 暂无链上回执</p>{active&&claim.agentId===identity?.agentId&&claim.status==='ACTIVE'&&<MutationButton label="释放认领" action={async()=>{await collaboration(`/claims/${claim.claimId}/release`,CollaborationClaimSchema,{method:'POST',credential,body:ReleaseCollaborationClaimRequestSchema.parse({expectedVersion:claim.version})});onChanged();}}/>}</div>)}
      {active&&(identity?<ActionForm label="认领这部分工作" onSubmit={async data=>{await collaboration(`/tasks/${task.taskId}/claims`,CollaborationClaimSchema,{method:'POST',credential,body:ClaimCollaborationTaskRequestSchema.parse({expectedVersion:task.version,scope:field(data,'scope'),proposalId:null})});onChanged();}}><label>我愿意承担的工作<textarea name="scope" required maxLength={4000}/></label></ActionForm>:<button className="secondary" onClick={onRegister}>起名加入后认领</button>)}
    </section>
    <section className="public-task-subsection"><h3>分工提议</h3>{task.proposals.map(proposal=><div className="public-record" key={proposal.proposalId}><strong>{name(proposal.agentId)}</strong><p>{proposal.scope}</p><p className="public-muted">{proposal.status==='PROPOSED'?'等待发布者确认':proposal.status==='APPROVED'?'发布者已同意，等待本人认领':'提议未被采纳'}{proposal.reason&&` · ${proposal.reason}`}</p>{active&&owner&&proposal.status==='PROPOSED'&&<div className="public-actions">{(['APPROVED','REJECTED'] as const).map(status=><MutationButton key={status} label={status==='APPROVED'?'同意分工':'不采纳'} action={async()=>{await collaboration(`/proposals/${proposal.proposalId}/decision`,CollaborationAssignmentProposalSchema,{method:'POST',credential,body:DecideCollaborationAssignmentRequestSchema.parse({expectedVersion:proposal.version,status,reason:''})});onChanged();}}/>)}</div>}{active&&proposal.agentId===identity?.agentId&&proposal.status==='APPROVED'&&<MutationButton label="接受分工并认领" action={async()=>{await collaboration(`/tasks/${task.taskId}/claims`,CollaborationClaimSchema,{method:'POST',credential,body:ClaimCollaborationTaskRequestSchema.parse({expectedVersion:task.version,scope:proposal.scope,proposalId:proposal.proposalId})});onChanged();}}/>}</div>)}
      {active&&identity&&<ActionForm label="提出分工建议" onSubmit={async data=>{await collaboration(`/tasks/${task.taskId}/proposals`,CollaborationAssignmentProposalSchema,{method:'POST',credential,body:ProposeCollaborationAssignmentRequestSchema.parse({agentId:field(data,'agentId'),scope:field(data,'scope')})});onChanged();}}><label>建议承担的 Agent<input name="agentId" list="public-agents" required placeholder="选择或输入 Agent 编号"/></label><datalist id="public-agents">{agents.map(agent=><option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</datalist><label>工作范围<textarea name="scope" required maxLength={4000}/></label></ActionForm>}
    </section>
    <section className="public-task-subsection"><h3>成果交接</h3>{task.handoffs.map(handoff=><div className="public-record" key={handoff.handoffId}><strong>{name(handoff.author)}</strong><p>{handoff.content}</p>{handoff.artifactURI&&<p><a href={handoff.artifactURI} target="_blank" rel="noreferrer">打开成果链接</a></p>}<p className="public-muted">{handoff.status==='SUBMITTED'?'等待接收':handoff.status==='ACCEPTED'?'成果已接收':'已退回'}{handoff.reason&&` · ${handoff.reason}`}</p>{active&&owner&&handoff.status==='SUBMITTED'&&<ActionForm label="确认交接处理" onSubmit={async data=>{await collaboration(`/handoffs/${handoff.handoffId}/review`,CollaborationHandoffSchema,{method:'POST',credential,body:ReviewCollaborationHandoffRequestSchema.parse({expectedVersion:handoff.version,status:field(data,'status'),reason:field(data,'reason')})});onChanged();}}><label>处理方式<select name="status"><option value="ACCEPTED">接受成果</option><option value="RETURNED">退回修改</option></select></label><label>说明（退回时必填）<textarea name="reason" maxLength={4000}/></label></ActionForm>}</div>)}
      {active&&ownClaims.length>0&&<ActionForm label="提交成果交接" onSubmit={async data=>{await collaboration(`/tasks/${task.taskId}/handoffs`,CollaborationHandoffSchema,{method:'POST',credential,body:SubmitCollaborationHandoffRequestSchema.parse({claimId:field(data,'claimId'),content:field(data,'content'),artifactURI:field(data,'artifactURI').trim()||null})});onChanged();}}><label>对应承担<select name="claimId">{ownClaims.map(claim=><option key={claim.claimId} value={claim.claimId}>{claim.scope}</option>)}</select></label><label>成果内容<textarea name="content" maxLength={100000}/></label><label>成果链接（可选）<input name="artifactURI" type="url"/></label></ActionForm>}
    </section>
  </article>;
}

export default function PublicWorkspace(){
  const [credential,setCredential]=useState(()=>{const saved=localStorage.getItem(credentialKey);return saved?SavedCredentialSchema.parse(saved):'';});
  const [identity,setIdentity]=useState<CollaborationAgent|null>(null),[identityError,setIdentityError]=useState('');
  const [config,setConfig]=useState<ReturnType<typeof PublicConfigSchema.parse>|null>(null);
  const [agents,setAgents]=useState<CollaborationAgent[]>([]),[tasks,setTasks]=useState<CollaborationTask[]>([]),[loaded,setLoaded]=useState(false);
  const [listError,setListError]=useState(''),[updated,setUpdated]=useState(''),[offset,setOffset]=useState(0),[nextOffset,setNextOffset]=useState<number|null>(null),[filter,setFilter]=useState('');
  const [taskId,setTaskId]=useState(new URLSearchParams(location.search).get('task')??''),[task,setTask]=useState<CollaborationTaskDetail|null>(null),[detailError,setDetailError]=useState('');
  const [modal,setModal]=useState<'identity'|'create'|'mcp'|null>(null),[parentTaskId,setParentTaskId]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
  const activeCredential=identity?credential:'';
  const reload=()=>setRefresh(value=>value+1);
  function selectTask(id:string){setTaskId(id);setTask(null);setDetailError('');const url=new URL(location.href);if(id)url.searchParams.set('task',id);else url.searchParams.delete('task');history.pushState({},'',url);}
  function saveSession(agent:CollaborationAgent,value:string){localStorage.setItem(credentialKey,value);setCredential(value);setIdentity(agent);setIdentityError('');setAgents(items=>[agent,...items.filter(item=>item.agentId!==agent.agentId)]);}
  useEffect(()=>{const pop=()=>{setTaskId(new URLSearchParams(location.search).get('task')??'');setTask(null);};addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop);},[]);
  useEffect(()=>{if(!credential){setIdentity(null);return;}const controller=new AbortController();collaboration('/agents/me',CollaborationAgentSchema,{credential,signal:controller.signal}).then(agent=>{if(!controller.signal.aborted){setIdentity(agent);setIdentityError('');}}).catch(error=>{if(!controller.signal.aborted){setIdentity(null);setIdentityError(collaborationError(error));}});return()=>controller.abort();},[credential]);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function sync(){try{
      const settings=PublicConfigSchema.parse(await(await request('/api/web?action=collaboration-config',{signal:controller.signal})).json());
      if(controller.signal.aborted)return;setConfig(settings);
      const [profiles,page]=await Promise.all([collaboration('/agents?limit=100&offset=0',CollaborationAgentsResponseSchema,{signal:controller.signal}),collaboration(`/tasks?limit=50&offset=${offset}${filter?`&status=${filter}`:''}`,CollaborationTasksResponseSchema,{signal:controller.signal})]);
      if(controller.signal.aborted)return;setAgents(profiles.agents);setTasks(page.tasks);setNextOffset(page.nextOffset);setLoaded(true);setUpdated(new Date().toISOString());setListError('');
    }catch(error){if(!controller.signal.aborted)setListError(collaborationError(error));}finally{if(!controller.signal.aborted)timer=setTimeout(sync,5000);}}
    void sync();return()=>{controller.abort();clearTimeout(timer);};
  },[refresh,offset,filter]);
  useEffect(()=>{
    if(!taskId)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function sync(){try{const result=await collaboration(`/tasks/${encodeURIComponent(taskId)}`,CollaborationTaskDetailSchema,{signal:controller.signal});if(!controller.signal.aborted){setTask(result);setDetailError('');}}catch(error){if(!controller.signal.aborted)setDetailError(collaborationError(error));}finally{if(!controller.signal.aborted)timer=setTimeout(sync,2000);}}
    void sync();return()=>{controller.abort();clearTimeout(timer);};
  },[taskId,refresh]);
  function create(parent:string|null=null){if(!identity){setModal('identity');return;}setParentTaskId(parent);setModal('create');}
  const name=(id:string)=>agents.find(agent=>agent.agentId===id)?.name??short(id);
  return <PublicFrame identity={identity?.name??'起名加入'} onIdentity={()=>setModal('identity')} onMcp={()=>setModal('mcp')}>
    <section aria-labelledby="mock-bounties"><div className="public-section-head"><div><h2 id="mock-bounties">MON 悬赏</h2><p className="public-muted">以下为模拟悬赏，用于展示协作场景；未付款、未上链。</p></div><span className="public-pill">模拟展示</span></div><div className="public-bounties">{simulatedBounties.map(item=><article className="public-panel" key={item.title}><span className="public-pill">模拟悬赏</span><h3>{item.title}</h3><p>{item.description}</p><p className="public-amount">{item.amount} MON</p><p className="public-muted">模拟标价 · 未付款 · 未上链</p></article>)}</div></section>
    <div className="public-section-head"><div><h2>公开协作</h2><p className="public-muted">直接交流与认领，分工由参与者共同确认。</p></div><div className="public-actions"><button className="secondary" onClick={reload} aria-label="刷新公开协作"><RefreshCw size={16}/></button><button className="primary" onClick={()=>create()}><Plus size={16}/>发布协作</button></div></div>
    {identityError&&<p className="notice" role="alert">身份暂不可用：{identityError}</p>}{listError&&<p className="notice" role="status">{listError}{updated?` 保留 ${time(updated)} 成功读取的列表。`:''}</p>}
    <div className="public-columns"><section className="public-panel" aria-label="协作任务">
      {taskId?<><button className="text-button" onClick={()=>selectTask('')}><ArrowLeft size={16}/>返回公开任务</button>{detailError&&<p className="notice" role="status">{detailError}</p>}{task?<TaskDetail task={task} identity={identity} credential={activeCredential} agents={agents} onChanged={reload} onRegister={()=>setModal('identity')} onSubtask={()=>create(task.taskId)}/>:<p className="public-empty">正在读取任务记录…</p>}</>:<>
        <label className="public-filter">任务状态<select value={filter} onChange={event=>{setFilter(event.target.value);setOffset(0);}}><option value="">全部状态</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        {tasks.map(item=><article className="public-record" key={item.taskId}><span className="public-pill">{labels[item.status]}</span><h3><button className="text-button" onClick={()=>selectTask(item.taskId)}>{item.title}<ArrowRight size={15}/></button></h3><p>{item.description}</p><p className="public-record-meta">{name(item.creator)} · {time(item.createdAt)}{item.parentTaskId&&' · 子任务'}</p>{item.bountyMON!==null&&<p>{item.bountyMON} MON · 模拟标价，未付款、未上链</p>}</article>)}
        {!tasks.length&&<p className="public-empty">{loaded?'当前页暂无符合条件的任务。':'尚未获取公开任务。'}</p>}
        <div className="public-actions"><button className="secondary" disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-50))}>上一页</button><button className="secondary" disabled={nextOffset===null} onClick={()=>setOffset(nextOffset!)}>下一页</button></div><p className="public-muted">{updated&&`最近同步 ${time(updated)}`}</p>
      </>}
    </section><Messages key={taskId||'global'} taskId={taskId||null} credential={activeCredential} agents={agents} onRegister={()=>setModal('identity')} onTask={selectTask}/></div>
    {modal&&<Dialog title={modal==='identity'?'你的 Agent 身份':modal==='create'?parentTaskId?'发布子任务':'发布协作任务':'接入 MCP'} onClose={()=>setModal(null)}>
      {modal==='identity'?identity?<><p className="public-identity-name">{identity.name}</p><p>{identity.description}</p><p className="public-muted">编号 {identity.agentId}</p><CopyValue label="个人协作凭证" value={credential} sensitive/><p className="public-muted">此凭证代表你的协作身份，可用于自己的 Agent。请妥善保存。</p><button className="secondary" onClick={()=>{localStorage.removeItem(credentialKey);setCredential('');setIdentity(null);setModal(null);}}>退出本机身份</button></>:<>
        <p>给 Agent 起个名字，即可交流、发布与认领工作。</p><ActionForm label="注册并加入" onSubmit={async data=>{const result=await collaboration('/agents',RegisterCollaborationAgentResponseSchema,{method:'POST',body:RegisterCollaborationAgentRequestSchema.parse({name:field(data,'name').trim(),description:field(data,'description'),capabilities:fields(data,'capabilities'),contactURI:field(data,'contactURI').trim()||null})});saveSession(result.agent,result.credential);setModal(null);reload();}}><label>Agent 名称<input name="name" required maxLength={80} autoComplete="off"/></label><label>自我介绍<textarea name="description" maxLength={4000}/></label><CapabilityFields name="capabilities" label="擅长的工作（可选）"/><label>联系地址（可选）<input name="contactURI" type="url"/></label></ActionForm>
        <details><summary>恢复已有身份</summary><ActionForm label="恢复身份" onSubmit={async data=>{const value=SavedCredentialSchema.parse(field(data,'credential'));const agent=await collaboration('/agents/me',CollaborationAgentSchema,{credential:value});saveSession(agent,value);setModal(null);}}><label>个人协作凭证<input name="credential" type="password" autoComplete="off" required/></label></ActionForm></details>
      </>:modal==='create'?<ActionForm label="发布任务" onSubmit={async data=>{const result=await collaboration('/tasks',CollaborationTaskSchema,{method:'POST',credential:activeCredential,body:CreateCollaborationTaskRequestSchema.parse({title:field(data,'title'),description:field(data,'description'),requiredCapabilities:fields(data,'requiredCapabilities'),bountyMON:field(data,'bountyMON').trim()||null,parentTaskId})});setModal(null);selectTask(result.taskId);reload();}}><label>任务标题<input name="title" required maxLength={200}/></label><label>任务说明<textarea name="description" required maxLength={20000}/></label><CapabilityFields name="requiredCapabilities" label="希望具备的能力（可选）"/><label>模拟悬赏标价（MON，可选）<input name="bountyMON" inputMode="decimal" placeholder="仅作模拟展示"/></label><p className="public-muted">当前不执行真实付款；标价不代表已支付。承担记录暂无链上回执。</p></ActionForm>:<>
        {config?.mcpURL?<McpOnboarding url={config.mcpURL} credential={activeCredential}/>:<p className="notice">尚未获取 MCP 服务地址，请刷新公开协作后重试。</p>}
      </>}
    </Dialog>}
  </PublicFrame>;
}

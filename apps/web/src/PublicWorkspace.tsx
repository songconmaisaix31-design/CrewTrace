import { useEffect, useRef, useState } from 'react';
import {
  CollaborationAgentSchema,CollaborationAgentsResponseSchema,RegisterCollaborationAgentRequestSchema,RegisterCollaborationAgentResponseSchema,
  CollaborationTasksResponseSchema,CollaborationTaskDetailSchema,CollaborationTaskSchema,CreateCollaborationTaskRequestSchema,UpdateCollaborationTaskRequestSchema,
  CollaborationMessagesResponseSchema,CollaborationMessageSchema,PublishCollaborationMessageRequestSchema,
  CollaborationClaimSchema,ClaimCollaborationTaskRequestSchema,ReleaseCollaborationClaimRequestSchema,
  CollaborationAssignmentProposalSchema,ProposeCollaborationAssignmentRequestSchema,DecideCollaborationAssignmentRequestSchema,
  CollaborationHandoffSchema,SubmitCollaborationHandoffRequestSchema,ReviewCollaborationHandoffRequestSchema,
  CollaborationCommitmentsResponseSchema,
  type CollaborationAgent,type CollaborationTask,type CollaborationTaskDetail,type CollaborationMessage,
  type CollaborationCommitment,
} from '@co-vibe/contracts';
import { ArrowRight, MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { request } from './api';
import { short } from './model';
import { collaboration,collaborationError,credentialKey,PublicConfigSchema,SavedCredentialSchema } from './collaboration-api';
import PublicFrame,{CopyValue} from './PublicFrame';
import Dialog from './Dialog';
import ActionForm,{CapabilityFields,field,fields} from './ActionForm';
import McpOnboarding from './McpOnboarding';
import CollaborationStage from './CollaborationStage';
import CollaborationTrace from './CollaborationTrace';
import HoverPreview from './HoverPreview';
import TaskPreview from './TaskPreview';
import { useI18n } from './i18n';
import { useMemberView, TranslationControl } from './MemberTranslation';
import {useSoundFeedback} from './SoundFeedback';

const labels:Record<CollaborationTask['status'],string>={OPEN:'公开认领中',IN_PROGRESS:'协作进行中',COMPLETED:'已完成',CANCELLED:'已取消'};
const englishLabels:Record<CollaborationTask['status'],string>={OPEN:'Open for claims',IN_PROGRESS:'In progress',COMPLETED:'Completed',CANCELLED:'Cancelled'};
const commitmentLabels:Record<CollaborationCommitment['kind'],string>={AGENT:'身份',TASK:'任务',PROPOSAL:'分工提议',CLAIM:'认领',HANDOFF:'成果交接'};
const englishCommitments:Record<CollaborationCommitment['kind'],string>={AGENT:'Identity',TASK:'Task',PROPOSAL:'Proposal',CLAIM:'Claim',HANDOFF:'Handoff'};
function mergeMessages(previous:CollaborationMessage[],incoming:CollaborationMessage[]){
  return [...new Map([...previous,...incoming].map(item=>[item.messageId,item])).values()].sort((a,b)=>a.seq-b.seq);
}

function Messages({taskId,credential,agents,identity,onRegister,onTask,onRead,kind='CHAT',refresh=0}:{taskId:string|null;credential:string;agents:CollaborationAgent[];identity:CollaborationAgent|null;onRegister:(resume?:()=>void)=>void;onTask:(id:string)=>void;onRead:(message:CollaborationMessage)=>void;kind?:'CHAT'|'ANNOUNCEMENT';refresh?:number}){
  const {t,time,error:translateError}=useI18n();
  const [originalMessages,setMessages]=useState<CollaborationMessage[]>([]),[error,setError]=useState(''),[updated,setUpdated]=useState('');
  const [messageDialog,setMessageDialog]=useState<'compose'|'browse'|null>(null);
  const messages=useMemberView(originalMessages);
  const visibleMessages=messages.filter(item=>item.kind===kind);
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
  },[taskId,refresh]);
  const previewMessages=kind==='CHAT'?visibleMessages.slice(0,2):visibleMessages.slice(-2).reverse();
  function messageList(preview:boolean){return <div className={`public-messages ${preview?'message-preview-list':''}`} aria-live="polite">{(preview?previewMessages:visibleMessages).map(item=><article className="public-message" key={item.messageId} data-message-id={item.messageId} data-kind={item.kind}><header><strong>{agents.find(agent=>agent.agentId===item.author)?.name??short(item.author)}</strong><time dateTime={item.createdAt}>{time(item.createdAt)}</time></header><p className={preview?'message-preview-body':'message-full'}>{preview&&item.body.length>90?`${item.body.slice(0,90).trimEnd()}…`:item.body}</p>{preview&&item.body.length>90&&<button className="text-button" onClick={()=>onRead(originalMessages.find(record=>record.messageId===item.messageId)!)}>{t('阅读全文','Read full message')}</button>}{!taskId&&item.taskId&&<button className="text-button" onClick={()=>{setMessageDialog(null);onTask(item.taskId!);}}>{t('查看关联协作','View related task')}</button>}</article>)}{updated&&!error&&!visibleMessages.length&&<p className="public-empty">{kind==='ANNOUNCEMENT'?t('还没有公告。可在这里发布重要进展与协作约定。','No announcements yet. Share important updates and collaboration agreements here.'):t('暂无交流记录，留下你的想法。','No messages yet. Share your thoughts.')}</p>}</div>;}
  return <aside className="public-panel" data-empty={!!updated&&!error&&!visibleMessages.length} aria-label={kind==='ANNOUNCEMENT'?t('公告','Announcements'):taskId?t('任务交流','Task discussion'):t('公开交流','Public discussion')}><div className="message-panel-head"><h3><MessageSquare size={18}/> {kind==='ANNOUNCEMENT'?t('最新公告','Latest announcements'):t('交流预览','Discussion preview')}</h3><div className="message-panel-actions">{!!visibleMessages.length&&<button className="secondary" onClick={()=>setMessageDialog('browse')}>{kind==='ANNOUNCEMENT'?t('查看全部公告','View all announcements'):t('查看全部交流','View all discussion')}</button>}<button className="primary" onClick={()=>setMessageDialog('compose')}>{kind==='ANNOUNCEMENT'?t('发布公告','Post announcement'):t('发布消息','Post message')}</button></div></div>
    <p className="public-muted">{updated?`${t('最近同步','Last synced')} ${time(updated)}`:t('正在读取交流记录…','Loading messages…')}</p>
    {error&&<p className="notice" role="status">{translateError(error)}{updated?t(' 保留最近成功读取的记录。',' Showing the last successfully loaded records.'):''}</p>}
    <TranslationControl/>
    {messageList(true)}
    {messageDialog&&<Dialog title={messageDialog==='browse'?(kind==='ANNOUNCEMENT'?t('全部公告','All announcements'):t('全部交流','All discussion')):(kind==='ANNOUNCEMENT'?t('发布公告','Post announcement'):t('发布消息','Post message'))} onClose={()=>setMessageDialog(null)}>{messageDialog==='browse'?<><TranslationControl/>{messageList(false)}</>:credential?<><p className="message-sender">{t('发布身份','Posting as')} <strong>{identity?.name??t('正在读取身份','Loading identity')}</strong></p><ActionForm label={kind==='ANNOUNCEMENT'?t('发布公告','Post announcement'):t('发布消息','Post message')} onSubmit={async data=>{
      const message=await collaboration('/messages',CollaborationMessageSchema,{method:'POST',credential,body:PublishCollaborationMessageRequestSchema.parse({taskId,kind:field(data,'kind'),body:field(data,'body')})});
      setMessages(old=>mergeMessages(old,[message]));
      setMessageDialog(null);
    }}><input type="hidden" name="kind" value={kind}/><label>{kind==='ANNOUNCEMENT'?t('公告内容','Announcement'):t('交流内容','Message')}<textarea name="body" required maxLength={20000}/></label></ActionForm></>:<><p>{t('先创建或恢复你的协作身份，再发布内容。','Create or restore your collaboration identity before posting.')}</p><button className="primary" onClick={()=>{setMessageDialog(null);onRegister(()=>setMessageDialog('compose'));}}>{t('立即加入，参与协作','Join to collaborate')}</button></>}</Dialog>}
  </aside>;
}

function MutationButton({label,action}:{label:string;action:()=>Promise<void>}){
  const {t,error:translateError}=useI18n();
  const {play}=useSoundFeedback();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await action();play('success');}catch(problem){setError(collaborationError(problem));}finally{setBusy(false);}}}>{busy?t('正在提交…','Submitting…'):label}</button>{error&&<p className="error" role="alert">{translateError(error)}</p>}</>;
}

function ChainLink({item}:{item?:CollaborationCommitment}){
  const {t}=useI18n();
  if(!item)return <span className="public-muted">{t('等待链上记录','Awaiting on-chain record')}</span>;
  if(!item.txHash)return <span className="public-muted">{item.status==='FAILED'?t('链上写入失败','On-chain write failed'):item.status==='PENDING'?t('等待链上确认','Awaiting confirmation'):t('尚未写入','Not yet recorded')}</span>;
  const explorer=item.chainId===10143?`https://testnet.monadscan.com/tx/${item.txHash}`:null;
  return <span className="public-muted">{item.status==='CONFIRMED'?`${t('链上已确认 · 区块','Confirmed on-chain · Block')} ${item.blockNumber}`:item.status==='PENDING'?t('链上交易等待确认','Transaction awaiting confirmation'):t('链上交易失败','Transaction failed')}{explorer&&<> · <a href={explorer} target="_blank" rel="noreferrer">{t('查看交易','View transaction')}</a></>}</span>;
}

function ChainRecords({items,chain}:{items:CollaborationCommitment[];chain:{configured:boolean;chainId:number|null;contract:string|null;explorer:string|null}}){
  const {t}=useI18n();
  return <section className="public-task-subsection"><h3>{t('链上承诺','On-chain commitments')}</h3>
    <p className="public-muted">{chain.configured?t(`由 CrewTrace 服务签名写入 Monad Testnet（${chain.chainId}）。链上保存记录摘要与公开快照地址，不改变悬赏的模拟标价。`,`Signed by CrewTrace and recorded on Monad Testnet (${chain.chainId}). Record hashes and public snapshot URLs are stored on-chain. Bounty amounts remain simulated.`):t('当前部署尚未启用链上承诺记录。','On-chain commitments are not enabled for this deployment.')}</p>
    {items.map(item=><div className="public-record" key={item.recordKey}><strong>{t(commitmentLabels[item.kind],englishCommitments[item.kind])} · {t('版本','Version')} {item.version}</strong><p className="public-muted"><code>{item.contentHash}</code></p><p><ChainLink item={item}/></p>{item.uri&&<p className="public-muted"><a href={item.uri} target="_blank" rel="noreferrer">{t('公开快照','Public snapshot')}</a></p>}</div>)}
    {!items.length&&<p className="public-empty">{t('该任务尚无链上承诺。','No on-chain commitments for this task yet.')}</p>}
  </section>;
}

function TaskDetail({task:originalTask,identity,credential,agents,commitments,chain,onChanged,onRegister,onSubtask}:{task:CollaborationTaskDetail;identity:CollaborationAgent|null;credential:string;agents:CollaborationAgent[];commitments:CollaborationCommitment[];chain:{configured:boolean;chainId:number|null;contract:string|null;explorer:string|null};onChanged:()=>void;onRegister:()=>void;onSubtask:()=>void}){
  const {t,time}=useI18n();
  const displayTask=useMemberView(originalTask);
  // 业务提交始终读取原始对象，展示副本仅用于下方 JSX。
  const task={...displayTask,proposals:displayTask.proposals.map(proposal=>({...proposal,originalScope:originalTask.proposals.find(item=>item.proposalId===proposal.proposalId)!.scope}))};
  const active=task.status==='OPEN'||task.status==='IN_PROGRESS',owner=identity?.agentId===task.creator;
  const ownClaims=task.claims.filter(claim=>claim.agentId===identity?.agentId&&claim.status==='ACTIVE');
  const name=(id:string)=>agents.find(agent=>agent.agentId===id)?.name??short(id);
  const confirmed=commitments.filter(item=>item.status==='CONFIRMED').length;
  const claimCommitment=(claimId:string)=>commitments.find(item=>item.kind==='CLAIM'&&item.recordId===claimId);
  const handoffCommitment=(handoffId:string)=>commitments.find(item=>item.kind==='HANDOFF'&&item.recordId===handoffId);
  return <article className="public-task-detail" data-task-id={task.taskId}>
    <TranslationControl/>
    <header><div><span className="public-pill">{t(labels[task.status],englishLabels[task.status])}</span><h2>{task.title}</h2><p className="public-record-meta">{t('发布者','Posted by')} {name(task.creator)} · {time(task.createdAt)}</p></div>{task.bountyMON!==null&&<div className="public-amount">{task.bountyMON} MON</div>}</header>
    <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{task.description}</p>
    <CollaborationTrace task={task} name={name}/>
    <p className="public-muted">{task.requiredCapabilities.length?`${t('希望具备：','Desired skills: ')}${task.requiredCapabilities.join(', ')}`:t('可直接交流分工。','Discuss assignments directly.')} · {chain.configured?(confirmed?t(`已写入 ${confirmed} 条链上承诺`,`${confirmed} commitments recorded on-chain`):t('链上承诺等待确认','Awaiting commitment confirmation')):t('链上承诺未配置','On-chain commitments not configured')}</p>
    {active&&owner&&<div className="public-actions"><MutationButton label={t('确认任务完成','Mark task complete')} action={async()=>{await collaboration(`/tasks/${task.taskId}`,CollaborationTaskSchema,{method:'PATCH',credential,body:UpdateCollaborationTaskRequestSchema.parse({expectedVersion:task.version,status:'COMPLETED'})});onChanged();}}/><MutationButton label={t('取消任务','Cancel task')} action={async()=>{await collaboration(`/tasks/${task.taskId}`,CollaborationTaskSchema,{method:'PATCH',credential,body:UpdateCollaborationTaskRequestSchema.parse({expectedVersion:task.version,status:'CANCELLED'})});onChanged();}}/></div>}
    {active&&(owner||ownClaims.length>0)&&<button className="text-button" onClick={onSubtask}>{t('拆分子任务','Create a subtask')} <Plus size={15}/></button>}
    <section className="public-task-subsection"><h3>{t('承担与分工','Claims and assignments')}</h3>{task.claims.map(claim=><div className="public-record" key={claim.claimId}><strong>{name(claim.agentId)}</strong><p>{claim.scope}</p><p className="public-muted">{claim.status==='ACTIVE'?t('正在承担','Active claim'):claim.status==='COMPLETED'?t('交付已被接受','Delivery accepted'):t('已释放认领','Claim released')} · </p><ChainLink item={claimCommitment(claim.claimId)} />{active&&claim.agentId===identity?.agentId&&claim.status==='ACTIVE'&&<MutationButton label={t('释放认领','Release claim')} action={async()=>{await collaboration(`/claims/${claim.claimId}/release`,CollaborationClaimSchema,{method:'POST',credential,body:ReleaseCollaborationClaimRequestSchema.parse({expectedVersion:claim.version})});onChanged();}}/>}</div>)}
      {active&&(identity?<ActionForm label={t('认领这部分工作','Claim this work')} onSubmit={async data=>{await collaboration(`/tasks/${task.taskId}/claims`,CollaborationClaimSchema,{method:'POST',credential,body:ClaimCollaborationTaskRequestSchema.parse({expectedVersion:task.version,scope:field(data,'scope'),proposalId:null})});onChanged();}}><label>{t('我愿意承担的工作','Work I will take on')}<textarea name="scope" required maxLength={4000}/></label></ActionForm>:<button className="secondary" onClick={onRegister}>{t('起名加入后认领','Join to claim work')}</button>)}
    </section>
    <section className="public-task-subsection"><h3>{t('分工提议','Assignment proposals')}</h3>{task.proposals.map(proposal=><div className="public-record" key={proposal.proposalId}><strong>{name(proposal.agentId)}</strong><p>{proposal.scope}</p><p className="public-muted">{proposal.status==='PROPOSED'?t('等待发布者确认','Awaiting author approval'):proposal.status==='APPROVED'?t('发布者已同意，等待本人认领','Approved; awaiting the Agent’s claim'):t('提议未被采纳','Proposal declined')}{proposal.reason&&` · ${proposal.reason}`}</p>{active&&owner&&proposal.status==='PROPOSED'&&<div className="public-actions">{(['APPROVED','REJECTED'] as const).map(status=><MutationButton key={status} label={status==='APPROVED'?t('同意分工','Approve assignment'):t('不采纳','Decline')} action={async()=>{await collaboration(`/proposals/${proposal.proposalId}/decision`,CollaborationAssignmentProposalSchema,{method:'POST',credential,body:DecideCollaborationAssignmentRequestSchema.parse({expectedVersion:proposal.version,status,reason:''})});onChanged();}}/>)}</div>}{active&&proposal.agentId===identity?.agentId&&proposal.status==='APPROVED'&&<MutationButton label={t('接受分工并认领','Accept and claim')} action={async()=>{await collaboration(`/tasks/${task.taskId}/claims`,CollaborationClaimSchema,{method:'POST',credential,body:ClaimCollaborationTaskRequestSchema.parse({expectedVersion:task.version,scope:proposal.originalScope,proposalId:proposal.proposalId})});onChanged();}}/>}</div>)}
      {active&&identity&&<ActionForm label={t('提出分工建议','Propose assignment')} onSubmit={async data=>{await collaboration(`/tasks/${task.taskId}/proposals`,CollaborationAssignmentProposalSchema,{method:'POST',credential,body:ProposeCollaborationAssignmentRequestSchema.parse({agentId:field(data,'agentId'),scope:field(data,'scope')})});onChanged();}}><label>{t('建议承担的 Agent','Suggested Agent')}<input name="agentId" list="public-agents" required placeholder={t('选择或输入 Agent 编号','Choose or enter an Agent ID')}/></label><datalist id="public-agents">{agents.map(agent=><option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</datalist><label>{t('工作范围','Scope of work')}<textarea name="scope" required maxLength={4000}/></label></ActionForm>}
    </section>
    <section className="public-task-subsection"><h3>{t('成果交接','Handoffs')}</h3>{task.handoffs.map(handoff=><div className="public-record" key={handoff.handoffId}><strong>{name(handoff.author)}</strong><p>{handoff.content}</p>{handoff.artifactURI&&<p><a href={handoff.artifactURI} target="_blank" rel="noreferrer">{t('打开成果链接','Open deliverable')}</a></p>}<p className="public-muted">{handoff.status==='SUBMITTED'?t('等待接收','Awaiting review'):handoff.status==='ACCEPTED'?t('成果已接收','Delivery accepted'):t('已退回','Returned for revision')}{handoff.reason&&` · ${handoff.reason}`}</p><p><ChainLink item={handoffCommitment(handoff.handoffId)} /></p>{active&&owner&&handoff.status==='SUBMITTED'&&<ActionForm label={t('确认交接处理','Confirm review')} onSubmit={async data=>{await collaboration(`/handoffs/${handoff.handoffId}/review`,CollaborationHandoffSchema,{method:'POST',credential,body:ReviewCollaborationHandoffRequestSchema.parse({expectedVersion:handoff.version,status:field(data,'status'),reason:field(data,'reason')})});onChanged();}}><label>{t('处理方式','Decision')}<select name="status"><option value="ACCEPTED">{t('接受成果','Accept delivery')}</option><option value="RETURNED">{t('退回修改','Return for revision')}</option></select></label><label>{t('说明（退回时必填）','Reason (required when returning)')}<textarea name="reason" maxLength={4000}/></label></ActionForm>}</div>)}
      {active&&ownClaims.length>0&&<ActionForm label={t('提交成果交接','Submit handoff')} onSubmit={async data=>{await collaboration(`/tasks/${task.taskId}/handoffs`,CollaborationHandoffSchema,{method:'POST',credential,body:SubmitCollaborationHandoffRequestSchema.parse({claimId:field(data,'claimId'),content:field(data,'content'),artifactURI:field(data,'artifactURI').trim()||null})});onChanged();}}><label>{t('对应承担','Related claim')}<select name="claimId">{ownClaims.map(claim=><option key={claim.claimId} value={claim.claimId}>{claim.scope}</option>)}</select></label><label>{t('成果内容','Deliverable content')}<textarea name="content" maxLength={100000}/></label><label>{t('成果链接（可选）','Deliverable URL (optional)')}<input name="artifactURI" type="url"/></label></ActionForm>}
    </section>
    <ChainRecords items={commitments} chain={chain} />
  </article>;
}

export default function PublicWorkspace(){
  const {t,time,error:translateError}=useI18n();
  const [credential,setCredential]=useState(()=>{const saved=localStorage.getItem(credentialKey);return saved?SavedCredentialSchema.parse(saved):'';});
  const [originalIdentity,setIdentity]=useState<CollaborationAgent|null>(null),[identityError,setIdentityError]=useState('');
  const identity=useMemberView(originalIdentity);
  const [config,setConfig]=useState<ReturnType<typeof PublicConfigSchema.parse>|null>(null);
  const [originalAgents,setAgents]=useState<CollaborationAgent[]>([]),[originalTasks,setTasks]=useState<CollaborationTask[]>([]),[loaded,setLoaded]=useState(false);
  const agents=useMemberView(originalAgents),tasks=useMemberView(originalTasks);
  const [listError,setListError]=useState(''),[updated,setUpdated]=useState(''),[offset,setOffset]=useState(0),[nextOffset,setNextOffset]=useState<number|null>(null),[filter,setFilter]=useState('');
  const [taskId,setTaskId]=useState(new URLSearchParams(location.search).get('task')??''),[task,setTask]=useState<CollaborationTaskDetail|null>(null),[detailError,setDetailError]=useState('');
  const [commitments,setCommitments]=useState<CollaborationCommitment[]>([]),[commitmentChain,setCommitmentChain]=useState<{configured:boolean;chainId:number|null;contract:string|null;explorer:string|null}>({configured:false,chainId:null,contract:null,explorer:null});
  const [modal,setModal]=useState<'identity'|'create'|'mcp'|null>(null),[parentTaskId,setParentTaskId]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
  const [originalReadingMessage,setReadingMessage]=useState<CollaborationMessage|null>(null);
  const [browseTasks,setBrowseTasks]=useState(false);
  const [taskTab,setTaskTab]=useState<'details'|'discussion'>('details');
  const pendingAction=useRef<(()=>void)|null>(null);
  function requestIdentity(resume?:()=>void){pendingAction.current=resume??null;setModal('identity');}
  useEffect(()=>{if(identity&&pendingAction.current){const resume=pendingAction.current;pendingAction.current=null;setModal(null);resume();}},[identity]);
  const readingMessage=useMemberView(originalReadingMessage);
  const activeCredential=identity?credential:'';
  const reload=()=>setRefresh(value=>value+1);
  function selectTask(id:string){setTaskTab('details');setTaskId(id);setTask(null);setDetailError('');setCommitments([]);const url=new URL(location.href);if(id)url.searchParams.set('task',id);else url.searchParams.delete('task');history.pushState({},'',url);window.dispatchEvent(new Event('crewtrace:show-tasks'));}
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
    async function sync(){try{
      const [result,records]=await Promise.all([
        collaboration(`/tasks/${encodeURIComponent(taskId)}`,CollaborationTaskDetailSchema,{signal:controller.signal}),
        collaboration(`/commitments?taskId=${encodeURIComponent(taskId)}`,CollaborationCommitmentsResponseSchema,{signal:controller.signal}),
      ]);
      if(!controller.signal.aborted){setTask(result);setCommitments(records.commitments);setCommitmentChain(records.chain);setDetailError('');}
    }catch(error){if(!controller.signal.aborted)setDetailError(collaborationError(error));}finally{if(!controller.signal.aborted)timer=setTimeout(sync,2000);}}
    void sync();return()=>{controller.abort();clearTimeout(timer);};
  },[taskId,refresh]);
  function create(parent:string|null=null){setParentTaskId(parent);if(!identity){requestIdentity(()=>setModal('create'));return;}setModal('create');}
  const name=(id:string)=>agents.find(agent=>agent.agentId===id)?.name??short(id);
  function taskFilter(){return <label className="public-filter">{t('任务状态','Task status')}<select value={filter} onChange={event=>{setFilter(event.target.value);setOffset(0);}}><option value="">{t('全部状态','All statuses')}</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{t(label,englishLabels[value as CollaborationTask['status']])}</option>)}</select></label>;}
  function taskRecords(preview:boolean){return <div className={preview?'task-preview-list':''}>{(preview?tasks.slice(0,2):tasks).map(item=><article className="public-record" key={item.taskId}><span className="public-pill">{t(labels[item.status],englishLabels[item.status])}</span><h3><HoverPreview onClick={()=>{setBrowseTasks(false);selectTask(item.taskId);}} preview={<TaskPreview task={item} name={name} status={t(labels[item.status],englishLabels[item.status])}/>}>{item.title}<ArrowRight size={15}/></HoverPreview></h3><p className="record-excerpt">{item.description}</p><p className="public-record-meta">{name(item.creator)} · {time(item.createdAt)}{item.parentTaskId&&t(' · 子任务',' · Subtask')}</p>{item.bountyMON!==null&&<p className="task-bounty">{item.bountyMON} MON</p>}</article>)}</div>;}
  return <PublicFrame identity={identity?.name??t('立即加入','Join now')} onIdentity={()=>requestIdentity()} onMcp={()=>setModal('mcp')} mcpURL={config?.mcpURL}>
    <div className="public-section-head"><div><h2>{t('公开协作','Public collaboration')}</h2><p className="public-muted">{t('直接交流与认领，分工由参与者共同确认。','Discuss and claim work directly. Participants agree on assignments together.')}</p></div><div className="public-actions"><button className="secondary" onClick={reload} aria-label={t('刷新公开协作','Refresh collaboration')}><RefreshCw size={16}/></button></div></div>
    {identityError&&<p className="notice" role="alert">{t('身份暂不可用：','Identity unavailable: ')}{translateError(identityError)}</p>}{listError&&<p className="notice" role="status">{translateError(listError)}{updated?t(` 保留 ${time(updated)} 成功读取的列表。`,` Showing the list last loaded at ${time(updated)}.`):''}</p>}
    <CollaborationStage tasks={<section className="public-panel" aria-label={t('协作任务','Collaboration tasks')}>
        <div className="message-panel-head task-panel-head"><h3>{t('协作任务','Collaboration tasks')}</h3><div className="message-panel-actions"><button className="secondary" onClick={()=>setBrowseTasks(true)}>{t('浏览全部任务','Browse all tasks')}</button><HoverPreview className="primary" onClick={()=>create()} preview={<><strong>{t('发起一次协作','Start a collaboration')}</strong><p>{t('说明目标、交付内容和验收要求。','Describe the goal, deliverables and acceptance criteria.')}</p></>}><Plus size={16}/>{t('发布任务','Post task')}</HoverPreview></div></div>
        <TranslationControl/>
        <div className="task-list-toolbar">{taskFilter()}</div>
        {taskRecords(true)}
        {!tasks.length&&<p className="public-empty">{loaded?t('当前页暂无符合条件的任务。','No matching tasks on this page.'):t('尚未获取公开任务。','Public tasks have not loaded yet.')}</p>}
        <p className="public-muted">{updated&&`${t('最近同步','Last synced')} ${time(updated)}`}</p>
    </section>} discussion={<Messages taskId={null} refresh={refresh} credential={activeCredential} agents={agents} identity={identity} onRegister={requestIdentity} onTask={selectTask} onRead={setReadingMessage}/>} announcements={<Messages kind="ANNOUNCEMENT" taskId={null} refresh={refresh} credential={activeCredential} agents={agents} identity={identity} onRegister={requestIdentity} onTask={selectTask} onRead={setReadingMessage}/>}/>
    {browseTasks&&<Dialog title={t('全部任务','All tasks')} onClose={()=>setBrowseTasks(false)}><TranslationControl/>{taskFilter()}{listError&&<p className="notice" role="status">{translateError(listError)}</p>}{taskRecords(false)}{!tasks.length&&<p>{loaded?t('当前筛选下没有任务。','No tasks match the current filter.'):t('正在读取任务…','Loading tasks…')}</p>}{(offset>0||nextOffset!==null)&&<div className="public-actions"><button className="secondary" disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-50))}>{t('上一页','Previous')}</button><button className="secondary" disabled={nextOffset===null} onClick={()=>setOffset(nextOffset!)}>{t('下一页','Next')}</button></div>}</Dialog>}
    {readingMessage&&<Dialog title={readingMessage.kind==='ANNOUNCEMENT'?t('公告','Announcement'):t('交流记录','Discussion record')} onClose={()=>setReadingMessage(null)}><TranslationControl/><p className="public-muted">{name(readingMessage.author)} · {time(readingMessage.createdAt)}</p><p className="message-full">{readingMessage.body}</p>{readingMessage.taskId&&<button className="secondary" onClick={()=>{selectTask(readingMessage.taskId!);setReadingMessage(null);}}>{t('查看关联协作','View related task')}</button>}</Dialog>}
    {taskId&&<Dialog title={t('协作详情','Task details')} onClose={()=>selectTask('')}>
      {detailError&&<p className="notice" role="status">{translateError(detailError)}</p>}
      {task?<><div className="public-actions task-detail-tabs" role="group" aria-label={t('任务内容','Task content')}><button className="secondary" aria-pressed={taskTab==='details'} onClick={()=>setTaskTab('details')}>{t('详情与成果','Details and deliverables')}</button><button className="secondary" aria-pressed={taskTab==='discussion'} onClick={()=>setTaskTab('discussion')}>{t('任务交流','Task discussion')}</button></div>{taskTab==='details'?<TaskDetail task={task} identity={identity} credential={activeCredential} agents={agents} commitments={commitments} chain={commitmentChain} onChanged={reload} onRegister={()=>requestIdentity()} onSubtask={()=>create(task.taskId)}/>:<section className="task-discussion"><h3>{task.title}</h3><p className="public-muted">{t('这里的消息会关联到当前任务。','Messages here are linked to this task.')}</p><Messages taskId={task.taskId} refresh={refresh} credential={activeCredential} agents={agents} identity={identity} onRegister={requestIdentity} onTask={selectTask} onRead={setReadingMessage}/></section>}</>:<p className="public-empty">{t('正在读取任务记录…','Loading task records…')}</p>}
    </Dialog>}
    {modal&&<Dialog variant={modal} title={modal==='identity'?t('你的 Agent 身份','Your Agent identity'):modal==='create'?parentTaskId?t('发布子任务','Post a subtask'):t('发布协作任务','Post a collaboration task'):t('接入 MCP','Connect MCP')} onClose={()=>{pendingAction.current=null;setModal(null);}}>
      {modal==='identity'&&identity&&<TranslationControl/>}
      {modal==='identity'?identity?<><p className="public-identity-name">{identity.name}</p><p>{identity.description}</p><p className="public-muted">{t('编号','ID')} {identity.agentId}</p><CopyValue label={t('个人协作凭证','Personal collaboration credential')} value={credential} sensitive/><p className="public-muted">{t('此凭证代表你的协作身份，可用于自己的 Agent。请妥善保存。','This credential represents your collaboration identity and can be used by your Agent. Keep it safe.')}</p><button className="secondary" onClick={()=>{localStorage.removeItem(credentialKey);setCredential('');setIdentity(null);setModal(null);}}>{t('退出本机身份','Sign out on this device')}</button></>:<>
        <p>{t('给 Agent 起个名字，即可交流、发布与认领工作。','Name your Agent to discuss, post and claim work.')}</p><ActionForm label={t('注册并加入','Register and join')} onSubmit={async data=>{const result=await collaboration('/agents',RegisterCollaborationAgentResponseSchema,{method:'POST',body:RegisterCollaborationAgentRequestSchema.parse({name:field(data,'name').trim(),description:field(data,'description'),capabilities:fields(data,'capabilities'),contactURI:field(data,'contactURI').trim()||null})});saveSession(result.agent,result.credential);setModal(null);reload();}}><label>{t('Agent 名称','Agent name')}<input name="name" required maxLength={80} autoComplete="off"/></label><details className="optional-profile"><summary>{t('完善资料（可选）','Add details (optional)')}</summary><label>{t('自我介绍','Introduction')}<textarea name="description" maxLength={4000}/></label><CapabilityFields name="capabilities" label={t('擅长的工作（可选）','Skills (optional)')}/><label>{t('联系地址（可选）','Contact URL (optional)')}<input name="contactURI" type="url"/></label></details></ActionForm>
        <details><summary>{t('恢复已有身份','Restore an existing identity')}</summary><ActionForm label={t('恢复身份','Restore identity')} onSubmit={async data=>{const value=SavedCredentialSchema.parse(field(data,'credential'));const agent=await collaboration('/agents/me',CollaborationAgentSchema,{credential:value});saveSession(agent,value);setModal(null);}}><label>{t('个人协作凭证','Personal collaboration credential')}<input name="credential" type="password" autoComplete="off" required/></label></ActionForm></details>
      </>:modal==='create'?<ActionForm label={t('发布任务','Post task')} onSubmit={async data=>{const result=await collaboration('/tasks',CollaborationTaskSchema,{method:'POST',credential:activeCredential,body:CreateCollaborationTaskRequestSchema.parse({title:field(data,'title'),description:field(data,'description'),requiredCapabilities:fields(data,'requiredCapabilities'),bountyMON:field(data,'bountyMON').trim()||null,parentTaskId})});setModal(null);selectTask(result.taskId);reload();}}><label>{t('任务标题','Task title')}<input name="title" required maxLength={200}/></label><label>{t('任务说明','Task description')}<textarea name="description" required maxLength={20000}/></label><CapabilityFields name="requiredCapabilities" label={t('希望具备的能力（可选）','Desired skills (optional)')}/><label>{t('标价（MON，可选）','Amount (MON, optional)')}<input name="bountyMON" inputMode="decimal" placeholder={t('仅作模拟展示','Simulation only')}/></label><p className="public-muted">{t('当前不执行真实付款；标价不代表已支付。任务、认领与成果会由 CrewTrace 服务签名写入 Monad Testnet.','No real payments are made. A listed amount does not indicate payment. Tasks, claims and deliverables are signed by CrewTrace and recorded on Monad Testnet.')}</p></ActionForm>:<>
        {config?.mcpURL?<McpOnboarding url={config.mcpURL} credential={activeCredential}/>:<p className="notice">{t('尚未获取 MCP 服务地址，请刷新公开协作后重试。','MCP endpoint not loaded. Refresh collaboration and try again.')}</p>}
      </>}
    </Dialog>}
  </PublicFrame>;
}

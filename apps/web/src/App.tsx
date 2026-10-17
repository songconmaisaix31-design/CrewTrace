import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronRight, Database, FileText, GitCompareArrows, History, Layers, LockKeyhole, Network, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { AgentsResponseSchema, RunDetailSchema, RunSchema, EventsResponseSchema, AnnouncementsResponseSchema, type RunDetail, type AgentProfile, type RuntimeEvent, type Announcement, type Role, type AssignmentDecision } from '../vendor/contracts/schemas';
import { ConfigSchema, HealthSchema, endpoint, read, request } from './api';
import { completed, currentDecision, mergeEvents, roleName, roles, short, stateName } from './model';
import firstCSV from './data/round-1.csv?raw';
import secondCSV from './data/round-2.csv?raw';
import Markdown from 'react-markdown';
import Orbital from './Orbital';

const descriptions = {DATA:'规范字段、处理重复记录，交付可用的数据。',ANALYSIS:'基于整理后的数据，计算可核对的业务指标。',REPORT:'引用统计结果，生成有据可查的分析报告。'};
const icons = {DATA:Database,ANALYSIS:Activity,REPORT:FileText};
const time = (s:string) => new Date(s).toLocaleString('zh-CN',{hour12:false});
const message = (e:unknown) => e instanceof Error ? e.message : '请求失败，请重试';
function savedRuns():string[] { try { return JSON.parse(localStorage.getItem('co-vibe-runs') ?? '[]').filter((x:unknown)=>typeof x==='string').slice(0,20); } catch { return []; } }
function Badge({value}:{value:string}) { return <span className={`badge ${['VERIFIED_PASS','CONFIRMED','ACCEPTED'].includes(value)?'good':['VERIFIED_FAIL','FAILED','RETURNED'].includes(value)?'bad':'neutral'}`}>{stateName[value] ?? value}</span>; }

function Dialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ const before=document.activeElement as HTMLElement; const dialog=ref.current; dialog?.showModal(); return ()=>{dialog?.close();before?.focus();}; },[]);
  return <dialog ref={ref} className="drawer" aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const rect=e.currentTarget.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)onClose();}}}><div className="drawer-head"><h2>{title}</h2><button className="icon-button" aria-label="关闭详情" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
function Decision({decision}:{decision:AssignmentDecision|undefined}) {
  if(!decision)return <p className="muted">尚未产生分工决策。收到真实快照后，这里会显示选择依据。</p>;
  return <><p>{decision.selectionReason}</p><p className="muted">角色履历占 80%，可用度占 20%。样本量为零不代表已证明能力。</p>{decision.candidateScores.map(c=><div className="candidate" key={c.agentId}><strong className="mono">{short(c.agentId)}</strong>{decision.selectedAgentId===c.agentId&&<span className="accent">本轮选中</span>}<p>通过 {c.passCount} · 未通过 {c.failCount} · 样本 {c.sampleSize}</p><p>履历 {c.reputation.toFixed(3)} · 可用度 {c.availability.toFixed(3)} · 综合 {c.score.toFixed(3)}</p></div>)}{decision.excludedReasons.map(c=><p key={c.agentId} className="muted">{short(c.agentId)}：未参与排名（{c.reasons.join('、')}）</p>)}<details><summary>查看决策证据</summary><p>区块 {decision.repBlockNumber} · {time(decision.evaluatedAt)}</p><code>{decision.decisionHash}</code><a className="text-button" href={endpoint(`/api/decisions/${encodeURIComponent(decision.decisionId)}`)} target="_blank" rel="noreferrer">原始决策文件 <ArrowUpRight size={14}/></a></details></>;
}
function ArtifactText({id}:{id:string}) {
  const [text,setText]=useState(''); const [error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();setText('');setError('');request(endpoint(`/api/artifacts/${encodeURIComponent(id)}`),{signal:controller.signal}).then(r=>r.text()).then(t=>{if(!controller.signal.aborted)setText(t);}).catch(e=>{if(!controller.signal.aborted)setError(message(e));});return()=>controller.abort();},[id]);
  if(error)return <p role="alert" className="error">{error}</p>;
  if(text.trimStart().startsWith('# '))return <article className="report-markdown"><Markdown skipHtml components={{img:()=>null,a:({children})=><span>{children}</span>}}>{text}</Markdown></article>;
  return <pre className="report-text">{text||'正在读取文件…'}</pre>;
}
export default function App() {
  const [view,setView]=useState<'workspace'|'history'|'compare'>('workspace');
  const [sample,setSample]=useState<'round-1'|'round-2'>('round-1');
  const [config,setConfig]=useState({configured:false,creationConfigured:false});
  const [checking,setChecking]=useState(true),[connectionError,setConnectionError]=useState('');
  const [health,setHealth]=useState<ReturnType<typeof HealthSchema.parse>|null>(null);
  const [agents,setAgents]=useState<AgentProfile[]>([]);
  const [runId,setRunId]=useState(new URLSearchParams(location.search).get('run')??'');
  const [run,setRun]=useState<RunDetail|null>(null),[events,setEvents]=useState<RuntimeEvent[]>([]),[announcements,setAnnouncements]=useState<Announcement[]>([]);
  const [syncError,setSyncError]=useState(''),[updated,setUpdated]=useState('');
  const [history,setHistory]=useState<string[]>(savedRuns),[lookup,setLookup]=useState('');
  const [busy,setBusy]=useState(false),[createError,setCreateError]=useState('');
  const [pendingId,setPendingId]=useState(()=>localStorage.getItem('co-vibe-pending')??'');
  const [pendingSample,setPendingSample]=useState<'round-1'|'round-2'>(()=>localStorage.getItem('co-vibe-pending-sample')==='round-2'?'round-2':'round-1');
  const [demoCode,setDemoCode]=useState('');
  const [modal,setModal]=useState<'preview'|'access'|'service'|Role|null>(null);
  const [handoffId,setHandoffId]=useState<string|null>(null);
  const [artifactId,setArtifactId]=useState('');
  const [compareId,setCompareId]=useState(''),[other,setOther]=useState<RunDetail|null>(null),[compareError,setCompareError]=useState(''),[compareBusy,setCompareBusy]=useState(false);
  const compareVersion=useRef(0);
  const remember=(id:string)=>{setHistory(items=>{if(items[0]===id)return items;const next=[id,...items.filter(x=>x!==id)].slice(0,20);localStorage.setItem('co-vibe-runs',JSON.stringify(next));return next;});};
  const openRun=(id:string)=>{setRunId(id);setView('workspace');setModal(null);setHandoffId(null);setArtifactId('');const url=new URL(location.href);if(id)url.searchParams.set('run',id);else url.searchParams.delete('run');window.history.pushState({},'',url);};
  useEffect(()=>{const pop=()=>{setRunId(new URLSearchParams(location.search).get('run')??'');setView('workspace');setArtifactId('');};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  useEffect(()=>{
    let cancelled=false;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function refresh(){
      try{
        const c=ConfigSchema.parse(await (await request('/api/web?action=status',{signal:controller.signal})).json());
        if(cancelled)return;setConfig(c);
        if(c.configured){const [h,a]=await Promise.all([read('/health',HealthSchema,controller.signal),read('/api/agents',AgentsResponseSchema,controller.signal)]);if(cancelled)return;setHealth(h);setAgents(a.agents);}
        setConnectionError('');
      }catch(e){if(!cancelled)setConnectionError(message(e));}finally{if(!cancelled){setChecking(false);timer=setTimeout(refresh,10000);}}
    }void refresh();return()=>{cancelled=true;controller.abort();clearTimeout(timer);};
  },[]);
  useEffect(()=>{
    setRun(null);setEvents([]);setAnnouncements([]);setSyncError('');setUpdated('');setOther(null);setCompareBusy(false);compareVersion.current++;
    if(!runId||!config.configured)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;let after=0;
    async function sync(){
      try{
        const detail=await read(`/api/runs/${encodeURIComponent(runId)}`,RunDetailSchema,controller.signal);
        const page=await read(`/api/runs/${encodeURIComponent(runId)}/events?after=${after}`,EventsResponseSchema,controller.signal);
        if(controller.signal.aborted)return;
        if(detail.runId!==runId||page.events.some(e=>e.runId!==runId))throw new Error('返回记录与当前运行不匹配');
        setRun(detail);setEvents(old=>mergeEvents(old,page.events));after=page.nextAfter;setUpdated(new Date().toISOString());setSyncError('');remember(runId);
        const notes=await read(`/api/announcements?runId=${encodeURIComponent(runId)}`,AnnouncementsResponseSchema,controller.signal);
        if(!controller.signal.aborted)setAnnouncements(notes.announcements);
      }catch(e){if(!controller.signal.aborted)setSyncError(message(e));}finally{if(!controller.signal.aborted)timer=setTimeout(sync,2000);}
    }void sync();return()=>{controller.abort();clearTimeout(timer);};
  },[runId,config.configured]);
  async function create(e:FormEvent){
    e.preventDefault();if(busy)return;setBusy(true);setCreateError('');
    const id=pendingId||crypto.randomUUID();const submittedSample=pendingId?pendingSample:sample;setPendingSample(submittedSample);setPendingId(id);localStorage.setItem('co-vibe-pending',id);localStorage.setItem('co-vibe-pending-sample',submittedSample);
    try{
      const response=await request(endpoint('/api/runs'),{method:'POST',headers:{'Content-Type':'application/json','X-Demo-Code':demoCode},body:JSON.stringify({runId:id,sample:submittedSample})});
      const created=RunSchema.parse(await response.json());
      if(created.runId!==id)throw new Error('创建返回的运行 ID 不匹配');
      setPendingId('');localStorage.removeItem('co-vibe-pending');setDemoCode('');remember(id);openRun(id);
    }catch(e){
      try{const recovered=await read(`/api/runs/${encodeURIComponent(id)}`,RunDetailSchema);if(recovered.runId!==id)throw Error('运行 ID 不匹配');setPendingId('');localStorage.removeItem('co-vibe-pending');setDemoCode('');remember(id);openRun(id);}
      catch{setCreateError(`${message(e)} 已保留运行 ID：${id}。可查询该记录；重试会沿用此 ID。`);}
    }finally{setBusy(false);}
  }
  async function compare(e:FormEvent){e.preventDefault();const version=++compareVersion.current;setCompareError('');setOther(null);setCompareBusy(true);try{if(compareId.trim()===runId)throw new Error('请选择另一轮运行');const result=await read(`/api/runs/${encodeURIComponent(compareId.trim())}`,RunDetailSchema);if(result.runId!==compareId.trim())throw Error('返回的运行 ID 不匹配');if(version===compareVersion.current)setOther(result);}catch(e){if(version===compareVersion.current)setCompareError(message(e));}finally{if(version===compareVersion.current)setCompareBusy(false);}}
  const unavailable=checking?'正在检查服务':!config.configured?'演示服务尚未连接':connectionError?'服务暂时无法访问':!config.creationConfigured?'演示创建入口尚未配置':!health?.chain.configured?'等待链服务配置':!health.validator.configured?'等待验收服务配置':'';
  const selectedTask=run?.tasks.find(t=>t.role==='REPORT');
  const reports=run?.artifacts.filter(a=>a.taskId===selectedTask?.taskId&&a.attempt===selectedTask.attempt)??[];
  const selectedArtifact=run?.artifacts.find(a=>a.artifactId===artifactId);
  const handoff=run?.handoffs.find(h=>h.handoffId===handoffId);
  return <>
    <a className="skip" href="#main">跳至工作台</a>
    <header className="topbar"><button className="brand" onClick={()=>setView('workspace')} aria-label="co-vibe 工作台"><span className="brand-mark"><Layers size={22}/></span>co-vibe<span className="brand-divider"/> <span className="brand-caption">协作工作台</span></button><nav aria-label="主导航"><button className={view==='workspace'?'nav active':'nav'} onClick={()=>setView('workspace')}>工作台</button><button className={view==='history'?'nav active':'nav'} onClick={()=>setView('history')}>运行记录</button></nav><button className="connection" onClick={()=>setModal('service')}><span className={`dot ${health&&!connectionError?'online':''}`}/>{checking?'检查连接':!config.configured?'服务未连接':connectionError?'连接异常':health?.chain.configured?'服务已连接':'部分服务待配置'}<ChevronRight size={14}/></button></header>
    <main id="main">
      <Orbital/>
      <section className="intro"><div><span className="eyebrow">INDEPENDENT AGENTS. SHARED EVIDENCE.</span><h1>以履历驱动的 <span>Agent 协作网络</span></h1><p className="lead">让这次合作的成果，成为下次分工的依据。</p><p className="intro-note">连接不同运营者的 Agent，按能力与已验证履历分工，<br className="desktop-break"/>将交付与验收证据记录到 Monad，让每次选择都有据可查。</p></div><div className="intro-aside"><Network size={24}/><span>独立执行 · 结构化交接</span><small>证据记录于 Monad</small></div></section>
      <div className="section-line"><div className="section-title"><span className="mini-mark"/><h2>{view==='history'?'运行记录':view==='compare'?'两轮分工比较':runId?'协作进行台':'开始一次有据可查的协作'}</h2></div><span className="muted small">{run ? `${run.mode==='REPLAY'?'回放':'实时运行'} · ${short(run.runId)}` : '固定流程 / 业务数据分析'}</span></div>
      {view==='history'?<section className="panel history-panel"><h3>打开真实运行</h3><p className="muted">输入队友提供的运行 ID，或继续查看本机已打开的记录。</p><form className="inline-form" onSubmit={e=>{e.preventDefault();openRun(lookup.trim());}}><label className="sr-only" htmlFor="lookup">运行 ID</label><input id="lookup" value={lookup} onChange={e=>setLookup(e.target.value)} placeholder="粘贴运行 ID" required maxLength={200}/><button className="primary" disabled={!lookup.trim()}><Search size={16}/>打开记录</button></form><div className="history-list">{history.length?history.map(id=><button key={id} onClick={()=>openRun(id)}><History size={18}/><span className="mono">{id}</span><ArrowRight size={16}/></button>):<div className="empty"><History size={28}/><h3>还没有本机查看记录</h3><p>运行记录来自真实服务，这里不会生成示例执行结果。</p></div>}</div><p className="small muted">本机列表只保存运行 ID。当前服务尚无全量历史列表接口。</p></section>:view==='compare'?<section className="panel comparison"><button className="text-button" onClick={()=>setView('workspace')}>← 返回当前运行</button><p>按同一角色查看两次决策，分别保留当时的履历、可用度和区块快照。</p><form className="inline-form" onSubmit={compare}><label className="sr-only" htmlFor="compare-id">另一轮运行 ID</label><input id="compare-id" value={compareId} onChange={e=>setCompareId(e.target.value)} placeholder="另一轮运行 ID" required maxLength={200}/><button className="primary" disabled={!compareId.trim()||compareBusy}>{compareBusy?'正在读取':'读取并比较'}</button></form>{compareError&&<p className="error" role="alert">{compareError}</p>}{run&&other&&roles.map(role=><section className="compare-role" key={role}><h3>{roleName[role]}</h3><div className="compare-grid">{[run,other].map(r=><article key={r.runId}><p className="mono muted">{short(r.runId)}</p><Decision decision={currentDecision(r,role)}/></article>)}</div></section>)}</section>:<>
      {!runId&&<section className="task-panel panel"><div className="task-main"><span className="overline"><Database size={16}/> 业务数据分析</span><h2>从一份数据，到一份可信的报告。</h2><p className="muted">三类 Agent 接力完成整理、统计与表达。<br/>每一步留下交付物，每一次分工都能查看依据。</p><div className="sample-picker" role="group" aria-label="选择合成示例数据"><button className={sample==='round-1'?'chosen':''} onClick={()=>setSample('round-1')} aria-pressed={sample==='round-1'}>示例数据 01</button><button className={sample==='round-2'?'chosen':''} onClick={()=>setSample('round-2')} aria-pressed={sample==='round-2'}>示例数据 02</button></div><div className="file-line"><FileText size={16}/><span>{sample}.csv</span><span className="muted">公开合成数据</span><button className="text-button" onClick={()=>setModal('preview')}>预览数据<ArrowUpRight size={14}/></button></div></div><div className="task-action"><span className="muted small">本次将获得</span><div className="deliverable"><Check size={16}/>规范化数据</div><div className="deliverable"><Check size={16}/>可核对的统计指标</div><div className="deliverable"><Check size={16}/>带来源的分析报告</div><button className="primary start" disabled={Boolean(unavailable)} onClick={()=>{setCreateError('');setModal('access');}}>开始分析<ArrowRight size={18}/></button><p className="availability">{unavailable||'需要演示授权 · 创建后等待协调者指派'}</p><button className="text-button" onClick={()=>setView('history')}>查看真实运行<ChevronRight size={14}/></button></div></section>}
      {runId&&<section className="run-summary panel"><div><span className="overline">当前运行</span><p className="mono">{runId}</p><span className="muted small">{run?`${time(run.createdAt)} · ${stateName[run.runtimeStatus]}`:'正在等待服务返回记录'}</span></div><div className="summary-actions">{run&&<Badge value={completed(run)?'VERIFIED_PASS':run.status==='VERIFIED_PASS'?'PENDING':run.status}/>}<button className="secondary" onClick={()=>setView('compare')} disabled={!run}><GitCompareArrows size={16}/>比较另一轮</button><button className="text-button" onClick={()=>openRun('')}>新建分析</button></div></section>}
      {(syncError||runId&&!config.configured)&&<p className="notice" role="status">{syncError||'服务尚未配置，暂时无法读取此运行。'}{updated&&` 保留上次状态：${time(updated)}`}</p>}
      <section className="workflow" aria-label="三步协作流程">{roles.map((role,index)=>{const Icon=icons[role];const task=run?.tasks.find(t=>t.role===role);const decision=run?currentDecision(run,role):undefined;const handoffs=run?.handoffs.filter(h=>h.fromTaskId===task?.taskId)??[];return <article className={`role-card ${task?.status==='RUNNING'?'executing':''}`} key={role}><div className="role-top"><span className="role-icon"><Icon size={21}/></span><span className="step">0{index+1}</span></div><h3>{roleName[role]}</h3><p className="role-description">{descriptions[role]}</p><div className="role-state">{task?<Badge value={task.status}/>:<span className="muted small">{runId?'等待运行数据':'创建后按履历分工'}</span>}</div>{task&&<><p className="mono small">{task.assignee?short(task.assignee):'尚未指派执行者'}</p>{run?.taskRuntime.filter(t=>t.taskId===task.taskId&&t.reason).map(t=><p className="small muted" key={t.taskId}>{t.reason}</p>)}<p className="selection-reason">{decision?.selectionReason??'等待真实决策快照'}</p><button className="text-button" onClick={()=>setModal(role)}>查看分工依据<ChevronRight size={14}/></button>{handoffs.map(h=><button className="handoff" key={h.handoffId} onClick={()=>setHandoffId(h.handoffId)}>交接 · {stateName[h.status]}<ArrowRight size={14}/></button>)}</>}</article>;})}</section>
      {run&&<><div className="section-line"><h2>成果与证据</h2><span className="small muted">生成、验收、上链分别记录</span></div><section className="panel results">{reports.length?<><div className="result-header"><div><FileText size={22}/><h3>分析报告</h3></div><span className="muted small">{completed(run)?'全部任务验收通过且回执已确认':'请查看各文件对应的验收与交易状态'}</span></div><div className="artifact-tabs">{reports.map(a=><button className={artifactId===a.artifactId?'chosen':''} onClick={()=>setArtifactId(a.artifactId)} key={a.artifactId}>{short(a.artifactId)}</button>)}</div>{artifactId&&selectedArtifact?<ArtifactText id={artifactId}/>:<p className="muted">选择报告文件即可阅读原始内容。</p>}</>:<div className="empty"><FileText size={28}/><h3>报告尚未生成</h3><p>上游完成交接后，实际交付的报告会出现在这里。</p></div>}<div className="artifacts">{run.artifacts.map(a=>{const assessment=run.assessments.find(s=>s.taskId===a.taskId&&s.attempt===a.attempt);return <div className="artifact" key={a.artifactId}><div><strong>{a.schemaVersion}</strong><p className="small mono muted">{short(a.artifactId)} · 版本 {a.attempt}</p><p className="small">验收：{assessment?assessment.verdict==='PASS'?'通过':assessment.verdict==='FAIL'?'未通过':'待定':'尚未验收'} · 链上：{assessment?.receipt?stateName[assessment.receipt.status]:'暂无回执'}</p>{a.limitations.length>0&&<p className="small muted">限制：{a.limitations.join('；')}</p>}</div><a className="secondary" href={endpoint(`/api/artifacts/${encodeURIComponent(a.artifactId)}`)}><ArrowDownToLine size={15}/>下载</a><details><summary>来源与验收证据</summary><p>生产者 <code>{a.producer}</code></p><p>内容哈希 <code>{a.contentHash}</code></p><p>上游产物：{a.parentArtifactIds.join('、')||'原始输入'}</p>{assessment&&<><p>验收项：{assessment.checks.map(c=>`${c.passed?'通过':'未通过'}：${c.message}`).join('；')}</p><a href={endpoint(`/api/tasks/${encodeURIComponent(a.taskId)}/assessments/${a.attempt}/evidence`)} target="_blank" rel="noreferrer">读取验收证据</a>{assessment.receipt&&<p>交易 <code>{assessment.receipt.txHash}</code>区块 {assessment.receipt.blockNumber??'等待确认'}</p>}</>}</details></div>;})}</div></section><section className="panel activity-panel"><div className="result-header"><h3>协作动态</h3><span className="small muted">{updated?`最近同步 ${time(updated)}`:'等待同步'}</span></div>{announcements.map(n=><article className="announcement" key={n.announcementId}><span className="small muted">{short(n.author)} · {time(n.createdAt)}</span><h4>{n.topic}</h4><p>{n.body}</p></article>)}<details><summary>原始运行事件（最近 {events.length} 条）</summary>{events.map(e=><div className="event" key={e.eventId}><span className="mono small">#{e.seq} {e.type}</span><time>{time(e.createdAt)}</time><pre>{JSON.stringify(e.data,null,2)}</pre>{e.receipt&&<Badge value={e.receipt.status}/>}</div>)}</details></section></>}
      <section className="network-section"><div><span className="overline"><ShieldCheck size={16}/> 可验证协作</span><h3>看得见成果，也看得见选择的依据。</h3><p className="muted">履历按角色分别计算。已确认的验收记录，才会进入下一次分工。</p></div><button className="text-button" onClick={()=>setModal('service')}>{agents.length?`${agents.length} 个已登记 Agent`:'查看服务与节点状态'}<ArrowUpRight size={15}/></button></section>
      </>}
      <footer><span>co-vibe <span className="footer-separator">/</span> 本次合作，为下次选择留下依据。</span><span>Monad · 验证记录</span></footer>
    </main>
    {modal&&<Dialog title={modal==='preview'?'示例数据预览':modal==='access'?'开始一次真实分析':modal==='service'?'服务与节点状态':`${roleName[modal]} · 分工依据`} onClose={()=>{if(!busy)setModal(null);}}>{modal==='preview'?<><p className="muted">来自团队固定任务的公开合成 CSV；仅用作输入，不代表任何 Agent 的执行结果。</p><pre className="csv-preview">{sample==='round-1'?firstCSV:secondCSV}</pre></>:modal==='access'?<form onSubmit={create}><p>提交 {sample}.csv，创建三步协作任务。创建成功后，仍需协调者完成指派与验收。</p><label htmlFor="demo-code">演示授权码</label><input id="demo-code" autoComplete="off" type="password" value={demoCode} onChange={e=>setDemoCode(e.target.value)} required/><p className="muted small">由演示负责人提供，仅在本次页面中使用。</p>{createError&&<p role="alert" className="error">{createError}</p>}{pendingId&&<button type="button" className="text-button" onClick={()=>openRun(pendingId)}>查询上次创建的运行</button>}<button className="primary" disabled={busy||!demoCode||Boolean(unavailable)}>{busy?<RefreshCw size={16} className="spin"/>:<LockKeyhole size={16}/>} {busy?'正在提交，请勿重复操作':pendingId?'使用原 ID 重试':'确认开始'}</button></form>:modal==='service'?<><p className="muted">各项分别核实；服务可访问不代表 Worker 在线或链上流程已通过。</p><dl className="service-grid"><dt>任务服务</dt><dd>{!config.configured?'未配置':connectionError?'无法访问':health?'已连接':'检查中'}</dd><dt>数据库</dt><dd>{connectionError?'状态未更新':health?.database??'未知'}</dd><dt>链适配器</dt><dd>{connectionError?'状态未更新':health?health.chain.configured?'已配置，未证明链路成功':'未配置':'未知'}</dd><dt>验收器</dt><dd>{connectionError?'状态未更新':health?health.validator.configured?'已配置':'未配置':'未知'}</dd></dl>{connectionError&&<p className="error">{connectionError}</p>}<h3>已登记节点</h3>{agents.length?agents.map(a=><div className="candidate" key={a.agentId}><strong className="mono">{short(a.agentId)}</strong><p>{a.roles.map(r=>roleName[r]).join(' / ')}</p><p className="small muted">最近心跳：{a.lastSeenAt?time(a.lastSeenAt):'未收到'}<br/>任务负载：{a.activeTasks}/{a.maxConcurrency}</p></div>):<p className="muted">{config.configured?'尚未读到节点资料':'连接任务服务后显示真实节点。'}</p>}</>:<Decision decision={run?currentDecision(run,modal):undefined}/>}</Dialog>}
    {handoff&&<Dialog title="交接详情" onClose={()=>setHandoffId(null)}><Badge value={handoff.status}/><p>{handoff.reason}</p><p>产物 <code>{handoff.artifactId}</code></p><p>规范 {handoff.schemaVersion}</p><p>内容摘要 <code>{handoff.contentHash}</code></p><p className="muted">{time(handoff.createdAt)}</p><a className="secondary" href={endpoint(`/api/artifacts/${encodeURIComponent(handoff.artifactId)}`)}>下载交接文件<ArrowDownToLine size={15}/></a></Dialog>}
  </>;
}

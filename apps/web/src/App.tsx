import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronRight, Database, FileText, GitCompareArrows, History, Layers, LockKeyhole, Network, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { AgentsResponseSchema, RunDetailSchema, RunSchema, EventsResponseSchema, AnnouncementsResponseSchema, type RunDetail, type AgentProfile, type RuntimeEvent, type Announcement, type Role, type AssignmentDecision } from '@co-vibe/contracts';
import { ConfigSchema, HealthSchema, RequestError, endpoint, read, request, userMessage } from './api';
import { agentOnline, completed, currentDecision, mergeEvents, roleName, roles, runState, short, stateName } from './model';
import firstCSV from '../../../workers/fixtures/round-1.csv?raw';
import secondCSV from '../../../workers/fixtures/round-2.csv?raw';
import Markdown from 'react-markdown';
import SignalScene from './SignalScene';
import LandingExperience from './LandingExperience';
import PointerFeedback from './PointerFeedback';
import CollaborationBoard from './CollaborationBoard';
import './collaboration.css';

const descriptions = {DATA:'规范字段、处理重复记录，交付可用的数据。',ANALYSIS:'基于整理后的数据，计算可核对的业务指标。',REPORT:'引用统计结果，生成有据可查的分析报告。'};
const exclusionName:Record<string,string> = {ROLE_MISMATCH:'不负责此类任务',HEARTBEAT_MISSING:'尚未上线',HEARTBEAT_EXPIRED:'暂时离线',HEARTBEAT_IN_FUTURE:'连接时间异常',BUSY:'正在忙碌',NOT_ADMITTED:'暂不可参与',CONDITIONS_NOT_ACCEPTED:'尚未确认参与'};
const icons = {DATA:Database,ANALYSIS:Activity,REPORT:FileText};
const time = (s:string) => new Date(s).toLocaleString('zh-CN',{hour12:false});
const message = userMessage;
function savedRuns():string[] { try { return JSON.parse(localStorage.getItem('co-vibe-runs') ?? '[]').filter((x:unknown)=>typeof x==='string').slice(0,20); } catch { return []; } }
function Badge({value}:{value:string}) { return <span className={`badge ${['VERIFIED_PASS','CONFIRMED','ACCEPTED'].includes(value)?'good':['VERIFIED_FAIL','FAILED','RETURNED'].includes(value)?'bad':'neutral'}`}>{stateName[value] ?? '状态暂不可用'}</span>; }

function Dialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ const before=document.activeElement as HTMLElement; const dialog=ref.current; dialog?.showModal(); return ()=>{dialog?.close();before?.focus();}; },[]);
  return <dialog ref={ref} className="drawer" aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const rect=e.currentTarget.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)onClose();}}}><div className="drawer-head"><h2>{title}</h2><button className="icon-button" aria-label="关闭详情" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
function Decision({decision}:{decision:AssignmentDecision|undefined}) {
  if(!decision)return <p className="muted">分工尚未完成，完成后可查看选择原因。</p>;
  return <><p>{decision.selectionReason}</p><p className="muted">分工参考过往表现（80%）与当前空闲程度（20%）。尚无验收记录的成员，其能力仍待验证。</p>{decision.candidateScores.map(c=><div className="candidate" key={c.agentId}><strong className="mono">{short(c.agentId)}</strong>{decision.selectedAgentId===c.agentId&&<span className="accent">本轮选中</span>}<p>通过 {c.passCount} · 未通过 {c.failCount} · 样本 {c.sampleSize}</p><p>履历 {c.reputation.toFixed(3)} · 可用度 {c.availability.toFixed(3)} · 综合 {c.score.toFixed(3)}</p><p>当时任务负载 {c.activeTasks} / {c.maxConcurrency}</p></div>)}{decision.excludedReasons.map(c=><p key={c.agentId} className="muted">{short(c.agentId)}：未参与排名（{c.reasons.map(reason=>exclusionName[reason]??'暂不可参与').join('、')}）</p>)}<details><summary>查看决策证据</summary><p>政策 {decision.policyVersion} · 区块 {decision.repBlockNumber} · {time(decision.evaluatedAt)}</p><p>冻结时的节点状态</p>{decision.agents.map(a=><p key={a.agentId}><code>{a.agentId}</code> · {agentOnline(a.lastSeenAt,Date.parse(decision.evaluatedAt))?'当时在线':'当时离线或未知'} · 负载 {a.activeTasks}/{a.maxConcurrency}</p>)}<code>{decision.decisionHash}</code><a className="text-button" href={endpoint(`/api/decisions/${encodeURIComponent(decision.decisionId)}`)} target="_blank" rel="noreferrer">原始决策文件 <ArrowUpRight size={14}/></a></details></>;
}
function ArtifactText({id}:{id:string}) {
  const [text,setText]=useState(''); const [error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();setText('');setError('');request(endpoint(`/api/artifacts/${encodeURIComponent(id)}/files/report.md`),{signal:controller.signal}).then(r=>r.text()).then(t=>{if(!controller.signal.aborted)setText(t);}).catch(e=>{if(!controller.signal.aborted)setError(message(e));});return()=>controller.abort();},[id]);
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
  const [notesError,setNotesError]=useState(''),[notesUpdated,setNotesUpdated]=useState('');
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
    setRun(null);setEvents([]);setAnnouncements([]);setSyncError('');setUpdated('');setNotesError('');setNotesUpdated('');setOther(null);setCompareBusy(false);compareVersion.current++;
    if(!runId||!config.configured)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;let after=0;
    async function sync(){
      try{
        const detail=await read(`/api/runs/${encodeURIComponent(runId)}`,RunDetailSchema,controller.signal);
        if(controller.signal.aborted)return;
        if(detail.runId!==runId)throw new Error('返回记录与本次分析不匹配');
        setRun(detail);setUpdated(new Date().toISOString());setSyncError('');remember(runId);
        const page=await read(`/api/runs/${encodeURIComponent(runId)}/events?after=${after}`,EventsResponseSchema,controller.signal);
        if(controller.signal.aborted)return;
        if(page.events.some(e=>e.runId!==runId))throw new Error('返回事件与本次分析不匹配');
        setEvents(old=>mergeEvents(old,page.events));after=page.nextAfter;
      }catch(e){if(!controller.signal.aborted)setSyncError(message(e));}finally{if(!controller.signal.aborted)timer=setTimeout(sync,2000);}
    }void sync();return()=>{controller.abort();clearTimeout(timer);};
  },[runId,config.configured]);
  useEffect(()=>{
    if(!runId||!config.configured)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function syncNotes(){
      try{
        const notes=await read(`/api/announcements?runId=${encodeURIComponent(runId)}`,AnnouncementsResponseSchema,controller.signal);
        if(notes.announcements.some(n=>n.runId!==runId))throw new Error('公告与本次分析不匹配');
        if(!controller.signal.aborted){setAnnouncements(notes.announcements);setNotesError('');setNotesUpdated(new Date().toISOString());}
      }catch(e){if(!controller.signal.aborted)setNotesError(message(e));}
      finally{if(!controller.signal.aborted)timer=setTimeout(syncNotes,2000);}
    }
    void syncNotes();return()=>{controller.abort();clearTimeout(timer);};
  },[runId,config.configured]);
  async function create(e:FormEvent){
    e.preventDefault();if(busy)return;setBusy(true);setCreateError('');
    const id=pendingId||crypto.randomUUID();const submittedSample=pendingId?pendingSample:sample;setPendingSample(submittedSample);setPendingId(id);localStorage.setItem('co-vibe-pending',id);localStorage.setItem('co-vibe-pending-sample',submittedSample);
    try{
      const response=await request(endpoint('/api/runs'),{method:'POST',headers:{'Content-Type':'application/json','X-Demo-Code':demoCode},body:JSON.stringify({runId:id,sample:submittedSample})});
      const created=RunSchema.parse(await response.json());
      if(created.runId!==id)throw new Error('创建返回的分析编号 不匹配');
      setPendingId('');localStorage.removeItem('co-vibe-pending');setDemoCode('');remember(id);openRun(id);
    }catch(e){
      if(e instanceof RequestError&&e.status<500&&e.status!==409){setCreateError(message(e));return;}
      try{const recovered=await read(`/api/runs/${encodeURIComponent(id)}`,RunDetailSchema);if(recovered.runId!==id)throw Error('分析编号 不匹配');setPendingId('');localStorage.removeItem('co-vibe-pending');setDemoCode('');remember(id);openRun(id);}
      catch{setCreateError(`${message(e)} 尚未确认提交结果，请先点击“查看上次提交结果”；重试将继续上次提交。`);}
    }finally{setBusy(false);}
  }
  async function compare(e:FormEvent){e.preventDefault();const version=++compareVersion.current;setCompareError('');setOther(null);setCompareBusy(true);try{if(compareId.trim()===runId)throw new Error('请输入另一份分析的编号');const result=await read(`/api/runs/${encodeURIComponent(compareId.trim())}`,RunDetailSchema);if(result.runId!==compareId.trim())throw Error('返回的分析编号 不匹配');if(version===compareVersion.current)setOther(result);}catch(e){if(version===compareVersion.current)setCompareError(message(e));}finally{if(version===compareVersion.current)setCompareBusy(false);}}
  const unavailable=checking?'正在检查服务':!config.configured?'暂时无法开始分析，可先预览数据':connectionError?'服务暂时无法访问':!config.creationConfigured?'分析暂未开放':!health?.validator.configured?'结果检查暂不可用':'';
  const waitingRoles=roles.filter(role=>!agents.some(a=>a.roles.includes(role)&&a.admitted&&a.conditionsAccepted&&agentOnline(a.lastSeenAt)&&a.activeTasks<a.maxConcurrency));
  const executionWarning=health&&!connectionError?[
    !health.chain.writable?'记录验证暂不可用。创建后将等待分工，尚不能生成已确认的分析结果。':'',
    waitingRoles.length?`${waitingRoles.map(role=>roleName[role]).join('、')}的协作成员暂未就绪，创建后将等待分工。`:'',
  ].filter(Boolean).join(' '):'';
  const selectedTask=run?.tasks.find(t=>t.role==='REPORT');
  const reports=run?.artifacts.filter(a=>a.taskId===selectedTask?.taskId&&a.attempt===selectedTask.attempt)??[];
  const selectedArtifact=run?.artifacts.find(a=>a.artifactId===artifactId);
  const handoff=run?.handoffs.find(h=>h.handoffId===handoffId);
  const collaboration=<CollaborationBoard key={runId||'unstarted'} run={run} runId={runId} notes={announcements} updated={notesUpdated} error={notesError||(runId&&!config.configured?'服务未连接，暂时无法读取公告。':'')} onRole={role=>setModal(role)} onHandoff={setHandoffId}/>;
  return <>
    <PointerFeedback/>
    <a className="skip" href="#main">跳至工作台</a>
    <header className="topbar"><button className="brand" onClick={()=>setView('workspace')} aria-label="co-vibe 工作台"><span className="brand-mark"><Layers size={22}/></span>co-vibe<span className="brand-divider"/> <span className="brand-caption">协作工作台</span></button><nav aria-label="主导航"><button className={view==='workspace'?'nav active':'nav'} onClick={()=>setView('workspace')}>工作台</button><button className={view==='history'?'nav active':'nav'} onClick={()=>setView('history')}>分析记录</button></nav><button className="connection" onClick={()=>setModal('service')}><span className={`dot ${health&&!connectionError?'online':''}`}/>{checking?'检查连接':!config.configured?'服务未连接':connectionError?'连接异常':health?.chain.writable?'服务已连接':'部分功能暂不可用'}<ChevronRight size={14}/></button></header>
    <main id="main" className={view==='workspace'&&!runId?'landing':'working'}>
      {(view!=='workspace'||runId)&&<div className="hero-stage"><div className="hero-pin">
      <SignalScene/>
      <section className="intro"><div><span className="eyebrow">co-vibe / 协作有迹可循</span><h1>以履历驱动的<span>Agent 协作网络</span></h1><p className="lead">让这次合作的成果，成为下次分工的依据。</p><a className="hero-link" href="#analysis">进入协作 <ArrowRight size={20}/></a></div><div className="intro-aside"><Network size={24}/><span>独立协作 · 成果可查</span><small>证据记录于 Monad</small></div></section><div className="hero-word" aria-hidden="true">co-vibe</div></div></div>}
      {(view!=='workspace'||runId)&&<div className="section-line" id="analysis" tabIndex={-1}><div className="section-title"><span className="mini-mark"/><h2>{view==='history'?'分析记录':view==='compare'?'两轮分工比较':runId?'本次分析':'开始一次有据可查的协作'}</h2></div><span className="muted small">{run ? `${run.mode==='REPLAY'?'回放':'实时运行'} · ${short(run.runId)}` : '业务数据分析'}</span></div>}
      {view==='history'?<section className="panel history-panel"><h3>查找分析记录</h3><p className="muted">输入分析编号，查看进度和结果。</p><form className="inline-form" onSubmit={e=>{e.preventDefault();openRun(lookup.trim());}}><label className="sr-only" htmlFor="lookup">分析编号</label><input id="lookup" value={lookup} onChange={e=>setLookup(e.target.value)} placeholder="粘贴分析编号" required maxLength={200}/><button className="primary" disabled={!lookup.trim()}><Search size={16}/>打开记录</button></form><div className="history-list">{history.length?history.map(id=><button key={id} onClick={()=>openRun(id)}><History size={18}/><span className="mono">{id}</span><ArrowRight size={16}/></button>):<div className="empty"><History size={28}/><h3>还没有浏览过分析记录</h3><p>打开一份分析后，可在这里再次找到它。</p></div>}</div><p className="small muted">这里显示你在此设备上查看过的记录。</p></section>:view==='compare'?<section className="panel comparison"><button className="text-button" onClick={()=>setView('workspace')}>← 返回本次分析</button><p>看看两次分析由谁完成，以及分工依据发生了什么变化。</p><form className="inline-form" onSubmit={compare}><label className="sr-only" htmlFor="compare-id">另一份分析的编号</label><input id="compare-id" value={compareId} onChange={e=>setCompareId(e.target.value)} placeholder="另一份分析的编号" required maxLength={200}/><button className="primary" disabled={!compareId.trim()||compareBusy}>{compareBusy?'正在读取':'开始比较'}</button></form>{compareError&&<p className="error" role="alert">{compareError}</p>}{run&&other&&roles.map(role=><section className="compare-role" key={role}><h3>{roleName[role]}</h3><div className="compare-grid">{[run,other].map(r=><article key={r.runId}><p className="mono muted">{short(r.runId)}</p><Decision decision={currentDecision(r,role)}/></article>)}</div></section>)}</section>:<>
      {!runId&&<LandingExperience collaboration={collaboration} sample={sample} onSample={setSample} unavailable={unavailable} warning={executionWarning} onPreview={()=>setModal('preview')} onStart={()=>{setCreateError('');setModal('access');}} onHistory={()=>setView('history')}/>}
      {runId&&run&&!completed(run)&&executionWarning&&<p className="notice" role="status">{executionWarning}</p>}
      {run&&<section className="panel input-evidence">
        <p>{run.mode==='LIVE'?'真实运行记录':'历史回放'} · {run.templateVersion} · 验收者 <code>{run.validator}</code></p>
        <p>运行网络：{[...new Set(run.taskReceipts.map(r=>r.receipt.chainId))].map(id=>id===10143?'Monad Testnet（10143）':id===31337?'本地验证链（31337）':`链 ID ${id}`).join('、')||'尚无链上回执'}</p>
        <div className="summary-actions"><a className="secondary" href={endpoint(`/api/runs/${encodeURIComponent(run.runId)}/input`)}>下载本次原始输入</a><a className="secondary" href={endpoint('/api/criteria')}>读取固定验收规则</a></div>
        <details><summary>输入与规则凭证</summary><p>输入 <code>{run.inputHash}</code></p><p>规则 <code>{run.criteriaHash}</code></p></details>
      </section>}
      {runId&&collaboration}
      {runId&&<section className="run-summary panel"><div><span className="overline">本次分析</span><p className="mono">{runId}</p><span className="muted small">{run?`${time(run.createdAt)} · ${stateName[run.runtimeStatus]}`:'正在读取分析记录'}</span></div><div className="summary-actions">{run&&<Badge value={runState(run)}/>}<button className="secondary" onClick={()=>setView('compare')} disabled={!run}><GitCompareArrows size={16}/>比较另一轮</button><button className="text-button" onClick={()=>openRun('')}>新建分析</button></div></section>}
      {(syncError||runId&&!config.configured)&&<p className="notice" role="status">{syncError||'暂时无法读取这份分析，请稍后再试。'}{updated&&` 保留上次状态：${time(updated)}`}</p>}
      {run&&<><div className="section-line"><h2>成果与证据</h2><span className="small muted">查看报告及验证结果</span></div><section className="panel results">{reports.length?<><div className="result-header"><div><FileText size={22}/><h3>分析报告</h3></div><span className="muted small">{completed(run)?'分析已通过验证，记录已确认':'验证进度见各文件下方'}</span></div><div className="artifact-tabs">{reports.map(a=><button className={artifactId===a.artifactId?'chosen':''} onClick={()=>setArtifactId(a.artifactId)} key={a.artifactId}>{short(a.artifactId)}</button>)}</div>{artifactId&&selectedArtifact?<ArtifactText id={artifactId}/>:<p className="muted">选择一份报告开始阅读。</p>}</>:<div className="empty"><FileText size={28}/><h3>报告尚未生成</h3><p>报告完成后会显示在这里。你可以先查看分析进度。</p></div>}<div className="artifacts">{run.artifacts.map(a=>{const assessment=run.assessments.find(s=>s.taskId===a.taskId&&s.attempt===a.attempt);return <div className="artifact" key={a.artifactId}><div><strong>{(run.tasks.find(t=>t.taskId===a.taskId)?.role ? roleName[run.tasks.find(t=>t.taskId===a.taskId)!.role] : '分析')}成果</strong><p className="small mono muted">{short(a.artifactId)} · 第 {a.attempt} 次执行</p><p className="small">验收：{assessment?assessment.verdict==='PASS'?'通过':assessment.verdict==='FAIL'?'未通过':'待定':'尚未验收'} · 链上：{assessment?.receipt?stateName[assessment.receipt.status]:'暂无回执'}</p>{a.limitations.length>0&&<p className="small muted">限制：{a.limitations.join('；')}</p>}</div><a className="secondary" href={endpoint(`/api/artifacts/${encodeURIComponent(a.artifactId)}`)}><ArrowDownToLine size={15}/>下载</a><details><summary>查看来源与技术凭证</summary><p>文件格式 {a.schemaVersion}</p><p>由谁完成 <code>{a.producer}</code></p><p>文件校验值 <code>{a.contentHash}</code></p><p>引用文件：{a.parentArtifactIds.join('、')||'原始输入'}</p>{assessment&&<><p>验收项：{assessment.checks.map(c=>`${c.passed?'通过':'未通过'}：${c.message}`).join('；')}</p><a href={endpoint(`/api/tasks/${encodeURIComponent(a.taskId)}/assessments/${a.attempt}/evidence`)} target="_blank" rel="noreferrer">读取验收证据</a>{assessment.receipt&&<p>交易 <code>{assessment.receipt.txHash}</code>区块 {assessment.receipt.blockNumber??'等待确认'}</p>}</>}</details></div>;})}</div></section><section className="panel activity-panel"><div className="result-header"><h3>运行证据</h3><span className="small muted">{updated?`最近同步 ${time(updated)}`:'等待同步'}</span></div><details><summary>技术记录（最近 {events.length} 条）</summary>{events.map(e=><div className="event" key={e.eventId}><span className="mono small">#{e.seq} {e.type}</span><time>{time(e.createdAt)}</time><pre>{JSON.stringify(e.data,null,2)}</pre>{e.receipt&&<Badge value={e.receipt.status}/>}</div>)}</details></section></>}
      {run&&<section className="panel"><h3>成果文件</h3>{run.artifacts.map(a=><div className="artifact" key={a.artifactId}><span>{roleName[run.tasks.find(t=>t.taskId===a.taskId)!.role]}</span>{(run.tasks.find(t=>t.taskId===a.taskId)!.role==='DATA'?['data.csv','data-plan.json']:run.tasks.find(t=>t.taskId===a.taskId)!.role==='ANALYSIS'?['metrics.json']:['report.md','report.json']).map(name=><a className="text-button" key={name} href={endpoint(`/api/artifacts/${encodeURIComponent(a.artifactId)}/files/${name}`)}>下载 {name}</a>)}</div>)}</section>}
      {run&&<section className="panel"><h3>链上回执</h3>{run.taskReceipts.map(r=><details key={`${r.taskId}-${r.attempt}-${r.operation}`}><summary>{roleName[run.tasks.find(t=>t.taskId===r.taskId)!.role]} · {r.operation} · {stateName[r.receipt.status]}</summary><p>链 ID {r.receipt.chainId} · 区块 {r.receipt.blockNumber??'等待确认'}</p><code>{r.receipt.txHash}</code>{r.receipt.chainId===10143&&<p><a href={`https://testnet.monadexplorer.com/tx/${r.receipt.txHash}`} target="_blank" rel="noreferrer">查看区块浏览器</a></p>}</details>)}</section>}
      {runId&&<section className="network-section"><div><span className="overline"><ShieldCheck size={16}/> 可验证协作</span><h3>看得见成果，也看得见选择的依据。</h3><p className="muted">履历按角色分别计算。已确认的验收记录，才会进入下一次分工。</p></div><button className="text-button" onClick={()=>setModal('service')}>{agents.length?`${agents.length} 个协作成员`:'查看服务状态'}<ArrowUpRight size={15}/></button></section>}
      </>}
      <footer><span>co-vibe <span className="footer-separator">/</span> 本次合作，为下次选择留下依据。</span><span>Monad · 验证记录</span></footer>
    </main>
    {modal&&<Dialog title={modal==='preview'?'示例数据预览':modal==='access'?'开始分析':modal==='service'?'服务状态':`${roleName[modal]} · 分工依据`} onClose={()=>{if(!busy)setModal(null);}}>
      {modal==='preview'?<>
        <p className="muted">这是一份合成示例数据，用于体验数据分析，不包含真实经营信息。</p>
        <pre className="csv-preview">{sample==='round-1'?firstCSV:secondCSV}</pre>
        <a className="secondary" href={endpoint('/api/criteria')}>读取固定验收规则</a>
      </>:modal==='access'?<form onSubmit={create}>
        <p>使用 {pendingId?pendingSample:sample}.csv 进行分析。提交后等待分工，你可以随时查看进度和报告。</p>
        {executionWarning&&<p className="notice" role="status">{executionWarning}</p>}
        <label htmlFor="demo-code">访问码</label><input id="demo-code" autoComplete="off" type="password" value={demoCode} onChange={e=>setDemoCode(e.target.value)} required/>
        <p className="muted small">访问码由活动负责人提供。</p>{createError&&<p role="alert" className="error">{createError}</p>}
        {pendingId&&<button type="button" className="text-button" onClick={()=>openRun(pendingId)}>查看上次提交结果</button>}
        <button className="primary" disabled={busy||!demoCode||Boolean(unavailable)}>{busy?<RefreshCw size={16} className="spin"/>:<LockKeyhole size={16}/>} {busy?'正在提交，请勿重复操作':pendingId?'重试上次提交':'确认开始'}</button>
      </form>:modal==='service'?<>
        <p className="muted">查看分析、验证服务和协作成员的当前状态。具体分析的验证结果会显示在报告下方。</p>
        <dl className="service-grid"><dt>分析服务</dt><dd>{!config.configured?'暂不可用':connectionError?'无法访问':health?'已连接':'检查中'}</dd>
          <dt>记录验证</dt><dd>{connectionError?'状态未更新':health?health.chain.writable?'可写入记录':health.chain.configured?'尚未配置签名':'暂不可用':'尚未获取状态'}</dd>
          <dt>结果检查</dt><dd>{connectionError?'状态未更新':health?health.validator.configured?'已设置':'暂不可用':'未知'}</dd></dl>
        {executionWarning&&<p className="notice">{executionWarning}</p>}{connectionError&&<p className="error">{connectionError}</p>}
        <h3>协作成员</h3>{agents.length?agents.map(a=><div className="candidate" key={a.agentId}><strong className="mono">{short(a.agentId)}</strong><p>{a.roles.map(r=>roleName[r]).join(' / ')}</p>
          <p>{connectionError?'在线状态未更新':agentOnline(a.lastSeenAt)?'当前在线':'当前离线或尚未上线'}</p>
          <p className="small muted">最近在线时间：{a.lastSeenAt?time(a.lastSeenAt):'尚未获取'}<br/>正在处理 {a.activeTasks} 项任务 · 最多同时处理 {a.maxConcurrency} 项</p></div>):<p className="muted">暂未获取成员信息。</p>}
      </>:<Decision decision={run?currentDecision(run,modal):undefined}/>}
    </Dialog>}
    {handoff&&<Dialog title="交接详情" onClose={()=>setHandoffId(null)}><p>{run?.tasks.find(t=>t.taskId===handoff.fromTaskId)?.role?roleName[run.tasks.find(t=>t.taskId===handoff.fromTaskId)!.role]:'上游任务'} → {run?.tasks.find(t=>t.taskId===handoff.toTaskId)?.role?roleName[run.tasks.find(t=>t.taskId===handoff.toTaskId)!.role]:'下游任务'}</p><Badge value={handoff.status}/><p>交付文件：<code>{handoff.artifactId}</code></p><p className="small muted">下游验收条件：当前接口未提供可读说明。</p><p>{handoff.reason}</p><details><summary>查看文件凭证</summary><p>文件编号 <code>{handoff.artifactId}</code></p><p>文件格式 {handoff.schemaVersion}</p><p>文件校验值 <code>{handoff.contentHash}</code></p></details><p className="muted">{time(handoff.createdAt)}</p><a className="secondary" href={endpoint(`/api/artifacts/${encodeURIComponent(handoff.artifactId)}`)}>下载交接文件<ArrowDownToLine size={15}/></a></Dialog>}
  </>;
}

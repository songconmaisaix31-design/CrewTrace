import { useState, Fragment } from 'react';
import type { Announcement, Role, RunDetail } from '@co-vibe/contracts';
import { currentDecision, roles, roleName, short, stateName } from './model';

const labels={PROGRESS:'进度',HANDOFF:'交接',BLOCKER:'阻塞',RESULT:'结果'};
type Props={run:RunDetail|null;runId:string;notes:Announcement[];updated:string;error:string;onRole:(role:Role)=>void;onHandoff:(id:string)=>void};
export default function CollaborationBoard({run,runId,notes,updated,error,onRole,onHandoff}:Props){
  const [filter,setFilter]=useState('ALL');
  const scoped=[...new Map(notes.filter(n=>n.runId===runId).map(n=>[n.announcementId,n])).values()];
  const visible=scoped.filter(n=>filter==='ALL'||n.type===filter).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  return <section className="collaboration-board" aria-label="协作关系与公告板">
    <div className="collaboration-map"><header><h2>协作关系</h2><span>{run?run.mode==='REPLAY'?'历史回放':'本次分析':runId?'等待读取':'尚未开始'}</span></header>
      <p className="board-hint">{run?'选择节点查看分工，选择连线查看交接。':runId?'正在读取协作记录，尚不能确认执行状态。':'开始分析后，执行者和交接进度将在这里展开。'}</p>
      <div className="agent-path">{roles.map((role,index)=>{
        const task=run?.tasks.find(t=>t.role===role), next=run?.tasks.find(t=>t.role===roles[index+1]);
        const decision=run?currentDecision(run,role):undefined;
        const links=(run?.handoffs.filter(h=>h.fromTaskId===task?.taskId&&h.toTaskId===next?.taskId&&run.artifacts.some(a=>a.artifactId===h.artifactId&&a.attempt===task?.attempt))??[]).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
        return <Fragment key={role}><div className="agent-node" data-status={task?.status??'OPEN'}>
          <button className="node-index" disabled={!task} onClick={()=>onRole(role)} aria-label={`查看${roleName[role]}的执行者与分工依据`}>0{index+1}</button><h3>{roleName[role]}</h3>
          <button className="node-assignee" disabled={!task} onClick={()=>onRole(role)}>{task?.assignee?short(task.assignee):task?'等待分工':runId?'尚未获取':'等待开始'}</button>
          <p>{task?stateName[task.status]??'状态未知':runId?'状态未知':'未执行'}</p>
          {decision&&<button className="candidate-link" onClick={()=>onRole(role)}>候选与依据 · {decision.candidateScores.length}</button>}
        </div>{index<2&&<div className="agent-edge" data-status={links[0]?.status??'WAITING'}>{links.length?<><button onClick={()=>onHandoff(links[0].handoffId)} aria-label={`${roleName[role]}到${roleName[roles[index+1]]}：${stateName[links[0].status]}`}><span>{stateName[links[0].status]}</span><span aria-hidden="true">→</span></button>{links.length>1&&<details><summary>另 {links.length-1} 条</summary>{links.slice(1).map(h=><button key={h.handoffId} onClick={()=>onHandoff(h.handoffId)}>{stateName[h.status]}</button>)}</details>}</>:<><span>{runId&&!run?'尚未获取':'等待交接'}</span><span aria-hidden="true">→</span></>}</div>}</Fragment>;
      })}</div>
    </div>
    <aside className="announcement-board" aria-labelledby="board-title"><header><h2 id="board-title">公告板</h2><span>{updated?`更新于 ${new Date(updated).toLocaleTimeString('zh-CN',{hour12:false})}`:'暂无更新'}</span></header>
      <div className="board-filters" role="group" aria-label="筛选公告">{[['ALL','全部'],...Object.entries(labels)].map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}<span className="filter-count">{value==='ALL'?scoped.length:scoped.filter(n=>n.type===value).length}</span></button>)}</div>
      {error&&<p className="board-error" role="status">{error}{updated?' 当前显示上次成功读取的公告。':''}</p>}
      <div className="board-feed">{visible.length?visible.map(n=><article key={n.announcementId} className="board-note" data-type={n.type}><div><span>{labels[n.type]}</span><time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</time></div><h3>{n.topic}</h3>{n.body.length>240?<><p>{n.body.slice(0,240)}…</p><details><summary>展开完整公告</summary><p>{n.body}</p></details></>:<p>{n.body}</p>}<span className="note-author">{short(n.author)}</span>{run?.tasks.find(t=>t.taskId===n.taskId)&&<button onClick={()=>onRole(run.tasks.find(t=>t.taskId===n.taskId)!.role)}>查看关联任务 →</button>}</article>):<div className="board-empty"><p>{!runId?'协作开始后，公告会显示在这里。':!run?'尚未获取本次协作公告。':filter==='ALL'?'本次分析暂无公告。':'暂无此类公告。'}</p><span>进度、交接、阻塞与结果，按实际记录更新。</span></div>}</div>
    </aside>
  </section>;
}

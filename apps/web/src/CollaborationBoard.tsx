import { useState, Fragment } from 'react';
import type { Announcement, Role, RunDetail } from '../vendor/contracts/schemas';
import { currentDecision, roles, roleName, short, stateName } from './model';

const labels={PROGRESS:'进度',HANDOFF:'交接',BLOCKER:'阻塞',RESULT:'结果'};
type Props={run:RunDetail|null;runId:string;notes:Announcement[];updated:string;error:string;onRole:(role:Role)=>void;onHandoff:(id:string)=>void};
export default function CollaborationBoard({run,runId,notes,updated,error,onRole,onHandoff}:Props){
  const [filter,setFilter]=useState('ALL');
  const visible=notes.filter(n=>n.runId===runId&&(filter==='ALL'||n.type===filter)).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  return <section className="collaboration-board" aria-label="协作关系与公告板">
    <div className="collaboration-map"><header><h2>协作关系</h2><span>{run?run.mode==='REPLAY'?'历史回放':'本次分析':runId?'等待读取':'尚未开始'}</span></header>
      <p className="board-hint">{run?'点执行者查看分工依据，点交接查看文件与接收情况。':'开始分析后，这里会显示执行者、进度和交接记录。'}</p>
      <div className="agent-path">{roles.map((role,index)=>{
        const task=run?.tasks.find(t=>t.role===role), next=run?.tasks.find(t=>t.role===roles[index+1]);
        const decision=run?currentDecision(run,role):undefined;
        const links=run?.handoffs.filter(h=>h.fromTaskId===task?.taskId&&h.toTaskId===next?.taskId&&run.artifacts.some(a=>a.artifactId===h.artifactId&&a.attempt===task?.attempt))??[];
        return <Fragment key={role}><div className="agent-node" data-status={task?.status??'OPEN'}>
          <span className="node-index">0{index+1}</span><h3>{roleName[role]}</h3>
          <button disabled={!task} onClick={()=>onRole(role)}>{task?.assignee?short(task.assignee):task?'等待分工':'等待开始'}</button>
          <p>{task?stateName[task.status]??'状态未知':'未执行'}</p>
          {decision&&<button className="candidate-link" onClick={()=>onRole(role)}>候选与依据 · {decision.candidateScores.length}</button>}
        </div>{index<2&&<div className="agent-edge">{links.length?links.map(h=><button key={h.handoffId} onClick={()=>onHandoff(h.handoffId)} aria-label={`${roleName[role]}到${roleName[roles[index+1]]}：${stateName[h.status]}`}><span>{stateName[h.status]}</span><span aria-hidden="true">→</span></button>):<><span>等待交接</span><span aria-hidden="true">→</span></>}</div>}</Fragment>;
      })}</div>
    </div>
    <aside className="announcement-board" aria-labelledby="board-title"><header><h2 id="board-title">公告板</h2><span>{updated?`更新于 ${new Date(updated).toLocaleTimeString('zh-CN',{hour12:false})}`:'暂无更新'}</span></header>
      <div className="board-filters" role="group" aria-label="筛选公告">{[['ALL','全部'],...Object.entries(labels)].map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
      {error&&<p className="board-error" role="status">{error}</p>}
      <div className="board-feed">{visible.length?visible.map(n=><article key={n.announcementId} className="board-note" data-type={n.type}><div><span>{labels[n.type]}</span><time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleTimeString('zh-CN',{hour12:false})}</time></div><h3>{n.topic}</h3><p>{n.body}</p><span className="note-author">{short(n.author)}</span>{run?.tasks.find(t=>t.taskId===n.taskId)&&<button onClick={()=>onRole(run.tasks.find(t=>t.taskId===n.taskId)!.role)}>查看关联任务 →</button>}</article>):<div className="board-empty"><p>{!runId?'协作开始后，公告会显示在这里。':!run?'等待读取本次协作公告。':filter==='ALL'?'本次分析暂无公告。':'暂无此类公告。'}</p><span>进度、交接、阻塞与结果，按实际记录更新。</span></div>}</div>
    </aside>
  </section>;
}

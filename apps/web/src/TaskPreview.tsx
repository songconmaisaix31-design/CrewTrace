import { useEffect, useState } from 'react';
import { CollaborationTaskDetailSchema, type CollaborationTask, type CollaborationTaskDetail } from '@co-vibe/contracts';
import { collaboration, collaborationError } from './collaboration-api';
import { useI18n } from './i18n';

type Snapshot={task:CollaborationTaskDetail;readAt:number};
const cache=new Map<string,Snapshot>();
export default function TaskPreview({task,name,status}:{task:CollaborationTask;name:(id:string)=>string;status:string}){
  const {t,time,error:translateError}=useI18n();
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    const saved=cache.get(task.taskId);
    if(saved&&Date.now()-saved.readAt<30000&&saved.task.version===task.version){setSnapshot(saved);return;}
    const controller=new AbortController();
    collaboration(`/tasks/${encodeURIComponent(task.taskId)}`,CollaborationTaskDetailSchema,{signal:controller.signal}).then(detail=>{
      if(controller.signal.aborted)return;
      const next={task:detail,readAt:Date.now()};
      if(cache.size>=100)cache.delete(cache.keys().next().value!);
      cache.set(task.taskId,next);setSnapshot(next);
    }).catch(problem=>{if(!controller.signal.aborted)setError(collaborationError(problem));});
    return()=>controller.abort();
  },[task.taskId,task.version]);
  const detail=snapshot?.task;
  const participants=detail?[...new Set(detail.claims.filter(claim=>claim.status!=='RELEASED').map(claim=>claim.agentId))]:[];
  const events=detail?[
    {at:detail.updatedAt,label:t('任务资料更新','Task updated')},
    ...detail.claims.map(claim=>({at:claim.updatedAt,label:`${name(claim.agentId)} · ${claim.status==='RELEASED'?t('释放认领','Claim released'):claim.status==='COMPLETED'?t('交付已接受','Delivery accepted'):t('认领工作','Work claimed')}`})),
    ...detail.handoffs.map(handoff=>({at:handoff.updatedAt,label:`${name(handoff.author)} · ${handoff.status==='ACCEPTED'?t('成果已接受','Delivery accepted'):handoff.status==='RETURNED'?t('成果退回修改','Delivery returned'):t('提交成果','Delivery submitted')}`})),
    ...detail.proposals.map(proposal=>({at:proposal.updatedAt,label:t('分工提议更新','Assignment proposal updated')})),
  ].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)):[];
  return <><strong>{task.title}</strong><p>{status} · {t('发布者','Posted by')} {name(task.creator)}</p><p className="preview-summary">{task.description}</p><div className="task-preview-facts">
    {error?<p role="status">{translateError(error)}</p>:snapshot?<><p>{t('参与者','Participants')} · {participants.length?participants.slice(0,3).map(name).join(t('、',', ')):t('暂无认领','No claims yet')}{participants.length>3&&t(` 等 ${participants.length} 位`,` · ${participants.length} total`)}</p><p>{t('最近进展','Latest activity')} · {events[0].label}</p><small>{time(events[0].at)}</small><small>{t('读取于','Read at')} {time(new Date(snapshot.readAt).toISOString())}</small></>:<p>{t('正在读取参与者与进展…','Loading participants and activity…')}</p>}
  </div></>;
}

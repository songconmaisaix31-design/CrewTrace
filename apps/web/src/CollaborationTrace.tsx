import { useState, type CSSProperties } from 'react';
import type { CollaborationTaskDetail } from '@co-vibe/contracts';
import { useI18n } from './i18n';

export default function CollaborationTrace({task,name}:{task:CollaborationTaskDetail;name:(id:string)=>string}){
  const {t,time}=useI18n();
  const [selected,setSelected]=useState(0);
  const accepted=task.handoffs.filter(item=>item.status==='ACCEPTED');
  const groups=[
    {label:t('发布','Published'),records:[`${name(task.creator)} · ${time(task.createdAt)}`,task.title]},
    {label:t('认领','Claims'),records:task.claims.map(item=>`${name(item.agentId)} · ${item.scope} · ${item.status==='ACTIVE'?t('正在承担','Active'):item.status==='COMPLETED'?t('已完成认领','Completed claim'):t('已释放','Released')}`)},
    {label:t('交付','Delivered'),records:task.handoffs.map(item=>`${name(item.author)} · ${item.content||item.artifactURI||t('已提交交接记录','Handoff submitted')}`)},
    {label:t('验收','Accepted'),records:accepted.map(item=>`${name(item.author)} · ${t('成果已被接受','Delivery accepted')}${item.reason?` · ${item.reason}`:''}`)},
  ];
  const latest=groups.reduce((last,group,index)=>group.records.length?index:last,0);
  return <section className="collaboration-trace" aria-label={t('协作记录','Collaboration history')}>
    <div className="trace-track" style={{'--trace-position':`${12.5+selected*25}%`} as CSSProperties} role="group" aria-label={t('查看阶段记录','View stage records')}>
      {groups.map((group,index)=><button key={index} disabled={!group.records.length} aria-pressed={selected===index} data-recorded={!!group.records.length} data-latest={index===latest} onClick={()=>setSelected(index)}><span className="trace-node"/>{group.label}<small>{group.records.length?t('有记录','Recorded'):t('暂无记录','No record')}</small></button>)}
    </div>
    <div className="trace-records" aria-live="polite">{groups[selected].records.map((record,index)=><p key={index}>{record}</p>)}</div>
    {selected>0&&task.claims.length>0&&<div className="trace-branches">{task.claims.map(claim=><div className="trace-branch" key={claim.claimId}><strong>{name(claim.agentId)}</strong><p>{claim.scope}</p>{task.handoffs.filter(handoff=>handoff.claimId===claim.claimId).map(handoff=><p key={handoff.handoffId} data-accepted={handoff.status==='ACCEPTED'}>{handoff.status==='ACCEPTED'?t('成果已接受','Delivery accepted'):handoff.status==='RETURNED'?t('退回修改','Returned for revision'):t('等待验收','Awaiting review')}{handoff.artifactURI&&/^https?:\/\//.test(handoff.artifactURI)&&<> · <a href={handoff.artifactURI} target="_blank" rel="noreferrer">{t('查看成果','View deliverable')}</a></>}</p>)}</div>)}</div>}
    <p className="public-muted">{t('依据实际协作记录展示；成果被接受不代表整个任务已完成。','Based on actual collaboration records. Accepted delivery does not mean the entire task is complete.')}</p>
  </section>;
}

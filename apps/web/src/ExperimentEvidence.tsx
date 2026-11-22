import { useEffect, useState } from 'react';
import { z } from 'zod';
import ActionForm from './ActionForm';
import { collaboration, collaborationError } from './collaboration-api';
import { useI18n } from './i18n';

const evidenceSchema = z.object({ records: z.array(z.object({
  handoffId: z.string(), checkedAt: z.string(), reputationOutcome: z.string().nullable(),
  result: z.object({ status: z.string(), ruleVersion: z.string(), contentHash: z.string(), issues: z.array(z.string()) }),
})) });
const matchingSchema = z.object({ id: z.string(), policyVersion: z.string(), candidates: z.array(z.object({
  agentId: z.string(), name: z.string(), sampleSize: z.number(), score: z.number().nullable(),
  active: z.number(), capacity: z.number(), reasons: z.array(z.string()), missingSkills: z.array(z.string()),
})) });
const workflowSchema = z.object({
  input:z.string(), version:z.string(),
  steps:z.array(z.object({role:z.string(),dependsOn:z.string().nullable(),acceptedContent:z.string().nullable()})),
  attempts:z.array(z.object({claimId:z.string(),step:z.string(),attempt:z.number(),status:z.string(),expiresAt:z.string(),claimVersion:z.number(),canExpire:z.boolean()})),
});

export default function ExperimentEvidence({taskId, version, revision, credential, mayRank, mayConfigure, onChanged}:{
  taskId: string; version: number; revision:number; credential: string; mayRank: boolean; mayConfigure:boolean; onChanged:()=>void;
}) {
  const {t,error:translateError}=useI18n();
  const [records,setRecords]=useState<z.infer<typeof evidenceSchema>['records']|null>(null);
  const [ranking,setRanking]=useState<z.infer<typeof matchingSchema>|null>(null);
  const [workflow,setWorkflow]=useState<z.infer<typeof workflowSchema>|null|undefined>(undefined);
  const [workflowRefresh,setWorkflowRefresh]=useState(0);
  const [error,setError]=useState('');
  useEffect(()=>{
    const abort = new AbortController();
    setError('');
    void collaboration(`/tasks/${taskId}/evidence`,evidenceSchema,{signal:abort.signal})
      .then(result=>{if(!abort.signal.aborted)setRecords(result.records);})
      .catch(problem=>{if(!abort.signal.aborted)setError(collaborationError(problem));});
    void collaboration(`/tasks/${taskId}/csv-workflow`,workflowSchema.nullable(),{signal:abort.signal})
      .then(result=>{if(!abort.signal.aborted)setWorkflow(result);})
      .catch(problem=>{if(!abort.signal.aborted)setError(collaborationError(problem));});
    return ()=>abort.abort();
  },[taskId,version,revision,workflowRefresh]);
  useEffect(()=>{
    const abort = new AbortController();
    void collaboration(`/tasks/${taskId}/matching`,matchingSchema.nullable(),{signal:abort.signal})
      .then(result=>{if(!abort.signal.aborted)setRanking(current=>current??result);})
      .catch(problem=>{if(!abort.signal.aborted)setError(collaborationError(problem));});
    return ()=>abort.abort();
  },[taskId]);
  return <section className="public-task-subsection">
    <h3>{t('V2 匹配与交付证据','V2 matching and delivery evidence')}</h3>
    {mayConfigure&&workflow===null&&<details>
      <summary>{t('配置三步骤 CSV 工作流','Configure three-step CSV workflow')}</summary>
      <ActionForm label={t('保存工作流','Save workflow')} onSubmit={async data=>{
        await collaboration(`/tasks/${taskId}/csv-workflow`,z.object({taskVersion:z.number()}),{
          method:'POST',credential,body:{input:String(data.get('csv')??''),expectedVersion:version},
        });
        onChanged();
      }}><label>{t('公开 CSV 输入','Public CSV input')}<textarea required name="csv" maxLength={80000}/></label></ActionForm>
    </details>}
    {workflow&&<div>
      <p className="public-muted">{workflow.version}</p>
      <button className="secondary" onClick={()=>setWorkflowRefresh(value=>value+1)}>{t('刷新步骤状态','Refresh steps')}</button>
      <ol>{workflow.steps.map(step=><li key={step.role}>
        <strong>{step.role}</strong> · {step.acceptedContent!==null?t('已验收','Accepted'):
          step.dependsOn&&workflow.steps.find(item=>item.role===step.dependsOn)?.acceptedContent===null?t('等待上游','Waiting for dependency'):t('待完成','Pending')}
        {workflow.attempts.filter(attempt=>attempt.step===step.role).map(attempt=><div key={attempt.claimId}>
          <p className="public-muted">#{attempt.attempt} · {attempt.status} · <time dateTime={attempt.expiresAt}>{new Date(attempt.expiresAt).toLocaleString()}</time></p>
          {mayRank&&attempt.canExpire&&<ActionForm label={t('释放超时步骤','Release expired attempt')} onSubmit={async()=>{
            await collaboration(`/claims/${attempt.claimId}/expire-csv`,z.object({claimId:z.string()}),{
              method:'POST',credential,body:{expectedVersion:attempt.claimVersion},
            });
            onChanged();
          }}>{null}</ActionForm>}
        </div>)}
      </li>)}</ol>
      <details><summary>{t('查看固定输入','View fixed input')}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{workflow.input}</pre></details>
    </div>}
    <p className="public-muted">{t('CSV 分工使用 csv-data-review。交付时粘贴包含 record_id、amount_cents 的 CSV 原文。','Use csv-data-review as the claim scope and paste the CSV with record_id and amount_cents as the delivery.')}</p>
    {mayRank&&<ActionForm label={t('生成并保存候选排名','Rank candidates and save snapshot')} onSubmit={async()=>{
      const result=await collaboration(`/tasks/${taskId}/matching`,matchingSchema,{method:'POST',credential,body:{}});
      setRanking(result);
    }}>{null}</ActionForm>}
    {ranking&&<div>
      <p className="public-muted">{ranking.policyVersion} · {ranking.id}</p>
      {ranking.candidates.length?<ol>{ranking.candidates.map(agent=><li key={agent.agentId}>
        <strong>{agent.name}</strong> · {agent.score===null?[...agent.reasons,...agent.missingSkills].join(', '):agent.score.toFixed(3)} · {t('样本','Samples')} {agent.sampleSize} · {t('负载','Load')} {agent.active}/{agent.capacity}
      </li>)}</ol>:<p>{t('尚无候选 Agent','No registered candidates')}</p>}
    </div>}
    {error?<p role="status">{translateError(error)}</p>:records===null?<p>{t('正在加载证据…','Loading evidence…')}</p>:records.length===0?<p>{t('该任务暂无 CSV 验证记录。','No CSV verification records for this task.')}</p>:records.map(record=><details key={record.handoffId}>
      <summary>{record.result.status} · {record.result.ruleVersion}{record.reputationOutcome&&t(' · 已计入信誉',' · Counted toward reputation')}</summary>
      <p>{record.checkedAt}</p><code style={{overflowWrap:'anywhere'}}>{record.result.contentHash}</code>
      {record.result.issues.length>0&&<ul>{record.result.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
    </details>)}
  </section>;
}

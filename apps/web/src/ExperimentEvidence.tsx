import { useEffect, useState } from 'react';
import { z } from 'zod';
import ActionForm from './ActionForm';
import { collaboration, collaborationError } from './collaboration-api';
import { useI18n } from './i18n';
import ReputationPassport from './ReputationPassport';
import { exclusionLabel, labelOf, policyLabel, roleLabel, verificationLevelLabels } from './trust-labels';

const evidenceSchema = z.object({ records: z.array(z.object({
  handoffId: z.string(), checkedAt: z.string(), reputationOutcome: z.string().nullable(),reviewStatus:z.string(),
  result: z.object({ status: z.string(), ruleVersion: z.string(), contentHash: z.string(), issues: z.array(z.string()) }),
})) });
const candidateSchema = z.object({
  agentId: z.string(), name: z.string(), sampleSize: z.number(), score: z.number().nullable(),
  active: z.number(), capacity: z.number(), reasons: z.array(z.string()), missingSkills: z.array(z.string()),
  passed: z.number().optional(), failed: z.number().optional(), reputation: z.number().optional(), availability: z.number().optional(),
  evidence: z.object({
    source: z.string(), verifiedPass: z.number(), verifiedFail: z.number(), sampleSize: z.number(), coldStart: z.boolean(),
    attestationIds: z.array(z.string()).optional(), verificationLevels: z.array(z.string()).optional(),
  }).optional(),
});
const matchingSchema = z.object({
  id: z.string(), policyVersion: z.string(), role:z.string(),selectedAgentId:z.string().nullable().optional(),
  strategy: z.string().optional(), selectionReason: z.string().optional(), evaluatedAt: z.string().optional(),
  candidates: z.array(candidateSchema),
});
const workflowSchema = z.object({
  input:z.string(), version:z.string(),mode:z.enum(['MANUAL','AUTO']),failedAt:z.string().nullable(),failedStep:z.string().nullable(),
  steps:z.array(z.object({role:z.string(),dependsOn:z.string().nullable(),acceptedContent:z.string().nullable()})),
  attempts:z.array(z.object({claimId:z.string(),step:z.string(),attempt:z.number(),status:z.string(),expiresAt:z.string(),claimVersion:z.number(),canExpire:z.boolean(),agentId:z.string(),failure:z.string().nullable(),decisionId:z.string().nullable()})),
});
type Decision = z.infer<typeof matchingSchema>;

const attemptStatus:Record<string,string>={ACTIVE:'进行中',COMPLETED:'已完成',FAILED:'失败',EXPIRED:'已超时',RELEASED:'已释放'};

export default function ExperimentEvidence({taskId, version, revision, credential, mayRank, mayConfigure,onMode,name,onChanged}:{
  taskId: string; version: number; revision:number; credential: string; mayRank: boolean; mayConfigure:boolean;
  onMode:(mode:'MANUAL'|'AUTO'|null)=>void; name:(id:string)=>string; onChanged:()=>void;
}) {
  const {t,error:translateError}=useI18n();
  const [records,setRecords]=useState<z.infer<typeof evidenceSchema>['records']|null>(null);
  const [ranking,setRanking]=useState<Decision|null>(null);
  const [workflow,setWorkflow]=useState<z.infer<typeof workflowSchema>|null|undefined>(undefined);
  const [workflowRefresh,setWorkflowRefresh]=useState(0);
  const [decisions,setDecisions]=useState<Record<string,{data?:Decision|null;error?:string}>>({});
  const [passport,setPassport]=useState<{agentId:string;name:string;role:string|null}|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const abort = new AbortController();
    setError('');
    void collaboration(`/tasks/${taskId}/evidence`,evidenceSchema,{signal:abort.signal})
      .then(result=>{if(!abort.signal.aborted)setRecords(result.records);})
      .catch(problem=>{if(!abort.signal.aborted)setError(collaborationError(problem));});
    void collaboration(`/tasks/${taskId}/csv-workflow`,workflowSchema.nullable(),{signal:abort.signal})
      .then(result=>{if(!abort.signal.aborted){setWorkflow(result);onMode(result?.mode??null);}})
      .catch(problem=>{if(!abort.signal.aborted)setError(collaborationError(problem));});
    return ()=>abort.abort();
  },[taskId,version,revision,workflowRefresh]);
  useEffect(()=>{
    const abort = new AbortController();
    void collaboration(`/tasks/${taskId}/matching`,matchingSchema.nullable(),{signal:abort.signal})
      .then(result=>{if(!abort.signal.aborted)setRanking(result);})
      .catch(problem=>{if(!abort.signal.aborted)setError(collaborationError(problem));});
    return ()=>abort.abort();
  },[taskId,version,workflowRefresh]);
  // 自动分工的决策快照保存在每次尝试上，逐条读取；单条失败只影响该步骤。
  useEffect(()=>{
    if(!workflow)return;
    const ids=[...new Set(workflow.attempts.map(attempt=>attempt.decisionId).filter((id):id is string=>!!id))];
    if(!ids.length)return;
    const controller=new AbortController();let cancelled=false;
    setDecisions({});
    for(const id of ids){
      void collaboration(`/tasks/${taskId}/matching/${encodeURIComponent(id)}`,matchingSchema.nullable(),{signal:controller.signal})
        .then(result=>{if(!cancelled)setDecisions(current=>({...current,[id]:{data:result}}));})
        .catch(problem=>{if(!cancelled&&!controller.signal.aborted)setDecisions(current=>({...current,[id]:{error:collaborationError(problem)}}));});
    }
    return()=>{cancelled=true;controller.abort();};
  },[taskId,workflow]);
  function decisionSummary(decision:Decision){
    const selected=decision.candidates.find(candidate=>candidate.agentId===decision.selectedAgentId);
    const excluded=decision.candidates.filter(candidate=>candidate.score===null);
    const reasonCounts=new Map<string,number>();
    excluded.forEach(candidate=>candidate.reasons.forEach(reason=>reasonCounts.set(reason,(reasonCounts.get(reason)??0)+1)));
    const reasons=[...reasonCounts.entries()].sort((left,right)=>right[1]-left[1]).slice(0,4).map(([reason,count])=>`${exclusionLabel(reason,t)} ${count}`);
    return <>
      <p>{t('分配策略','Policy')}：{policyLabel(decision.policyVersion,t)} · {t('选中','Selected')} {selected?.name??t('首位合格候选','the top eligible candidate')}</p>
      {selected&&<p className="public-muted">{t('可验证样本','Verified samples')} {selected.evidence?.sampleSize??0} · {t('运行期样本','Runtime samples')} {selected.sampleSize} · {t('综合分','Score')} {selected.score===null||selected.score===undefined?'—':selected.score.toFixed(3)} · {t('负载','Load')} {selected.active}/{selected.capacity}</p>}
      {!!excluded.length&&<p className="public-muted">{t(`另有 ${excluded.length} 名成员未参与排名`,`${excluded.length} members were not ranked`)}{reasons.length?`：${reasons.join('、')}`:''}</p>}
    </>;
  }
  return <section className="public-task-subsection">
    <h3>{t('分工依据与交付证据','Assignment basis and delivery evidence')}</h3>
    {mayConfigure&&workflow===null&&<details>
      <summary>{t('配置三步骤 CSV 工作流','Configure three-step CSV workflow')}</summary>
      <ActionForm label={t('保存工作流','Save workflow')} onSubmit={async data=>{
        await collaboration(`/tasks/${taskId}/csv-workflow`,z.object({taskVersion:z.number()}),{
          method:'POST',credential,body:{input:String(data.get('csv')??''),expectedVersion:version,mode:data.get('mode')},
        });
        onChanged();
      }}><label>{t('分工方式','Assignment mode')}<select name="mode"><option value="AUTO">{t('自动分工','Automatic')}</option><option value="MANUAL">{t('人工认领','Manual')}</option></select></label>
        <label>{t('公开 CSV 输入','Public CSV input')}<textarea required name="csv" maxLength={80000}/></label></ActionForm>
    </details>}
    {workflow&&<div>
      <p className="public-muted">{workflow.version} · {workflow.mode==='AUTO'?t('自动分工','Automatic dispatch'):t('人工认领','Manual claims')}</p>
      {workflow.failedAt&&<p role="status">{t('工作流已用尽重试次数','Workflow retry limit reached')} · {workflow.failedStep}</p>}
      <button className="secondary" onClick={()=>setWorkflowRefresh(value=>value+1)}>{t('刷新步骤状态','Refresh steps')}</button>
      <ol>{workflow.steps.map(step=><li key={step.role}>
        <strong>{roleLabel(step.role,t)}</strong> · {step.acceptedContent!==null?t('已验收','Accepted'):
          step.dependsOn&&workflow.steps.find(item=>item.role===step.dependsOn)?.acceptedContent===null?t('等待上游','Waiting for dependency'):t('待完成','Pending')}
        {workflow.attempts.filter(attempt=>attempt.step===step.role).map(attempt=><div key={attempt.claimId}>
          <p className="public-muted">#{attempt.attempt} · {name(attempt.agentId)} · {attempt.failure??(attemptStatus[attempt.status]??attempt.status)} · <time dateTime={attempt.expiresAt}>{new Date(attempt.expiresAt).toLocaleString()}</time></p>
          {attempt.decisionId&&<div className="matching-basis">
            {decisions[attempt.decisionId]?.data?decisionSummary(decisions[attempt.decisionId].data!):
              decisions[attempt.decisionId]?.error?<p className="public-muted">{t('分工依据暂不可读','Assignment basis is unavailable')}</p>:
              <p className="public-muted">{t('正在读取分工依据…','Loading assignment basis…')}</p>}
            <a href={`/api/web?path=${encodeURIComponent(`/api/collaboration/tasks/${taskId}/matching/${attempt.decisionId}`)}`} target="_blank" rel="noreferrer">{t('查看决策原始记录','Open the raw decision record')}</a>
          </div>}
          {mayRank&&workflow.mode==='MANUAL'&&attempt.canExpire&&<ActionForm label={t('释放超时步骤','Release expired attempt')} onSubmit={async()=>{
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
    {mayRank&&workflow?.mode!=='AUTO'&&<ActionForm label={t('生成并保存候选排名','Rank candidates and save snapshot')} onSubmit={async()=>{
      const result=await collaboration(`/tasks/${taskId}/matching`,matchingSchema,{method:'POST',credential,body:{}});
      setRanking(result);
    }}>{null}</ActionForm>}
    {ranking&&<div>
      <p className="public-muted">{roleLabel(ranking.role,t)} · {policyLabel(ranking.policyVersion,t)}</p>
      {(()=>{const used=new Set(ranking.candidates.flatMap(candidate=>candidate.evidence?.attestationIds??[]));return used.size?<p className="public-muted">{t('本次快照使用已签发凭证参与评分','This snapshot scored candidates with issued attestations')} · {t('凭证','Attestations')} {used.size}</p>:null;})()}
      {ranking.candidates.length?<ol>{ranking.candidates.map(agent=><li key={agent.agentId}>
        <strong>{agent.name}</strong> · {agent.score===null?[...agent.reasons.map(reason=>exclusionLabel(reason,t)),...agent.missingSkills.map(skill=>roleLabel(skill,t))].join('、'):agent.score.toFixed(3)} · {t('样本','Samples')} {agent.sampleSize} · {t('负载','Load')} {agent.active}/{agent.capacity}{agent.evidence&&agent.evidence.sampleSize>0&&` · ${t('可验证样本','Verified samples')} ${agent.evidence.sampleSize}${agent.evidence.verificationLevels?.length?` · ${agent.evidence.verificationLevels.map(level=>labelOf(verificationLevelLabels,level,t)).join('、')}`:''}`}{ranking.selectedAgentId===agent.agentId&&t(' · 当前快照首选',' · Selected in snapshot')}
        {' '}<button className="text-button rep-action" onClick={()=>setPassport({agentId:agent.agentId,name:agent.name,role:ranking.role})}>{t('可验证信誉','Verified reputation')}</button>
      </li>)}</ol>:<p>{t('尚无候选 Agent','No registered candidates')}</p>}
    </div>}
    {error?<p role="status">{translateError(error)}</p>:records===null?<p>{t('正在加载证据…','Loading evidence…')}</p>:records.length===0?<p>{t('该任务暂无 CSV 验证记录。','No CSV verification records for this task.')}</p>:records.map(record=><details key={record.handoffId}>
      <summary>{record.result.status==='PASS'?t('复算通过','Recalculation passed'):t('复算未通过','Recalculation failed')} · {t('规则','Rule')} {record.result.ruleVersion}{record.reputationOutcome&&t(' · 已计入信誉',' · Counted toward reputation')}</summary>
      <p>{record.checkedAt}</p><code style={{overflowWrap:'anywhere'}}>{record.result.contentHash}</code>
      <p>{t('作者审核','Author review')} · {record.reviewStatus==='ACCEPTED'?t('已接受','Accepted'):record.reviewStatus==='RETURNED'?t('已退回','Returned'):record.reviewStatus}</p>
      <a href={`/api/web?path=${encodeURIComponent(`/api/collaboration/handoffs/${record.handoffId}/csv-replay`)}`} target="_blank" rel="noreferrer">{t('复算 CSV 证据','Replay CSV evidence')}</a>
      {record.result.issues.length>0&&<ul>{record.result.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
    </details>)}
    {passport&&<ReputationPassport agentId={passport.agentId} name={passport.name} role={passport.role} credential={credential} onClose={()=>setPassport(null)}/>}
  </section>;
}

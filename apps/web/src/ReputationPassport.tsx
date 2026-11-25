import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import Dialog from './Dialog';
import { collaborationError } from './collaboration-api';
import { useI18n } from './i18n';
import {
  AgentReputationResponseSchema, downloadAttestation, loadAgentReputation, loadAttestation, type AgentReputationResponse,
} from './reputation-api';
import { attestationStatusLabels, chainStateLabels, labelOf, roleLabel, verificationLevelLabels } from './trust-labels';

export default function ReputationPassport({agentId,name,role,credential,onClose}:{
  agentId:string; name:string; role:string|null; credential:string; onClose:()=>void;
}) {
  const {t}=useI18n();
  const [data,setData]=useState<AgentReputationResponse|null>(null);
  const [error,setError]=useState('');
  const [details,setDetails]=useState<Record<string,{text:string;authorized:boolean}>>({});
  const [busy,setBusy]=useState('');
  useEffect(()=>{
    const abort=new AbortController();
    void loadAgentReputation(agentId,role,abort.signal)
      .then(result=>{if(!abort.signal.aborted)setData(result);})
      .catch(problem=>{if(!abort.signal.aborted)setError(collaborationError(problem));});
    return ()=>abort.abort();
  },[agentId,role]);
  async function inspect(attestationId:string){
    setBusy(attestationId);setError('');
    try{
      const result=await loadAttestation(attestationId,credential||undefined);
      setDetails(current=>({...current,[attestationId]:{text:JSON.stringify({summary:result.summary,verification:result.verification},null,2),authorized:result.authorized}}));
    }catch(problem){setError(collaborationError(problem));}
    finally{setBusy('');}
  }
  async function exportDocument(attestationId:string){
    if(!credential)return;
    setBusy(attestationId);setError('');
    try{await downloadAttestation(attestationId,credential);}
    catch(problem){setError(collaborationError(problem));}
    finally{setBusy('');}
  }
  return <Dialog title={t('信誉凭证','Reputation passport')} onClose={onClose}>
    <p className="public-muted">{name} · <code style={{overflowWrap:'anywhere'}}>{agentId}</code></p>
    {error&&<p role="status">{error}</p>}
    {!data&&!error&&<p>{t('正在读取可验证信誉…','Loading verified reputation…')}</p>}
    {data&&<>
      <section className="public-task-subsection">
        <h3>{t('可验证履约信誉','Verified fulfillment reputation')}</h3>
        <p className="public-muted">{data.role?roleLabel(data.role,t):t('全部角色','All roles')} · {t('角色集合','Roles')} {data.roles.length?data.roles.map(role=>roleLabel(role,t)).join('、'):t('暂无','None')}</p>
        {!data.verified.trustEnabled&&<p>{t('可验证信任未启用。','Verified trust is not enabled.')}</p>}
        {data.verified.trustEnabled&&data.verified.sampleSize===0&&<p className="public-empty">{t('该角色暂无已核验的履约记录，不显示示意信誉分。','No verified fulfillment records for this role. No illustrative score is shown.')}</p>}
        {data.verified.sampleSize>0&&<>
          <p>{t('样本','Samples')} {data.verified.sampleSize} · {t('通过','Pass')} {data.verified.pass} · {t('失败','Fail')} {data.verified.fail} · {t('验证等级','Levels')} {data.verified.verificationLevels.map(level=>labelOf(verificationLevelLabels,level,t)).join(', ')}</p>
          <ol>{data.verified.records.map(record=><li key={record.attestationId}>
            <strong>{labelOf(attestationStatusLabels,record.status,t)}</strong> · {record.role} · {record.outcome} · {labelOf(verificationLevelLabels,record.evidenceLevel,t)}
            <p className="public-muted"><time dateTime={record.issuedAt}>{new Date(record.issuedAt).toLocaleString()}</time> · {t('凭证','Attestation')} <code>{record.attestationId.slice(0,8)}</code></p>
            {record.reasons.length>0&&<p className="public-muted">{record.reasons.join(', ')}</p>}
            <button className="text-button" disabled={busy===record.attestationId} onClick={()=>void inspect(record.attestationId)}>{t('查看凭证摘要','Inspect attestation')}</button>
            {details[record.attestationId]&&<><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{details[record.attestationId].text}</pre>
              {details[record.attestationId].authorized&&credential
                ?<button className="secondary" disabled={busy===record.attestationId} onClick={()=>void exportDocument(record.attestationId)}>{t('授权导出','Export')} <Download size={15}/></button>
                :<p className="public-muted">{t('完整凭证仅向主体 Agent、任务创建者或管理员提供。','Full attestation is available to the subject agent, task creator or administrator.')}</p>}
            </>}
          </li>)}</ol>
          {data.verified.issuer&&<details><summary>{t('技术信息：签发者与策略摘要','Technical details: issuer and policy digest')}</summary>
            <p className="public-muted">{t('签发者','Issuer')} {data.verified.issuer.issuerId} · {data.verified.issuer.keyId} · {data.verified.issuer.environment}/{data.verified.issuer.deployment}</p>
            {data.verified.policyDigest&&<p className="public-muted">{t('策略摘要','Policy digest')} <code style={{overflowWrap:'anywhere'}}>{data.verified.policyDigest}</code></p>}
          </details>}
        </>}
      </section>
      <section className="public-task-subsection">
        <h3>{t('Runtime 历史信誉','Runtime historical reputation')}</h3>
        <p>{t('样本','Samples')} {data.runtimeHistorical.sampleSize} · {t('通过','Pass')} {data.runtimeHistorical.pass} · {t('失败','Fail')} {data.runtimeHistorical.fail}</p>
        <p className="public-muted">{data.runtimeHistorical.note}{t('两组来源分开显示，不相加。','The two sources are displayed separately and never summed.')}</p>
      </section>
      <section className="public-task-subsection">
        <h3>{t('核验方式与链上状态','Verification and chain status')}</h3>
        <p className="public-muted">{t('本地签名核验与离线复算只证明凭证来自本实验签发者且交付内容可复算，不代表公共链确认。','Local signature checks and offline recalculation prove the issuer and delivery only; they do not imply public-chain confirmation.')}</p>
        <p>{labelOf(chainStateLabels,data.chain.status,t)} · <span className="public-muted">{data.chain.note}</span></p>
      </section>
    </>}
  </Dialog>;
}

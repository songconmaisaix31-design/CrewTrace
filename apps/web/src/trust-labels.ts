// 界面统一使用可读标签，原始枚举与角色键只在展开的技术信息中保留。
type Translator=(zh:string,en:string)=>string;
type Pair=[string,string];

const roleLabels:Record<string,Pair>={
  'csv-source-inspection':['数据源检查','Source inspection'],
  'csv-data-review':['数据清洗与校验','Data cleaning and validation'],
  'csv-evidence-report':['证据报告','Evidence report'],
};
export const csvRoles=new Set(Object.keys(roleLabels));
export function roleLabel(role:string,t:Translator){const pair=roleLabels[role];return pair?t(pair[0],pair[1]):role;}

export const attestationStatusLabels:Record<string,Pair>={
  TRUSTED:['本地核验通过','Verified locally'],
  INSUFFICIENT_EVIDENCE:['证据不足','Insufficient evidence'],
  BUSINESS_FAILURE:['核验判定为业务失败','Business failure'],
  TAMPERED:['签名或内容被篡改','Tampered'],
  REVOKED:['已撤销','Revoked'],
  EXPIRED:['已过期','Expired'],
  POLICY_REJECTED:['不符合信任策略','Rejected by policy'],
  UNKNOWN:['未知状态','Unknown'],
};
export const verificationLevelLabels:Record<string,Pair>={
  UNVERIFIED:['未核验','Unverified'],
  SIGNATURE_ONLY:['签名有效，内容未复算','Signature only'],
  CONTENT_RECALCULATED:['内容复算通过（离线）','Content recalculated offline'],
  FULFILLMENT_RECALCULATED:['履约复算通过（离线，未上链）','Fulfillment recalculated offline'],
  CHAIN_CONFIRMED:['链上承诺已确认','Chain commitment confirmed'],
};
export const chainStateLabels:Record<string,Pair>={
  NOT_BOUND:['未绑定链上承诺','Not bound to an on-chain commitment'],
  BOUND:['已绑定链上承诺','Bound to an on-chain commitment'],
  CONFIRMED:['链上承诺已确认','On-chain commitment confirmed'],
  PENDING:['等待链上确认','Awaiting on-chain confirmation'],
  FAILED:['链上写入失败','On-chain write failed'],
  MISMATCH:['链上记录与凭证不一致','On-chain record does not match the attestation'],
};
export function labelOf(table:Record<string,Pair>,value:string,t:Translator){const pair=table[value];return pair?t(pair[0],pair[1]):value;}

export const exclusionLabels:Record<string,Pair>={
  TASK_CREATOR:['任务创建者本人','Task creator'],
  MISSING_SKILLS:['缺少所需能力','Missing required skills'],
  UNAVAILABLE:['当前离线或未上线','Offline or not yet active'],
  AT_CAPACITY:['已达到并发上限','At concurrency limit'],
  WORKER_NOT_ENABLED:['不在本轮执行名单','Not enabled for this round'],
  ALREADY_ASSIGNED:['已承担本任务其他步骤','Assigned to another step'],
  ROLE_MISMATCH:['角色不匹配','Role mismatch'],
  HEARTBEAT_MISSING:['尚未上线','No heartbeat yet'],
  HEARTBEAT_EXPIRED:['连接已过期','Heartbeat expired'],
  HEARTBEAT_IN_FUTURE:['连接时间异常','Invalid heartbeat time'],
  BUSY:['正在忙碌','Busy'],
  NOT_ADMITTED:['暂不可参与','Not admitted'],
  CONDITIONS_NOT_ACCEPTED:['尚未确认参与','Conditions not accepted'],
};
export function exclusionLabel(reason:string,t:Translator){return labelOf(exclusionLabels,reason,t);}

export const policyLabels:Record<string,Pair>={
  'csv-random-v1':['随机分配','Random assignment'],
  'csv-capability-v1':['按所需能力分配','By required capability'],
  'csv-role-reputation-v1':['按运行期履历分配','By runtime history'],
  'csv-worker-reputation-v2':['按运行期履历与执行状态分配','By runtime history and worker state'],
  'csv-verified-reputation-v1':['按可验证履约凭证分配','By verified fulfillment attestations'],
};
export function policyLabel(policy:string,t:Translator){return labelOf(policyLabels,policy,t);}

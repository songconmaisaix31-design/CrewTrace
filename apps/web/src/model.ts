import type { RunDetail, Role, RuntimeEvent } from '@co-vibe/contracts';
export const roles:Role[] = ['DATA','ANALYSIS','REPORT'];
export const roleName = {DATA:'数据整理',ANALYSIS:'统计分析',REPORT:'报告表达'};
export const stateName:Record<string,string> = {OPEN:'等待分工',ASSIGNED:'已分配',RUNNING:'执行中',SUBMITTED:'已提交，待验收',VERIFIED_PASS:'验收通过',VERIFIED_FAIL:'验收未通过',PENDING:'等待确认',CONFIRMED:'已确认',FAILED:'记录提交失败',ACCEPTED:'已接收',RETURNED:'已退回',ACTIVE:'可继续执行',PAUSED:'已暂停',CANCELLED:'已取消',WAITING_MANUAL:'等待人工处理',INTERRUPTED:'已中断'};
export const short = (s:string) => s.length > 20 ? `${s.slice(0,8)}…${s.slice(-6)}` : s;
export function currentDecision(run:RunDetail,role:Role) {
  const task=run.tasks.find(t=>t.role===role);
  return run.decisions.filter(d=>d.taskId===task?.taskId && d.attempt===task.attempt).sort((a,b)=>Date.parse(b.evaluatedAt)-Date.parse(a.evaluatedAt))[0];
}
export function mergeEvents(existing:RuntimeEvent[], incoming:RuntimeEvent[]) {
  return [...new Map([...existing,...incoming].map(e=>[e.eventId,e])).values()].sort((a,b)=>a.seq-b.seq).slice(-300);
}
export function completed(run:RunDetail) {
  return run.runtimeStatus!=='CANCELLED' && run.tasks.every(task=>task.status==='VERIFIED_PASS' && run.assessments.some(a=>a.taskId===task.taskId && a.attempt===task.attempt && a.verdict==='PASS' && a.receipt?.status==='CONFIRMED'));
}

export function runState(run:RunDetail) {
  if(run.runtimeStatus!=='ACTIVE')return run.runtimeStatus;
  return completed(run)?'VERIFIED_PASS':run.status==='VERIFIED_PASS'?'PENDING':run.status;
}

export function agentOnline(lastSeenAt:string|null,now=Date.now()) {
  if(!lastSeenAt)return false;
  const age=now-Date.parse(lastSeenAt);
  return age>=0&&age<=30000;
}

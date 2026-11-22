import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { CSV_WORKER_MODES, executeCsvCleanup, type CsvWorkerMode } from './csv-cleanup.ts';
import { CSV_RULE_VERSION, verifyCsvDelivery } from './csv-delivery.ts';
import { calculateReputation } from '../../services/runtime/src/domain/policy.ts';

const seed = 'crewtrace-v2-csv-2026-11-22';
const strategies = ['random', 'capability', 'reputation'] as const;
type Strategy = typeof strategies[number];
const workers = CSV_WORKER_MODES.map((mode, index) => ({
  id: `worker-${index + 1}`, mode, capabilities: mode === 'copy' ? ['csv'] : ['csv', 'csv-data-review'],
}));
function hash(key: string) {
  return createHash('sha256').update(`${seed}:${key}`).digest('hex');
}
function workload(phase: string, count: number) {
  return Array.from({length: count}, (_, index) => {
    const id = `${phase}-${index + 1}`;
    const pattern = Number.parseInt(hash(id).slice(0, 6), 16) % 3;
    const csv = ['record_id,amount_cents', pattern===1?' item-a ,12 ':'item-a,12', pattern===2?'item-a,12':'item-b,40'].join('\n')+'\n';
    return { id, csv, requiredSkill: 'csv-data-review' };
  });
}
function run(csv: string, mode: CsvWorkerMode) {
  return verifyCsvDelivery(executeCsvCleanup(csv, mode));
}
const history = workload('history', 12);
const tasks = workload('holdout', 30);
const historyRuns = workers.flatMap(worker=>history.map(task=>({
  worker:worker.id,task:task.id,status:run(task.csv,worker.mode).status,
})));
const priors = new Map(workers.map(worker=>{
  const pass = historyRuns.filter(record=>record.worker===worker.id&&record.status==='PASS').length;
  return [worker.id,calculateReputation(pass,history.length-pass)] as const;
}));

function evaluate(strategy: Strategy) {
  const attempts = tasks.map(task=>{
    const start = performance.now();
    const candidates = workers.filter(worker=>strategy==='random'||worker.capabilities.includes(task.requiredSkill));
    candidates.sort((a,b)=>{
      const difference = strategy==='reputation' ? priors.get(b.id)!-priors.get(a.id)! : 0;
      return difference || hash(`${task.id}:${a.id}`).localeCompare(hash(`${task.id}:${b.id}`));
    });
    const decisionMs = performance.now()-start;
    const results = [];
    for (const worker of candidates.slice(0,2)) {
      const result = run(task.csv,worker.mode);
      results.push({ worker:worker.id,status:result.status,contentHash:result.contentHash });
      if (result.status==='PASS') break;
    }
    return { task:task.id,decisionMs,elapsedMs:performance.now()-start,results };
  });
  const successes = attempts.filter(task=>task.results.at(-1)?.status==='PASS');
  const utilisation = Object.fromEntries(workers.map(worker=>[worker.id,attempts.flatMap(task=>task.results).filter(a=>a.worker===worker.id).length]));
  return { strategy, attempts, metrics: {
    firstAttemptAcceptance: attempts.filter(task=>task.results[0]?.status==='PASS').length/attempts.length,
    acceptance: successes.length/attempts.length,
    meanSuccessfulCompletionMs: successes.length?successes.reduce((sum,task)=>sum+task.elapsedMs,0)/successes.length:null,
    retryRate:attempts.filter(task=>task.results.length>1).length/attempts.length,
    meanAssignmentDecisionMs:attempts.reduce((sum,task)=>sum+task.decisionMs,0)/attempts.length,
    costPerSuccessfulTask:null,
    assignmentsByWorker:utilisation,
  }};
}

console.log(JSON.stringify({seed,ruleVersion:CSV_RULE_VERSION,history,tasks,workers,historyRuns,
  priorByWorker:Object.fromEntries(priors),results:strategies.map(evaluate),node:process.version},null,2));

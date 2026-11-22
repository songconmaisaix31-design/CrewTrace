import { createHash } from 'node:crypto';
import { executeCsvCleanup, type CsvWorkerMode } from './csv-cleanup.ts';
import { verifyCsvDelivery } from './csv-delivery.ts';
import { calculateReputation } from '../../services/runtime/src/domain/policy.ts';

const seed='crewtrace-load-v1-2026-11-22';
const lease=6,maxAttempts=3,horizon=180;
const strategies=['random','capability','reputation'] as const;
const workers=[
  {id:'copy',mode:'copy',skill:1,join:0,outages:[[16,32]]},
  {id:'standard',mode:'normalize',skill:2,join:0,outages:[[24,49]]},
  {id:'specialist',mode:'deduplicate',skill:3,join:0,outages:[[36,58]]},
  {id:'new-agent',mode:'deduplicate',skill:2,join:20,outages:[[71,80]]},
] as const satisfies ReadonlyArray<{id:string;mode:CsvWorkerMode;skill:number;join:number;outages:ReadonlyArray<readonly [number,number]>}>;
type Worker=typeof workers[number];
type Strategy=typeof strategies[number];
type Input={id:string;release:number;defect:string;csv:string};
type Attempt={taskId:string;workerId:string;started:number;finished:number;outcome:'PASS'|'FAIL'|'TIMEOUT';contentHash:string|null};

function draw(key:string,limit:number) {
  return createHash('sha256').update(`${seed}:${key}`).digest().readUInt32BE(0)%limit;
}
function makeInput(id:string,release:number,distribution:'mixed'|'dirty'):Input {
  const pick=draw(id,10);
  const defect=pick<(distribution==='mixed'?5:2)?'clean':pick<7?'spacing':'duplicate';
  const first=defect==='spacing'?' record-1 , 23 ':'record-1,23';
  return {id,release,defect,csv:`record_id,amount_cents\n${first}\n${defect==='duplicate'?'record-1,23':'record-2,71'}\n`};
}
function result(worker:Worker,input:Input) {
  return verifyCsvDelivery(executeCsvCleanup(input.csv,worker.mode));
}
const history=Array.from({length:16},(_,i)=>makeInput(`history-${i}`,0,'mixed'));
const training=workers.filter(worker=>worker.join===0).flatMap(worker=>history.map(input=>({
  workerId:worker.id,inputId:input.id,outcome:result(worker,input).status,
})));
const inputs=Array.from({length:60},(_,i)=>makeInput(`holdout-${i}`,Math.floor(i/3)*3,i<30?'mixed':'dirty'));
const online=(worker:Worker,tick:number)=>tick>=worker.join&&!worker.outages.some(([start,end])=>tick>=start&&tick<end);

function benchmark(strategy:Strategy) {
  const reputation=new Map(workers.map(worker=>[worker.id,{
    pass:training.filter(run=>run.workerId===worker.id&&run.outcome==='PASS').length,
    fail:training.filter(run=>run.workerId===worker.id&&run.outcome==='FAIL').length,
  }]));
  const tasks=inputs.map(input=>({input,done:false,attempts:[] as Attempt[]}));
  const active=new Map<string,{worker:Worker;task:typeof tasks[number];started:number;finish:number;interrupted:boolean}>();
  for(let tick=0;tick<=horizon;tick++){
    for(const [id,job] of active) {
      if(!online(job.worker,tick))job.interrupted=true;
      if(job.interrupted&&tick-job.started<lease||!job.interrupted&&tick<job.finish)continue;
      const checked=job.interrupted?null:result(job.worker,job.task.input);
      const outcome=checked?.status==='PASS'?'PASS':checked?'FAIL':'TIMEOUT';
      job.task.attempts.push({taskId:job.task.input.id,workerId:job.worker.id,started:job.started,finished:tick,outcome,contentHash:checked?.contentHash??null});
      const score=reputation.get(job.worker.id)!;
      if(outcome==='PASS')score.pass++;
      // 机器 FAIL 与运行失败均保持独立，实验信誉只从 PASS 反馈更新。
      if(outcome==='PASS'||job.task.attempts.length===maxAttempts)job.task.done=true;
      active.delete(id);
    }
    for(const task of tasks) {
      if(task.done||task.input.release>tick||[...active.values()].some(job=>job.task===task))continue;
      const available=workers.filter(worker=>online(worker,tick)&&!active.has(worker.id));
      const failed=(worker:Worker)=>task.attempts.filter(old=>old.workerId===worker.id).length;
      const score=(worker:Worker)=>{
        const past=reputation.get(worker.id)!;
        return strategy==='reputation'?calculateReputation(past.pass,past.fail):strategy==='capability'?worker.skill:0;
      };
      available.sort((a,b)=>failed(a)-failed(b)||score(b)-score(a)||
        draw(`${task.input.id}:${a.id}`,1_000_000)-draw(`${task.input.id}:${b.id}`,1_000_000)||a.id.localeCompare(b.id));
      const worker=available[0];
      if(worker)active.set(worker.id,{worker,task,started:tick,finish:tick+2+draw(`${task.input.id}:runtime:${worker.id}`,3),interrupted:false});
    }
  }
  const attempts=tasks.flatMap(task=>task.attempts);
  const passed=tasks.filter(task=>task.attempts.at(-1)?.outcome==='PASS');
  const byWorker=workers.map(worker=>{
    const owned=attempts.filter(attempt=>attempt.workerId===worker.id);
    const onlineTicks=Array.from({length:horizon+1},(_,tick)=>tick).filter(tick=>online(worker,tick)).length;
    const busyOnlineTicks=owned.reduce((total,attempt)=>total+
      Array.from({length:attempt.finished-attempt.started},(_,offset)=>attempt.started+offset).filter(tick=>online(worker,tick)).length,0);
    return {id:worker.id,attempts:owned.length,onlineTicks,busyOnlineTicks,utilization:busyOnlineTicks/onlineTicks};
  });
  return {strategy,metrics:{
    tasks:tasks.length,accepted:passed.length,firstPass:tasks.filter(task=>task.attempts[0]?.outcome==='PASS').length,
    retried:tasks.filter(task=>task.attempts.length>1).length,timeouts:attempts.filter(attempt=>attempt.outcome==='TIMEOUT').length,
    unfinished:tasks.filter(task=>!task.done).length,
    meanCompletionTicks:passed.length?passed.reduce((sum,task)=>sum+task.attempts.at(-1)!.finished-task.input.release,0)/passed.length:null,
    assignmentConcentration:byWorker.reduce((sum,worker)=>sum+(worker.attempts/attempts.length)**2,0),
    costPerSuccessfulTask:null,byWorker,
  },attempts};
}

console.log(JSON.stringify({seed,simulation:true,clockUnit:'tick',lease,maxAttempts,horizon,workers,history,training,inputs,
  runs:strategies.map(benchmark)},null,2));

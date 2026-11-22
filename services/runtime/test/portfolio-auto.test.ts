import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { executeCsvStep } from '../../../workers/src/csv-steps.ts';
import { migrate } from '../src/migrate.js';
import { createPortfolioTestSchema } from './portfolio-test-schema.js';
import { Application } from '../src/application.js';
import { createHttp } from '../src/http.js';
import { Database } from '../src/db.js';

test('独立 Worker 进程自动分工、拒收重派、重放提交和下一轮信誉',async()=>{
  await createPortfolioTestSchema();
  const {default:app,runtime}=await import('../src/index.js');
  await migrate(runtime.db);
  const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});
  if(!server.listening)await once(server,'listening');
  const address=server.address();
  assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  runtime.config.PUBLIC_BASE_URL=base;
  const mcp=new Client({name:'auto-workflow-verification',version:'1.0.0'});
  try {
    await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp',base)));
    async function api(path:string,credential?:string,body?:unknown,status=200) {
      const response=await fetch(base+'/api/collaboration'+path,{
        method:body===undefined?'GET':'POST',
        headers:{...(credential&&{Authorization:`Bearer ${credential}`}), 'Content-Type':'application/json'},
        body:body===undefined?undefined:JSON.stringify(body),
      });
      const record=await response.json();
      assert.equal(response.status,status,JSON.stringify(record));
      return record;
    }
    const join=(name:string,capabilities:string[])=>api('/agents',undefined,{name,capabilities},201);
    const owner=await join('Auto test owner',[]);
    const agents=await Promise.all([
      join('Auto inspector',['csv-source-inspection']),
      join('Auto cleaner A',['csv-data-review']),
      join('Auto cleaner B',['csv-data-review']),
      join('Auto reporter',['csv-evidence-report']),
    ]);
    runtime.config.EXPERIMENT_WORKER_AGENT_IDS=agents.map(agent=>agent.agent.agentId).join(',');
    await api('/csv-worker/poll',owner.credential,{},403);
    const input='record_id,amount_cents\n item-a , 10 \nitem-a,10\n';
    async function create(title:string,leaseSeconds=30){
      const task=await api('/tasks',owner.credential,{title,description:'Independent auto test',requiredCapabilities:['csv-data-review']},201);
      await api(`/tasks/${task.taskId}/csv-workflow`,owner.credential,{input,expectedVersion:task.version,mode:'AUTO',leaseSeconds},201);
      return task.taskId as string;
    }
    function work(agent: {credential:string}) {
      const path=fileURLToPath(new URL('../../../workers/',import.meta.url));
      const child=spawn(process.execPath,['--import','tsx','src/portfolio-worker.ts','--once'],{
        cwd:path,env:{PATH:process.env.PATH,CREWTRACE_WORKER_RUNTIME:base,CREWTRACE_WORKER_CREDENTIAL:agent.credential},
      });
      return once(child,'exit').then(([code])=>assert.equal(code,0));
    }
    async function step(taskId:string,role:string){
      for(let attempt=0;attempt<5;attempt++){
        await Promise.all(agents.map(work));
        const task=await api(`/tasks/${taskId}`);
        const claim=task.claims.find((value:{scope:string;status:string})=>value.scope===role&&value.status==='ACTIVE');
        const handoff=task.handoffs.find((value:{claimId:string;status:string})=>value.claimId===claim?.claimId&&value.status==='SUBMITTED');
        if(handoff)return {claim,handoff};
      }
      assert.fail('Workers did not produce expected delivery');
    }
    const review=(handoff:{handoffId:string;version:number},status:string,credential=owner.credential,http=200)=>
      api(`/handoffs/${handoff.handoffId}/review`,credential,{expectedVersion:handoff.version,status,reason:'Observed test review'},http);
    const taskId=await create('Automatic dispatch test');
    const first=await step(taskId,'csv-source-inspection');
    await review(first.handoff,'ACCEPTED');
    const initial=await step(taskId,'csv-data-review');
    await review(initial.handoff,'RETURNED');
    const rerouted=await step(taskId,'csv-data-review');
    assert.notEqual(rerouted.claim.agentId,initial.claim.agentId);
    const assignee=agents.find(agent=>agent.agent.agentId===rerouted.claim.agentId)!;
    await review(rerouted.handoff,'ACCEPTED',assignee.credential,403);
    const repeat={claimId:rerouted.claim.claimId,requestId:rerouted.claim.claimId,content:executeCsvStep('csv-data-review',input)};
    assert.equal((await api(`/tasks/${taskId}/handoffs`,assignee.credential,repeat,201)).handoffId,rerouted.handoff.handoffId);
    await review(rerouted.handoff,'ACCEPTED');
    await review(rerouted.handoff,'ACCEPTED',owner.credential,409);
    const report=await step(taskId,'csv-evidence-report');
    await review(report.handoff,'ACCEPTED');
    const terminal=await api(`/tasks/${taskId}`);
    assert.equal(terminal.status,'COMPLETED');
    assert.equal(new Set(terminal.claims.filter((claim:{status:string})=>claim.status==='COMPLETED').map((claim:{agentId:string})=>claim.agentId)).size,3);
    const {records}=await api(`/tasks/${taskId}/evidence`);
    assert.equal(records.filter((entry:{reputationOutcome:string})=>entry.reputationOutcome==='PASS').length,1);
    assert.equal((await api(`/handoffs/${rerouted.handoff.handoffId}/csv-replay`)).matches,true);
    assert.ok((await api(`/events?taskId=${taskId}`)).events.some((event:{type:string})=>event.type==='CSV_WORKFLOW_COMPLETED'));
    const next=await create('Automatic dispatch uses new history',5);
    const inspection=await step(next,'csv-source-inspection');
    await review(inspection.handoff,'ACCEPTED');
    // 调度已提交到数据库，但暂不启动获选清洗进程。
    await api('/csv-worker/poll',agents[0].credential,{});
    const saved=await api(`/tasks/${next}/matching`);
    assert.equal(saved.selectedAgentId,rerouted.claim.agentId);
    assert.equal(saved.candidates.find((candidate:{agentId:string})=>candidate.agentId===saved.selectedAgentId).passed,1);
    const beforeTimeout=await api(`/tasks/${next}/csv-workflow`);
    const oldClaim=beforeTimeout.attempts.find((attempt:{step:string})=>attempt.step==='csv-data-review');
    const recoveredDb=new Database(runtime.config.DATABASE_URL);
    try {
      const recovered=createHttp(new Application(recoveredDb,runtime.config,null,null));
      const read=await recovered.request(`${base}/api/collaboration/tasks/${next}/csv-workflow`);
      assert.equal(read.status,200);
      assert.deepEqual((await read.json() as typeof beforeTimeout).attempts,beforeTimeout.attempts);
    } finally { await recoveredDb.close(); }
    await delay(5200);
    await api('/csv-worker/poll',agents[0].credential,{});
    await api(`/tasks/${next}/handoffs`,assignee.credential,{...repeat,claimId:oldClaim.claimId,requestId:oldClaim.claimId},409);
    const afterTimeout=await api(`/tasks/${next}/csv-workflow`);
    assert.ok(afterTimeout.attempts.some((attempt:{claimId:string;failure:string})=>attempt.claimId===oldClaim.claimId&&attempt.failure==='TIMEOUT'));
    const result=await mcp.callTool({name:'get_csv_collaboration_workflow',arguments:{taskId:next}});
    assert.notEqual(result.isError,true);
    await review((await step(next,'csv-data-review')).handoff,'ACCEPTED');
    await review((await step(next,'csv-evidence-report')).handoff,'ACCEPTED');
    const failed=await create('Automatic retries exhaust cleanly');
    for(let attempt=1;attempt<=3;attempt++){
      const {job}=await api('/csv-worker/poll',agents[0].credential,{});
      assert.equal(job.taskId,failed);
      assert.equal(job.attempt,attempt);
      await api(`/claims/${job.claimId}/worker-failure`,agents[0].credential,{});
    }
    const failedRun=await api(`/tasks/${failed}/csv-workflow`);
    assert.equal(failedRun.failedStep,'csv-source-inspection');
    assert.equal(failedRun.attempts.length,3);
    assert.equal((await api(`/tasks/${failed}/evidence`)).records.length,0);
  } finally {
    await mcp.close();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await runtime.db.close();
  }
});

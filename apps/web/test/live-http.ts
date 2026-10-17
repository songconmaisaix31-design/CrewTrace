import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { keccak256 } from 'viem';
import { AgentsResponseSchema, AnnouncementsResponseSchema, ArtifactSchema, AssignmentDecisionSchema, EventsResponseSchema, RunDetailSchema, RunSchema } from '@co-vibe/contracts';
import { gateway } from '../server/gateway.ts';
import { HealthSchema } from '../src/api.ts';
import { completed, currentDecision, runState } from '../src/model.ts';

for(const name of ['RUNTIME_URL','ADMIN_TOKEN','DEMO_ACCESS_CODE','VALIDATOR_ADDRESS'])assert(process.env[name],`需要真实服务配置 ${name}`);

async function withGateway(action:(base:string)=>Promise<void>) {
  const server=createServer((req,res)=>void gateway(req,res));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert(address&&typeof address==='object');
  const base=`http://127.0.0.1:${address.port}/api/web`;
  try { await action(base); }
  finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
}

async function get(base:string,path:string) {
  const response=await fetch(`${base}?path=${encodeURIComponent(path)}`,{signal:AbortSignal.timeout(45000)});
  assert.equal(response.status,200,`${path}: HTTP ${response.status}`);
  return response;
}

test('真实服务：代理授权、固定原文、创建与刷新查询，最后实际取消',async()=>{
  await withGateway(async base=>{
    const health=HealthSchema.parse(await (await get(base,'/health')).json());
    assert.equal(health.database,'connected');
    const agents=AgentsResponseSchema.parse(await (await get(base,'/api/agents')).json());
    assert(agents.agents.length>=4);
    const criteria=new Uint8Array(await (await get(base,'/api/criteria')).arrayBuffer());
    const originalCriteria=await fetch(new URL('/api/criteria',process.env.RUNTIME_URL));assert.equal(originalCriteria.status,200);
    assert.deepEqual(criteria,new Uint8Array(await originalCriteria.arrayBuffer()));
    const status=await fetch(`${base}?action=status`);
    const statusText=await status.text();
    for(const secret of [process.env.ADMIN_TOKEN!,process.env.DEMO_ACCESS_CODE!])assert(!statusText.includes(secret));
    const denied=await fetch(`${base}?path=%2Fapi%2Fruns`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:randomUUID(),sample:'round-1'})});
    assert.equal(denied.status,403);
    const source=new Uint8Array(readFileSync(new URL('../../../workers/fixtures/round-1.csv',import.meta.url)));
    const directDenied=await fetch(new URL('/api/runs',process.env.RUNTIME_URL),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:randomUUID(),inputContent:new TextDecoder('utf-8',{fatal:true}).decode(source),inputHash:keccak256(source),criteriaHash:keccak256(criteria),validator:process.env.VALIDATOR_ADDRESS})});
    assert.equal(directDenied.status,403);
    const runId=randomUUID();
    let created=false;
    try {
      const response=await fetch(`${base}?path=%2Fapi%2Fruns`,{method:'POST',headers:{'Content-Type':'application/json','X-Demo-Code':process.env.DEMO_ACCESS_CODE!},body:JSON.stringify({runId,sample:'round-1'})});
      assert.equal(response.status,201,`创建 HTTP ${response.status}`);
      created=true;
      const run=RunSchema.parse(await response.json());
      assert.equal(run.runId,runId);assert.notEqual(run.status,'VERIFIED_PASS');
      assert.equal(run.validator,process.env.VALIDATOR_ADDRESS!.toLowerCase());
      assert.equal(run.criteriaHash,keccak256(criteria));
      const input=new Uint8Array(await (await get(base,`/api/runs/${runId}/input`)).arrayBuffer());
      assert.deepEqual(input,source);assert.equal(run.inputHash,keccak256(input));
      const detail=RunDetailSchema.parse(await (await get(base,`/api/runs/${runId}`)).json());
      assert.equal(detail.runId,runId);assert.equal(completed(detail),false);assert.notEqual(runState(detail),'VERIFIED_PASS');
      const events=EventsResponseSchema.parse(await (await get(base,`/api/runs/${runId}/events?after=0`)).json());
      assert(events.events.some(event=>event.type==='RUN_CREATED'));
      console.log(JSON.stringify({runtime:process.env.RUNTIME_URL,runId,status:detail.status,chainWritable:health.chain.writable}));
    } finally {
      if(created){
        const cancelled=await fetch(new URL(`/admin/runs/${runId}/cancel`,process.env.RUNTIME_URL),{method:'POST',headers:{Authorization:`Bearer ${process.env.ADMIN_TOKEN}`},signal:AbortSignal.timeout(45000)});
        assert.equal(cancelled.status,200,'必须通过真实管理端点取消验证运行');
        const detail=RunDetailSchema.parse(await (await get(base,`/api/runs/${runId}`)).json());
        assert.equal(detail.runtimeStatus,'CANCELLED');assert.equal(runState(detail),'CANCELLED');
      }
    }
  });
});

test('真实已完成两轮：共享类型、快照、公告、交接、回执和原始文件逐项核对',async()=>{
  const ids=process.env.LIVE_RUN_IDS?.split(',');assert(ids&&ids.length===2,'LIVE_RUN_IDS 必须包含两轮真实运行');
  await withGateway(async base=>{
    const runs=[];
    for(const id of ids){
      const run=RunDetailSchema.parse(await (await get(base,`/api/runs/${encodeURIComponent(id)}`)).json());
      assert.equal(run.runId,id);assert(completed(run));assert.equal(runState(run),'VERIFIED_PASS');
      assert(run.taskReceipts.length>=9);assert(run.handoffs.length>=2);
      const events=EventsResponseSchema.parse(await (await get(base,`/api/runs/${id}/events?after=0`)).json());
      assert(events.events.length>0);assert(events.events.every(event=>event.runId===id));
      const notes=AnnouncementsResponseSchema.parse(await (await get(base,`/api/announcements?runId=${id}`)).json());
      assert(notes.announcements.length>0);assert(notes.announcements.every(note=>note.runId===id));
      const input=new Uint8Array(await (await get(base,`/api/runs/${id}/input`)).arrayBuffer());
      assert.equal(keccak256(input),run.inputHash);
      for(const decision of run.decisions){
        const original=await get(base,`/api/decisions/${decision.decisionId}`);
        const bytes=new Uint8Array(await original.arrayBuffer());
        assert.equal(keccak256(bytes),decision.decisionHash);
        assert.deepEqual(AssignmentDecisionSchema.parse({...JSON.parse(new TextDecoder().decode(bytes)),decisionHash:keccak256(bytes)}),decision);
      }
      for(const artifact of run.artifacts){
        const path=`/api/artifacts/${encodeURIComponent(artifact.artifactId)}`;
        const original=await get(base,path);const bytes=new Uint8Array(await original.arrayBuffer());
        assert.equal(keccak256(bytes),artifact.contentHash);assert.equal(original.headers.get('x-content-hash'),artifact.contentHash);
        assert.deepEqual(ArtifactSchema.parse(await (await get(base,`${path}/metadata`)).json()),artifact);
        const product=JSON.parse(new TextDecoder().decode(bytes));
        for(const file of product.files){
          const response=await get(base,`${path}/files/${file.name}`);const content=new Uint8Array(await response.arrayBuffer());
          assert.equal(keccak256(content),file.contentHash);assert.equal(new TextDecoder().decode(content),file.content);
          assert.equal(response.headers.get('x-content-hash'),file.contentHash);
        }
      }
      for(const assessment of run.assessments){
        const bytes=new Uint8Array(await (await get(base,`/api/tasks/${assessment.taskId}/assessments/${assessment.attempt}/evidence`)).arrayBuffer());
        assert.equal(keccak256(bytes),assessment.evidenceHash);
      }
      runs.push(run);
      console.log(JSON.stringify({runId:id,artifacts:run.artifacts.length,decisions:run.decisions.length,announcements:notes.announcements.length,receipts:run.taskReceipts.length}));
    }
    for(const role of ['DATA','ANALYSIS','REPORT'] as const){
      const first=currentDecision(runs[0],role),second=currentDecision(runs[1],role);assert(first&&second);
      assert(BigInt(second.repBlockNumber)>BigInt(first.repBlockNumber));
      assert(second.candidateScores.some(candidate=>candidate.sampleSize>0));
    }
  });
});

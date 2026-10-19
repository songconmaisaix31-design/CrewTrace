import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve} from '@hono/node-server';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import app,{runtime} from '../src/index.js';
import {Database} from '../src/db.js';

async function tool(client:Client,name:string,args:Record<string,unknown>,errorCode?:string) {
  const response=await client.callTool({name,arguments:args},undefined,{timeout:45_000});
  const content=response.content as {type:string;text?:string}[];
  const data=JSON.parse(content.find(item=>item.type==='text')!.text!);
  if(errorCode) {assert.equal(response.isError,true,name);assert.equal(data.error.code,errorCode,name);}
  else assert.notEqual(response.isError,true,`${name} 应当成功${data.error?`：${data.error.code}`:''}`);
  return data;
}

test('官方 MCP 发现并执行 MOCK 悬赏编辑、分工、退回重交、完成与释放取消',{timeout:240_000},async()=>{
  const startedAt=new Date().toISOString(),key=startedAt.replaceAll(':','-');
  const dbURL=new URL(runtime.config.DATABASE_URL);
  dbURL.searchParams.set('options',`${dbURL.searchParams.get('options')??''} -c default_transaction_read_only=on`);
  const db=new Database(dbURL.href);
  const clients:Client[]=[];
  let server:ReturnType<typeof serve>|undefined;
  const privateDir=new URL('../.local/collaboration/bounty/',import.meta.url);
  await mkdir(privateDir,{recursive:true});
  try {
    const settings=(await db.pool.query("SELECT current_schema() AS schema,current_setting('transaction_read_only') AS readonly")).rows[0];
    assert.equal(settings.schema,'b_public_collaboration_test_20261017','仅使用独立测试 schema');
    assert.equal(settings.readonly,'on');
    server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});
    if(!server.listening)await new Promise(resolve=>server!.once('listening',resolve));
    const address=server.address();assert.ok(address && typeof address!=='string');
    const base=`http://127.0.0.1:${address.port}`;
    runtime.config.PUBLIC_BASE_URL=base;runtime.config.PUBLIC_MCP_URL=`${base}/mcp`;
    const connect=async(name:string)=>{
      const client=new Client({name,version:'1.0.0'});clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      return client;
    };
    const A=await connect('crewtrace-bounty-author'),B=await connect('crewtrace-bounty-executor');
    const tools=(await A.listTools()).tools;
    const names=['create_collaboration_task','update_collaboration_task','list_collaboration_tasks','get_collaboration_task',
      'propose_collaboration_assignment','decide_collaboration_assignment','claim_collaboration_task',
      'release_collaboration_claim','submit_collaboration_handoff','review_collaboration_handoff'];
    for(const name of names)assert.ok(tools.find(item=>item.name===name)?.description?.includes('悬赏'),name);
    const prompt=await A.getPrompt({name:'crewtrace_collaboration'});
    const text=prompt.messages.map(message=>message.content.type==='text'?message.content.text:'').join('\n');
    assert.equal((await tool(B,'get_collaboration_guide',{})).text,text);
    for(const required of [...names,'bountyMON','MOCK','CANCELLED','RETURNED','COMPLETED','Claim.version','Handoff.version','nextOffset'])assert.ok(text.includes(required),required);
    const first=await tool(A,'join_collaboration',{name:`本地悬赏验收-作者-${key}`});
    const secrets:Record<string,string>={author:first.credential};
    await writeFile(new URL(`${key}-credentials.json`,privateDir),JSON.stringify(secrets),{mode:0o600});
    const second=await tool(B,'join_collaboration',{name:`本地悬赏验收-执行者-${key}`});secrets.executor=second.credential;
    await writeFile(new URL(`${key}-credentials.json`,privateDir),JSON.stringify(secrets),{mode:0o600});
    assert.notEqual(first.agent.agentId,second.agent.agentId);
    const author=(name:string,args:Record<string,unknown>,error?:string)=>tool(A,name,{...args,credential:secrets.author},error);
    const executor=(name:string,args:Record<string,unknown>,error?:string)=>tool(B,name,{...args,credential:secrets.executor},error);
    const details=(taskId:string)=>tool(B,'get_collaboration_task',{taskId});
    const task=await author('create_collaboration_task',{request:{title:`本地悬赏验收-${key}-工具目录核对`,description:'读取真实 MCP 与 HTTP 工具目录，逐项比较悬赏工具名称与说明，交付实际核对结果。',bountyMON:'1.25'}});
    assert.equal(task.bountyMode,'MOCK');assert.equal(task.bountyMON,'1.25');
    await executor('update_collaboration_task',{taskId:task.taskId,request:{expectedVersion:task.version,bountyMON:'9'}},'UNAUTHORIZED');
    const edited=await author('update_collaboration_task',{taskId:task.taskId,request:{expectedVersion:task.version,bountyMON:'2.50'}});
    assert.equal(edited.bountyMON,'2.50');
    await author('update_collaboration_task',{taskId:task.taskId,request:{expectedVersion:task.version,bountyMON:'3'}},'VERSION_CONFLICT');
    const listed=await tool(B,'list_collaboration_tasks',{status:'OPEN',limit:100,offset:0});
    assert.ok(listed.tasks.some((item:{taskId:string;bountyMON:string})=>item.taskId===task.taskId&&item.bountyMON==='2.50'));
    const scope='核对本次实际 HTTP 与 MCP 悬赏工具名称和说明';
    const proposal=await executor('propose_collaboration_assignment',{taskId:task.taskId,request:{agentId:second.agent.agentId,scope}});
    await author('decide_collaboration_assignment',{proposalId:proposal.proposalId,request:{expectedVersion:proposal.version,status:'APPROVED'}});
    const claim=await executor('claim_collaboration_task',{taskId:task.taskId,request:{expectedVersion:(await details(task.taskId)).version,scope,proposalId:proposal.proposalId}});
    const observed=(await B.listTools()).tools.filter(item=>names.includes(item.name)).map(({name,description})=>({name,description}));
    const incomplete=await executor('submit_collaboration_handoff',{taskId:task.taskId,request:{claimId:claim.claimId,content:JSON.stringify({observedAt:new Date().toISOString(),mcpTools:observed})}});
    await author('review_collaboration_handoff',{handoffId:incomplete.handoffId,request:{expectedVersion:incomplete.version,status:'RETURNED',reason:'已收到真实 MCP 工具记录，请补充 HTTP 工具目录的独立读取和逐项比较。'}});
    const directory=await fetch(`${base}/api/collaboration/tools`).then(response=>{assert.equal(response.status,200);return response.json();});
    const httpTools=directory.tools.filter((item:{name:string})=>names.includes(item.name)).map(({name,description}:{name:string;description:string})=>({name,description}));
    assert.deepEqual(httpTools,observed);
    const content=JSON.stringify({observedAt:new Date().toISOString(),mcpTools:observed,httpTools,equal:true});
    const handoff=await executor('submit_collaboration_handoff',{taskId:task.taskId,request:{claimId:claim.claimId,content,artifactURI:null}});
    assert.notEqual(handoff.handoffId,incomplete.handoffId);
    const authorRead=await tool(A,'get_collaboration_task',{taskId:task.taskId});
    assert.equal(authorRead.handoffs.find((item:{handoffId:string})=>item.handoffId===handoff.handoffId).content,content);
    const authorDirectory=await fetch(`${base}/api/collaboration/tools`).then(response=>response.json());
    assert.deepEqual(authorDirectory.tools.filter((item:{name:string})=>names.includes(item.name)).map(({name,description}:{name:string;description:string})=>({name,description})),httpTools);
    await executor('review_collaboration_handoff',{handoffId:handoff.handoffId,request:{expectedVersion:handoff.version,status:'ACCEPTED'}},'UNAUTHORIZED');
    await author('review_collaboration_handoff',{handoffId:handoff.handoffId,request:{expectedVersion:handoff.version,status:'ACCEPTED'}});
    const completed=await author('update_collaboration_task',{taskId:task.taskId,request:{expectedVersion:(await details(task.taskId)).version,status:'COMPLETED'}});
    assert.equal(completed.status,'COMPLETED');assert.equal(completed.bountyMode,'MOCK');assert.equal(completed.bountyMON,'2.50');
    await author('update_collaboration_task',{taskId:task.taskId,request:{expectedVersion:completed.version,bountyMON:'4'}},'INVALID_STATE');
    const cancelledTask=await author('create_collaboration_task',{request:{title:`本地悬赏验收-${key}-状态记录`,description:'记录真实本地协作元数据与读取时间。',bountyMON:'0.75'}});
    const directClaim=await executor('claim_collaboration_task',{taskId:cancelledTask.taskId,request:{expectedVersion:cancelledTask.version,scope:'读取实际协作元数据'}});
    await author('update_collaboration_task',{taskId:cancelledTask.taskId,request:{expectedVersion:(await details(cancelledTask.taskId)).version,status:'CANCELLED'}},'INVALID_STATE');
    const metadata=await fetch(`${base}/api/collaboration`).then(response=>response.json());
    assert.equal(metadata.bountyMode,'MOCK');assert.equal(metadata.commitmentRecording,'UNDECIDED');
    const pending=await executor('submit_collaboration_handoff',{taskId:cancelledTask.taskId,request:{claimId:directClaim.claimId,content:JSON.stringify(metadata)}});
    await executor('release_collaboration_claim',{claimId:directClaim.claimId,request:{expectedVersion:directClaim.version}},'INVALID_STATE');
    await author('review_collaboration_handoff',{handoffId:pending.handoffId,request:{expectedVersion:pending.version,status:'RETURNED',reason:'本次状态记录缺少读取时间；结束本次验收任务，不再要求补充，请本人释放认领。'}});
    const released=await executor('release_collaboration_claim',{claimId:directClaim.claimId,request:{expectedVersion:directClaim.version}});
    assert.equal(released.status,'RELEASED');
    const cancelled=await author('update_collaboration_task',{taskId:cancelledTask.taskId,request:{expectedVersion:(await details(cancelledTask.taskId)).version,status:'CANCELLED'}});
    assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.bountyMode,'MOCK');
    const events:any[]=[];
    for(const taskId of [task.taskId,cancelledTask.taskId]) {
      const page=await tool(A,'get_collaboration_events',{taskId,limit:100});assert.equal(page.hasMore,false);
      const stored=(await db.pool.query('SELECT event_id,seq,document FROM collaboration_events WHERE task_id=$1 ORDER BY seq',[taskId])).rows;
      assert.equal(page.events.length,stored.length);
      for(const event of page.events) {
        const rows=(await db.pool.query('SELECT seq,document FROM collaboration_events WHERE event_id=$1',[event.eventId])).rows;
        assert.equal(rows.length,1);assert.deepEqual({...rows[0].document,seq:Number(rows[0].seq)},event);
      }
      events.push(...page.events);
      const persisted=(await db.pool.query('SELECT document FROM collaboration_tasks WHERE id=$1',[taskId])).rows[0].document;
      const viaHTTP=await fetch(`${base}/api/collaboration/tasks/${taskId}`).then(response=>response.json());
      assert.equal(persisted.status,viaHTTP.status);assert.equal(persisted.bountyMode,'MOCK');
    }
    const result={startedAt,finishedAt:new Date().toISOString(),schema:settings.schema,agents:[first.agent.agentId,second.agent.agentId],completed,cancelled,events,toolDescriptions:observed,readOnlyDatabaseVerification:true,realPayments:0,chainWrites:0};
    const serialized=JSON.stringify(result,null,2);for(const secret of Object.values(secrets))assert.ok(!serialized.includes(secret),'报告不能包含凭证');
    await writeFile(new URL(`${key}-result.json`,privateDir),serialized);
    console.log(JSON.stringify({schema:settings.schema,completedTask:completed.taskId,cancelledTask:cancelled.taskId,eventCount:events.length,realPayments:0,chainWrites:0,resultFile:`.local/collaboration/bounty/${key}-result.json`}));
  } finally {
    for(const client of clients)await client.close();
    if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));
    await db.close();await runtime.db.close();
  }
});

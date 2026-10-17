import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hashUtf8, nodeBindingMessage, type Run } from '../../../packages/contracts/src/index.ts';
import { CRITERIA_HASH,CRITERIA_BYTES } from '../../../workers/src/criteria.ts';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { Application } from '../src/service.js';
import { createHttp } from '../src/http.js';
import type { Config } from '../src/config.js';

test('真实 PostgreSQL、HTTP 与官方 MCP Client', async () => {
  assert.ok(process.env.DATABASE_URL, '真实 DATABASE_URL 必须配置');
  const db = new Database(process.env.DATABASE_URL);
  await migrate(db);
  const config: Config = { DATABASE_URL: process.env.DATABASE_URL, ADMIN_TOKEN: randomBytes(32).toString('hex'), PUBLIC_BASE_URL: 'http://127.0.0.1:3000', PORT: 0, ALLOWED_ORIGINS: '', CHAIN_ID: 10143, COLLABORATION_CHAIN_ID: 10143, COLLABORATION_CHAIN_EXPLORER: 'https://testnet.monadscan.com', COLLABORATION_CHAIN_TIMEOUT_MS: 15000 };
  const http = createHttp(new Application(db,config));
  const server = serve({ fetch: http.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening',resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  config.PUBLIC_BASE_URL = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: 'co-vibe-official-client-test',version: '1.0.0' });
  try {
    const response = await fetch(`${config.PUBLIC_BASE_URL}/health`);
    assert.equal(response.status,200);
    assert.equal((await response.json()).database,'connected');
    await client.connect(new StreamableHTTPClientTransport(new URL(`${config.PUBLIC_BASE_URL}/mcp`)));
    assert.equal(client.getServerVersion()?.name,'co-vibe-runtime');
    const tools = await client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === 'health'));
    const result = await client.callTool({ name: 'health',arguments: {} });
    assert.notEqual(result.isError,true);
  } finally {
    await client.close();
    await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
    await db.close();
  }
});

async function startProcess(adminToken: string) {
  const started = performance.now();
  const processHandle = spawn(process.execPath,['--import','tsx','src/local.ts'],{
    cwd: new URL('..',import.meta.url),
    env: { ...process.env,TSX_DISABLE_CACHE: '1',ADMIN_TOKEN: adminToken,PUBLIC_BASE_URL: 'http://127.0.0.1:3000',PORT: '0' },
    stdio: ['ignore','pipe','pipe'],windowsHide: true,
  });
  const output = createInterface({ input: processHandle.stdout });
  const url = await new Promise<string>((resolve,reject)=>{
    const timeout = setTimeout(()=>{ processHandle.kill(); reject(new Error('服务进程未在 20 秒内启动')); },20_000);
    processHandle.once('error',reject);
    processHandle.once('exit',code=>{ clearTimeout(timeout); reject(new Error(`服务提前终止 ${code}`)); });
    output.once('line',line=>{
      clearTimeout(timeout);
      const event = JSON.parse(line);
      assert.equal(event.event,'listening');
      console.log(JSON.stringify({ event: 'cold-start',pid: processHandle.pid,elapsedMs: Math.round(performance.now()-started),cacheDisabled: true }));
      resolve(event.url);
    });
  });
  return { processHandle,url };
}

async function stopProcess(processHandle: ChildProcess) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  const exited = new Promise<void>(resolve=>processHandle.once('exit',()=>resolve()));
  processHandle.kill();
  await exited;
}

test('真实进程重启、身份权限、便签并发、事件增量和 MCP 写入', { timeout: 180_000 }, async () => {
  assert.ok(process.env.DATABASE_URL);
  const adminToken = randomBytes(32).toString('hex');
  let running = await startProcess(adminToken);
  const db = new Database(process.env.DATABASE_URL);
  const runIds = [randomUUID(),randomUUID(),randomUUID()];
  const accounts = [privateKeyToAccount(generatePrivateKey()),privateKeyToAccount(generatePrivateKey())];
  const nodeTokens: string[] = [];
  const runtimes = [randomUUID(),randomUUID()];
  let mcp: Client | undefined;
  const request = async (path: string,method='GET',body?: unknown,token?: string) => fetch(`${running.url}${path}`,{
    method,headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),...(body !== undefined ? { 'Content-Type':'application/json' } : {}) },
    body: body===undefined ? undefined : JSON.stringify(body),signal: AbortSignal.timeout(20_000),
  });
  const json = async (path: string,method='GET',body?: unknown,token?: string,status=200) => {
    const response = await request(path,method,body,token);
    const result = await response.json();
    assert.equal(response.status,status,JSON.stringify(result));
    return result;
  };
  try {
    for (const [index,account] of accounts.entries()) {
      const profile = { agentId: account.address.toLowerCase(),runtimeId: runtimes[index],roles: ['DATA'],manifestURI: `urn:co-vibe:controlled-test:${runtimes[index]}`,manifestHash: hashUtf8(runtimes[index]),lastSeenAt: null,activeTasks: 0,maxConcurrency: 1,admitted: true,conditionsAccepted: true };
      const signature = await account.signMessage({ message: nodeBindingMessage(profile as Parameters<typeof nodeBindingMessage>[0]) });
      const registered = await json('/admin/nodes','POST',{ profile,signature },adminToken,201);
      nodeTokens.push(registered.token);
    }
    const profile = { agentId: accounts[0].address.toLowerCase(),runtimeId: randomUUID(),roles: ['DATA'],manifestURI: 'urn:co-vibe:wrong-signature',manifestHash: hashUtf8('wrong signature test'),lastSeenAt: null,activeTasks: 0,maxConcurrency: 1,admitted: true,conditionsAccepted: true };
    const signature = await accounts[1].signMessage({ message: nodeBindingMessage(profile as Parameters<typeof nodeBindingMessage>[0]) });
    await json('/admin/nodes','POST',{ profile,signature },adminToken,403);
    await json('/worker/heartbeat','POST',{ runtimeId: runtimes[0],activeTasks: 0,maxConcurrency: 1 },nodeTokens[0]);
    await json('/worker/heartbeat','POST',{ runtimeId: runtimes[1],activeTasks: 0,maxConcurrency: 1 },nodeTokens[0],403);
    await json('/worker/jobs','GET',undefined,undefined,403);
    await json('/worker/jobs','GET',undefined,'invalid-node-credential',401);
    await json('/worker/progress','POST',{},undefined,403);
    await json('/worker/progress','POST',{},adminToken,403);
    await json('/worker/progress','POST',{ runId: runIds[0] },nodeTokens[0],400);
    await json('/worker/progress','POST',{},nodeTokens[0],503);
    const agents = await json('/api/agents');
    assert.ok(agents.agents.find((agent: any)=>agent.agentId===accounts[0].address.toLowerCase()).lastSeenAt);
    const source = 'record_id,date,category,sales_yuan,orders\r\n'+Array.from({ length: 30 },(_,index)=>`${index+1},2026-10-17,controlled,${index+1}.00,1`).join('\r\n')+'\r\n';
    const makeRun = (runId: string)=>({ runId,inputContent: source,inputHash: hashUtf8(source),criteriaHash: CRITERIA_HASH,validator: accounts[1].address.toLowerCase() });
    assert.equal((await json('/api/template')).criteriaHash,CRITERIA_HASH);
    assert.deepEqual(Buffer.from(await (await request('/api/criteria')).arrayBuffer()),CRITERIA_BYTES);
    await json('/api/runs','POST',makeRun(runIds[0]),undefined,403);
    const run: Run = await json('/api/runs','POST',makeRun(runIds[0]),adminToken,201);
    const detail = await json(`/api/runs/${run.runId}`);
    assert.equal(detail.runId,run.runId);
    assert.deepEqual(detail.tasks,run.tasks);
    for (const field of ['decisions','handoffs','artifacts','assessments','taskReceipts']) assert.deepEqual(detail[field],[]);
    await json(`/api/runs/${randomUUID()}`,'GET',undefined,undefined,404);
    await json(`/api/runs/${randomUUID()}/events?after=0`,'GET',undefined,undefined,404);
    await json('/api/runs','POST',makeRun(runIds[1]),adminToken,201);
    await json('/api/runs','POST',makeRun(runIds[2]),adminToken,429);
    assert.equal(await (await request(`/api/runs/${run.runId}/input`)).text(),source);
    const taskId = run.tasks[0].taskId;
    await json(`/admin/tasks/${taskId}/assign`,'POST',{ chainId: 10143 },adminToken,503);
    await json(`/admin/tasks/${taskId}/assess`,'POST',{},adminToken,503);
    const message = { runId: run.runId,taskId,topic: 'controlled progress',body: '真实 PostgreSQL 权限与重启检查',type: 'PROGRESS' };
    await json('/api/announcements','POST',message,undefined,403);
    await json('/api/announcements','POST',{ ...message,author: accounts[1].address },nodeTokens[0],400);
    const announcement = await json('/api/announcements','POST',message,nodeTokens[0],201);
    assert.equal(announcement.author,accounts[0].address.toLowerCase());
    const note = await json('/api/notes','POST',{ runId: run.runId,taskId,topic: '交接说明',body: '下游请读取原始文件并核对摘要',artifactIds: [] },nodeTokens[0],201);
    const update = { expectedVersion: 1,topic: '已更新交接',body: '实际并发更新',artifactIds: [] };
    await json(`/api/notes/${note.noteId}`,'PATCH',update,nodeTokens[1],403);
    const parallel = await Promise.all([request(`/api/notes/${note.noteId}`,'PATCH',update,nodeTokens[0]),request(`/api/notes/${note.noteId}`,'PATCH',update,nodeTokens[0])]);
    assert.deepEqual(parallel.map(response=>response.status).sort(),[200,409]);
    const rejected = parallel.find(response=>response.status===409)!;
    assert.equal((await rejected.json()).error.code,'VERSION_CONFLICT');
    const current = await json(`/api/notes/${note.noteId}`);
    assert.equal(current.version,2);
    assert.equal(current.versions.length,2);
    const events = await json(`/api/runs/${run.runId}/events?after=0`);
    assert.ok(events.events.length>=4);
    assert.ok(events.events.every((event: any,index: number)=>index===0 || event.seq>events.events[index-1].seq));
    const cursor = events.nextAfter;
    assert.equal((await json(`/api/runs/${run.runId}/events?after=${cursor}`)).events.length,0);
    const emptyPage = await json(`/api/runs/${run.runId}/events?after=${Number.MAX_SAFE_INTEGER}`);
    assert.deepEqual(emptyPage,{ events: [],nextAfter: Number.MAX_SAFE_INTEGER });
    mcp = new Client({ name: 'controlled-node-official-client',version: '1.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${running.url}/mcp`),{ requestInit: { headers: { Authorization: `Bearer ${nodeTokens[1]}` } } }));
    const tools = await mcp.listTools();
    for (const name of ['publish_announcement','list_announcements','create_note','get_note','update_note','get_jobs','update_handoff','advance_work']) assert.ok(tools.tools.some(tool=>tool.name===name));
    const unavailable = CallToolResultSchema.parse(await mcp.callTool({ name: 'advance_work',arguments: {} }));
    assert.equal(unavailable.isError,true);
    assert.ok(unavailable.content.some(content=>content.type==='text' && JSON.parse(content.text).error.code==='CHAIN_NOT_CONFIGURED'));
    const published = await mcp.callTool({ name: 'publish_announcement',arguments: { ...message,body: '官方 MCP Client 实际发布公告' } });
    assert.notEqual(published.isError,true,JSON.stringify(published));
    const listed = await mcp.callTool({ name: 'list_announcements',arguments: { runId: run.runId,taskId } });
    assert.notEqual(listed.isError,true);
    const forbidden = await mcp.callTool({ name: 'update_note',arguments: { noteId: note.noteId,request: { ...update,expectedVersion: 2 } } });
    assert.equal(forbidden.isError,true);
    const delta = await json(`/api/runs/${run.runId}/events?after=${cursor}`);
    assert.equal(delta.events.length,1);
    assert.equal(delta.events[0].type,'ANNOUNCEMENT_PUBLISHED');
    const databaseIds = await db.pool.query('SELECT event_id FROM events WHERE run_id=$1',[run.runId]);
    for (const event of [...events.events,...delta.events]) assert.ok(databaseIds.rows.some(row=>row.event_id===event.eventId));
    await mcp.close(); mcp=undefined;
    console.log('restart: stopping first service process');
    await stopProcess(running.processHandle);
    console.log('restart: starting second service process');
    running = await startProcess(adminToken);
    console.log('restart: second service process listening');
    const persistedNote = await json(`/api/notes/${note.noteId}`);
    assert.equal(persistedNote.version,2);
    assert.equal(persistedNote.versions.length,2);
    assert.equal((await json(`/api/announcements?runId=${run.runId}&taskId=${taskId}`)).announcements.length,2);
    assert.equal((await json(`/api/runs/${run.runId}`)).tasks.length,3);
    assert.equal((await json(`/api/runs/${run.runId}/events?after=${cursor}`)).events.length,1);
    await json('/worker/heartbeat','POST',{ runtimeId: runtimes[0],activeTasks: 0,maxConcurrency: 1 },nodeTokens[0]);
    const rotated = await json(`/admin/nodes/${accounts[0].address.toLowerCase()}/rotate`,'POST',{},adminToken);
    await json('/worker/heartbeat','POST',{ runtimeId: runtimes[0],activeTasks: 0,maxConcurrency: 1 },nodeTokens[0],401);
    await json('/worker/heartbeat','POST',{ runtimeId: runtimes[0],activeTasks: 0,maxConcurrency: 1 },rotated.token);
    await json(`/admin/runs/${runIds[0]}/cancel`,'POST',{},adminToken);
    await json('/api/runs','POST',makeRun(runIds[2]),adminToken,201);
  } finally {
    if (mcp) await mcp.close();
    await stopProcess(running.processHandle);
    await db.transaction(async client=>{
      await client.query('DELETE FROM note_versions WHERE note_id IN (SELECT id FROM notes WHERE run_id=ANY($1::text[]))',[runIds]);
      for (const table of ['notes','announcements','events','decisions','handoffs','model_calls'] as const) await client.query(`DELETE FROM ${table} WHERE run_id=ANY($1::text[])`,[runIds]);
      await client.query('DELETE FROM tasks WHERE run_id=ANY($1::text[])',[runIds]);
      await client.query('DELETE FROM runs WHERE id=ANY($1::text[])',[runIds]);
      await client.query('DELETE FROM node_credentials WHERE agent_id=ANY($1::text[])',[accounts.map(account=>account.address.toLowerCase())]);
      await client.query('DELETE FROM agents WHERE id=ANY($1::text[])',[accounts.map(account=>account.address.toLowerCase())]);
    });
    await db.close();
  }
});

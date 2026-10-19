import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {z} from 'zod';
import type {PoolClient} from '@neondatabase/serverless';
import {Database} from '../db.js';

const inputSchema=z.strictObject({
  schema:z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  agents:z.array(z.strictObject({agentId:z.uuid(),expectedName:z.string().min(1),source:z.string().min(1)})).min(1),
});
const tables=['collaboration_agents','collaboration_tasks','collaboration_messages','collaboration_notes','collaboration_note_versions',
  'collaboration_proposals','collaboration_claims','collaboration_handoffs','collaboration_events','collaboration_credentials'] as const;
type Table=typeof tables[number];
type Row=Record<string,any>;
type State=Record<Table,Row[]>;

async function readState(client:PoolClient):Promise<State> {
  const state={} as State;
  for(const table of tables) {
    if(table==='collaboration_credentials')state[table]=(await client.query(`SELECT agent_id AS id,count(*)::int AS total,
      count(*) FILTER (WHERE revoked_at IS NULL)::int AS active,count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked
      FROM collaboration_credentials GROUP BY agent_id ORDER BY agent_id`)).rows;
    else if(table==='collaboration_events')state[table]=(await client.query('SELECT event_id AS id,seq,actor_id,task_id,document FROM collaboration_events ORDER BY seq')).rows;
    else if(table==='collaboration_note_versions')state[table]=(await client.query("SELECT note_id || ':' || version::text AS id,note_id,version,document FROM collaboration_note_versions ORDER BY note_id,version")).rows;
    else state[table]=(await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  }
  return state;
}

function selection(state:State,input:z.infer<typeof inputSchema>) {
  const selected={} as State;
  for(const table of tables)selected[table]=[];
  const blockers:string[]=[];
  const agents=new Set(input.agents.map(agent=>agent.agentId));
  assert.equal(agents.size,input.agents.length,'输入身份重复');
  for(const expected of input.agents) {
    const current=state.collaboration_agents.find(row=>row.id===expected.agentId);
    if(!current || current.document.name!==expected.expectedName)blockers.push(`身份不存在或准确名称不符: ${expected.agentId}`);
  }
  selected.collaboration_agents=state.collaboration_agents.filter(row=>agents.has(row.id));
  selected.collaboration_credentials=state.collaboration_credentials.filter(row=>agents.has(row.id));
  selected.collaboration_tasks=state.collaboration_tasks.filter(row=>agents.has(row.author_id));
  const ids=(table:Table)=>new Set(selected[table].map(row=>row.id));
  const tasks=ids('collaboration_tasks');
  const allowedTask=(id:string|null)=>id===null || tasks.has(id);
  const requireOwned=(condition:boolean,table:Table,row:Row)=>{if(!condition)blockers.push(`存在清单之外的身份或业务关系: ${table}/${row.id}`);};
  for(const row of state.collaboration_tasks)if(tasks.has(row.id) || tasks.has(row.parent_task_id) || agents.has(row.assignee_id)) {
    const ownedAssignee=row.assignee_id==null || agents.has(row.assignee_id);
    requireOwned(agents.has(row.author_id)&&allowedTask(row.parent_task_id)&&ownedAssignee,'collaboration_tasks',row);
  }
  for(const table of ['collaboration_messages','collaboration_notes'] as const) {
    selected[table]=state[table].filter(row=>agents.has(row.author_id)||tasks.has(row.task_id));
    for(const row of selected[table])requireOwned(agents.has(row.author_id)&&allowedTask(row.task_id),table,row);
  }
  const notes=ids('collaboration_notes');
  selected.collaboration_note_versions=state.collaboration_note_versions.filter(row=>notes.has(row.note_id));
  for(const row of selected.collaboration_note_versions)requireOwned(agents.has(row.document.author),'collaboration_note_versions',row);
  selected.collaboration_proposals=state.collaboration_proposals.filter(row=>agents.has(row.author_id)||tasks.has(row.task_id)||agents.has(row.document.agentId));
  for(const row of selected.collaboration_proposals)requireOwned(agents.has(row.author_id)&&agents.has(row.document.agentId)&&tasks.has(row.task_id),'collaboration_proposals',row);
  const proposals=ids('collaboration_proposals');
  selected.collaboration_claims=state.collaboration_claims.filter(row=>agents.has(row.agent_id)||tasks.has(row.task_id)||proposals.has(row.proposal_id));
  for(const row of selected.collaboration_claims)requireOwned(agents.has(row.agent_id)&&tasks.has(row.task_id)&&(row.proposal_id===null||proposals.has(row.proposal_id)),'collaboration_claims',row);
  const claims=ids('collaboration_claims');
  selected.collaboration_handoffs=state.collaboration_handoffs.filter(row=>agents.has(row.author_id)||tasks.has(row.task_id)||claims.has(row.claim_id));
  for(const row of selected.collaboration_handoffs)requireOwned(agents.has(row.author_id)&&tasks.has(row.task_id)&&claims.has(row.claim_id),'collaboration_handoffs',row);
  const references:Record<string,Set<string>>={agentId:agents,taskId:tasks,noteId:notes,proposalId:proposals,claimId:claims,
    messageId:ids('collaboration_messages'),handoffId:ids('collaboration_handoffs')};
  const touchesEvent=(row:Row)=>Object.entries(row.document.data).some(([key,value])=>references[key]?.has(value as string));
  selected.collaboration_events=state.collaboration_events.filter(row=>agents.has(row.actor_id)||tasks.has(row.task_id)||touchesEvent(row));
  for(const row of selected.collaboration_events) {
    const ownedReferences=Object.entries(row.document.data).every(([key,value])=>!references[key]||references[key].has(value as string));
    requireOwned(agents.has(row.actor_id)&&allowedTask(row.task_id)&&ownedReferences,'collaboration_events',row);
  }
  const eventSeqs=new Set(selected.collaboration_events.map(row=>String(row.seq)));
  for(const row of selected.collaboration_messages)requireOwned(eventSeqs.has(String(row.seq)),'collaboration_messages',row);
  const messages=ids('collaboration_messages');
  for(const row of state.collaboration_messages)if(eventSeqs.has(String(row.seq)))requireOwned(messages.has(row.id),'collaboration_messages',row);
  return {selected,blockers};
}

const count=(table:Table,rows:Row[])=>table==='collaboration_credentials'?rows.reduce((total,row)=>total+row.total,0):rows.length;
function privatePath(path:string) {
  const absolute=resolve(path),inside=relative(resolve('.local'),absolute);
  if(!inside || inside.startsWith('..') || isAbsolute(inside))throw new Error('维护输入和报告必须位于当前工作目录的 .local 内');
  return absolute;
}

const {values}=parseArgs({options:{input:{type:'string'},report:{type:'string'},execute:{type:'boolean',default:false}}});
assert.ok(values.input && values.report && process.env.DATABASE_URL,'需要 --input、--report 和 DATABASE_URL');
const input=inputSchema.parse(JSON.parse(await readFile(privatePath(values.input),'utf8')));
const reportPath=privatePath(values.report);
await mkdir(dirname(reportPath),{recursive:true});
const db=new Database(process.env.DATABASE_URL);
try {
  const result=await db.transaction(async client=>{
    if(!values.execute)await client.query('SET TRANSACTION READ ONLY');
    const schema=(await client.query('SELECT current_schema() AS schema')).rows[0].schema;
    assert.equal(schema,input.schema,'数据库 schema 与明确清单不符');
    const foreign=(await client.query(`SELECT source.relname AS source,source_namespace.nspname AS source_schema,target.relname AS target FROM pg_constraint c
      JOIN pg_class source ON source.oid=c.conrelid JOIN pg_class target ON target.oid=c.confrelid
      JOIN pg_namespace source_namespace ON source_namespace.oid=source.relnamespace
      JOIN pg_namespace n ON n.oid=target.relnamespace
      WHERE c.contype='f' AND n.nspname=current_schema() AND target.relname=ANY($1::text[])`,[tables])).rows;
    const before=await readState(client);
    const {selected,blockers}=selection(before,input);
    for(const relation of foreign)if(relation.source_schema!==schema || !tables.includes(relation.source))blockers.push(`存在维护范围之外的外键: ${relation.source_schema}.${relation.source} -> ${relation.target}`);
    const counts=Object.fromEntries(tables.map(table=>[table,count(table,selected[table])]));
    const retainedAgents=before.collaboration_agents.filter(row=>!selected.collaboration_agents.some(candidate=>candidate.id===row.id));
    const plan={schema,createdAt:new Date().toISOString(),mode:values.execute?'execute':'preview',sources:input.agents,
      blockers,counts,retainedAgentCount:retainedAgents.length,retainedAgentIds:retainedAgents.map(row=>row.id),selected};
    await writeFile(`${reportPath}.before.json`,JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});
    if(blockers.length)throw new Error(`清理被阻止，${blockers.length} 项关系需要人工核对；详见私有 before 报告`);
    const deleted:Record<string,number>={};
    if(values.execute) {
      const order:Table[]=['collaboration_handoffs','collaboration_claims','collaboration_proposals','collaboration_note_versions',
        'collaboration_notes','collaboration_messages','collaboration_events','collaboration_tasks','collaboration_credentials','collaboration_agents'];
      for(const table of order) {
        const column=table==='collaboration_note_versions'?'note_id':table==='collaboration_events'?'event_id':table==='collaboration_credentials'?'agent_id':'id';
        const keys=table==='collaboration_note_versions'?selected.collaboration_notes.map(row=>row.id):selected[table].map(row=>row.id);
        const removed=await client.query(`DELETE FROM ${table} WHERE ${column}=ANY($1::text[])`,[keys]);
        assert.equal(removed.rowCount,counts[table],`${table} 删除计数不符`);deleted[table]=removed.rowCount!;
      }
      const after=await readState(client);
      for(const table of tables) {
        const removedIds=new Set(selected[table].map(row=>row.id));
        assert.deepEqual(after[table],before[table].filter(row=>!removedIds.has(row.id)),`${table} 保留记录发生变化`);
      }
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    }
    return {schema,mode:plan.mode,completedAt:new Date().toISOString(),targetAgentIds:input.agents.map(agent=>agent.agentId),
      counts,deleted,retainedAgentCount:retainedAgents.length,retainedAgentIds:plan.retainedAgentIds,preservedOtherRecords:true,beforeFile:`${reportPath}.before.json`};
  },values.execute);
  await writeFile(reportPath,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({reportPath,...result}));
} finally {await db.close();}

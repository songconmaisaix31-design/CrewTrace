import type { Hono } from 'hono';
import { z } from 'zod';
import { CollaborationCommitmentKeySchema, CollaborationIdSchema } from '../../../packages/contracts/src/index.ts';
import type { Application } from './application.js';
import { admin,type Principal } from './auth.js';
import { Collaboration } from './collaboration.js';
import { collaborationTools } from './collaboration-tools.js';
import { publicMcpURL } from './config.js';
import { snapshotMatching } from './experiment-matching.js';

export function mountCollaboration(http: Hono<{Variables:{principal:Principal}}>,app: Application) {
  const service=new Collaboration(app),prefix='/api/collaboration';
  const id=(value:string)=>CollaborationIdSchema.parse(value);
  http.get(prefix,async c=>{
    await app.db.pool.query('SELECT 1');
    const chain=app.collaborationChain?.info??{configured:false,chainId:null,contract:null,explorer:null};
    return c.json({status:'ok',database:'connected',registration:'public',automaticMatching:false,bountyMode:'MOCK',commitmentRecording:chain.configured?'MONAD_TESTNET':'UNDECIDED',commitmentChain:chain,mcpURL:publicMcpURL(app.config),toolsURL:`${app.config.PUBLIC_BASE_URL}${prefix}/tools`});
  });
  http.get(`${prefix}/tools`,c=>c.json({mcpURL:publicMcpURL(app.config),tools:collaborationTools(app,{kind:'public'}).map(tool=>({name:tool.name,description:tool.description,inputSchema:z.toJSONSchema(tool.schema,{io:'input'})}))}));
  http.post(`${prefix}/agents`,async c=>c.json(await service.register(await c.req.json()),201));
  http.get(`${prefix}/agents`,async c=>c.json(await service.agents(c.req.query())));
  http.get(`${prefix}/agents/me`,async c=>c.json(await service.identity(c.get('principal'))));
  http.patch(`${prefix}/agents/me`,async c=>c.json(await service.updateAgent(c.get('principal'),await c.req.json())));
  http.post(`${prefix}/agents/me/heartbeat`,async c=>{z.strictObject({}).parse(await c.req.json());return c.json(await service.heartbeat(c.get('principal')));});
  http.post(`${prefix}/credentials/rotate`,async c=>{z.strictObject({}).parse(await c.req.json());return c.json(await service.rotate(c.get('principal')));});
  http.get(`${prefix}/agents/:id`,async c=>c.json(await service.agent(id(c.req.param('id')))));
  http.get(`${prefix}/tasks`,async c=>c.json(await service.tasks(c.req.query())));
  http.post(`${prefix}/tasks`,async c=>c.json(await service.createTask(c.get('principal'),await c.req.json()),201));
  http.get(`${prefix}/tasks/:id`,async c=>c.json(await service.taskDetails(id(c.req.param('id')))));
  http.get(`${prefix}/tasks/:id/matching`,async c=>{
    const taskId=id(c.req.param('id'));
    await service.task(taskId);
    const {rows}=await app.db.pool.query('SELECT document FROM experiment_matching_decisions WHERE task_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[taskId]);
    return c.json(rows[0]?.document??null);
  });
  http.post(`${prefix}/tasks/:id/matching`,async c=>c.json(await snapshotMatching(service,c.get('principal'),id(c.req.param('id'))),201));
  http.get(`${prefix}/tasks/:id/evidence`,async c=>{
    const taskId=id(c.req.param('id'));
    await service.task(taskId);
    const {rows}=await app.db.pool.query(`SELECT h.id AS "handoffId", e.role, e.document AS result, e.checked_at AS "checkedAt",
      r.outcome AS "reputationOutcome"
      FROM experiment_csv_evidence e JOIN collaboration_handoffs h ON h.id=e.handoff_id
      LEFT JOIN experiment_reputation_events r ON r.handoff_id=e.handoff_id
      WHERE h.task_id=$1 ORDER BY e.checked_at,h.id`, [taskId]);
    return c.json({ records: rows });
  });
  http.patch(`${prefix}/tasks/:id`,async c=>c.json(await service.updateTask(c.get('principal'),id(c.req.param('id')),await c.req.json())));
  http.get(`${prefix}/messages`,async c=>c.json(await service.messages(c.req.query())));
  http.post(`${prefix}/messages`,async c=>c.json(await service.publishMessage(c.get('principal'),await c.req.json()),201));
  http.get(`${prefix}/notes`,async c=>c.json(await service.notes(c.req.query())));
  http.post(`${prefix}/notes`,async c=>c.json(await service.createNote(c.get('principal'),await c.req.json()),201));
  http.get(`${prefix}/notes/:id`,async c=>c.json(await service.note(id(c.req.param('id')))));
  http.patch(`${prefix}/notes/:id`,async c=>c.json(await service.updateNote(c.get('principal'),id(c.req.param('id')),await c.req.json())));
  http.post(`${prefix}/tasks/:id/proposals`,async c=>c.json(await service.propose(c.get('principal'),id(c.req.param('id')),await c.req.json()),201));
  http.post(`${prefix}/proposals/:id/decision`,async c=>c.json(await service.decide(c.get('principal'),id(c.req.param('id')),await c.req.json())));
  http.post(`${prefix}/tasks/:id/claims`,async c=>c.json(await service.claim(c.get('principal'),id(c.req.param('id')),await c.req.json()),201));
  http.post(`${prefix}/claims/:id/release`,async c=>c.json(await service.release(c.get('principal'),id(c.req.param('id')),await c.req.json())));
  http.post(`${prefix}/tasks/:id/handoffs`,async c=>c.json(await service.submitHandoff(c.get('principal'),id(c.req.param('id')),await c.req.json()),201));
  http.post(`${prefix}/handoffs/:id/review`,async c=>c.json(await service.reviewHandoff(c.get('principal'),id(c.req.param('id')),await c.req.json())));
  http.get(`${prefix}/events`,async c=>c.json(await service.events(c.req.query())));
  http.get(`${prefix}/commitments`,async c=>c.json(await service.commitments(c.req.query('taskId'))));
  http.get(`${prefix}/commitments/:key`,async c=>c.json(await service.commitment(CollaborationCommitmentKeySchema.parse(c.req.param('key')))));
  http.post(`${prefix}/commitments/reconcile`,async c=>{
    admin(c.get('principal'));
    const {limit}=z.strictObject({limit:z.coerce.number().int().min(1).max(50).default(10)}).parse(await c.req.json());
    return c.json(await service.reconcile(limit));
  });
}

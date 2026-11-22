import { randomBytes,randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  CollaborationAgentSchema,RegisterCollaborationAgentRequestSchema,RegisterCollaborationAgentResponseSchema,
  CollaborationIdSchema,
  UpdateCollaborationAgentRequestSchema,RotateCollaborationCredentialResponseSchema,
  CollaborationAgentsResponseSchema,CollaborationPageQuerySchema,CollaborationTasksQuerySchema,
  CollaborationTaskSchema,CollaborationTaskDetailSchema,CreateCollaborationTaskRequestSchema,UpdateCollaborationTaskRequestSchema,CollaborationTasksResponseSchema,
  CollaborationMessageSchema,PublishCollaborationMessageRequestSchema,CollaborationMessagesResponseSchema,CollaborationCursorQuerySchema,
  CollaborationNoteSchema,CollaborationNoteDetailSchema,CreateCollaborationNoteRequestSchema,UpdateCollaborationNoteRequestSchema,CollaborationNotesResponseSchema,CollaborationNotesQuerySchema,
  CollaborationAssignmentProposalSchema,ProposeCollaborationAssignmentRequestSchema,DecideCollaborationAssignmentRequestSchema,
  CollaborationClaimSchema,ClaimCollaborationTaskRequestSchema,ReleaseCollaborationClaimRequestSchema,
  CollaborationHandoffSchema,SubmitCollaborationHandoffRequestSchema,ReviewCollaborationHandoffRequestSchema,
  CollaborationEventSchema,CollaborationEventsResponseSchema,type CollaborationTask,
  type CollaborationCommitmentKind,
} from '../../../packages/contracts/src/index.ts';
import type { Application } from './application.js';
import { tokenHash,type Principal } from './auth.js';
import { AppError,requireValue } from './errors.js';
import { CollaborationStore,collaborator,expectedVersion,sameCollaborator } from './collaboration-store.js';
import { CSV_ROLE,replayCsvDelivery,verifyCsvDelivery } from '../../../workers/src/csv-delivery.ts';
import { acceptedStep, csvWorkflowInput, CSV_STEPS, CSV_WORKFLOW_VERSION, evidenceReport, inspectSource, normalizedDelivery, sameDelivery, workflow } from './csv-workflow.js';
import { rankAndSave } from './experiment-matching.js';


export class Collaboration {
  readonly store: CollaborationStore;
  constructor(readonly app: Application) {this.store=new CollaborationStore(app);}

  private async anchor(kind: CollaborationCommitmentKind,recordId: string,taskId: string|null,version: number,document: Record<string,unknown>) {
    if (!this.app.collaborationChain) return;
    try { await this.app.collaborationChain.commit({ kind,recordId,taskId,version,document }); }
    catch (error) { console.error(`协作链写入失败 ${kind}:${recordId}:${version}`,error instanceof Error?error.message:error); }
  }

  async register(input: unknown) {
    const request=RegisterCollaborationAgentRequestSchema.parse(input),credential=randomBytes(32).toString('base64url');
    const now=new Date().toISOString();
    const agent=CollaborationAgentSchema.parse({...request,agentId:randomUUID(),version:1,createdAt:now,updatedAt:now,lastSeenAt:null});
    await this.app.store.write(async client=>{
      await client.query('INSERT INTO collaboration_agents(id,document) VALUES($1,$2)',[agent.agentId,agent]);
      await client.query('INSERT INTO collaboration_credentials(token_hash,agent_id) VALUES($1,$2)',[tokenHash(credential),agent.agentId]);
      await this.store.event(client,'AGENT_REGISTERED',agent.agentId,null,{agentId:agent.agentId});
    });
    await this.anchor('AGENT',agent.agentId,null,agent.version,agent);
    return RegisterCollaborationAgentResponseSchema.parse({agent,credential});
  }

  agent(agentId: string) {return this.store.record('collaboration_agents',agentId,CollaborationAgentSchema);}
  identity(principal: Principal) {return this.agent(collaborator(principal).agentId);}

  async agents(input: unknown) {
    const {limit,offset}=CollaborationPageQuerySchema.parse(input);
    const rows=(await this.app.db.pool.query('SELECT document FROM collaboration_agents ORDER BY created_at,id LIMIT $1 OFFSET $2',[limit+1,offset])).rows;
    return CollaborationAgentsResponseSchema.parse({agents:rows.slice(0,limit).map(row=>row.document),nextOffset:rows.length>limit?offset+limit:null});
  }

  async updateAgent(principal: Principal,input: unknown) {
    const request=UpdateCollaborationAgentRequestSchema.parse(input);
    const agent=await this.store.write(principal,async(client,actor)=>{
      const current=await this.store.record('collaboration_agents',actor,CollaborationAgentSchema,client);
      expectedVersion(current.version,request.expectedVersion);
      const {expectedVersion:_version,...fields}=request;
      const agent=CollaborationAgentSchema.parse({...current,...fields,version:current.version+1,updatedAt:new Date().toISOString()});
      await client.query('UPDATE collaboration_agents SET document=$2 WHERE id=$1',[actor,agent]);
      await this.store.event(client,'AGENT_UPDATED',actor,null,{agentId:actor,version:agent.version});
      return agent;
    });
    await this.anchor('AGENT',agent.agentId,null,agent.version,agent);
    return agent;
  }

  async heartbeat(principal: Principal) {
    return this.store.write(principal,async(client,actor)=>{
      const row=requireValue((await client.query("UPDATE collaboration_agents SET document=jsonb_set(document,'{lastSeenAt}',to_jsonb($2::text)) WHERE id=$1 RETURNING document",[actor,new Date().toISOString()])).rows[0]);
      return CollaborationAgentSchema.parse(row.document);
    });
  }

  async rotate(principal: Principal) {
    return this.store.write(principal,async(client,actor)=>{
      const credential=randomBytes(32).toString('base64url');
      await client.query('UPDATE collaboration_credentials SET revoked_at=now() WHERE agent_id=$1 AND revoked_at IS NULL',[actor]);
      await client.query('INSERT INTO collaboration_credentials(token_hash,agent_id) VALUES($1,$2)',[tokenHash(credential),actor]);
      return RotateCollaborationCredentialResponseSchema.parse({credential});
    });
  }

  task(taskId: string,client: Pick<PoolClient,'query'> = this.app.db.pool) {return this.store.record('collaboration_tasks',taskId,CollaborationTaskSchema,client);}
  private active(task: CollaborationTask) {
    if (!['OPEN','IN_PROGRESS'].includes(task.status)) throw new AppError(409,'INVALID_STATE','任务已经结束');
  }
  private async saveTask(client: PoolClient,task: CollaborationTask) {
    await client.query('UPDATE collaboration_tasks SET document=$2,version=$3 WHERE id=$1',[task.taskId,CollaborationTaskSchema.parse(task),task.version]);
  }
  async tasks(input: unknown) {
    const {limit,offset,status,parentTaskId}=CollaborationTasksQuerySchema.parse(input);
    const rows=(await this.app.db.pool.query("SELECT document FROM collaboration_tasks WHERE ($1::text IS NULL OR document->>'status'=$1) AND ($2::text IS NULL OR parent_task_id=$2) ORDER BY created_at DESC,id LIMIT $3 OFFSET $4",[status??null,parentTaskId??null,limit+1,offset])).rows;
    return CollaborationTasksResponseSchema.parse({tasks:rows.slice(0,limit).map(row=>row.document),nextOffset:rows.length>limit?offset+limit:null});
  }
  async taskDetails(taskId: string) {
    const row=requireValue((await this.app.db.pool.query(`SELECT t.document,
      ARRAY(SELECT document FROM collaboration_proposals WHERE task_id=t.id ORDER BY created_at,id) AS proposals,
      ARRAY(SELECT document FROM collaboration_claims WHERE task_id=t.id ORDER BY created_at,id) AS claims,
      ARRAY(SELECT document FROM collaboration_handoffs WHERE task_id=t.id ORDER BY created_at,id) AS handoffs
      FROM collaboration_tasks t WHERE t.id=$1`,[taskId])).rows[0]);
    return CollaborationTaskDetailSchema.parse({...row.document,proposals:row.proposals,claims:row.claims,handoffs:row.handoffs});
  }
  async createTask(principal: Principal,input: unknown) {
    const request=CreateCollaborationTaskRequestSchema.parse(input);
    const task=await this.store.write(principal,async(client,actor)=>{
      if(request.parentTaskId) {
        const parent=await this.task(request.parentTaskId,client);this.active(parent);
        if(parent.creator!==actor && !(await client.query("SELECT id FROM collaboration_claims WHERE task_id=$1 AND agent_id=$2 AND document->>'status'='ACTIVE'",[parent.taskId,actor])).rowCount) throw new AppError(403,'UNAUTHORIZED','创建子任务需要参与父任务');
      }
      const now=new Date().toISOString();
      await this.app.demo.reserveCollaborationTask(client,actor,new Date(now));
      const task=CollaborationTaskSchema.parse({...request,taskId:randomUUID(),creator:actor,status:'OPEN',version:1,createdAt:now,updatedAt:now});
      await client.query('INSERT INTO collaboration_tasks(id,author_id,parent_task_id,version,document) VALUES($1,$2,$3,$4,$5)',[task.taskId,actor,task.parentTaskId,task.version,task]);
      await this.store.event(client,'TASK_CREATED',actor,task.taskId,{taskId:task.taskId});return task;
    });
    await this.anchor('TASK',task.taskId,task.taskId,task.version,task);
    return task;
  }
  async updateTask(principal: Principal,taskId: string,input: unknown) {
    const request=UpdateCollaborationTaskRequestSchema.parse(input);
    const task=await this.store.write(principal,async(client,actor)=>{
      const current=await this.task(taskId,client);sameCollaborator(actor,current.creator);expectedVersion(current.version,request.expectedVersion);this.active(current);
      if(request.status && ['OPEN','COMPLETED','CANCELLED'].includes(request.status)) {
        if(request.status==='COMPLETED' && await workflow(client,taskId) && !await acceptedStep(client,taskId,'csv-evidence-report')) {
          throw new AppError(409,'INVALID_STATE','CSV 工作流仍有未验收步骤');
        }
        if((await client.query("SELECT id FROM collaboration_claims WHERE task_id=$1 AND document->>'status'='ACTIVE'",[taskId])).rowCount) throw new AppError(409,'INVALID_STATE','任务仍有有效认领，请先完成交接或释放');
        if(['COMPLETED','CANCELLED'].includes(request.status) && (await client.query("SELECT id FROM collaboration_tasks WHERE parent_task_id=$1 AND document->>'status' IN ('OPEN','IN_PROGRESS')",[taskId])).rowCount) throw new AppError(409,'INVALID_STATE','子任务尚未结束');
        if(request.status==='COMPLETED' && !(await client.query("SELECT id FROM collaboration_claims WHERE task_id=$1 AND document->>'status'='COMPLETED'",[taskId])).rowCount) throw new AppError(409,'INVALID_STATE','任务尚无已接受的成果交接');
      }
      const {expectedVersion:_version,...fields}=request;
      const task=CollaborationTaskSchema.parse({...current,...fields,version:current.version+1,updatedAt:new Date().toISOString()});
      await this.saveTask(client,task);await this.store.event(client,'TASK_UPDATED',actor,taskId,{version:task.version,status:task.status});return task;
    });
    await this.anchor('TASK',task.taskId,task.taskId,task.version,task);
    return task;
  }

  async createCsvWorkflow(principal: Principal,taskId: string,input: unknown) {
    const request=csvWorkflowInput.parse(input);
    normalizedDelivery(request.input);
    const leaseSeconds=this.app.config.PUBLIC_DEPLOYMENT?Math.min(request.leaseSeconds,this.app.config.DEMO_WORKER_LEASE_SECONDS):request.leaseSeconds;
    return this.store.write(principal,async(client,actor)=>{
      const task=await this.task(taskId,client);
      sameCollaborator(actor,task.creator);
      expectedVersion(task.version,request.expectedVersion);
      if(task.status!=='OPEN'||await workflow(client,taskId)||(await client.query('SELECT id FROM collaboration_claims WHERE task_id=$1 LIMIT 1',[taskId])).rowCount) {
        throw new AppError(409,'INVALID_STATE','CSV 工作流只能在尚未认领的开放任务配置一次');
      }
      await client.query('INSERT INTO experiment_csv_workflows(task_id,input_csv,lease_seconds,version,mode) VALUES($1,$2,$3,$4,$5)',[taskId,request.input,leaseSeconds,CSV_WORKFLOW_VERSION,request.mode]);
      await this.saveTask(client,{...task,version:task.version+1,updatedAt:new Date().toISOString()});
      await this.store.event(client,'CSV_WORKFLOW_CONFIGURED',actor,taskId,{version:CSV_WORKFLOW_VERSION,mode:request.mode,source:JSON.parse(inspectSource(request.input))});
      return {taskVersion:task.version+1,steps:CSV_STEPS,version:CSV_WORKFLOW_VERSION,mode:request.mode};
    });
  }

  async csvWorkflow(taskId: string) {
    await this.task(taskId);
    return this.app.db.transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const plan=await workflow(client,taskId);
      if(!plan)return null;
      const {rows}=await client.query(`SELECT a.step, a.attempt, a.claim_id AS "claimId", a.expires_at AS "expiresAt",
        a.decision_id AS "decisionId", a.failure_code AS failure,
        c.agent_id AS "agentId", c.version AS "claimVersion",
        CASE WHEN a.expired_at IS NOT NULL THEN 'TIMED_OUT' ELSE c.document->>'status' END AS status,
        c.document->>'status'='ACTIVE' AND a.expired_at IS NULL AND a.expires_at<=now()
          AND NOT EXISTS (SELECT 1 FROM collaboration_handoffs h WHERE h.claim_id=c.id AND h.document->>'status'='SUBMITTED') AS "canExpire"
        FROM experiment_csv_attempts a JOIN collaboration_claims c ON c.id=a.claim_id
        WHERE a.task_id=$1 ORDER BY a.step,a.attempt`,[taskId]);
      const steps=[];
      for(const step of CSV_STEPS)steps.push({...step,acceptedContent:await acceptedStep(client,taskId,step.role)??null});
      return {...plan,steps,attempts:rows};
    });
  }

  workerIds() {
    return this.app.config.EXPERIMENT_WORKER_AGENT_IDS?.split(',')??[];
  }

  async pollCsvWorker(principal:Principal) {
    return this.store.write(principal,async(client,actor)=>{
      const workers=this.workerIds();
      if(!workers.includes(actor))throw new AppError(403,'UNAUTHORIZED','当前身份未获准执行自动 CSV 分工');
      await client.query(`INSERT INTO experiment_worker_presence(agent_id) VALUES($1)
        ON CONFLICT(agent_id) DO UPDATE SET polled_at=now()`,[actor]);
      const expired=(await client.query(`
        SELECT a.claim_id,c.document,w.task_id,t.author_id
        FROM experiment_csv_attempts a JOIN experiment_csv_workflows w ON w.task_id=a.task_id
        JOIN collaboration_claims c ON c.id=a.claim_id JOIN collaboration_tasks t ON t.id=w.task_id
        WHERE w.mode='AUTO' AND w.failed_at IS NULL AND c.document->>'status'='ACTIVE' AND a.expires_at<=now()
        AND NOT EXISTS(SELECT 1 FROM collaboration_handoffs h WHERE h.claim_id=c.id AND h.document->>'status'='SUBMITTED')
        ORDER BY a.expires_at LIMIT 25`)).rows;
      for(const row of expired)await this.failAutoAttempt(client,CollaborationClaimSchema.parse(row.document),row.author_id,'TIMEOUT');
      const pending=(await client.query(`
        SELECT t.document,w.lease_seconds
        FROM experiment_csv_workflows w JOIN collaboration_tasks t ON t.id=w.task_id
        WHERE w.mode='AUTO' AND w.failed_at IS NULL AND t.document->>'status' IN ('OPEN','IN_PROGRESS')
        AND NOT EXISTS(SELECT 1 FROM collaboration_claims c WHERE c.task_id=t.id AND c.document->>'status'='ACTIVE')
        AND NOT EXISTS(SELECT 1 FROM collaboration_claims c WHERE c.task_id=t.id AND c.scope='csv-evidence-report' AND c.document->>'status'='COMPLETED')
        ORDER BY t.created_at,t.id LIMIT 25`)).rows;
      for(const row of pending) {
        const task=CollaborationTaskSchema.parse(row.document);
        const completed=new Set((await client.query("SELECT scope FROM collaboration_claims WHERE task_id=$1 AND document->>'status'='COMPLETED'",[task.taskId])).rows.map(item=>item.scope));
        const next=CSV_STEPS.find(step=>!completed.has(step.role));
        if(!next)continue;
        const decision=await rankAndSave(client,task,next.role,workers,false);
        if(!decision.selectedAgentId)continue;
        await this.recordClaim(client,task,decision.selectedAgentId,next.role,null,row.lease_seconds,decision.id);
      }
      const job=(await client.query(`
        SELECT w.input_csv AS input,a.claim_id AS "claimId", a.task_id AS "taskId", a.step,a.attempt
        FROM experiment_csv_attempts a JOIN experiment_csv_workflows w ON w.task_id=a.task_id
        JOIN collaboration_claims c ON c.id=a.claim_id
        WHERE w.mode='AUTO' AND w.failed_at IS NULL AND c.agent_id=$1 AND c.document->>'status'='ACTIVE'
        AND a.expires_at>now() AND NOT EXISTS(SELECT 1 FROM collaboration_handoffs h WHERE h.claim_id=c.id AND h.document->>'status'='SUBMITTED')
        ORDER BY c.created_at,c.id LIMIT 1`,[actor])).rows[0];
      if(!job)return {job:null};
      const input=job.step==='csv-evidence-report'?await acceptedStep(client,job.taskId,CSV_ROLE):job.input;
      if(typeof input!=='string')throw new Error('Scheduled report missing accepted input');
      return {job:{...job,input}};
    });
  }

  async failCsvWorker(principal:Principal,claimId:string) {
    return this.store.write(principal,async(client,actor)=>{
      if(!this.workerIds().includes(actor))throw new AppError(403,'UNAUTHORIZED','当前身份未获准执行自动 CSV 分工');
      const claim=await this.store.record('collaboration_claims',claimId,CollaborationClaimSchema,client);
      sameCollaborator(actor,claim.agentId);
      const plan=await workflow(client,claim.taskId);
      if(plan?.mode!=='AUTO'||claim.status!=='ACTIVE'||
        (await client.query("SELECT 1 FROM collaboration_handoffs WHERE claim_id=$1 AND document->>'status'='SUBMITTED'",[claimId])).rowCount) {
        throw new AppError(409,'INVALID_STATE','当前尝试不可报告执行错误');
      }
      if(!(await client.query('SELECT 1 FROM experiment_csv_attempts WHERE claim_id=$1 AND expires_at>now()',[claimId])).rowCount)
        throw new AppError(409,'STALE_ATTEMPT','当前步骤已超时');
      await this.failAutoAttempt(client,claim,actor,'EXECUTION_ERROR');
      return {claimId,status:'RELEASED'};
    });
  }

  private async failAutoAttempt(client:PoolClient,claim:ReturnType<typeof CollaborationClaimSchema.parse>,actor:string,code:'TIMEOUT'|'EXECUTION_ERROR'|'RETURNED') {
    const now=new Date().toISOString();
    const updated=CollaborationClaimSchema.parse({...claim,status:'RELEASED',version:claim.version+1,updatedAt:now});
    await client.query('UPDATE collaboration_claims SET document=$2,version=$3 WHERE id=$1',[claim.claimId,updated,updated.version]);
    const {rows:[attempt]}=await client.query(`UPDATE experiment_csv_attempts SET failure_code=$2,
      expired_at=CASE WHEN $2='TIMEOUT' THEN now() ELSE expired_at END WHERE claim_id=$1 RETURNING attempt`,[claim.claimId,code]);
    const maxAttempts=this.app.config.DEMO_CSV_MAX_ATTEMPTS;
    if(attempt.attempt>=maxAttempts)await client.query('UPDATE experiment_csv_workflows SET failed_at=now(),failed_step=$2 WHERE task_id=$1',[claim.taskId,claim.scope]);
    const task=await this.task(claim.taskId,client);
    await this.saveTask(client,{...task,version:task.version+1,updatedAt:now});
    await this.store.event(client,'CSV_ATTEMPT_FAILED',actor,task.taskId,{claimId:claim.claimId,attempt:attempt.attempt,code,terminal:attempt.attempt>=maxAttempts});
  }

  private async recordClaim(client:PoolClient,task:CollaborationTask,agentId:string,scope:string,proposalId:string|null,leaseSeconds?:number,decisionId?:string) {
    const {taskId}=task;
    const now=new Date().toISOString(),claim=CollaborationClaimSchema.parse({claimId:randomUUID(),taskId,agentId,scope,proposalId,status:'ACTIVE',version:1,createdAt:now,updatedAt:now});
    await client.query('INSERT INTO collaboration_claims(id,task_id,agent_id,proposal_id,scope,version,document) VALUES($1,$2,$3,$4,$5,$6,$7)',[claim.claimId,taskId,agentId,proposalId,scope,claim.version,claim]);
    if(leaseSeconds!==undefined)await client.query(`INSERT INTO experiment_csv_attempts(claim_id,task_id,step,attempt,expires_at,decision_id)
      SELECT $1,$2,$3,COALESCE(max(attempt),0)+1,now()+$4::int*interval '1 second',$5
      FROM experiment_csv_attempts WHERE task_id=$2 AND step=$3`,[claim.claimId,taskId,scope,leaseSeconds,decisionId??null]);
    await this.saveTask(client,{...task,status:'IN_PROGRESS',version:task.version+1,updatedAt:now});
    await this.store.event(client,'TASK_CLAIMED',decisionId?task.creator:agentId,taskId,{claimId:claim.claimId,agentId,taskVersion:task.version+1,decisionId:decisionId??null});
    return claim;
  }

  async expireCsvClaim(principal: Principal,claimId: string,version: number) {
    const claim=await this.store.write(principal,async(client,actor)=>{
      const current=await this.store.record('collaboration_claims',claimId,CollaborationClaimSchema,client);
      const task=await this.task(current.taskId,client);
      sameCollaborator(actor,task.creator);
      expectedVersion(current.version,version);
      this.active(task);
      if((await workflow(client,task.taskId))?.mode==='AUTO')throw new AppError(409,'INVALID_STATE','自动模式由 Worker 调度回收租期');
      const expired=(await client.query(`UPDATE experiment_csv_attempts SET expired_at=now()
        WHERE claim_id=$1 AND expired_at IS NULL AND expires_at<=now()
        AND NOT EXISTS (SELECT 1 FROM collaboration_handoffs WHERE claim_id=$1 AND document->>'status'='SUBMITTED')
        RETURNING attempt`,[claimId])).rows[0];
      if(!expired||current.status!=='ACTIVE')throw new AppError(409,'INVALID_STATE','当前步骤尚未超时或仍有待审核交付');
      const now=new Date().toISOString(), updated=CollaborationClaimSchema.parse({...current,status:'RELEASED',version:current.version+1,updatedAt:now});
      await client.query('UPDATE collaboration_claims SET document=$2,version=$3 WHERE id=$1',[claimId,updated,updated.version]);
      await this.saveTask(client,{...task,version:task.version+1,updatedAt:now});
      await this.store.event(client,'CSV_ATTEMPT_TIMED_OUT',actor,task.taskId,{claimId,attempt:expired.attempt});
      return updated;
    });
    await this.anchor('CLAIM',claim.claimId,claim.taskId,claim.version,claim);
    return claim;
  }

  async publishMessage(principal: Principal,input: unknown) {
    const request=PublishCollaborationMessageRequestSchema.parse(input);
    return this.store.write(principal,async(client,actor)=>{
      if(request.taskId) await this.task(request.taskId,client);
      const messageId=randomUUID(),event=await this.store.event(client,'MESSAGE_PUBLISHED',actor,request.taskId,{messageId});
      const message=CollaborationMessageSchema.parse({...request,messageId,seq:event.seq,author:actor,createdAt:event.createdAt});
      await client.query('INSERT INTO collaboration_messages(id,author_id,task_id,seq,document) VALUES($1,$2,$3,$4,$5)',[messageId,actor,message.taskId,message.seq,message]);return message;
    });
  }
  async messages(input: unknown) {
    const {after,limit,taskId}=CollaborationCursorQuerySchema.parse(input);
    const rows=(await this.app.db.pool.query('SELECT seq,document FROM collaboration_messages WHERE seq>$1 AND ($2::text IS NULL OR task_id=$2) ORDER BY seq LIMIT $3',[after,taskId??null,limit+1])).rows;
    const page=rows.slice(0,limit);
    return CollaborationMessagesResponseSchema.parse({messages:page.map(row=>row.document),nextAfter:page.length?Number(page.at(-1)!.seq):after,hasMore:rows.length>limit});
  }
  async createNote(principal: Principal,input: unknown) {
    const request=CreateCollaborationNoteRequestSchema.parse(input);
    return this.store.write(principal,async(client,actor)=>{
      if(request.taskId) await this.task(request.taskId,client);
      const now=new Date().toISOString(),note=CollaborationNoteSchema.parse({...request,noteId:randomUUID(),author:actor,version:1,createdAt:now,updatedAt:now});
      await client.query('INSERT INTO collaboration_notes(id,author_id,task_id,version,document) VALUES($1,$2,$3,$4,$5)',[note.noteId,actor,note.taskId,note.version,note]);
      await client.query('INSERT INTO collaboration_note_versions(note_id,version,document) VALUES($1,$2,$3)',[note.noteId,note.version,note]);
      await this.store.event(client,'NOTE_CREATED',actor,note.taskId,{noteId:note.noteId,version:note.version});return note;
    });
  }
  async updateNote(principal: Principal,noteId: string,input: unknown) {
    const request=UpdateCollaborationNoteRequestSchema.parse(input);
    return this.store.write(principal,async(client,actor)=>{
      const current=await this.store.record('collaboration_notes',noteId,CollaborationNoteSchema,client);sameCollaborator(actor,current.author);expectedVersion(current.version,request.expectedVersion);
      const note=CollaborationNoteSchema.parse({...current,topic:request.topic,body:request.body,version:current.version+1,updatedAt:new Date().toISOString()});
      const result=await client.query('UPDATE collaboration_notes SET document=$2,version=$3 WHERE id=$1 AND version=$4',[noteId,note,note.version,request.expectedVersion]);
      if(result.rowCount!==1) throw new AppError(409,'VERSION_CONFLICT','便签版本已变化');
      await client.query('INSERT INTO collaboration_note_versions(note_id,version,document) VALUES($1,$2,$3)',[noteId,note.version,note]);
      await this.store.event(client,'NOTE_UPDATED',actor,note.taskId,{noteId,version:note.version});return note;
    });
  }
  async notes(input: unknown) {
    const {limit,offset,taskId}=CollaborationNotesQuerySchema.parse(input);
    const rows=(await this.app.db.pool.query('SELECT document FROM collaboration_notes WHERE ($1::text IS NULL OR task_id=$1) ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[taskId??null,limit+1,offset])).rows;
    return CollaborationNotesResponseSchema.parse({notes:rows.slice(0,limit).map(row=>row.document),nextOffset:rows.length>limit?offset+limit:null});
  }
  async note(noteId: string) {
    const row=requireValue((await this.app.db.pool.query(`SELECT n.document,ARRAY(SELECT document FROM collaboration_note_versions WHERE note_id=n.id ORDER BY version) AS versions FROM collaboration_notes n WHERE n.id=$1`,[noteId])).rows[0]);
    return CollaborationNoteDetailSchema.parse({...row.document,versions:row.versions});
  }

  async propose(principal: Principal,taskId: string,input: unknown) {
    const request=ProposeCollaborationAssignmentRequestSchema.parse(input);
    const proposal=await this.store.write(principal,async(client,actor)=>{
      this.active(await this.task(taskId,client));await this.store.record('collaboration_agents',request.agentId,CollaborationAgentSchema,client);
      const now=new Date().toISOString(),proposal=CollaborationAssignmentProposalSchema.parse({...request,proposalId:randomUUID(),taskId,proposedBy:actor,status:'PROPOSED',reason:null,version:1,createdAt:now,updatedAt:now});
      await client.query('INSERT INTO collaboration_proposals(id,task_id,author_id,document) VALUES($1,$2,$3,$4)',[proposal.proposalId,taskId,actor,proposal]);
      await this.store.event(client,'ASSIGNMENT_PROPOSED',actor,taskId,{proposalId:proposal.proposalId});return proposal;
    });
    await this.anchor('PROPOSAL',proposal.proposalId,proposal.taskId,proposal.version,proposal);
    return proposal;
  }
  async decide(principal: Principal,proposalId: string,input: unknown) {
    const request=DecideCollaborationAssignmentRequestSchema.parse(input);
    const proposal=await this.store.write(principal,async(client,actor)=>{
      const current=await this.store.record('collaboration_proposals',proposalId,CollaborationAssignmentProposalSchema,client);
      const task=await this.task(current.taskId,client);this.active(task);sameCollaborator(actor,task.creator);expectedVersion(current.version,request.expectedVersion);
      if(current.status!=='PROPOSED') throw new AppError(409,'INVALID_STATE','分工提议已经处理');
      const proposal=CollaborationAssignmentProposalSchema.parse({...current,status:request.status,reason:request.reason,version:current.version+1,updatedAt:new Date().toISOString()});
      await client.query('UPDATE collaboration_proposals SET document=$2 WHERE id=$1',[proposalId,proposal]);await this.store.event(client,'ASSIGNMENT_DECIDED',actor,task.taskId,{proposalId,status:proposal.status,version:proposal.version});return proposal;
    });
    await this.anchor('PROPOSAL',proposal.proposalId,proposal.taskId,proposal.version,proposal);
    return proposal;
  }
  async claim(principal: Principal,taskId: string,input: unknown) {
    const request=ClaimCollaborationTaskRequestSchema.parse(input);
    const claim=await this.store.write(principal,async(client,actor)=>{
      const task=await this.task(taskId,client);this.active(task);expectedVersion(task.version,request.expectedVersion);
      const plan=await workflow(client,taskId);
      if(plan?.mode==='AUTO')throw new AppError(409,'INVALID_STATE','自动模式由调度器分配');
      const step=CSV_STEPS.find(item=>item.role===request.scope);
      if(plan&&!step) throw new AppError(409,'INVALID_STATE','请选择已配置的 CSV 步骤');
      if(plan&&step) {
        if(step.dependsOn&&!await acceptedStep(client,taskId,step.dependsOn)) throw new AppError(409,'INVALID_STATE','上游交付尚未验收');
        if(await acceptedStep(client,taskId,step.role)) throw new AppError(409,'INVALID_STATE','该步骤已完成');
        const used=(await client.query("SELECT 1 FROM collaboration_claims WHERE task_id=$1 AND agent_id=$2 AND scope<>$3 AND document->>'status' IN ('ACTIVE','COMPLETED')",[taskId,actor,step.role])).rowCount;
        if(used)throw new AppError(409,'INVALID_STATE','同一工作流的不同步骤须由不同 Agent 承担');
      }
      if(plan||request.scope===CSV_ROLE) {
        if(task.creator===actor) throw new AppError(403,'UNAUTHORIZED','任务发布人不能认领自己的评分分工');
        const agent=await this.store.record('collaboration_agents',actor,CollaborationAgentSchema,client);
        const skills=new Set(agent.capabilities.map(value=>value.trim().toLowerCase()));
        const required=request.scope===CSV_ROLE?[CSV_ROLE,...task.requiredCapabilities]:[request.scope];
        if(!required.every(value=>skills.has(value.trim().toLowerCase()))) throw new AppError(409,'INVALID_STATE','Agent 缺少任务要求的能力');
        const {rows}=await client.query("SELECT count(*)::int AS active FROM collaboration_claims WHERE agent_id=$1 AND document->>'status'='ACTIVE'",[actor]);
        if(rows[0].active>=2) throw new AppError(409,'INVALID_STATE','Agent 已达到认领并发上限');
      }
      if(request.proposalId) {
        const proposal=await this.store.record('collaboration_proposals',request.proposalId,CollaborationAssignmentProposalSchema,client);
        if(proposal.taskId!==taskId || proposal.agentId!==actor || proposal.scope!==request.scope || proposal.status!=='APPROVED') throw new AppError(409,'INVALID_STATE','认领与已批准的本人分工提议不一致');
      }
      if((await client.query("SELECT id FROM collaboration_claims WHERE task_id=$1 AND scope=$2 AND document->>'status'='ACTIVE'",[taskId,request.scope])).rowCount) throw new AppError(409,'VERSION_CONFLICT','该分工已被认领');
      return this.recordClaim(client,task,actor,request.scope,request.proposalId,plan?.leaseSeconds);
    });
    await this.anchor('CLAIM',claim.claimId,claim.taskId,claim.version,claim);
    return claim;
  }
  async release(principal: Principal,claimId: string,input: unknown) {
    const request=ReleaseCollaborationClaimRequestSchema.parse(input);
    const claim=await this.store.write(principal,async(client,actor)=>{
      const current=await this.store.record('collaboration_claims',claimId,CollaborationClaimSchema,client);sameCollaborator(actor,current.agentId);expectedVersion(current.version,request.expectedVersion);
      const task=await this.task(current.taskId,client);this.active(task);
      if((await workflow(client,task.taskId))?.mode==='AUTO')throw new AppError(409,'INVALID_STATE','自动模式请报告 Worker 执行错误或等待租期结束');
      if(current.status!=='ACTIVE') throw new AppError(409,'INVALID_STATE','认领已经结束');
      if((await client.query("SELECT id FROM collaboration_handoffs WHERE claim_id=$1 AND document->>'status'='SUBMITTED'",[claimId])).rowCount) throw new AppError(409,'INVALID_STATE','成果正在等待审核');
      const now=new Date().toISOString(),claim=CollaborationClaimSchema.parse({...current,status:'RELEASED',version:current.version+1,updatedAt:now});
      await client.query('UPDATE collaboration_claims SET document=$2,version=$3 WHERE id=$1',[claimId,claim,claim.version]);
      const others=(await client.query("SELECT id FROM collaboration_claims WHERE task_id=$1 AND document->>'status' IN ('ACTIVE','COMPLETED')",[task.taskId])).rowCount;
      await this.saveTask(client,{...task,status:others?'IN_PROGRESS':'OPEN',version:task.version+1,updatedAt:now});
      await this.store.event(client,'CLAIM_RELEASED',actor,task.taskId,{claimId,version:claim.version});return claim;
    });
    await this.anchor('CLAIM',claim.claimId,claim.taskId,claim.version,claim);
    return claim;
  }
  async submitHandoff(principal: Principal,taskId: string,input: unknown) {
    const {requestId,...request}=SubmitCollaborationHandoffRequestSchema.parse(input);
    const handoff=await this.store.write(principal,async(client,actor)=>{
      const claim=await this.store.record('collaboration_claims',request.claimId,CollaborationClaimSchema,client);sameCollaborator(actor,claim.agentId);
      if(claim.taskId!==taskId)throw new AppError(409,'INVALID_STATE','成果需要绑定本任务的有效认领');
      const plan=await workflow(client,taskId);
      if(plan?.mode==='AUTO'){
        if(!this.workerIds().includes(actor)||!requestId)throw new AppError(403,'UNAUTHORIZED','自动交付需要获准的 Worker 与提交请求 ID');
        const existing=(await client.query('SELECT handoff_id FROM experiment_csv_submissions WHERE claim_id=$1 AND request_id=$2',[claim.claimId,requestId])).rows[0];
        if(existing){
          const stored=await this.store.record('collaboration_handoffs',existing.handoff_id,CollaborationHandoffSchema,client);
          if(stored.content!==request.content||stored.artifactURI!==request.artifactURI)throw new AppError(409,'VERSION_CONFLICT','提交请求 ID 已用于不同内容');
          return stored;
        }
      }else if(requestId)throw new AppError(422,'INVALID_INPUT','请求 ID 仅用于自动交付');
      this.active(await this.task(taskId,client));
      if(claim.status!=='ACTIVE')throw new AppError(409,plan?.mode==='AUTO'?'STALE_ATTEMPT':'INVALID_STATE','成果需要绑定本任务的有效认领');
      if(plan) {
        const {rows}=await client.query('SELECT 1 FROM experiment_csv_attempts WHERE claim_id=$1 AND expires_at>now() AND expired_at IS NULL',[claim.claimId]);
        if(!rows.length)throw new AppError(409,'STALE_ATTEMPT','当前步骤已超时');
        const upstream=claim.scope==='csv-evidence-report'?await acceptedStep(client,taskId,CSV_ROLE):undefined;
        if(claim.scope==='csv-evidence-report'&&upstream===undefined) throw new AppError(409,'INVALID_STATE','上游交付尚未验收');
        const expected=claim.scope==='csv-source-inspection'?inspectSource(plan.input):
          claim.scope===CSV_ROLE?normalizedDelivery(plan.input):evidenceReport(upstream!);
        sameDelivery(request.content,expected,claim.scope);
      }
      if((await client.query("SELECT id FROM collaboration_handoffs WHERE claim_id=$1 AND document->>'status'='SUBMITTED'",[claim.claimId])).rowCount) throw new AppError(409,'VERSION_CONFLICT','该认领已有待审核成果');
      const now=new Date().toISOString(),handoff=CollaborationHandoffSchema.parse({...request,handoffId:randomUUID(),taskId,author:actor,status:'SUBMITTED',reason:null,version:1,createdAt:now,updatedAt:now});
      await client.query('INSERT INTO collaboration_handoffs(id,task_id,author_id,claim_id,document) VALUES($1,$2,$3,$4,$5)',[handoff.handoffId,taskId,actor,claim.claimId,handoff]);
      if(requestId)await client.query('INSERT INTO experiment_csv_submissions(claim_id,request_id,handoff_id) VALUES($1,$2,$3)',[claim.claimId,requestId,handoff.handoffId]);
      if(claim.scope===CSV_ROLE) {
        const evidence=verifyCsvDelivery(handoff.content);
        await client.query('INSERT INTO experiment_csv_evidence(handoff_id,claim_id,role,document) VALUES($1,$2,$3,$4)',[handoff.handoffId,claim.claimId,CSV_ROLE,evidence]);
      }
      await this.store.event(client,'HANDOFF_SUBMITTED',actor,taskId,{handoffId:handoff.handoffId,claimId:claim.claimId});return handoff;
    });
    await this.anchor('HANDOFF',handoff.handoffId,handoff.taskId,handoff.version,handoff);
    if (handoff.status==='SUBMITTED') await this.app.commerce?.onHandoffSubmitted(handoff.taskId);
    return handoff;
  }
  async reviewHandoff(principal: Principal,handoffId: string,input: unknown) {
    const request=ReviewCollaborationHandoffRequestSchema.parse(input);
    const handoff=await this.store.write(principal,async(client,actor)=>{
      const current=await this.store.record('collaboration_handoffs',handoffId,CollaborationHandoffSchema,client);
      const task=await this.task(current.taskId,client);this.active(task);sameCollaborator(actor,task.creator);expectedVersion(current.version,request.expectedVersion);
      if(current.status!=='SUBMITTED') throw new AppError(409,'INVALID_STATE','成果已审核');
      const claim=await this.store.record('collaboration_claims',current.claimId,CollaborationClaimSchema,client);
      if(claim.status!=='ACTIVE') throw new AppError(409,'INVALID_STATE','认领已结束');
      if(claim.scope===CSV_ROLE && request.status==='ACCEPTED') {
        if(current.author===actor) throw new AppError(403,'UNAUTHORIZED','数据验收人与交付人必须不同');
        const evidence=(await client.query('SELECT document FROM experiment_csv_evidence WHERE handoff_id=$1',[handoffId])).rows[0]?.document;
        const replay=replayCsvDelivery(current.content,evidence);
        if(!replay.matches||replay.result.status!=='PASS') {
          throw new AppError(409,'INVALID_STATE','交付证据与固定规则复算不一致');
        }
        await client.query(`INSERT INTO experiment_reputation_events(claim_id,handoff_id,task_id,agent_id,role,outcome)
          VALUES($1,$2,$3,$4,$5,'PASS')`,[claim.claimId,handoffId,task.taskId,claim.agentId,CSV_ROLE]);
      }
      const now=new Date().toISOString(),handoff=CollaborationHandoffSchema.parse({...current,status:request.status,reason:request.reason,version:current.version+1,updatedAt:now});
      await client.query('UPDATE collaboration_handoffs SET document=$2 WHERE id=$1',[handoffId,handoff]);
      const plan=await workflow(client,task.taskId);
      if(handoff.status==='RETURNED'&&plan?.mode==='AUTO')await this.failAutoAttempt(client,claim,actor,'RETURNED');
      if(handoff.status==='ACCEPTED') {
        const completed=CollaborationClaimSchema.parse({...claim,status:'COMPLETED',version:claim.version+1,updatedAt:now});
        await client.query('UPDATE collaboration_claims SET document=$2,version=$3 WHERE id=$1',[claim.claimId,completed,completed.version]);
        const final=plan?.mode==='AUTO'&&claim.scope==='csv-evidence-report'&&
          !(await client.query("SELECT 1 FROM collaboration_tasks WHERE parent_task_id=$1 AND document->>'status' IN ('OPEN','IN_PROGRESS')",[task.taskId])).rowCount;
        await this.saveTask(client,{...task,status:final?'COMPLETED':task.status,version:task.version+1,updatedAt:now});
        if(final)await this.store.event(client,'CSV_WORKFLOW_COMPLETED',actor,task.taskId,{handoffId});
      }
      await this.store.event(client,'HANDOFF_REVIEWED',actor,task.taskId,{handoffId,status:handoff.status,claimId:claim.claimId});return handoff;
    });
    await this.anchor('HANDOFF',handoff.handoffId,handoff.taskId,handoff.version,handoff);
    if (handoff.status==='ACCEPTED') {
      const claim=await this.store.record('collaboration_claims',handoff.claimId,CollaborationClaimSchema);
      await this.anchor('CLAIM',claim.claimId,claim.taskId,claim.version,claim);
    }
    return handoff;
  }

  async events(input: unknown) {
    const {after,limit,taskId}=CollaborationCursorQuerySchema.parse(input);
    const rows=(await this.app.db.pool.query('SELECT seq,document FROM collaboration_events WHERE seq>$1 AND ($2::text IS NULL OR task_id=$2) ORDER BY seq LIMIT $3',[after,taskId??null,limit+1])).rows;
    const page=rows.slice(0,limit);
    return CollaborationEventsResponseSchema.parse({events:page.map(row=>CollaborationEventSchema.parse({...row.document,seq:Number(row.seq)})),nextAfter:page.length?Number(page.at(-1)!.seq):after,hasMore:rows.length>limit});
  }

  async commitments(taskId?: string|null) {
    if (!this.app.collaborationChain) return { commitments: [], chain: { configured: false,chainId: null,contract: null,explorer: null } };
    return this.app.collaborationChain.list(taskId ? CollaborationIdSchema.parse(taskId) : null);
  }

  async commitment(recordKey: string) {
    if (!this.app.collaborationChain) throw new AppError(404,'NOT_FOUND','链上记录尚未配置');
    return this.app.collaborationChain.snapshot(recordKey);
  }

  async reconcile(limit: number) {
    if (!this.app.collaborationChain) throw new AppError(503,'CHAIN_NOT_CONFIGURED','链上记录尚未配置');
    return this.app.collaborationChain.reconcile(limit);
  }
}

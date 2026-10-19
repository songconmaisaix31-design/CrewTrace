import { randomBytes,randomUUID } from 'node:crypto';
import type { PoolClient } from '@neondatabase/serverless';
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
      if(request.proposalId) {
        const proposal=await this.store.record('collaboration_proposals',request.proposalId,CollaborationAssignmentProposalSchema,client);
        if(proposal.taskId!==taskId || proposal.agentId!==actor || proposal.scope!==request.scope || proposal.status!=='APPROVED') throw new AppError(409,'INVALID_STATE','认领与已批准的本人分工提议不一致');
      }
      if((await client.query("SELECT id FROM collaboration_claims WHERE task_id=$1 AND scope=$2 AND document->>'status'='ACTIVE'",[taskId,request.scope])).rowCount) throw new AppError(409,'VERSION_CONFLICT','该分工已被认领');
      const now=new Date().toISOString(),claim=CollaborationClaimSchema.parse({claimId:randomUUID(),taskId,agentId:actor,scope:request.scope,proposalId:request.proposalId,status:'ACTIVE',version:1,createdAt:now,updatedAt:now});
      await client.query('INSERT INTO collaboration_claims(id,task_id,agent_id,proposal_id,scope,version,document) VALUES($1,$2,$3,$4,$5,$6,$7)',[claim.claimId,taskId,actor,claim.proposalId,claim.scope,claim.version,claim]);
      await this.saveTask(client,{...task,status:'IN_PROGRESS',version:task.version+1,updatedAt:now});
      await this.store.event(client,'TASK_CLAIMED',actor,taskId,{claimId:claim.claimId,taskVersion:task.version+1});return claim;
    });
    await this.anchor('CLAIM',claim.claimId,claim.taskId,claim.version,claim);
    return claim;
  }
  async release(principal: Principal,claimId: string,input: unknown) {
    const request=ReleaseCollaborationClaimRequestSchema.parse(input);
    const claim=await this.store.write(principal,async(client,actor)=>{
      const current=await this.store.record('collaboration_claims',claimId,CollaborationClaimSchema,client);sameCollaborator(actor,current.agentId);expectedVersion(current.version,request.expectedVersion);
      const task=await this.task(current.taskId,client);this.active(task);
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
    const request=SubmitCollaborationHandoffRequestSchema.parse(input);
    const handoff=await this.store.write(principal,async(client,actor)=>{
      this.active(await this.task(taskId,client));const claim=await this.store.record('collaboration_claims',request.claimId,CollaborationClaimSchema,client);sameCollaborator(actor,claim.agentId);
      if(claim.taskId!==taskId || claim.status!=='ACTIVE') throw new AppError(409,'INVALID_STATE','成果需要绑定本任务的有效认领');
      if((await client.query("SELECT id FROM collaboration_handoffs WHERE claim_id=$1 AND document->>'status'='SUBMITTED'",[claim.claimId])).rowCount) throw new AppError(409,'VERSION_CONFLICT','该认领已有待审核成果');
      const now=new Date().toISOString(),handoff=CollaborationHandoffSchema.parse({...request,handoffId:randomUUID(),taskId,author:actor,status:'SUBMITTED',reason:null,version:1,createdAt:now,updatedAt:now});
      await client.query('INSERT INTO collaboration_handoffs(id,task_id,author_id,claim_id,document) VALUES($1,$2,$3,$4,$5)',[handoff.handoffId,taskId,actor,claim.claimId,handoff]);
      await this.store.event(client,'HANDOFF_SUBMITTED',actor,taskId,{handoffId:handoff.handoffId,claimId:claim.claimId});return handoff;
    });
    await this.anchor('HANDOFF',handoff.handoffId,handoff.taskId,handoff.version,handoff);
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
      const now=new Date().toISOString(),handoff=CollaborationHandoffSchema.parse({...current,status:request.status,reason:request.reason,version:current.version+1,updatedAt:now});
      await client.query('UPDATE collaboration_handoffs SET document=$2 WHERE id=$1',[handoffId,handoff]);
      if(handoff.status==='ACCEPTED') {
        const completed=CollaborationClaimSchema.parse({...claim,status:'COMPLETED',version:claim.version+1,updatedAt:now});
        await client.query('UPDATE collaboration_claims SET document=$2,version=$3 WHERE id=$1',[claim.claimId,completed,completed.version]);
        await this.saveTask(client,{...task,version:task.version+1,updatedAt:now});
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

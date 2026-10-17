import type { Application } from './application.js';
import { Execution } from './execution.js';
import { FIXED_WORKFLOW } from './domain/workflow.ts';
import { AppError,errorBody } from './errors.js';

export class FixedWorkflow {
  constructor(readonly app: Application) {}
  async advance(runId?: string) {
    this.app.requireChain();
    if (!this.app.validator) throw new AppError(503,'VALIDATOR_NOT_CONFIGURED','自动流程需要确定性验收模块');
    return this.app.db.transaction(async client=>{
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(83521002) AS acquired');
      if (!lock.rows[0].acquired) return { status: 'PROGRESS_IN_FLIGHT' };
      const execution = new Execution(this.app);
      const ids: string[] = runId ? [runId] : (await client.query("SELECT id FROM runs WHERE runtime_status='ACTIVE' AND document->>'status' IN ('OPEN','RUNNING') ORDER BY created_at LIMIT 2")).rows.map(row=>row.id);
      const results: { runId: string; status: string }[] = [];
      for (const id of ids) {
        const run = await this.app.run(id);
        if (run.runtimeStatus!=='ACTIVE') { results.push({ runId: id,status: run.runtimeStatus }); continue; }
        try {
          let status = 'COMPLETE';
          for (const step of FIXED_WORKFLOW) {
            let task = await this.app.task(run.tasks.find(task=>task.role===step.role)!.taskId);
            if (task.status==='VERIFIED_FAIL') { status='VERIFIED_FAIL'; break; }
            if (task.status==='VERIFIED_PASS') continue;
            if (task.status==='OPEN') {
              await execution.assign({ kind: 'admin' },task.taskId);
              status='WAITING_WORKER'; break;
            }
            if (task.status==='ASSIGNED') { status='WAITING_WORKER'; break; }
            if (task.status==='RUNNING') {
              const pending = (await client.query('SELECT submission_receipt FROM tasks WHERE id=$1',[task.taskId])).rows[0]?.submission_receipt;
              if (!pending) { status='WAITING_WORKER'; break; }
              await execution.reconcileSubmission(task.taskId);
              task = await this.app.task(task.taskId);
            }
            if (task.status==='SUBMITTED') {
              await execution.assess({ kind: 'admin' },task.taskId);
              task = await this.app.task(task.taskId);
              if (task.status==='VERIFIED_FAIL') { status='VERIFIED_FAIL'; break; }
            }
          }
          results.push({ runId: id,status });
        } catch (error) {
          const body = errorBody(error);
          const waiting = ['CHAIN_PENDING','NO_ELIGIBLE_AGENT','DEPENDENCY_NOT_READY'].includes(body.error.code);
          await this.app.store.write(async writer=>{
            const previous = (await writer.query('SELECT runtime_reason FROM runs WHERE id=$1',[id])).rows[0]?.runtime_reason;
            await writer.query('UPDATE runs SET runtime_reason=$2,runtime_status=$3 WHERE id=$1',[id,body.error.code,waiting ? 'ACTIVE' : 'WAITING_MANUAL']);
            if (previous!==body.error.code) await this.app.store.event(writer,waiting ? 'WORKFLOW_WAITING' : 'WORKFLOW_INTERRUPTED',id,null,null,{ code: body.error.code,message: body.error.message });
          });
          if (!waiting) throw new AppError(body.status,body.error.code,body.error.message);
          results.push({ runId: id,status: body.error.code });
        }
      }
      return { status: 'PROGRESSED',runs: results };
    });
  }
}

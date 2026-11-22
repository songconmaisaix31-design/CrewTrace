import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { executeCsvStep } from './csv-steps.ts';

const jobSchema=z.object({
  claimId:z.uuid(),taskId:z.uuid(),step:z.string(),input:z.string(),attempt:z.number().int().positive(),
});

class ResponseError extends Error {
  constructor(readonly status:number) { super(`CSV Runtime returned HTTP ${status}`); }
}

export async function runCsvWorkerOnce(runtime:string,credential:string,fetcher:typeof fetch=fetch) {
  const base=new URL(runtime);
  if(base.protocol!=='https:'&&!(base.protocol==='http:'&&base.hostname==='127.0.0.1'))throw new Error('CSV Runtime requires HTTPS or loopback HTTP');
  if(base.username||base.password)throw new Error('Runtime URL must not contain credentials');
  const post=async (path:string,body:unknown)=>{
    const response=await fetcher(new URL('/api/collaboration'+path,base),{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),
    });
    if(!response.ok)throw new ResponseError(response.status);
    return response.json();
  };
  const {job}=z.object({job:jobSchema.nullable()}).parse(await post('/csv-worker/poll',{}));
  if(!job)return null;
  let content:string;
  try { content=executeCsvStep(job.step,job.input); }
  catch {
    await post(`/claims/${job.claimId}/worker-failure`,{});
    return {claimId:job.claimId,status:'EXECUTION_ERROR'};
  }
  try {
    const handoff=z.object({handoffId:z.uuid()}).parse(await post(`/tasks/${job.taskId}/handoffs`,{
      claimId:job.claimId,requestId:job.claimId,content,
    }));
    return {claimId:job.claimId,handoffId:handoff.handoffId,status:'SUBMITTED'};
  } catch(error) {
    if(error instanceof ResponseError&&error.status===422){
      await post(`/claims/${job.claimId}/worker-failure`,{});
      return {claimId:job.claimId,status:'EXECUTION_ERROR'};
    }
    throw error;
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const runtime=z.url().parse(process.env.CREWTRACE_WORKER_RUNTIME);
  const credential=z.string().min(32).parse(process.env.CREWTRACE_WORKER_CREDENTIAL);
  const once=process.argv.includes('--once');
  do {
    try {
      const result=await runCsvWorkerOnce(runtime,credential);
      if(result)console.log(JSON.stringify(result));
    } catch(error) {
      if(once||error instanceof ResponseError&&[401,403].includes(error.status))throw error;
      console.error(error instanceof ResponseError?error.message:'CSV Worker transport or response failure');
    }
    if(!once)await delay(1500);
  } while(!once);
}

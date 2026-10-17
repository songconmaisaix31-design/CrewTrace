import { CollaborationToolSchemas } from '../../../packages/contracts/src/index.ts';
import type { Application } from './application.js';
import type { Principal } from './auth.js';
import { Collaboration } from './collaboration.js';

export function collaborationTools(app: Application,principal: Principal) {
  const service=new Collaboration(app);
  const operations: Record<keyof typeof CollaborationToolSchemas,{description:string;operation:(input:any)=>Promise<unknown>}>={
    register_collaboration_agent:{description:'公开注册独立 Agent 并领取自己的凭证',operation:input=>service.register(input.request)},
    get_collaboration_identity:{description:'读取当前协作凭证绑定的 Agent',operation:()=>service.identity(principal)},
    rotate_collaboration_credential:{description:'轮换自己的协作凭证并撤销旧凭证',operation:()=>service.rotate(principal)},
    update_collaboration_agent:{description:'按版本更新自己的公开资料',operation:input=>service.updateAgent(principal,input.request)},
    heartbeat_collaboration_agent:{description:'报告当前 Agent 的真实在线心跳',operation:()=>service.heartbeat(principal)},
    list_collaboration_agents:{description:'公开分页读取参与协作的 Agent',operation:input=>service.agents(input)},
    get_collaboration_agent:{description:'读取一个公开 Agent',operation:input=>service.agent(input.agentId)},
    create_collaboration_task:{description:'发布公开协作任务与模拟 MON 标价',operation:input=>service.createTask(principal,input.request)},
    update_collaboration_task:{description:'任务作者按版本更新任务',operation:input=>service.updateTask(principal,input.taskId,input.request)},
    list_collaboration_tasks:{description:'公开分页读取协作任务',operation:input=>service.tasks(input)},
    get_collaboration_task:{description:'读取任务、分工提议、认领和成果交接',operation:input=>service.taskDetails(input.taskId)},
    publish_collaboration_message:{description:'以当前 Agent 身份发布消息或公告',operation:input=>service.publishMessage(principal,input.request)},
    list_collaboration_messages:{description:'按递增游标公开读取消息和公告',operation:input=>service.messages(input)},
    create_collaboration_note:{description:'创建自己的公开协作便签',operation:input=>service.createNote(principal,input.request)},
    update_collaboration_note:{description:'作者按版本更新便签并保留历史',operation:input=>service.updateNote(principal,input.noteId,input.request)},
    list_collaboration_notes:{description:'分页读取公开协作便签',operation:input=>service.notes(input)},
    propose_collaboration_assignment:{description:'提出明确参与者和工作范围的分工建议',operation:input=>service.propose(principal,input.taskId,input.request)},
    decide_collaboration_assignment:{description:'任务作者批准或拒绝分工建议',operation:input=>service.decide(principal,input.proposalId,input.request)},
    claim_collaboration_task:{description:'本人确认认领工作范围，校验任务版本',operation:input=>service.claim(principal,input.taskId,input.request)},
    release_collaboration_claim:{description:'本人按版本释放有效认领',operation:input=>service.release(principal,input.claimId,input.request)},
    submit_collaboration_handoff:{description:'认领者提交真实成果原文或链接',operation:input=>service.submitHandoff(principal,input.taskId,input.request)},
    review_collaboration_handoff:{description:'任务作者接受或退回成果交接',operation:input=>service.reviewHandoff(principal,input.handoffId,input.request)},
    get_collaboration_events:{description:'按递增游标公开读取持久化协作事件',operation:input=>service.events(input)},
  };
  return (Object.keys(CollaborationToolSchemas) as (keyof typeof CollaborationToolSchemas)[]).map(name=>({name,schema:CollaborationToolSchemas[name],...operations[name]}));
}

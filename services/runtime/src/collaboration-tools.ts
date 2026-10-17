import { CollaborationToolSchemas,JoinCollaborationAgentResponseSchema } from '../../../packages/contracts/src/index.ts';
import type { Application } from './application.js';
import { Auth,type Principal } from './auth.js';
import { Collaboration } from './collaboration.js';
import { collaborationPrincipal } from './collaboration-auth.js';
import { publicMcpURL } from './config.js';

export function collaborationTools(app: Application,principal: Principal) {
  const service=new Collaboration(app),auth=new Auth(app.db,app.config.ADMIN_TOKEN);
  const operations: Record<keyof typeof CollaborationToolSchemas,{description:string;operation:(input:any,actor:Principal)=>Promise<unknown>}>={
    join_collaboration:{description:'起名加入 / Join with a name：仅填 name 创建自己的新 Agent；返回私密 credential 和可直接执行的下一次调用，原 MCP 连接即可继续发言',operation:async input=>{
      const registered=await service.register(input);
      return JoinCollaborationAgentResponseSchema.parse({...registered,onboarding:{
        mcpURL:publicMcpURL(app.config),transport:'streamable-http',credentialArgument:'credential',
        authorizationHeader:`Authorization: Bearer ${registered.credential}`,
        nextCall:{name:'get_collaboration_identity',arguments:{credential:registered.credential}},
      }});
    }},
    register_collaboration_agent:{description:'兼容注册工具：返回 agent 和私密 credential，后续协作工具顶层传 credential；首次加入推荐仅填 name 的 join_collaboration',operation:input=>service.register(input.request)},
    get_collaboration_identity:{description:'读取当前协作凭证绑定的 Agent',operation:(_input,actor)=>service.identity(actor)},
    rotate_collaboration_credential:{description:'轮换自己的私密凭证并撤销旧凭证；后续调用改用返回的新 credential',operation:(_input,actor)=>service.rotate(actor)},
    update_collaboration_agent:{description:'按版本更新自己的公开资料',operation:(input,actor)=>service.updateAgent(actor,input.request)},
    heartbeat_collaboration_agent:{description:'报告当前 Agent 的真实在线心跳',operation:(_input,actor)=>service.heartbeat(actor)},
    list_collaboration_agents:{description:'公开分页读取参与协作的 Agent',operation:input=>service.agents(input)},
    get_collaboration_agent:{description:'读取一个公开 Agent',operation:input=>service.agent(input.agentId)},
    create_collaboration_task:{description:'发布公开协作任务与模拟 MON 标价',operation:(input,actor)=>service.createTask(actor,input.request)},
    update_collaboration_task:{description:'任务作者按版本更新任务',operation:(input,actor)=>service.updateTask(actor,input.taskId,input.request)},
    list_collaboration_tasks:{description:'公开分页读取协作任务',operation:input=>service.tasks(input)},
    get_collaboration_task:{description:'读取任务、分工提议、认领和成果交接',operation:input=>service.taskDetails(input.taskId)},
    publish_collaboration_message:{description:'以自己的凭证身份发言；顶层 credential，request 只需 kind=CHAT 和 body，taskId 可选',operation:(input,actor)=>service.publishMessage(actor,input.request)},
    list_collaboration_messages:{description:'按递增游标公开读取消息和公告',operation:input=>service.messages(input)},
    create_collaboration_note:{description:'创建自己的公开协作便签',operation:(input,actor)=>service.createNote(actor,input.request)},
    update_collaboration_note:{description:'作者按版本更新便签并保留历史',operation:(input,actor)=>service.updateNote(actor,input.noteId,input.request)},
    list_collaboration_notes:{description:'分页读取公开协作便签',operation:input=>service.notes(input)},
    get_collaboration_note:{description:'读取公开便签及完整版本历史',operation:input=>service.note(input.noteId)},
    propose_collaboration_assignment:{description:'提出明确参与者和工作范围的分工建议',operation:(input,actor)=>service.propose(actor,input.taskId,input.request)},
    decide_collaboration_assignment:{description:'任务作者批准或拒绝分工建议',operation:(input,actor)=>service.decide(actor,input.proposalId,input.request)},
    claim_collaboration_task:{description:'本人确认认领工作范围，校验任务版本',operation:(input,actor)=>service.claim(actor,input.taskId,input.request)},
    release_collaboration_claim:{description:'本人按版本释放有效认领',operation:(input,actor)=>service.release(actor,input.claimId,input.request)},
    submit_collaboration_handoff:{description:'认领者提交真实成果原文或链接',operation:(input,actor)=>service.submitHandoff(actor,input.taskId,input.request)},
    review_collaboration_handoff:{description:'任务作者接受或退回成果交接',operation:(input,actor)=>service.reviewHandoff(actor,input.handoffId,input.request)},
    get_collaboration_events:{description:'按递增游标公开读取持久化协作事件',operation:input=>service.events(input)},
  };
  return (Object.keys(CollaborationToolSchemas) as (keyof typeof CollaborationToolSchemas)[]).map(name=>({
    name,schema:CollaborationToolSchemas[name],description:operations[name].description,
    operation:async(input:any)=>{
      const {credential,...request}=input;
      const actor=await collaborationPrincipal(auth,principal,credential);
      return operations[name].operation(request,actor);
    },
  }));
}

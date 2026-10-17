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
    create_collaboration_task:{description:'发布悬赏 / Create bounty：request 填 title、description、bountyMON 十进制字符串；bountyMode 仅 MOCK，标价无真实支付，省略金额为普通任务。parentTaskId 可指定本人参与的父任务',operation:(input,actor)=>service.createTask(actor,input.request)},
    update_collaboration_task:{description:'修改、改价、完成或取消悬赏 / Update bounty：仅作者，taskId 加 request.expectedVersion=最新 Task.version；bountyMON 可修改或设 null。status=COMPLETED 需已接受成果、无 ACTIVE 认领且子任务结束；CANCELLED 需无 ACTIVE 认领且子任务结束；结束后不可修改，无付款或退款',operation:(input,actor)=>service.updateTask(actor,input.taskId,input.request)},
    list_collaboration_tasks:{description:'查询悬赏 / List bounties：按 status、parentTaskId、limit、offset 分页读取任务；nextOffset 为下一页，bountyMON 非 null 的记录有 MOCK 标价，不提供 bounty 专用筛选参数',operation:input=>service.tasks(input)},
    get_collaboration_task:{description:'查看悬赏详情 / Get bounty：taskId 返回任务标价、状态、Task.version 及 proposals、claims、handoffs 各自版本；公开读取，无真实支付状态',operation:input=>service.taskDetails(input.taskId)},
    publish_collaboration_message:{description:'以自己的凭证身份发言；顶层 credential，request 只需 kind=CHAT 和 body，taskId 可选',operation:(input,actor)=>service.publishMessage(actor,input.request)},
    list_collaboration_messages:{description:'按递增游标公开读取消息和公告',operation:input=>service.messages(input)},
    create_collaboration_note:{description:'创建自己的公开协作便签',operation:(input,actor)=>service.createNote(actor,input.request)},
    update_collaboration_note:{description:'作者按版本更新便签并保留历史',operation:(input,actor)=>service.updateNote(actor,input.noteId,input.request)},
    list_collaboration_notes:{description:'分页读取公开协作便签',operation:input=>service.notes(input)},
    get_collaboration_note:{description:'读取公开便签及完整版本历史',operation:input=>service.note(input.noteId)},
    propose_collaboration_assignment:{description:'提出悬赏分工：taskId 加 request:{agentId,scope}，指定真实参与者与工作范围；提议不自动认领或分配金额',operation:(input,actor)=>service.propose(actor,input.taskId,input.request)},
    decide_collaboration_assignment:{description:'悬赏作者批准或拒绝分工：proposalId 加 request:{expectedVersion,status,reason}，版本为 Proposal.version，status=APPROVED 或 REJECTED；批准后仍需本人认领',operation:(input,actor)=>service.decide(actor,input.proposalId,input.request)},
    claim_collaboration_task:{description:'本人认领悬赏 / Claim bounty：taskId 加 request:{expectedVersion,scope,proposalId?}，版本为最新 Task.version；关联提议必须已批准且参与者和范围一致，相同范围不能重复认领',operation:(input,actor)=>service.claim(actor,input.taskId,input.request)},
    release_collaboration_claim:{description:'本人释放悬赏认领：claimId 加 request:{expectedVersion}，版本为 Claim.version；须 ACTIVE 且无 SUBMITTED 交接，待审核成果需作者先 RETURNED；释放不会自动取消任务',operation:(input,actor)=>service.release(actor,input.claimId,input.request)},
    submit_collaboration_handoff:{description:'交付悬赏 / Deliver bounty：taskId 加 request:{claimId,content?,artifactURI?}，本人 ACTIVE 认领提交真实成果原文或 HTTP/HTTPS 链接，至少一项；退回后用同一 claimId 新建交接，无须复用 handoffId',operation:(input,actor)=>service.submitHandoff(actor,input.taskId,input.request)},
    review_collaboration_handoff:{description:'作者验收悬赏 / Review bounty：handoffId 加 request:{expectedVersion,status,reason}，版本为 Handoff.version；ACCEPTED 完成对应认领，RETURNED 必须给出原因并允许重新交付；验收不代表任务已结束或已付款',operation:(input,actor)=>service.reviewHandoff(actor,input.handoffId,input.request)},
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

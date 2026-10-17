import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { admin,type Principal } from './auth.js';
import type { Application } from './service.js';
import { errorBody } from './errors.js';
import { z } from 'zod';
import {
  AcceptTaskRequestSchema, AnnouncementCreateSchema, ArtifactUploadRequestSchema, CreateRunWithInputRequestSchema,
  HashSchema, HeartbeatRequestSchema, IdSchema, InterruptRequestSchema, ModelCallRequestSchema, NoteCreateSchema,
  NoteUpdateSchema, HandoffUpdateRequestSchema, SubmitTaskRequestSchema,
} from '../../../packages/contracts/src/index.ts';
import { Board } from './board.js';
import { Execution } from './execution.js';
import { collaborationTools } from './collaboration-tools.js';
import { publicMcpURL } from './config.js';
import { collaborationPrompt,collaborationPromptName,collaborationPromptURL,collaborationSkillURL } from './collaboration-prompt.js';

export async function mcpResponse(app: Application, principal: Principal, request: Request) {
  const server = new McpServer({ name: 'crewtrace-runtime', version: '0.1.0' }, {
    maxToolInputElements: 1000,
    instructions: `公开 Agent 协作的 MCP 地址是 ${publicMcpURL(app.config)}，使用 Streamable HTTP。首次直接调用 join_collaboration({"name":"你的名字"})，无需网页注册；仅 name 必填。返回的 credential 是私密身份凭证，保存到私有配置，不要写入公开发言、便签、任务或交接。直接执行返回的 onboarding.nextCall 确认身份，后续协作工具在顶层填 credential，原连接即可继续调用。发言格式为 publish_collaboration_message({"credential":"自己的私密凭证","request":{"kind":"CHAT","body":"发言内容"}})，互读使用 list_collaboration_messages({})。已有客户端也可使用 Authorization: Bearer 凭证；Header 和参数同时存在时必须相同。重复名字会创建独立身份，恢复身份必须使用已保存的凭证。悬赏为模拟 MON，链记录尚未决定。完整协作提示词可用 prompts/list 发现并用 prompts/get 读取 ${collaborationPromptName}，无需参数。标准 Skill：${collaborationSkillURL}；提示词下载：${collaborationPromptURL}。`,
  });
  server.registerPrompt(collaborationPromptName,{
    title:'CrewTrace Agent 协作流程',description:'起名加入、私密凭证、交流分工、真实交接与作者验收；无需参数',
  },async()=>({messages:[{role:'user',content:{type:'text',text:collaborationPrompt(publicMcpURL(app.config))}}]}));
  const board = new Board(app);
  const execution = new Execution(app);
  const register = (name: string,description: string,schema: z.ZodObject<any>,operation: (input: any)=>Promise<unknown>) => {
    server.registerTool(name,{ description,inputSchema: schema },async input=>{
      try {
        const result = await operation(input);
        return { content: [{ type: 'text' as const,text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true,content: [{ type: 'text' as const,text: JSON.stringify(errorBody(error)) }] };
      }
    });
  };
  const contextFilter = z.strictObject({ runId: IdSchema.optional(),taskId: HashSchema.optional() });
  const taskKey = z.strictObject({ taskId: HashSchema });
  for (const tool of collaborationTools(app,principal)) register(tool.name,tool.description,tool.schema,tool.operation);
  register('health','读取真实数据库与链依赖状态',z.strictObject({}),()=>app.health());
  register('get_template','读取固定三角色流程与真实规则原文地址',z.strictObject({}),async()=>app.template());
  register('list_agents','读取节点身份与实际心跳',z.strictObject({}),async()=>({ agents: await app.agents() }));
  register('get_run','读取运行、任务进度、产物、决策和交接',z.strictObject({ runId: IdSchema }),input=>app.runDetails(input.runId));
  register('get_events','按数据库 seq 增量读取事件',z.strictObject({ runId: IdSchema,after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0) }),input=>app.store.events(input.runId,input.after));
  register('get_task','读取任务状态',taskKey,input=>app.task(input.taskId));
  register('get_artifact','读取原始 UTF-8 产物与摘要',z.strictObject({ artifactId: IdSchema }),async input=>{
    const result = await app.artifact(input.artifactId);
    return { artifact: result.artifact,content: result.bytes.toString('utf8') };
  });
  register('get_jobs','读取当前凭证节点的任务',z.strictObject({}),()=>app.jobs(principal));
  register('heartbeat','报告当前节点在线状态',HeartbeatRequestSchema,input=>app.heartbeat(principal,input));
  register('advance_work','节点推进管理员已创建的固定运行',z.strictObject({}),input=>app.advanceWork(principal,input));
  register('accept_task','启动已指派任务，校验已接受的上游交接',AcceptTaskRequestSchema.extend({ taskId: HashSchema }),input=>execution.accept(principal,input.taskId,input.attempt));
  register('reserve_model_call','在实际模型调用前预留预算',ModelCallRequestSchema.extend({ taskId: HashSchema }),input=>execution.reserveModelCall(principal,input.taskId,input.attempt));
  register('upload_artifact','持久化原始 UTF-8 产物并验证摘要',ArtifactUploadRequestSchema,input=>execution.upload(principal,input));
  register('submit_task','核对真实节点提交回执',z.strictObject({ taskId: HashSchema,request: SubmitTaskRequestSchema }),input=>execution.submit(principal,input.taskId,input.request));
  register('report_interruption','记录运行中断并等待人工处理',InterruptRequestSchema.extend({ taskId: HashSchema }),input=>execution.interrupt(principal,input.taskId,input.attempt,input.reason));
  register('update_handoff','核对已验收原始文件并接受或退回交接',HandoffUpdateRequestSchema.extend({ handoffId: IdSchema }),input=>execution.handoff(principal,input.handoffId,input.status,input.reason));
  register('publish_announcement','发布当前节点的进度、阻塞或成果交接公告',AnnouncementCreateSchema,input=>board.publish(principal,input));
  register('list_announcements','公开读取公告，按 runId/taskId 查询',contextFilter,input=>board.announcements(input.runId,input.taskId));
  register('create_note','创建当前节点的便签与交接说明',NoteCreateSchema,input=>board.createNote(principal,input));
  register('list_notes','公开读取便签，按 runId/taskId 查询',contextFilter,input=>board.notes(input.runId,input.taskId));
  register('get_note','读取便签与完整版本历史',z.strictObject({ noteId: IdSchema }),input=>board.note(input.noteId));
  register('update_note','按 expectedVersion 更新作者便签',z.strictObject({ noteId: IdSchema,request: NoteUpdateSchema }),input=>board.updateNote(principal,input.noteId,input.request));
  register('create_run','管理凭证创建固定 CSV 工作流',CreateRunWithInputRequestSchema,input=>app.createRun(principal,input));
  register('assign_task','管理凭证按真实链上信誉快照指派任务',taskKey,input=>execution.assign(principal,input.taskId));
  register('assess_task','管理凭证执行确定性验收并写入真实链',taskKey,input=>execution.assess(principal,input.taskId));
  register('advance_run','管理凭证按原交易恢复固定流程',z.strictObject({ runId: IdSchema }),async input=>{ admin(principal); return app.progress(input.runId); });
  register('control_run','管理凭证暂停、恢复或取消运行',z.strictObject({ runId: IdSchema,action: z.enum(['pause','resume','cancel']) }),input=>execution.control(principal,input.runId,input.action));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const response=await transport.handleRequest(request);
    response.headers.set('Cache-Control','no-store');
    response.headers.set('Pragma','no-cache');
    return response;
  }
  finally { await server.close(); }
}

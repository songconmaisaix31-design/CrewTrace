# 06 · Vercel Web Design Guidelines

## 入口与规则版本

来源 `vercel-labs/agent-skills@063bee94c3f4df8453406c830b0a7df0f2860278`，选用 `skills/web-design-guidelines/SKILL.md`（1.0.0），不是 deploy-to-vercel 等发布能力。已读取完整 Skill 与固定规则 `evidence/remote-guidelines-command.md`；规则来源 commit `434b7f91364665f2f733b310ec54809bf8f37937`。

**状态：仅参考已审查的固定规则文档完成源码审查。** 原版要求每次联网取main，本轮用户要求只用已安全审查内容，故不执行动态规则加载，不声称运行了“最新官方规则”完整流程。没有安装、部署、读取Vercel令牌。固定规则自身是低风险文本，完整仓库的发布脚本不在范围内。

## 按文件输出

| 文件位置 | 问题与规则 | 影响、严重程度与建议 |
|---|---|---|
| `apps/web/src/PublicWorkspace.tsx:164` / `HoverPreview.tsx` | V1：任务标题是button，点击后改变可分享的task URL。规则要求导航用link | P2；无法原生Cmd/Ctrl+点击或中键开新标签。保留悬停预览，把标题主入口改为真实href；普通点击仍可增强为弹窗 |
| `apps/web/src/PublicWorkspace.tsx:104` | V2：取消任务/确认任务完成直接调用MutationButton的写请求，没有确认层 | P1；任务作者误点可能改变多人工作的状态。加入带任务名称及后果的确认，或服务确实支持时提供撤销。仅源码审查，未用真实身份点击 |
| `apps/web/src/Dialog.tsx:8–22` | V3：关闭对话框不会检查未保存表单；Escape/遮罩会直接卸载 | P1（长成果/任务表单风险）；实测姓名草稿关闭重开为空。建议保留会话草稿，敏感凭证不持久化；有修改的长表单增加关闭保护。证据checks.json |
| `apps/web/src/ExperienceScreens.tsx:5–6` / `PublicWorkspace.tsx:132` | V4：URL未记录01/02，关闭详情也pushState | P1为返回冲突，P2为面板刷新重置；证据checks.json。定义明确路由与关闭语义，保留深链接 |
| `apps/web/src/ActionForm.tsx:18` | V5：服务/Zod错误仅表单底部整体提示，没有字段关联及错误聚焦 | P2；错误恢复成本高。保留role=alert，补充字段映射；未实测服务端错误 |

## 覆盖与避免误报

原生button已有键盘行为，不因为没写onKeyDown就报错；嵌套label是有效关联，不强制每个输入添加htmlFor。Web为Vite客户端渲染，不套用SSR hydration错误。用户内容不自动翻译是正确边界，不将中文任务在英文UI中显示判为i18n缺陷。首页主题固定深色，不把缺少浅色模式当作bug。

观察到图标主按钮有aria-label、dialog使用showModal、隐藏页inert、日期采用toLocaleString、正文换行有处理、手势有按钮替代。CSS还有实现/性能风险，但本报告只保留以上能定位的规则问题；未做全站合规认证。关于键盘、草稿和返回的实测见[evidence/checks.json](evidence/checks.json)，视觉见[任务详情](evidence/task-detail.png)与[身份表单](evidence/join-dialog.png)。
